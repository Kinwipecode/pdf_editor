/**
 * roomDetection.ts
 *
 * Professional room area detection using pure JS morphological image processing.
 *
 * Pipeline (mirrors what Bluebeam / AutoCAD do internally):
 *   1. Canvas RGBA → luminance → binary wall grid  (walls = 1, room = 0)
 *   2. MORPH_OPEN  (erode r=3, dilate r=3): removes thin noise (text, symbols, door arcs)
 *   3. MORPH_CLOSE (dilate r=30, erode r=30): bridges door openings automatically
 *   4. BFS flood fill from click point  → isolates the clicked room
 *   5. Moore-neighbor contour tracing   → room boundary polygon
 *   6. Ramer-Douglas-Peucker (RDP)      → clean simplified polygon
 *   7. Shoelace area formula            → area in page-coordinate units
 *
 * All morphological ops use a fast O(n) two-pass sliding-window box algorithm
 * (same speed as OpenCV's boxFilter), no CDN required.
 */

import type { Point } from '@/types';

export interface RoomDetectionOptions {
  rdpEpsilon?: number;
  wallThreshold?: number;   // Luminance below this = wall candidate (0-255, default 115)
  openRadius?: number;      // MORPH_OPEN kernel radius in px (default 3)
  closeRadius?: number;     // MORPH_CLOSE kernel radius in px (default auto)
  borderLeakGuard?: boolean; // hint-mode: treat fill touching the crop border as a leak
                             // (instead of the 25%-of-area heuristic, which breaks for large rooms)
}

export interface RoomDetectionResult {
  points: Point[];
  areaPx: number;
}

// ── no-op for backward compat – nothing async needed any more ─────────────────
export function preloadCV(): void {}

// ── Shoelace area ─────────────────────────────────────────────────────────────
export function polyArea(pts: Point[]): number {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  return Math.abs(area / 2);
}

// ── Fast O(n) box dilation (two-pass sliding-window) ─────────────────────────
function boxDilate(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return src.slice();
  const tmp = new Uint8Array(w * h);
  const dst = new Uint8Array(w * h);

  // Horizontal pass: for each row, sliding window of width 2r+1
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x <= Math.min(r - 1, w - 1); x++) sum += src[y * w + x];
    for (let x = 0; x < w; x++) {
      const add = x + r; if (add < w) sum += src[y * w + add];
      const sub = x - r - 1; if (sub >= 0) sum -= src[y * w + sub];
      tmp[y * w + x] = sum > 0 ? 1 : 0;
    }
  }

  // Vertical pass: for each column, sliding window of height 2r+1
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y <= Math.min(r - 1, h - 1); y++) sum += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      const add = y + r; if (add < h) sum += tmp[add * w + x];
      const sub = y - r - 1; if (sub >= 0) sum -= tmp[sub * w + x];
      dst[y * w + x] = sum > 0 ? 1 : 0;
    }
  }

  return dst;
}

// ── Box erosion = invert→dilate→invert ───────────────────────────────────────
function boxErode(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return src.slice();
  const inv = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) inv[i] = src[i] ? 0 : 1;
  const dil = boxDilate(inv, w, h, r);
  const out = new Uint8Array(dil.length);
  for (let i = 0; i < dil.length; i++) out[i] = dil[i] ? 0 : 1;
  return out;
}

// ── Ramer-Douglas-Peucker ─────────────────────────────────────────────────────
function perpendicularDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function rdp(pts: Point[], eps: number): Point[] {
  if (pts.length <= 2) return pts;
  let dmax = 0, idx = 0;
  const first = pts[0], last = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpendicularDist(pts[i], first, last);
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax > eps) {
    const r1 = rdp(pts.slice(0, idx + 1), eps);
    const r2 = rdp(pts.slice(idx), eps);
    return r1.slice(0, r1.length - 1).concat(r2);
  }
  return [first, last];
}

