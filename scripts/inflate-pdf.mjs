import fs from "fs";
import zlib from "zlib";
import { PDFDocument } from "pdf-lib";

const f = process.argv[2];
const bytes = fs.readFileSync(f);
const raw = Buffer.from(bytes);
console.log("file", f.replace(/^.*[\\/]/, ""), "len", raw.length);

// Find FlateDecode streams and inflate
let offset = 0;
let streamIdx = 0;
while (true) {
  const marker = raw.indexOf(Buffer.from("stream"), offset);
  if (marker < 0) break;
  let start = marker + 6;
  if (raw[start] === 0x0d) start++;
  if (raw[start] === 0x0a) start++;
  const endMarker = raw.indexOf(Buffer.from("endstream"), start);
  if (endMarker < 0) break;
  const compressed = raw.subarray(start, endMarker);
  // trim trailing newline before endstream
  let end = compressed.length;
  if (compressed[end - 1] === 0x0a) end--;
  if (compressed[end - 1] === 0x0d) end--;
  const payload = compressed.subarray(0, end);
  try {
    const inflated = zlib.inflateSync(payload);
    const text = inflated.toString("latin1");
    console.log("\n--- stream", streamIdx, "compressed", payload.length, "inflated", inflated.length);
    console.log(text.slice(0, 1500));
    const literals = [...text.matchAll(/\((?:\\.|[^\\)]){0,80}\)/g)].map((m) => m[0]);
    console.log("literals", literals.slice(0, 50));
  } catch (e) {
    console.log("\n--- stream", streamIdx, "not flate or failed", payload.length, e.message);
  }
  streamIdx++;
  offset = endMarker + 9;
}

const pdf = await PDFDocument.load(bytes);
console.log("\npages", pdf.getPageCount(), pdf.getPages()[0].getSize());
