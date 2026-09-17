import {
  PDFDocument,
  StandardFonts,
  rgb,
  PDFName,
  type PDFFont,
  type PDFPage,
  LineJoinStyle,
  TextRenderingMode,
  popGraphicsState,
  pushGraphicsState,
  setFillingRgbColor,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  setTextRenderingMode,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import JsBarcode from "jsbarcode";

export type LabelSize = "2x2" | "2x3" | "3x3" | "3x4" | "3x5" | "4x4" | "5x5";
export type BarcodeSource = "EAN" | "FSN";

/** Product master sizes by marketplace. */
export const ALPHA_LABEL_SIZES: readonly LabelSize[] = [
  "3x3",
  "4x4",
  "5x5",
  "3x4",
  "3x5",
  "2x3",
];
export const FBF_LABEL_SIZES: readonly LabelSize[] = [
  "2x2",
  "3x3",
  "4x4",
  "5x5",
  "2x3",
  "3x4",
  "3x5",
];

export function labelSizesForMarketplace(
  marketplace: "Alpha" | "FBF",
): readonly LabelSize[] {
  return marketplace === "FBF" ? FBF_LABEL_SIZES : ALPHA_LABEL_SIZES;
}

export function clampLabelSize(
  size: LabelSize,
  marketplace: "Alpha" | "FBF",
): LabelSize {
  const allowed = labelSizesForMarketplace(marketplace);
  return allowed.includes(size) ? size : allowed[0];
}

export function defaultBarcodeSource(
  marketplace: "Alpha" | "FBF",
): BarcodeSource {
  return marketplace === "FBF" ? "FSN" : "EAN";
}

export function resolveProductBarcode(
  product: { ean: string; fsn: string },
  source: BarcodeSource,
): { value: string; format: "EAN13" | "CODE128" } {
  if (source === "EAN") {
    const ean = String(product.ean || "").replace(/\D/g, "");
    // Prefer real EAN-13 when possible; otherwise fall back to CODE128 so the
    // barcode still prints when the selected source digits are not EAN-13.
    if (/^\d{13}$/.test(ean)) return { value: ean, format: "EAN13" };
    const raw = String(product.ean || "").trim();
    return { value: raw || product.fsn, format: "CODE128" };
  }
  const fsn = String(product.fsn || "").trim();
  return { value: fsn || String(product.ean || "").trim(), format: "CODE128" };
}

export function labelSizeCssInches(size: LabelSize): {
  width: string;
  height: string;
} {
  const [w, h] = size.split("x").map(Number);
  return { width: `${w}in`, height: `${h}in` };
}

export type VectorProduct = {
  marketplace: "Alpha" | "FBF";
  ean: string;
  fsn: string;
  payload: Record<string, unknown>;
};

export type VectorAlphaPack = {
  invoiceNo: string;
  fsn: string;
  qty: string;
  po: string;
  boxNo: string;
};

export type VectorFbfItem = { sku: string; fsn: string; qty: string };
export type VectorFbfPack = {
  consignment: string;
  boxNo: string;
  items: VectorFbfItem[];
};

export type VectorPackagingRun = {
  marketplace: "Alpha" | "FBF";
  payload: Array<VectorAlphaPack | VectorFbfPack>;
};

const PAGE_SIZES: Record<LabelSize, { width: number; height: number }> = {
  "2x2": { width: 144, height: 144 },
  "2x3": { width: 144, height: 216 },
  "3x3": { width: 216, height: 216 },
  "3x4": { width: 216, height: 288 },
  "3x5": { width: 216, height: 360 },
  "4x4": { width: 288, height: 288 },
  "5x5": { width: 360, height: 360 },
};

const BLACK = rgb(0, 0, 0);

/** ~0.6 device px at 203 DPI — only used if Arial cannot be embedded. */
const THERMAL_TEXT_STROKE = 0.22;

function isTrueTypeBytes(bytes: Uint8Array) {
  if (bytes.byteLength < 8) return false;
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  return (
    (bytes[0] === 0x00 &&
      bytes[1] === 0x01 &&
      bytes[2] === 0x00 &&
      bytes[3] === 0x00) ||
    tag === "OTTO" ||
    tag === "true"
  );
}

async function loadArialBytes(): Promise<Uint8Array | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch("/fonts/Arial.ttf");
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (isTrueTypeBytes(bytes)) return bytes;
    }
  } catch {
    /* Helvetica fallback */
  }
  return null;
}

function registerCustomFontkit(pdf: PDFDocument) {
  const kit =
    (fontkit as { default?: typeof fontkit }).default ?? fontkit;
  pdf.registerFontkit(kit);
}

async function embedLabelFont(pdf: PDFDocument): Promise<PDFFont> {
  const arial = await loadArialBytes();
  if (arial) {
    try {
      registerCustomFontkit(pdf);
      return await pdf.embedFont(arial, { subset: true });
    } catch {
      try {
        registerCustomFontkit(pdf);
        return await pdf.embedFont(arial);
      } catch {
        /* Helvetica fallback */
      }
    }
  }
  return pdf.embedFont(StandardFonts.Helvetica);
}

function isHelvetica(font: PDFFont) {
  return /Helvetica/i.test(font.name);
}

function drawSolidBlackText(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  x: number,
  y: number,
) {
  // BarTender TrueType is fill-only. Stroke is a Helvetica fallback so 203 DPI
  // Type1 text does not rasterize to gray.
  if (isHelvetica(font)) {
    page.pushOperators(
      pushGraphicsState(),
      setFillingRgbColor(0, 0, 0),
      setStrokingRgbColor(0, 0, 0),
      setLineWidth(THERMAL_TEXT_STROKE),
      setLineJoin(LineJoinStyle.Round),
      setTextRenderingMode(TextRenderingMode.FillAndOutline),
    );
  }
  page.drawText(text, { x, y, size, font, color: BLACK });
  if (isHelvetica(font)) {
    page.pushOperators(popGraphicsState());
  }
}

const ALPHA_FIELDS: Array<{ label: string; keys: string[] }> = [
  { label: "Date Of Manufacture", keys: ["Date Of Manufacture "] },
  { label: "Brand", keys: ["Brand "] },
  { label: "Type", keys: ["Type"] },
  { label: "Size", keys: ["Size"] },
  { label: "Material", keys: ["Material"] },
  { label: "Color", keys: ["Color"] },
  { label: "Style Code", keys: ["Style Code"] },
  { label: "Brand Colour", keys: ["Brand Colour"] },
  { label: "Net Quantity", keys: ["Net Quantity"] },
  { label: "1 U Contains", keys: ["1 U Contains"] },
  { label: "Dimensions", keys: ["Dimensions", "Dimensions or Size"] },
  { label: "MRP", keys: ["MRP"] },
  { label: "Country Of Origin", keys: ["Country Of Origin"] },
];

const FBF_FIELDS: Array<{ label: string; keys: string[] }> = [
  { label: "Brand", keys: ["brand"] },
  { label: "FSN", keys: ["FSN"] },
  { label: "Model Name", keys: ["Model_name", "model_name"] },
  { label: "Model Number", keys: ["Model_number", "model_number"] },
  { label: "Color", keys: ["Color", "color"] },
  { label: "EAN", keys: ["EAN", "Ean"] },
  { label: "Type", keys: ["Type", "type"] },
  { label: "Size", keys: ["Size", "size"] },
  { label: "Net Quantity", keys: ["Net quantity"] },
  { label: "Generic Name", keys: ["Generic name"] },
  { label: "Dimension", keys: ["Dimension"] },
  { label: "MRP", keys: ["MRP"] },
  {
    label: "Month And Year Of Manufactured",
    keys: [
      "Month and year of manufactured",
      "month and year of manufactured",
    ],
  },
];

const FBF_COMPANY_KEYS = [
  "Manufactured & Marketed by &\r\n Customer Care Details",
  "Manufactured & Marketed by & Customer Care Details",
  "manufactured by/Marketed by & customer care details",
];

const FBF_COMPANY_LABEL = "Manufactured By/Marketed By & Customer Care Details";

