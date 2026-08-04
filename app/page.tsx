"use client";

import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import JsBarcode from "jsbarcode";

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

function productKey(product: Product) {
  return `${product.marketplace}|${product.ean}`;
}
function value(row: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys)
    if (row[key] !== undefined && row[key] !== null) return String(row[key]);
  return "";
}
function excelDate(v: unknown) {
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

function readRows(wb: XLSX.WorkBook, name: string) {
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], {
    defval: "",
    raw: true,
  });
}
function parseUpload(file: File, bytes: ArrayBuffer) {
  const wb = XLSX.read(bytes, { type: "array", cellDates: false, raw: true });
  const names = wb.SheetNames;
  if (
    names.includes("Product Details") &&
    names.includes("Product Label Format")
  ) {
    const rows = readRows(wb, "Product Details");
    const fbf = rows.some((r) => "model_name" in r || "Category" in r);
    const products = rows
      .map((r) => {
        const payload = { ...r };
        const dateKey = fbf
          ? "month and year of manufactured"
          : "Date Of Manufacture ";
        if (dateKey in payload) payload[dateKey] = excelDate(payload[dateKey]);
        return {
          marketplace: fbf ? "FBF" : "Alpha",
          ean: value(r, "EAN", "Ean", "ean"),
          fsn: value(r, "FSN", "Fsn", "fsn"),
          sku: value(r, "model_number", "Style Code", "SKU", "SKU Id"),
          title: value(r, "model_name", "Brand ", "Product Title"),
          brand: value(r, "brand", "Brand "),
          payload,
          sourceFile: file.name,
        } as Product;
      })
      .filter((p) => p.ean && p.fsn);
    return {
      kind: "product" as const,
      marketplace: fbf ? "FBF" : "Alpha",
      sourceSheet: "Product Details",
      formatSheet: "Product Label Format",
      products,
    };
  }
  if (names.includes("Packaging List") && names.includes("Label Format")) {
    const payload = readRows(wb, "Packaging List").map((r) => ({
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
    const rows = readRows(wb, "FBF Packaging List");
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
  throw new Error(
    "Workbook type not recognised. It must contain one of the four approved source + format sheet pairs.",
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
    try {
      const canvas = document.createElement("canvas");
      JsBarcode(canvas, value, {
        format,
        displayValue: false,
        margin: 9,
        height: 144,
        width: format === "EAN13" ? 6.15 : 2.4,
        fontSize: 14,
        background: "#ffffff",
      });
      setBarcodeImage(canvas.toDataURL("image/png"));
    } catch {
      setBarcodeImage("");
    }
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
const alphaFields = [
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
function ProductLabel({ product }: { product: Product }) {
  const d = product.payload;
  if (product.marketplace === "Alpha")
    return (
      <div className="label alphaLabel">
        <div className="labelTitle">{product.fsn}</div>
        {alphaFields.map((k) => (
          <div
            className={`labelRow ${k === "Marketed By / Imported By" ? "addressRow" : ""} ${k === "Manufactured By " ? "manufacturedRow" : ""}`}
            key={k}
          >
            <strong>{k.trim()}</strong>
            <span>{value(d, k)}</span>
          </div>
        ))}
        <div className="labelRow complaints">
          <strong>For Consumer Complaints</strong>
          <span>
            {value(d, "For Consumer Complaints")}
            <br />
            {value(d, "Customer Care Address")}
            <br />
            {value(d, "Customer Care Email")}
          </span>
        </div>
        <Barcode value={product.ean} format="EAN13" />
      </div>
    );
  return (
    <div className="label fbfLabel">
      <div className="labelTitle">{value(d, "Category")}</div>
      {fbfFields.map((k) => (
        <div className="labelRow" key={k}>
          <strong>{k}</strong>
          <span>{value(d, k)}</span>
        </div>
      ))}
      <div className="labelRow company">
        <strong>manufactured by/Marketed by &amp; customer care details</strong>
        <span>
          {value(d, "manufactured by/Marketed by & customer care details")}
          <br />
          {value(d, "Mobile")}
          <br />
          {value(d, "Email")}
        </span>
      </div>
      <div className="barcodeTitle" aria-hidden="true" />
      <Barcode value={product.fsn} format="CODE128" />
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

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function waitForLabelAssets(nodes: HTMLElement[]) {
  await document.fonts.ready;
  const images = nodes.flatMap((node) =>
    Array.from(node.querySelectorAll("img")),
  );
  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) resolve();
          else {
            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => resolve(), { once: true });
          }
        }),
    ),
  );
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

function nativePdfDocument(
  nodes: HTMLElement[],
  indexes: number[],
  labelSize: "3x5" | "3x4" | "3x3",
) {
  const pageHeight = labelSize === "3x5" ? 5 : labelSize === "3x4" ? 4 : 3;
  const chosenNodes = indexes.map((index) => nodes[index]);
  if (!chosenNodes.length || chosenNodes.some((node) => !node)) {
    throw new Error("One or more selected labels could not be found.");
  }

  const activeCss = Array.from(document.styleSheets)
    .map((sheet) => {
      try {
        return Array.from(sheet.cssRules)
          .map((rule) => rule.cssText)
          .join("\n");
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .join("\n");
  const pages = chosenNodes
    .map(
      (node) =>
        `<section class="nativePdfPage size-${labelSize}">${node.innerHTML}</section>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <base href="${escapeHtmlAttribute(document.baseURI)}">
    <style>${activeCss}
      @page { size: 3in ${pageHeight}in; margin: 0; }
      html, body {
        width: 3in;
        margin: 0;
        padding: 0;
        overflow: visible;
        background: #fff;
      }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .nativePdfPage {
        box-sizing: border-box;
        width: 3in;
        height: ${pageHeight}in;
        min-height: ${pageHeight}in;
        max-height: ${pageHeight}in;
        margin: 0;
        padding: 0;
        overflow: hidden;
        background: #fff;
        page-break-after: always;
        break-after: page;
      }
      .nativePdfPage > .label,
      .nativePdfPage > .packLabel {
        position: static !important;
        box-sizing: border-box !important;
        width: 100% !important;
        height: 100% !important;
        min-width: 100% !important;
        max-width: 100% !important;
        min-height: 100% !important;
        max-height: 100% !important;
        margin: 0 !important;
        break-inside: auto !important;
        page-break-inside: auto !important;
        animation: none !important;
        box-shadow: none !important;
      }
      .nativePdfPage > .label { display: flex !important; flex-direction: column !important; }
      .nativePdfPage > .packLabel { display: block !important; }
      .nativePdfPage .label,
      .nativePdfPage .packLabel {
        -webkit-font-smoothing: none !important;
        font-smooth: never !important;
        text-rendering: geometricPrecision !important;
      }
      .nativePdfPage .label,
      .nativePdfPage .packLabel,
      .nativePdfPage .barcodeBox,
      .nativePdfPage .barcodeImage {
        animation: none !important;
        transform: none !important;
      }
      .nativePdfPage .labelTitle,
      .nativePdfPage .barcodeTitle {
        font-weight: 600 !important;
        letter-spacing: 0.15px !important;
      }
      .nativePdfPage .labelRow > strong,
      .nativePdfPage .alphaPack strong,
      .nativePdfPage .fbfPack strong {
        font-weight: 500 !important;
        letter-spacing: 0.12px !important;
      }
      .nativePdfPage .labelRow > span,
      .nativePdfPage .alphaPack span,
      .nativePdfPage .fbfPack span {
        font-weight: 400 !important;
        letter-spacing: 0.08px !important;
      }
      .nativePdfPage .barcodeNumber {
        transform: none !important;
        max-width: 100% !important;
        font-weight: 500 !important;
      }
      .nativePdfPage .barcodeImage {
        max-width: 100% !important;
        image-rendering: crisp-edges !important;
      }
    </style>
  </head>
  <body>${pages}</body>
</html>`;
}

async function downloadNativePdf(
  nodes: HTMLElement[],
  indexes: number[],
  labelSize: "3x5" | "3x4" | "3x3",
  fileName: string,
) {
  const chosenNodes = indexes.map((index) => nodes[index]);
  if (!chosenNodes.length || chosenNodes.some((node) => !node)) {
    throw new Error("One or more selected labels could not be found.");
  }
  await waitForLabelAssets(chosenNodes);

  // Keep each Chromium render small — thousands of labels in one HTML request
  // will exhaust memory. Chunks are merged client-side with pdf-lib.
  const chunkSize = 40;
  const { PDFDocument } = await import("pdf-lib");
  const merged = await PDFDocument.create();

  for (let start = 0; start < indexes.length; start += chunkSize) {
    const slice = indexes.slice(start, start + chunkSize);
    let response: Response;
    try {
      response = await fetch("http://127.0.0.1:3100/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          html: nativePdfDocument(nodes, slice, labelSize),
          labelSize,
          fileName,
        }),
      });
    } catch {
      throw new Error(
        "The native PDF service is not running. Restart the dashboard and try again.",
      );
    }

    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(result?.error || "Native PDF export failed.");
    }

    const part = await PDFDocument.load(await response.arrayBuffer());
    const pages = await merged.copyPages(part, part.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }

  const bytes = await merged.save();
  const blob = new Blob([Uint8Array.from(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
function RunLabel({ run, index = 0 }: { run: PackagingRun; index?: number }) {
  const label = run.payload[index];
  return run.marketplace === "Alpha" ? (
    <AlphaPackLabel label={label as AlphaPack} />
  ) : (
    <FbfPackLabel label={label as FbfPack} />
  );
}

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
  const [labelSize, setLabelSize] = useState<"3x5" | "3x4" | "3x3">("3x5");
  const [selectionDialog, setSelectionDialog] = useState<
    "product" | "packaging" | null
  >(null);
  const [selectionInput, setSelectionInput] = useState("");
  const [checkedKeys, setCheckedKeys] = useState<string[]>([]);
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
    setSelectedRun((current) =>
      current?.marketplace === marketplaceFilter
        ? current
        : ((j.runs ?? []).find(
            (run: PackagingRun) => run.marketplace === marketplaceFilter,
          ) ??
          j.runs?.[0] ??
          null),
    );
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
    setNotice("Reading both the source and format sheets...");
    try {
      const parsed = parseUpload(file, await file.arrayBuffer());
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
          `${j.saved} ${parsed.marketplace} Product Master records saved. Format detected: ${parsed.formatSheet}.`,
        );
        await loadProducts();
        setSelected(parsed.products[0]);
        setMarketplaceFilter(parsed.marketplace as "Alpha" | "FBF");
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
        setTab("packaging");
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Upload failed");
    }
  }
  function printPackaging(scope: "current" | "all") {
    setActionMenu(null);
    setPrintScope(scope);
    setTimeout(() => {
      window.print();
      setPrintScope(null);
    }, 150);
  }
  function printProducts(scope: "current" | "all") {
    setActionMenu(null);
    setProductPrintScope(scope);
    setTimeout(() => {
      window.print();
      setProductPrintScope(null);
    }, 150);
  }
  async function downloadProducts(
    scope: "current" | "all" | "selected",
    requestedIndexes: number[] = [],
  ) {
    if (!selected) return;
    setActionMenu(null);
    setDownloading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>("[data-product-pdf-label]"),
      );
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
            : nodes.map((_, i) => i);
      const base = (selected.sourceFile || "product-labels").replace(
        /\.[^.]+$/,
        "",
      );
      const fileName = `${base}-${scope === "current" ? `EAN-${selected.ean}` : scope === "selected" ? "selected-labels" : "whole-file"}.pdf`;
      await downloadNativePdf(nodes, indexes, labelSize, fileName);
      setNotice(
        scope === "current"
          ? "The visible product label was downloaded as a PDF."
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
  function toggleCheckedProduct(product: Product) {
    const key = productKey(product);
    setCheckedKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  }
  async function downloadPackaging(
    scope: "current" | "all" | "selected",
    requestedIndexes: number[] = [],
  ) {
    if (!selectedRun) return;
    setActionMenu(null);
    setDownloading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>("[data-pdf-label]"),
      );
      const indexes =
        scope === "current"
          ? [runLabelIndex]
          : scope === "selected"
            ? requestedIndexes
            : nodes.map((_, i) => i);
      const base = selectedRun.sourceFile.replace(/\.[^.]+$/, "");
      const fileName = `${base}-${scope === "current" ? `label-${runLabelIndex + 1}` : scope === "selected" ? "selected-labels" : "whole-file"}.pdf`;
      await downloadNativePdf(nodes, indexes, labelSize, fileName);
      setNotice(
        scope === "current"
          ? "The visible label was downloaded as a PDF."
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
  const matchingSourceProducts = selected
    ? allProducts.filter(
        (product) =>
          product.sourceFile === selected.sourceFile &&
          product.marketplace === selected.marketplace,
      )
    : [];
  const sourceProducts = matchingSourceProducts.length
    ? matchingSourceProducts
    : selected
      ? [selected]
      : [];
  const visibleProducts = products.filter(
    (product) => product.marketplace === marketplaceFilter,
  );
  const checkedProducts = allProducts.filter((product) =>
    checkedKeys.includes(productKey(product)),
  );
  const visibleCheckedCount = visibleProducts.filter((product) =>
    checkedKeys.includes(productKey(product)),
  ).length;
  const allVisibleChecked =
    visibleProducts.length > 0 &&
    visibleCheckedCount === visibleProducts.length;
  const visibleRuns = runs.filter(
    (run) => run.marketplace === marketplaceFilter,
  );
  function chooseMarketplace(marketplace: "Alpha" | "FBF") {
    setMarketplaceFilter(marketplace);
    setCheckedKeys([]);
    if (tab === "master") {
      setSelected(
        products.find((product) => product.marketplace === marketplace) ??
          allProducts.find((product) => product.marketplace === marketplace) ??
          null,
      );
    } else {
      setSelectedRun(
        runs.find((run) => run.marketplace === marketplace) ?? null,
      );
      setRunLabelIndex(0);
    }
  }
  async function downloadCheckedProducts() {
    if (!checkedProducts.length) {
      setNotice("Select one or more products from the list first.");
      return;
    }
    setActionMenu(null);
    setDownloading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-checked-product-pdf-label]",
        ),
      );
      const indexes = nodes.map((_, i) => i);
      const fileName = `selected-eans-${checkedProducts.length}-labels.pdf`;
      await downloadNativePdf(nodes, indexes, labelSize, fileName);
      setNotice(
        `${checkedProducts.length} selected product labels were downloaded.`,
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "PDF download failed.");
    } finally {
      setDownloading(false);
    }
  }
  function toggleAllVisibleProducts() {
    const visibleKeys = visibleProducts.map(productKey);
    setCheckedKeys((current) =>
      allVisibleChecked
        ? current.filter((key) => !visibleKeys.includes(key))
        : Array.from(new Set([...current, ...visibleKeys])),
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
      <style>{`@media print { @page { size: 3in ${labelSize === "3x5" ? "5in" : labelSize === "3x4" ? "4in" : "3in"}; margin: 0; } }`}</style>
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
            {tab === "master"
              ? allProducts.filter((product) => product.marketplace === "Alpha")
                  .length
              : runs.filter((run) => run.marketplace === "Alpha").length}
          </small>
        </button>
        <button
          className={marketplaceFilter === "FBF" ? "active fbf" : "fbf"}
          onClick={() => chooseMarketplace("FBF")}
        >
          <i /> FBF
          <small>
            {tab === "master"
              ? allProducts.filter((product) => product.marketplace === "FBF")
                  .length
              : runs.filter((run) => run.marketplace === "FBF").length}
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
                  const isActive =
                    selected?.ean === p.ean &&
                    selected.marketplace === p.marketplace;
                  const isChecked = checkedKeys.includes(key);
                  return (
                    <div
                      className={`resultRow${isActive ? " active" : ""}${isChecked ? " checked" : ""}`}
                      key={key}
                    >
                      <label
                        className="resultCheck"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleCheckedProduct(p)}
                          aria-label={`Select EAN ${p.ean}`}
                        />
                      </label>
                      <button type="button" onClick={() => setSelected(p)}>
                        <span className={`tag ${p.marketplace.toLowerCase()}`}>
                          {p.marketplace}
                        </span>
                        <strong>{p.title || p.fsn}</strong>
                        <small>EAN {p.ean}</small>
                        <small>FSN {p.fsn}</small>
                      </button>
                    </div>
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
                        Format: Product Label Format
                      </p>
                    </div>
                    <label className="detailSizeSelect">
                      <span>Label size</span>
                      <select
                        value={labelSize}
                        onChange={(event) =>
                          setLabelSize(
                            event.target.value as "3x5" | "3x4" | "3x3",
                          )
                        }
                        aria-label="Choose label size"
                      >
                        <option value="3x5">3 × 5 in</option>
                        <option value="3x4">3 × 4 in</option>
                        <option value="3x3">3 × 3 in</option>
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
                        <h3>Product Label Format</h3>
                        <span>
                          {selected.marketplace === "FBF"
                            ? "Barcode from FSN"
                            : "Barcode from EAN"}
                        </span>
                      </div>
                      <ProductLabel product={selected} />
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
                          <ProductLabel product={product} />
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="productPdfSource" aria-hidden="true">
                    {sourceProducts.map((product) => (
                      <div
                        className="productPdfPage"
                        data-product-pdf-label
                        key={`${product.marketplace}-${product.ean}`}
                      >
                        <ProductLabel product={product} />
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="empty">
                  {canUpload
                    ? "Upload or select a product."
                    : "Select a product to preview, download, or print."}
                </div>
              )}
              {checkedProducts.length > 0 && (
                <div className="productPdfSource" aria-hidden="true">
                  {checkedProducts.map((product) => (
                    <div
                      className="productPdfPage"
                      data-checked-product-pdf-label
                      key={`checked-${product.marketplace}-${product.ean}`}
                    >
                      <ProductLabel product={product} />
                    </div>
                  ))}
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
              <strong>{runs.length}</strong>
            </div>
            <div>
              <span>Alpha runs</span>
              <strong>
                {runs.filter((r) => r.marketplace === "Alpha").length}
              </strong>
            </div>
            <div>
              <span>FBF runs</span>
              <strong>
                {runs.filter((r) => r.marketplace === "FBF").length}
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
                <span>Packaging history</span>
                <small>{visibleRuns.length} uploads</small>
              </div>
              <div className="results">
                {visibleRuns.map((r) => (
                  <button
                    className={selectedRun?.id === r.id ? "active" : ""}
                    key={r.id}
                    onClick={() => {
                      setSelectedRun(r);
                      setRunLabelIndex(0);
                    }}
                  >
                    <span className={`tag ${r.marketplace.toLowerCase()}`}>
                      {r.marketplace}
                    </span>
                    <strong>{r.sourceFile}</strong>
                    <small>{r.labelCount} labels</small>
                    <small>{new Date(r.createdAt).toLocaleString()}</small>
                  </button>
                ))}
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
                          setLabelSize(
                            event.target.value as "3x5" | "3x4" | "3x3",
                          )
                        }
                        aria-label="Choose label size"
                      >
                        <option value="3x5">3 × 5 in</option>
                        <option value="3x4">3 × 4 in</option>
                        <option value="3x3">3 × 3 in</option>
                      </select>
                    </label>
                    <div className="actionMenus">
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
                      <RunLabel run={selectedRun} index={runLabelIndex} />
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
                  <div className="pdfSource" aria-hidden="true">
                    {selectedRun.payload.map((_, i) => (
                      <div className="pdfPage" data-pdf-label key={i}>
                        <RunLabel run={selectedRun} index={i} />
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="empty">
                  {canUpload
                    ? "Upload an Alpha or FBF Packaging List to create a run."
                    : "Select a packaging run to preview, download, or print."}
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
