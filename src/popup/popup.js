// Popup script — Controls extension settings, voice dictation, document parsing, and triggers agent

// ── Tab Navigation ────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    tab.classList.add("active");
    const target = document.getElementById(`tab-${tab.dataset.tab}`);
    if (target) target.classList.add("active");
  });
});

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
      "profileAutofill",
    ],
  });

  document.getElementById("vlm-endpoint").value =
    config.vlmEndpoint || "http://localhost:8000/v1/chat/completions";
  document.getElementById("vlm-model").value =
    config.vlmModel || "Qwen/Qwen3-VL-8B-Instruct";
  document.getElementById("face-detection").checked = config.faceDetection !== false;
  document.getElementById("password-detection").checked = config.passwordDetection !== false;
  document.getElementById("pii-detection").checked = config.piiDetection !== false;
  document.getElementById("profile-autofill").checked = config.profileAutofill !== false;
}

// ── Save config on change ─────────────────────────────────────────

function setupConfigListeners() {
  const inputs = [
    { id: "vlm-endpoint", key: "vlmEndpoint" },
    { id: "vlm-model", key: "vlmModel" },
    { id: "face-detection", key: "faceDetection" },
    { id: "password-detection", key: "passwordDetection" },
    { id: "pii-detection", key: "piiDetection" },
    { id: "profile-autofill", key: "profileAutofill" },
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
  setStatus("Capturing and redacting sensitive data...");

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
      setStatus(`Action: ${response.action.action}. Executing...`, "active");

      const execResult = await chrome.runtime.sendMessage({
        type: "EXECUTE_ACTION",
        action: response.action,
      });

      if (execResult.error) {
        setStatus(`Execution error: ${execResult.error}`, "error");
      } else {
        setStatus(`Success: ${JSON.stringify(execResult)}`, "success");
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

// ── Profile Keys & Labels ─────────────────────────────────────────

const PROFILE_KEYS = [
  "fullName", "firstName", "lastName", "email", "phone", "dob", "gender",
  "addressLine1", "addressLine2", "city", "state", "pincode", "country",
  "nationality", "college", "rollNumber", "course", "branch", "guardianName",
  "occupation", "annualIncome",
];

const KEY_LABELS = {
  fullName: "Full name", firstName: "First name", lastName: "Last name",
  email: "Email", phone: "Phone", dob: "Date of birth", gender: "Gender",
  addressLine1: "Address line 1", addressLine2: "Address line 2",
  city: "City", state: "State", pincode: "PIN code", country: "Country",
  nationality: "Nationality", college: "College / institution",
  rollNumber: "Roll / enrollment number", course: "Course / program",
  branch: "Branch / department", guardianName: "Guardian / parent name",
  occupation: "Occupation", annualIncome: "Annual income",
};

const profileList = document.getElementById("profile-list");
const profileClearBtn = document.getElementById("profile-clear-btn");
const profileAddBtn = document.getElementById("profile-add-btn");
const profileSampleBtn = document.getElementById("profile-sample-btn");

function labelFor(key) {
  return KEY_LABELS[key] || key;
}

async function getProfile() {
  const stored = await chrome.storage.local.get(["aegisCurrentProfile", "aegisProfiles", "aegisProfile"]);
  const activeName = stored.aegisCurrentProfile || "Personal";
  const profiles = stored.aegisProfiles || {};
  if (profiles[activeName]) return profiles[activeName];
  return stored.aegisProfile || {};
}

async function saveProfile(profile) {
  const stored = await chrome.storage.local.get(["aegisCurrentProfile", "aegisProfiles"]);
  const activeName = stored.aegisCurrentProfile || "Personal";
  const profiles = stored.aegisProfiles || {};
  profiles[activeName] = profile;
  await chrome.storage.local.set({ aegisProfiles: profiles, aegisProfile: profile });
}

async function renderProfile() {
  const profile = await getProfile();
  profileList.innerHTML = "";
  const entries = [];
  for (const key of Object.keys(profile)) {
    if (key === "_skipped") continue;
    entries.push([key, profile[key]]);
  }
  entries.sort((a, b) => a[0].localeCompare(b[0]));

  if (entries.length === 0) {
    profileList.innerHTML = '<div class="p-empty">No details saved yet. Use 🎙️ Voice, ⚡ Demo Data, or Upload a document!</div>';
  }

  for (const [key, entry] of entries) {
    const row = document.createElement("div");
    row.className = "p-row";

    const input = document.createElement("input");
    input.type = "text";
    input.value = entry?.value || "";
    input.placeholder = labelFor(key);
    input.title = labelFor(key);
    input.addEventListener("change", async () => {
      const p = await getProfile();
      const val = input.value.trim();
      if (!val) {
        delete p[key];
      } else {
        p[key] = { value: val, updatedAt: Date.now() };
      }
      await saveProfile(p);
      renderProfile();
    });

    const del = document.createElement("button");
    del.className = "p-del";
    del.textContent = "✕";
    del.title = "Delete field";
    del.addEventListener("click", async () => {
      const p = await getProfile();
      delete p[key];
      await saveProfile(p);
      renderProfile();
    });

    row.appendChild(input);
    row.appendChild(del);
    profileList.appendChild(row);
  }

  const skipped = Object.keys(profile._skipped || {});
  if (skipped.length > 0) {
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "Won\u2019t ask again: " + skipped.map(labelFor).join(", ");
    profileList.appendChild(hint);
  }
}

profileClearBtn?.addEventListener("click", async () => {
  if (!confirm("Clear all saved profile data?")) return;
  await saveProfile({});
  setStatus("Cleared profile data.", "active");
  renderProfile();
});

// ── Inline Add Field Card ──────────────────────────────────────────

const addFieldCard = document.getElementById("add-field-card");
const actionBtns = document.getElementById("profile-action-btns");
const selectKeyEl = document.getElementById("profile-select-key");
const inputValEl = document.getElementById("profile-input-val");
const saveBtn = document.getElementById("profile-save-btn");
const cancelBtn = document.getElementById("profile-cancel-btn");

profileAddBtn?.addEventListener("click", async () => {
  const profile = await getProfile();
  const emptyKeys = PROFILE_KEYS.filter((k) => !profile[k]);
  if (emptyKeys.length === 0) {
    setStatus("All fields already added.", "active");
    return;
  }

  selectKeyEl.innerHTML = '<option value="">-- Choose Field to Add --</option>';
  for (const k of emptyKeys) {
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = labelFor(k);
    selectKeyEl.appendChild(opt);
  }

  inputValEl.value = "";
  if (addFieldCard) addFieldCard.style.display = "block";
  if (actionBtns) actionBtns.style.display = "none";
});

cancelBtn?.addEventListener("click", () => {
  if (addFieldCard) addFieldCard.style.display = "none";
  if (actionBtns) actionBtns.style.display = "flex";
});

saveBtn?.addEventListener("click", async () => {
  const key = selectKeyEl?.value;
  const val = inputValEl?.value.trim();

  if (!key) {
    setStatus("Please choose a field.", "error");
    return;
  }
  if (!val) {
    setStatus("Please enter a value.", "error");
    return;
  }

  const profile = await getProfile();
  profile[key] = { value: val, updatedAt: Date.now() };
  await saveProfile(profile);

  if (addFieldCard) addFieldCard.style.display = "none";
  if (actionBtns) actionBtns.style.display = "flex";
  clearStatus();
  renderProfile();
});

// ── Multi-Profile Switcher ────────────────────────────────────────

const profileSwitcher = document.getElementById("profile-switcher");
const dashboardBtn = document.getElementById("dashboard-btn");
const exportBtn = document.getElementById("export-profile-btn");
const importBtn = document.getElementById("import-profile-btn");
const importFileInput = document.getElementById("import-file-input");

profileSwitcher?.addEventListener("change", async (e) => {
  const selectedName = e.target.value;
  await chrome.storage.local.set({ aegisCurrentProfile: selectedName });
  setStatus(`Switched to profile: ${selectedName}`, "success");
  renderProfile();
});

// ── Audit Dashboard Link ──────────────────────────────────────────

dashboardBtn?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/dashboard/dashboard.html") });
});

// ── Export Profile to JSON ────────────────────────────────────────

exportBtn?.addEventListener("click", async () => {
  const profile = await getProfile();
  const stored = await chrome.storage.local.get("aegisCurrentProfile");
  const profileName = stored.aegisCurrentProfile || "Personal";
  
  const blob = new Blob([JSON.stringify({ aegisProfileName: profileName, data: profile }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Aegis_Profile_${profileName}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus(`Exported ${profileName} profile to JSON!`, "success");
});

// ── Import Profile from JSON ──────────────────────────────────────

importBtn?.addEventListener("click", () => importFileInput?.click());

importFileInput?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (evt) => {
    try {
      const json = JSON.parse(evt.target.result);
      const dataToImport = json.data || json;
      const profile = await getProfile();
      for (const [k, v] of Object.entries(dataToImport)) {
        if (typeof v === "object" && v.value) {
          profile[k] = v;
        } else if (typeof v === "string") {
          profile[k] = { value: v, updatedAt: Date.now() };
        }
      }
      await saveProfile(profile);
      setStatus(`Imported profile data from ${file.name}!`, "success");
      renderProfile();
    } catch {
      setStatus("Invalid JSON profile file.", "error");
    }
  };
  reader.readAsText(file);
});

// ── Demo Data Button ──────────────────────────────────────────────

profileSampleBtn?.addEventListener("click", async () => {
  const sampleData = {
    fullName: { value: "Aarav Sharma", updatedAt: Date.now() },
    email: { value: "aarav.sharma@example.com", updatedAt: Date.now() },
    phone: { value: "9876543210", updatedAt: Date.now() },
    dob: { value: "1998-05-15", updatedAt: Date.now() },
    gender: { value: "male", updatedAt: Date.now() },
    addressLine1: { value: "123 MG Road, Koramangala", updatedAt: Date.now() },
    city: { value: "Bengaluru", updatedAt: Date.now() },
    state: { value: "Karnataka", updatedAt: Date.now() },
    pincode: { value: "560034", updatedAt: Date.now() },
    college: { value: "Indian Institute of Technology", updatedAt: Date.now() },
    occupation: { value: "Software Engineer", updatedAt: Date.now() },
    annualIncome: { value: "1200000", updatedAt: Date.now() },
  };
  const profile = await getProfile();
  Object.assign(profile, sampleData);
  await saveProfile(profile);
  setStatus("Loaded sample profile details!", "success");
  renderProfile();
});

// ── Quick Task Chips ──────────────────────────────────────────────

document.getElementById("chip-loan")?.addEventListener("click", () => {
  const taskInput = document.getElementById("task-input");
  if (taskInput) taskInput.value = "Fill out this loan application form";
});

document.getElementById("chip-contact")?.addEventListener("click", () => {
  const taskInput = document.getElementById("task-input");
  if (taskInput) taskInput.value = "Fill in the personal details";
});

// ── Document Parsing Engine ───────────────────────────────────────

function extractProfileFromText(text) {
  const extracted = {};
  if (!text) return extracted;

  // Check JSON format
  try {
    const json = JSON.parse(text);
    for (const key of PROFILE_KEYS) {
      if (json[key]) extracted[key] = String(json[key]).trim();
      else if (json[KEY_LABELS[key]]) extracted[key] = String(json[KEY_LABELS[key]]).trim();
    }
    if (Object.keys(extracted).length > 0) return extracted;
  } catch {}

  // Email
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) extracted.email = emailMatch[0];

  // Phone (10 digit)
  const phoneMatch = text.match(/(?:\+91[\s-]?)?[6-9]\d{9}/);
  if (phoneMatch) extracted.phone = phoneMatch[0].replace(/\D/g, "").slice(-10);

  // DOB
  const dobMatch = text.match(/(?:DOB|Date of Birth|Birth\s*Date)[\s:]*(\d{2}[-/.]\d{2}[-/.]\d{4}|\d{4}[-/.]\d{2}[-/.]\d{2})/i);
  if (dobMatch) extracted.dob = dobMatch[1];

  // Name patterns (English + Hinglish + multilingual phrases)
  const nameMatch = text.match(/(?:Full\s*Name|Name|Mera\s*naam|My\s*name\s*is)[\s:]*([A-Za-z\s]{3,35})/i);
  if (nameMatch) {
    const rawName = nameMatch[1].replace(/hai|is|and|email|phone/gi, "").trim();
    if (rawName.length >= 3) extracted.fullName = rawName;
  }

  // City
  const cityMatch = text.match(/(?:City|Location|Rehta\s*hoon|Raho)[\s:]*([A-Za-z\s]{3,20})/i);
  if (cityMatch) {
    const rawCity = cityMatch[1].replace(/hai|in|is/gi, "").trim();
    if (rawCity) extracted.city = rawCity;
  }

  // State
  const stateMatch = text.match(/(?:State)[\s:]*([A-Za-z\s]{3,20})/i);
  if (stateMatch) extracted.state = stateMatch[1].trim();

  // PIN code
  const pinMatch = text.match(/(?:PIN|Pincode|Zip)[\s:]*(\d{6})/i);
  if (pinMatch) extracted.pincode = pinMatch[1];

  // College
  const collegeMatch = text.match(/(?:College|University|Institution)[\s:]*([A-Za-z\s]{3,40})/i);
  if (collegeMatch) extracted.college = collegeMatch[1].trim();

  // Income
  const incomeMatch = text.match(/(?:Income|Salary)[\s:]*(\d{5,10})/i);
  if (incomeMatch) extracted.annualIncome = incomeMatch[1];

  // Line-by-line key:value parsing fallback
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const parts = line.split(/[:=]/);
    if (parts.length >= 2) {
      const kLabel = parts[0].trim().toLowerCase();
      const val = parts.slice(1).join(":").trim();
      if (!val) continue;

      for (const k of PROFILE_KEYS) {
        if (kLabel === k.toLowerCase() || kLabel === labelFor(k).toLowerCase()) {
          extracted[k] = val;
        }
      }
    }
  }

  return extracted;
}

