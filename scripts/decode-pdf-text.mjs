import fs from "fs";
import zlib from "zlib";

const f = process.argv[2];
const raw = fs.readFileSync(f);
const marker = raw.indexOf(Buffer.from("stream"));
let start = marker + 6;
if (raw[start] === 0x0d) start++;
if (raw[start] === 0x0a) start++;
const endMarker = raw.indexOf(Buffer.from("endstream"), start);
let end = endMarker;
const payload = raw.subarray(start, end);
let slice = payload;
if (slice[slice.length - 1] === 0x0a) slice = slice.subarray(0, slice.length - 1);
if (slice[slice.length - 1] === 0x0d) slice = slice.subarray(0, slice.length - 1);
const text = zlib.inflateSync(slice).toString("latin1");

function decodeHexStrings(s) {
  return [...s.matchAll(/<([0-9A-Fa-f]+)>/g)].map((m) => {
    const hex = m[1];
    let out = "";
    for (let i = 0; i < hex.length; i += 2) {
      out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    return out;
  });
}

const strings = decodeHexStrings(text);
console.log("decoded text strings (" + strings.length + "):");
for (const s of strings) console.log(JSON.stringify(s));
console.log("\nhas Do (draw image):", /\/Image-\d+ Do/.test(text));
console.log("image draws:", (text.match(/Do/g) || []).length);
console.log("text ops Tj:", (text.match(/Tj/g) || []).length);