/** Title-case label text; keep FSN/EAN/MRP/U as acronyms. */
export function toLabelCase(text: string): string {
  const acronyms = new Set(["fsn", "ean", "mrp", "u", "po", "sku", "id"]);
  return String(text ?? "")
    .replace(/_/g, " ")
    .split(/(\s+|\/|&|\n)/)
    .map((token) => {
      if (!token || token === "\n" || /^[\s\/&]+$/.test(token)) return token;
      const lower = token.toLowerCase();
      if (acronyms.has(lower)) return lower.toUpperCase();
      // Keep short all-caps tokens (e.g. "Rs.") mostly intact on first letter.
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join("");
}

function compactInclusiveTaxes(text: string) {
  return text.replace(
    /\(\s*Inclusive\s+Of\s+All\s+Taxes\s*\)/gi,
    "(Inc of all taxes)",
  );
}

/** Title-case values, but leave codes / emails / pure IDs unchanged. */
export function toValueCase(text: string): string {
  const raw = String(text ?? "");
  const trimmed = raw.trim();
  if (!trimmed) return raw;
  if (/@/.test(trimmed) || /^https?:\/\//i.test(trimmed)) return raw;
  const compact = trimmed.replace(/\s+/g, "");
  if (/^\d{8,}$/.test(compact)) return raw; // EAN-like
  if (/^[A-Z0-9]{10,}$/.test(compact)) return raw; // FSN-like
  const titled = trimmed
    .split("\n")
    .map((line) => toLabelCase(line.trim()))
    .join("\n");
  return compactInclusiveTaxes(titled);
}

function normalizeHeader(key: string) {
  return key.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Previous calendar month as Mon-YY (e.g. adding in August → Jul-26). */
export function previousMonthManufactureLabel(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return d
    .toLocaleDateString("en-US", { month: "short", year: "2-digit" })
    .replace(" ", "-");
}

const MANUFACTURE_DATE_HEADERS = new Set(
  [
    "Date Of Manufacture ",
    "Date Of Manufacture",
    "Month and year of manufactured",
    "month and year of manufactured",
  ].map(normalizeHeader),
);

export function isManufactureDateKey(key: string) {
  return MANUFACTURE_DATE_HEADERS.has(normalizeHeader(key));
}

/** Force Date of Manufacture / month-year fields to previous calendar month. */
export function applyPreviousMonthManufactureDate(
  payload: Record<string, unknown>,
  marketplace: "Alpha" | "FBF",
) {
  const label = previousMonthManufactureLabel();
  let found = false;
  for (const key of Object.keys(payload)) {
    if (isManufactureDateKey(key)) {
      payload[key] = label;
      found = true;
    }
  }
  if (!found) {
    if (marketplace === "FBF") {
      payload["month and year of manufactured"] = label;
    } else {
      payload["Date Of Manufacture "] = label;
    }
  }
}

function fieldValue(
  payload: Record<string, unknown>,
  ...keys: string[]
): string {
  if (keys.some(isManufactureDateKey)) {
    return previousMonthManufactureLabel();
  }
  for (const key of keys) {
    if (payload[key] !== undefined && payload[key] !== null) {
      const text = String(payload[key]).trim();
      if (text) return text;
    }
  }
  const entries = Object.entries(payload);
  for (const key of keys) {
    const want = normalizeHeader(key);
    const hit = entries.find(
      ([k, v]) =>
        normalizeHeader(k) === want &&
        v !== undefined &&
        v !== null &&
        String(v).trim() !== "",
    );
    if (hit) return String(hit[1]).trim();
  }
  return "";
}

function isThermalSquare(labelSize: LabelSize) {
  return labelSize === "3x3" || labelSize === "4x4" || labelSize === "5x5";
}

/** Side length in inches for square thermal labels. */
function squareSide(labelSize: LabelSize) {
  if (labelSize === "5x5") return 5;
  if (labelSize === "4x4") return 4;
  return 3;
}

/** Scale factor vs the 3×3 master (same design, true 1:1 inches). */
function squareScale(labelSize: LabelSize) {
  return squareSide(labelSize) / 3;
}

/** Typography for 203 DPI thermal-transfer (TSC TTP-244 Pro).
 *  Regular Helvetica only in the PDF (standard vector font; not Bold).
 *  Square sizes share one 3×3 master scaled by side/3. */
function sizeScale(labelSize: LabelSize) {
  const square = (side: number) => {
    const k = side / 3;
    return {
      title: 11 * k,
      body: 8.5 * k,
      small: 8.5 * k,
      pad: 1.2 * k,
      ean: 8.5 * k,
      line: 1.18,
    };
  };
  switch (labelSize) {
    case "3x5":
      return { title: 7.4, body: 6.5, small: 6.2, pad: 2.0, ean: 11, line: 1.12 };
    case "3x4":
      // BarTender Arial Regular on 3×4 is ~7pt body. 9–10.5pt fills the cells.
      return { title: 8, body: 7, small: 6.5, pad: 1.6, ean: 9.5, line: 1.12 };
    case "3x3":
      return square(3);
    case "4x4":
      return square(4);
    case "5x5":
      return square(5);
    case "2x3":
      return { title: 4.6, body: 4.1, small: 3.8, pad: 1.2, ean: 7, line: 1.04 };
    case "2x2":
      return { title: 3.8, body: 3.4, small: 3.2, pad: 0.9, ean: 5.2, line: 1.02 };
  }
}

/** Floor for 3×3 field rows that are shorter than 9pt after barcode is reserved. */
function thermalTextFloor(labelSize: LabelSize) {
  switch (labelSize) {
    case "5x5":
    case "4x4":
      return 6.2;
    case "3x3":
      return 5.8;
    case "3x4":
      return 6.2;
    case "3x5":
      return 6;
    case "2x3":
      return 4.5;
    case "2x2":
      return 3.4;
  }
}

function pageMargin(labelSize: LabelSize) {
  if (labelSize === "2x2") return 1.0;
  if (labelSize === "2x3") return 1.2;
  if (labelSize === "3x3") return 6;
  if (labelSize === "4x4") return 7;
  if (labelSize === "5x5") return 8;
  if (labelSize === "3x4") return 8;
  if (labelSize === "3x5") return 8;
  return 2;
}

/** Label-column share — wider on narrow stickers so long labels don't hit the divider. */
function labelColumnRatio(
  labelSize: LabelSize,
  marketplace: "Alpha" | "FBF",
) {
  if (marketplace === "FBF") {
    if (labelSize === "2x2") return 0.42;
    if (labelSize === "2x3") return 0.4;
    if (labelSize === "3x3" || labelSize === "4x4" || labelSize === "5x5")
      return 0.39;
    if (labelSize === "3x4") return 0.4;
    return 0.38;
  }
  if (labelSize === "2x3") return 0.4;
  if (labelSize === "3x4") return 0.39;
  return LABEL_RATIO;
}

function alphaBandHeights(labelSize: LabelSize) {
  // Prefer field-row clearance over oversized barcodes on compact stickers.
  switch (labelSize) {
    case "3x5":
      return { titleH: 14, addressH: 30, complaintsH: 28, barcodeH: 96 };
    case "3x4":
      return { titleH: 18, addressH: 32, complaintsH: 36, barcodeH: 51 };
    case "3x3":
      return { titleH: 18, addressH: 28, complaintsH: 28, barcodeH: 46 };
    case "4x4":
      return { titleH: 22, addressH: 34, complaintsH: 34, barcodeH: 56 };
    case "5x5":
      return { titleH: 26, addressH: 40, complaintsH: 40, barcodeH: 68 };
    case "2x3":
      return { titleH: 9, addressH: 16, complaintsH: 14, barcodeH: 44 };
    default:
      return { titleH: 10, addressH: 18, complaintsH: 16, barcodeH: 52 };
  }
}

function fbfBandHeights(labelSize: LabelSize) {
  switch (labelSize) {
    case "3x5":
      return { titleH: 15, companyH: 32, barcodeH: 70 };
    case "3x4":
      return { titleH: 18, companyH: 40, barcodeH: 51 };
    case "3x3":
      return { titleH: 18, companyH: 28, barcodeH: 46 };
    case "4x4":
      return { titleH: 22, companyH: 34, barcodeH: 56 };
    case "5x5":
      return { titleH: 26, companyH: 40, barcodeH: 68 };
    case "2x3":
      return { titleH: 10, companyH: 18, barcodeH: 38 };
    case "2x2":
      return { titleH: 8, companyH: 14, barcodeH: 30 };
  }
}

function barcodeDrawSpec(labelSize: LabelSize, format: "EAN13" | "CODE128") {
  const wide = format === "EAN13" || format === "CODE128";
  if (isThermalSquare(labelSize)) {
    const k = squareScale(labelSize);
    return {
      widthRatio: 0.9,
      barH: (format === "EAN13" ? 30 : 26) * k,
      bottomPad: 1.75 * k,
      gap: 1.5 * k,
      topPad: 0.75 * k,
      wide,
    };
  }
  switch (labelSize) {
    case "3x5":
      return {
        widthRatio: 0.92,
        barH: format === "EAN13" ? 66 : 56,
        bottomPad: 5,
        gap: 3.5,
        topPad: 4,
        wide,
      };
    case "3x4":
      return {
        widthRatio: 0.9,
        barH: format === "EAN13" ? 32 : 28,
        bottomPad: 3.5,
        gap: 1.5,
        topPad: 1,
        wide,
      };
    case "2x3":
      return {
        widthRatio: 0.9,
        barH: format === "EAN13" ? 40 : 34,
        bottomPad: 3,
        gap: 2,
        topPad: 2.5,
        wide,
      };
    case "2x2":
      return {
        widthRatio: 0.9,
        barH: format === "EAN13" ? 24 : 20,
        bottomPad: 2,
        gap: 1.5,
        topPad: 1.5,
        wide,
      };
    default:
      return {
        widthRatio: 0.9,
        barH: format === "EAN13" ? 30 : 26,
        bottomPad: 1.75,
        gap: 1.5,
        topPad: 0.75,
        wide,
      };
  }
}

// 203 DPI: 1 device pixel ≈ 0.355pt. Inner hairline ≈ 0.8px (snaps to 1px);
// outer is a full device pixel so the die-cut edge stays visible without a heavy box.
const OUTER_BORDER = 0.35;
const INNER_BORDER = 0.28;
const LABEL_RATIO = 0.363; // matches Terry Blue column split (~92.8 / 255.8)

/** 3×4-only stroke weights. Other sizes keep OUTER_BORDER / INNER_BORDER. */
function borderSpec(labelSize: LabelSize) {
  if (labelSize === "3x4") return { outer: 0.5, inner: 0.4 };
  return { outer: OUTER_BORDER, inner: INNER_BORDER };
}

function usesExpandedTable(labelSize: LabelSize) {
  return isThermalSquare(labelSize) || labelSize === "3x4";
}

function pdfSafe(text: string) {
  return text
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u00A0/g, " ")
    .replace(/—/g, "-");
}

function strokeOuter(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  thickness = OUTER_BORDER,
) {
  // pdf-lib centers the stroke on the path — inset by half so the full
  // top/side lines stay on the page (avoids an "open" top box when clipped).
  const inset = thickness / 2;
  page.drawRectangle({
    x: x + inset,
    y: y + inset,
    width: Math.max(1, w - thickness),
    height: Math.max(1, h - thickness),
    borderColor: BLACK,
    borderWidth: thickness,
  });
}

function hLine(
  page: PDFPage,
  x1: number,
  x2: number,
  y: number,
  thickness = INNER_BORDER,
) {
  page.drawLine({
    start: { x: x1, y },
    end: { x: x2, y },
    thickness,
    color: BLACK,
  });
}

function vLine(
  page: PDFPage,
  x: number,
  y1: number,
  y2: number,
  thickness = INNER_BORDER,
) {
  page.drawLine({
    start: { x, y: y1 },
    end: { x, y: y2 },
    thickness,
    color: BLACK,
  });
}

async function drawBarcodeInArea(
  pdf: PDFDocument,
  page: PDFPage,
  value: string,
  format: "EAN13" | "CODE128",
  font: PDFFont,
  labelSize: LabelSize,
  x: number,
  yTop: number,
  width: number,
  height: number,
) {
  const s = sizeScale(labelSize);
  const png = await makeBarcodePng(value, format);
  const image = await pdf.embedPng(png);
  const eanSize = s.ean;
  const yBottom = yTop - height;
  const spec = barcodeDrawSpec(labelSize, format);

  let drawW: number;
  let drawH: number;
  let textY: number;
  let imageY: number;

  if (spec.wide) {
    const { bottomPad, gap, topPad, widthRatio, barH } = spec;
    drawW = width * widthRatio;
    drawH = barH;
    const stackH = drawH + gap + eanSize;
    const usable = height - bottomPad - topPad;
    const lift = Math.max(0, (usable - stackH) / 2);
    textY = yBottom + bottomPad + lift;
    imageY = textY + eanSize + gap;
    if (imageY + drawH > yTop - topPad) {
      drawH = Math.max(12, yTop - topPad - imageY);
    }
    drawH = Math.max(12, drawH);
  } else {
    const textH = eanSize + 5;
    const innerPad = 2.5;
    const contentTop = yTop - innerPad;
    const contentBottom = yBottom + textH + innerPad;
    const availH = Math.max(14, contentTop - contentBottom);
    const maxW = width * 0.78;
    const maxH = Math.min(40, availH);
    drawW = maxW;
    drawH = image.height * (maxW / image.width);
    if (drawH > maxH) {
      drawH = maxH;
      drawW = image.width * (maxH / image.height);
    }
    textY = yBottom + innerPad;
    const by = contentBottom + (availH - drawH) / 2;
    imageY = Math.max(contentBottom, Math.min(by, contentTop - drawH));
  }

  page.drawImage(image, {
    x: x + (width - drawW) / 2,
    y: imageY,
    width: drawW,
    height: drawH,
  });
  const safe = pdfSafe(value);
  const textW = font.widthOfTextAtSize(safe, eanSize);
  drawSolidBlackText(
    page,
    safe,
    font,
    eanSize,
    x + (width - textW) / 2,
    textY,
  );
}

function wrapText(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [""];
  const words = cleaned.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, fontSize) <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      if (font.widthOfTextAtSize(word, fontSize) <= maxWidth) {
        current = word;
      } else {
        let chunk = "";
        for (const ch of word) {
          const trial = chunk + ch;
          if (font.widthOfTextAtSize(trial, fontSize) <= maxWidth) chunk = trial;
          else {
            if (chunk) lines.push(chunk);
            chunk = ch;
          }
        }
        current = chunk;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function wrapTextMeasured(
  text: string,
  fontSize: number,
  maxWidth: number,
  measure: (text: string, size: number) => number,
): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [""];
  const words = cleaned.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (measure(next, fontSize) <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      if (measure(word, fontSize) <= maxWidth) {
        current = word;
      } else {
        let chunk = "";
        for (const ch of word) {
          const trial = chunk + ch;
          if (measure(trial, fontSize) <= maxWidth) chunk = trial;
          else {
            if (chunk) lines.push(chunk);
            chunk = ch;
          }
        }
        current = chunk;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function countContentLines(
  text: string,
  fontSize: number,
  maxWidth: number,
  measure: (text: string, size: number) => number,
) {
  const paragraphs = pdfSafe(text)
    .split(/\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!paragraphs.length) return 1;
  return Math.max(
    1,
    paragraphs.flatMap((p) => wrapTextMeasured(p, fontSize, maxWidth, measure))
      .length,
  );
}

type RowNeed = { height: number; lines: number };

/** Height a pair-row must keep so wrapped label/value text never hits the border. */
function pairRowNeed(
  label: string,
  value: string,
  fontSize: number,
  labelW: number,
  valueW: number,
  padX: number,
  padY: number,
  lineRatio: number,
  measure: (text: string, size: number) => number,
  /** Extra clearance for hairline borders (border-box). */
  borderClearance = 1.2,
): RowNeed {
  // Slightly narrow measure width so we over-count wraps vs real CSS (safer).
  const measureW = (cellW: number) =>
    Math.max(3, cellW - Math.max(padX, 0.7) * 2) * 0.94;
  const labelLines = countContentLines(
    label,
    fontSize,
    measureW(labelW),
    measure,
  );
  const valueLines = countContentLines(
    value,
    fontSize,
    measureW(valueW),
    measure,
  );
  const lines = Math.max(labelLines, valueLines, 1);
  const height =
    padY * 2 + lines * fontSize * lineRatio + borderClearance;
  return { height, lines };
}

/** Largest table-body pt size that fits title (fixed) + wrapped specials + 1-line fields + barcode. */
function pickUniformPt(args: {
  usableH: number;
  tableW: number;
  marketplace: "Alpha" | "FBF";
  labelSize: LabelSize;
  title: string;
  fieldPairs: Array<{ label: string; value: string }>;
  specials: Array<{ label: string; value: string }>;
  measure: (text: string, size: number) => number;
  unitScale?: number;
  barcodeMin: number;
  titlePt: number;
  pad: number;
  line: number;
  maxPt?: number;
  minPt?: number;
}): number {
  const unitScale = args.unitScale ?? 1;
  const maxPt = args.maxPt ?? 9;
  const minPt = args.minPt ?? 5.5;
  const pad = args.pad;
  const line = args.line;
  const labelRatio = labelColumnRatio(args.labelSize, args.marketplace);
  const labelW = args.tableW * labelRatio;
  const valueW = args.tableW - labelW;
  const padY = Math.max(0.5 * unitScale, pad * 0.7);

  for (let size = maxPt; size >= minPt - 0.001; size -= 0.25) {
    const titleH = pairRowNeed(
      args.title,
      "",
      args.titlePt,
      args.tableW,
      args.tableW,
      pad,
      padY,
      line,
      args.measure,
      1.25 * unitScale,
    ).height;
    let specialH = 0;
    for (const block of args.specials) {
      specialH += pairRowNeed(
        block.label,
        block.value,
        size,
        labelW,
        valueW,
        pad,
        padY,
        line,
        args.measure,
        1.6 * unitScale,
      ).height;
    }
    const fieldHeights = args.fieldPairs.map(
      (pair) =>
        pairRowNeed(
          pair.label,
          pair.value,
          size,
          labelW,
          valueW,
          pad,
          padY,
          line,
          args.measure,
          1.25 * unitScale,
        ).height,
    );
    const fieldH =
      Math.max(0, ...fieldHeights) * Math.max(1, args.fieldPairs.length);
    if (titleH + specialH + fieldH + args.barcodeMin <= args.usableH + 0.4) {
      return size;
    }
  }
  return minPt;
}

function fitThermalSquareBody<
  T extends { title: number; body: number; small: number; pad: number; line: number },
>(
  labelSize: LabelSize,
  type: T,
  args: {
    usableH: number;
    tableW: number;
    marketplace: "Alpha" | "FBF";
    title: string;
    fieldPairs: Array<{ label: string; value: string }>;
    specials: Array<{ label: string; value: string }>;
    measure: (text: string, size: number) => number;
    unitScale?: number;
  },
): T {
  if (!isThermalSquare(labelSize)) return type;
  const unitScale = args.unitScale ?? 1;
  const body = pickUniformPt({
    ...args,
    labelSize,
    unitScale,
    barcodeMin: barcodeHeightSlot(labelSize, unitScale).min,
    titlePt: type.title,
    pad: type.pad,
    line: type.line,
    maxPt: type.body,
    minPt: thermalTextFloor(labelSize) * unitScale,
  });
  return { ...type, body, small: body };
}

export type HeightSlot = {
  key: string;
  min: number;
  prefer: number;
  /** Lower keep = shrink first when space is tight (barcode=0, fields=1, address=3). */
  keep: number;
};

/**
 * Uniform field rows. On square thermal labels leftover height goes into
 * those rows (padding), not the barcode band.
 */
export function allocateRowHeights(
  usableH: number,
  slots: HeightSlot[],
  options?: { spareTo?: "barcode" | "fields"; honorFieldMins?: boolean },
): Record<string, number> {
  const spareTo = options?.spareTo ?? "barcode";
  const bi = slots.findIndex((s) => s.key === "barcode");
  const fieldIdx = slots
    .map((s, i) => (s.key.startsWith("field-") ? i : -1))
    .filter((i) => i >= 0);
  const specialIdx = slots
    .map((s, i) =>
      s.key === "company" ||
      s.key === "address" ||
      s.key === "complaints" ||
      s.key === "title"
        ? i
        : -1,
    )
    .filter((i) => i >= 0);

  const heights = slots.map((s) => s.min);

  // Title / company / address: content-tight (prefer only for title band).
  for (const i of specialIdx) {
    const s = slots[i];
    heights[i] =
      s.key === "title" ? Math.max(s.min, s.prefer) : s.min;
  }

  // Lock barcode at prefer so scanning area is stable — not inflated by leftover.
  if (bi >= 0) {
    heights[bi] = Math.max(slots[bi].min, slots[bi].prefer);
  }

  const sum = () => heights.reduce((a, b) => a + b, 0);
  const nonFieldSum = () =>
    heights.reduce((a, h, i) => (fieldIdx.includes(i) ? a : a + h), 0);

  // All data fields share leftover space. Do not force them to a content
  // floor that overflows the sticker and clips address / customer care.
  if (fieldIdx.length) {
    const room = usableH - nonFieldSum();
    const each = room / fieldIdx.length;
    for (const i of fieldIdx) heights[i] = Math.max(0, each);
  }

  // If overfull: shrink barcode toward min, then field rows. Never shrink
  // address / customer-care / title — those hold the full sheet text.
  let over = sum() - usableH;
  if (over > 0.05 && bi >= 0) {
    const take = Math.min(over, heights[bi] - slots[bi].min);
    heights[bi] -= take;
    over -= take;
  }
  if (over > 0.05 && fieldIdx.length) {
    const nonField = sum() - fieldIdx.reduce((a, i) => a + heights[i], 0);
    const room = Math.max(0, usableH - nonField);
    const each = room / fieldIdx.length;
    for (const i of fieldIdx) heights[i] = Math.max(0, each);
  }

  const spare = usableH - sum();
  if (spare > 0.05) {
    const giveToFields = spareTo === "fields" && fieldIdx.length;
    if (giveToFields) {
      const each = spare / fieldIdx.length;
      for (const i of fieldIdx) heights[i] += each;
    } else if (bi >= 0) {
      heights[bi] += spare;
    } else if (fieldIdx.length) {
      const each = spare / fieldIdx.length;
      for (const i of fieldIdx) heights[i] += each;
    }
  }

  // 3×4: wrapped values (e.g. MRP + taxes) keep their 2-line floor by
  // borrowing height from 1-line siblings — barcode/specials stay put.
  if (options?.honorFieldMins && fieldIdx.length) {
    const need = fieldIdx.map((i) => Math.max(0, slots[i].min - heights[i]));
    const deficit = need.reduce((a, d) => a + d, 0);
    const surplusIdx = fieldIdx.filter((i) => heights[i] > slots[i].min + 0.05);
    const surplus = surplusIdx.reduce(
      (a, i) => a + (heights[i] - slots[i].min),
      0,
    );
    const take = Math.min(deficit, surplus);
    if (take > 0.05 && surplus > 0.05) {
      for (const i of surplusIdx) {
        heights[i] -= ((heights[i] - slots[i].min) / surplus) * take;
      }
      for (let n = 0; n < fieldIdx.length; n++) {
        if (need[n] <= 0) continue;
        heights[fieldIdx[n]] += (need[n] / deficit) * take;
      }
    }
  }

  const drift = usableH - sum();
  if (Math.abs(drift) > 0.05) {
    if (spareTo === "fields" && fieldIdx.length) {
      const each = drift / fieldIdx.length;
      for (const i of fieldIdx) heights[i] = Math.max(0, heights[i] + each);
    } else {
      const idx = bi >= 0 ? bi : heights.length - 1;
      const floor = bi >= 0 ? slots[bi].min : slots[idx].min * 0.5;
      heights[idx] = Math.max(floor, heights[idx] + drift);
    }
  }

  const out: Record<string, number> = {};
  slots.forEach((s, i) => {
    out[s.key] = heights[i];
  });
  return out;
}

function barcodeHeightSlot(labelSize: LabelSize, scale = 1): HeightSlot {
  const S = (n: number) => n * scale;
  if (isThermalSquare(labelSize)) {
    const k = squareScale(labelSize);
    // Shorter band than the old 56/64pt 3×3 slot; bars stay scannable.
    return { key: "barcode", min: S(46 * k), prefer: S(48 * k), keep: 0 };
  }
  switch (labelSize) {
    case "3x5":
      return { key: "barcode", min: S(76), prefer: S(98), keep: 0 };
    case "3x4":
      return { key: "barcode", min: S(48), prefer: S(51), keep: 0 };
    case "2x3":
      return { key: "barcode", min: S(48), prefer: S(64), keep: 0 };
    case "2x2":
      return { key: "barcode", min: S(32), prefer: S(42), keep: 0 };
    default:
      return { key: "barcode", min: S(46), prefer: S(48), keep: 0 };
  }
}

function titleHeightSlot(
  labelSize: LabelSize,
  marketplace: "Alpha" | "FBF",
  scale = 1,
): HeightSlot {
  const bands =
    marketplace === "FBF"
      ? fbfBandHeights(labelSize).titleH
      : alphaBandHeights(labelSize).titleH;
  const h = bands * scale;
  return {
    key: "title",
    min: Math.max(7 * scale, h - scale),
    prefer: h,
    keep: 2,
  };
}

export type SmartLabelLayout = {
  title: number;
  fields: number[];
  special: number[]; // Alpha: [address, complaints]; FBF: [company]
  barcode: number;
};

function measureFromFont(font: PDFFont) {
  return (text: string, size: number) => font.widthOfTextAtSize(text, size);
}

function slotFromNeed(key: string, need: RowNeed, keepSingle: number): HeightSlot {
  // Content floor only — spare space is equalized across fields / given to barcode.
  return {
    key,
    min: need.height,
    prefer: need.height,
    keep: keepSingle,
  };
}

function buildFbfSmartLayout(
  labelSize: LabelSize,
  tableW: number,
  usableH: number,
  title: string,
  fieldPairs: Array<{ label: string; value: string }>,
  companyLabel: string,
  companyValue: string,
  measure: (text: string, size: number) => number,
  type: { title: number; body: number; small: number; pad: number; line: number },
  /** 1 for PDF points; 96/72 when laying out in CSS pixels. */
  unitScale = 1,
): SmartLabelLayout {
  const labelRatio = labelColumnRatio(labelSize, "FBF");
  const labelW = tableW * labelRatio;
  const valueW = tableW - labelW;
  const padY = Math.max(0.5 * unitScale, type.pad * 0.7);

  const fieldSlots = fieldPairs.map((pair, i) =>
    slotFromNeed(
      `field-${i}`,
      pairRowNeed(
        pair.label,
        pair.value,
        type.body,
        labelW,
        valueW,
        type.pad,
        padY,
        type.line,
        measure,
        1.25 * unitScale,
      ),
      1,
    ),
  );
  const companySlot = slotFromNeed(
    "company",
    pairRowNeed(
      companyLabel,
      companyValue,
      type.small,
      labelW,
      valueW,
      type.pad,
      padY,
      type.line,
      measure,
      1.6 * unitScale,
    ),
    4,
  );
  if (labelSize === "3x4") {
    const floor = fbfBandHeights("3x4").companyH * unitScale;
    companySlot.min = Math.max(companySlot.min, floor);
    companySlot.prefer = Math.max(companySlot.prefer, floor);
  }
  const titleNeed = pairRowNeed(
    title,
    "",
    type.title,
    tableW,
    tableW,
    type.pad,
    padY,
    type.line,
    measure,
    1.25 * unitScale,
  );
  const titleSlot = titleHeightSlot(labelSize, "FBF", unitScale);
  titleSlot.min = Math.max(titleSlot.min, titleNeed.height);
  titleSlot.prefer = Math.max(titleSlot.prefer, titleNeed.height);

  const slots: HeightSlot[] = [
    titleSlot,
    ...fieldSlots,
    companySlot,
    barcodeHeightSlot(labelSize, unitScale),
  ];

  const allocated = allocateRowHeights(usableH, slots, {
    spareTo: usesExpandedTable(labelSize) ? "fields" : "barcode",
    honorFieldMins: labelSize === "3x4",
  });
  return {
    title: allocated.title,
    fields: fieldPairs.map((_, i) => allocated[`field-${i}`]),
    special: [allocated.company],
    barcode: allocated.barcode,
  };
}

function buildAlphaSmartLayout(
  labelSize: LabelSize,
  tableW: number,
  usableH: number,
  fieldPairs: Array<{ label: string; value: string }>,
  addressLabel: string,
  addressValue: string,
  careLabel: string,
  careValue: string,
  measure: (text: string, size: number) => number,
  type: { title: number; body: number; small: number; pad: number; line: number },
  unitScale = 1,
): SmartLabelLayout {
  const labelRatio = labelColumnRatio(labelSize, "Alpha");
  const labelW = tableW * labelRatio;
  const valueW = tableW - labelW;
  const padY = Math.max(0.5 * unitScale, type.pad * 0.7);

  const addressSlot = slotFromNeed(
    "address",
    pairRowNeed(
      addressLabel,
      addressValue,
      type.small,
      labelW,
      valueW,
      type.pad,
      padY,
      type.line,
      measure,
      1.6 * unitScale,
    ),
    4,
  );
  const fieldSlots = fieldPairs.map((pair, i) =>
    slotFromNeed(
      `field-${i}`,
      pairRowNeed(
        pair.label,
        pair.value,
        type.body,
        labelW,
        valueW,
        type.pad,
        padY,
        type.line,
        measure,
        1.25 * unitScale,
      ),
      1,
    ),
  );
  const complaintsSlot = slotFromNeed(
    "complaints",
    pairRowNeed(
      careLabel,
      careValue,
      type.small,
      labelW,
      valueW,
      type.pad,
      padY,
      type.line,
      measure,
      1.6 * unitScale,
    ),
    3,
  );
  if (labelSize === "3x4") {
    const bands = alphaBandHeights("3x4");
    const addressFloor = bands.addressH * unitScale;
    const careFloor = bands.complaintsH * unitScale;
    addressSlot.min = Math.max(addressSlot.min, addressFloor);
    addressSlot.prefer = Math.max(addressSlot.prefer, addressFloor);
    complaintsSlot.min = Math.max(complaintsSlot.min, careFloor);
    complaintsSlot.prefer = Math.max(complaintsSlot.prefer, careFloor);
  }

  const slots: HeightSlot[] = [
    titleHeightSlot(labelSize, "Alpha", unitScale),
    addressSlot,
    ...fieldSlots,
    complaintsSlot,
    barcodeHeightSlot(labelSize, unitScale),
  ];

  const allocated = allocateRowHeights(usableH, slots, {
    spareTo: usesExpandedTable(labelSize) ? "fields" : "barcode",
    honorFieldMins: labelSize === "3x4",
  });
  return {
    title: allocated.title,
    fields: fieldPairs.map((_, i) => allocated[`field-${i}`]),
    special: [allocated.address, allocated.complaints],
    barcode: allocated.barcode,
  };
}

/** CSS type tokens matching globals.css --lt-* (values in px at 96dpi). */
function cssTypeScale(labelSize: LabelSize) {
  const pt = (n: number) => n * (96 / 72);
  if (isThermalSquare(labelSize)) {
    const s = sizeScale(labelSize);
    return {
      title: pt(s.title),
      body: pt(s.body),
      small: pt(s.small),
      pad: pt(s.pad),
      line: s.line,
    };
  }
  switch (labelSize) {
    case "2x2":
      return {
        title: pt(5),
        body: pt(4),
        small: pt(3.6),
        pad: pt(1.2),
        line: 1.1,
      };
    case "2x3":
      return {
        title: pt(5.5),
        body: pt(4.6),
        small: pt(4.2),
        pad: pt(1.4),
        line: 1.1,
      };
    case "3x4": {
      const s = sizeScale("3x4");
      return {
        title: pt(s.title),
        body: pt(s.body),
        small: pt(s.small),
        pad: pt(s.pad),
        line: s.line,
      };
    }
    case "3x5":
      return {
        title: pt(7),
        body: pt(6.5),
        small: pt(6),
        pad: pt(2),
        line: 1.12,
      };
    default:
      return {
        title: pt(9),
        body: pt(8.5),
        small: pt(8.5),
        pad: pt(1.2),
        line: 1.18,
      };
  }
}

/** Wider approx glyphs so preview over-estimates wraps (prevents hidden text). */
function approxTextWidth(text: string, fontSize: number) {
  let w = 0;
  for (const ch of text) {
    if (ch === " ") w += fontSize * 0.3;
    else if ("ilI|.,:;!'`".includes(ch)) w += fontSize * 0.3;
    else if ("mwMW@".includes(ch)) w += fontSize * 0.85;
    else w += fontSize * 0.62;
  }
  return w;
}

/** CSS-pixel smart layout for on-screen / HTML print preview. */
export function computeSmartLabelLayoutPx(
  marketplace: "Alpha" | "FBF",
  labelSize: LabelSize,
  product: {
    fsn: string;
    payload: Record<string, unknown>;
  },
): SmartLabelLayout {
  const [wIn, hIn] = labelSize.split("x").map(Number);
  // Physical sticker in CSS px; subtract outer border so rows fit inside the box.
  const border = 2;
  const tableW = wIn * 96 - border;
  const usableH = hIn * 96 - border;
  let type = cssTypeScale(labelSize);
  const measure = approxTextWidth;
  const unitScale = 96 / 72;

  if (marketplace === "FBF") {
    const companyLabel = FBF_COMPANY_LABEL;
    const companyCombined = fieldValue(product.payload, ...FBF_COMPANY_KEYS);
    const companyValue = [
      companyCombined,
      fieldValue(product.payload, "Mobile"),
      fieldValue(product.payload, "Email"),
    ]
      .filter(Boolean)
      .join("\n");
    const fieldPairs = FBF_FIELDS.map((field) => ({
      label: field.label,
      value: fieldValue(product.payload, ...field.keys),
    }));
    const titleText =
      fieldValue(product.payload, "Category") || product.fsn;
    if (isThermalSquare(labelSize)) {
      type = fitThermalSquareBody(labelSize, type, {
        usableH,
        tableW,
        marketplace: "FBF",
        title: titleText,
        fieldPairs,
        specials: [{ label: companyLabel, value: companyValue }],
        measure,
        unitScale,
      });
    }
    return buildFbfSmartLayout(
      labelSize,
      tableW,
      usableH,
      titleText,
      fieldPairs,
      companyLabel,
      companyValue,
      measure,
      type,
      unitScale,
    );
  }

  const marketedCombined = fieldValue(
    product.payload,
    "Marketed & Manufactured By",
  );
  const marketed = fieldValue(product.payload, "Marketed By / Imported By");
  const manufactured = fieldValue(product.payload, "Manufactured By ") || "-";
  const addressLabel = marketedCombined
    ? "Marketed &\nManufactured By"
    : "Marketed By / Imported By\nManufactured By";
  const addressValue = marketedCombined
    ? marketedCombined
    : `${marketed}\n${manufactured}`;
  const careCombined = fieldValue(product.payload, "Customer Care Details");
  const careValue = careCombined
    ? careCombined
    : [
        fieldValue(product.payload, "For Consumer Complaints"),
        fieldValue(product.payload, "Customer Care Address", "__EMPTY"),
        fieldValue(product.payload, "Customer Care Email", "__EMPTY_1"),
      ]
        .filter(Boolean)
        .join("\n");
  const careLabel = careCombined
    ? "Customer Care Details"
    : "For Consumer Complaints";
  const fieldPairs = ALPHA_FIELDS.map((field) => ({
    label: field.label,
    value: fieldValue(product.payload, ...field.keys),
  }));
  if (isThermalSquare(labelSize)) {
    type = fitThermalSquareBody(labelSize, type, {
      usableH,
      tableW,
      marketplace: "Alpha",
      title: product.fsn,
      fieldPairs,
      specials: [
        { label: addressLabel, value: addressValue },
        { label: careLabel, value: careValue },
      ],
      measure,
      unitScale,
    });
  }
  return buildAlphaSmartLayout(
    labelSize,
    tableW,
    usableH,
    fieldPairs,
    addressLabel,
    addressValue,
    careLabel,
    careValue,
    measure,
    type,
    96 / 72,
  );
}

async function makeBarcodePng(
  text: string,
  format: "EAN13" | "CODE128",
): Promise<Uint8Array> {
  if (typeof document === "undefined") {
    throw new Error("Barcode rendering requires a browser environment.");
  }
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, text, {
    format,
    displayValue: false,
    margin: 0,
    // Wider / taller EAN source for Alpha 3x5 PDF stretch.
    height: format === "EAN13" ? 180 : 90,
    width: format === "EAN13" ? 4.0 : 1.5,
    background: "#ffffff",
    lineColor: "#000000",
  });
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) =>
        value ? resolve(value) : reject(new Error("Barcode render failed.")),
      "image/png",
    );
  });
  return new Uint8Array(await blob.arrayBuffer());
}

function drawRect(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  fill?: boolean,
) {
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    borderColor: BLACK,
    borderWidth: INNER_BORDER,
    ...(fill ? { color: BLACK } : {}),
  });
}