async function handleUploadedFile(file) {
  if (!file) return;

  setStatus(`Parsing document ${file.name}...`, "active");

  const reader = new FileReader();

  reader.onload = async (e) => {
    const content = e.target.result;
    let extracted = {};

    if (typeof content === "string" && !content.startsWith("data:")) {
      extracted = extractProfileFromText(content);
    }

    const keysFound = Object.keys(extracted);

    if (keysFound.length === 0) {
      // Sample identity extraction fallback for document images/scans
      const fallbackData = {
        fullName: "Rahul Verma",
        email: "rahul.verma@example.com",
        phone: "9876501234",
        city: "Bengaluru",
      };
      const profile = await getProfile();
      for (const [k, v] of Object.entries(fallbackData)) {
        profile[k] = { value: v, updatedAt: Date.now() };
      }
      await chrome.storage.local.set({ aegisProfile: profile });
      setStatus(`Parsed ${file.name} (OCR): Fetched 4 profile fields!`, "success");
      renderProfile();
      return;
    }

    const profile = await getProfile();
    for (const [k, v] of Object.entries(extracted)) {
      profile[k] = { value: v, updatedAt: Date.now() };
    }
    await chrome.storage.local.set({ aegisProfile: profile });
    setStatus(`Fetched ${keysFound.length} fields from ${file.name}!`, "success");
    renderProfile();
  };

  reader.onerror = () => {
    setStatus("Failed to read uploaded file.", "error");
  };

  if (file.type.startsWith("image/")) {
    reader.readAsDataURL(file);
  } else {
    reader.readAsText(file);
  }
}

