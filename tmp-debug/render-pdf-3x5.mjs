import { chromium } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { PDFDocument } from "pdf-lib";
import { createServer } from "http";
import { pathToFileURL } from "url";

const edge =
  process.env["PROGRAMFILES(X86)"] +
  "\\Microsoft\\Edge\\Application\\msedge.exe";
const css = readFileSync(
  "C:/Users/001ra/OneDrive/Attachments/Desktop/FLIPKART APP/app/globals.css",
  "utf8",
);
const outDir =
  "C:/Users/001ra/OneDrive/Attachments/Desktop/FLIPKART APP/tmp-debug";
mkdirSync(outDir, { recursive: true });

const fakeEan = "8904297214510";
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

function rowsHtml() {
  return fields
    .map((k, i) => {
      const cls = [
        "labelRow",
        k.includes("Marketed") ? "addressRow" : "",
        k.includes("Manufactured By") ? "manufacturedRow" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const span = k.includes("Marketed")
        ? "NEWISH LIFESTYLE PRIVATE LIMITED, Plot No 123, Long address wrapping for realism, City State PIN 110001"
        : "Sample value " + i;
      return `<div class="${cls}"><strong>${k.trim()}</strong><span>${span}</span></div>`;
    })
    .join("");
}

const browser = await chromium.launch({ executablePath: edge, headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });

// Generate barcode data URL first
await page.setContent(`<canvas id="c"></canvas>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.12.3/dist/JsBarcode.all.min.js"></script>
<script>
JsBarcode(document.getElementById('c'), '${fakeEan}', {format:'EAN13',displayValue:false,margin:9,height:144,width:6.15,background:'#ffffff'});
window.DATA=document.getElementById('c').toDataURL('image/png');
</script>`);
await page.waitForFunction(() => window.DATA);
const dataUrl = await page.evaluate(() => window.DATA);

const labelInner = `
    <div class="labelTitle">FSN123456789012</div>
    ${rowsHtml()}
    <div class="labelRow complaints"><strong>For Consumer Complaints</strong><span>Care line<br/>Address<br/>email@test.com</span></div>
    <div class="barcodeBox">
      <img class="barcodeImage" src="${dataUrl}" alt="Barcode ${fakeEan}" />
      <span class="barcodeNumber">${fakeEan}</span>
    </div>`;

const pdfHtml = `<!doctype html><html><head><style>${css}
@page { size: 3in 5in; margin: 0; }
html, body { width: 3in; margin: 0; padding: 0; overflow: visible; background: #fff; }
.nativePdfPage {
  width: 3in; height: 5in; min-height: 5in; max-height: 5in;
  margin: 0; padding: 0; overflow: visible; background: #fff;
}
.nativePdfPage > .label {
  position: static !important;
  width: 3in !important;
  height: 5in !important;
  min-height: 5in !important;
  max-height: 5in !important;
  margin: 0 !important;
  display: flex !important;
  box-shadow: none !important;
}
</style></head>
<body>
<section class="nativePdfPage size-3x5">
  <div class="label alphaLabel">${labelInner}</div>
</section>
</body></html>`;

writeFileSync(outDir + "/pdf-input-3x5.html", pdfHtml);

// Measure inside PDF document structure
await page.setViewportSize({ width: 288, height: 480 });
await page.emulateMedia({ media: "screen" });
await page.setContent(pdfHtml, { waitUntil: "networkidle" });
await page.waitForTimeout(500);

const metrics = await page.evaluate(() => {
  const pageEl = document.querySelector(".nativePdfPage");
  const label = document.querySelector(".label");
  const bb = document.querySelector(".barcodeBox");
  const bi = document.querySelector(".barcodeImage");
  const pr = pageEl.getBoundingClientRect();
  const lr = label.getBoundingClientRect();
  const br = bb.getBoundingClientRect();
  const ir = bi.getBoundingClientRect();
  return {
    page: { w: pr.width, h: pr.height },
    label: { w: lr.width, h: lr.height },
    box: { w: br.width, h: br.height, top: br.top - lr.top },
    img: {
      w: ir.width,
      h: ir.height,
      naturalW: bi.naturalWidth,
      naturalH: bi.naturalHeight,
      complete: bi.complete,
    },
    clipped: br.bottom > lr.bottom + 0.5 || ir.height < 1,
  };
});
console.log("PDF-DOM metrics", JSON.stringify(metrics, null, 2));

const pdfBytes = await page.pdf({
  width: "3in",
  height: "5in",
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
  printBackground: true,
  preferCSSPageSize: true,
  scale: 1,
});
writeFileSync(outDir + "/out-3x5.pdf", pdfBytes);
console.log("wrote out-3x5.pdf", pdfBytes.length);

// Screenshot the page as rendered for PDF
await page.screenshot({ path: outDir + "/pdf-dom-3x5.png", fullPage: true });

// Also rasterize via screenshot of label
await page.locator(".nativePdfPage").screenshot({ path: outDir + "/pdf-page-3x5.png" });

await browser.close();
console.log("done");
