import { chromium } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { PDFDocument } from "pdf-lib";
import { createRequire } from "module";
import { pathToFileURL } from "url";

const require = createRequire(
  "C:/Users/001ra/Desktop/FLIPKART APP/package.json",
);
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

const pdfPath =
  "C:/Users/001ra/Downloads/Alpha Product label Details-EAN-8904297214510 (42).pdf";
const pdf = await PDFDocument.load(readFileSync(pdfPath));
const page = pdf.getPages()[0];
const { width, height } = page.getSize();
console.log("PDF page points:", width, height, "inches:", width / 72, height / 72);

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
      ? "NEWISH LIFESTYLE PRIVATE LIMITED, Plot No 123, Some Long Address Line That Wraps Across Multiple Lines In The Cell, City State PIN 110001"
      : k.includes("Manufactured")
        ? "Same company address line"
        : "Sample value " + i;
    return `<div class="${cls}"><strong>${k.trim()}</strong><span>${span}</span></div>`;
  })
  .join("");

const fakeEan = "8904297214510";
const html = `<!doctype html><html><head><style>${css}</style></head>
<body>
<main class="size-3x5">
<div class="preview">
  <div class="label alphaLabel" id="label">
    <div class="labelTitle">FSN123456789012</div>
    ${rows}
    <div class="labelRow complaints"><strong>For Consumer Complaints</strong><span>Care line<br/>Address line<br/>email@test.com</span></div>
    <div class="barcodeBox" id="bb">
      <img class="barcodeImage" id="bi" alt="barcode" />
      <span class="barcodeNumber">${fakeEan}</span>
    </div>
  </div>
</div>
</main>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.12.3/dist/JsBarcode.all.min.js"></script>
<script>
const canvas=document.createElement('canvas');
JsBarcode(canvas,'${fakeEan}',{format:'EAN13',displayValue:false,margin:9,height:144,width:6.15,background:'#ffffff'});
document.getElementById('bi').src=canvas.toDataURL('image/png');
</script>
</body></html>`;

writeFileSync(outDir + "/preview-3x5.html", html);

const browser = await chromium.launch({ executablePath: edge, headless: true });
const page2 = await browser.newPage({ viewport: { width: 900, height: 1400 } });
await page2.setContent(html, { waitUntil: "networkidle" });
await page2.waitForTimeout(800);

const metrics = await page2.evaluate(() => {
  const label = document.getElementById("label");
  const bb = document.getElementById("bb");
  const bi = document.getElementById("bi");
  const num = document.querySelector(".barcodeNumber");
  const lr = label.getBoundingClientRect();
  const br = bb.getBoundingClientRect();
  const ir = bi.getBoundingClientRect();
  const nr = num.getBoundingClientRect();
  const cs = getComputedStyle(bb);
  const is = getComputedStyle(bi);
  const ns = getComputedStyle(num);
  let tableH = 0;
  for (const el of label.children) {
    if (el === bb) continue;
    tableH += el.getBoundingClientRect().height;
  }
  return {
    label: { w: lr.width, h: lr.height },
    tableH,
    box: {
      w: br.width,
      h: br.height,
      top: br.top - lr.top,
      bottomGap: lr.bottom - br.bottom,
      overflow: cs.overflow,
      flex: cs.flex,
      height: cs.height,
      minHeight: cs.minHeight,
      dir: cs.flexDirection,
      padding: cs.padding,
    },
    img: {
      w: ir.width,
      h: ir.height,
      topInBox: ir.top - br.top,
      naturalW: bi.naturalWidth,
      naturalH: bi.naturalHeight,
      display: is.display,
      maxH: is.maxHeight,
      height: is.height,
      width: is.width,
      visibility: is.visibility,
      opacity: is.opacity,
    },
    number: {
      w: nr.width,
      h: nr.height,
      bottom: ns.bottom,
      topInBox: nr.top - br.top,
      text: num.textContent,
    },
    clipped:
      br.bottom > lr.bottom + 0.5 ||
      ir.bottom > lr.bottom + 0.5 ||
      ir.height < 1 ||
      br.height < 20,
  };
});

console.log(JSON.stringify(metrics, null, 2));
await page2.locator("#label").screenshot({ path: outDir + "/preview-3x5.png" });

// Also test with SHORT content
const htmlShort = html.replace(
  /NEWISH LIFESTYLE[\s\S]*?110001/,
  "Short address",
);
await page2.setContent(htmlShort, { waitUntil: "networkidle" });
await page2.waitForTimeout(800);
const metricsShort = await page2.evaluate(() => {
  const label = document.getElementById("label");
  const bb = document.getElementById("bb");
  const bi = document.getElementById("bi");
  const lr = label.getBoundingClientRect();
  const br = bb.getBoundingClientRect();
  const ir = bi.getBoundingClientRect();
  let tableH = 0;
  for (const el of label.children) {
    if (el === bb) continue;
    tableH += el.getBoundingClientRect().height;
  }
  return {
    tableH,
    boxH: br.height,
    imgH: ir.height,
    imgW: ir.width,
    clipped: br.bottom > lr.bottom + 0.5 || ir.height < 1,
  };
});
console.log("SHORT", JSON.stringify(metricsShort, null, 2));
await page2.locator("#label").screenshot({ path: outDir + "/preview-3x5-short.png" });

await browser.close();
console.log("done");
