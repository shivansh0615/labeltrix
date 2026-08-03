import { existsSync } from "node:fs";
import { createServer } from "node:http";
import process from "node:process";
import { PDFDocument } from "pdf-lib";
import { chromium } from "playwright-core";

const host = "127.0.0.1";
const port = Number(process.env.NATIVE_PDF_PORT || 3100);
const maxRequestBytes = 512 * 1024 * 1024;
const scaleFactor = Number(process.env.NATIVE_PDF_SCALE || 3);
const engineName = "chromium-screenshot";

const sizes = {
  "3x5": {
    width: "3in",
    height: "5in",
    widthPixels: 288,
    heightPixels: 480,
    widthPoints: 216,
    heightPoints: 360,
  },
  "3x4": {
    width: "3in",
    height: "4in",
    widthPixels: 288,
    heightPixels: 384,
    widthPoints: 216,
    heightPoints: 288,
  },
  "3x3": {
    width: "3in",
    height: "3in",
    widthPixels: 288,
    heightPixels: 288,
    widthPoints: 216,
    heightPoints: 216,
  },
};

let browserPromise;

function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PROGRAMFILES &&
      `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    process.env["PROGRAMFILES(X86)"] &&
      `${process.env["PROGRAMFILES(X86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
    process.env.PROGRAMFILES &&
      `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
    process.env.LOCALAPPDATA &&
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/microsoft-edge",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate));
}

async function getBrowser() {
  if (!browserPromise) {
    const executablePath = findChromeExecutable();
    if (!executablePath) {
      throw new Error(
        "Chrome or Microsoft Edge is required for native PDF export.",
      );
    }
    browserPromise = chromium.launch({
      executablePath,
      headless: true,
      args: ["--disable-dev-shm-usage", "--no-sandbox"],
    });
  }
  return browserPromise;
}

function allowedOrigin(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return (
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      (url.protocol === "http:" || url.protocol === "https:")
    );
  } catch {
    return false;
  }
}

function applyCors(request, response) {
  const origin = request.headers.origin;
  if (allowedOrigin(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(request, response, status, payload) {
  applyCors(request, response);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > maxRequestBytes) {
      throw new Error(
        "The selected label batch is too large for one PDF request.",
      );
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function safeFileName(fileName) {
  const cleaned = String(fileName || "labels.pdf")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "labels.pdf").endsWith(".pdf")
    ? cleaned || "labels.pdf"
    : `${cleaned}.pdf`;
}

async function waitForLabelAssets(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images).map((image) =>
        image.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
              image.addEventListener("load", resolve, { once: true });
              image.addEventListener("error", resolve, { once: true });
            }),
      ),
    );
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
}

async function embedPngPage(pdf, png, size) {
  const image = await pdf.embedPng(png);
  const pdfPage = pdf.addPage([size.widthPoints, size.heightPoints]);
  pdfPage.drawImage(image, {
    x: 0,
    y: 0,
    width: size.widthPoints,
    height: size.heightPoints,
  });
}

/** Flatten antialiased gray into pure black/white for thermal printers.
 *  No morphological erosion — that chewed text sitting against table borders.
 */
async function toThermalPng(page, pngBuffer) {
  const b64 = Buffer.from(pngBuffer).toString("base64");
  const cleaned = await page.evaluate(async (payload) => {
    const img = new Image();
    img.src = `data:image/png;base64,${payload}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const luma =
        0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      // Higher threshold => more gray edge pixels become white => less bleed.
      const value = luma < 200 ? 0 : 255;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png").split(",")[1];
  }, b64);
  return Buffer.from(cleaned, "base64");
}

async function renderPdf({ html, labelSize }) {
  const size = sizes[labelSize];
  if (!size) throw new Error("Unsupported label size.");
  if (typeof html !== "string" || !html.includes("nativePdfPage")) {
    throw new Error("No printable labels were supplied.");
  }

  // Chromium's built-in PDF printer shrinks custom-size pages ~10%.
  // Full-bleed screenshots embedded with pdf-lib stay edge-to-edge.
  // All labels are captured from ONE browser page (no per-label contexts).
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: size.widthPixels, height: size.heightPixels },
    deviceScaleFactor: scaleFactor,
  });
  const page = await context.newPage();

  try {
    await page.emulateMedia({ media: "screen" });
    await page.setContent(html, { waitUntil: "networkidle", timeout: 120_000 });
    await waitForLabelAssets(page);

    const locators = page.locator(".nativePdfPage");
    const pageCount = await locators.count();
    if (!pageCount) throw new Error("No printable labels were found.");

    const pdf = await PDFDocument.create();

    for (let index = 0; index < pageCount; index += 1) {
      const label = locators.nth(index);
      await label.scrollIntoViewIfNeeded();
      const box = await label.boundingBox();
      if (
        !box ||
        Math.abs(box.width - size.widthPixels) > 0.5 ||
        Math.abs(box.height - size.heightPixels) > 0.5
      ) {
        throw new Error(
          `Native PDF page size mismatch: expected ${size.widthPixels}x${size.heightPixels}px.`,
        );
      }
      const png = await toThermalPng(
        page,
        await label.screenshot({
          type: "png",
          animations: "disabled",
          omitBackground: false,
        }),
      );
      await embedPngPage(pdf, png, size);
    }

    return Buffer.from(await pdf.save());
  } finally {
    await context.close();
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${host}:${port}`);

  if (request.method === "OPTIONS") {
    applyCors(request, response);
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(request, response, 200, {
      ready: true,
      engine: engineName,
      note: "For 1,000+ labels use chunked downloads. Next step: pdf-lib + bwip-js (no browser).",
    });
    return;
  }

  if (request.method !== "POST" || url.pathname !== "/pdf") {
    sendJson(request, response, 404, { error: "Not found" });
    return;
  }

  try {
    const payload = await readJson(request);
    const pdf = await renderPdf(payload);
    const fileName = safeFileName(payload.fileName);
    applyCors(request, response);
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "no-store",
      "X-PDF-Engine": engineName,
    });
    response.end(pdf);
  } catch (error) {
    sendJson(request, response, 500, {
      error:
        error instanceof Error ? error.message : "Native PDF export failed.",
    });
  }
});

server.listen(port, host, () => {
  console.log(`Native PDF service ready at http://${host}:${port}`);
  console.log(`Engine: ${engineName} (scale=${scaleFactor}x)`);
});

async function close() {
  server.close();
  if (browserPromise) {
    const browser = await browserPromise.catch(() => null);
    await browser?.close();
  }
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
