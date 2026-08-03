import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { PDFDocument } from "pdf-lib";
import { chromium } from "playwright-core";

const out =
  "C:/Users/001ra/OneDrive/Attachments/Desktop/FLIPKART APP/tmp-debug";
mkdirSync(out, { recursive: true });
const css = readFileSync(
  "C:/Users/001ra/OneDrive/Attachments/Desktop/FLIPKART APP/app/globals.css",
  "utf8",
);
const edge =
  process.env["PROGRAMFILES(X86)"] +
  "\\Microsoft\\Edge\\Application\\msedge.exe";
const browser = await chromium.launch({ executablePath: edge, headless: true });
const fakeEan = "8904297214510";

const page = await browser.newPage({
  viewport: { width: 288, height: 384 },
  deviceScaleFactor: 1,
});
await page.setContent(`<canvas id="c"></canvas>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.12.3/dist/JsBarcode.all.min.js"></script>
<script>
JsBarcode(document.getElementById('c'),'${fakeEan}',{format:'EAN13',displayValue:false,margin:9,height:144,width:6.15,background:'#ffffff'});
window.D=document.getElementById('c').toDataURL('image/png');
</script>`);
await page.waitForFunction(() => window.D);
const dataUrl = await page.evaluate(() => window.D);

const fields = [
  "Marketed By / Imported By",
  "Manufactured By ",
  "Date Of Manufacture ",
  "Brand ",
  "Type",
  "Size",
  "Material",
  "Color",
  "Style Code",
  "Brand Colour",
  "Net Quantity",
  "1 U Contains",
  "Dimensions or Size",
  "MRP",
  "Country Of Origin",
];
const rows = fields
  .map((k, i) => {
    const cls = [
      "labelRow",
      k.includes("Marketed") ? "addressRow" : "",
      k.includes("Manufactured By") ? "manufacturedRow" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const span = k.includes("Marketed")
      ? "BABY & MOM Retail, Najafgarh, New Delhi"
      : "Sample " + i;
    return `<div class="${cls}"><strong>${k.trim()}</strong><span>${span}</span></div>`;
  })
  .join("");

const html = `<!doctype html><html><head><style>${css}
@page { size: 3in 4in; margin: 0; }
html, body { width: 3in; height: 4in; margin: 0; padding: 0; overflow: hidden; background: #fff; }
.nativePdfPage { box-sizing: border-box; width: 3in; height: 4in; margin: 0; padding: 0; overflow: hidden; background: #fff; }
.nativePdfPage > .label {
  box-sizing: border-box !important; width: 100% !important; height: 100% !important;
  margin: 0 !important; box-shadow: none !important; animation: none !important;
  display: flex !important; flex-direction: column !important;
}
.barcodeNumber, .barcodeImage, .barcodeBox, .label { transform: none !important; animation: none !important; }
</style></head><body>
<section class="nativePdfPage size-3x4">
  <div class="label alphaLabel">
    <div class="labelTitle">MTPG7QVYGSSUJ4GP</div>
    ${rows}
    <div class="labelRow complaints"><strong>For Consumer Complaints</strong><span>Mobile - 8800116630</span></div>
    <div class="barcodeBox">
      <img class="barcodeImage" src="${dataUrl}" alt="barcode" />
      <span class="barcodeNumber">${fakeEan}</span>
    </div>
  </div>
</section>
</body></html>`;

await page.emulateMedia({ media: "screen" });
await page.setContent(html, { waitUntil: "networkidle" });
await page.locator(".nativePdfPage").screenshot({ path: `${out}/dom-shot.png` });

// Try CDP printToPDF directly with more control
const client = await page.context().newCDPSession(page);
const cdp = await client.send("Page.printToPDF", {
  paperWidth: 3,
  paperHeight: 4,
  marginTop: 0,
  marginBottom: 0,
  marginLeft: 0,
  marginRight: 0,
  printBackground: true,
  preferCSSPageSize: false,
  scale: 1,
  pageRanges: "1",
});
writeFileSync(`${out}/cdp-pdf.pdf`, Buffer.from(cdp.data, "base64"));

// Image-embed approach: high-res screenshot into pdf-lib
const shotPage = await browser.newPage({
  viewport: { width: 288, height: 384 },
  deviceScaleFactor: 3,
});
await shotPage.emulateMedia({ media: "screen" });
await shotPage.setContent(html, { waitUntil: "networkidle" });
const png = await shotPage.locator(".nativePdfPage").screenshot({ type: "png" });
writeFileSync(`${out}/label-3x.png`, png);
const doc = await PDFDocument.create();
const pageDoc = doc.addPage([216, 288]); // 3in x 4in in points
const img = await doc.embedPng(png);
pageDoc.drawImage(img, { x: 0, y: 0, width: 216, height: 288 });
const embedBytes = await doc.save();
writeFileSync(`${out}/embed-pdf.pdf`, embedBytes);
await shotPage.close();

async function measure(path, name) {
  const b64 = readFileSync(path).toString("base64");
  const p = await browser.newPage();
  await p.setContent(`<canvas id=c></canvas>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <script>
  pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const data=Uint8Array.from(atob("${b64}"),c=>c.charCodeAt(0));
  pdfjsLib.getDocument({data}).promise.then(async pdf=>{
    const page=await pdf.getPage(1);
    const vp=page.getViewport({scale:2});
    const c=document.getElementById('c'); c.width=vp.width; c.height=vp.height;
    await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
    const ctx=c.getContext('2d');
    const img=ctx.getImageData(0,0,c.width,c.height).data;
    let maxX=0,minX=c.width,maxY=0,minY=c.height;
    for(let y=0;y<c.height;y++) for(let x=0;x<c.width;x++){
      const i=(y*c.width+x)*4;
      if(img[i]<120){ if(x>maxX)maxX=x; if(x<minX)minX=x; if(y>maxY)maxY=y; if(y<minY)minY=y; }
    }
    document.title=JSON.stringify({name:'${name}', rightEmptyPct:+(100*(c.width-1-maxX)/c.width).toFixed(2), widthPct:+(100*(maxX-minX+1)/c.width).toFixed(2), bottomEmptyPct:+(100*(c.height-1-maxY)/c.height).toFixed(2)});
  });
  </script>`);
  await p.waitForFunction(() => document.title.startsWith("{"), null, {
    timeout: 60000,
  });
  console.log(await p.title());
  await p.locator("#c").screenshot({ path: `${out}/meas-${name}.png` });
  await p.close();
}

await measure(`${out}/cdp-pdf.pdf`, "cdp");
await measure(`${out}/embed-pdf.pdf`, "embed");

// Also measure DOM screenshot ink bounds
await page.evaluate(async () => {});
const domPng = readFileSync(`${out}/dom-shot.png`);
// quick bounds via page
const p2 = await browser.newPage();
await p2.setContent(`<img id="i" src="data:image/png;base64,${domPng.toString("base64")}"/>`);
await p2.waitForFunction(() => document.getElementById("i").complete);
const domBounds = await p2.evaluate(() => {
  const image = document.getElementById("i");
  const c = document.createElement("canvas");
  c.width = image.naturalWidth;
  c.height = image.naturalHeight;
  const ctx = c.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height).data;
  let maxX = 0,
    minX = c.width,
    maxY = 0,
    minY = c.height;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (img[i] < 120) {
        if (x > maxX) maxX = x;
        if (x < minX) minX = x;
        if (y > maxY) maxY = y;
        if (y < minY) minY = y;
      }
    }
  return {
    w: c.width,
    h: c.height,
    rightEmptyPct: +((100 * (c.width - 1 - maxX)) / c.width).toFixed(2),
    widthPct: +((100 * (maxX - minX + 1)) / c.width).toFixed(2),
  };
});
console.log("DOM screenshot bounds", domBounds);

await browser.close();
