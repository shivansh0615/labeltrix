import { chromium } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync } from "fs";

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
        ? "BABY & MOM Retail Private Limited Company, Plot No-8, KH No-45/2, U/G/F, Sri Sai Baba Enclave , Phase-01, Najafgarh, 110043, New Delhi"
        : "Sample " + i;
      return `<div class="${cls}"><strong>${k.trim()}</strong><span>${span}</span></div>`;
    })
    .join("");
}

const browser = await chromium.launch({ executablePath: edge, headless: true });
const page = await browser.newPage();

await page.setContent(`<canvas id="c"></canvas>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.12.3/dist/JsBarcode.all.min.js"></script>
<script>
JsBarcode(document.getElementById('c'),'${fakeEan}',{format:'EAN13',displayValue:false,margin:9,height:144,width:6.15,background:'#ffffff'});
window.DATA=document.getElementById('c').toDataURL('image/png');
</script>`);
await page.waitForFunction(() => window.DATA);
const dataUrl = await page.evaluate(() => window.DATA);

const labelInner = `
  <div class="labelTitle">MTPG7QVYGSSUJ4GP</div>
  ${rowsHtml()}
  <div class="labelRow complaints"><strong>For Consumer Complaints</strong><span>Mobile Number - 8800116630</span></div>
  <div class="barcodeBox">
    <img class="barcodeImage" src="${dataUrl}" alt="Barcode ${fakeEan}" />
    <span class="barcodeNumber">${fakeEan}</span>
  </div>`;

for (const size of ["3x5", "3x4", "3x3"]) {
  const h = size === "3x5" ? 5 : size === "3x4" ? 4 : 3;
  const px = size === "3x5" ? 480 : size === "3x4" ? 384 : 288;
  const html = `<!doctype html><html><head><style>${css}
@page { size: 3in ${h}in; margin: 0; }
html, body { width: 3in; margin: 0; padding: 0; background: #fff; }
.nativePdfPage { width: 3in; height: ${h}in; margin: 0; background: #fff; }
.nativePdfPage > .label {
  width: 3in !important; height: ${h}in !important;
  min-height: ${h}in !important; max-height: ${h}in !important;
  margin: 0 !important; display: flex !important; box-shadow: none !important;
}
</style></head><body>
<section class="nativePdfPage size-${size}">
  <div class="label alphaLabel">${labelInner}</div>
</section></body></html>`;

  await page.setViewportSize({ width: 288, height: px });
  await page.emulateMedia({ media: "screen" });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const bi = document.querySelector(".barcodeImage");
    const bb = document.querySelector(".barcodeBox");
    const ir = bi.getBoundingClientRect();
    const br = bb.getBoundingClientRect();
    return {
      imgW: +ir.width.toFixed(1),
      imgH: +ir.height.toFixed(1),
      boxH: +br.height.toFixed(1),
    };
  });
  console.log(size, m);
  await page.locator(".nativePdfPage").screenshot({
    path: `${outDir}/fixed-${size}.png`,
  });
  const pdf = await page.pdf({
    width: "3in",
    height: `${h}in`,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    printBackground: true,
    preferCSSPageSize: true,
    scale: 1,
  });
  writeFileSync(`${outDir}/fixed-${size}.pdf`, pdf);
}

await browser.close();
console.log("done");
