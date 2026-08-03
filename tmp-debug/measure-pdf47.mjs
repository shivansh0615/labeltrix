import { readFileSync, mkdirSync } from "fs";
import { PDFDocument } from "pdf-lib";
import { chromium } from "playwright-core";

const file =
  "C:/Users/001ra/Downloads/Alpha Product label Details-EAN-8904297214510 (47).pdf";
const out =
  "C:/Users/001ra/OneDrive/Attachments/Desktop/FLIPKART APP/tmp-debug";
mkdirSync(out, { recursive: true });

const pdf = await PDFDocument.load(readFileSync(file));
const page0 = pdf.getPages()[0];
const size = page0.getSize();
console.log("size points", size.width, size.height);
console.log("size inches", size.width / 72, size.height / 72);
console.log("mediaBox", page0.getMediaBox());
console.log("cropBox", page0.getCropBox());

const edge =
  process.env["PROGRAMFILES(X86)"] +
  "\\Microsoft\\Edge\\Application\\msedge.exe";
const browser = await chromium.launch({ executablePath: edge, headless: true });
const p = await browser.newPage({ viewport: { width: 900, height: 1200 } });
const b64 = readFileSync(file).toString("base64");
await p.setContent(`<html><body style="margin:0;background:#ddd">
<canvas id="c" style="border:1px solid red"></canvas>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const data=Uint8Array.from(atob("${b64}"),c=>c.charCodeAt(0));
pdfjsLib.getDocument({data}).promise.then(async pdf=>{
  const page=await pdf.getPage(1);
  const vp=page.getViewport({scale:2});
  const c=document.getElementById('c');
  c.width=vp.width; c.height=vp.height;
  await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
  const ctx=c.getContext('2d');
  const img=ctx.getImageData(0,0,c.width,c.height).data;
  let maxX=0,minX=c.width,maxY=0,minY=c.height;
  for(let y=0;y<c.height;y++){
    for(let x=0;x<c.width;x++){
      const i=(y*c.width+x)*4;
      if(img[i]<40&&img[i+1]<40&&img[i+2]<40){
        if(x>maxX)maxX=x; if(x<minX)minX=x; if(y>maxY)maxY=y; if(y<minY)minY=y;
      }
    }
  }
  document.title=JSON.stringify({
    minX,maxX,minY,maxY,
    canvasW:c.width,canvasH:c.height,
    contentWidthPct:+(100*(maxX-minX+1)/c.width).toFixed(1),
    rightEmptyPct:+(100*(c.width-1-maxX)/c.width).toFixed(1),
    aspect:+(c.width/c.height).toFixed(3)
  });
});
</script></body></html>`);
await p.waitForFunction(() => document.title.startsWith("{"), null, {
  timeout: 60000,
});
console.log("bounds", await p.title());
await p.locator("#c").screenshot({ path: `${out}/pdf47-raster.png` });
await browser.close();
