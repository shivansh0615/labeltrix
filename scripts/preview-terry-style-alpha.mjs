/**
 * Offline Alpha label preview using Terry Blue grid style (pdf-lib + bwip-js).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import bwipjs from "bwip-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outFile = join(__dirname, "..", "outputs", "alpha-terry-style-3x5-v2.pdf");

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
    __EMPTY: "Customer Care Address Same As Marketed By",
    __EMPTY_1: "Email - care@bnmretail.com",
  },
};

const ALPHA_FIELDS = [
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

const BLACK = rgb(0, 0, 0);
const OUTER = 1.4;
const INNER = 0.7;

function wrapText(text, font, fontSize, maxWidth) {
  const cleaned = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];
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
  return lines;
}

function field(payload, ...keys) {
  for (const key of keys) {
    if (payload[key] !== undefined && payload[key] !== null) {
      return String(payload[key]).trim();
    }
  }
  return "";
}

async function main() {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = 216;
  const height = 360;
  const page = pdf.addPage([width, height]);
  const margin = 3.5;
  const tableW = width - margin * 2;
  const tableTop = height - margin;
  const labelRatio = 0.363;
  const labelW = tableW * labelRatio;

  const titleH = 24;
  const addressH = 44;
  const complaintsH = 40;
  const barcodeH = 84;
  const fieldH =
    (tableTop - margin - titleH - addressH - complaintsH - barcodeH) /
    ALPHA_FIELDS.length;

  const rows = [
    { h: titleH, kind: "title" },
    { h: addressH, kind: "pair" },
    ...ALPHA_FIELDS.map(() => ({ h: fieldH, kind: "pair" })),
    { h: complaintsH, kind: "pair" },
    { h: barcodeH, kind: "barcode" },
  ];

  const tableH = rows.reduce((s, r) => s + r.h, 0);
  const tableBottom = tableTop - tableH;
  page.drawRectangle({
    x: margin,
    y: tableBottom,
    width: tableW,
    height: tableH,
    borderColor: BLACK,
    borderWidth: OUTER,
  });

  let y = tableTop;
  const labelX = margin + labelW;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const next = y - row.h;
    if (i > 0) {
      page.drawLine({
        start: { x: margin, y },
        end: { x: margin + tableW, y },
        thickness: INNER,
        color: BLACK,
      });
    }
    if (row.kind === "pair") {
      page.drawLine({
        start: { x: labelX, y: next },
        end: { x: labelX, y },
        thickness: INNER,
        color: BLACK,
      });
    }
    y = next;
  }

  const body = 7;
  const small = 6.2;
  const pad = 2.4;
  y = tableTop;

  // Title
  {
    const t = sample.fsn;
    const tw = regular.widthOfTextAtSize(t, 8);
    page.drawText(t, {
      x: margin + (tableW - tw) / 2,
      y: y - titleH / 2 - 3,
      size: 8,
      font: regular,
      color: BLACK,
    });
    y -= titleH;
  }

  // Address
  {
    const labels = ["Marketed By / Imported By", "Manufactured By"];
    let ly = y - pad - small;
    for (const line of labels) {
      page.drawText(line, {
        x: margin + pad,
        y: ly,
        size: small,
        font: regular,
        color: BLACK,
        maxWidth: labelW - pad * 2,
      });
      ly -= small * 1.2;
    }
    const values = [
      ...wrapText(
        field(sample.payload, "Marketed By / Imported By"),
        regular,
        small,
        tableW - labelW - pad * 2,
      ),
      "-",
    ];
    let vy = y - pad - small;
    for (const line of values) {
      if (vy < y - addressH + 1) break;
      page.drawText(line, {
        x: margin + labelW + pad,
        y: vy,
        size: small,
        font: regular,
        color: BLACK,
        maxWidth: tableW - labelW - pad * 2,
      });
      vy -= small * 1.15;
    }
    y -= addressH;
  }

  // Fields
  for (const key of ALPHA_FIELDS) {
    const size = Math.min(body, fieldH - 1.4);
    const label = key.trim();
    const value = field(sample.payload, key);
    page.drawText(label, {
      x: margin + pad,
      y: y - fieldH / 2 - size * 0.35,
      size,
      font: regular,
      color: BLACK,
      maxWidth: labelW - pad * 2,
    });
    page.drawText(value, {
      x: margin + labelW + pad,
      y: y - fieldH / 2 - size * 0.35,
      size,
      font: regular,
      color: BLACK,
      maxWidth: tableW - labelW - pad * 2,
    });
    y -= fieldH;
  }

  // Complaints — stacked lines, kept inside the cell
  {
    page.drawText("For Consumer Complaints", {
      x: margin + pad,
      y: y - pad - small,
      size: small,
      font: regular,
      color: BLACK,
      maxWidth: labelW - pad * 2,
    });
    const complaintLines = [
      field(sample.payload, "For Consumer Complaints"),
      field(sample.payload, "__EMPTY"),
      field(sample.payload, "__EMPTY_1"),
    ].filter(Boolean);
    let vy = y - pad - small;
    for (const raw of complaintLines) {
      for (const line of wrapText(
        raw,
        regular,
        small,
        tableW - labelW - pad * 2,
      )) {
        if (vy < y - complaintsH + 1.5) break;
        page.drawText(line, {
          x: margin + labelW + pad,
          y: vy,
          size: small,
          font: regular,
          color: BLACK,
          maxWidth: tableW - labelW - pad * 2,
        });
        vy -= small * 1.15;
      }
    }
    y -= complaintsH;
  }

  // Barcode
  {
    const png = await bwipjs.toBuffer({
      bcid: "ean13",
      text: sample.ean,
      scale: 4,
      height: 14,
      includetext: false,
      backgroundcolor: "FFFFFF",
    });
    const image = await pdf.embedPng(png);
    const eanSize = 10;
    const textH = eanSize + 3;
    const innerPad = 3.5;
    const maxW = tableW * 0.78;
    const maxH = Math.min(56, barcodeH - textH - innerPad * 2);
    const scale = Math.min(maxW / image.width, maxH / image.height);
    const drawW = image.width * scale;
    const drawH = image.height * scale;
    const yBottom = y - barcodeH;
    page.drawImage(image, {
      x: margin + (tableW - drawW) / 2,
      y: yBottom + textH + innerPad + (maxH - drawH) / 2,
      width: drawW,
      height: drawH,
    });
    const eanW = regular.widthOfTextAtSize(sample.ean, eanSize);
    page.drawText(sample.ean, {
      x: margin + (tableW - eanW) / 2,
      y: yBottom + innerPad,
      size: eanSize,
      font: regular,
      color: BLACK,
    });
  }

  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, await pdf.save());
  console.log("Wrote", outFile);
  if (process.platform === "win32") exec(`start "" "${outFile}"`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
