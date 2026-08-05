import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import bwipjs from "bwip-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "outputs");
const outFile = join(outDir, "vector-label-preview-3x5-v2.pdf");

const sample = {
  fsn: "MTPG7QVYGSSUJ4GP",
  ean: "8904297214510",
  payload: {
    "Marketed By / Imported By":
      "BABY & MOM Retail Private Limited Company, Plot No-8, KH No-45/2, U/G/F, Sri Sai Baba Enclave, Phase-01, Najafgarh, 110043, New Delhi",
    "Manufactured By ": "",
    "Date Of Manufacture ": "Jul-26",
    "Brand ": "Mattress Protector",
    Type: "Fitted",
    Size: "King",
    Material: "Cotton",
    Color: "Blue",
    "Style Code": "MP-4120-B",
    "Brand Colour": "Blue",
    "Net Quantity": "1 U",
    "1 U Contains": "1 Mattress Cover",
    "Dimensions or Size": "LxBxH - 21x16x6 cm",
    MRP: "Rs. 2299.00 ( Inclusive Of All Taxes )",
    "Country Of Origin": "India",
    "For Consumer Complaints": "Mobile Number - 8800116630",
  },
};

function wrapText(text, font, fontSize, maxWidth) {
  const cleaned = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [""];
  const words = cleaned.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, fontSize) <= maxWidth) current = next;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

async function main() {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = 216;
  const height = 360;
  const page = pdf.addPage([width, height]);
  const black = rgb(0, 0, 0);
  const margin = 4;
  const tableW = width - margin * 2;
  let y = height - margin;

  const drawBox = (x, yy, w, h) =>
    page.drawRectangle({
      x,
      y: yy,
      width: w,
      height: h,
      borderColor: black,
      borderWidth: 0.7,
    });

  // Title
  const titleH = 18;
  drawBox(margin, y - titleH, tableW, titleH);
  const tw = bold.widthOfTextAtSize(sample.fsn, 9);
  page.drawText(sample.fsn, {
    x: margin + (tableW - tw) / 2,
    y: y - titleH + 5,
    size: 9,
    font: bold,
    color: black,
  });
  y -= titleH;

  // Address block
  const addressH = 58;
  const labelW = tableW * 0.36;
  const valueW = tableW - labelW;
  drawBox(margin, y - addressH, labelW, addressH);
  drawBox(margin + labelW, y - addressH, valueW, addressH);
  page.drawText("Marketed By / Imported By", {
    x: margin + 3,
    y: y - 10,
    size: 5.6,
    font: bold,
    color: black,
  });
  page.drawText("Manufactured By", {
    x: margin + 3,
    y: y - 18,
    size: 5.6,
    font: bold,
    color: black,
  });
  let vy = y - 10;
  for (const line of wrapText(
    sample.payload["Marketed By / Imported By"],
    regular,
    5.6,
    valueW - 6,
  )) {
    page.drawText(line, {
      x: margin + labelW + 3,
      y: vy,
      size: 5.6,
      font: regular,
      color: black,
    });
    vy -= 7;
  }
  page.drawText("—", {
    x: margin + labelW + 3,
    y: vy,
    size: 5.6,
    font: regular,
    color: black,
  });
  y -= addressH;

  const fields = [
    ["Date Of Manufacture", sample.payload["Date Of Manufacture "]],
    ["Brand", sample.payload["Brand "]],
    ["Type", sample.payload.Type],
    ["Size", sample.payload.Size],
    ["Material", sample.payload.Material],
    ["Color", sample.payload.Color],
    ["Style Code", sample.payload["Style Code"]],
    ["Brand Colour", sample.payload["Brand Colour"]],
    ["Net Quantity", sample.payload["Net Quantity"]],
    ["1 U Contains", sample.payload["1 U Contains"]],
    ["Dimensions or Size", sample.payload["Dimensions or Size"]],
    ["MRP", sample.payload.MRP],
    ["Country Of Origin", sample.payload["Country Of Origin"]],
  ];
  const complaintsH = 42;
  const barcodeReserve = 110;
  const fieldH = (y - margin - barcodeReserve - complaintsH) / fields.length;
  for (const [k, v] of fields) {
    drawBox(margin, y - fieldH, labelW, fieldH);
    drawBox(margin + labelW, y - fieldH, valueW, fieldH);
    page.drawText(k, {
      x: margin + 2.5,
      y: y - fieldH + 3,
      size: 6.2,
      font: bold,
      color: black,
      maxWidth: labelW - 5,
    });
    page.drawText(String(v || ""), {
      x: margin + labelW + 2.5,
      y: y - fieldH + 3,
      size: 6.2,
      font: regular,
      color: black,
      maxWidth: valueW - 5,
    });
    y -= fieldH;
  }

  drawBox(margin, y - complaintsH, labelW, complaintsH);
  drawBox(margin + labelW, y - complaintsH, valueW, complaintsH);
  page.drawText("For Consumer Complaints", {
    x: margin + 2.5,
    y: y - 12,
    size: 5.6,
    font: bold,
    color: black,
    maxWidth: labelW - 5,
  });
  page.drawText(sample.payload["For Consumer Complaints"], {
    x: margin + labelW + 2.5,
    y: y - 12,
    size: 5.6,
    font: regular,
    color: black,
    maxWidth: valueW - 5,
  });
  y -= complaintsH;

  const barcodeBoxH = Math.max(28, y - margin);
  const barcodeTop = y;
  const barcodeBottom = margin;
  drawBox(margin, barcodeBottom, tableW, barcodeBoxH);

  const png = await bwipjs.toBuffer({
    bcid: "ean13",
    text: sample.ean,
    scale: 4,
    height: 14,
    includetext: false,
    backgroundcolor: "FFFFFF",
  });
  const image = await pdf.embedPng(png);
  const eanSize = 10.5;
  const textH = eanSize + 3;
  const innerPad = 4;
  const maxW = tableW * 0.78;
  const maxH = Math.min(58, Math.max(12, barcodeBoxH - textH - innerPad * 2));
  const scale = Math.min(maxW / image.width, maxH / image.height);
  const drawW = image.width * scale;
  const drawH = image.height * scale;
  const contentTop = barcodeTop - innerPad;
  const contentBottom = barcodeBottom + textH + innerPad;
  const availH = Math.max(drawH, contentTop - contentBottom);
  const by = contentBottom + (availH - drawH) / 2;
  page.drawImage(image, {
    x: margin + (tableW - drawW) / 2,
    y: Math.max(contentBottom, Math.min(by, contentTop - drawH)),
    width: drawW,
    height: drawH,
  });
  const eanW = regular.widthOfTextAtSize(sample.ean, eanSize);
  page.drawText(sample.ean, {
    x: margin + (tableW - eanW) / 2,
    y: barcodeBottom + innerPad,
    size: eanSize,
    font: regular,
    color: black,
  });

  await mkdir(outDir, { recursive: true });
  const bytes = await pdf.save();
  await writeFile(outFile, bytes);
  console.log(`Wrote ${outFile}`);

  if (process.platform === "win32") {
    exec(`start "" "${outFile}"`);
  } else if (process.platform === "darwin") {
    exec(`open "${outFile}"`);
  } else {
    exec(`xdg-open "${outFile}"`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
