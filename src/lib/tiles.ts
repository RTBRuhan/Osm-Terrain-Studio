/**
 * Web-Mercator raster tile sampling.
 *
 * Used to render an orthorectified image of the (rotated) box and to build
 * heightmaps from Terrarium elevation tiles. For every output pixel we know its
 * lat/lon (via the box frame), convert that to a global Mercator pixel, and
 * bilinearly sample the appropriate tile. This keeps the box's rotation and
 * exact extent intact regardless of the on-screen map orientation.
 */
import { BoxFrame, pointInRing, type Box, type LatLon } from "./geo";

const TILE_SIZE = 256;

export function lonToMercX(lon: number, z: number): number {
  return ((lon + 180) / 360) * TILE_SIZE * Math.pow(2, z);
}

export function latToMercY(lat: number, z: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  return y * TILE_SIZE * Math.pow(2, z);
}

/** Ground resolution (metres/pixel) of a Mercator tile pixel at a latitude. */
export function mercResolution(lat: number, z: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z);
}

/** Pick the zoom whose pixels are at least as fine as `targetMetersPerPx`. */
export function chooseZoom(
  lat: number,
  targetMetersPerPx: number,
  maxZoom: number,
): number {
  let z = Math.ceil(
    Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180)) / targetMetersPerPx),
  );
  if (!Number.isFinite(z)) z = maxZoom;
  return Math.max(0, Math.min(maxZoom, z));
}

const tileCache = new Map<string, Promise<ImageData>>();

function loadTileImageData(url: string): Promise<ImageData> {
  const cached = tileCache.get(url);
  if (cached) return cached;
  const p = new Promise<ImageData>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = TILE_SIZE;
      c.height = TILE_SIZE;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        reject(new Error("Canvas 2D context unavailable"));
        return;
      }
      ctx.drawImage(img, 0, 0, TILE_SIZE, TILE_SIZE);
      try {
        resolve(ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error(`Failed to load tile: ${url}`));
    img.src = url;
  });
  tileCache.set(url, p);
  return p;
}

function buildTileUrl(template: string, x: number, y: number, z: number): string {
  return template
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}

export interface SampleGrid {
  /** RGBA samples, length = width*height*4. */
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  zoom: number;
}

export interface SampleOptions {
  box: Box;
  /** Long edge of the output in pixels; the short edge keeps the box aspect. */
  maxSize: number;
  /** A tile URL template using {z}/{x}/{y}. May contain {a-c} via `subdomains`. */
  tileTemplate: string;
  subdomains?: string[];
  maxZoom: number;
  onProgress?: (done: number, total: number) => void;
}

function outputDims(box: Box, maxSize: number): { w: number; h: number } {
  const aspect = box.widthM / box.heightM;
  if (aspect >= 1) {
    return { w: maxSize, h: Math.max(1, Math.round(maxSize / aspect)) };
  }
  return { w: Math.max(1, Math.round(maxSize * aspect)), h: maxSize };
}

/**
 * Sample a tile source across the box grid. Output row 0 is the NORTH edge
 * (z = heightM) so the image reads top-down like a normal picture.
 */
