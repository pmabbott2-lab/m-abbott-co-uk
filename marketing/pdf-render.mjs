import { access } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = resolve(repoRoot, ".puppeteer-cache");
process.env.PUPPETEER_CACHE_DIR = cacheDir;

const puppeteer = (await import("puppeteer")).default;

async function resolveChromePath() {
  try {
    const configured = puppeteer.executablePath();
    if (configured) {
      await access(configured);
      return configured;
    }
  } catch {
    // fall through to cache scan
  }

  const chromeRoot = join(cacheDir, "chrome");
  const versions = await readdir(chromeRoot);
  for (const version of versions.sort().reverse()) {
    const candidate = join(
      chromeRoot,
      version,
      "chrome-mac-x64",
      "Google Chrome for Testing.app",
      "Contents",
      "MacOS",
      "Google Chrome for Testing",
    );
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next version
    }
  }

  throw new Error(
    `Chrome not found. Run: PUPPETEER_CACHE_DIR=${cacheDir} npx puppeteer browsers install chrome`,
  );
}

export async function launchBrowser() {
  const executablePath = await resolveChromePath();
  return puppeteer.launch({
    headless: true,
    executablePath,
    timeout: 120_000,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"],
  });
}

export async function renderHtmlToPdf(browser, htmlPath, pdfPath) {
  const page = await browser.newPage();
  page.setDefaultTimeout(120_000);
  await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
  await page.goto(`file://${htmlPath}`, { waitUntil: "load", timeout: 120_000 });
  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  await page.close();
  return pdfPath;
}
