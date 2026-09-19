export type LabelSize = "2x2" | "2x3" | "3x3" | "3x4" | "3x5" | "4x4" | "5x5";
export type BarcodeSource = "EAN" | "FSN";

export type SmartLabelLayout = {
  title: number;
  fields: number[];
  special: number[];
  barcode: number;
};

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

function normalizeHeader(key: string) {
  return key.replace(/\s+/g, " ").trim().toLowerCase();
}

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