// ── Main entry ────────────────────────────────────────────────────────────────
export function detectRoomPolygon(
  canvas: HTMLCanvasElement,
  seedPoint: Point,
  pageWidth: number,
  pageHeight: number,
  options: RoomDetectionOptions = {},
): Promise<RoomDetectionResult | null> {
  const result = _detect(canvas, seedPoint, pageWidth, pageHeight, options);
  return Promise.resolve(result);
}

/**
 * Hinted room detection for Brush / Rough-outline tools.
 *
 * ABBYY-style VECTORIZATION (no flood-fill, no morph-close): the wall lines
 * are extracted directly from the raster and the room is reconstructed from
 * the wall band nearest to each side of the spray bounding box.
 *
 * Pipeline:
 *  1. Threshold dark pixels → walls, MORPH_OPEN r=1 to denoise.
 *  2. Strong horizontal/vertical wall lines: a row/column is a wall if it has
 *     a long dark span with a high fill ratio (robust against door gaps,
 *     dashed exterior walls and thin single-line walls).
 *  3. Adjacent rows/columns merge into wall BANDS (double-line walls collapse).
 *  4. For each side of the spray bbox pick the nearest band that spans the
 *     room; the polygon is the rectangle between the four inner faces.
 *  5. Fallback: detectFrameContour on the full page.
 */
export function detectRoomPolygonHinted(
  canvas: HTMLCanvasElement,
  hintPoints: Point[],
  pageWidth: number,
  pageHeight: number,
  options: RoomDetectionOptions = {},
): Promise<RoomDetectionResult | null> {
  const result = detectRoomFromLines(canvas, hintPoints, pageWidth, pageHeight, options);
  if (result) {
    console.log('[Line-detection] Room reconstructed from wall lines', { areaPx: result.areaPx });
    return Promise.resolve(result);
  }
  console.log('[Line-detection] No room found, trying frame-contour fallback');
  const frame = detectFrameContour(canvas, hintPoints, pageWidth, pageHeight);
  if (frame && frame.points.length >= 4 && frame.areaPx > 200) {
    console.log('[Line-detection] Frame-contour fallback succeeded', { areaPx: frame.areaPx });
    return Promise.resolve(frame);
  }
  console.log('[Line-detection] Frame-contour also returned null');
  return Promise.resolve(null);
}

interface WallBand {
  a: number;   // first index (row for horizontal bands, column for vertical)
  b: number;   // last index
  pos: number; // centroid
  s0: number;  // span start (column for horizontal bands, row for vertical)
  s1: number;  // span end
}

