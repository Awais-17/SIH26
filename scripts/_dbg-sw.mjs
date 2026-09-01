import puppeteer from "puppeteer-core";
import { resolve } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
const root = resolve(".");
const profile = mkdtempSync(tmpdir() + "\\aegis-proto-");
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: false,
  userDataDir: profile,
  args: [
    `--disable-extensions-except=${root}`,
    `--load-extension=${root}`,
    "--window-size=1400,900",
  ],
  ignoreDefaultArgs: ["--disable-extensions", "--disable-component-extensions-with-background-pages"],
});
const page = await browser.newPage();
await page.goto("chrome://extensions/", { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 4000));
const items = await page.evaluate(() => {
  const walk = (rootEl, out) => {
    for (const el of rootEl.querySelectorAll("*")) {
      if (el.shadowRoot) walk(el.shadowRoot, out);
      if (el.tagName && el.tagName.toLowerCase().includes("extensions-")) {
        out.push({ tag: el.tagName, attrs: [...el.attributes].map((a) => a.name + "=" + (a.value || "")).join(" ") });
      }
    }
  };
  const out = [];
  walk(document.body, out);
  return out;
});
console.log(JSON.stringify(items, null, 1));
await browser.close();