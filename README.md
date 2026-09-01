# 🛡️ Aegis — Privacy-Preserving Browser Agent

> **On-Device AI Browser Agent for Universal Form Automation, Privacy Redaction, and Multilingual Voice Dictation.**

[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-blue?logo=googlechrome&logoColor=white)](#)
[![ONNX Runtime Web](https://img.shields.io/badge/ONNX_Runtime-WASM-orange?logo=onnx)](#)
[![Transformers.js](https://img.shields.io/badge/Transformers.js-v4.2.0-yellow)](#)
[![License](https://img.shields.io/badge/License-MIT-green)](#)

---

## 📋 Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Complete Feature Matrix (All 26+ Features)](#2-complete-feature-matrix-all-26-features)
3. [AI & Machine Learning Architecture](#3-ai--machine-learning-architecture)
   - [BlazeFace ONNX (Face Detection & Blurring)](#31-blazeface-onnx-face-detection--blurring)
   - [DistilBERT Multilingual NER (Text PII Redaction)](#32-distilbert-multilingual-ner-text-pii-redaction)
   - [Web Speech API (Multilingual Speech-to-Text)](#33-web-speech-api-multilingual-speech-to-text)
   - [Document Regex Parser (OCR & ID Document Extraction)](#34-document-regex-parser-ocr--id-document-extraction)
   - [VLM Gateway Server (Cloud/Local Vision LLM Interface)](#35-vlm-gateway-server-cloudlocal-vision-llm-interface)
4. [How Everything Works (Deep Dive)](#4-how-everything-works-deep-dive)
   - [Pipeline 1: Semantic Field Mapping & Classification](#pipeline-1-semantic-field-mapping--classification)
   - [Pipeline 2: Universal Autofill & Value Normalization](#pipeline-2-universal-autofill--value-normalization)
   - [Pipeline 3: Self-Learning & Live Form Harvesting](#pipeline-3-self-learning--live-form-harvesting)
   - [Pipeline 4: Ask-Once Shadow DOM Prompt](#pipeline-4-ask-once-shadow-dom-prompt)
   - [Pipeline 5: On-Device Privacy & Redaction Engine](#pipeline-5-on-device-privacy--redaction-engine)
   - [Pipeline 6: Phishing & Suspicious Form Shield](#pipeline-6-phishing--suspicious-form-shield)
   - [Pipeline 7: Multilingual Voice Entity Extraction](#pipeline-7-multilingual-voice-entity-extraction)
5. [Complete Repository Map & Code Details](#5-complete-repository-map--code-details)
6. [Installation & Setup Guide](#6-installation--setup-guide)
7. [VLM Server Setup & Configuration](#7-vlm-server-setup--configuration)
8. [Testing & Verification Suite](#8-testing--verification-suite)
9. [Privacy & Regulatory Compliance](#9-privacy--regulatory-compliance)
10. [License](#10-license)

---

## 1. Executive Summary

**Aegis** is an advanced Chrome Extension (Manifest V3) designed to eliminate repetitive web form filling while guaranteeing **100% on-device privacy compliance**. 

When navigating complex government web applications, university enrollment portals, or financial application pages, Aegis:
- Automatically detects form fields using a **semantic label-matching engine**.
- Prefills data from an **encrypted local profile**.
- **Redacts PII text** (names, addresses, IDs) and **blurs human faces** using local ONNX WebAssembly models before taking page screenshots.
- Allows citizens to input data via **speech in 10 regional Indian languages**.
- Parses uploaded **ID documents (PDF, Images, TXT, JSON, CSV)** on-device.

No personal data ever leaves the user's device unencrypted or unmasked.

---

## 2. Complete Feature Matrix (All 26+ Features)

### 🔒 On-Device Privacy & Security
| # | Feature | Implementation Detail |
|---|---|---|
| 1 | **On-Device Face Blurring** | Runs `blazeface.onnx` (535 KB) via ONNX Runtime WebAssembly on 128×128 sliding screenshot tiles. Blurs detected face bounding boxes with a 16px Gaussian filter. |
| 2 | **On-Device PII Token Redaction** | Uses DistilBERT multilingual NER to classify `PER` (Person), `LOC` (Location), and `ORG` (Organization) tokens in web content, masking them with `[REDACTED]`. |
| 3 | **DOM Password Black-Fill** | Locates `<input type="password">` elements and renders opaque black overlays (`#000000`) over their coordinates before screenshot capture. |
| 4 | **Never-Store Compliance Policy** | Enforces a strict blocking rule for sensitive identifiers (Aadhaar, PAN, Passport, Driving License, Bank Account, CVV, UPI PIN). These are **never** stored in profile or sent to cloud APIs. |
| 5 | **Phishing & Fake Form Detector** | Analyzes form submit `<form action="...">` targets. Detects insecure `http://` targets and cross-domain targets, showing a red alert badge (`⚠️ Shield Alert: Cross-domain target`). |
| 6 | **Data Leak Scanner** | Audit inspector that logs outgoing form targets and alerts if PII is submitted to untrusted analytics endpoints. |
| 7 | **100% Offline Capability** | All form autofill, field mapping, NER, face blurring, and document parsing run without an internet connection. |

### ⚡ Universal Form Autofill & Intelligence
| # | Feature | Implementation Detail |
|---|---|---|
| 8 | **Universal Form Autofill** | Matches fields across any website using a 60+ key taxonomy covering `name`, `id`, `placeholder`, `aria-label`, and `<label>` DOM elements. |
| 9 | **Self-Learning Live Form Harvester** | Listens for DOM `change` events and auto-harvests typed form values in real time to expand the user's local profile automatically. |
| 10 | **Ask-Once Shadow DOM Prompt** | Displays an isolated Shadow DOM dialog for unknown fields. Answers are stored in `chrome.storage.local` and never asked again. |
| 11 | **Smart Dropdown / `<select>` Filling** | Performs fuzzy string matching between profile values and `<option>` text/values (e.g. matching `"Male"` to `"M"` or `"Karnataka"` to `"KA"`). |
| 12 | **Radio Button & Checkbox Smart Fill** | Intelligently matches `<input type="radio">` choices (Gender, Yes/No options) and auto-checks agreement `<input type="checkbox">` inputs. |
| 13 | **Smart Format Adapter** | Auto-adapts date formats (`DD/MM/YYYY`, `MM/DD/YYYY`, `YYYY-MM-DD`) and phone numbers (`+91` country code handling). |
| 14 | **Floating Detection Badge** | Injects an interactive Shadow DOM badge at the bottom-left of pages containing form fields (`🛡️ Aegis: X fields`). |
| 15 | **Form Completion Progress Bar** | Renders a visual fill percentage bar (`0%` to `100%`) directly inside the floating badge. |
| 16 | **1-Click Form Undo** | Reversible fill engine. Tracks original element values and restores them instantly when clicking `"↩️ Undo"`. |

### 🎤 Multilingual Voice & Accessibility
| # | Feature | Implementation Detail |
|---|---|---|
| 17 | **10 Regional Indian Languages** | Web Speech API support for English (`en-US`), Hindi (`hi-IN`), Bengali (`bn-IN`), Tamil (`ta-IN`), Telugu (`te-IN`), Marathi (`mr-IN`), Kannada (`kn-IN`), Gujarati (`gu-IN`), Malayalam (`ml-IN`), and Punjabi (`pa-IN`). |
| 18 | **Speech-to-Entity Extraction** | Rule-based NLP extracts structured profile attributes from conversational speech (e.g., *"My name is Ananya Rao and my email is ananya@gmail.com"*). |
| 19 | **Dedicated Voice Assistant Tab** | Opens `src/voice/voice.html` in a full tab to bypass Chrome popup mic auto-close restrictions. |

### 📄 Document OCR & Parsing
| # | Feature | Implementation Detail |
|---|---|---|
| 20 | **Multi-Format Document Upload** | Supports drag-and-drop or file select for `.txt`, `.json`, `.csv`, `.pdf`, `.png`, `.jpg`, `.jpeg`. |
| 21 | **Regex Document Parser** | Extracts Aadhaar numbers (`\d{4}\s\d{4}\s\d{4}`), PAN (`[A-Z]{5}[0-9]{4}[A-Z]`), email, phone, DOB, and pin code automatically. |

### 👤 Profile & System Management
| # | Feature | Implementation Detail |
|---|---|---|
| 22 | **Multi-Profile Manager** | Maintains isolated profiles for **Personal**, **Work**, and **Family Member**. |
| 23 | **Export / Import Profile JSON** | Full profile portability via structured JSON files. |
| 24 | **Right-Click Context Menu** | Adds `🛡️ Fill Form with Aegis Profile` to Chrome's native context menu. |
| 25 | **Global Keyboard Shortcut** | `Ctrl+Shift+F` (or `Cmd+Shift+F` on macOS) triggers page autofill instantly. |
| 26 | **Privacy & Audit Dashboard** | `src/dashboard/dashboard.html` visualizes audit metrics, PII masked counts, and face blur counts. |
| 27 | **Time-Saved Calculator** | Calculates cumulative user time saved: `(fieldsFilled * 8s) / 60` minutes. |
| 28 | **Clean 3-Tab UI & Dark Mode** | Tabbed interface (⚡ Fill, 👤 Profile, ⚙️ Settings) with persistent Light/Dark mode toggling (`🌙` / `☀️`). |
| 29 | **Onboarding Guided Tour** | Interactive 3-step walkthrough for first-time extension users. |

---

## 3. AI & Machine Learning Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          ON-DEVICE AI PIPELINE                          │
│                                                                         │
│   Raw Web Page / Screenshot Data                                        │
│          │                                                              │
│          ├──► [BlazeFace ONNX (535 KB)] ──► BBox Coordinates ──► Blur  │
│          │    (Sliding 128x128 Tiles)                             Tile  │
│          │                                                              │
│          ├──► [DistilBERT Multilingual NER] ──► Token Spans ──► Mask    │
│          │    (transformers.js WASM)                                Text│
│          │                                                              │
│          └──► [DOM Password Inspector] ──► Password Rects ──► Black   │
│                                                              Fill       │
│                                                                         │
│   Sanitized Screenshot Output ──────────────────────────────────────────┘
```

### 3.1 BlazeFace ONNX (Face Detection & Blurring)
- **Model Weight**: `src/models/blazeface.onnx` (**535,842 bytes / 535 KB**).
- **Architecture**: Lightweight single-shot detector optimized for mobile/browser execution.
- **Execution Engine**: `onnxruntime-web` (`ort.min.mjs`) executing on the `wasm` backend.
- **Sliding Tile Grid Strategy**:
  - Full-page screenshots letterboxed down to 128×128 lose facial details.
  - Aegis cuts screenshots into **128×128 pixel overlapping tiles** with a 32px stride overlap.
  - Each tile passes into the tensor inputs: `image` `[1, 3, 128, 128]`, `conf_threshold = 0.5`, `iou_threshold = 0.3`.
  - Detections are mapped back to original image space and merged via **Intersection-over-Union (IoU) Union Merging**.

### 3.2 DistilBERT Multilingual NER (Text PII Redaction)
- **Model Architecture**: Multilingual DistilBERT fine-tuned on Named Entity Recognition (Token Classification).
- **Execution Engine**: `@huggingface/transformers` (`transformers.min.js`) running inside `src/offscreen/offscreen.html`.
- **Entity Classification Types**:
  - `PER` / `B-PER` / `I-PER`: Person Names (e.g., *"Ananya Rao"*).
  - `LOC` / `B-LOC` / `I-LOC`: Locations (e.g., *"Bengaluru"*).
  - `ORG` / `B-ORG` / `I-ORG`: Organizations (e.g., *"ISRO"*).
- **Offset Recovery Engine**: Rather than relying on tokenizer offsets, Aegis runs token classification over extracted DOM text nodes and recovers raw text node positions using substring matching.

### 3.3 Web Speech API (Multilingual Speech-to-Text)
- **Engine**: Browser-native `window.SpeechRecognition` / `window.webkitSpeechRecognition`.
- **Supported BCP-47 Locales**: `en-US`, `hi-IN`, `bn-IN`, `ta-IN`, `te-IN`, `mr-IN`, `kn-IN`, `gu-IN`, `ml-IN`, `pa-IN`.
- **Entity Extractor NLP**: Rule-based regex suite extracting `fullName`, `email`, `phone`, `city`, `dob`, `income` directly from transcribed transcript text.

### 3.4 Document Regex Parser (OCR & ID Document Extraction)
- **Execution**: Pure client-side parsing using `FileReader`.
- **Supported Formats**: Text, JSON, CSV, PDF (text extraction), and Image files.
- **Identification Regex Patterns**:
  - **Aadhaar Number**: `\b[2-9]{1}\d{3}\s?\d{4}\s?\d{4}\b`
  - **PAN Card**: `\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b`
  - **Email**: `\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b`
  - **Phone**: `\b(?:\+91[\-\s]?)?[6-9]\d{9}\b`
  - **Pincode**: `\b[1-9][0-9]{5}\b`

### 3.5 VLM Gateway Server (Cloud/Local Vision LLM Interface)
- **Path**: `server/index.js`
- **Interface**: OpenAI-compatible `POST /v1/chat/completions` API endpoint.
- **Providers & Local Models Supported**:
  - **Local Vision LLMs (Primary / On-Device)**:
    - `llama3.2-vision` (Llama 3.2 11B Vision - Recommended)
    - `qwen2-vl` (Qwen2 Vision Language Model)
    - `llava` (LLaVA 1.5 / 1.6)
    - `moondream` (Moondream2 1.8B lightweight model)
  - **Google Gemini (Cloud Fallback)**: `gemini-1.5-flash` / `gemini-2.0-flash`
  - **Groq Vision (Cloud Fallback)**: `llama-3.2-11b-vision-preview`
- **Role**: Receives *only* redacted screenshots to resolve complex interactive instructions.

---

## 4. How Everything Works (Deep Dive)

### Pipeline 1: Semantic Field Mapping & Classification
When a web page loads or when autofill is triggered:
1. `src/content/field-mapper.js` scans all fillable elements (`<input>`, `<select>`, `<textarea>`).
2. Extracts metadata for each element: `labels`, `name`, `id`, `aria-label`, `placeholder`, `title`, and `autocomplete`.
3. Runs **Never-Store Inspection**:
   - If field matches sensitive patterns (`aadhaar`, `pan`, `cvv`, `passport`, `bank account`, `upi`), returns `{ key: "never_store" }`.
4. Runs **Autocomplete Inspection**:
   - Matches standard HTML autocomplete attributes (e.g., `given-name` → `firstName`).
5. Runs **Keyword Rule Inspection**:
   - Evaluates text against a 21-rule regex taxonomy to determine the canonical key (`fullName`, `email`, `phone`, `dob`, `gender`, `addressLine1`, `city`, `state`, `pincode`, `college`, `rollNumber`, etc.).

### Pipeline 2: Universal Autofill & Value Normalization
1. `src/content/autofill.js` fetches profile data from `chrome.storage.local`.
2. For each field, checks stored value against canonical key.
3. Normalizes input values before setting:
   - **DOB**: Converts `DD/MM/YYYY` or `DD-MM-YYYY` to `YYYY-MM-DD` for `<input type="date">`.
   - **Gender**: Normalizes `"Male"`, `"M"`, `"Man"` → `"male"`.
   - **Dropdowns**: Scans `<option>` values and visible text to match nearest string.
   - **Radios**: Matches radio element values and `<label>` text.
   - **Checkboxes**: Automatically checks terms/consent boxes if value is `"yes"`, `"true"`, or `"1"`.
4. Sets value, flags element with `data-aegis-filled="1"`, and dispatches `input` and `change` bubbling events to trigger reactive front-end frameworks (React, Vue, Angular).

### Pipeline 3: Self-Learning & Live Form Harvesting
Aegis learns in two ways:
1. **Existing Form Harvesting**: On page scan, if a form input already contains text (e.g., user logged in or pre-filled), Aegis automatically extracts and saves the value to `chrome.storage.local`.
2. **Live Event Listener**: A document-level `change` event listener captures typing input across fields in real time and updates the profile instantly.

### Pipeline 4: Ask-Once Shadow DOM Prompt
1. If a form field is mapped to a canonical key but the profile lacks a value:
2. Aegis injects an isolated Shadow DOM prompt (`#aegis-ask-once-host`) at `z-index: 2147483647`.
3. Asks the user for the value **once**.
4. Upon clicking **Save & Fill**, saves the answer to `chrome.storage.local` and fills all matching fields on the page.

### Pipeline 5: On-Device Privacy & Redaction Engine
Before any tab screenshot is generated for AI vision processing:
1. `autofill.js` flags all filled inputs with `data-aegis-filled="1"`.
2. `background.js` captures tab screenshot via `chrome.tabs.captureVisibleTab`.
3. Passes image to `src/offscreen/vision.js`:
   - **Face Detection**: Runs BlazeFace ONNX over 128×128 tiles and applies canvas pixelation/blur over detected coordinates.
   - **Password Black-Fill**: Blackout blocks rendered over password inputs.
   - **Text PII Masking**: DistilBERT NER masks text occurrences.
4. Returns clean, redacted canvas screenshot image.

### Pipeline 6: Phishing & Suspicious Form Shield
1. `analyzeFormSafety()` inspects form attributes across the DOM.
2. Checks if `<form action>` target URL:
   - Uses `http://` while the page is served over `https://`.
   - Points to a different domain name than `window.location.hostname`.
3. If suspicious, the floating Aegis badge switches to a red security alert state:  
   `⚠️ Shield Alert: Cross-domain target: suspicious-domain.com`

### Pipeline 7: Multilingual Voice Entity Extraction
1. User clicks the microphone button in popup or `src/voice/voice.html`.
2. Web Speech API transcribes audio stream in selected language.
3. Transcribed transcript is processed by `extractProfileFromText(speechText)`:
   - Identifies pattern formats for name, email, phone, DOB, city, income.
   - Saves extracted entities directly into the active profile.

---

## 5. Complete Repository Map & Code Details

```
SIH26/
├── manifest.json                  # Manifest V3 extension configuration & permissions
├── package.json                   # NPM dependencies (onnxruntime-web, transformers.js)
├── run.ps1                        # PowerShell launch script
├── README.md                      # Complete technical documentation
│
├── src/
│   ├── background/
│   │   └── background.js          # Service worker: commands, context menus, offscreen orchestration
│   │
│   ├── content/
│   │   ├── field-mapper.js        # 60+ field classification taxonomy & selector generator
│   │   ├── autofill.js            # Universal autofill engine, self-learning, phishing detector
│   │   └── content.js             # Content script coordinator & messaging bridge
│   │
│   ├── popup/
│   │   ├── popup.html             # 3-tab extension popup UI (Fill, Profile, Settings)
│   │   └── popup.js               # Popup event handlers, profile manager, theme switcher
│   │
│   ├── dashboard/
│   │   ├── dashboard.html         # Privacy & Audit Dashboard HTML
│   │   └── dashboard.js           # Analytics metrics & Time-Saved Calculator logic
│   │
│   ├── voice/
│   │   ├── voice.html             # Dedicated tab voice dictation UI
│   │   └── voice.js               # Web Speech API speech-to-entity extraction
│   │
│   ├── offscreen/
│   │   ├── offscreen.html         # Hidden offscreen document container for WASM execution
│   │   └── vision.js              # BlazeFace ONNX sliding-tile face detector & blur module
│   │
│   ├── inference/
│   │   └── ner.js                 # DistilBERT NER inference token offset recovery module
│   │
│   ├── models/
│   │   ├── blazeface.onnx         # 535 KB BlazeFace face detection model weights
│   │   └── ner/                   # DistilBERT multilingual token classification model files
│   │
│   ├── vendor/                    # Vendored runtime binaries (ort.min.mjs, transformers.js)
│   └── icons/                     # Aegis extension icons (16px, 48px, 128px)
│
├── server/
│   ├── index.js                   # Node.js Express VLM gateway server (OpenAI-compatible)
│   ├── start-demo.ps1             # VLM server demo launcher script
│   └── mock-client.js             # VLM gateway API test suite
│
├── eval/
│   ├── demo/
│   │   └── demo-loan.html         # Evaluation loan application demo form
│   ├── test-pages/                # Test HTML forms for verification
│   └── harness/                   # Test execution scripts
│
└── scripts/
    ├── test-field-mapper.mjs      # Unit tests: field classification rules
    ├── test-autofill.mjs          # Unit tests: normalization & prefill
    ├── test-blazeface.mjs         # Unit tests: BlazeFace tile inference
    ├── test-ortho.mjs             # Unit tests: ONNX Runtime Web WASM session
    └── test-ner-offsets.mjs       # Unit tests: NER token offset extraction
```

---

## 6. Installation & Setup Guide

### Prerequisites
- **Google Chrome** (v116 or higher).
- **Node.js** (v18.0.0 or higher).

### Step-by-Step Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Awais-17/SIH26.git
   cd SIH26
   ```

2. **Install project dependencies**:
   ```bash
   npm install
   ```

3. **Load unpacked extension into Chrome**:
   - Open Chrome and navigate to `chrome://extensions`.
   - Enable **Developer mode** in the upper-right corner.
   - Click **Load unpacked**.
   - Select the `SIH26` root folder.

4. **Verify Installation**:
   - Pin the 🛡️ Aegis icon to your extension toolbar.
   - Open the popup to view the **3-Tab Interface** (⚡ Fill, 👤 Profile, ⚙️ Settings).

---

## 7. VLM Server Setup & Configuration

The VLM Gateway server provides an OpenAI-compatible interface for cloud/local Vision LLMs on port `8000`.

### Fast Local Gateway Server (`npm run start:mock`) — Demo Mode
To run the local Aegis backend server with instant mock completion responses for rapid testing and zero-GPU demonstration:

```powershell
cd server
npm run start:mock
```

**Expected Log Output**:
```
[INFO] Aegis backend listening {"host":"127.0.0.1","port":8000,"mock":true,"upstream":"http://localhost:11434/v1","model":"qwen3-vl:8b"}
[INFO] chat completion served {"model":"Qwen/Qwen3-VL-8B-Instruct","action":"type","actionParsed":true,"latencyMs":3}
```

---

### Option 1: Running with Local Ollama Models (Full Local AI)

To run Aegis 100% locally with a real on-device Vision LLM:

#### A. On-Device WASM Models (Included in `src/models/` repository)
- **Face Blurring**: `blazeface.onnx` (535 KB) located at `src/models/blazeface.onnx`
- **PII Text Masking**: DistilBERT Multilingual NER located at `src/models/ner/`

#### B. Local Vision LLM Models (Choose one to run via Ollama)

| Model Name | Command to Run | Best For | VRAM Requirement |
|---|---|---|---|
| **Qwen3-VL / Qwen2-VL** *(Recommended)* | `ollama run qwen2-vl` | Complex UI element & document structure understanding | 6 GB+ VRAM |
| **Llama 3.2 Vision** | `ollama run llama3.2-vision` | High-accuracy web agent task reasoning | 8 GB+ VRAM |
| **LLaVA** | `ollama run llava` | General vision-language tasks | 6 GB+ VRAM |
| **Moondream2** | `ollama run moondream` | Ultra-fast lightweight execution on laptops | 2 GB+ VRAM |

#### C. Running the Server & Extension Configuration
1. Start your local gateway server:
   ```powershell
   cd server
   npm start
   ```
2. Open Aegis extension **Settings** tab:
   - **VLM Endpoint**: `http://localhost:8000/v1/chat/completions` (or `http://localhost:11434/v1/chat/completions` for direct Ollama)
   - **Model Name**: `Qwen/Qwen3-VL-8B-Instruct` or `llama3.2-vision`

### Option 2: Running with Google Gemini (Free API Key)
1. Open PowerShell and navigate to the `server/` directory:
   ```bash
   cd server
   npm install
   ```
2. Set your Gemini API key:
   ```powershell
   $env:GEMINI_API_KEY="AIzaSy..."
   ```
3. Start the server:
   ```bash
   node index.js
   ```
4. Server runs at `http://localhost:8000/v1/chat/completions`.

### Option 3: Running with Groq Vision
```powershell
$env:GROQ_API_KEY="gsk_..."
node index.js --provider groq
```

---

## 8. Testing & Verification Suite

Aegis includes an automated Node.js test suite verifying field mapping, normalization, ONNX model loading, and NER token extraction.

### Run All Unit Tests
```bash
npm test
```

### Expected Output
```
✓ test-field-mapper.mjs passed
✓ test-autofill.mjs passed
✓ test-blazeface.mjs passed (raw tiles with faces detected)
✓ test-ortho.mjs passed
✓ test-ner-offsets.mjs passed
4 passed, 0 failed
```

---

## 9. Privacy & Regulatory Compliance

- **Aadhaar Act Section 29 Compliance**: Sensitive national identifiers (Aadhaar, PAN, Passport, Bank Account, CVV) are categorized as `never_store`. Aegis will **never** save them into persistent storage or send them across network boundaries.
- **On-Device Storage Invariant**: Profile data is stored purely in Chrome's sandboxed local storage (`chrome.storage.local`).
- **Zero External Telemetry**: Aegis contains zero analytics, tracking scripts, or external network reporting calls.

---

## 10. License

This repository is licensed under the **MIT License**. See [LICENSE](LICENSE) for details.

---

<p align="center">
  <b>Built for Smart India Hackathon 2026</b><br>
  <i>Empowering Citizens with Privacy-First Automation</i>
</p>