function drawCellText(
  page: PDFPage,
  text: string,
  font: PDFFont,
  fontSize: number,
  x: number,
  yTop: number,
  width: number,
  height: number,
  pad: number,
  align: "left" | "center" = "left",
  lineRatio = 1.08,
  minSize = 2.8,
  alwaysShow = false,
) {
  const raw = pdfSafe(text);
  if (!raw.trim()) return;

  // Same requested size in every cell. Wrap onto more lines; do not mix 9pt
  // title with 5pt field rows. Row height must already fit the wrapped lines.
  const insetX = Math.max(0.6, Math.min(pad, width * 0.05));
  const shiftX = alwaysShow && align === "left" ? 1 : 0;
  const insetY = alwaysShow
    ? Math.max(0.2, Math.min(pad * 0.25, height * 0.06))
    : Math.max(0.35, Math.min(pad * 0.45, height * 0.1));
  const maxWidth = Math.max(3, width - insetX * 2 - shiftX);
  const size = fontSize;
  const paragraphs = raw
    .split(/\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const lines = paragraphs
    .flatMap((p) => wrapText(p, font, size, maxWidth))
    .filter(Boolean);
  if (!lines.length) return;

  const lineHeight = size * lineRatio;
  const maxLines = Math.max(1, Math.floor((height - insetY * 2) / lineHeight));
  const visible = lines.slice(0, maxLines);
  if (!visible.length) return;
  const cap = alwaysShow ? size * 0.78 : size * 0.92;
  const descender = alwaysShow ? size * 0.12 : size * 0.22;
  const contentH = cap + descender + (visible.length - 1) * lineHeight;
  const extra = Math.max(0, height - contentH);
  let y = yTop - insetY - extra / 2 - cap;
  const minY = yTop - height + (alwaysShow ? size * 0.08 : insetY * 0.35);
  if (alwaysShow) {
    const maxY = yTop - insetY - cap;
    y = Math.min(maxY, Math.max(minY, y));
  }
  let first = true;
  for (const line of visible) {
    if (!first && y < minY) break;
    if (first && y < minY) y = minY;
    first = false;
    const lineW = font.widthOfTextAtSize(line, size);
    const tx =
      align === "center"
        ? x + Math.max(insetX, (width - lineW) / 2)
        : x + insetX + shiftX;
    drawSolidBlackText(page, line, font, size, tx, y);
    y -= lineHeight;
  }
}

function drawRow(
  page: PDFPage,
  label: string,
  value: string,
  font: PDFFont,
  fontSize: number,
  x: number,
  yTop: number,
  width: number,
  height: number,
  labelRatio: number,
  pad: number,
  lineRatio = 1.08,
  minSize = 2.8,
  alwaysShow = false,
) {
  const labelW = width * labelRatio;
  const valueW = width - labelW;
  drawCellText(
    page,
    toLabelCase(label),
    font,
    fontSize,
    x,
    yTop,
    labelW,
    height,
    pad,
    "left",
    lineRatio,
    minSize,
    alwaysShow,
  );
  drawCellText(
    page,
    toValueCase(value),
    font,
    fontSize,
    x + labelW,
    yTop,
    valueW,
    height,
    pad,
    "left",
    lineRatio,
    minSize,
    alwaysShow,
  );
}

type GridRow = {
  height: number;
  kind: "title" | "pair" | "barcode";
  label?: string;
  value?: string;
  fontSize?: number;
  centerTitle?: string;
};

function paintTerryGrid(
  page: PDFPage,
  margin: number,
  tableW: number,
  tableTop: number,
  rows: GridRow[],
  labelRatio: number,
  borders: { outer: number; inner: number } = {
    outer: OUTER_BORDER,
    inner: INNER_BORDER,
  },
) {
  const tableH = rows.reduce((sum, row) => sum + row.height, 0);
  const tableBottom = tableTop - tableH;
  strokeOuter(page, margin, tableBottom, tableW, tableH, borders.outer);

  let y = tableTop;
  const labelX = margin + tableW * labelRatio;
  // Internal horizontals + column divider (not through title/barcode).
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const nextY = y - row.height;
    if (i > 0) hLine(page, margin, margin + tableW, y, borders.inner);
    if (row.kind === "pair") vLine(page, labelX, nextY, y, borders.inner);
    y = nextY;
  }
  return tableBottom;
}

