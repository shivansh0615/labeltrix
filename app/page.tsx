"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyPreviousMonthManufactureDate,
  clampLabelSize,
  defaultBarcodeSource,
  isManufactureDateKey,
  labelSizeCssInches,
  labelSizesForMarketplace,
  previousMonthManufactureLabel,
  resolveProductBarcode,
  type BarcodeSource,
  type LabelSize,
  type SmartLabelLayout,
} from "./lib/label-helpers";

type PdfEngine = typeof import("./lib/vector-label-pdf");
let pdfEnginePromise: Promise<PdfEngine> | null = null;
function loadPdfEngine() {
  pdfEnginePromise ??= import("./lib/vector-label-pdf");
  return pdfEnginePromise;
}

type PdfJsModule = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJsModule> | null = null;
function loadPdfJs() {
  pdfjsPromise ??= import("pdfjs-dist").then(async (pdfjs) => {
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    }
    return pdfjs;
  });
  return pdfjsPromise;
}

const previewPdfCache = new Map<string, Uint8Array>();
const PREVIEW_PDF_CACHE_LIMIT = 8;
function rememberPreviewPdf(key: string, bytes: Uint8Array) {
  previewPdfCache.set(key, bytes);
  if (previewPdfCache.size > PREVIEW_PDF_CACHE_LIMIT) {
    const oldest = previewPdfCache.keys().next().value;
    if (oldest !== undefined) previewPdfCache.delete(oldest);
  }
}

type Product = {
  id?: number;
  marketplace: "Alpha" | "FBF";
  ean: string;
  fsn: string;
  sku: string;
  title: string;
  brand: string;
  payload: Record<string, unknown>;
  sourceFile?: string;
  updatedAt?: string;
};
type AlphaPack = {
  invoiceNo: string;
  fsn: string;
  qty: string;
  po: string;
  boxNo: string;
};
type FbfItem = { sku: string; fsn: string; qty: string };
type FbfPack = { consignment: string; boxNo: string; items: FbfItem[] };
type PackagingRun = {
  id: number;
  marketplace: "Alpha" | "FBF";
  sourceSheet: string;
  formatSheet: string;
  sourceFile: string;
  labelCount: number;
  payload: Array<AlphaPack | FbfPack>;
  createdAt: string;
};
type AuthRole = "admin" | "viewer";

const DEMO_PACKAGING_FILES = new Set([
  "alpha-packaging-demo.xlsx",
  "fbf-packaging-demo.xlsx",
]);

function isDemoPackagingRun(run: { sourceFile?: string }) {
  return DEMO_PACKAGING_FILES.has((run.sourceFile || "").toLowerCase());
}

function packagingLabelSummary(
  marketplace: "Alpha" | "FBF",
  label: AlphaPack | FbfPack,
  index: number,
) {
  if (marketplace === "Alpha") {
    const pack = label as AlphaPack;
    return {
      title: pack.invoiceNo || pack.fsn || `Label ${index + 1}`,
      meta: [
        pack.boxNo && `Box ${pack.boxNo}`,
        pack.fsn && `FSN ${pack.fsn}`,
        pack.qty && `Qty ${pack.qty}`,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }
  const pack = label as FbfPack;
  return {
    title: pack.consignment || `Box ${pack.boxNo}` || `Label ${index + 1}`,
    meta: [
      pack.boxNo && `Box ${pack.boxNo}`,
      `${pack.items.length} SKU${pack.items.length === 1 ? "" : "s"}`,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

function productKey(product: Product) {
  return `${product.marketplace}|${product.ean}`;
}
/** Collapse Excel header whitespace (incl. \\r\\n) for alias matching. */
function normalizeHeader(key: string) {
  return key.replace(/\s+/g, " ").trim().toLowerCase();
}
function value(row: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) {
      const text = String(row[key]);
      if (text.trim() !== "") return text;
    }
  }
  const entries = Object.entries(row);
  for (const key of keys) {
    const want = normalizeHeader(key);
    const hit = entries.find(
      ([k, v]) =>
        normalizeHeader(k) === want &&
        v !== undefined &&
        v !== null &&
        String(v).trim() !== "",
    );
    if (hit) return String(hit[1]);
  }
  return "";
}
type XlsxModule = typeof import("xlsx");
type WorkBook = import("xlsx").WorkBook;

function excelDate(v: unknown, XLSX: XlsxModule) {
  if (typeof v !== "number") return String(v ?? "");
  const d = XLSX.SSF.parse_date_code(v);
  if (!d) return String(v);
  return new Date(Date.UTC(d.y, d.m - 1, d.d))
    .toLocaleDateString("en-US", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    })
    .replace(" ", "-");
}

function applyExcelDates(
  payload: Record<string, unknown>,
  dateKeys: string[],
  XLSX: XlsxModule,
) {
  const want = new Set(dateKeys.map(normalizeHeader));
  for (const key of Object.keys(payload)) {
    if (want.has(normalizeHeader(key))) {
      payload[key] = excelDate(payload[key], XLSX);
    }
  }
}

function isFbfProductRow(row: Record<string, unknown>) {
  return (
    "Category" in row ||
    "model_name" in row ||
    "Model_name" in row ||
    "model_number" in row ||
    "Model_number" in row
  );
}

function parseLabelNumbers(input: string, total: number) {
  const selected: number[] = [];
  const seen = new Set<number>();
  const parts = input
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) throw new Error("Enter at least one label number.");
  for (const part of parts) {
    const range = part.match(/^(\d+)-(\d+)$/);
    const numbers = range
      ? Array.from(
          { length: Math.abs(Number(range[2]) - Number(range[1])) + 1 },
          (_, index) =>
            Number(range[1]) +
            index * (Number(range[2]) >= Number(range[1]) ? 1 : -1),
        )
      : /^\d+$/.test(part)
        ? [Number(part)]
        : [];
    if (!numbers.length)
      throw new Error(`"${part}" is not a valid label number or range.`);
    for (const number of numbers) {
      if (number < 1 || number > total)
        throw new Error(`Label ${number} is outside the available 1-${total}.`);
      const index = number - 1;
      if (!seen.has(index)) {
        seen.add(index);
        selected.push(index);
      }
    }
  }
  return selected;
}

function readRows(XLSX: XlsxModule, wb: WorkBook, name: string) {
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], {
    defval: "",
    raw: true,
  });
}

/** EAN for product masters: classic EAN column, or newer Alpha Barcode/PO export. */
function productEan(row: Record<string, unknown>) {
  return value(row, "EAN", "Ean", "ean", "Barcode", "barcode", "PO", "Po");
}

/** Product masters: data lives on sheet 1 only. Sheet 2 is a visual label mock — never read. */
function findProductDetailsSheet(
  XLSX: XlsxModule,
  wb: WorkBook,
): string | null {
  const names = wb.SheetNames;
  if (names.includes("Product Details")) return "Product Details";
  // First sheet only if it looks like a product master (FSN + EAN/Barcode/PO).
  const first = names[0];
  if (!first || !wb.Sheets[first]) return null;
  if (
    first === "Packaging List" ||
    first === "FBF Packaging List" ||
    first === "Label Format" ||
    first === "Box Label Format"
  ) {
    return null;
  }
  const sample = readRows(XLSX, wb, first).slice(0, 5);
  if (!sample.length) return null;
  const looksProduct = sample.some(
    (row) => productEan(row) && value(row, "FSN", "Fsn", "fsn"),
  );
  return looksProduct ? first : null;
}

