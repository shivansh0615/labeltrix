import { chromium } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "fs";

const edge =
  process.env["PROGRAMFILES(X86)"] +
  "\\Microsoft\\Edge\\Application\\msedge.exe";
const outDir =
  "C:/Users/001ra/OneDrive/Attachments/Desktop/FLIPKART APP/tmp-debug";
mkdirSync(outDir, { recursive: true });

const files = [
  "C:/Users/001ra/Downloads/Alpha Product label Details-EAN-8904297214510 (39).pdf",
  "C:/Users/001ra/Downloads/Alpha Product label Details-EAN-8904297214510 (33).pdf",
  "C:/Users/001ra/Downloads/FBF Product Label Details-EAN-8904297204214.pdf",
  "C:/Users/001ra/Downloads/final label.pdf",
];

const browser = await chromium.launch({ executablePath: edge, headless: true });

for (const file of files) {
  const name = file.split("/").pop().replace(/[^\w.-]+/g, "_");
  const page = await browser.newPage({
    viewport: { width: 288, height: 480 },
  });
  // Chromium can open PDFs; screenshot may be blank depending on viewer.
  // Use pdf.js via CDN to rasterize.
  const data = readFileSync(file);
  const b64 = data.toString("base64");
  await page.setContent(`<!doctype html><html><body style="margin:0">
<canvas id="c"></canvas>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const data = Uint8Array.from(atob('${b64}'), c => c.charCodeAt(0));
pdfjsLib.getDocument({data}).promise.then(async pdf => {
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.getElementById('c');
  canvas.width = viewport.width; canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  document.title = 'ready';
});
</script></body></html>`);
  await page.waitForFunction(() => document.title === "ready", null, {
    timeout: 60000,
  });
  const canvas = page.locator("#c");
  await canvas.screenshot({ path: `${outDir}/existing-${name}.png` });
  console.log("shot", name);
  await page.close();
}

await browser.close();
console.log("done");