async function drawAlphaProduct(
  pdf: PDFDocument,
  page: PDFPage,
  product: VectorProduct,
  font: PDFFont,
  labelSize: LabelSize,
  barcodeSource: BarcodeSource,
) {
  const { width, height } = PAGE_SIZES[labelSize];
  let s = sizeScale(labelSize);
  const margin = pageMargin(labelSize);
  const tableW = width - margin * 2;
  const tableTop = height - margin;
  const usableH = tableTop - margin;
  const labelRatio = labelColumnRatio(labelSize, "Alpha");
  const measure = measureFromFont(font);

  const marketedCombined = fieldValue(
    product.payload,
    "Marketed & Manufactured By",
  );
  const marketed = fieldValue(product.payload, "Marketed By / Imported By");
  const manufactured = fieldValue(product.payload, "Manufactured By ") || "-";
  const addressLabel = marketedCombined
    ? "Marketed &\nManufactured By"
    : "Marketed By / Imported By\nManufactured By";
  const addressValue = marketedCombined
    ? marketedCombined
    : `${marketed}\n${manufactured}`;

  const careCombined = fieldValue(product.payload, "Customer Care Details");
  const complaintLines = careCombined
    ? [careCombined]
    : [
        fieldValue(product.payload, "For Consumer Complaints"),
        fieldValue(product.payload, "Customer Care Address", "__EMPTY"),
        fieldValue(product.payload, "Customer Care Email", "__EMPTY_1"),
      ].filter(Boolean);
  const careLabel = careCombined
    ? "Customer Care Details"
    : "For Consumer Complaints";
  const careValue = complaintLines.join("\n") || " ";

  const fieldPairs = ALPHA_FIELDS.map((field) => ({
    label: field.label,
    value: fieldValue(product.payload, ...field.keys),
  }));
  if (isThermalSquare(labelSize)) {
    s = fitThermalSquareBody(labelSize, s, {
      usableH,
      tableW,
      marketplace: "Alpha",
      title: product.fsn || "",
      fieldPairs,
      specials: [
        { label: addressLabel, value: addressValue },
        { label: careLabel, value: careValue },
      ],
      measure,
    });
  }
  const layout = buildAlphaSmartLayout(
    labelSize,
    tableW,
    usableH,
    fieldPairs,
    addressLabel,
    addressValue,
    careLabel,
    careValue,
    measure,
    {
      title: s.title,
      body: s.body,
      small: s.small,
      pad: s.pad,
      line: s.line,
    },
  );

  const rows: GridRow[] = [
    { height: layout.title, kind: "title", centerTitle: product.fsn || "" },
    {
      height: layout.special[0],
      kind: "pair",
      label: addressLabel,
      value: addressValue,
      fontSize: s.small,
    },
    ...fieldPairs.map((pair, i) => ({
      height: layout.fields[i],
      kind: "pair" as const,
      label: pair.label,
      value: pair.value,
      fontSize: s.body,
    })),
    {
      height: layout.special[1],
      kind: "pair",
      label: careLabel,
      value: careValue,
      fontSize: s.small,
    },
    { height: layout.barcode, kind: "barcode" },
  ];

  paintTerryGrid(
    page,
    margin,
    tableW,
    tableTop,
    rows,
    labelRatio,
    borderSpec(labelSize),
  );

  const minSize = thermalTextFloor(labelSize);
  const alwaysShow = labelSize === "3x4";
  let y = tableTop;
  for (const row of rows) {
    if (row.kind === "title" && row.centerTitle != null) {
      drawCellText(
        page,
        row.centerTitle,
        font,
        s.title,
        margin,
        y,
        tableW,
        row.height,
        s.pad,
        "center",
        s.line,
        minSize,
        alwaysShow,
      );
    } else if (row.kind === "pair") {
      drawRow(
        page,
        row.label || "",
        row.value || "",
        font,
        row.fontSize || s.body,
        margin,
        y,
        tableW,
        row.height,
        labelRatio,
        s.pad,
        s.line,
        minSize,
        alwaysShow,
      );
    } else if (row.kind === "barcode") {
      const barcode = resolveProductBarcode(product, barcodeSource);
      await drawBarcodeInArea(
        pdf,
        page,
        barcode.value,
        barcode.format,
        font,
        labelSize,
        margin,
        y,
        tableW,
        row.height,
      );
    }
    y -= row.height;
  }
}

