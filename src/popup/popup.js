// Popup script — Controls extension settings and triggers agent

const statusEl = document.getElementById("status");
const runBtn = document.getElementById("run-btn");

function setStatus(message, type = "active") {
  statusEl.textContent = message;
  statusEl.className = `status active ${type}`;
}

function clearStatus() {
  statusEl.className = "status";
}

// ── Load saved config ─────────────────────────────────────────────

async function loadConfig() {
  const config = await chrome.runtime.sendMessage({
    type: "GET_CONFIG",
    keys: [
      "vlmEndpoint",
      "vlmModel",
      "faceDetection",
      "passwordDetection",
      "piiDetection",
    ],
  });

  document.getElementById("vlm-endpoint").value =
    config.vlmEndpoint || "http://localhost:8000/v1/chat/completions";
  document.getElementById("vlm-model").value =
    config.vlmModel || "Qwen/Qwen3-VL-8B-Instruct";
  document.getElementById("face-detection").checked = config.faceDetection !== false;
  document.getElementById("password-detection").checked = config.passwordDetection !== false;
  document.getElementById("pii-detection").checked = config.piiDetection !== false;
}

// ── Save config on change ─────────────────────────────────────────

function setupConfigListeners() {
  const inputs = [
    { id: "vlm-endpoint", key: "vlmEndpoint" },
    { id: "vlm-model", key: "vlmModel" },
    { id: "face-detection", key: "faceDetection" },
    { id: "password-detection", key: "passwordDetection" },
    { id: "pii-detection", key: "piiDetection" },
  ];

  for (const { id, key } of inputs) {
    const el = document.getElementById(id);
    el.addEventListener("change", () => {
      const value = el.type === "checkbox" ? el.checked : el.value;
      chrome.runtime.sendMessage({ type: "SET_CONFIG", config: { [key]: value } });
    });
  }
}

// ── Run Agent ─────────────────────────────────────────────────────

runBtn.addEventListener("click", async () => {
  const task = document.getElementById("task-input").value.trim();
  if (!task) {
    setStatus("Please enter a task.", "error");
    return;
  }

  runBtn.disabled = true;
  setStatus("Capturing and sanitizing...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "CAPTURE_AND_SANITIZE",
      task,
    });

    if (response.error) {
      setStatus(`Error: ${response.error}`, "error");
      return;
    }

    if (response.action) {
      setStatus(`VLM returned: ${response.action.action}. Executing...`, "active");

      const execResult = await chrome.runtime.sendMessage({
        type: "EXECUTE_ACTION",
        action: response.action,
      });

      if (execResult.error) {
        setStatus(`Execution error: ${execResult.error}`, "error");
      } else {
        setStatus(`Done: ${JSON.stringify(execResult)}`, "success");
      }
    } else {
      setStatus("No action returned from VLM.", "error");
    }
  } catch (err) {
    setStatus(`Error: ${err.message}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});

// ── Init ──────────────────────────────────────────────────────────

loadConfig();
setupConfigListeners();