async function parseUpload(file: File, bytes: ArrayBuffer) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(bytes, { type: "array", cellDates: false, raw: true });
  const names = wb.SheetNames;
  // Packaging first: those lists include FSN + PO and would look like a product master.
  if (names.includes("Packaging List") && names.includes("Label Format")) {
    const payload = readRows(XLSX, wb, "Packaging List").map((r) => ({
      po: value(r, "PO"),
      invoiceNo: value(r, "Invoice No"),
      fsn: value(r, "FSN"),
      qty: value(r, "Qty"),
      boxNo: value(r, "Box No"),
    }));
    return {
      kind: "packaging" as const,
      marketplace: "Alpha",
      sourceSheet: "Packaging List",
      formatSheet: "Label Format",
      payload,
    };
  }
  if (
    names.includes("FBF Packaging List") &&
    names.includes("Box Label Format")
  ) {
    const rows = readRows(XLSX, wb, "FBF Packaging List");
    const groups: FbfPack[] = [];
    let current: FbfPack | null = null;
    for (const r of rows) {
      const box = value(r, "BOX");
      if (box) {
        current = {
          boxNo: box,
          consignment: value(r, "Consignment No ", "Consignment No"),
          items: [],
        };
        groups.push(current);
      }
      if (!current)
        throw new Error("A packaging row appears before its box number.");
      current.items.push({
        sku: value(r, "SKU Id"),
        fsn: value(r, "FSN"),
        qty: value(r, "Quantity Sent"),
      });
    }
    return {
      kind: "packaging" as const,
      marketplace: "FBF",
      sourceSheet: "FBF Packaging List",
      formatSheet: "Box Label Format",
      payload: groups,
    };
  }
  const productSheet = findProductDetailsSheet(XLSX, wb);
  if (productSheet) {
    // Ignore any later sheets (e.g. "Product Label Format") — reference layout only.
    const rows = readRows(XLSX, wb, productSheet);
    const fbf = rows.some(isFbfProductRow);
    const products = rows
      .map((r) => {
        const payload = { ...r };
        applyExcelDates(
          payload,
          fbf
            ? [
                "Month and year of manufactured",
                "month and year of manufactured",
              ]
            : ["Date Of Manufacture "],
          XLSX,
        );
        applyPreviousMonthManufactureDate(payload, fbf ? "FBF" : "Alpha");
        const ean = productEan(r);
        // Keep barcode helpers consistent when the sheet only has Barcode/PO.
        if (ean && !value(payload, "EAN", "Ean", "ean")) {
          payload.EAN = ean;
        }
        return {
          marketplace: fbf ? "FBF" : "Alpha",
          ean,
          fsn: value(r, "FSN", "Fsn", "fsn"),
          sku: value(
            r,
            "Model_number",
            "model_number",
            "Style Code",
            "SKU",
            "SKU Id",
          ),
          title: value(
            r,
            "Model_name",
            "model_name",
            "Brand ",
            "Product Title",
          ),
          brand: value(r, "brand", "Brand "),
          payload,
          sourceFile: file.name,
        } as Product;
      })
      .filter((p) => p.ean && p.fsn);
    return {
      kind: "product" as const,
      marketplace: fbf ? "FBF" : "Alpha",
      sourceSheet: productSheet,
      // Sheet 2 is visual reference only — not used for data.
      formatSheet: "Product Details (data sheet)",
      products,
    };
  }
  throw new Error(
    "Workbook type not recognised. Product masters need a Product Details (1st) sheet with FSN plus EAN (or Barcode/PO). Packaging lists need Packaging List + Label Format, or FBF Packaging List + Box Label Format.",
  );
}

function Barcode({
  value,
  format = "CODE128",
}: {
  value: string;
  format?: "EAN13" | "CODE128";
}) {
  const [barcodeImage, setBarcodeImage] = useState("");
  useEffect(() => {
    let cancelled = false;
    import("jsbarcode")
      .then((mod) => {
        if (cancelled) return;
        const JsBarcode = mod.default;
        const canvas = document.createElement("canvas");
        JsBarcode(canvas, value, {
          format,
          displayValue: false,
          margin: 4,
          height: format === "EAN13" ? 180 : 144,
          width: format === "EAN13" ? 9.5 : 2.4,
          fontSize: 14,
          background: "#ffffff",
        });
        if (!cancelled) setBarcodeImage(canvas.toDataURL("image/png"));
      })
      .catch(() => {
        if (!cancelled) setBarcodeImage("");
      });
    return () => {
      cancelled = true;
    };
  }, [value, format]);
  return (
    <div className="barcodeBox">
      {barcodeImage && (
        <img
          className="barcodeImage"
          src={barcodeImage}
          alt={`Barcode ${value}`}
        />
      )}
      <span className="barcodeNumber">{value}</span>
    </div>
  );
}