export async function sampleBoxRGBA(opts: SampleOptions): Promise<SampleGrid> {
  const { box, maxSize, tileTemplate, subdomains, maxZoom } = opts;
  const frame = new BoxFrame(box);
  const { w, h } = outputDims(box, maxSize);

  const metersPerPx = box.widthM / w;
  const zoom = chooseZoom(box.centerLat, metersPerPx, maxZoom);
  const scale = TILE_SIZE * Math.pow(2, zoom);

  // First pass: figure out which tiles we need.
  const needed = new Map<string, { x: number; y: number }>();
  const px = new Float64Array(w * h);
  const py = new Float64Array(w * h);
  for (let j = 0; j < h; j++) {
    const zMeters = ((h - 1 - j) / (h - 1)) * box.heightM;
    for (let i = 0; i < w; i++) {
      const xMeters = (i / (w - 1)) * box.widthM;
      const ll = frame.toLatLonFromLocal(xMeters, zMeters);
      const gx = lonToMercX(ll.lon, zoom);
      const gy = latToMercY(ll.lat, zoom);
      const idx = j * w + i;
      px[idx] = gx;
      py[idx] = gy;
      const tx = Math.floor(gx / TILE_SIZE);
      const ty = Math.floor(gy / TILE_SIZE);
      needed.set(`${tx}/${ty}`, { x: tx, y: ty });
    }
  }

  // Load all needed tiles (bounded concurrency).
  const max = Math.pow(2, zoom);
  const entries = [...needed.entries()];
  const tiles = new Map<string, ImageData>();
  let done = 0;
  const total = entries.length;
  const concurrency = 6;
  let cursor = 0;
  async function worker() {
    for (;;) {
      const k = cursor++;
      if (k >= entries.length) break;
      const [key, { x, y }] = entries[k];
      const wrappedX = ((x % max) + max) % max;
      if (y < 0 || y >= max) {
        done++;
        opts.onProgress?.(done, total);
        continue;
      }
      const sub = subdomains && subdomains.length
        ? subdomains[(wrappedX + y) % subdomains.length]
        : undefined;
      const tmpl = sub ? tileTemplate.replace("{s}", sub) : tileTemplate;
      try {
        const data = await loadTileImageData(buildTileUrl(tmpl, wrappedX, y, zoom));
        tiles.set(key, data);
      } catch {
        // leave missing -> transparent/zero
      }
      done++;
      opts.onProgress?.(done, total);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  // Second pass: bilinear sample.
  const rgba = new Uint8ClampedArray(w * h * 4);
  const sampleAt = (gx: number, gy: number, out: number[]) => {
    const fx = gx - 0.5;
    const fy = gy - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const dx = fx - x0;
    const dy = fy - y0;
    for (let c = 0; c < 4; c++) out[c] = 0;
    let wsum = 0;
    for (let oy = 0; oy <= 1; oy++) {
      for (let ox = 0; ox <= 1; ox++) {
        const sx = x0 + ox;
        const sy = y0 + oy;
        if (sx < 0 || sy < 0 || sx >= scale || sy >= scale) continue;
        const tx = Math.floor(sx / TILE_SIZE);
        const ty = Math.floor(sy / TILE_SIZE);
        const tile = tiles.get(`${tx}/${ty}`);
        if (!tile) continue;
        const lx = sx - tx * TILE_SIZE;
        const ly = sy - ty * TILE_SIZE;
        const wgt = (ox ? dx : 1 - dx) * (oy ? dy : 1 - dy);
        const p = (ly * TILE_SIZE + lx) * 4;
        out[0] += tile.data[p] * wgt;
        out[1] += tile.data[p + 1] * wgt;
        out[2] += tile.data[p + 2] * wgt;
        out[3] += tile.data[p + 3] * wgt;
        wsum += wgt;
      }
    }
    if (wsum > 0 && wsum < 1) for (let c = 0; c < 4; c++) out[c] /= wsum;
  };

  const tmp = [0, 0, 0, 0];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const idx = j * w + i;
      sampleAt(px[idx], py[idx], tmp);
      const o = idx * 4;
      rgba[o] = tmp[0];
      rgba[o + 1] = tmp[1];
      rgba[o + 2] = tmp[2];
      rgba[o + 3] = tmp[3] || 255;
    }
  }

  return { rgba, width: w, height: h, zoom };
}

