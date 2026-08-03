import { readFileSync, writeFileSync, mkdirSync } from "fs";
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
const page = await browser.newPage();
await page.setContent(`<canvas id="c"></canvas>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.12.3/dist/JsBarcode.all.min.js"></script>
<script>
JsBarcode(document.getElementById('c'),'8904297214510',{format:'EAN13',displayValue:false,margin:9,height:144,width:6.15,background:'#ffffff'});
window.D=document.getElementById('c').toDataURL('image/png');
</script>`);
await page.waitForFunction(() => window.D);
const dataUrl = await page.evaluate(() => window.D);
await browser.close();

const html = `<!doctype html><html><head><style>${css}
@page { size: 3in 4in; margin: 0; }
html, body { width: 3in; margin: 0; padding: 0; overflow: visible; background: #fff; }
.nativePdfPage {
  box-sizing: border-box; width: 3in; height: 4in; margin: 0; padding: 0; overflow: hidden; background: #fff;
}
.nativePdfPage > .label {
  box-sizing: border-box !important; width: 100% !important; height: 100% !important;
  margin: 0 !important; box-shadow: none !important; animation: none !important;
  display: flex !important; flex-direction: column !important;
  -webkit-font-smoothing: none !important; font-smooth: never !important;
}
.nativePdfPage .labelTitle { font-weight: 700 !important; }
.nativePdfPage .labelRow > strong { font-weight: 600 !important; }
.nativePdfPage .labelRow > span { font-weight: 400 !important; }
</style></head><body>
<section class="nativePdfPage size-3x4">
  <div class="label alphaLabel">
    <div class="labelTitle">MTPG7QVYGSSUJ4GP</div>
    <div class="labelRow addressRow"><strong>Marketed By / Imported By</strong><span>BABY &amp; MOM Retail Private Limited Company, Plot No-8, KH No-45/2, Najafgarh, 110043, New Delhi</span></div>
    <div class="labelRow manufacturedRow"><strong>Manufactured By</strong><span>-</span></div>
    <div class="labelRow"><strong>Date Of Manufacture</strong><span>Jul-26</span></div>
    <div class="labelRow"><strong>Brand</strong><span>Mattress Protector</span></div>
    <div class="labelRow"><strong>Type</strong><span>Fitted</span></div>
    <div class="labelRow"><strong>Size</strong><span>King</span></div>
    <div class="labelRow"><strong>Material</strong><span>Cotton</span></div>
    <div class="labelRow"><strong>Color</strong><span>Blue</span></div>
    <div class="labelRow"><strong>Style Code</strong><span>MP-4120-B</span></div>
    <div class="labelRow"><strong>Brand Colour</strong><span>Blue</span></div>
    <div class="labelRow"><strong>Net Quantity</strong><span>1 U</span></div>
    <div class="labelRow"><strong>1 U Contains</strong><span>1 Mattress Cover</span></div>
    <div class="labelRow"><strong>Dimensions or Size</strong><span>LxBxH - 21x16x6 cm</span></div>
    <div class="labelRow"><strong>MRP</strong><span>Rs. 2299.00 ( Inclusive Of All Taxes )</span></div>
    <div class="labelRow"><strong>Country Of Origin</strong><span>India</span></div>
    <div class="labelRow complaints"><strong>For Consumer Complaints</strong><span>Mobile Number - 8800116630</span></div>
    <div class="barcodeBox">
      <img class="barcodeImage" src="${dataUrl}" alt="barcode" />
      <span class="barcodeNumber">8904297214510</span>
    </div>
  </div>
</section>
</body></html>`;

const response = await fetch("http://127.0.0.1:3100/pdf", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "http://localhost:3000",
  },
  body: JSON.stringify({ html, labelSize: "3x4", fileName: "thermal-check.pdf" }),
});
if (!response.ok) {
  console.error(await response.text());
  process.exit(1);
}
const buf = Buffer.from(await response.arrayBuffer());
writeFileSync(`${out}/thermal-check.pdf`, buf);

const b = await chromium.launch({ executablePath: edge, headless: true });
const p = await b.newPage();
const b64 = buf.toString("base64");
await p.setContent(`<canvas id="c"></canvas>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const data=Uint8Array.from(atob("${b64}"),c=>c.charCodeAt(0));
pdfjsLib.getDocument({data}).promise.then(async pdf=>{
  const page=await pdf.getPage(1);
  const vp=page.getViewport({scale:3});
  const c=document.getElementById('c'); c.width=vp.width; c.height=vp.height;
  await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
  const ctx=c.getContext('2d');
  const img=ctx.getImageData(0,0,c.width,c.height).data;
  let gray=0, black=0, white=0, total=img.length/4;
  for (let i=0;i<img.length;i+=4){
    const v=img[i];
    if (v < 20) black++;
    else if (v > 235) white++;
    else gray++;
  }
  document.title = JSON.stringify({
    blackPct: +(100*black/total).toFixed(2),
    whitePct: +(100*white/total).toFixed(2),
    grayPct: +(100*gray/total).toFixed(2),
  });
});
</script>`);
await p.waitForFunction(() => document.title.startsWith("{"), null, {
  timeout: 60000,
});
console.log("pixel mix", await p.title());
await p.locator("#c").screenshot({ path: `${out}/thermal-check.png` });
// crop a text region roughly (header / first rows)
await p.evaluate(() => {
  const c = document.getElementById("c");
  const ctx = c.getContext("2d");
  const w = Math.floor(c.width * 0.55);
  const h = Math.floor(c.height * 0.28);
  const crop = document.createElement("canvas");
  crop.id = "crop";
  crop.width = w;
  crop.height = h;
  crop.getContext("2d").drawImage(c, 0, 0, w, h, 0, 0, w, h);
  document.body.appendChild(crop);
});
await p.locator("#crop").screenshot({ path: `${out}/thermal-text-crop.png` });
await b.close();
console.log("wrote thermal-check.pdf / png / text crop");