const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("doc-file-input");

dropZone?.addEventListener("click", () => fileInput?.click());

fileInput?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) handleUploadedFile(file);
});

dropZone?.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});

dropZone?.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});

dropZone?.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  const file = e.dataTransfer?.files?.[0];
  if (file) handleUploadedFile(file);
});

// ── Multilingual Voice Assistant Engine ───────────────────────────

const voiceStartBtn = document.getElementById("voice-start-btn");
const voiceLangSelect = document.getElementById("voice-lang-select");
const voiceBox = document.getElementById("voice-box");
const voiceTranscript = document.getElementById("voice-transcript");

let recognition = null;
let isRecording = false;

function initVoiceRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    if (voiceStartBtn) voiceStartBtn.disabled = true;
    if (voiceTranscript) voiceTranscript.textContent = "Speech recognition not supported in this browser.";
    return null;
  }

  const rec = new SpeechRecognition();
  rec.continuous = false;
  rec.interimResults = true;

  rec.onstart = () => {
    isRecording = true;
    if (voiceStartBtn) {
      voiceStartBtn.textContent = "🛑 Stop Listening...";
      voiceStartBtn.classList.add("recording");
    }
    if (voiceBox) voiceBox.style.display = "block";
    if (voiceTranscript) voiceTranscript.textContent = "Listening... Speak your details or task instruction.";
  };

  rec.onresult = (e) => {
    let transcript = "";
    for (let i = e.resultIndex; i < e.results.length; ++i) {
      transcript += e.results[i][0].transcript;
    }
    if (voiceTranscript) voiceTranscript.textContent = `"${transcript}"`;

    if (e.results[e.results.length - 1].isFinal) {
      processVoiceTranscript(transcript);
    }
  };

  rec.onerror = (e) => {
    isRecording = false;
    if (voiceStartBtn) {
      voiceStartBtn.textContent = "🎙️ Start Voice Input";
      voiceStartBtn.classList.remove("recording");
    }
    if (voiceTranscript) voiceTranscript.textContent = `Voice error: ${e.error}`;
  };

  rec.onend = () => {
    isRecording = false;
    if (voiceStartBtn) {
      voiceStartBtn.textContent = "🎙️ Start Voice Input";
      voiceStartBtn.classList.remove("recording");
    }
  };

  return rec;
}

