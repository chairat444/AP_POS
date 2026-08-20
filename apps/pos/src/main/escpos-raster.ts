/**
 * ESC/POS raster — ภาพสลิปเต็มความกว้างเครื่อง · ตัดขอบขาว · แถบสั้นๆ
 * 58mm → 384 dots · 80mm → 576 dots
 */

export type RgbaBitmap = {
  width: number;
  height: number;
  data: Buffer;
  format?: "bgra" | "rgba";
};

export function targetRasterWidth(paperWidth: "58mm" | "80mm") {
  return paperWidth === "58mm" ? 384 : 576;
}

function luminance(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function isDark(
  img: RgbaBitmap,
  x: number,
  y: number,
  threshold: number,
): boolean {
  const i = (y * img.width + x) * 4;
  const format = img.format ?? "bgra";
  const r = format === "bgra" ? img.data[i + 2]! : img.data[i]!;
  const g = img.data[i + 1]!;
  const b = format === "bgra" ? img.data[i]! : img.data[i + 2]!;
  const a = img.data[i + 3] ?? 255;
  return a >= 20 && luminance(r, g, b) < threshold;
}

/** ตัดขอบขาวรอบเนื้อหา แล้วเหลือขอบนิดเดียว */
export function cropWhitespace(
  img: RgbaBitmap,
  threshold = 160,
  pad = 2,
): RgbaBitmap {
  const { width: w, height: h } = img;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isDark(img, x, y, threshold)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return img;

  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const nw = maxX - minX + 1;
  const nh = maxY - minY + 1;
  const out = Buffer.alloc(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const si = ((minY + y) * w + (minX + x)) * 4;
      const di = (y * nw + x) * 4;
      out[di] = img.data[si]!;
      out[di + 1] = img.data[si + 1]!;
      out[di + 2] = img.data[si + 2]!;
      out[di + 3] = img.data[si + 3]!;
    }
  }
  return { width: nw, height: nh, data: out, format: img.format };
}

/** ขยายเต็มความกว้างเครื่อง (ยืดด้านข้างให้เต็มกระดาษ) */
export function scaleBitmapToWidth(
  img: RgbaBitmap,
  targetW: number,
): RgbaBitmap {
  const srcW = Math.max(1, img.width | 0);
  const srcH = Math.max(1, img.height | 0);
  const tw = Math.max(8, Math.ceil(targetW / 8) * 8);
  const th = Math.max(1, Math.round((srcH * tw) / srcW));
  if (srcW === tw && srcH === th) return { ...img, width: tw };

  const out = Buffer.alloc(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / th));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / tw));
      const si = (sy * srcW + sx) * 4;
      const di = (y * tw + x) * 4;
      out[di] = img.data[si]!;
      out[di + 1] = img.data[si + 1]!;
      out[di + 2] = img.data[si + 2]!;
      out[di + 3] = img.data[si + 3]!;
    }
  }
  return { width: tw, height: th, data: out, format: img.format };
}

export function toMonoRaster(
  img: RgbaBitmap,
  threshold = 160,
): { width: number; height: number; bytes: Buffer } {
  const srcW = Math.max(1, img.width | 0);
  const srcH = Math.max(1, img.height | 0);
  const format = img.format ?? "bgra";
  const width = Math.ceil(srcW / 8) * 8;
  const height = srcH;
  const rowBytes = width / 8;
  const out = Buffer.alloc(rowBytes * height, 0);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= srcW) continue;
      const i = (y * srcW + x) * 4;
      const r = format === "bgra" ? img.data[i + 2]! : img.data[i]!;
      const g = img.data[i + 1]!;
      const b = format === "bgra" ? img.data[i]! : img.data[i + 2]!;
      const a = img.data[i + 3] ?? 255;
      const dark = a >= 20 && luminance(r, g, b) < threshold;
      if (!dark) continue;
      out[y * rowBytes + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return { width, height, bytes: out };
}

export type BuildRasterJobOpts = {
  threshold?: number;
  cut?: boolean;
  openDrawer?: boolean;
  paperWidth?: "58mm" | "80mm";
};

export function buildEscPosRasterJob(
  img: RgbaBitmap,
  opts: BuildRasterJobOpts = {},
): Buffer {
  const targetW = targetRasterWidth(opts.paperWidth ?? "58mm");
  const threshold = opts.threshold ?? 160;
  // ตัดขอบขาว → ยืดเต็มความกว้างกระดาษ
  const cropped = cropWhitespace(img, threshold, 1);
  const scaled = scaleBitmapToWidth(cropped, targetW);
  const mono = toMonoRaster(scaled, threshold);
  const widthBytes = mono.width / 8;
  const chunks: Buffer[] = [];

  chunks.push(Buffer.from([0x1b, 0x40]));
  if (opts.openDrawer !== false) {
    chunks.push(Buffer.from([0x1b, 0x70, 0x00, 0x3c, 0x78]));
  }
  chunks.push(Buffer.from([0x1b, 0x61, 0x00]));

  const maxBand = 900;
  let y0 = 0;
  while (y0 < mono.height) {
    const bandH = Math.min(maxBand, mono.height - y0);
    const bandBytes = mono.bytes.subarray(
      y0 * widthBytes,
      (y0 + bandH) * widthBytes,
    );
    chunks.push(
      Buffer.from([
        0x1d,
        0x76,
        0x30,
        0x00,
        widthBytes & 0xff,
        (widthBytes >> 8) & 0xff,
        bandH & 0xff,
        (bandH >> 8) & 0xff,
      ]),
    );
    chunks.push(bandBytes);
    y0 += bandH;
  }

  // feed น้อย + partial cut (กินกระดาษน้อยกว่า full cut บนหลายรุ่น)
  chunks.push(Buffer.from([0x1b, 0x64, 0x01]));
  if (opts.cut !== false) {
    chunks.push(Buffer.from([0x1d, 0x56, 0x41, 0x00])); // GS V 65 0 partial
  }
  return Buffer.concat(chunks);
}

/** HTML แน่น ไม่มีขอบ — เรนเดอร์เร็ว */
export function buildRasterPreviewHtml(
  text: string,
  paperWidth: "58mm" | "80mm",
): string {
  const w = targetRasterWidth(paperWidth);
  const fontSize = paperWidth === "58mm" ? 18 : 20;
  const lineH = fontSize + 2;
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;background:#fff;color:#000;}
  pre{
    box-sizing:border-box;
    width:${w}px;
    margin:0;
    padding:0;
    font:${fontSize}px/${lineH}px Tahoma,"Segoe UI",sans-serif;
    white-space:pre-wrap;
    word-break:break-word;
  }
</style></head><body><pre id="s">${esc}</pre></body></html>`;
}