async function drawFbfProduct(
  pdf: PDFDocument,
  page: PDFPage,
  product: VectorProduct,
  font: PDFFont,
  labelSize: LabelSize,
  barcodeSource: BarcodeSource,
) {
  const { width, height } = PAGE_SIZES[labelSize];
  let s = sizeScale(labelSize);
  const margin = pageMargin(labelSize);
  const tableW = width - margin * 2;
  const tableTop = height - margin;
  const usableH = tableTop - margin;
  const labelRatio = labelColumnRatio(labelSize, "FBF");
  const measure = measureFromFont(font);

  const companyLabel = FBF_COMPANY_LABEL;
  const companyCombined = fieldValue(product.payload, ...FBF_COMPANY_KEYS);
  const company = [
    companyCombined,
    fieldValue(product.payload, "Mobile"),
    fieldValue(product.payload, "Email"),
  ]
    .filter(Boolean)
    .join("\n");

  const fieldPairs = FBF_FIELDS.map((field) => ({
    label: field.label,
    value: fieldValue(product.payload, ...field.keys),
  }));
  const titleText =
    fieldValue(product.payload, "Category") || product.fsn || "";
  if (isThermalSquare(labelSize)) {
    s = fitThermalSquareBody(labelSize, s, {
      usableH,
      tableW,
      marketplace: "FBF",
      title: titleText,
      fieldPairs,
      specials: [{ label: companyLabel, value: company }],
      measure,
    });
  }
  const layout = buildFbfSmartLayout(
    labelSize,
    tableW,
    usableH,
    titleText,
    fieldPairs,
    companyLabel,
    company,
    measure,
    {
      title: s.title,
      body: s.body,
      small: s.small,
      pad: s.pad,
      line: s.line,
    },
  );

  const rows: GridRow[] = [
    {
      height: layout.title,
      kind: "title",
      centerTitle: titleText,
    },
    ...fieldPairs.map((pair, i) => ({
      height: layout.fields[i],
      kind: "pair" as const,
      label: pair.label,
      value: pair.value,
      fontSize: s.body,
    })),
    {
      height: layout.special[0],
      kind: "pair",
      label: companyLabel,
      value: company,
      fontSize: s.small,
    },
    { height: layout.barcode, kind: "barcode" },
  ];

  paintTerryGrid(
    page,
    margin,
    tableW,
    tableTop,
    rows,
    labelRatio,
    borderSpec(labelSize),
  );

  const minSize = thermalTextFloor(labelSize);
  const alwaysShow = labelSize === "3x4";
  let y = tableTop;
  for (const row of rows) {
    if (row.kind === "title" && row.centerTitle != null) {
      drawCellText(
        page,
        row.centerTitle,
        font,
        s.title,
        margin,
        y,
        tableW,
        row.height,
        s.pad,
        "center",
        s.line,
        minSize,
        alwaysShow,
      );
    } else if (row.kind === "pair") {
      drawRow(
        page,
        row.label || "",
        row.value || "",
        font,
        row.fontSize || s.body,
        margin,
        y,
        tableW,
        row.height,
        labelRatio,
        s.pad,
        s.line,
        minSize,
        alwaysShow,
      );
    } else if (row.kind === "barcode") {
      const barcode = resolveProductBarcode(product, barcodeSource);
      await drawBarcodeInArea(
        pdf,
        page,
        barcode.value,
        barcode.format,
        font,
        labelSize,
        margin,
        y,
        tableW,
        row.height,
      );
    }
    y -= row.height;
  }
}

