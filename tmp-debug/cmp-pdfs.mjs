import { chromium } from "playwright-core";
import { readFileSync, mkdirSync } from "fs";

const edge =
  process.env["PROGRAMFILES(X86)"] +
  "\\Microsoft\\Edge\\Application\\msedge.exe";
const outDir =
  "C:/Users/001ra/OneDrive/Attachments/Desktop/FLIPKART APP/tmp-debug";
mkdirSync(outDir, { recursive: true });
const files = [
  ["40", "C:/Users/001ra/Downloads/Alpha Product label Details-EAN-8904297214510 (40).pdf"],
  ["38", "C:/Users/001ra/Downloads/Alpha Product label Details-EAN-8904297214510 (38).pdf"],
  ["42", "C:/Users/001ra/Downloads/Alpha Product label Details-EAN-8904297214510 (42).pdf"],
  ["39", "C:/Users/001ra/Downloads/Alpha Product label Details-EAN-8904297214510 (39).pdf"],
  ["32", "C:/Users/001ra/Downloads/Alpha Product label Details-EAN-8904297214510 (32).pdf"],
];

const browser = await chromium.launch({ executablePath: edge, headless: true });
for (const [id, file] of files) {
  const b64 = readFileSync(file).toString("base64");
  const page = await browser.newPage({ viewport: { width: 400, height: 600 } });
  await page.setContent(`<html><body style="margin:0"><canvas id="c"></canvas>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const data=Uint8Array.from(atob("${b64}"),c=>c.charCodeAt(0));
pdfjsLib.getDocument({data}).promise.then(async pdf=>{
  const pg=await pdf.getPage(1); const vp=pg.getViewport({scale:2});
  const c=document.getElementById('c'); c.width=vp.width; c.height=vp.height;
  await pg.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
  document.title='ready';
});
</script></body></html>`);
  await page.waitForFunction(() => document.title === "ready", null, {
    timeout: 60000,
  });
  const stats = await page.evaluate(() => {
    const c = document.getElementById("c");
    const ctx = c.getContext("2d");
    const h = c.height,
      w = c.width;
    const start = Math.floor(h * 0.65);
    const data = ctx.getImageData(0, start, w, h - start).data;
    let black = 0,
      total = data.length / 4;
    for (let i = 0; i < data.length; i += 4)
      if (data[i] < 40 && data[i + 1] < 40 && data[i + 2] < 40) black++;
    return { w, h, botBlackPct: +(100 * (black / total)).toFixed(2) };
  });
  await page.locator("#c").screenshot({ path: `${outDir}/cmp-${id}.png` });
  console.log(id, stats);
  await page.close();
}
await browser.close();
