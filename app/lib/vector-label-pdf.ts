import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import JsBarcode from "jsbarcode";

export type LabelSize = "3x5" | "3x4" | "3x3";

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

const PAGE_SIZES: Record<
  LabelSize,
  { width: number; height: number }
> = {
  "3x5": { width: 216, height: 360 },
  "3x4": { width: 216, height: 288 },
  "3x3": { width: 216, height: 216 },
};

const BLACK = rgb(0, 0, 0);

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
] as const;

const FBF_FIELDS = [
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
] as const;

function fieldValue(
  payload: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    if (payload[key] !== undefined && payload[key] !== null) {
      return String(payload[key]).trim();
    }
  }
  return "";
}

/** Typography tuned to the Terry Blue Corel reference label. */
/** Lighter weights print cleaner on thermal — avoid Bold fill-in. */
function sizeScale(labelSize: LabelSize) {
  if (labelSize === "3x5")
    return { title: 8, body: 7, small: 6.2, pad: 2.4, ean: 10 };
  if (labelSize === "3x4")
    return { title: 7.2, body: 6.2, small: 5.6, pad: 2.1, ean: 9 };
  return { title: 6.5, body: 5.4, small: 4.8, pad: 1.8, ean: 8 };
}

const OUTER_BORDER = 1.0;
const INNER_BORDER = 0.6;
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
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
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
  fonts: { regular: PDFFont; bold: PDFFont },
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
  const textH = eanSize + 3;
  const innerPad = 3.5;
  const maxBarH =
    labelSize === "3x5" ? 56 : labelSize === "3x4" ? 40 : 26;
  const maxW = width * 0.78;
  const maxH = Math.min(maxBarH, Math.max(12, height - textH - innerPad * 2));
  const scale = Math.min(maxW / image.width, maxH / image.height);
  const drawW = image.width * scale;
  const drawH = image.height * scale;
  const yBottom = yTop - height;
  const contentTop = yTop - innerPad;
  const contentBottom = yBottom + textH + innerPad;
  const availH = Math.max(drawH, contentTop - contentBottom);
  const by = contentBottom + (availH - drawH) / 2;
  page.drawImage(image, {
    x: x + (width - drawW) / 2,
    y: Math.max(contentBottom, Math.min(by, contentTop - drawH)),
    width: drawW,
    height: drawH,
  });
  const safe = pdfSafe(value);
  const textW = fonts.regular.widthOfTextAtSize(safe, eanSize);
  page.drawText(safe, {
    x: x + (width - textW) / 2,
    y: yBottom + innerPad,
    size: eanSize,
    font: fonts.regular,
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
    height: format === "EAN13" ? 120 : 110,
    width: format === "EAN13" ? 2.4 : 1.8,
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
) {
  const cleaned = pdfSafe(text).replace(/\s+/g, " ").trim();
  if (!cleaned) return;
  const inset = Math.min(pad, 2.2);
  const maxWidth = Math.max(4, width - inset * 2);
  const size = Math.min(fontSize, Math.max(4.2, height - 1.4));
  const lines = wrapText(cleaned, font, size, maxWidth).filter(Boolean);
  if (!lines.length) return;
  const lineHeight = Math.min(size * 1.15, Math.max(size + 0.4, height - 1));
  const maxLines = Math.max(1, Math.floor((height - 1) / lineHeight));
  const visible = lines.slice(0, maxLines);
  const blockHeight = size + (visible.length - 1) * lineHeight;
  let y = yTop - (height - blockHeight) / 2 - size;
  const maxY = yTop - 0.8;
  const minY = yTop - height + 0.5;
  y = Math.min(maxY - size * 0.05, Math.max(minY, y));
  for (const line of visible) {
    const lineW = font.widthOfTextAtSize(line, size);
    const tx =
      align === "center" ? x + Math.max(inset, (width - lineW) / 2) : x + inset;
    page.drawText(line, {
      x: tx,
      y,
      size,
      font,
      color: BLACK,
      maxWidth,
    });
    y -= lineHeight;
    if (y < minY - size) break;
  }
}

function drawRow(
  page: PDFPage,
  label: string,
  value: string,
  font: PDFFont,
  _bold: PDFFont,
  fontSize: number,
  x: number,
  yTop: number,
  width: number,
  height: number,
  labelRatio: number,
  pad: number,
) {
  const labelW = width * labelRatio;
  const valueW = width - labelW;
  // Same regular weight for label + value — Bold bleeds on thermal print.
  drawCellText(page, label, font, fontSize, x, yTop, labelW, height, pad);
  drawCellText(
    page,
    value,
    font,
    fontSize,
    x + labelW,
    yTop,
    valueW,
    height,
    pad,
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
  fonts: { regular: PDFFont; bold: PDFFont },
  labelSize: LabelSize,
) {
  const { width, height } = PAGE_SIZES[labelSize];
  const s = sizeScale(labelSize);
  const margin = 3.5;
  const tableW = width - margin * 2;
  const tableTop = height - margin;
  const labelRatio = LABEL_RATIO;

  const titleH = labelSize === "3x3" ? 16 : labelSize === "3x4" ? 20 : 24;
  const addressH = labelSize === "3x3" ? 32 : labelSize === "3x4" ? 38 : 44;
  const complaintsH = labelSize === "3x3" ? 28 : labelSize === "3x4" ? 34 : 40;
  const barcodeH = labelSize === "3x3" ? 52 : labelSize === "3x4" ? 68 : 84;
  const fieldH =
    (tableTop - margin - titleH - addressH - complaintsH - barcodeH) /
    ALPHA_FIELDS.length;

  const marketed = fieldValue(product.payload, "Marketed By / Imported By");
  const manufactured = fieldValue(product.payload, "Manufactured By ") || "-";
  const complaintLines = [
    fieldValue(product.payload, "For Consumer Complaints"),
    fieldValue(product.payload, "Customer Care Address", "__EMPTY"),
    fieldValue(product.payload, "Customer Care Email", "__EMPTY_1"),
  ].filter(Boolean);

  const rows: GridRow[] = [
    { height: titleH, kind: "title", centerTitle: product.fsn || "" },
    {
      height: addressH,
      kind: "pair",
      label: "Marketed By / Imported By\nManufactured By",
      value: `${marketed}\n${manufactured}`,
      fontSize: s.small,
    },
    ...ALPHA_FIELDS.map((key) => ({
      height: fieldH,
      kind: "pair" as const,
      label: key.trim(),
      value: fieldValue(product.payload, key),
      fontSize: s.body,
    })),
    {
      height: complaintsH,
      kind: "pair",
      label: "For Consumer Complaints",
      // Force the multi-line drawer so text is laid out top-down inside the cell.
      value: complaintLines.join("\n") || " ",
      fontSize: s.small,
    },
    { height: barcodeH, kind: "barcode" },
  ];

  paintTerryGrid(page, margin, tableW, tableTop, rows, labelRatio);

  let y = tableTop;
  const labelW = tableW * labelRatio;
  for (const row of rows) {
    if (row.kind === "title" && row.centerTitle != null) {
      drawCellText(
        page,
        row.centerTitle,
        fonts.regular,
        s.title,
        margin,
        y,
        tableW,
        row.height,
        s.pad,
        "center",
      );
    } else if (row.kind === "pair") {
      const labelLines = (row.label || "").split("\n");
      const valueLines = (row.value || "").split("\n");
      if (labelLines.length > 1 || valueLines.length > 1) {
        const size = row.fontSize || s.small;
        const maxLabelW = labelW - s.pad * 2;
        const maxValueW = tableW - labelW - s.pad * 2;
        let ly = y - s.pad - size;
        for (const line of labelLines) {
          for (const wrapped of wrapText(
            line,
            fonts.regular,
            size,
            maxLabelW,
          )) {
            if (ly < y - row.height + 1) break;
            page.drawText(pdfSafe(wrapped), {
              x: margin + s.pad,
              y: ly,
              size,
              font: fonts.regular,
              color: BLACK,
              maxWidth: maxLabelW,
            });
            ly -= size * 1.2;
          }
        }
        let vy = y - s.pad - size;
        for (const line of valueLines) {
          for (const wrapped of wrapText(
            line,
            fonts.regular,
            size,
            maxValueW,
          )) {
            if (vy < y - row.height + 1) break;
            page.drawText(pdfSafe(wrapped), {
              x: margin + labelW + s.pad,
              y: vy,
              size,
              font: fonts.regular,
              color: BLACK,
              maxWidth: maxValueW,
            });
            vy -= size * 1.15;
          }
        }
      } else {
        drawRow(
          page,
          row.label || "",
          row.value || "",
          fonts.regular,
          fonts.bold,
          row.fontSize || s.body,
          margin,
          y,
          tableW,
          row.height,
          labelRatio,
          s.pad,
        );
      }
    } else if (row.kind === "barcode") {
      await drawBarcodeInArea(
        pdf,
        page,
        product.ean,
        "EAN13",
        fonts,
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
  fonts: { regular: PDFFont; bold: PDFFont },
  labelSize: LabelSize,
) {
  const { width, height } = PAGE_SIZES[labelSize];
  const s = sizeScale(labelSize);
  const margin = 3.5;
  const tableW = width - margin * 2;
  const tableTop = height - margin;
  const labelRatio = 0.4;

  const titleH = labelSize === "3x3" ? 16 : labelSize === "3x4" ? 18 : 22;
  const companyH = labelSize === "3x3" ? 28 : labelSize === "3x4" ? 34 : 42;
  const barcodeH = labelSize === "3x3" ? 48 : labelSize === "3x4" ? 64 : 80;
  const fieldSpace =
    tableTop - margin - titleH - companyH - barcodeH;
  const fieldH = fieldSpace / FBF_FIELDS.length;

  const company = [
    fieldValue(
      product.payload,
      "manufactured by/Marketed by & customer care details",
    ),
    fieldValue(product.payload, "Mobile"),
    fieldValue(product.payload, "Email"),
  ]
    .filter(Boolean)
    .join(" | ");

  const rows: GridRow[] = [
    {
      height: titleH,
      kind: "title",
      centerTitle: fieldValue(product.payload, "Category") || product.fsn,
    },
    ...FBF_FIELDS.map((key) => ({
      height: fieldH,
      kind: "pair" as const,
      label: key,
      value: fieldValue(product.payload, key),
      fontSize: s.body,
    })),
    {
      height: companyH,
      kind: "pair",
      label: "manufactured by/Marketed by & customer care details",
      value: company,
      fontSize: s.small,
    },
    { height: barcodeH, kind: "barcode" },
  ];

  paintTerryGrid(page, margin, tableW, tableTop, rows, labelRatio);

  let y = tableTop;
  for (const row of rows) {
    if (row.kind === "title" && row.centerTitle != null) {
      drawCellText(
        page,
        row.centerTitle,
        fonts.regular,
        s.title,
        margin,
        y,
        tableW,
        row.height,
        s.pad,
        "center",
      );
    } else if (row.kind === "pair") {
      drawRow(
        page,
        row.label || "",
        row.value || "",
        fonts.regular,
        fonts.bold,
        row.fontSize || s.body,
        margin,
        y,
        tableW,
        row.height,
        labelRatio,
        s.pad,
      );
    } else if (row.kind === "barcode") {
      await drawBarcodeInArea(
        pdf,
        page,
        product.fsn,
        "CODE128",
        fonts,
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
  fonts: { regular: PDFFont; bold: PDFFont },
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
      fonts.regular,
      fonts.bold,
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
  fonts: { regular: PDFFont; bold: PDFFont },
  labelSize: LabelSize,
) {
  const { width, height } = PAGE_SIZES[labelSize];
  const s = sizeScale(labelSize);
  const margin = 6;
  const tableW = width - margin * 2;
  let y = height - margin;

  const headH = labelSize === "3x3" ? 16 : 20;
  drawRect(page, margin, y - headH, tableW, headH);
  const consignment = label.consignment || "";
  page.drawText(consignment, {
    x: margin + s.pad,
    y: y - headH + (headH - s.body) / 2,
    size: s.body,
    font: fonts.bold,
    color: BLACK,
    maxWidth: tableW - s.pad * 2,
  });
  y -= headH;

  drawRect(page, margin, y - headH, tableW, headH);
  const slip = "PACKAGING SLIP";
  const slipW = fonts.bold.widthOfTextAtSize(slip, s.title);
  page.drawText(slip, {
    x: margin + (tableW - slipW) / 2,
    y: y - headH + (headH - s.title) / 2,
    size: s.title,
    font: fonts.bold,
    color: BLACK,
  });
  y -= headH;

  const colW = [tableW * 0.14, tableW * 0.36, tableW * 0.36, tableW * 0.14];
  const headers = ["Box No.", "SKU", "FSN", "QTY."];
  const headerH = labelSize === "3x3" ? 12 : 14;
  let x = margin;
  for (let i = 0; i < headers.length; i++) {
    drawRect(page, x, y - headerH, colW[i], headerH);
    drawCellText(
      page,
      headers[i],
      fonts.bold,
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
  const boxLines = wrapText(
    label.boxNo || "",
    fonts.regular,
    s.body,
    colW[0] - 4,
  );
  let by = margin + bodyH / 2 + ((boxLines.length - 1) * s.body * 1.1) / 2;
  for (const line of boxLines) {
    const lw = fonts.regular.widthOfTextAtSize(line, s.body);
    page.drawText(line, {
      x: margin + (colW[0] - lw) / 2,
      y: by,
      size: s.body,
      font: fonts.regular,
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
        fonts.regular,
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

export async function buildProductsPdf(
  products: VectorProduct[],
  labelSize: LabelSize,
): Promise<Uint8Array> {
  if (!products.length) throw new Error("No products selected for PDF.");
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const size = PAGE_SIZES[labelSize];

  for (const product of products) {
    const page = pdf.addPage([size.width, size.height]);
    if (product.marketplace === "FBF") {
      await drawFbfProduct(pdf, page, product, { regular, bold }, labelSize);
    } else {
      await drawAlphaProduct(pdf, page, product, { regular, bold }, labelSize);
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
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const size = PAGE_SIZES[labelSize];

  for (const index of indexes) {
    const label = run.payload[index];
    if (!label) throw new Error("One or more packaging labels could not be found.");
    const page = pdf.addPage([size.width, size.height]);
    if (run.marketplace === "FBF") {
      await drawFbfPack(
        page,
        label as VectorFbfPack,
        { regular, bold },
        labelSize,
      );
    } else {
      await drawAlphaPack(
        page,
        label as VectorAlphaPack,
        { regular, bold },
        labelSize,
      );
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
