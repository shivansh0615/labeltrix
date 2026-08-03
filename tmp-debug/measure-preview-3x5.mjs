import { chromium } from "playwright-core";
import { readFileSync, mkdirSync } from "fs";

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
      ? "BABY & MOM Retail Private Limited Company, Plot No-8, KH No-45/2, U/G/F, Sri Sai Baba Enclave , Phase-01, Najafgarh, 110043, New Delhi"
      : k.includes("Manufactured")
        ? "-"
        : "Sample " + i;
    return `<div class="${cls}"><strong>${k.trim()}</strong><span>${span}</span></div>`;
  })
  .join("");

const html = `<!doctype html><html><head><style>${css}</style></head>
<body>
<main class="size-3x5">
  <section class="preview">
    <div class="previewHead"><h3>Product Label Format</h3><span>Barcode from EAN</span></div>
    <div class="label alphaLabel" id="label">
      <div class="labelTitle">MTPG7QVYGSSUJ4GP</div>
      ${rows}
      <div class="labelRow complaints"><strong>For Consumer Complaints</strong><span>Mobile Number - 8800116630</span></div>
      <div class="barcodeBox" id="bb">
        <img class="barcodeImage" id="bi" alt="barcode" />
        <span class="barcodeNumber">${fakeEan}</span>
      </div>
    </div>
  </section>
</main>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.12.3/dist/JsBarcode.all.min.js"></script>
<script>
const canvas=document.createElement('canvas');
JsBarcode(canvas,'${fakeEan}',{format:'EAN13',displayValue:false,margin:9,height:144,width:6.15,background:'#ffffff'});
document.getElementById('bi').src=canvas.toDataURL('image/png');
</script>
</body></html>`;

const browser = await chromium.launch({ executablePath: edge, headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
await page.setContent(html, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const metrics = await page.evaluate(() => {
  const label = document.getElementById("label");
  const bb = document.getElementById("bb");
  const bi = document.getElementById("bi");
  const lr = label.getBoundingClientRect();
  const br = bb.getBoundingClientRect();
  const ir = bi.getBoundingClientRect();
  let tableH = 0;
  for (const el of label.children) {
    if (el.id === "bb") continue;
    tableH += el.getBoundingClientRect().height;
  }
  return {
    labelH: lr.height,
    tableH,
    boxH: br.height,
    boxTop: br.top - lr.top,
    imgH: ir.height,
    imgVisibleH: Math.max(0, Math.min(ir.bottom, lr.bottom) - Math.max(ir.top, lr.top)),
    clipped: br.bottom > lr.bottom + 1 || ir.bottom > lr.bottom + 1 || ir.height < 1,
    boxFullyOutside: br.top >= lr.bottom - 1,
  };
});
console.log(JSON.stringify(metrics, null, 2));
await page.locator("#label").screenshot({ path: outDir + "/preview-inflated-3x5.png" });
await browser.close();
