import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cssUrl = new URL("../app/globals.css", import.meta.url);
const pageUrl = new URL("../app/page.tsx", import.meta.url);
const serverUrl = new URL("../scripts/pdf-server.mjs", import.meta.url);
const packageUrl = new URL("../package.json", import.meta.url);

test("3x5 text cells use one shared, descender-safe layout", async () => {
  const css = await readFile(cssUrl, "utf8");

  assert.match(
    css,
    /\.size-3x5 \.labelRow \{[^}]*height:\s*auto;[^}]*min-height:\s*15px;[^}]*overflow:\s*visible;[^}]*line-height:\s*10px;/s,
  );
  assert.match(
    css,
    /\.size-3x4 \.labelRow > strong,[\s\S]*?\.size-3x5 \.labelRow > span \{[^}]*overflow:\s*visible;/s,
  );
  assert.match(
    css,
    /\.size-3x5 \.labelRow > strong,\s*\.size-3x5 \.labelRow > span \{[^}]*line-height:\s*inherit;/s,
  );
});

test("product label cells stay left-aligned while centering text vertically", async () => {
  const css = await readFile(cssUrl, "utf8");

  assert.match(
    css,
    /\.size-3x4 \.labelRow > strong,[\s\S]*?\.size-3x5 \.labelRow > span \{[\s\S]*?flex-direction:\s*row;[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*flex-start;[\s\S]*?overflow:\s*visible;[\s\S]*?text-align:\s*left;/,
  );
  assert.match(css, /\.fbfLabel \.labelRow \{[^}]*text-align:\s*left;/s);
  assert.doesNotMatch(
    css,
    /\.fbfLabel \.labelRow \{[^}]*text-align:\s*center;/s,
  );
});

test("PDF export prefers local Chromium and falls back in the browser", async () => {
  const page = await readFile(pageUrl, "utf8");
  const server = await readFile(serverUrl, "utf8");
  const packageJson = JSON.parse(await readFile(packageUrl, "utf8"));

  assert.doesNotMatch(page, /html2canvas|jsPDF|captureLabelCanvas/);
  assert.equal(packageJson.dependencies?.html2canvas, undefined);
  assert.equal(packageJson.dependencies?.jspdf, undefined);
  assert.match(packageJson.dependencies?.["pdf-lib"] || "", /^[\^~]?1\.17\.1$/);
  assert.match(packageJson.dependencies?.jsbarcode || "", /./);
  assert.equal(packageJson.devDependencies?.["playwright-core"], "1.62.0");
  assert.match(page, /buildProductsPdf/);
  assert.match(page, /buildPackagingPdf/);
  assert.match(page, /vector-label-pdf/);
  assert.match(page, /downloadPdfBytes/);
  assert.match(server, /await page\.emulateMedia\(\{ media: "screen" \}\)/);
  assert.match(server, /embedPngPage/);
  assert.doesNotMatch(server, /page\.pdf\(/);
});

test("native PDF pages use exact supported physical dimensions", async () => {
  const page = await readFile(pageUrl, "utf8");
  const server = await readFile(serverUrl, "utf8");

  assert.match(page, /@page \{ size: 3in \$\{pageHeight\}in; margin: 0; \}/);
  assert.match(server, /"3x5": \{\s*width: "3in",\s*height: "5in"/s);
  assert.match(server, /"3x4": \{\s*width: "3in",\s*height: "4in"/s);
  assert.match(server, /"3x3": \{\s*width: "3in",\s*height: "3in"/s);
  assert.match(server, /widthPoints:\s*216/);
});
