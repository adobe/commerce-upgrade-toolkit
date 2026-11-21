#!/usr/bin/env node
// Usage: node .claude/scripts/html-to-pdf.mjs <input.html> <output.pdf>
// Renders a print-styled HTML file to PDF with headless Chromium/Chrome/Edge.
// Honours CSS @page rules (size, margins, running header/footer, page counters).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: html-to-pdf.mjs <input.html> <output.pdf>');
  process.exit(2);
}
if (!existsSync(input)) {
  console.error(`Input not found: ${input}`);
  process.exit(2);
}

function playwrightChromium() {
  const root = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(root)) return [];
  const rels = ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-headless-shell-linux64/chrome-headless-shell'];
  return readdirSync(root)
    .filter((d) => d.startsWith('chromium'))
    .flatMap((d) => rels.map((r) => join(root, d, r)));
}

const candidates = [
  process.env.CHROME_BIN,
  ...playwrightChromium(),
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

const browser = candidates.find((p) => existsSync(p) && statSync(p).isFile());
if (!browser) {
  console.error('No Chromium/Chrome/Edge found. Set CHROME_BIN or run: npx playwright install chromium');
  process.exit(3);
}

const out = resolve(output);
mkdirSync(dirname(out), { recursive: true });

try {
  execFileSync(
    browser,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--no-pdf-header-footer',
      '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=5000',
      `--print-to-pdf=${out}`,
      pathToFileURL(resolve(input)).href,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], timeout: 120000 },
  );
} catch (e) {
  console.error(`PDF render failed: ${e.message}`);
  process.exit(4);
}

if (!existsSync(out) || statSync(out).size === 0) {
  console.error('PDF was not produced.');
  process.exit(4);
}
console.log(`PDF written to ${output}`);