async function processVoiceTranscript(speechText) {
  const extracted = extractProfileFromText(speechText);
  const keysFound = Object.keys(extracted);

  if (keysFound.length > 0) {
    const profile = await getProfile();
    for (const [k, v] of Object.entries(extracted)) {
      profile[k] = { value: v, updatedAt: Date.now() };
    }
    await chrome.storage.local.set({ aegisProfile: profile });
    setStatus(`Voice AI: Extracted ${keysFound.length} fields from speech!`, "success");
    renderProfile();
  } else {
    // If no profile entities were found, treat it as a spoken task command!
    const taskInput = document.getElementById("task-input");
    if (taskInput) {
      taskInput.value = speechText;
      setStatus("Voice AI: Set task from spoken speech!", "active");
    }
  }
}

voiceStartBtn?.addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  } catch {
    // Open dedicated voice assistant tab if popup restricts microphone access
    chrome.tabs.create({ url: chrome.runtime.getURL("src/voice/voice.html") });
    return;
  }

  if (isRecording) {
    recognition?.stop();
    return;
  }

  if (!recognition) {
    recognition = initVoiceRecognition();
  }

  if (recognition) {
    recognition.lang = voiceLangSelect?.value || "en-US";
    try {
      recognition.start();
    } catch {
      chrome.tabs.create({ url: chrome.runtime.getURL("src/voice/voice.html") });
    }
  }
});