function detectRoomFromLines(
  canvas: HTMLCanvasElement,
  hintPoints: Point[],
  pageWidth: number,
  pageHeight: number,
  options: RoomDetectionOptions = {},
): RoomDetectionResult | null {
  if (hintPoints.length < 2) return null;

  // ── Spray bbox (page coords) ──────────────────────────────────────────────
  let minX = hintPoints[0].x, maxX = hintPoints[0].x;
  let minY = hintPoints[0].y, maxY = hintPoints[0].y;
  for (const p of hintPoints) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const bw = maxX - minX, bh = maxY - minY;
  if (bw < 1 || bh < 1) return null;

  const cw = canvas.width, ch = canvas.height;
  if (cw < 80 || ch < 80) return null;
  const scaleX = cw / pageWidth;
  const scaleY = ch / pageHeight;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { data } = ctx.getImageData(0, 0, cw, ch);

  // ── Threshold + morph open ────────────────────────────────────────────────
  const wallThresh = options.wallThreshold ?? 115;
  const raw = new Uint8Array(cw * ch);
  for (let i = 0; i < cw * ch; i++) {
    const o = i * 4;
    if (data[o + 3] > 30) {
      const lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
      if (lum < wallThresh) raw[i] = 1;
    }
  }
  const openR = options.openRadius ?? 1;
  const opened = boxDilate(boxErode(raw, cw, ch, openR), cw, ch, openR);

  const bx0 = minX * scaleX, by0 = minY * scaleY;
  const bx1 = maxX * scaleX, by1 = maxY * scaleY;
  const bwPx = bx1 - bx0, bhPx = by1 - by0;

  // A wall line must span at least ~50 % of the room's extent on the cross axis.
  const minRunH = Math.max(60, Math.round(bwPx * 0.5));
  const minRunV = Math.max(60, Math.round(bhPx * 0.5));

  // ── Strong horizontal rows (+ span, fill ratio) ───────────────────────────
  const rowStrong = new Uint8Array(ch);
  const rowSpan: Array<{ s0: number; s1: number } | null> = new Array(ch).fill(null);
  for (let y = 0; y < ch; y++) {
    let s0 = -1, s1 = -1, cnt = 0;
    for (let x = 0; x < cw; x++) {
      if (opened[y * cw + x]) {
        if (s0 < 0) s0 = x;
        s1 = x;
        cnt++;
      }
    }
    if (s0 >= 0 && (s1 - s0 + 1) >= minRunH && cnt / (s1 - s0 + 1) >= 0.35) {
      rowStrong[y] = 1;
      rowSpan[y] = { s0, s1 };
    }
  }

  // ── Strong vertical columns (+ span, fill ratio) ──────────────────────────
  const colStrong = new Uint8Array(cw);
  const colSpan: Array<{ s0: number; s1: number } | null> = new Array(cw).fill(null);
  for (let x = 0; x < cw; x++) {
    let s0 = -1, s1 = -1, cnt = 0;
    for (let y = 0; y < ch; y++) {
      if (opened[y * cw + x]) {
        if (s0 < 0) s0 = y;
        s1 = y;
        cnt++;
      }
    }
    if (s0 >= 0 && (s1 - s0 + 1) >= minRunV && cnt / (s1 - s0 + 1) >= 0.35) {
      colStrong[x] = 1;
      colSpan[x] = { s0, s1 };
    }
  }

  // ── Merge rows/columns into bands ─────────────────────────────────────────
  const hBands: WallBand[] = [];
  {
    let cur: WallBand | null = null;
    for (let y = 0; y < ch; y++) {
      if (rowStrong[y]) {
        const sp = rowSpan[y]!;
        if (cur && y - cur.b <= 6 && sp.s0 <= cur.s1 && sp.s1 >= cur.s0) {
          cur.b = y;
          if (sp.s0 < cur.s0) cur.s0 = sp.s0;
          if (sp.s1 > cur.s1) cur.s1 = sp.s1;
        } else {
          if (cur) hBands.push(cur);
          cur = { a: y, b: y, pos: y, s0: sp.s0, s1: sp.s1 };
        }
      } else if (cur) { hBands.push(cur); cur = null; }
    }
    if (cur) hBands.push(cur);
  }
  for (const b of hBands) b.pos = Math.round((b.a + b.b) / 2);

  const vBands: WallBand[] = [];
  {
    let cur: WallBand | null = null;
    for (let x = 0; x < cw; x++) {
      if (colStrong[x]) {
        const sp = colSpan[x]!;
        if (cur && x - cur.b <= 6 && sp.s0 <= cur.s1 && sp.s1 >= cur.s0) {
          cur.b = x;
          if (sp.s0 < cur.s0) cur.s0 = sp.s0;
          if (sp.s1 > cur.s1) cur.s1 = sp.s1;
        } else {
          if (cur) vBands.push(cur);
          cur = { a: x, b: x, pos: x, s0: sp.s0, s1: sp.s1 };
        }
      } else if (cur) { vBands.push(cur); cur = null; }
    }
    if (cur) vBands.push(cur);
  }
  for (const b of vBands) b.pos = Math.round((b.a + b.b) / 2);

  console.log('[Line-detection] Bands found', {
    nH: hBands.length, nV: vBands.length,
    minRunH, minRunV,
    sprayPx: [Math.round(bx0), Math.round(by0), Math.round(bx1), Math.round(by1)],
  });

  // ── Solve: nearest band per side (thick bands first, then any) ────────────
  const overlapLen = (b: WallBand, lo: number, hi: number) =>
    Math.min(b.s1, hi) - Math.max(b.s0, lo);
  const minOverlapH = Math.min(minRunH, 60);
  const minOverlapV = Math.min(minRunV, 60);

  const solve = (bandsH: WallBand[], bandsV: WallBand[]) => {
    let top: WallBand | null = null;
    for (const b of bandsH) {
      if (b.pos < by0 + 10 && overlapLen(b, bx0, bx1) >= minOverlapH) {
        if (!top || b.pos > top.pos) top = b;
      }
    }
    let bottom: WallBand | null = null;
    for (const b of bandsH) {
      if (b.pos > by1 - 10 && overlapLen(b, bx0, bx1) >= minOverlapH) {
        if (!bottom || b.pos < bottom.pos) bottom = b;
      }
    }
    let left: WallBand | null = null;
    for (const b of bandsV) {
      if (b.pos < bx0 + 10 && overlapLen(b, by0, by1) >= minOverlapV) {
        if (!left || b.pos > left.pos) left = b;
      }
    }
    let right: WallBand | null = null;
    for (const b of bandsV) {
      if (b.pos > bx1 - 10 && overlapLen(b, by0, by1) >= minOverlapV) {
        if (!right || b.pos < right.pos) right = b;
      }
    }
    if (!top || !bottom || !left || !right) return null;
    return { top, bottom, left, right };
  };

  const thickH = hBands.filter(b => b.b - b.a >= 2);
  const thickV = vBands.filter(b => b.b - b.a >= 2);
  const s = solve(thickH.length ? thickH : hBands, thickV.length ? thickV : vBands)
         ?? solve(hBands, vBands);
  if (!s) {
    console.log('[Line-detection] Not all four walls found');
    return null;
  }

  // ── Room rect from the inner faces of the four walls ──────────────────────
  const roomL = s.left.b;   // inner face of left wall
  const roomR = s.right.a;  // inner face of right wall
  const roomT = s.top.b;    // inner face of top wall
  const roomB = s.bottom.a; // inner face of bottom wall
  const roomW = roomR - roomL;
  const roomH = roomB - roomT;
  if (roomW < 40 || roomH < 40) {
    console.log('[Line-detection] Room rect too small', { roomW, roomH });
    return null;
  }

  const sprayArea = bwPx * bhPx;
  const roomArea = roomW * roomH;
  if (sprayArea > 0 && (roomArea < sprayArea * 0.4 || roomArea > sprayArea * 8)) {
    console.log('[Line-detection] Rejected – room rect disproportional', {
      roomArea, sprayArea, ratio: roomArea / sprayArea,
    });
    return null;
  }

  console.log('[Line-detection] Walls found', {
    topPx: s.top.b, bottomPx: s.bottom.a,
    leftPx: s.left.b, rightPx: s.right.a,
    roomW, roomH,
  });

  const points: Point[] = [
    { x: roomL / scaleX, y: roomT / scaleY },
    { x: roomR / scaleX, y: roomT / scaleY },
    { x: roomR / scaleX, y: roomB / scaleY },
    { x: roomL / scaleX, y: roomB / scaleY },
  ];
  return { points, areaPx: polyArea(points) };
}

