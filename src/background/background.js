// Service Worker — Event-driven orchestrator (no DOM access)

const OFFSCREEN_URL = chrome.runtime.getURL("src/offscreen/offscreen.html");

let offscreenCreated = false;

async function ensureOffscreen() {
  if (offscreenCreated) return;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["DOM_PARSER"],
      justification: "Inference and mask rendering require Canvas/DOM access",
    });
    offscreenCreated = true;
  } catch (e) {
    if (!e.message?.includes("already exists")) throw e;
    offscreenCreated = true;
  }
}

async function removeOffscreen() {
  if (!offscreenCreated) return;
  try {
    await chrome.offscreen.closeDocument();
    offscreenCreated = false;
  } catch (e) {
    // already closed
  }
}

// ── Message Router ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "CAPTURE_AND_SANITIZE") {
    handleCaptureAndSanitize(msg.task).then(sendResponse).catch((err) => {
      sendResponse({ error: err.message });
    });
    return true; // async response
  }

  if (msg.type === "EXECUTE_ACTION") {
    handleExecuteAction(msg.action, sender.tab?.id).then(sendResponse).catch((err) => {
      sendResponse({ error: err.message });
    });
    return true;
  }

  if (msg.type === "SET_CONFIG") {
    chrome.storage.local.set(msg.config).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === "GET_CONFIG") {
    chrome.storage.local.get(msg.keys).then(sendResponse);
    return true;
  }
});

// ── Core Pipeline ─────────────────────────────────────────────────

async function handleCaptureAndSanitize(task) {
  // 1. Capture screenshot from active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");

  const screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: "png",
  });

  // 2. Get DOM scan results from content script
  const domScanResults = await chrome.tabs.sendMessage(tab.id, {
    type: "DOM_SCAN",
  });

  // 3. Ensure offscreen document is running
  await ensureOffscreen();

  // 4. Send to offscreen document for inference + masking
  const sanitizeResponse = await chrome.runtime.sendMessage({
    type: "SANITIZE",
    screenshot: screenshotDataUrl,
    domScanResults,
  });

  if (sanitizeResponse.error) throw new Error(sanitizeResponse.error);

  // 5. Send sanitized image to VLM
  const config = await chrome.storage.local.get(["vlmEndpoint", "vlmModel"]);
  const vlmEndpoint = config.vlmEndpoint || "http://localhost:8000/v1/chat/completions";
  const vlmModel = config.vlmModel || "Qwen/Qwen3-VL-8B-Instruct";

  const pageStructure = {
    url: tab.url,
    title: tab.title,
    fields: domScanResults.fields || [],
    maskedRegions: sanitizeResponse.maskedRegions || [],
  };

  const vlmPayload = {
    model: vlmModel,
    messages: [
      {
        role: "system",
        content:
          "You are a browser automation agent. You receive a sanitized screenshot where sensitive data (passwords, faces, personal info) has been blurred or redacted for privacy. You also receive a structural description of the page. Based on the user's task, return a single JSON action object. Available actions: {click: {x, y}}, {type: {selector, value}}, {scroll: {direction: 'up'|'down'}}, {navigate: {url}}, {done: {summary}}. Only use actions that do NOT require reading redacted content.",
      },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: sanitizeResponse.sanitizedImage },
          },
          {
            type: "text",
            text: `Page structure: ${JSON.stringify(pageStructure)}\n\nTask: ${task}`,
          },
        ],
      },
    ],
    max_tokens: 256,
    temperature: 0.1,
  };

  const vlmResponse = await fetch(vlmEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(vlmPayload),
  });

  if (!vlmResponse.ok) {
    throw new Error(`VLM API error: ${vlmResponse.status}`);
  }

  const vlmData = await vlmResponse.json();
  const actionRaw = vlmData.choices?.[0]?.message?.content;

  // Parse action from VLM response (expects JSON)
  let action;
  try {
    action = JSON.parse(actionRaw);
  } catch {
    // Try to extract JSON from markdown code blocks
    const match = actionRaw?.match(/```(?:json)?\s*([\s\S]*?)```/);
    action = match ? JSON.parse(match[1]) : null;
  }

  return {
    pageStructure,
    action,
    sanitizedImage: sanitizeResponse.sanitizedImage,
  };
}

async function handleExecuteAction(action, tabId) {
  if (!action) return { error: "No action provided" };

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const targetTabId = tabId || tab?.id;
  if (!targetTabId) throw new Error("No active tab");

  switch (action.action) {
    case "click":
      return chrome.tabs.sendMessage(targetTabId, {
        type: "EXECUTE_CLICK",
        x: action.x,
        y: action.y,
      });

    case "type":
      return chrome.tabs.sendMessage(targetTabId, {
        type: "EXECUTE_TYPE",
        selector: action.selector,
        value: action.value,
      });

    case "scroll":
      return chrome.tabs.sendMessage(targetTabId, {
        type: "EXECUTE_SCROLL",
        direction: action.direction,
      });

    case "navigate":
      await chrome.tabs.update(targetTabId, { url: action.url });
      return { ok: true, navigated: action.url };

    case "done":
      return { ok: true, summary: action.summary };

    default:
      return { error: `Unknown action: ${action.action}` };
  }
}

// ── Extension Install ─────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    vlmEndpoint: "http://localhost:8000/v1/chat/completions",
    vlmModel: "Qwen/Qwen3-VL-8B-Instruct",
    detectionEnabled: true,
    faceDetection: true,
    passwordDetection: true,
    piiDetection: true,
  });
});