async function drawAlphaPack(
  page: PDFPage,
  label: VectorAlphaPack,
  font: PDFFont,
  labelSize: LabelSize,
) {
  const { width, height } = PAGE_SIZES[labelSize];
  const s = sizeScale(labelSize);
  const margin = 8;
  const tableW = width - margin * 2;
  const rows: Array<[string, string]> = [
    ["Invoice No.", label.invoiceNo],
    ["FSN", label.fsn],
    ["Qty", label.qty],
    ["PO No.", label.po],
    ["Box No.", label.boxNo],
  ];
  const rowH = (height - margin * 2) / rows.length;
  let y = height - margin;
  for (const [k, v] of rows) {
    drawRow(
      page,
      k,
      v,
      font,
      s.title,
      margin,
      y,
      tableW,
      rowH,
      0.38,
      s.pad,
      s.line,
      thermalTextFloor(labelSize),
    );
    y -= rowH;
  }
}

async function drawFbfPack(
  page: PDFPage,
  label: VectorFbfPack,
  font: PDFFont,
  labelSize: LabelSize,
) {
  const { width, height } = PAGE_SIZES[labelSize];
  const s = sizeScale(labelSize);
  const margin = 6;
  const tableW = width - margin * 2;
  let y = height - margin;

  const headH = 20;
  drawRect(page, margin, y - headH, tableW, headH);
  const consignment = label.consignment || "";
  page.drawText(consignment, {
    x: margin + s.pad,
    y: y - headH + (headH - s.body) / 2,
    size: s.body,
    font,
    color: BLACK,
    maxWidth: tableW - s.pad * 2,
  });
  y -= headH;

  drawRect(page, margin, y - headH, tableW, headH);
  const slip = "PACKAGING SLIP";
  const slipW = font.widthOfTextAtSize(slip, s.title);
  page.drawText(slip, {
    x: margin + (tableW - slipW) / 2,
    y: y - headH + (headH - s.title) / 2,
    size: s.title,
    font,
    color: BLACK,
  });
  y -= headH;

  const colW = [tableW * 0.14, tableW * 0.36, tableW * 0.36, tableW * 0.14];
  const headers = ["Box No.", "SKU", "FSN", "QTY."];
  const headerH = 14;
  const minSize = thermalTextFloor(labelSize);
  let x = margin;
  for (let i = 0; i < headers.length; i++) {
    drawRect(page, x, y - headerH, colW[i], headerH);
    drawCellText(
      page,
      headers[i],
      font,
      s.small,
      x,
      y,
      colW[i],
      headerH,
      1.5,
      "left",
      s.line,
      minSize,
    );
    x += colW[i];
  }
  y -= headerH;

  const items = label.items?.length ? label.items : [];
  const bodyH = Math.max(20, y - margin);
  const rowH = items.length ? bodyH / items.length : bodyH;

  // merged box number column
  drawRect(page, margin, margin, colW[0], bodyH);
  const boxLines = wrapText(label.boxNo || "", font, s.body, colW[0] - 4);
  let by = margin + bodyH / 2 + ((boxLines.length - 1) * s.body * 1.1) / 2;
  for (const line of boxLines) {
    const lw = font.widthOfTextAtSize(line, s.body);
    page.drawText(line, {
      x: margin + (colW[0] - lw) / 2,
      y: by,
      size: s.body,
      font,
      color: BLACK,
    });
    by -= s.body * 1.1;
  }

  let rowTop = y;
  for (const item of items) {
    let cx = margin + colW[0];
    const values = [item.sku, item.fsn, item.qty];
    const widths = [colW[1], colW[2], colW[3]];
    for (let i = 0; i < values.length; i++) {
      drawRect(page, cx, rowTop - rowH, widths[i], rowH);
      drawCellText(
        page,
        values[i] || "",
        font,
        s.small,
        cx,
        rowTop,
        widths[i],
        rowH,
        1.5,
        "left",
        s.line,
        minSize,
      );
      cx += widths[i];
    }
    rowTop -= rowH;
  }
  if (!items.length) {
    drawRect(page, margin + colW[0], margin, tableW - colW[0], bodyH);
  }
}

