// Aegis Backend — local VLM gateway
// Runs on the operator's laptop. Exposes an OpenAI-compatible endpoint that
// the Aegis extension talks to. Forwards requests to a local VLM runtime
// (Ollama / LM Studio / llama.cpp server / vLLM) and normalizes the VLM's
// output into the single-action JSON contract the extension expects.

const http = require("http");

// ── Config ───────────────────────────────────────────────────────────
const CONFIG = {
  port: Number(process.env.PORT || 8000),
  host: process.env.HOST || "127.0.0.1", // set HOST=0.0.0.0 to accept requests from other devices on the LAN
  upstreamBaseUrl: process.env.UPSTREAM_BASE_URL || "http://localhost:11434/v1",
  upstreamModel: process.env.UPSTREAM_MODEL || "qwen3-vl:8b",
  upstreamApiKey: process.env.UPSTREAM_API_KEY || "",
  mock: process.env.MOCK === "1" || process.argv.includes("--mock"),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 120000),
};

// ── Logging ──────────────────────────────────────────────────────────
function log(level, msg, extra) {
  const ts = new Date().toISOString();
  const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`[${ts}] ${level} ${msg}${suffix}`);
}

// ── Action extraction ────────────────────────────────────────────────
// VLMs frequently wrap JSON in prose or markdown fences. Extract the first
// valid action object so the extension can JSON.parse the content directly.
const VALID_ACTIONS = ["click", "type", "scroll", "navigate", "done"];

function normalizeAction(obj) {
  if (!obj || typeof obj !== "object") return null;
  const action = obj.action;
  if (!VALID_ACTIONS.includes(action)) return null;

  switch (action) {
    case "click":
      if (typeof obj.x !== "number" || typeof obj.y !== "number") return null;
      return { action, x: obj.x, y: obj.y };
    case "type":
      if (typeof obj.selector !== "string" || typeof obj.value !== "string") return null;
      return { action, selector: obj.selector, value: obj.value };
    case "scroll":
      if (obj.direction !== "up" && obj.direction !== "down") return null;
      return { action, direction: obj.direction };
    case "navigate":
      if (typeof obj.url !== "string") return null;
      return { action, url: obj.url };
    case "done":
      return { action, summary: typeof obj.summary === "string" ? obj.summary : "Task complete" };
    default:
      return null;
  }
}

function extractAction(raw) {
  if (!raw) return null;

  // Direct parse
  try {
    const direct = normalizeAction(JSON.parse(raw));
    if (direct) return direct;
  } catch {}

  // Markdown code fence
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      const fenced = normalizeAction(JSON.parse(fence[1].trim()));
      if (fenced) return fenced;
    } catch {}
  }

  // First balanced {...} block in the string
  const start = raw.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < raw.length; i++) {
      const ch = raw[i];
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            const block = normalizeAction(JSON.parse(raw.slice(start, i + 1)));
            if (block) return block;
          } catch {}
          break;
        }
      }
    }
  }

  return null;
}

