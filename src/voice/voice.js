// Standalone Multilingual Voice Assistant Script

const micBtn = document.getElementById("mic-btn");
const langSelect = document.getElementById("voice-lang-select");
const transcriptBox = document.getElementById("transcript-box");
const extractedBox = document.getElementById("extracted-box");
const extractedTags = document.getElementById("extracted-tags");
const closeBtn = document.getElementById("close-btn");

let recognition = null;
let isRecording = false;

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

function labelFor(key) {
  return KEY_LABELS[key] || key;
}

function extractProfileFromText(text) {
  const extracted = {};
  if (!text) return extracted;

  // Email
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) extracted.email = emailMatch[0];

  // Phone (10 digit)
  const phoneMatch = text.match(/(?:\+91[\s-]?)?[6-9]\d{9}/);
  if (phoneMatch) extracted.phone = phoneMatch[0].replace(/\D/g, "").slice(-10);

  // DOB
  const dobMatch = text.match(/(?:DOB|Date of Birth|Birth\s*Date)[\s:]*(\d{2}[-/.]\d{2}[-/.]\d{4}|\d{4}[-/.]\d{2}[-/.]\d{2})/i);
  if (dobMatch) extracted.dob = dobMatch[1];

  // Name patterns (English + Hinglish + phrases)
  const nameMatch = text.match(/(?:Full\s*Name|Name|Mera\s*naam|My\s*name\s*is)[\s:]*([A-Za-z\s]{3,35})/i);
  if (nameMatch) {
    const rawName = nameMatch[1].replace(/hai|is|and|email|phone|city/gi, "").trim();
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

  return extracted;
}

async function saveToStorage(extracted) {
  const stored = await chrome.storage.local.get("aegisProfile");
  const profile = stored.aegisProfile || {};
  for (const [k, v] of Object.entries(extracted)) {
    profile[k] = { value: v, updatedAt: Date.now() };
  }
  await chrome.storage.local.set({ aegisProfile: profile });
}

function initSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    transcriptBox.textContent = "Speech Recognition API not supported in this browser.";
    return null;
  }

  const rec = new SpeechRecognition();
  rec.continuous = true;
  rec.interimResults = true;

  rec.onstart = () => {
    isRecording = true;
    micBtn.classList.add("recording");
    micBtn.textContent = "🛑";
    transcriptBox.textContent = "Listening... Speak your details clearly.";
  };

  rec.onresult = async (e) => {
    let transcript = "";
    for (let i = e.resultIndex; i < e.results.length; ++i) {
      transcript += e.results[i][0].transcript;
    }
    transcriptBox.textContent = `"${transcript}"`;

    const extracted = extractProfileFromText(transcript);
    const keysFound = Object.keys(extracted);

    if (keysFound.length > 0) {
      await saveToStorage(extracted);
      extractedBox.style.display = "block";
      extractedTags.innerHTML = "";
      for (const [k, v] of Object.entries(extracted)) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = `${labelFor(k)}: ${v}`;
        extractedTags.appendChild(tag);
      }
    }
  };

  rec.onerror = (e) => {
    isRecording = false;
    micBtn.classList.remove("recording");
    micBtn.textContent = "🎙️";
    transcriptBox.textContent = `Speech error: ${e.error}. Please check microphone permissions.`;
  };

  rec.onend = () => {
    isRecording = false;
    micBtn.classList.remove("recording");
    micBtn.textContent = "🎙️";
  };

  return rec;
}

micBtn.addEventListener("click", async () => {
  if (isRecording) {
    recognition?.stop();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  } catch (err) {
    transcriptBox.textContent = `Microphone access denied: ${err.message}. Please allow microphone access in Chrome address bar.`;
    return;
  }

  if (!recognition) {
    recognition = initSpeech();
  }

  if (recognition) {
    recognition.lang = langSelect.value || "en-US";
    try {
      recognition.start();
    } catch {
      recognition.stop();
    }
  }
});

closeBtn.addEventListener("click", () => {
  window.close();
});
