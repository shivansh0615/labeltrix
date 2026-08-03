import { readFileSync, mkdirSync } from "fs";
import { chromium } from "playwright-core";

const file =
  "C:/Users/001ra/Downloads/Alpha Product label Details-EAN-8904297214510 (47).pdf";
const out =
  "C:/Users/001ra/OneDrive/Attachments/Desktop/FLIPKART APP/tmp-debug";
mkdirSync(out, { recursive: true });
const edge =
  process.env["PROGRAMFILES(X86)"] +
  "\\Microsoft\\Edge\\Application\\msedge.exe";
const browser = await chromium.launch({ executablePath: edge, headless: true });
const p = await browser.newPage({ viewport: { width: 900, height: 1200 } });
const b64 = readFileSync(file).toString("base64");
await p.setContent(`<html><body style="margin:0;background:#ccc">
<canvas id="c"></canvas>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const data=Uint8Array.from(atob("${b64}"),c=>c.charCodeAt(0));
pdfjsLib.getDocument({data}).promise.then(async pdf=>{
  const page=await pdf.getPage(1);
  const vp=page.getViewport({scale:3});
  const c=document.getElementById('c');
  c.width=vp.width; c.height=vp.height;
  await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
  const ctx=c.getContext('2d');
  const {data:img,width:w,height:h}=ctx.getImageData(0,0,c.width,c.height);
  function ink(i, thr){return img[i]<thr || img[i+1]<thr || img[i+2]<thr;}
  function bounds(thr){
    let maxX=0,minX=w,maxY=0,minY=h,count=0;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const i=(y*w+x)*4;
      if(ink(i,thr)){count++; if(x>maxX)maxX=x; if(x<minX)minX=x; if(y>maxY)maxY=y; if(y<minY)minY=y;}
    }
    return {thr,minX,maxX,minY,maxY,count,
      rightEmptyPx:w-1-maxX, bottomEmptyPx:h-1-maxY,
      rightEmptyPct:+(100*(w-1-maxX)/w).toFixed(2),
      widthPct:+(100*(maxX-minX+1)/w).toFixed(2)};
  }
  // sample right edge column average
  let rightCol=0, leftCol=0, midCol=0;
  for(let y=0;y<h;y++){
    rightCol += img[((y*w)+(w-2))*4];
    leftCol += img[((y*w)+2)*4];
    midCol += img[((y*w)+Math.floor(w/2))*4];
  }
  document.title=JSON.stringify({
    w,h,
    b40:bounds(40),
    b120:bounds(120),
    b200:bounds(200),
    avgLeft:+(leftCol/h).toFixed(1),
    avgMid:+(midCol/h).toFixed(1),
    avgRightEdge:+(rightCol/h).toFixed(1)
  });
});
</script></body></html>`);
await p.waitForFunction(() => document.title.startsWith("{"), null, {
  timeout: 60000,
});
console.log(await p.title());
await p.locator("#c").screenshot({ path: `${out}/pdf47-detail.png` });
await browser.close();
