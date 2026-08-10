import { PDFDocument, StandardFonts, rgb, PDFName, type PDFFont, type PDFPage } from "pdf-lib";
import JsBarcode from "jsbarcode";

export type LabelSize = "2x2" | "2x3" | "3x3" | "3x4" | "3x5";
export type BarcodeSource = "EAN" | "FSN";

/** Product master sizes by marketplace. */
export const ALPHA_LABEL_SIZES: readonly LabelSize[] = [
  "3x3",
  "3x4",
  "3x5",
  "2x3",
];
export const FBF_LABEL_SIZES: readonly LabelSize[] = [
  "2x2",
  "3x3",
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
};

const BLACK = rgb(0, 0, 0);

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

/** Title-case values, but leave codes / emails / pure IDs unchanged. */
export function toValueCase(text: string): string {
  const raw = String(text ?? "");
  const trimmed = raw.trim();
  if (!trimmed) return raw;
  if (/@/.test(trimmed) || /^https?:\/\//i.test(trimmed)) return raw;
  const compact = trimmed.replace(/\s+/g, "");
  if (/^\d{8,}$/.test(compact)) return raw; // EAN-like
  if (/^[A-Z0-9]{10,}$/.test(compact)) return raw; // FSN-like
  return trimmed
    .split("\n")
    .map((line) => toLabelCase(line.trim()))
    .join("\n");
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

/** Typography for gumming/sticker printers — regular Helvetica only.
 *  Sized so glyphs clear hairline borders inside each row height. */
function sizeScale(labelSize: LabelSize) {
  switch (labelSize) {
    case "3x5":
      return { title: 6.8, body: 6.5, small: 6.0, pad: 2.0, ean: 12, line: 1.1 };
    case "3x4":
      return { title: 6.0, body: 5.5, small: 5.1, pad: 1.6, ean: 10, line: 1.08 };
    case "3x3":
      // Compact square: keep type readable without forcing printer stretch.
      return { title: 5.2, body: 4.6, small: 4.2, pad: 1.4, ean: 8, line: 1.05 };
    case "2x3":
      return { title: 4.6, body: 4.1, small: 3.8, pad: 1.2, ean: 7, line: 1.04 };
    case "2x2":
      return { title: 3.8, body: 3.4, small: 3.2, pad: 0.9, ean: 5.2, line: 1.02 };
  }
}

function pageMargin(labelSize: LabelSize) {
  if (labelSize === "2x2") return 1.0;
  if (labelSize === "2x3") return 1.2;
  // 3x3 / 3x4 / 3x5: inset so the outer box stays inside the die-cut sticker
  // (prevents the open/clipped top border on gumming printers).
  if (labelSize === "3x3" || labelSize === "3x4" || labelSize === "3x5") {
    return 8;
  }
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
    if (labelSize === "3x3") return 0.39;
    return 0.38;
  }
  if (labelSize === "2x3") return 0.4;
  return LABEL_RATIO;
}

function alphaBandHeights(labelSize: LabelSize) {
  // Prefer field-row clearance over oversized barcodes on compact stickers.
  switch (labelSize) {
    case "3x5":
      return { titleH: 14, addressH: 30, complaintsH: 28, barcodeH: 96 };
    case "3x4":
      return { titleH: 12, addressH: 24, complaintsH: 22, barcodeH: 68 };
    case "3x3":
      return { titleH: 10, addressH: 18, complaintsH: 16, barcodeH: 48 };
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
      return { titleH: 13, companyH: 26, barcodeH: 56 };
    case "3x3":
      return { titleH: 10, companyH: 18, barcodeH: 48 };
    case "2x3":
      return { titleH: 10, companyH: 18, barcodeH: 38 };
    case "2x2":
      return { titleH: 8, companyH: 14, barcodeH: 30 };
  }
}

function barcodeDrawSpec(labelSize: LabelSize, format: "EAN13" | "CODE128") {
  const wide = format === "EAN13" || format === "CODE128";
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
        widthRatio: 0.92,
        barH: format === "EAN13" ? 50 : 42,
        bottomPad: 4,
        gap: 3,
        topPad: 3.5,
        wide,
      };
    case "3x3":
      return {
        widthRatio: 0.9,
        barH: format === "EAN13" ? 34 : 30,
        bottomPad: 3,
        gap: 2,
        topPad: 2.5,
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
  }
}

