import { chromium } from "/Users/samuelzhu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pitchDir = path.resolve(scriptDir, "..");
const outputDir = path.join(pitchDir, "qa");

await mkdir(outputDir, { recursive: true });

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
    const filePath = path.resolve(pitchDir, relativePath);
    if (!filePath.startsWith(`${pitchDir}${path.sep}`)) throw new Error("Invalid path");
    const body = await readFile(filePath);
    response.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(`console: ${message.text()}`);
  });
  await page.route(/^https?:/, (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.__playSlide === "function" && document.body.classList.contains("motion-ready"));
  await page.waitForTimeout(750);

  const runtime = await page.evaluate(() => ({
    slides: document.querySelectorAll("section.slide").length,
    dots: document.querySelectorAll("#nav .dot").length,
    lowPower: window.__lowPowerMode,
  }));
  if (runtime.slides !== 9 || runtime.dots !== 9 || runtime.lowPower) {
    throw new Error(`Unexpected runtime state: ${JSON.stringify(runtime)}`);
  }

  await page.keyboard.press("Escape");
  if (await page.locator("#overview").evaluate((element) => getComputedStyle(element).display) !== "block") {
    throw new Error("Overview did not open with Escape");
  }
  await page.keyboard.press("Escape");
  await page.keyboard.press("End");
  await page.waitForTimeout(750);
  if (await page.evaluate(() => window.__currentSlideIndex) !== 8) {
    throw new Error("End key did not navigate to the final slide");
  }

  await page.evaluate(() => window.go(2));
  await page.waitForTimeout(750);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(550);
  const pipelineState = await page.evaluate(() => ({
    index: window.__currentSlideIndex,
    firstStepOpacity: Number.parseFloat(getComputedStyle(document.querySelector('#deck > section.slide[data-animate="pipeline"] [data-anim="step"]')).opacity),
  }));
  if (pipelineState.index !== 2 || pipelineState.firstStepOpacity < 0.9) {
    throw new Error(`Pipeline did not advance in place: ${JSON.stringify(pipelineState)}`);
  }
  for (let step = 0; step < 3; step += 1) await page.keyboard.press("ArrowRight");
  if (await page.evaluate(() => window.__currentSlideIndex) !== 2) {
    throw new Error("Pipeline advanced the slide before all four steps were revealed");
  }
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(750);
  if (await page.evaluate(() => window.__currentSlideIndex) !== 3) {
    throw new Error("Pipeline did not advance after the final step");
  }

  await page.evaluate(() => window.go(0));
  await page.waitForTimeout(750);

  await page.evaluate(() => window.__setLowPowerMode?.(true, { persist: false }));
  await page.waitForTimeout(250);

  const slideCount = await page.locator("#deck > section.slide").count();
  for (let index = 0; index < slideCount; index += 1) {
    await page.evaluate((target) => window.go(target), index);
    await page.waitForTimeout(1_050);
    await page.screenshot({
      path: path.join(outputDir, `page-${String(index + 1).padStart(2, "0")}.png`),
      fullPage: false,
    });
  }

  if (pageErrors.length > 0) {
    throw new Error(`Browser errors detected:\n${pageErrors.join("\n")}`);
  }

  console.log(`Rendered ${slideCount} slides to ${outputDir}`);
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