/** Make pixels outside a freehand ring transparent, preserving the box image grid. */
export function maskGridToRing(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  box: Box,
  ring: LatLon[],
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  const frame = new BoxFrame(box);
  for (let j = 0; j < height; j++) {
    const zMeters = ((height - 1 - j) / (height - 1)) * box.heightM;
    for (let i = 0; i < width; i++) {
      const xMeters = (i / (width - 1)) * box.widthM;
      const ll = frame.toLatLonFromLocal(xMeters, zMeters);
      if (!pointInRing(ll.lat, ll.lon, ring)) {
        out[(j * width + i) * 4 + 3] = 0;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Heightmap from Terrarium elevation tiles
// ---------------------------------------------------------------------------

const TERRARIUM_TEMPLATE =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const TERRARIUM_MAXZOOM = 15;

export interface HeightmapResult {
  /** Elevation in metres, row 0 = north edge, length = width*height. */
  elev: Float32Array;
  width: number;
  height: number;
  minElev: number;
  maxElev: number;
  zoom: number;
}

function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

export async function sampleHeightmap(
  box: Box,
  size: number,
  onProgress?: (done: number, total: number) => void,
  square = false,
): Promise<HeightmapResult> {
  // By default the grid matches the box aspect ratio (long edge = `size`) so the
  // heightmap lines up pixel-for-pixel with the satellite image and the box.
  // `square` forces a `size`×`size` grid (e.g. for Unity terrains, 2^n+1).
  const frame = new BoxFrame(box);
  const { w, h } = square ? { w: size, h: size } : outputDims(box, size);
  const metersPerPx = Math.max(box.widthM, box.heightM) / size;
  const zoom = chooseZoom(box.centerLat, metersPerPx, TERRARIUM_MAXZOOM);
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const max = Math.pow(2, zoom);

  const px = new Float64Array(w * h);
  const py = new Float64Array(w * h);
  const needed = new Map<string, { x: number; y: number }>();
  for (let j = 0; j < h; j++) {
    const zMeters = ((h - 1 - j) / (h - 1)) * box.heightM;
    for (let i = 0; i < w; i++) {
      const xMeters = (i / (w - 1)) * box.widthM;
      const ll = frame.toLatLonFromLocal(xMeters, zMeters);
      const gx = lonToMercX(ll.lon, zoom);
      const gy = latToMercY(ll.lat, zoom);
      px[j * w + i] = gx;
      py[j * w + i] = gy;
      needed.set(
        `${Math.floor(gx / TILE_SIZE)}/${Math.floor(gy / TILE_SIZE)}`,
        { x: Math.floor(gx / TILE_SIZE), y: Math.floor(gy / TILE_SIZE) },
      );
    }
  }

  const entries = [...needed.entries()];
  const tiles = new Map<string, ImageData>();
  let done = 0;
  const total = entries.length;
  let cursor = 0;
  async function worker() {
    for (;;) {
      const k = cursor++;
      if (k >= entries.length) break;
      const [key, { x, y }] = entries[k];
      const wrappedX = ((x % max) + max) % max;
      if (y >= 0 && y < max) {
        try {
          const data = await loadTileImageData(
            buildTileUrl(TERRARIUM_TEMPLATE, wrappedX, y, zoom),
          );
          tiles.set(key, data);
        } catch {
          /* missing -> treated as 0 */
        }
      }
      done++;
      onProgress?.(done, total);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));

  const elev = new Float32Array(w * h);
  let minElev = Infinity;
  let maxElev = -Infinity;
  const sampleElev = (gx: number, gy: number): number => {
    const fx = gx - 0.5;
    const fy = gy - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const dx = fx - x0;
    const dy = fy - y0;
    let val = 0;
    let wsum = 0;
    for (let oy = 0; oy <= 1; oy++) {
      for (let ox = 0; ox <= 1; ox++) {
        const sx = x0 + ox;
        const sy = y0 + oy;
        if (sx < 0 || sy < 0 || sx >= scale || sy >= scale) continue;
        const tx = Math.floor(sx / TILE_SIZE);
        const ty = Math.floor(sy / TILE_SIZE);
        const tile = tiles.get(`${tx}/${ty}`);
        if (!tile) continue;
        const lx = sx - tx * TILE_SIZE;
        const ly = sy - ty * TILE_SIZE;
        const p = (ly * TILE_SIZE + lx) * 4;
        const e = decodeTerrarium(tile.data[p], tile.data[p + 1], tile.data[p + 2]);
        const wgt = (ox ? dx : 1 - dx) * (oy ? dy : 1 - dy);
        val += e * wgt;
        wsum += wgt;
      }
    }
    return wsum > 0 ? val / wsum : 0;
  };

  for (let idx = 0; idx < w * h; idx++) {
    const e = sampleElev(px[idx], py[idx]);
    elev[idx] = e;
    if (e < minElev) minElev = e;
    if (e > maxElev) maxElev = e;
  }
  if (!Number.isFinite(minElev)) {
    minElev = 0;
    maxElev = 0;
  }
  return { elev, width: w, height: h, minElev, maxElev, zoom };
}

// ---------------------------------------------------------------------------
// Encoders
// ---------------------------------------------------------------------------

/** RGBA ImageData -> PNG Blob (8-bit) via canvas. */
export function rgbaToPngBlob(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(rgba);
  ctx.putImageData(imageData, 0, 0);
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/png",
    ),
  );
}

// --- minimal 16-bit grayscale PNG encoder (dependency-free) ----------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(buf: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** Wrap raw bytes in a zlib stream using only uncompressed (stored) blocks. */
function zlibStore(data: Uint8Array): Uint8Array {
  const blocks: number[] = [0x78, 0x01]; // zlib header (no compression)
  const MAX = 65535;
  let offset = 0;
  while (offset < data.length) {
    const len = Math.min(MAX, data.length - offset);
    const final = offset + len >= data.length ? 1 : 0;
    blocks.push(final);
    blocks.push(len & 0xff, (len >>> 8) & 0xff);
    const nlen = ~len & 0xffff;
    blocks.push(nlen & 0xff, (nlen >>> 8) & 0xff);
    for (let i = 0; i < len; i++) blocks.push(data[offset + i]);
    offset += len;
  }
  const out = new Uint8Array(blocks.length + 4);
  out.set(blocks, 0);
  const ad = adler32(data);
  out[blocks.length] = (ad >>> 24) & 0xff;
  out[blocks.length + 1] = (ad >>> 16) & 0xff;
  out[blocks.length + 2] = (ad >>> 8) & 0xff;
  out[blocks.length + 3] = ad & 0xff;
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcInput = out.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

/** Encode a 16-bit grayscale PNG from normalized big-endian samples (0..65535). */
export function gray16ToPng(
  values: Uint16Array,
  width: number,
  height: number,
): Blob {
  // Build raw image data: each row prefixed with filter byte 0.
  const raw = new Uint8Array(height * (1 + width * 2));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const v = values[y * width + x];
      raw[p++] = (v >>> 8) & 0xff; // PNG 16-bit is big-endian
      raw[p++] = v & 0xff;
    }
  }

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 16; // bit depth
  ihdr[9] = 0; // color type: grayscale
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const idat = zlibStore(raw);
  const parts = [
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ];
  return new Blob(parts as BlobPart[], { type: "image/png" });
}

/** Normalize elevation to 0..65535 over [min,max]. */
export function elevToGray16(
  elev: Float32Array,
  minElev: number,
  maxElev: number,
): Uint16Array {
  const out = new Uint16Array(elev.length);
  const range = maxElev - minElev || 1;
  for (let i = 0; i < elev.length; i++) {
    const t = (elev[i] - minElev) / range;
    out[i] = Math.max(0, Math.min(65535, Math.round(t * 65535)));
  }
  return out;
}

/** RAW 16-bit little-endian grayscale (widely supported heightmap format). */
export function gray16ToRaw(values: Uint16Array): Blob {
  const buf = new Uint8Array(values.length * 2);
  for (let i = 0; i < values.length; i++) {
    buf[i * 2] = values[i] & 0xff;
    buf[i * 2 + 1] = (values[i] >>> 8) & 0xff;
  }
  return new Blob([buf], { type: "application/octet-stream" });
}