// ── Upstream call ────────────────────────────────────────────────────
async function callUpstream(payload) {
  const url = `${CONFIG.upstreamBaseUrl.replace(/\/$/, "")}/chat/completions`;
  const headers = { "Content-Type": "application/json" };
  if (CONFIG.upstreamApiKey) headers.Authorization = `Bearer ${CONFIG.upstreamApiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
  const started = Date.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Upstream ${res.status}: ${errBody.slice(0, 500)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
    log("INFO", "upstream call finished", { latencyMs: Date.now() - started });
  }
}

// ── Mock VLM (for testing the pipeline without a model installed) ───
function mockCompletion(payload) {
  const lastMsg = payload.messages?.[payload.messages.length - 1];
  const textPart = Array.isArray(lastMsg?.content)
    ? lastMsg.content.find((p) => p.type === "text")?.text || ""
    : lastMsg?.content || "";
  const taskMatch = textPart.match(/Task:\s*(.+)/i);
  const task = taskMatch ? taskMatch[1].trim() : "";
  const structureMatch = textPart.match(/Page structure:\s*([\s\S]*?)\n\nTask:/);
  let structure = null;
  if (structureMatch) {
    try { structure = JSON.parse(structureMatch[1]); } catch {}
  }

  // Fake a deterministic action based on page structure
  let action;
  const fields = structure?.fields || [];
  const emptyField = fields.find((f) => f.required !== false && !f.filled);
  if (task.toLowerCase().includes("scroll")) {
    action = { action: "scroll", direction: "down" };
  } else if (fields.some((f) => f.type === "password") && emptyField?.type === "password") {
    action = { action: "type", selector: emptyField.selector || "input[type='password']", value: "<LOCAL_SECRET>" };
  } else if (emptyField) {
    action = { action: "type", selector: emptyField.selector || "input", value: "test@example.com" };
  } else if (fields.length > 0 || structure?.url) {
    action = { action: "click", x: 400, y: 500 };
  } else {
    action = { action: "done", summary: `Completed: ${task || "unknown task"}` };
  }

  return {
    id: "mock-" + Date.now(),
    object: "chat.completion",
    model: payload.model || "mock",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: JSON.stringify(action) },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

// ── HTTP helpers ─────────────────────────────────────────────────────
function sendJson(res, status, body, extraHeaders) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 64 * 1024 * 1024) {
        reject(new Error("Body too large (max 64MB)"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ── Handlers ─────────────────────────────────────────────────────────
async function handleHealth(res) {
  const health = {
    status: "ok",
    mock: CONFIG.mock,
    upstream: { baseUrl: CONFIG.upstreamBaseUrl, model: CONFIG.upstreamModel },
    upstreamReachable: false,
  };
  if (!CONFIG.mock) {
    try {
      const r = await fetch(`${CONFIG.upstreamBaseUrl.replace(/\/$/, "")}/models`, {
        signal: AbortSignal.timeout(3000),
      });
      health.upstreamReachable = r.ok;
    } catch {}
  }
  sendJson(res, 200, health);
}

async function handleModels(res) {
  if (CONFIG.mock) {
    return sendJson(res, 200, { object: "list", data: [{ id: "mock", object: "model" }] });
  }
  try {
    const r = await fetch(`${CONFIG.upstreamBaseUrl.replace(/\/$/, "")}/models`, {
      headers: CONFIG.upstreamApiKey ? { Authorization: `Bearer ${CONFIG.upstreamApiKey}` } : {},
    });
    const data = await r.json();
    sendJson(res, r.status, data);
  } catch (e) {
    sendJson(res, 502, { error: { message: `Upstream unreachable: ${e.message}` } });
  }
}

async function handleChatCompletions(req, res) {
  const started = Date.now();
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (e) {
    return sendJson(res, 400, { error: { message: `Invalid JSON body: ${e.message}` } });
  }

  try {
    const data = CONFIG.mock ? mockCompletion(payload) : await callUpstream(payload);
    const raw = data.choices?.[0]?.message?.content ?? "";
    const action = extractAction(raw);

    // Return the standard OpenAI shape, but with content guaranteed to be a
    // single clean action JSON so the extension's JSON.parse always succeeds.
    if (action) {
      data.choices[0].message.content = JSON.stringify(action);
    }

    const latencyMs = Date.now() - started;
    log("INFO", "chat completion served", {
      model: payload.model,
      action: action?.action || null,
      actionParsed: !!action,
      latencyMs,
    });
    sendJson(res, 200, data, { "X-Aegis-Latency-Ms": String(latencyMs) });
  } catch (e) {
    log("ERROR", "chat completion failed", { error: e.message });
    sendJson(res, e.message.startsWith("Upstream") ? 502 : 500, {
      error: { message: e.message },
    });
  }
}

// ── Server ───────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || `localhost:${CONFIG.port}`}`);

  try {
    if (req.method === "GET" && url.pathname === "/health") return await handleHealth(res);
    if (req.method === "GET" && url.pathname === "/v1/models") return await handleModels(res);
    if (req.method === "POST" && url.pathname === "/v1/chat/completions")
      return await handleChatCompletions(req, res);
    sendJson(res, 404, { error: { message: `No route: ${req.method} ${url.pathname}` } });
  } catch (e) {
    log("ERROR", "unhandled error", { error: e.message });
    if (!res.headersSent) sendJson(res, 500, { error: { message: e.message } });
  }
});

server.listen(CONFIG.port, CONFIG.host, () => {
  log("INFO", "Aegis backend listening", {
    host: CONFIG.host,
    port: CONFIG.port,
    mock: CONFIG.mock,
    upstream: CONFIG.upstreamBaseUrl,
    model: CONFIG.upstreamModel,
  });
  if (!CONFIG.mock) {
    log("WARN", "Make sure the VLM runtime is up (e.g. `ollama serve` and the model is pulled)");
  }
});