/**
 * Frame-contour fallback for the hint-based tools (spray / rough outline).
 *
 * Works WITHOUT a closed boundary: scans the FULL page for long horizontal and
 * vertical wall-line bands, then picks the one nearest to each side of the
 * spray bbox — regardless of distance (no crop).
 */
function detectFrameContour(
  canvas: HTMLCanvasElement,
  hintPoints: Point[],
  pageWidth: number,
  pageHeight: number,
): RoomDetectionResult | null {
  if (hintPoints.length === 0) return null;

  let minX = hintPoints[0].x, maxX = hintPoints[0].x;
  let minY = hintPoints[0].y, maxY = hintPoints[0].y;
  for (const p of hintPoints) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }

  const scaleX = canvas.width / pageWidth;
  const scaleY = canvas.height / pageHeight;
  const cw = canvas.width;
  const ch = canvas.height;
  if (cw < 80 || ch < 80) return null;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { data } = ctx.getImageData(0, 0, cw, ch);

  // ── Threshold: non-fully-white pixels → walls ─────────────────────────────
  const raw = new Uint8Array(cw * ch);
  for (let i = 0; i < cw * ch; i++) {
    const o = i * 4;
    if (data[o + 3] > 30) {
      const lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
      if (lum < 145) raw[i] = 1;
    }
  }

  // ── MORPH_OPEN (r=1): remove isolated single dark pixels (text, symbols) ──
  const opened = boxDilate(boxErode(raw, cw, ch, 1), cw, ch, 1);

  // ── Spray bbox in canvas-pixel coordinates ────────────────────────────────
  const bx0 = minX * scaleX;
  const by0 = minY * scaleY;
  const bx1 = maxX * scaleX;
  const by1 = maxY * scaleY;

  // A frame side must be at least ~40 % as long as the bbox dimension
  // (min 100 px, max 600 px window).
  const minLenH = Math.min(cw, Math.max(100, Math.min(600, Math.round((bx1 - bx0) * 0.4))));
  const minLenV = Math.min(ch, Math.max(100, Math.min(600, Math.round((by1 - by0) * 0.4))));

  const rowStrong = new Uint8Array(ch);
  const colStrong = new Uint8Array(cw);

  // Sliding-window coverage (>= 50 % of window) — robust against dashed walls.
  for (let y = 0; y < ch; y++) {
    const W = Math.min(minLenH, cw);
    let sum = 0;
    for (let x = 0; x < W; x++) sum += opened[y * cw + x];
    let ok = sum >= W * 0.5;
    for (let x = W; x < cw && !ok; x++) {
      sum += opened[y * cw + x] - opened[y * cw + (x - W)];
      if (sum >= W * 0.5) ok = true;
    }
    rowStrong[y] = ok ? 1 : 0;
  }
  for (let x = 0; x < cw; x++) {
    const W = Math.min(minLenV, ch);
    let sum = 0;
    for (let y = 0; y < W; y++) sum += opened[y * cw + x];
    let ok = sum >= W * 0.5;
    for (let y = W; y < ch && !ok; y++) {
      sum += opened[y * cw + x] - opened[(y - W) * cw + x];
      if (sum >= W * 0.5) ok = true;
    }
    colStrong[x] = ok ? 1 : 0;
  }

  const hBands = bandRanges(rowStrong);
  const vBands = bandRanges(colStrong);

  // Pick the strong-line band whose centre is nearest to a bbox side, searching
  // from that side outward across the FULL page (no distance limit).
  const pickNearest = (bands: Array<[number, number]>, target: number, lo: number, hi: number): number | null => {
    let best = Infinity, bestC = -1;
    for (const b of bands) {
      const c = Math.round((b[0] + b[1]) / 2);
      if (c < lo || c > hi) continue;
      const d = Math.abs(c - target);
      if (d < best) { best = d; bestC = c; }
    }
    return bestC < 0 ? null : bestC;
  };

  const top    = pickNearest(hBands, by0, 0, by0 + 25);
  const bottom = pickNearest(hBands, by1, by1 - 25, ch);
  const left   = pickNearest(vBands, bx0, 0, bx0 + 25);
  const right  = pickNearest(vBands, bx1, bx1 - 25, cw);

  console.log('[Frame-contour] Full-page candidates', {
    pagePx: [cw, ch], bbox: [bx0, by0, bx1, by1],
    nHbands: hBands.length, nVbands: vBands.length,
    minLenH, minLenV,
    top, bottom, left, right,
  });

  if (top === null || bottom === null || left === null || right === null) return null;
  if (right - left < 80 || bottom - top < 80) {
    console.log('[Frame-contour] Rectangle too small', { w: right - left, h: bottom - top });
    return null;
  }

  const points: Point[] = [
    { x: left / scaleX,  y: top / scaleY },
    { x: right / scaleX, y: top / scaleY },
    { x: right / scaleX, y: bottom / scaleY },
    { x: left / scaleX,  y: bottom / scaleY },
  ];

  return { points, areaPx: polyArea(points) };
}

