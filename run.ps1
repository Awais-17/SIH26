import puppeteer from "puppeteer-core";
import { resolve } from "path";
const root = resolve(".");
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  ignoreDefaultArgs: ["--disable-extensions", "--disable-component-extensions-with-background-pages"],
});
const t = await browser.waitForTarget((x) => x.type() === "service_worker", { timeout: 30000 });
const sw = await t.worker();
const info = await sw.evaluate(() => ({
  url: location.href,
  hasChrome: typeof chrome !== "undefined",
  chromeKeys: typeof chrome !== "undefined" ? Object.keys(chrome).sort() : [],
}));
console.log("SW:", JSON.stringify(info, null, 1));
await browser.close();
