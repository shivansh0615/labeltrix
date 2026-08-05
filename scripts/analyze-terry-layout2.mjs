import fs from "fs";
import zlib from "zlib";

const raw = fs.readFileSync(process.argv[2]);
let offset = 0;
const parts = [];
while (true) {
  const marker = raw.indexOf(Buffer.from("stream"), offset);
  if (marker < 0) break;
  let start = marker + 6;
  if (raw[start] === 0x0d) start++;
  if (raw[start] === 0x0a) start++;
  const endMarker = raw.indexOf(Buffer.from("endstream"), start);
  if (endMarker < 0) break;
  let payload = raw.subarray(start, endMarker);
  if (payload.at(-1) === 0x0a) payload = payload.subarray(0, -1);
  if (payload.at(-1) === 0x0d) payload = payload.subarray(0, -1);
  try {
    parts.push(zlib.inflateSync(payload).toString("latin1"));
  } catch {}
  offset = endMarker + 9;
}
const text = parts.join("\n");

// All path segments
const segs = [...text.matchAll(/([\d.]+)\s+([\d.]+)\s+m\r?\n([\d.]+)\s+([\d.]+)\s+l/g)].map(
  (m) => ({ x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] }),
);

const verts = segs
  .filter((l) => Math.abs(l.x1 - l.x2) < 0.8)
  .map((l) => ({
    x: +((l.x1 + l.x2) / 2).toFixed(2),
    y1: +Math.min(l.y1, l.y2).toFixed(2),
    y2: +Math.max(l.y1, l.y2).toFixed(2),
    len: +Math.abs(l.y2 - l.y1).toFixed(2),
  }))
  .sort((a, b) => a.x - b.x || b.y2 - a.y2);

console.log("all vertical segments:", JSON.stringify(verts, null, 2));

// Row heights from horiz Y
const ys = [
  ...new Set(
    segs
      .filter((l) => Math.abs(l.y1 - l.y2) < 0.5 && Math.abs(l.x2 - l.x1) > 20)
      .map((l) => +((l.y1 + l.y2) / 2).toFixed(2)),
  ),
].sort((a, b) => b - a);

console.log("\nrow boundaries top->bottom:");
for (let i = 0; i < ys.length - 1; i++) {
  console.log(
    `${ys[i]} -> ${ys[i + 1]}  height=${(ys[i] - ys[i + 1]).toFixed(2)}`,
  );
}

// stroke widths
const widths = [...text.matchAll(/([\d.]+)\s+w\r?\n/g)].map((m) => +m[1]);
console.log("\nstroke widths", [...new Set(widths)]);

// Try extract text via ToUnicode / actual visible - look for TJ arrays with escaped
const hexRuns = [...text.matchAll(/<([0-9A-Fa-f]{4,})>/g)].map((m) => m[1]);
console.log("hex runs", hexRuns.length);
// Corel uses CID fonts - decode as UTF-16BE pairs maybe
function utf16be(hex) {
  let s = "";
  for (let i = 0; i + 3 < hex.length; i += 4) {
    const code = parseInt(hex.slice(i, i + 4), 16);
    if (code) s += String.fromCharCode(code);
  }
  return s;
}
const decoded = hexRuns.map(utf16be).filter((s) => s.trim().length);
console.log("decoded CID text:");
for (const s of decoded) console.log(JSON.stringify(s));
