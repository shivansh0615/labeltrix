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
const fakeEan = "8904297204214";
const fbfFields = [
  "brand",
  "FSN",
  "model_name",
  "model_number",
  "color",
  "EAN",
  "type",
  "size",
  "Net quantity",
  "Generic name",
  "Dimension",
  "MRP",
  "month and year of manufactured",
];
const long =
  "Water Resistant Bed Protector Baby Dry Sheet with Ultra absorbance and extra long marketing text that wraps many lines repeatedly for overflow testing of the three by five label barcode visibility problem";
const rows = fbfFields
  .map((k) => {
    const span =
      k === "model_name"
        ? long
        : k === "EAN"
          ? fakeEan
          : k === "FSN"
            ? "MATFGWABHZGQFEJ"
            : "Value";
    return `<div class="labelRow"><strong>${k}</strong><span>${span}</span></div>`;
  })
  .join("");

const html = `<!doctype html><html><head><style>${css}</style></head>
<body><main class="size-3x5"><section class="preview">
<div class="label fbfLabel" id="label">
  <div class="labelTitle">Mat</div>
  ${rows}
  <div class="labelRow company"><strong>manufactured by/Marketed by &amp; customer care details</strong>
  <span>BABY &amp; MOM Retail Private Limited Company, Plot No-8, KH No-45/2, U/G/F, Sri Sai Baba Enclave , Phase-01, Najafgarh, 110043, New Delhi<br/>8800116630<br/>email@test.com</span></div>
  <div class="barcodeTitle" aria-hidden="true"></div>
  <div class="barcodeBox" id="bb">
    <img class="barcodeImage" id="bi" />
    <span class="barcodeNumber">${fakeEan}</span>
  </div>
</div>
</section></main>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.12.3/dist/JsBarcode.all.min.js"></script>
<script>
JsBarcode(document.createElement('canvas'), '${fakeEan}', {format:'EAN13',displayValue:false,margin:9,height:144,width:6.15,background:'#ffffff'});
const c=document.createElement('canvas');
JsBarcode(c,'${fakeEan}',{format:'EAN13',displayValue:false,margin:9,height:144,width:6.15,background:'#ffffff'});
document.getElementById('bi').src=c.toDataURL('image/png');
</script></body></html>`;

const browser = await chromium.launch({ executablePath: edge, headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
await page.setContent(html, { waitUntil: "networkidle" });
await page.waitForTimeout(700);
const m = await page.evaluate(() => {
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
  const visibleImg = Math.max(
    0,
    Math.min(ir.bottom, lr.bottom) - Math.max(ir.top, lr.top),
  );
  return {
    labelH: lr.height,
    tableH,
    boxH: br.height,
    boxTop: +(br.top - lr.top).toFixed(1),
    imgH: ir.height,
    visibleImg: +visibleImg.toFixed(1),
    clipped: br.bottom > lr.bottom + 1 || visibleImg < 5,
  };
});
console.log(JSON.stringify(m, null, 2));
await page.locator("#label").screenshot({ path: outDir + "/fbf-long-3x5.png" });
await browser.close();