/** Preview painted from the same PDF bytes that download uses. */
function ExactPdfPreview({
  labelSize,
  buildKey,
  build,
}: {
  labelSize: LabelSize;
  buildKey: string;
  build: () => Promise<Uint8Array>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paintedRef = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [message, setMessage] = useState("Rendering PDF preview…");
  const dims = labelSizeCssInches(labelSize);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setMessage("Rendering PDF preview…");

    (async () => {
      try {
        const cached = previewPdfCache.get(buildKey);
        const bytes = cached ?? (await build());
        if (!cached) rememberPreviewPdf(buildKey, bytes);
        if (cancelled) return;

        const pdfjs = await loadPdfJs();

        const data = bytes.slice();
        const doc = await pdfjs.getDocument({ data }).promise;
        if (cancelled) return;
        const page = await doc.getPage(1);
        // Sharp on-screen render; CSS sizes the canvas to physical label inches.
        const viewport = page.getViewport({ scale: 2.5 });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas unavailable for PDF preview.");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({
          canvasContext: ctx,
          viewport,
        }).promise;
        if (!cancelled) {
          paintedRef.current = true;
          setStatus("ready");
        }
      } catch (error) {
        if (!cancelled) {
          setStatus("error");
          setMessage(
            error instanceof Error ? error.message : "PDF preview failed.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // buildKey captures product/size/barcode changes; build is recreated each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildKey, labelSize]);

  return (
    <div
      className="exactPdfPreview"
      style={{ width: dims.width, height: dims.height }}
    >
      {status !== "ready" && (
        <div className="exactPdfStatus" role="status">
          {message}
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="exactPdfCanvas"
        style={{
          width: dims.width,
          height: dims.height,
          visibility:
            status === "ready" || paintedRef.current ? "visible" : "hidden",
        }}
      />
    </div>
  );
}
const alphaFields: Array<{ label: string; keys: string[] }> = [
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
const fbfFields: Array<{ label: string; keys: string[] }> = [
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

function alphaAddressLines(d: Record<string, unknown>) {
  const combined = value(d, "Marketed & Manufactured By");
  if (combined) return { label: "Marketed &\nManufactured By", text: combined };
  const marketed = value(d, "Marketed By / Imported By");
  const manufactured = value(d, "Manufactured By ") || "—";
  return {
    label: "Marketed By / Imported By\nManufactured By",
    text: `${marketed}\n${manufactured}`,
  };
}

function alphaCareText(d: Record<string, unknown>) {
  const combined = value(d, "Customer Care Details");
  if (combined) return combined;
  return [
    value(d, "For Consumer Complaints"),
    value(d, "Customer Care Address", "__EMPTY"),
    value(d, "Customer Care Email", "__EMPTY_1"),
  ]
    .filter(Boolean)
    .join("\n");
}

function fbfCompanyText(d: Record<string, unknown>) {
  const combined = value(d, ...FBF_COMPANY_KEYS);
  if (combined) {
    const mobile = value(d, "Mobile");
    const email = value(d, "Email");
    return [combined, mobile, email].filter(Boolean).join("\n");
  }
  return [
    value(d, "manufactured by/Marketed by & customer care details"),
    value(d, "Mobile"),
    value(d, "Email"),
  ]
    .filter(Boolean)
    .join("\n");
}

function ProductLabel({
  product,
  labelSize = "3x5",
  barcodeSource = "EAN",
}: {
  product: Product;
  labelSize?: LabelSize;
  barcodeSource?: BarcodeSource;
}) {
  const d = product.payload;
  const barcode = resolveProductBarcode(product, barcodeSource);
  const [layout, setLayout] = useState<SmartLabelLayout | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadPdfEngine().then((engine) => {
      if (cancelled) return;
      setLayout(
        engine.computeSmartLabelLayoutPx(product.marketplace, labelSize, {
          fsn: product.fsn,
          payload: d,
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [
    product.marketplace,
    product.fsn,
    product.ean,
    product.updatedAt,
    labelSize,
  ]);
  const rh = (px: number) => ({
    ["--rh" as string]: `${Math.max(4, px)}px`,
  });
  if (!layout) return null;

  if (product.marketplace === "Alpha") {
    const address = alphaAddressLines(d);
    const care = alphaCareText(d);
    return (
      <div className="label alphaLabel smartLayout">
        <div className="labelTitle" style={rh(layout.title)}>
          {product.fsn}
        </div>
        <div className="labelRow addressRow" style={rh(layout.special[0])}>
          <strong>
            {address.label.split("\n").map((line, i) => (
              <span key={`${line}-${i}`}>
                {i > 0 && <br />}
                {line}
              </span>
            ))}
          </strong>
          <span>
            {address.text.split("\n").map((line, i) => (
              <span key={`${line}-${i}`}>
                {i > 0 && <br />}
                {line}
              </span>
            ))}
          </span>
        </div>
        {alphaFields.map((field, i) => (
          <div className="labelRow" key={field.label} style={rh(layout.fields[i])}>
            <strong>{field.label}</strong>
            <span>
              {field.keys.some(isManufactureDateKey)
                ? previousMonthManufactureLabel()
                : value(d, ...field.keys)}
            </span>
          </div>
        ))}
        <div className="labelRow complaints" style={rh(layout.special[1])}>
          <strong>
            {value(d, "Customer Care Details")
              ? "Customer Care Details"
              : "For Consumer Complaints"}
          </strong>
          <span>
            {care.split("\n").map((line, i) => (
              <span key={`${line}-${i}`}>
                {i > 0 && <br />}
                {line}
              </span>
            ))}
          </span>
        </div>
        <div className="barcodeTitle" aria-hidden="true" />
        <div className="smartBarcode" style={rh(layout.barcode)}>
          <Barcode value={barcode.value} format={barcode.format} />
        </div>
      </div>
    );
  }
  return (
    <div className="label fbfLabel smartLayout">
      <div className="labelTitle" style={rh(layout.title)}>
        {value(d, "Category")}
      </div>
      {fbfFields.map((field, i) => (
        <div className="labelRow" key={field.label} style={rh(layout.fields[i])}>
          <strong>{field.label}</strong>
          <span>
            {field.keys.some(isManufactureDateKey)
              ? previousMonthManufactureLabel()
              : value(d, ...field.keys)}
          </span>
        </div>
      ))}
      <div className="labelRow company" style={rh(layout.special[0])}>
        <strong>Manufactured By/Marketed By &amp; Customer Care Details</strong>
        <span>
          {fbfCompanyText(d)
            .split("\n")
            .map((line, i) => (
              <span key={`${line}-${i}`}>
                {i > 0 && <br />}
                {line}
              </span>
            ))}
        </span>
      </div>
      <div className="barcodeTitle" aria-hidden="true" />
      <div className="smartBarcode" style={rh(layout.barcode)}>
        <Barcode value={barcode.value} format={barcode.format} />
      </div>
    </div>
  );
}
function AlphaPackLabel({ label }: { label: AlphaPack }) {
  return (
    <div className="packLabel alphaPack">
      <div>
        <strong>Invoice No.</strong>
        <span>{label.invoiceNo}</span>
      </div>
      <div>
        <strong>FSN</strong>
        <span>{label.fsn}</span>
      </div>
      <div>
        <strong>Qty</strong>
        <span>{label.qty}</span>
      </div>
      <div>
        <strong>PO No.</strong>
        <span>{label.po}</span>
      </div>
      <div>
        <strong>Box No.</strong>
        <span>{label.boxNo}</span>
      </div>
    </div>
  );
}
function FbfPackLabel({ label }: { label: FbfPack }) {
  return (
    <div className="packLabel fbfPack">
      <div className="consignment">{label.consignment}</div>
      <div className="slip">PACKAGING SLIP</div>
      <div className="packHead">
        <strong>Box No.</strong>
        <strong>SKU</strong>
        <strong>FSN</strong>
        <strong>QTY.</strong>
      </div>
      <div className="packItemsGroup">
        <span className="mergedBoxNo">{label.boxNo}</span>
        <div className="packItemRows">
          {label.items.map((item, i) => (
            <div className="packItem" key={`${item.sku}-${i}`}>
              <span>{item.sku}</span>
              <span>{item.fsn}</span>
              <span>{item.qty}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RunLabel({ run, index = 0 }: { run: PackagingRun; index?: number }) {
  const label = run.payload[index];
  return run.marketplace === "Alpha" ? (
    <AlphaPackLabel label={label as AlphaPack} />
  ) : (
    <FbfPackLabel label={label as FbfPack} />
  );
}

const ProductResultRow = memo(function ProductResultRow({
  product,
  isActive,
  isChecked,
  onToggle,
  onSelect,
}: {
  product: Product;
  isActive: boolean;
  isChecked: boolean;
  onToggle: (product: Product) => void;
  onSelect: (product: Product) => void;
}) {
  return (
    <div
      className={`resultRow${isActive ? " active" : ""}${isChecked ? " checked" : ""}`}
    >
      <label
        className="resultCheck"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => onToggle(product)}
          aria-label={`Select EAN ${product.ean}`}
        />
      </label>
      <button type="button" onClick={() => onSelect(product)}>
        <span className={`tag ${product.marketplace.toLowerCase()}`}>
          {product.marketplace}
        </span>
        <strong>{product.title || product.fsn}</strong>
        <small>EAN {product.ean}</small>
        <small>FSN {product.fsn}</small>
      </button>
    </div>
  );
});

const PackagingLabelRow = memo(function PackagingLabelRow({
  marketplace,
  title,
  meta,
  index,
  isActive,
  isChecked,
  onToggle,
  onSelect,
}: {
  marketplace: "Alpha" | "FBF";
  title: string;
  meta: string;
  index: number;
  isActive: boolean;
  isChecked: boolean;
  onToggle: (index: number) => void;
  onSelect: (index: number) => void;
}) {
  return (
    <div
      className={`resultRow${isActive ? " active" : ""}${isChecked ? " checked" : ""}`}
    >
      <label
        className="resultCheck"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => onToggle(index)}
          aria-label={`Select packaging label ${index + 1}`}
        />
      </label>
      <button type="button" onClick={() => onSelect(index)}>
        <span className={`tag ${marketplace.toLowerCase()}`}>{marketplace}</span>
        <strong>{title}</strong>
        {meta ? <small>{meta}</small> : null}
        <small>Label {index + 1}</small>
      </button>
    </div>
  );
});

export default function Home() {
  const [tab, setTab] = useState<"master" | "packaging">("master");
  const [marketplaceFilter, setMarketplaceFilter] = useState<"Alpha" | "FBF">(
    "Alpha",
  );
  const [products, setProducts] = useState<Product[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [runs, setRuns] = useState<PackagingRun[]>([]);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [packagingQuery, setPackagingQuery] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const [selectedRun, setSelectedRun] = useState<PackagingRun | null>(null);
  const [runLabelIndex, setRunLabelIndex] = useState(0);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [printScope, setPrintScope] = useState<"current" | "all" | null>(null);
  const [productPrintScope, setProductPrintScope] = useState<
    "current" | "all" | null
  >(null);
  const [actionMenu, setActionMenu] = useState<
    "download" | "print" | "product-download" | "product-print" | null
  >(null);
  const [downloading, setDownloading] = useState(false);
  const [labelSize, setLabelSize] = useState<LabelSize>("3x5");
  const [barcodeSource, setBarcodeSource] = useState<BarcodeSource>("EAN");
  const [selectionDialog, setSelectionDialog] = useState<
    "product" | "packaging" | null
  >(null);
  const [selectionInput, setSelectionInput] = useState("");
  const [checkedKeys, setCheckedKeys] = useState<string[]>([]);
  const [checkedPackIndexes, setCheckedPackIndexes] = useState<number[]>([]);
  const [authReady, setAuthReady] = useState(false);
  const [authRole, setAuthRole] = useState<AuthRole | null>(null);
  const [loginRole, setLoginRole] = useState<AuthRole>("viewer");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const canUpload = authRole === "admin";

  async function loadProducts(q = "") {
    setLoading(true);
    const r = await fetch(`/api/products?q=${encodeURIComponent(q)}`);
    if (r.status === 401) {
      setAuthRole(null);
      setLoading(false);
      return;
    }
    const j = await r.json();
    setProducts(j.products ?? []);
    setAppliedQuery(q.trim());
    if (!q) setAllProducts(j.products ?? []);
    if (q && j.products?.[0]) {
      setMarketplaceFilter(j.products[0].marketplace);
      setSelected(j.products[0]);
    }
    setSelected((current) =>
      current?.marketplace === marketplaceFilter
        ? current
        : ((j.products ?? []).find(
            (product: Product) => product.marketplace === marketplaceFilter,
          ) ??
          j.products?.[0] ??
          null),
    );
    setLoading(false);
  }
  function clearProductSearch() {
    setQuery("");
    setAppliedQuery("");
    loadProducts();
  }
  async function loadRuns() {
    const r = await fetch("/api/packaging");
    if (r.status === 401) {
      setAuthRole(null);
      return;
    }
    const j = await r.json();
    setRuns(j.runs ?? []);
    setSelectedRun((current) => {
      const uploaded = (j.runs ?? []).filter(
        (run: PackagingRun) => !isDemoPackagingRun(run),
      );
      const fresh = current
        ? uploaded.find((run: PackagingRun) => run.id === current.id)
        : undefined;
      if (fresh) return fresh;
      return (
        uploaded.find(
          (run: PackagingRun) => run.marketplace === marketplaceFilter,
        ) ??
        uploaded[0] ??
        null
      );
    });
  }
  async function refreshAuth() {
    const r = await fetch("/api/auth/me");
    if (!r.ok) {
      setAuthRole(null);
      setAuthReady(true);
      return null;
    }
    const j = (await r.json()) as { role?: AuthRole };
    const role = j.role === "admin" || j.role === "viewer" ? j.role : null;
    setAuthRole(role);
    setAuthReady(true);
    return role;
  }
  async function signIn(event?: { preventDefault(): void }) {
    event?.preventDefault();
    setLoginBusy(true);
    setLoginError("");
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: loginRole, password: loginPassword }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Sign in failed.");
      setAuthRole(j.role === "admin" ? "admin" : "viewer");
      setLoginPassword("");
      setNotice(
        j.role === "admin"
          ? "Signed in as Admin. Upload and all tools are available."
          : "Signed in as Viewer. You can browse, download, and print.",
      );
      await loadProducts();
      await loadRuns();
    } catch (error) {
      setLoginError(
        error instanceof Error ? error.message : "Sign in failed.",
      );
    } finally {
      setLoginBusy(false);
    }
  }
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthRole(null);
    setProducts([]);
    setAllProducts([]);
    setRuns([]);
    setSelected(null);
    setSelectedRun(null);
    setCheckedKeys([]);
    setNotice("Signed out.");
  }
  useEffect(() => {
    (async () => {
      const role = await refreshAuth();
      if (role) {
        await loadProducts();
        await loadRuns();
      }
    })();
  }, []);
  async function upload(file?: File) {
    if (!file) return;
    if (!canUpload) {
      setNotice("Viewer access cannot upload workbooks.");
      return;
    }
    setNotice("Reading workbook...");
    try {
      const parsed = await parseUpload(file, await file.arrayBuffer());
      if (parsed.kind === "product") {
        if (!parsed.products.length)
          throw new Error("No valid EAN and FSN product rows were found.");
        const r = await fetch("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ products: parsed.products }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setNotice(
          `${j.saved} ${parsed.marketplace} Product Master records saved from ${parsed.sourceSheet} (2nd sheet ignored — label reference only).`,
        );
        await loadProducts();
        setSelected(parsed.products[0]);
        setMarketplaceFilter(parsed.marketplace as "Alpha" | "FBF");
        setLabelSize((prev) =>
          clampLabelSize(prev, parsed.marketplace as "Alpha" | "FBF"),
        );
        setTab("master");
      } else {
        const r = await fetch("/api/packaging", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...parsed, sourceFile: file.name }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setNotice(
          `${j.run.labelCount} ${parsed.marketplace} packaging labels saved. Format detected: ${parsed.formatSheet}.`,
        );
        await loadRuns();
        setSelectedRun(j.run);
        setRunLabelIndex(0);
        setMarketplaceFilter(parsed.marketplace as "Alpha" | "FBF");
        setLabelSize((prev) =>
          clampLabelSize(prev, parsed.marketplace as "Alpha" | "FBF"),
        );
        setTab("packaging");
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Upload failed");
    }
  }
  async function printPackaging(scope: "current" | "all") {
    await loadPdfEngine();
    setActionMenu(null);
    setPrintScope(scope);
    setTimeout(() => {
      window.print();
      setPrintScope(null);
    }, 200);
  }
  async function printProducts(scope: "current" | "all") {
    await loadPdfEngine();
    setActionMenu(null);
    setProductPrintScope(scope);
    setTimeout(() => {
      window.print();
      setProductPrintScope(null);
    }, 200);
  }
  async function downloadProducts(
    scope: "current" | "all" | "selected",
    requestedIndexes: number[] = [],
  ) {
    if (!selected) return;
    setActionMenu(null);
    setDownloading(true);
    try {
      const currentIndex = Math.max(
        0,
        sourceProducts.findIndex(
          (product) =>
            product.ean === selected.ean &&
            product.marketplace === selected.marketplace,
        ),
      );
      const indexes =
        scope === "current"
          ? [currentIndex]
          : scope === "selected"
            ? requestedIndexes
            : sourceProducts.map((_, i) => i);
      const productsForPdf = indexes.map((index) => {
        const product = sourceProducts[index];
        if (!product) throw new Error("One or more selected labels could not be found.");
        return product;
      });
      const base = (selected.sourceFile || "product-labels").replace(
        /\.[^.]+$/,
        "",
      );
      const fileName = `${base}-${scope === "current" ? `EAN-${selected.ean}` : scope === "selected" ? "selected-labels" : "whole-file"}.pdf`;
      const { buildProductsPdf, downloadPdfBytes } = await loadPdfEngine();
      const bytes = await buildProductsPdf(
        productsForPdf,
        labelSize,
        barcodeSource,
      );
      downloadPdfBytes(bytes, fileName);
      setNotice(
        scope === "current"
          ? "The visible product label was downloaded as a sharp vector PDF."
          : scope === "selected"
            ? `${indexes.length} selected product labels were downloaded.`
            : `The complete ${base} product-label file was downloaded.`,
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "PDF download failed.");
    } finally {
      setDownloading(false);
    }
  }
  const toggleCheckedProduct = useCallback((product: Product) => {
    const key = productKey(product);
    setCheckedKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  }, []);
  const selectProduct = useCallback((product: Product) => {
    setSelected(product);
  }, []);
  const selectPackagingLabel = useCallback((index: number) => {
    setRunLabelIndex(index);
  }, []);
  const toggleCheckedPackLabel = useCallback((index: number) => {
    setCheckedPackIndexes((current) =>
      current.includes(index)
        ? current.filter((item) => item !== index)
        : [...current, index],
    );
  }, []);
  async function downloadPackaging(
    scope: "current" | "all" | "selected",
    requestedIndexes: number[] = [],
  ) {
    if (!selectedRun) return;
    setActionMenu(null);
    setDownloading(true);
    try {
      const indexes =
        scope === "current"
          ? [runLabelIndex]
          : scope === "selected"
            ? requestedIndexes
            : selectedRun.payload.map((_, i) => i);
      const base = selectedRun.sourceFile.replace(/\.[^.]+$/, "");
      const fileName = `${base}-${scope === "current" ? `label-${runLabelIndex + 1}` : scope === "selected" ? "selected-labels" : "whole-file"}.pdf`;
      const { buildPackagingPdf, downloadPdfBytes } = await loadPdfEngine();
      const bytes = await buildPackagingPdf(selectedRun, indexes, labelSize);
      downloadPdfBytes(bytes, fileName);
      setNotice(
        scope === "current"
          ? "The visible label was downloaded as a sharp vector PDF."
          : scope === "selected"
            ? `${indexes.length} selected packaging labels were downloaded.`
            : `All ${selectedRun.labelCount} labels were downloaded as one PDF.`,
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "PDF download failed.");
    } finally {
      setDownloading(false);
    }
  }
  function searchPackaging() {
    const q = packagingQuery.trim().toLowerCase();
    if (!q) {
      setNotice("Enter a file name, consignment, box number, SKU, or FSN.");
      return;
    }
    for (const run of runs) {
      if (isDemoPackagingRun(run)) continue;
      if (run.sourceFile.toLowerCase().includes(q)) {
        setSelectedRun(run);
        setRunLabelIndex(0);
        setMarketplaceFilter(run.marketplace);
        setNotice(`Found ${run.sourceFile}.`);
        return;
      }
      const index = run.payload.findIndex((label) =>
        JSON.stringify(label).toLowerCase().includes(q),
      );
      if (index >= 0) {
        setSelectedRun(run);
        setRunLabelIndex(index);
        setMarketplaceFilter(run.marketplace);
        setNotice(
          `Found in ${run.sourceFile}: label ${index + 1} of ${run.labelCount}.`,
        );
        return;
      }
    }
    setNotice(`No packaging record found for "${packagingQuery}".`);
  }
  const checkedKeySet = useMemo(() => new Set(checkedKeys), [checkedKeys]);
  const matchingSourceProducts = useMemo(
    () =>
      selected
        ? allProducts.filter(
            (product) =>
              product.sourceFile === selected.sourceFile &&
              product.marketplace === selected.marketplace,
          )
        : [],
    [allProducts, selected],
  );
  const sourceProducts = useMemo(
    () =>
      matchingSourceProducts.length
        ? matchingSourceProducts
        : selected
          ? [selected]
          : [],
    [matchingSourceProducts, selected],
  );
  const visibleProducts = useMemo(
    () =>
      products.filter((product) => product.marketplace === marketplaceFilter),
    [products, marketplaceFilter],
  );
  const checkedProducts = useMemo(
    () =>
      allProducts.filter((product) => checkedKeySet.has(productKey(product))),
    [allProducts, checkedKeySet],
  );
  const visibleCheckedCount = useMemo(
    () =>
      visibleProducts.filter((product) =>
        checkedKeySet.has(productKey(product)),
      ).length,
    [visibleProducts, checkedKeySet],
  );
  const allVisibleChecked =
    visibleProducts.length > 0 &&
    visibleCheckedCount === visibleProducts.length;
  const visibleRuns = useMemo(
    () =>
      runs.filter(
        (run) =>
          run.marketplace === marketplaceFilter && !isDemoPackagingRun(run),
      ),
    [runs, marketplaceFilter],
  );
  const uploadedRuns = useMemo(
    () => runs.filter((run) => !isDemoPackagingRun(run)),
    [runs],
  );
  const alphaProductCount = useMemo(
    () => allProducts.filter((product) => product.marketplace === "Alpha").length,
    [allProducts],
  );
  const fbfProductCount = useMemo(
    () => allProducts.filter((product) => product.marketplace === "FBF").length,
    [allProducts],
  );
  const alphaRunCount = useMemo(
    () =>
      uploadedRuns.filter((run) => run.marketplace === "Alpha").length,
    [uploadedRuns],
  );
  const fbfRunCount = useMemo(
    () => uploadedRuns.filter((run) => run.marketplace === "FBF").length,
    [uploadedRuns],
  );
  function chooseMarketplace(marketplace: "Alpha" | "FBF") {
    setMarketplaceFilter(marketplace);
    setLabelSize((prev) => clampLabelSize(prev, marketplace));
    setBarcodeSource(defaultBarcodeSource(marketplace));
    setCheckedKeys([]);
    if (tab === "master") {
      setSelected(
        products.find((product) => product.marketplace === marketplace) ??
          allProducts.find((product) => product.marketplace === marketplace) ??
          null,
      );
    } else {
      setSelectedRun(
        uploadedRuns.find((run) => run.marketplace === marketplace) ?? null,
      );
      setRunLabelIndex(0);
      setCheckedPackIndexes([]);
    }
  }

  // Keep size dropdown in sync when marketplace filter changes.
  useEffect(() => {
    setLabelSize((prev) => clampLabelSize(prev, marketplaceFilter));
    setBarcodeSource(defaultBarcodeSource(marketplaceFilter));
  }, [marketplaceFilter]);
  useEffect(() => {
    if (tab !== "packaging") return;
    if (
      selectedRun &&
      !isDemoPackagingRun(selectedRun) &&
      visibleRuns.some((run) => run.id === selectedRun.id)
    ) {
      return;
    }
    setSelectedRun(visibleRuns[0] ?? null);
    setRunLabelIndex(0);
    setCheckedPackIndexes([]);
  }, [tab, selectedRun, visibleRuns]);
  async function downloadCheckedProducts() {
    if (!checkedProducts.length) {
      setNotice("Select one or more products from the list first.");
      return;
    }
    setActionMenu(null);
    setDownloading(true);
    try {
      const fileName = `selected-eans-${checkedProducts.length}-labels.pdf`;
      const { buildProductsPdf, downloadPdfBytes } = await loadPdfEngine();
      const bytes = await buildProductsPdf(
        checkedProducts,
        labelSize,
        barcodeSource,
      );
      downloadPdfBytes(bytes, fileName);
      setNotice(
        `${checkedProducts.length} selected product labels were downloaded.`,
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "PDF download failed.");
    } finally {
      setDownloading(false);
    }
  }
  async function deleteCheckedProducts() {
    if (!canUpload) {
      setNotice("Viewer access cannot delete data.");
      return;
    }
    if (!checkedProducts.length) {
      setNotice("Select one or more products from the list first.");
      return;
    }
    const confirmed = window.confirm(
      `Delete ${checkedProducts.length} selected product${checkedProducts.length === 1 ? "" : "s"}? This cannot be undone.`,
    );
    if (!confirmed) return;
    setActionMenu(null);
    try {
      const r = await fetch("/api/products", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: checkedProducts.map((product) => ({
            marketplace: product.marketplace,
            ean: product.ean,
          })),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Delete failed.");
      const removedKeys = new Set(checkedProducts.map(productKey));
      setCheckedKeys((current) =>
        current.filter((key) => !removedKeys.has(key)),
      );
      if (selected && removedKeys.has(productKey(selected))) {
        setSelected(null);
      }
      setAllProducts((current) =>
        current.filter((product) => !removedKeys.has(productKey(product))),
      );
      await loadProducts(appliedQuery);
      setNotice(
        `${j.deleted ?? checkedProducts.length} product${(j.deleted ?? checkedProducts.length) === 1 ? "" : "s"} deleted.`,
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Delete failed.");
    }
  }
  async function deleteSelectedPackagingRun() {
    if (!canUpload) {
      setNotice("Viewer access cannot delete data.");
      return;
    }
    if (!selectedRun) return;
    const confirmed = window.confirm(
      `Delete packaging run "${selectedRun.sourceFile}" (${selectedRun.labelCount} labels)? This cannot be undone.`,
    );
    if (!confirmed) return;
    setActionMenu(null);
    try {
      const r = await fetch("/api/packaging", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedRun.id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Delete failed.");
      setSelectedRun(null);
      setRunLabelIndex(0);
      setCheckedPackIndexes([]);
      await loadRuns();
      setNotice(`Packaging run deleted.`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Delete failed.");
    }
  }
  function toggleAllPackLabels() {
    if (!selectedRun?.payload.length) return;
    setCheckedPackIndexes((current) =>
      current.length === selectedRun.payload.length
        ? []
        : selectedRun.payload.map((_, index) => index),
    );
  }
  async function deleteCheckedPackLabels() {
    if (!canUpload) {
      setNotice("Viewer access cannot delete data.");
      return;
    }
    if (!selectedRun || !checkedPackIndexes.length) {
      setNotice("Select one or more packaging labels first.");
      return;
    }
    const deletingAll =
      checkedPackIndexes.length === selectedRun.payload.length;
    const confirmed = window.confirm(
      deletingAll
        ? `Delete all ${selectedRun.labelCount} packaging labels from "${selectedRun.sourceFile}"? This cannot be undone.`
        : `Delete ${checkedPackIndexes.length} selected packaging label${checkedPackIndexes.length === 1 ? "" : "s"}? This cannot be undone.`,
    );
    if (!confirmed) return;
    try {
      const r = await fetch("/api/packaging", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedRun.id,
          indexes: deletingAll ? undefined : checkedPackIndexes,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Delete failed.");
      const removed = new Set(checkedPackIndexes);
      const remaining = selectedRun.payload
        .map((_, index) => index)
        .filter((index) => !removed.has(index));
      const kept = remaining.includes(runLabelIndex)
        ? remaining.indexOf(runLabelIndex)
        : remaining.findIndex((index) => index > runLabelIndex);
      setCheckedPackIndexes([]);
      setRunLabelIndex(
        deletingAll
          ? 0
          : kept >= 0
            ? kept
            : Math.max(0, remaining.length - 1),
      );
      if (!deletingAll && j.run) {
        setSelectedRun(j.run);
        setRuns((current) =>
          current.map((run) => (run.id === j.run.id ? j.run : run)),
        );
      } else {
        setSelectedRun(null);
      }
      await loadRuns();
      setNotice(
        deletingAll
          ? "Packaging run deleted."
          : `${j.deleted ?? checkedPackIndexes.length} packaging label${(j.deleted ?? checkedPackIndexes.length) === 1 ? "" : "s"} deleted.`,
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Delete failed.");
    }
  }
  function toggleAllVisibleProducts() {
    const visibleKeySet = new Set(visibleProducts.map(productKey));
    setCheckedKeys((current) =>
      allVisibleChecked
        ? current.filter((key) => !visibleKeySet.has(key))
        : Array.from(new Set([...current, ...visibleKeySet])),
    );
  }
  async function downloadChosenLabels() {
    try {
      const total =
        selectionDialog === "product"
          ? sourceProducts.length
          : (selectedRun?.labelCount ?? 0);
      const indexes = parseLabelNumbers(selectionInput, total);
      const kind = selectionDialog;
      setSelectionDialog(null);
      setSelectionInput("");
      if (kind === "product") await downloadProducts("selected", indexes);
      if (kind === "packaging") await downloadPackaging("selected", indexes);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Invalid label selection.",
      );
    }
  }
  return (
    <main className={`size-${labelSize}`}>
      <style>{`@media print { @page { size: ${labelSizeCssInches(labelSize).width} ${labelSizeCssInches(labelSize).height}; margin: 0; } }`}</style>
      {!authReady ? (
        <div className="authBoot">
          <span className="brandMark">LT</span>
          <p>Opening LabelTrix…</p>
        </div>
      ) : !authRole ? (
        <section className="authGate" aria-label="LabelTrix sign in">
          <div className="authPanel">
            <div className="brandLine">
              <span className="brandMark">LT</span>
              <span className="eyebrow">Label studio</span>
            </div>
            <h1>LabelTrix</h1>
            <p className="authLead">
              Choose your access level. Admin can upload data. Viewer can browse,
              download, and print.
            </p>
            <form className="authForm" onSubmit={signIn}>
              <div className="authRoleSwitch" role="group" aria-label="Access level">
                <button
                  type="button"
                  className={loginRole === "admin" ? "active" : ""}
                  onClick={() => setLoginRole("admin")}
                >
                  Admin
                  <small>Upload + full tools</small>
                </button>
                <button
                  type="button"
                  className={loginRole === "viewer" ? "active" : ""}
                  onClick={() => setLoginRole("viewer")}
                >
                  Viewer
                  <small>View · download · print</small>
                </button>
              </div>
              <label className="authField">
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  placeholder={
                    loginRole === "admin"
                      ? "Admin access password"
                      : "Viewer access password"
                  }
                />
              </label>
              {loginError ? <p className="authError">{loginError}</p> : null}
              <button
                type="submit"
                className="authSubmit"
                disabled={loginBusy || !loginPassword}
              >
                {loginBusy ? "Signing in…" : "Enter LabelTrix"}
              </button>
            </form>
          </div>
        </section>
      ) : (
        <>
      <header>
        <div className="heroCopy">
          <div className="brandLine">
            <span className="brandMark">LT</span>
            <span className="eyebrow">Label studio</span>
          </div>
          <h1>LabelTrix</h1>
          <p>
            Product masters once. Packaging runs whenever boxes move. Alpha and
            FBF, prepared for print.
          </p>
        </div>
        <div className="headerActions">
          <div className="sessionMeta">
            <span className={`roleBadge ${authRole}`}>
              {authRole === "admin" ? "Admin" : "Viewer"}
            </span>
            <span className="systemStatus">
              <i />
              Ready
            </span>
            <button type="button" className="signOutButton" onClick={signOut}>
              Sign out
            </button>
          </div>
          {canUpload ? (
            <label className="uploadButton">
              <span className="uploadIcon">↗</span>
              <span>
                Upload workbook<small>XLSX · approved format</small>
              </span>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => upload(e.target.files?.[0])}
              />
            </label>
          ) : (
            <div className="viewerHint">
              View-only access
              <small>Download and print enabled</small>
            </div>
          )}
        </div>
      </header>
      {notice && (
        <div className="notice">
          {notice}
          <button onClick={() => setNotice("")}>x</button>
        </div>
      )}
      {selectionDialog && (
        <div className="selectionOverlay" role="presentation">
          <section
            className="selectionModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="selection-title"
          >
            <div className="selectionModalHead">
              <div>
                <span className="tag">
                  {selectionDialog === "product" ? "PRODUCT" : "PACKAGING"}
                </span>
                <h2 id="selection-title">Choose specific labels</h2>
                <p>
                  Available labels: 1-
                  {selectionDialog === "product"
                    ? sourceProducts.length
                    : selectedRun?.labelCount}
                </p>
              </div>
              <button
                className="modalClose"
                onClick={() => setSelectionDialog(null)}
                aria-label="Close label selection"
              >
                ×
              </button>
            </div>
            <label className="selectionField">
              Label numbers
              <input
                autoFocus
                value={selectionInput}
                onChange={(event) => setSelectionInput(event.target.value)}
                onKeyDown={(event) =>
                  event.key === "Enter" && downloadChosenLabels()
                }
                placeholder="Example: 4, 28, 35-40"
              />
            </label>
            <p className="selectionHint">
              Separate numbers with commas. Use a hyphen to select a continuous
              range.
            </p>
            <div className="selectionActions">
              <button
                className="secondaryAction"
                onClick={() => setSelectionDialog(null)}
              >
                Cancel
              </button>
              <button className="printButton" onClick={downloadChosenLabels}>
                Download selected PDF
              </button>
            </div>
          </section>
        </div>
      )}
      <nav className="tabs">
        <button
          className={tab === "master" ? "active" : ""}
          onClick={() => {
            setTab("master");
            setSelected(
              products.find(
                (product) => product.marketplace === marketplaceFilter,
              ) ??
                allProducts.find(
                  (product) => product.marketplace === marketplaceFilter,
                ) ??
                null,
            );
          }}
        >
          <span className="tabIcon">◇</span>
          <strong>Product Master</strong>
          <span>One-time barcode files</span>
        </button>
        <button
          className={tab === "packaging" ? "active" : ""}
          onClick={() => {
            setTab("packaging");
            setSelectedRun(
              runs.find((run) => run.marketplace === marketplaceFilter) ?? null,
            );
            setRunLabelIndex(0);
          }}
        >
          <span className="tabIcon">⌁</span>
          <strong>Packaging Runs</strong>
          <span>Recurring non-barcode files</span>
        </button>
      </nav>
      <nav className="marketplaceSubmenu" aria-label={`${tab} marketplace`}>
        <span>{tab === "master" ? "Product type" : "Run type"}</span>
        <button
          className={marketplaceFilter === "Alpha" ? "active alpha" : "alpha"}
          onClick={() => chooseMarketplace("Alpha")}
        >
          <i /> Alpha
          <small>
            {tab === "master" ? alphaProductCount : alphaRunCount}
          </small>
        </button>
        <button
          className={marketplaceFilter === "FBF" ? "active fbf" : "fbf"}
          onClick={() => chooseMarketplace("FBF")}
        >
          <i /> FBF
          <small>
            {tab === "master" ? fbfProductCount : fbfRunCount}
          </small>
        </button>
      </nav>
      {tab === "packaging" && (
        <div className="packagingSearchBar">
          <input
            value={packagingQuery}
            onChange={(e) => setPackagingQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchPackaging()}
            placeholder="Search file, consignment, box, SKU or FSN"
          />
          <button onClick={searchPackaging}>Search packaging</button>
        </div>
      )}
      {tab === "master" ? (
        <>
          <section className="stats">
            <div>
              <span>Master products</span>
              <strong>{products.length}</strong>
            </div>
            <div>
              <span>Alpha products</span>
              <strong>
                {products.filter((p) => p.marketplace === "Alpha").length}
              </strong>
            </div>
            <div>
              <span>FBF products</span>
              <strong>
                {products.filter((p) => p.marketplace === "FBF").length}
              </strong>
            </div>
            <div>
              <span>Output rule</span>
              <strong className="ready">
                {marketplaceFilter === "FBF" ? "FSN barcode" : "EAN barcode"}
              </strong>
            </div>
          </section>
          <section className="workspace">
            <aside>
              <div className="search">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && loadProducts(query)}
                  placeholder="Search EAN, FSN, SKU, brand..."
                />
                {appliedQuery ? (
                  <button
                    type="button"
                    className="searchBack"
                    onClick={clearProductSearch}
                    title="Show all products"
                  >
                    Back
                  </button>
                ) : null}
                <button onClick={() => loadProducts(query)}>Search</button>
              </div>
              <div className="resultHeading">
                <span>
                  {appliedQuery ? (
                    <>
                      Search results
                      <em className="searchQueryChip">“{appliedQuery}”</em>
                    </>
                  ) : (
                    "Product Master"
                  )}
                </span>
                <small>
                  {loading ? "Loading..." : `${visibleProducts.length} found`}
                </small>
              </div>
              {appliedQuery ? (
                <div className="searchFilterBar">
                  <button
                    type="button"
                    className="searchBackLink"
                    onClick={clearProductSearch}
                  >
                    ← Back to all products
                  </button>
                </div>
              ) : null}
              {visibleProducts.length > 0 && (
                <div className="resultSelectBar">
                  <label className="resultSelectAll">
                    <input
                      type="checkbox"
                      checked={allVisibleChecked}
                      ref={(node) => {
                        if (node)
                          node.indeterminate =
                            visibleCheckedCount > 0 && !allVisibleChecked;
                      }}
                      onChange={toggleAllVisibleProducts}
                    />
                    <span>
                      {checkedKeys.length
                        ? `${checkedKeys.length} selected`
                        : "Select"}
                    </span>
                  </label>
                  <div className="resultSelectActions">
                    {checkedKeys.length > 0 && (
                      <>
                        <button
                          type="button"
                          className="resultSelectClear"
                          onClick={() => setCheckedKeys([])}
                        >
                          Clear
                        </button>
                        {canUpload ? (
                          <button
                            type="button"
                            className="resultSelectDelete"
                            onClick={deleteCheckedProducts}
                          >
                            Delete ({checkedKeys.length})
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="resultSelectDownload"
                          disabled={downloading}
                          onClick={downloadCheckedProducts}
                        >
                          {downloading
                            ? "Preparing..."
                            : `Download (${checkedKeys.length})`}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
              <div className="results">
                {visibleProducts.map((p) => {
                  const key = productKey(p);
                  return (
                    <ProductResultRow
                      key={key}
                      product={p}
                      isActive={
                        selected?.ean === p.ean &&
                        selected.marketplace === p.marketplace
                      }
                      isChecked={checkedKeySet.has(key)}
                      onToggle={toggleCheckedProduct}
                      onSelect={selectProduct}
                    />
                  );
                })}
              </div>
            </aside>
            <article>
              {selected ? (
                <>
                  <div className="detailHead">
                    <div>
                      <span
                        className={`tag ${selected.marketplace.toLowerCase()}`}
                      >
                        {selected.marketplace}
                      </span>
                      <h2>{selected.title || selected.fsn}</h2>
                      <p>
                        Source: {selected.sourceFile || "Product Master"} |
                        Data: Product Details (sheet 1)
                      </p>
                    </div>
                    <label className="detailSizeSelect">
                      <span>Label size</span>
                      <select
                        value={labelSize}
                        onChange={(event) =>
                          setLabelSize(event.target.value as LabelSize)
                        }
                        aria-label="Choose label size"
                      >
                        {labelSizesForMarketplace(marketplaceFilter).map(
                          (size) => (
                          <option key={size} value={size}>
                            {size.replace("x", " × ")} in
                          </option>
                        ),
                        )}
                      </select>
                    </label>
                    <label className="detailSizeSelect">
                      <span>Barcode from</span>
                      <select
                        value={barcodeSource}
                        onChange={(event) =>
                          setBarcodeSource(event.target.value as BarcodeSource)
                        }
                        aria-label="Choose barcode source"
                      >
                        <option value="EAN">EAN</option>
                        <option value="FSN">FSN</option>
                      </select>
                    </label>
                    <div className="actionMenus">
                      <div className="actionMenu">
                        <button
                          className="printButton"
                          disabled={downloading}
                          onClick={() =>
                            setActionMenu(
                              actionMenu === "product-download"
                                ? null
                                : "product-download",
                            )
                          }
                        >
                          {downloading ? "Preparing PDF..." : "Download PDF"}
                        </button>
                        {actionMenu === "product-download" && (
                          <div className="actionDropdown">
                            <button onClick={() => downloadProducts("current")}>
                              This label
                            </button>
                            <button onClick={() => downloadProducts("all")}>
                              Whole file ({sourceProducts.length} labels)
                            </button>
                            <button
                              className="specificChoice"
                              onClick={() => {
                                setActionMenu(null);
                                setSelectionInput("");
                                setSelectionDialog("product");
                              }}
                            >
                              Choose specific labels…
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="actionMenu">
                        <button
                          className="secondaryAction"
                          onClick={() =>
                            setActionMenu(
                              actionMenu === "product-print"
                                ? null
                                : "product-print",
                            )
                          }
                        >
                          Print
                        </button>
                        {actionMenu === "product-print" && (
                          <div className="actionDropdown">
                            <button onClick={() => printProducts("current")}>
                              This label
                            </button>
                            <button onClick={() => printProducts("all")}>
                              Whole file ({sourceProducts.length} labels)
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <p className="gummingPrintTip">
                      Gumming printer: use <strong>Download PDF</strong>, set
                      paper to the same label size ({labelSize.replace("x", " × ")}{" "}
                      in), and print at <strong>Actual size / 100%</strong> — never
                      Fit or Shrink to page.
                    </p>
                  </div>
                  <div className="detailGrid">
                    <section className="record">
                      <h3>Stored source details</h3>
                      {Object.entries(selected.payload)
                        .filter(([, v]) => String(v ?? "").trim())
                        .map(([k, v]) => (
                          <div key={k}>
                            <span>{k}</span>
                            <strong>{String(v)}</strong>
                          </div>
                        ))}
                    </section>
                    <section className="preview">
                      <div className="previewHead">
                        <h3>Product label preview</h3>
                        <span>
                          Exact PDF · barcode from {barcodeSource}
                        </span>
                      </div>
                      <ExactPdfPreview
                        labelSize={labelSize}
                        buildKey={[
                          selected.marketplace,
                          selected.ean,
                          selected.fsn,
                          labelSize,
                          barcodeSource,
                          selected.updatedAt || "",
                          JSON.stringify(selected.payload),
                        ].join("|")}
                        build={() =>
                          loadPdfEngine().then((engine) =>
                            engine.buildProductsPdf(
                              [selected],
                              labelSize,
                              barcodeSource,
                            ),
                          )
                        }
                      />
                    </section>
                  </div>
                  {productPrintScope && (
                    <div className="productPrintRun">
                      {(productPrintScope === "current"
                        ? [selected]
                        : sourceProducts
                      ).map((product) => (
                        <div
                          className="productPrintPage"
                          key={`${product.marketplace}-${product.ean}`}
                        >
                          <ProductLabel
                            product={product}
                            labelSize={labelSize}
                            barcodeSource={barcodeSource}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="empty">
                  {canUpload
                    ? "Upload or select a product."
                    : "Select a product to preview, download, or print."}
                </div>
              )}
            </article>
          </section>
        </>
      ) : (
        <>
          <section className="stats">
            <div>
              <span>Packaging uploads</span>
              <strong>{uploadedRuns.length}</strong>
            </div>
            <div>
              <span>Alpha runs</span>
              <strong>
                {uploadedRuns.filter((r) => r.marketplace === "Alpha").length}
              </strong>
            </div>
            <div>
              <span>FBF runs</span>
              <strong>
                {uploadedRuns.filter((r) => r.marketplace === "FBF").length}
              </strong>
            </div>
            <div>
              <span>Output rule</span>
              <strong className="ready">No barcode</strong>
            </div>
          </section>
          <section className="workspace">
            <aside>
              <div className="resultHeading">
                <span>Packaging labels</span>
                <small>
                  {selectedRun
                    ? `${selectedRun.labelCount} found`
                    : "0 found"}
                </small>
              </div>
              {selectedRun && selectedRun.payload.length > 0 ? (
                <div className="resultSelectBar">
                  <label className="resultSelectAll">
                    <input
                      type="checkbox"
                      checked={
                        checkedPackIndexes.length ===
                        selectedRun.payload.length
                      }
                      ref={(node) => {
                        if (node)
                          node.indeterminate =
                            checkedPackIndexes.length > 0 &&
                            checkedPackIndexes.length <
                              selectedRun.payload.length;
                      }}
                      onChange={toggleAllPackLabels}
                    />
                    <span>
                      {checkedPackIndexes.length
                        ? `${checkedPackIndexes.length} selected`
                        : "Select"}
                    </span>
                  </label>
                  <div className="resultSelectActions">
                    {checkedPackIndexes.length > 0 && (
                      <>
                        <button
                          type="button"
                          className="resultSelectClear"
                          onClick={() => setCheckedPackIndexes([])}
                        >
                          Clear
                        </button>
                        {canUpload ? (
                          <button
                            type="button"
                            className="resultSelectDelete"
                            onClick={deleteCheckedPackLabels}
                          >
                            Delete ({checkedPackIndexes.length})
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              ) : null}
              {visibleRuns.length > 1 ? (
                <div className="search">
                  <select
                    aria-label="Choose uploaded packaging workbook"
                    value={selectedRun?.id ?? ""}
                    onChange={(event) => {
                      const next = visibleRuns.find(
                        (run) => String(run.id) === event.target.value,
                      );
                      if (!next) return;
                      setSelectedRun(next);
                      setRunLabelIndex(0);
                      setCheckedPackIndexes([]);
                    }}
                  >
                    {visibleRuns.map((run) => (
                      <option key={run.id} value={run.id}>
                        {run.sourceFile} ({run.labelCount})
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="results">
                {selectedRun
                  ? selectedRun.payload.map((label, index) => {
                      const row = packagingLabelSummary(
                        selectedRun.marketplace,
                        label,
                        index,
                      );
                      return (
                        <PackagingLabelRow
                          key={`${selectedRun.id}-${index}`}
                          marketplace={selectedRun.marketplace}
                          title={row.title}
                          meta={row.meta}
                          index={index}
                          isActive={index === runLabelIndex}
                          isChecked={checkedPackIndexes.includes(index)}
                          onToggle={toggleCheckedPackLabel}
                          onSelect={selectPackagingLabel}
                        />
                      );
                    })
                  : null}
              </div>
            </aside>
            <article>
              {selectedRun ? (
                <>
                  <div className="detailHead">
                    <div>
                      <span
                        className={`tag ${selectedRun.marketplace.toLowerCase()}`}
                      >
                        {selectedRun.marketplace}
                      </span>
                      <h2>{selectedRun.sourceFile}</h2>
                      <p>
                        Source: {selectedRun.sourceSheet} | Format:{" "}
                        {selectedRun.formatSheet} | {selectedRun.labelCount}{" "}
                        labels
                      </p>
                    </div>
                    <label className="detailSizeSelect">
                      <span>Label size</span>
                      <select
                        value={labelSize}
                        onChange={(event) =>
                          setLabelSize(event.target.value as LabelSize)
                        }
                        aria-label="Choose label size"
                      >
                        {labelSizesForMarketplace(marketplaceFilter).map(
                          (size) => (
                          <option key={size} value={size}>
                            {size.replace("x", " × ")} in
                          </option>
                        ),
                        )}
                      </select>
                    </label>
                    <div className="actionMenus">
                      {canUpload ? (
                        <button
                          type="button"
                          className="dangerAction"
                          onClick={deleteSelectedPackagingRun}
                        >
                          Delete run
                        </button>
                      ) : null}
                      <div className="actionMenu">
                        <button
                          className="printButton"
                          disabled={downloading}
                          onClick={() =>
                            setActionMenu(
                              actionMenu === "download" ? null : "download",
                            )
                          }
                        >
                          {downloading ? "Preparing PDF..." : "Download PDF"}
                        </button>
                        {actionMenu === "download" && (
                          <div className="actionDropdown">
                            <button
                              onClick={() => downloadPackaging("current")}
                            >
                              This label
                            </button>
                            <button onClick={() => downloadPackaging("all")}>
                              Whole file ({selectedRun.labelCount} labels)
                            </button>
                            <button
                              className="specificChoice"
                              onClick={() => {
                                setActionMenu(null);
                                setSelectionInput("");
                                setSelectionDialog("packaging");
                              }}
                            >
                              Choose specific labels…
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="actionMenu">
                        <button
                          className="secondaryAction"
                          onClick={() =>
                            setActionMenu(
                              actionMenu === "print" ? null : "print",
                            )
                          }
                        >
                          Print
                        </button>
                        {actionMenu === "print" && (
                          <div className="actionDropdown">
                            <button onClick={() => printPackaging("current")}>
                              This label
                            </button>
                            <button onClick={() => printPackaging("all")}>
                              Whole file ({selectedRun.labelCount} labels)
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="detailGrid packagingDetail">
                    <section className="record">
                      <h3>Upload summary</h3>
                      <div>
                        <span>Marketplace</span>
                        <strong>{selectedRun.marketplace}</strong>
                      </div>
                      <div>
                        <span>Source sheet</span>
                        <strong>{selectedRun.sourceSheet}</strong>
                      </div>
                      <div>
                        <span>Format sheet</span>
                        <strong>{selectedRun.formatSheet}</strong>
                      </div>
                      <div>
                        <span>Generated labels</span>
                        <strong>{selectedRun.labelCount}</strong>
                      </div>
                      <div>
                        <span>Barcode</span>
                        <strong>Not required</strong>
                      </div>
                    </section>
                    <section className="preview">
                      <div className="previewHead">
                        <h3>{selectedRun.formatSheet}</h3>
                        <div className="labelNavigator">
                          <button
                            disabled={runLabelIndex === 0}
                            onClick={() =>
                              setRunLabelIndex((i) => Math.max(0, i - 1))
                            }
                          >
                            Previous
                          </button>
                          <strong>
                            Label {runLabelIndex + 1} of{" "}
                            {selectedRun.labelCount}
                          </strong>
                          <button
                            disabled={
                              runLabelIndex === selectedRun.labelCount - 1
                            }
                            onClick={() =>
                              setRunLabelIndex((i) =>
                                Math.min(selectedRun.labelCount - 1, i + 1),
                              )
                            }
                          >
                            Next
                          </button>
                        </div>
                      </div>
                      <ExactPdfPreview
                        labelSize={labelSize}
                        buildKey={[
                          selectedRun.id ?? selectedRun.sourceFile,
                          String(runLabelIndex),
                          labelSize,
                          selectedRun.marketplace,
                        ].join("|")}
                        build={() =>
                          loadPdfEngine().then((engine) =>
                            engine.buildPackagingPdf(
                              selectedRun,
                              [runLabelIndex],
                              labelSize,
                            ),
                          )
                        }
                      />
                    </section>
                  </div>
                  {printScope && (
                    <div className="printRun">
                      {(printScope === "current"
                        ? [runLabelIndex]
                        : selectedRun.payload.map((_, i) => i)
                      ).map((i) => (
                        <div className="printPage" key={i}>
                          <RunLabel run={selectedRun} index={i} />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="empty">
                  {canUpload
                    ? "Upload an Alpha or FBF Packaging List, or load a demo workbook above."
                    : "Select a packaging run, or download a demo Excel above to inspect the format."}
                </div>
              )}
            </article>
          </section>
        </>
      )}
        </>
      )}
    </main>
  );
}