// ── Merge consecutive 1-entries into [start, end] ranges ────────────────────
function bandRanges(arr: Uint8Array): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let i = 0;
  const n = arr.length;
  while (i < n) {
    if (arr[i]) {
      const start = i;
      while (i < n && arr[i]) i++;
      out.push([start, i - 1]);
    } else i++;
  }
  return out;
}

function _detect(
  canvas: HTMLCanvasElement,
  seedPoint: Point,
  pageWidth: number,
  pageHeight: number,
  options: RoomDetectionOptions,
): RoomDetectionResult | null {
  const {
    rdpEpsilon      = 4,
    wallThreshold   = 115,
    openRadius      = 1,   // r=1: removes isolated noise without erasing thin wall segments
    borderLeakGuard = false,
  } = options;

  const cw = canvas.width;
  const ch = canvas.height;
  if (cw === 0 || ch === 0) return null;

  const scaleX = cw / pageWidth;
  const scaleY = ch / pageHeight;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const { data } = ctx.getImageData(0, 0, cw, ch);

  // ── 1. Threshold: dark pixels → walls ─────────────────────────────────────
  const rawWalls = new Uint8Array(cw * ch);
  for (let i = 0; i < cw * ch; i++) {
    const o = i * 4;
    if (data[o + 3] > 30) {
      const lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
      if (lum < wallThreshold) rawWalls[i] = 1;
    }
  }

  // ── 2. MORPH_OPEN (erode → dilate): removes thin text, symbols, door arcs ─
  //    r=1 only removes isolated single dark pixels. Using r=3 can erase dashed
  //    exterior wall segments and cause exterior flood-fill leaks.
  const opened = boxDilate(boxErode(rawWalls, cw, ch, openRadius), cw, ch, openRadius);

  // ── 3. MORPH_CLOSE (dilate → erode): bridges door openings ──────────────────
  //    Auto door gap: typical door ≈ 80 cm. Start conservative (r=15);
  //    if that fails (room too tiny), we can increase. Clamp 12–60 px.
  const autoDoor = Math.round(Math.min(Math.max(scaleX * 80, 12), 60));
  const closeR   = options.closeRadius ?? autoDoor;
  const walls    = boxErode(boxDilate(opened, cw, ch, closeR), cw, ch, closeR);

  // ── 4. Seed point – spiral-search if click lands on wall pixel ─────────────
  let seedX = Math.max(0, Math.min(cw - 1, Math.round(seedPoint.x * scaleX)));
  let seedY = Math.max(0, Math.min(ch - 1, Math.round(seedPoint.y * scaleY)));

  const isFree = (x: number, y: number) =>
    x >= 0 && x < cw && y >= 0 && y < ch && walls[y * cw + x] === 0;

  if (!isFree(seedX, seedY)) {
    let found = false;
    outer: for (let r = 1; r <= 50; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          if (isFree(seedX + dx, seedY + dy)) {
            seedX += dx; seedY += dy;
            found = true;
            break outer;
          }
        }
      }
    }
    if (!found) {
      console.log('[Flood-fill] Seed search failed – no free pixel within radius 50', { seedX: Math.round(seedPoint.x * scaleX), seedY: Math.round(seedPoint.y * scaleY) });
      return null;
    }
  }

  // ── 5. BFS flood fill ─────────────────────────────────────────────────────
  //    MAX_ROOM: rooms are always smaller than 25 % of canvas area.
  //    If we exceed that, we've leaked to the building exterior.
  const CANVAS_AREA = cw * ch;
  const MAX_ROOM    = Math.floor(CANVAS_AREA * 0.25);
  const MAX_FILL    = Math.min(3_000_000, CANVAS_AREA);

  const filled   = new Uint8Array(CANVAS_AREA);
  const qx = new Int32Array(MAX_FILL);
  const qy = new Int32Array(MAX_FILL);
  let head = 0, tail = 0;

  filled[seedY * cw + seedX] = 1;
  qx[tail] = seedX; qy[tail] = seedY; tail++;

  let minX = seedX, maxX = seedX, minY = seedY, maxY = seedY;
  let fillCount = 0;
  let exteriorLeak = false;
  let touchedBorder = false;
  const ddx = [1, -1, 0, 0];
  const ddy = [0, 0, 1, -1];

  while (head < tail) {
    const cx = qx[head], cy = qy[head]; head++;
    fillCount++;
    if (cx === 0 || cy === 0 || cx === cw - 1 || cy === ch - 1) touchedBorder = true;

    // ── Exterior leak guard ─────────────────────────────────────────────────
    // borderLeakGuard (hint-mode): the crop is already limited to the marked
    // area, so the fill is leaked iff it reaches the crop border. This avoids
    // the 25%-of-area heuristic rejecting every room larger than ~240 px.
    if (borderLeakGuard ? touchedBorder : fillCount > MAX_ROOM) {
      exteriorLeak = true;
      break;
    }

    if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
    if (tail >= MAX_FILL - 4) { touchedBorder = true; break; }
    for (let d = 0; d < 4; d++) {
      const nx = cx + ddx[d], ny = cy + ddy[d];
      if (nx >= 0 && nx < cw && ny >= 0 && ny < ch) {
        const ni = ny * cw + nx;
        if (walls[ni] === 0 && filled[ni] === 0) {
          filled[ni] = 1;
          qx[tail] = nx; qy[tail] = ny; tail++;
        }
      }
    }
  }

  // If exterior was detected, retry with a LARGER close radius to seal the leak
  if (exteriorLeak) {
    console.log('[Flood-fill] Exterior leak detected, retrying with bigger close radius', {
      borderLeakGuard, closeR, biggerClose: Math.min(closeR * 2, 100),
    });
    const biggerClose = Math.min(closeR * 2, 100);
    const walls2 = boxErode(boxDilate(opened, cw, ch, biggerClose), cw, ch, biggerClose);
    return _detectWithWalls(walls2, cw, ch, scaleX, scaleY, seedX, seedY, rdpEpsilon, MAX_ROOM, borderLeakGuard);
  }

  if (fillCount < 50) {
    console.log('[Flood-fill] Fill area too small', { fillCount });
    return null;
  }

  // ── 6. Moore-neighbor contour tracing ─────────────────────────────────────
  // Find top-left filled pixel
  let bx = -1, by = -1;
  outerSearch: for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (filled[y * cw + x]) { bx = x; by = y; break outerSearch; }
    }
  }
  if (bx === -1) return null;

  const nbrX = [-1, -1, 0, 1, 1,  1,  0, -1];
  const nbrY = [ 0, -1, -1, -1, 0, 1,  1,  1];
  const contour: Point[] = [];
  let cx = bx, cy = by, backDir = 0;
  const MAX_LOOP = Math.min(cw * ch * 2, 2_000_000);

  for (let iter = 0; iter < MAX_LOOP; iter++) {
    contour.push({ x: cx, y: cy });
    let moved = false;
    const start = (backDir + 1) % 8;
    for (let i = 0; i < 8; i++) {
      const dir = (start + i) % 8;
      const nx = cx + nbrX[dir], ny = cy + nbrY[dir];
      if (nx >= 0 && nx < cw && ny >= 0 && ny < ch && filled[ny * cw + nx]) {
        cx = nx; cy = ny;
        backDir = (dir + 4) % 8;
        moved = true;
        break;
      }
    }
    if (!moved || (cx === bx && cy === by && iter > 0)) break;
  }

  if (contour.length < 3) return null;

  // ── 7. RDP simplification + convert to page coordinates ───────────────────
  const simplified = rdp(contour, rdpEpsilon);
  // Close polygon
  if (simplified[0].x !== simplified[simplified.length - 1].x ||
      simplified[0].y !== simplified[simplified.length - 1].y) {
    simplified.push({ ...simplified[0] });
  }

  const points: Point[] = simplified.map(p => ({
    x: p.x / scaleX,
    y: p.y / scaleY,
  }));

  // Remove duplicate closing point
  if (points.length > 3 &&
      points[0].x === points[points.length - 1].x &&
      points[0].y === points[points.length - 1].y) {
    points.pop();
  }

  const areaPx = polyArea(points);
  return { points, areaPx };
}

