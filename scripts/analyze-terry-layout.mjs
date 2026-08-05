import fs from "fs";
import zlib from "zlib";

const raw = fs.readFileSync(process.argv[2]);
const streams = [];
let offset = 0;
while (true) {
  const marker = raw.indexOf(Buffer.from("stream"), offset);
  if (marker < 0) break;
  let start = marker + 6;
  if (raw[start] === 0x0d) start++;
  if (raw[start] === 0x0a) start++;
  const endMarker = raw.indexOf(Buffer.from("endstream"), start);
  if (endMarker < 0) break;
  let end = endMarker;
  let payload = raw.subarray(start, end);
  if (payload.at(-1) === 0x0a) payload = payload.subarray(0, -1);
  if (payload.at(-1) === 0x0d) payload = payload.subarray(0, -1);
  try {
    const inflated = zlib.inflateSync(payload);
    streams.push(inflated.toString("latin1"));
  } catch {
    // ignore
  }
  offset = endMarker + 9;
}

const text = streams.join("\n");
// Extract line coordinates from path drawing: x y m / x y l
const moves = [...text.matchAll(/([\d.]+)\s+([\d.]+)\s+m\r?\n([\d.]+)\s+([\d.]+)\s+l/g)].map(
  (m) => ({
    x1: +m[1],
    y1: +m[2],
    x2: +m[3],
    y2: +m[4],
  }),
);

const horiz = moves
  .filter((l) => Math.abs(l.y1 - l.y2) < 0.5)
  .map((l) => ({
    y: +((l.y1 + l.y2) / 2).toFixed(2),
    x1: +Math.min(l.x1, l.x2).toFixed(2),
    x2: +Math.max(l.x1, l.x2).toFixed(2),
    len: +Math.abs(l.x2 - l.x1).toFixed(2),
  }))
  .filter((l) => l.len > 20)
  .sort((a, b) => b.y - a.y);

const vert = moves
  .filter((l) => Math.abs(l.x1 - l.x2) < 0.5)
  .map((l) => ({
    x: +((l.x1 + l.x2) / 2).toFixed(2),
    y1: +Math.min(l.y1, l.y2).toFixed(2),
    y2: +Math.max(l.y1, l.y2).toFixed(2),
    len: +Math.abs(l.y2 - l.y1).toFixed(2),
  }))
  .filter((l) => l.len > 20)
  .sort((a, b) => a.x - b.x);

console.log("page lines horiz unique Y:", [...new Set(horiz.map((h) => h.y))]);
console.log("horiz detail:", JSON.stringify(horiz, null, 2));
console.log("vert unique X:", [...new Set(vert.map((v) => v.x))]);
console.log("vert detail:", JSON.stringify(vert, null, 2));

// Font sizes
const fonts = [...text.matchAll(/\/F\d+\s+([\d.]+)\s+Tf/g)].map((m) => +m[1]);
console.log("font sizes:", [...new Set(fonts)].sort((a, b) => b - a));

// Td positions with nearby font
const tds = [...text.matchAll(/([\d.-]+)\s+([\d.-]+)\s+Td/g)].map((m) => ({
  x: +m[1],
  y: +(+m[2]).toFixed(2),
}));
console.log("Td count", tds.length, "sample", tds.slice(0, 40));
