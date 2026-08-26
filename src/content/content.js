// Content Script — Injected into every active tab. Handles DOM interaction.

(() => {
  "use strict";

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

  function scanDOMForSensitiveFields() {
    const fields = [];

    // Password inputs
    document.querySelectorAll('input[type="password"]').forEach((el) => {
      const rect = el.getBoundingClientRect();
      fields.push({
        selector: buildSelector(el),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        reason: "type=password",
        type: "password_input",
        label: el.labels?.[0]?.textContent?.trim() || el.placeholder || "",
      });
    });

    // Autocomplete-sensitive fields
    document.querySelectorAll("input[autocomplete]").forEach((el) => {
      const ac = el.autocomplete?.toLowerCase() || "";
      if (SENSITIVE_PASSWORD_AUTOCOMPLETE.some((k) => ac.includes(k))) {
        const rect = el.getBoundingClientRect();
        fields.push({
          selector: buildSelector(el),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          reason: `autocomplete="${el.autocomplete}"`,
          type: "sensitive_input",
          label: el.labels?.[0]?.textContent?.trim() || el.placeholder || "",
        });
      }
    });

    // Keyword-based detection on name, aria-label, data-testid, id
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
        // Avoid duplicates
        if (!fields.find((f) => f.selector === buildSelector(el))) {
          const rect = el.getBoundingClientRect();
          fields.push({
            selector: buildSelector(el),
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            reason: `keyword match in attributes`,
            type: "sensitive_input",
            label: el.labels?.[0]?.textContent?.trim() || el.placeholder || "",
          });
        }
      }
    });

    // Contenteditable divs with potential card numbers (16-digit sequences)
    document.querySelectorAll("[contenteditable]").forEach((el) => {
      const text = el.innerText || "";
      if (/\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/.test(text)) {
        const rect = el.getBoundingClientRect();
        fields.push({
          selector: buildSelector(el),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          reason: "potential card number in contenteditable",
          type: "contenteditable_pii",
          label: "",
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

  function buildSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
    if (el.className && typeof el.className === "string") {
      const cls = el.className.trim().split(/\s+/).map(CSS.escape).join(".");
      return `${el.tagName.toLowerCase()}.${cls}`;
    }
    // Fallback: path from root
    const path = [];
    let current = el;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector = `#${CSS.escape(current.id)}`;
        path.unshift(selector);
        break;
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c) => c.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${idx})`;
        }
      }
      path.unshift(selector);
      current = current.parentElement;
    }
    return path.join(" > ");
  }

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

  // ── Message Listener ────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "DOM_SCAN") {
      const fields = scanDOMForSensitiveFields();
      const visibleText = extractVisibleText();
      sendResponse({ fields, visibleText });
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

  console.log("[SIH26171] Content script loaded");
})();
