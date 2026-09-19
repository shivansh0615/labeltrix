import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const outDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "samples",
);
mkdirSync(outDir, { recursive: true });

function writeWorkbook(fileName, sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  const bytes = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const path = join(outDir, fileName);
  writeFileSync(path, bytes);
  console.log(`wrote ${path}`);
}

writeWorkbook("alpha-packaging-demo.xlsx", [
  [
    "Packaging List",
    [
      ["PO", "Invoice No", "FSN", "Qty", "Box No"],
      ["PO-ALPHA-1001", "INV-24091", "MTPFVADR4HKQUFH3", "12", "1"],
      ["PO-ALPHA-1001", "INV-24092", "MTPG4XTRFZREQRAG", "8", "2"],
      ["PO-ALPHA-1002", "INV-24093", "MTPG7QXZUHUZM8ZY", "16", "3"],
      ["PO-ALPHA-1002", "INV-24094", "MTPGYCADGRGWNK3T", "4", "4"],
    ],
  ],
  [
    "Label Format",
    [
      ["Invoice No.", "INV-24091"],
      ["FSN", "MTPFVADR4HKQUFH3"],
      ["Qty", "12"],
      ["PO No.", "PO-ALPHA-1001"],
      ["Box No.", "1"],
      [],
      ["Reference layout only. LabelTrix reads the Packaging List sheet."],
    ],
  ],
]);

writeWorkbook("fbf-packaging-demo.xlsx", [
  [
    "FBF Packaging List",
    [
      ["BOX", "Consignment No", "SKU Id", "FSN", "Quantity Sent"],
      ["BOX-01", "CN-FBF-88921", "SKU-MP-4121", "MTPFVADR4HKQUFH3", "6"],
      ["", "", "SKU-MP-4122", "MTPG4XTRFZREQRAG", "4"],
      ["BOX-02", "CN-FBF-88921", "SKU-MP-5001", "MTPG7QXZUHUZM8ZY", "10"],
      ["", "", "SKU-MP-5002", "MTPGYCADGRGWNK3T", "3"],
      ["", "", "SKU-MP-5003", "MTPG4XV3PYFJNH8R", "2"],
    ],
  ],
  [
    "Box Label Format",
    [
      ["CN-FBF-88921"],
      ["PACKAGING SLIP"],
      ["Box No.", "SKU", "FSN", "QTY."],
      ["BOX-01", "SKU-MP-4121", "MTPFVADR4HKQUFH3", "6"],
      ["", "SKU-MP-4122", "MTPG4XTRFZREQRAG", "4"],
      [],
      ["Reference layout only. LabelTrix reads the FBF Packaging List sheet."],
    ],
  ],
]);
