// Content Script — Injected into every active tab. Handles DOM interaction.

(() => {
  "use strict";

  const { classifyField, buildSelector } = window.AegisFieldMapper || {};

  // ── DOM Field Scanner (FR-02) ──────────────────────────────────

  const SENSITIVE_PASSWORD_AUTOCOMPLETE = [
    "cc-number",
    "cc-exp",
    "cc-csc",
    "cc-name",
    "cc-type",
    "transaction-amount",
  ];

  const SENSITIVE_KEYWORDS = [
    "password",
    "pin",
    "secret",
    "ssn",
    "social-security",
    "credit",
    "card",
    "cvv",
    "csc",
  ];

  function rectOf(el) {
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }

  // Unified scan: sensitive fields (always redacted) + fillable form fields
  // (so the VLM knows the page structure and which fields are already filled).
  function scanFormFields() {
    const fields = [];
    const seen = new Set();

    function addField(el, type, reason, sensitive, extra = {}) {
      const selector = buildSelector(el);
      if (seen.has(selector)) return;
      seen.add(selector);
      fields.push({
        selector,
        rect: rectOf(el),
        reason,
        type,
        sensitive,
        filled: (el.value || "").trim().length > 0,
        label: el.labels?.[0]?.textContent?.trim() || el.placeholder || "",
        ...extra,
      });
    }

    // 1. Sensitive: password inputs
    document.querySelectorAll('input[type="password"]').forEach((el) => {
      addField(el, "password_input", "type=password", true);
    });

    // 2. Sensitive: credit-card / payment autocompletes
    document.querySelectorAll("input[autocomplete]").forEach((el) => {
      const ac = el.autocomplete?.toLowerCase() || "";
      if (SENSITIVE_PASSWORD_AUTOCOMPLETE.some((k) => ac.includes(k))) {
        addField(el, "sensitive_input", `autocomplete="${el.autocomplete}"`, true);
      }
    });

    // 3. Sensitive: keyword matches in attributes
    document.querySelectorAll("input").forEach((el) => {
      const attrs = [
        el.name,
        el.id,
        el.getAttribute("aria-label"),
        el.getAttribute("data-testid"),
        el.placeholder,
      ]
        .join(" ")
        .toLowerCase();

      if (SENSITIVE_KEYWORDS.some((k) => attrs.includes(k))) {
        addField(el, "sensitive_input", "keyword match in attributes", true);
      }
    });

    // 4. Sensitive: potential card number in contenteditable
    document.querySelectorAll("[contenteditable]").forEach((el) => {
      const text = el.innerText || "";
      if (/\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/.test(text)) {
        addField(el, "contenteditable_pii", "potential card number in contenteditable", true);
      }
    });

    // 5. All fillable fields classified by the profile field mapper.
    //    - profile-filled fields → sensitive (redact the value before transmit)
    //    - never_store fields (Aadhaar/PAN/etc) → sensitive, never saved or sent
    //    - other mappable fields → structure only (empty/filled flag, no value)
    document.querySelectorAll("input, select, textarea").forEach((el) => {
      const type = (el.type || "").toLowerCase();
      if (["hidden", "button", "submit", "reset", "image", "file", "checkbox", "radio", "range", "color"].includes(type)) return;
      if (el.disabled || el.readOnly) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (!classifyField) return;

      const classification = classifyField(el);

      if (el.dataset.aegisFilled === "1") {
        addField(el, "profile_filled", "prefilled from on-device profile", true, {
          profileKey: classification.key,
        });
        return;
      }
      if (classification.key === "never_store") {
        addField(el, "sensitive_input", "never-store identifier (ID number)", true);
        return;
      }
      if (classification.key) {
        addField(el, "profile_field", `profile key: ${classification.key}`, false, {
          profileKey: classification.key,
        });
      }
    });

    return fields;
  }

  // ── Visible Text Extractor (for NER) ───────────────────────────

  function extractVisibleText() {
    const texts = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const style = window.getComputedStyle(parent);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.opacity === "0"
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          const rect = parent.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return NodeFilter.FILTER_REJECT;
          if (rect.bottom < 0 || rect.top > window.innerHeight) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (text.length > 0) {
        const parent = node.parentElement;
        const rect = parent?.getBoundingClientRect();
        texts.push({
          text,
          rect: rect
            ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
            : null,
          tag: parent?.tagName?.toLowerCase(),
        });
      }
    }

    return texts;
  }

  // ── Helper: Build CSS Selector ──────────────────────────────────
  // Provided by field-mapper.js as window.AegisFieldMapper.buildSelector
  // (bound to local `buildSelector` at module top).

  // ── Action Executor ─────────────────────────────────────────────

  function executeClick(x, y) {
    const el = document.elementFromPoint(x, y);
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.click();
      return { ok: true, clicked: el.tagName };
    }
    return { error: `No element at (${x}, ${y})` };
  }

  function executeType(selector, value) {
    const el = document.querySelector(selector);
    if (!el) return { error: `Element not found: ${selector}` };
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, typed: value.length };
  }

  function executeScroll(direction) {
    const delta = direction === "up" ? -window.innerHeight : window.innerHeight;
    window.scrollBy({ top: delta, behavior: "smooth" });
    return { ok: true, scrolled: direction };
  }

  // ── PII sub-rect measurement (NER char offsets → viewport boxes) ─

  // The offscreen NER returns char offsets within each visible text node.
  // Only the DOM can convert those to precise boxes, via Range rects.
  function measurePiiRects(spans) {
    // Re-walk the DOM in the same order as extractVisibleText so node
    // indexes line up with what NER saw.
    const nodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const style = window.getComputedStyle(parent);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0"
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        const rect = parent.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return NodeFilter.FILTER_REJECT;
        if (rect.bottom < 0 || rect.top > window.innerHeight) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent.trim().length > 0) nodes.push(node);
    }

    const dpr = window.devicePixelRatio || 1;
    const results = [];

    for (const span of spans) {
      const textNode = nodes[span.nodeIndex];
      if (!textNode) continue;

      const nodeText = textNode.textContent;
      const start = nodeText.indexOf(
        span.text,
        typeof span.offsetHint === "number" ? span.offsetHint : 0
      );
      if (start === -1) {
        results.push({ nodeIndex: span.nodeIndex, rect: null });
        continue;
      }

      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + span.text.length);
      const rect = range.getBoundingClientRect();
      results.push({
        nodeIndex: span.nodeIndex,
        entity: span.entity,
        text: span.text,
        rect:
          rect.width > 0
            ? {
                // CSS px here; offscreen scales by dpr before masking
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              }
            : null,
      });
    }

    return { rects: results, dpr };
  }

  // ── Message Listener ────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "DOM_SCAN") {
      const fields = scanFormFields();
      const visibleText = extractVisibleText();
      sendResponse({ fields, visibleText, dpr: window.devicePixelRatio || 1 });
      return false;
    }

    if (msg.type === "MEASURE_PII_RECTS") {
      sendResponse(measurePiiRects(msg.spans || []));
      return false;
    }

    if (msg.type === "EXECUTE_CLICK") {
      sendResponse(executeClick(msg.x, msg.y));
      return false;
    }

    if (msg.type === "EXECUTE_TYPE") {
      sendResponse(executeType(msg.selector, msg.value));
      return false;
    }

    if (msg.type === "EXECUTE_SCROLL") {
      sendResponse(executeScroll(msg.direction));
      return false;
    }
  });

  console.log("[Aegis] Content script loaded");
})();
