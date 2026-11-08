/// <reference lib="dom" />
/**
 * Capture landing-page screenshots for the README using the locally installed Chrome
 * (puppeteer-core: no browser download).
 *
 *   bun run build:web && bun run screenshots
 *
 * CHROME_PATH overrides the browser binary. Output: docs/screenshots/*.png
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "docs", "screenshots");
const PORT = 3100;
const URL = `http://localhost:${PORT}`;
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

mkdirSync(OUT, { recursive: true });
const server = spawn("bunx", ["next", "start", "--port", String(PORT)], {
  cwd: join(ROOT, "apps", "web"),
  stdio: "ignore",
});

try {
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(URL)).ok) break;
    } catch {}
    if (i > 60) throw new Error("web server did not start (run `bun run build:web` first)");
    await Bun.sleep(500);
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--hide-scrollbars"],
  });
  const shot = async (
    name: string,
    width: number,
    height: number,
    scale: number,
    opts: { fullPage?: boolean; hash?: string } = {},
  ) => {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: scale });
    // Load without a #hash: the page's smooth scrolling would race the manual scroll below.
    await page.goto(URL, { waitUntil: "networkidle0" });
    await page.addStyleTag({ content: "html { scroll-behavior: auto !important; }" });
    await page.evaluate(() => document.fonts.ready);
    if (opts.hash) {
      // Align the section's eyebrow just under the sticky nav.
      await page.evaluate((id) => {
        const el = document.getElementById(id)?.querySelector("p");
        if (el)
          window.scrollTo({
            top: el.getBoundingClientRect().top + window.scrollY - 104,
            behavior: "instant",
          });
      }, opts.hash);
      await Bun.sleep(500);
    }
    const path = join(OUT, `${name}.png`) as `${string}.png`;
    await page.screenshot({ path, fullPage: opts.fullPage ?? false });
    await page.close();
    console.log(`saved ${path}`);
  };

  await shot("landing-hero", 1440, 900, 2);
  await shot("landing-full", 1440, 900, 1, { fullPage: true });
  await shot("landing-builders", 1440, 1000, 2, { hash: "builders" });
  await shot("landing-devnet", 1440, 820, 2, { hash: "devnet" });
  await shot("landing-mobile", 390, 844, 3);
  await browser.close();
} finally {
  server.kill();
}
process.exit(0);
