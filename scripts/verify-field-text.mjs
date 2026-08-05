/**
 * Offline check: short Alpha field rows must still emit label text.
 * Mirrors the fixed drawCellText vertical centering.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fs from "fs";
import zlib from "zlib";

function wrapText(text, font, fontSize, maxWidth) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
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

function drawCellText(page, text, font, fontSize, x, yTop, width, height, pad) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return;
  const maxWidth = Math.max(4, width - Math.min(pad, 2) * 2);
  const size = Math.min(fontSize, Math.max(4, height - 1.2));
  const lines = wrapText(cleaned, font, size, maxWidth);
  const lineHeight = Math.min(size * 1.08, Math.max(size, height - 0.6));
  const maxLines = Math.max(1, Math.floor((height - 0.4) / lineHeight));
  const visible = lines.slice(0, maxLines);
  const blockHeight = size + (visible.length - 1) * lineHeight;
  let y = yTop - (height - blockHeight) / 2 - size;
  const maxY = yTop - 0.6 - size * 0.05;
  const minY = yTop - height + 0.4;
  y = Math.min(maxY, Math.max(minY, y));
  for (const line of visible) {
    page.drawText(line, {
      x: x + Math.min(pad, 2),
      y,
      size,
      font,
      color: rgb(0, 0, 0),
      maxWidth,
    });
    y -= lineHeight;
  }
}

const fields = [
  ["Date Of Manufacture", "Jul-26"],
  ["Brand", "Mattress Protector"],
  ["Type", "Fitted"],
  ["Size", "King"],
  ["Material", "Cotton"],
  ["Color", "Blue"],
  ["Style Code", "MP-4120-B"],
  ["Brand Colour", "Blue"],
  ["Net Quantity", "1 U"],
  ["1 U Contains", "1 Mattress Cover"],
  ["Dimensions or Size", "LxBxH - 21x16x6 cm"],
  ["MRP", "Rs. 2299.00"],
  ["Country Of Origin", "India"],
];

const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
const page = pdf.addPage([216, 360]);
const margin = 4;
const tableW = 208;
const fieldH = 9.54;
let y = 280;
const labelW = tableW * 0.36;
for (const [k, v] of fields) {
  page.drawRectangle({
    x: margin,
    y: y - fieldH,
    width: labelW,
    height: fieldH,
    borderColor: rgb(0, 0, 0),
    borderWidth: 0.7,
  });
  page.drawRectangle({
    x: margin + labelW,
    y: y - fieldH,
    width: tableW - labelW,
    height: fieldH,
    borderColor: rgb(0, 0, 0),
    borderWidth: 0.7,
  });
  drawCellText(page, k, bold, 6.4, margin, y, labelW, fieldH, 2.7);
  drawCellText(page, v, font, 6.4, margin + labelW, y, tableW - labelW, fieldH, 2.7);
  y -= fieldH;
}

const bytes = await pdf.save();
const out = new URL("../outputs/field-text-check.pdf", import.meta.url);
fs.mkdirSync(new URL(".", out), { recursive: true });
fs.writeFileSync(out, bytes);

const raw = Buffer.from(bytes);
const marker = raw.indexOf(Buffer.from("stream"));
let start = marker + 6;
if (raw[start] === 0x0d) start++;
if (raw[start] === 0x0a) start++;
const endMarker = raw.indexOf(Buffer.from("endstream"), start);
let slice = raw.subarray(start, endMarker);
if (slice.at(-1) === 0x0a) slice = slice.subarray(0, -1);
if (slice.at(-1) === 0x0d) slice = slice.subarray(0, -1);
const text = zlib.inflateSync(slice).toString("latin1");
const decoded = [...text.matchAll(/<([0-9A-Fa-f]+)>/g)].map((m) => {
  let outStr = "";
  for (let i = 0; i < m[1].length; i += 2)
    outStr += String.fromCharCode(parseInt(m[1].slice(i, i + 2), 16));
  return outStr;
});
console.log("strings", decoded.length);
console.log(decoded.join(" | "));
if (!decoded.includes("Brand") || !decoded.includes("Mattress Protector")) {
  console.error("FAIL: field text missing");
  process.exit(1);
}
console.log("OK wrote", out.pathname);