/**
 * Shared BFS + contour tracing used by the retry path when an exterior leak is detected.
 */
function _detectWithWalls(
  walls: Uint8Array,
  cw: number, ch: number,
  scaleX: number, scaleY: number,
  seedX: number, seedY: number,
  rdpEpsilon: number,
  maxRoom: number,
  borderLeakGuard = false,
): RoomDetectionResult | null {
  // Ensure seed is free
  if (walls[seedY * cw + seedX] !== 0) return null;

  const CANVAS_AREA = cw * ch;
  const MAX_FILL    = Math.min(3_000_000, CANVAS_AREA);
  const filled      = new Uint8Array(CANVAS_AREA);
  const qx = new Int32Array(MAX_FILL);
  const qy = new Int32Array(MAX_FILL);
  let head = 0, tail = 0;

  filled[seedY * cw + seedX] = 1;
  qx[tail] = seedX; qy[tail] = seedY; tail++;

  let minX = seedX, maxX = seedX, minY = seedY, maxY = seedY;
  let fillCount = 0;
  let touchedBorder = false;
  const ddx = [1, -1, 0, 0];
  const ddy = [0,  0, 1, -1];

  while (head < tail) {
    const cx = qx[head], cy = qy[head]; head++;
    fillCount++;
    if (cx === 0 || cy === 0 || cx === cw - 1 || cy === ch - 1) touchedBorder = true;
    if (borderLeakGuard ? touchedBorder : fillCount > maxRoom) return null; // still exterior, give up
    if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
    if (tail >= MAX_FILL - 4) break;
    for (let d = 0; d < 4; d++) {
      const nx = cx + ddx[d], ny = cy + ddy[d];
      if (nx >= 0 && nx < cw && ny >= 0 && ny < ch) {
        const ni = ny * cw + nx;
        if (walls[ni] === 0 && filled[ni] === 0) {
          filled[ni] = 1;
          qx[tail] = nx; qy[tail] = ny; tail++;
        }
      }
    }
  }

  if (fillCount < 50) return null;

  let bx = -1, by = -1;
  outerSearch: for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (filled[y * cw + x]) { bx = x; by = y; break outerSearch; }
    }
  }
  if (bx === -1) return null;

  const nbrX = [-1, -1, 0, 1, 1,  1,  0, -1];
  const nbrY = [ 0, -1, -1, -1, 0, 1,  1,  1];
  const contour: Point[] = [];
  let cx = bx, cy = by, backDir = 0;
  const MAX_LOOP = Math.min(cw * ch * 2, 2_000_000);

  for (let iter = 0; iter < MAX_LOOP; iter++) {
    contour.push({ x: cx, y: cy });
    let moved = false;
    const start = (backDir + 1) % 8;
    for (let i = 0; i < 8; i++) {
      const dir = (start + i) % 8;
      const nx = cx + nbrX[dir], ny = cy + nbrY[dir];
      if (nx >= 0 && nx < cw && ny >= 0 && ny < ch && filled[ny * cw + nx]) {
        cx = nx; cy = ny;
        backDir = (dir + 4) % 8;
        moved = true;
        break;
      }
    }
    if (!moved || (cx === bx && cy === by && iter > 0)) break;
  }

  if (contour.length < 3) return null;

  const simplified = rdp(contour, rdpEpsilon);
  if (simplified[0].x !== simplified[simplified.length - 1].x ||
      simplified[0].y !== simplified[simplified.length - 1].y) {
    simplified.push({ ...simplified[0] });
  }

  const points: Point[] = simplified.map(p => ({ x: p.x / scaleX, y: p.y / scaleY }));
  if (points.length > 3 &&
      points[0].x === points[points.length - 1].x &&
      points[0].y === points[points.length - 1].y) {
    points.pop();
  }

  return { points, areaPx: polyArea(points) };
}
