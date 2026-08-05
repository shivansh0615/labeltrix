import fs from "fs";
import { PDFDocument } from "pdf-lib";

const files = process.argv.slice(2);
for (const f of files) {
  const bytes = fs.readFileSync(f);
  const pdf = await PDFDocument.load(bytes);
  const page = pdf.getPages()[0];
  const raw = Buffer.from(bytes).toString("latin1");
  const imgs = (raw.match(/\/Subtype\s*\/Image/g) || []).length;
  const fonts = (raw.match(/\/BaseFont/g) || []).length;
  const strings = [...raw.matchAll(/\(([^)\\]{2,80})\)/g)].map((m) => m[1]);
  console.log(
    JSON.stringify(
      {
        name: f.replace(/^.*[\\/]/, ""),
        bytes: bytes.length,
        size: page.getSize(),
        images: imgs,
        fonts,
        hasPngIdat: raw.includes("IDAT"),
        strings: strings.slice(0, 40),
      },
      null,
      2,
    ),
  );
}