function preferActualSizePrint(pdf: PDFDocument) {
  // Gumming printer drivers: print at 100% — never Fit/Shrink to page.
  pdf.catalog.set(
    PDFName.of("ViewerPreferences"),
    pdf.context.obj({ PrintScaling: "None" }),
  );
}

export async function buildProductsPdf(
  products: VectorProduct[],
  labelSize: LabelSize,
  barcodeSource: BarcodeSource = "EAN",
): Promise<Uint8Array> {
  if (!products.length) throw new Error("No products selected for PDF.");
  const pdf = await PDFDocument.create();
  const font = await embedLabelFont(pdf);
  preferActualSizePrint(pdf);
  const size = PAGE_SIZES[labelSize];

  for (const product of products) {
    const page = pdf.addPage([size.width, size.height]);
    const source =
      barcodeSource || defaultBarcodeSource(product.marketplace);
    if (product.marketplace === "FBF") {
      await drawFbfProduct(pdf, page, product, font, labelSize, source);
    } else {
      await drawAlphaProduct(pdf, page, product, font, labelSize, source);
    }
  }
  return pdf.save();
}

export async function buildPackagingPdf(
  run: VectorPackagingRun,
  indexes: number[],
  labelSize: LabelSize,
): Promise<Uint8Array> {
  if (!indexes.length) throw new Error("No packaging labels selected for PDF.");
  const pdf = await PDFDocument.create();
  const font = await embedLabelFont(pdf);
  preferActualSizePrint(pdf);
  const size = PAGE_SIZES[labelSize];

  for (const index of indexes) {
    const label = run.payload[index];
    if (!label) throw new Error("One or more packaging labels could not be found.");
    const page = pdf.addPage([size.width, size.height]);
    if (run.marketplace === "FBF") {
      await drawFbfPack(page, label as VectorFbfPack, font, labelSize);
    } else {
      await drawAlphaPack(page, label as VectorAlphaPack, font, labelSize);
    }
  }
  return pdf.save();
}

export function downloadPdfBytes(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([Uint8Array.from(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