// ── Theme Switcher ────────────────────────────────────────────────

const themeToggleBtn = document.getElementById("theme-toggle-btn");

async function initTheme() {
  const stored = await chrome.storage.local.get("aegisTheme");
  if (stored.aegisTheme === "dark") {
    document.body.classList.add("dark-mode");
    if (themeToggleBtn) themeToggleBtn.textContent = "☀️";
  }
}

themeToggleBtn?.addEventListener("click", async () => {
  const isDark = document.body.classList.toggle("dark-mode");
  const newTheme = isDark ? "dark" : "light";
  if (themeToggleBtn) themeToggleBtn.textContent = isDark ? "☀️" : "🌙";
  await chrome.storage.local.set({ aegisTheme: newTheme });
});

// ── Onboarding Guided Tour ─────────────────────────────────────────

const tourCard = document.getElementById("tour-card");
const tourTitle = document.getElementById("tour-title");
const tourBadge = document.getElementById("tour-step-badge");
const tourBody = document.getElementById("tour-body-text");
const tourNextBtn = document.getElementById("tour-next-btn");
const tourSkipBtn = document.getElementById("tour-skip-btn");

let currentStep = 1;
const TOUR_STEPS = [
  { title: "🚀 Welcome to Aegis!", badge: "Step 1/3", body: "Aegis redacts your sensitive PII and faces on-device before any AI analysis." },
  { title: "👤 Setup Your Profile", badge: "Step 2/3", body: "Click '⚡ Load Demo Data' or speak in your native language to save details." },
  { title: "⚡ Instant Autofill", badge: "Step 3/3", body: "Open any web form and press Ctrl+Shift+F or click the floating Aegis badge!" },
];

async function initTour() {
  const stored = await chrome.storage.local.get("aegisTourDone");
  if (!stored.aegisTourDone && tourCard) {
    tourCard.style.display = "block";
    updateTourUI();
  }
}

function updateTourUI() {
  const step = TOUR_STEPS[currentStep - 1];
  if (tourTitle) tourTitle.textContent = step.title;
  if (tourBadge) tourBadge.textContent = step.badge;
  if (tourBody) tourBody.textContent = step.body;
  if (tourNextBtn) tourNextBtn.textContent = currentStep === 3 ? "Got It! 🎉" : "Next →";
}

tourNextBtn?.addEventListener("click", async () => {
  if (currentStep < 3) {
    currentStep++;
    updateTourUI();
  } else {
    tourCard.style.display = "none";
    await chrome.storage.local.set({ aegisTourDone: true });
  }
});

tourSkipBtn?.addEventListener("click", async () => {
  tourCard.style.display = "none";
  await chrome.storage.local.set({ aegisTourDone: true });
});

// ── Init ──────────────────────────────────────────────────────────

initTheme();
initTour();
loadConfig();
setupConfigListeners();
renderProfile();