// Gumming printers spread ink — keep strokes light (Terry Corel used ~1.4;
// that prints heavy on gumming stock). Uniform hairline for outer + grid.
const OUTER_BORDER = 0.55;
const INNER_BORDER = 0.55;
const LABEL_RATIO = 0.363; // matches Terry Blue column split (~92.8 / 255.8)

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
) {
  // pdf-lib centers the stroke on the path — inset by half so the full
  // top/side lines stay on the page (avoids an "open" top box when clipped).
  const inset = OUTER_BORDER / 2;
  page.drawRectangle({
    x: x + inset,
    y: y + inset,
    width: Math.max(1, w - OUTER_BORDER),
    height: Math.max(1, h - OUTER_BORDER),
    borderColor: BLACK,
    borderWidth: OUTER_BORDER,
  });
}

function hLine(page: PDFPage, x1: number, x2: number, y: number) {
  page.drawLine({
    start: { x: x1, y },
    end: { x: x2, y },
    thickness: INNER_BORDER,
    color: BLACK,
  });
}

function vLine(page: PDFPage, x: number, y1: number, y2: number) {
  page.drawLine({
    start: { x, y: y1 },
    end: { x, y: y2 },
    thickness: INNER_BORDER,
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
      drawH = Math.max(barH * 0.55, yTop - topPad - imageY);
    }
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
  page.drawText(safe, {
    x: x + (width - textW) / 2,
    y: textY,
    size: eanSize,
    font,
    color: BLACK,
  });
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

export type HeightSlot = {
  key: string;
  min: number;
  prefer: number;
  /** Lower keep = shrink first when space is tight (barcode=0, fields=1, address=3). */
  keep: number;
};

/**
 * Uniform field rows + barcode-first leftover space.
 * - All `field-*` rows share one equal height (no one tall/odd blank cell).
 * - Company/address stay tight to content.
 * - Extra space goes to the barcode (main purpose of the sticker).
 */
export function allocateRowHeights(
  usableH: number,
  slots: HeightSlot[],
): Record<string, number> {
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

  // Lock barcode prefer first so scanning area isn't starved by table padding.
  if (bi >= 0) {
    heights[bi] = Math.max(slots[bi].min, slots[bi].prefer);
  }

  const sum = () => heights.reduce((a, b) => a + b, 0);
  const nonFieldSum = () =>
    heights.reduce((a, h, i) => (fieldIdx.includes(i) ? a : a + h), 0);

  // All data fields share one equal height from whatever is left.
  if (fieldIdx.length) {
    const contentFloor = Math.max(...fieldIdx.map((i) => slots[i].min));
    const room = usableH - nonFieldSum();
    const equal = Math.max(contentFloor, room / fieldIdx.length);
    for (const i of fieldIdx) heights[i] = equal;
  }

  // If overfull: shrink barcode toward min, then lower every field row together.
  let over = sum() - usableH;
  if (over > 0.05 && bi >= 0) {
    const take = Math.min(over, heights[bi] - slots[bi].min);
    heights[bi] -= take;
    over -= take;
  }
  if (over > 0.05 && fieldIdx.length) {
    const perField = over / fieldIdx.length;
    const lowestOwnMin = Math.min(...fieldIdx.map((i) => slots[i].min));
    const next = Math.max(lowestOwnMin, heights[fieldIdx[0]] - perField);
    for (const i of fieldIdx) heights[i] = next;
    over = sum() - usableH;
  }
  // Still over: scale all non-barcode content evenly; keep barcode at min.
  if (over > 0.05) {
    if (bi >= 0) heights[bi] = slots[bi].min;
    const rest = Math.max(1, usableH - (bi >= 0 ? heights[bi] : 0));
    const contentIdx = slots.map((_, i) => i).filter((i) => i !== bi);
    const contentSum = contentIdx.reduce((a, i) => a + heights[i], 0);
    const factor = contentSum > 0 ? rest / contentSum : 1;
    for (const i of contentIdx) heights[i] *= factor;
  }

  // Underfull: all spare → barcode (never inflate one random data cell).
  const spare = usableH - sum();
  if (spare > 0.05) {
    if (bi >= 0) heights[bi] += spare;
    else if (fieldIdx.length) {
      const each = spare / fieldIdx.length;
      for (const i of fieldIdx) heights[i] += each;
    }
  }

  const drift = usableH - sum();
  if (Math.abs(drift) > 0.05) {
    const idx = bi >= 0 ? bi : heights.length - 1;
    heights[idx] = Math.max(slots[idx].min * 0.5, heights[idx] + drift);
  }

  const out: Record<string, number> = {};
  slots.forEach((s, i) => {
    out[s.key] = heights[i];
  });
  return out;
}

function barcodeHeightSlot(labelSize: LabelSize, scale = 1): HeightSlot {
  const S = (n: number) => n * scale;
  // Prefer tall barcodes — scanning is the label's main job.
  switch (labelSize) {
    case "3x5":
      return { key: "barcode", min: S(76), prefer: S(98), keep: 0 };
    case "3x4":
      return { key: "barcode", min: S(60), prefer: S(80), keep: 0 };
    case "3x3":
      return { key: "barcode", min: S(42), prefer: S(54), keep: 0 };
    case "2x3":
      return { key: "barcode", min: S(48), prefer: S(64), keep: 0 };
    case "2x2":
      return { key: "barcode", min: S(32), prefer: S(42), keep: 0 };
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

  const allocated = allocateRowHeights(usableH, slots);
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

  const slots: HeightSlot[] = [
    titleHeightSlot(labelSize, "Alpha", unitScale),
    addressSlot,
    ...fieldSlots,
    complaintsSlot,
    barcodeHeightSlot(labelSize, unitScale),
  ];

  const allocated = allocateRowHeights(usableH, slots);
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
    case "3x3":
      return {
        title: pt(6),
        body: pt(5),
        small: pt(4.6),
        pad: pt(1.5),
        line: 1.1,
      };
    case "3x4":
      return {
        title: pt(6.5),
        body: pt(5.6),
        small: pt(5.1),
        pad: pt(1.7),
        line: 1.1,
      };
    case "3x5":
      return {
        title: pt(7),
        body: pt(6.5),
        small: pt(6),
        pad: pt(2),
        line: 1.12,
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
  const type = cssTypeScale(labelSize);
  const measure = approxTextWidth;

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
    return buildFbfSmartLayout(
      labelSize,
      tableW,
      usableH,
      fieldValue(product.payload, "Category") || product.fsn,
      fieldPairs,
      companyLabel,
      companyValue,
      measure,
      type,
      96 / 72,
    );
  }

  const marketedCombined = fieldValue(
    product.payload,
    "Marketed & Manufactured By",
  );
  const marketed = fieldValue(product.payload, "Marketed By / Imported By");
  const manufactured = fieldValue(product.payload, "Manufactured By ") || "-";
  const addressLabel = marketedCombined
    ? "Marketed & Manufactured By"
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
) {
  const raw = pdfSafe(text);
  if (!raw.trim()) return;

  // Keep glyphs clear of hairlines on every side (critical on 2x2 / 2x3 / 3x3).
  const insetX = Math.max(0.7, Math.min(pad, width * 0.06));
  const insetY = Math.max(0.55, Math.min(pad, height * 0.16));
  const maxWidth = Math.max(3, width - insetX * 2);
  const size = Math.min(
    fontSize,
    Math.max(2.8, (height - insetY * 2) / Math.max(lineRatio, 1.02)),
  );
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
  // Baseline sits just under the top inset so caps clear the top border.
  let y = yTop - insetY - size * 0.92;
  const minY = yTop - height + insetY * 0.35;
  for (const line of visible) {
    if (y < minY) break;
    const lineW = font.widthOfTextAtSize(line, size);
    const tx =
      align === "center"
        ? x + Math.max(insetX, (width - lineW) / 2)
        : x + insetX;
    page.drawText(line, {
      x: tx,
      y,
      size,
      font,
      color: BLACK,
      maxWidth,
    });
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
) {
  const tableH = rows.reduce((sum, row) => sum + row.height, 0);
  const tableBottom = tableTop - tableH;
  strokeOuter(page, margin, tableBottom, tableW, tableH);

  let y = tableTop;
  const labelX = margin + tableW * labelRatio;
  // Internal horizontals + column divider (not through title/barcode).
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const nextY = y - row.height;
    if (i > 0) hLine(page, margin, margin + tableW, y);
    if (row.kind === "pair") vLine(page, labelX, nextY, y);
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
  const s = sizeScale(labelSize);
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
    ? "Marketed & Manufactured By"
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

  paintTerryGrid(page, margin, tableW, tableTop, rows, labelRatio);

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
  const s = sizeScale(labelSize);
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

  paintTerryGrid(page, margin, tableW, tableTop, rows, labelRatio);

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
  // Regular Helvetica only — Bold fills in on gumming sticker print.
  const font = await pdf.embedFont(StandardFonts.Helvetica);
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
  const font = await pdf.embedFont(StandardFonts.Helvetica);
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
