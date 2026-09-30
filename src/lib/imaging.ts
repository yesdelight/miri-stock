// 브라우저 캔버스 기반 후가공: 배경 제거, 잔여 픽셀 정리, 타이트 크롭, 비율 크롭, 업스케일, DPI 기록, 유사도 해시.

export type Canvas = HTMLCanvasElement

export function makeCanvas(w: number, h: number): Canvas {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

const ctx2d = (c: Canvas) => c.getContext('2d', { willReadFrequently: true })!

export async function blobToCanvas(blob: Blob): Promise<Canvas> {
  const bmp = await createImageBitmap(blob)
  const c = makeCanvas(bmp.width, bmp.height)
  ctx2d(c).drawImage(bmp, 0, 0)
  bmp.close()
  return c
}

export function cloneCanvas(src: Canvas) {
  const c = makeCanvas(src.width, src.height)
  ctx2d(c).drawImage(src, 0, 0)
  return c
}

type RGB = [number, number, number]

function borderColor(d: Uint8ClampedArray, w: number, h: number): RGB {
  // 테두리 픽셀 중앙값 — 대부분 흰색
  const rs: number[] = [], gs: number[] = [], bs: number[] = []
  const push = (x: number, y: number) => {
    const i = (y * w + x) * 4
    if (d[i + 3] < 128) return
    rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2])
  }
  const step = Math.max(1, Math.floor((w + h) / 400))
  for (let x = 0; x < w; x += step) { push(x, 0); push(x, h - 1) }
  for (let y = 0; y < h; y += step) { push(0, y); push(w - 1, y) }
  const med = (a: number[]) => (a.length ? a.sort((p, q) => p - q)[a.length >> 1] : 255)
  return [med(rs), med(gs), med(bs)]
}

export interface BgRemoveOptions {
  /** 배경색과의 허용 거리(0~120) */
  tolerance: number
  /** 경계 부드럽게 + 흰 테두리 색 제거 */
  defringe: boolean
  /** 경계 1px 깎기(남은 흰 테두리 제거) */
  shrink: number
  /** 이 비율보다 작은 조각(잔여 픽셀) 제거 */
  removeSpecks: boolean
  /** 가장 큰 덩어리만 남기기(단일 객체) */
  keepLargestOnly: boolean
  /** 테두리와 이어지지 않은 안쪽 배경색 구멍도 제거 */
  removeEnclosed: boolean
}

export const DEFAULT_BG_OPTIONS: BgRemoveOptions = {
  tolerance: 34,
  defringe: true,
  shrink: 0,
  removeSpecks: true,
  keepLargestOnly: false,
  removeEnclosed: false,
}

export function removeBackground(src: Canvas, opt: BgRemoveOptions): Canvas {
  const out = cloneCanvas(src)
  const ctx = ctx2d(out)
  const { width: w, height: h } = out
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const bg = borderColor(d, w, h)
  const tol = opt.tolerance
  const dist = (i: number) => {
    const dr = d[i] - bg[0], dg = d[i + 1] - bg[1], db = d[i + 2] - bg[2]
    return Math.sqrt(dr * dr + dg * dg + db * db)
  }
  const isBg = new Uint8Array(w * h)
  const q = new Int32Array(w * h)
  let qh = 0, qt = 0
  const seed = (p: number) => {
    if (isBg[p]) return
    const i = p * 4
    if (d[i + 3] < 16 || dist(i) <= tol) { isBg[p] = 1; q[qt++] = p }
  }
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1) }
  while (qh < qt) {
    const p = q[qh++]
    const x = p % w, y = (p / w) | 0
    if (x > 0) seed(p - 1)
    if (x < w - 1) seed(p + 1)
    if (y > 0) seed(p - w)
    if (y < h - 1) seed(p + w)
  }
  if (opt.removeEnclosed) {
    for (let p = 0; p < w * h; p++) if (!isBg[p] && dist(p * 4) <= tol * 0.6) isBg[p] = 1
  }
  for (let p = 0; p < w * h; p++) if (isBg[p]) d[p * 4 + 3] = 0

  // 경계 1px씩 깎기
  for (let s = 0; s < opt.shrink; s++) {
    const kill: number[] = []
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (d[p * 4 + 3] === 0) continue
      if ((x > 0 && d[(p - 1) * 4 + 3] === 0) || (x < w - 1 && d[(p + 1) * 4 + 3] === 0) ||
        (y > 0 && d[(p - w) * 4 + 3] === 0) || (y < h - 1 && d[(p + w) * 4 + 3] === 0)) kill.push(p)
    }
    kill.forEach((p) => (d[p * 4 + 3] = 0))
  }

  // 디프린지: 투명 영역과 맞닿은 2px 띠의 알파를 배경색 거리로 부드럽게, 배경색 성분 제거(un-matte)
  if (opt.defringe) {
    const near = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (d[p * 4 + 3] === 0) continue
      outer: for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        if (d[(yy * w + xx) * 4 + 3] === 0) { near[p] = 1; break outer }
      }
    }
    const soft = Math.max(tol * 2.2, 40)
    for (let p = 0; p < w * h; p++) {
      if (!near[p]) continue
      const i = p * 4
      const a = Math.min(1, Math.max(0, (dist(i) - tol * 0.5) / soft))
      if (a >= 1) continue
      if (a < 0.08) { d[i + 3] = 0; continue }
      for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, (d[i + c] - bg[c] * (1 - a)) / a))
      d[i + 3] = Math.round(d[i + 3] * a)
    }
  }

  if (opt.removeSpecks || opt.keepLargestOnly) {
    const { labels, sizes } = components(d, w, h, 24)
    if (sizes.length > 1) {
      const largest = Math.max(...sizes.slice(1))
      const total = sizes.reduce((a, b) => a + b, 0)
      for (let p = 0; p < w * h; p++) {
        const l = labels[p]
        if (!l) continue
        const sz = sizes[l]
        if ((opt.keepLargestOnly && sz !== largest) || (opt.removeSpecks && sz < total * 0.0015)) d[p * 4 + 3] = 0
      }
    }
  }
  ctx.putImageData(img, 0, 0)
  return out
}

/** 알파 기준 연결 요소(8방향). sizes[0]은 사용 안 함 */
export function components(d: Uint8ClampedArray, w: number, h: number, alphaMin = 24) {
  const labels = new Int32Array(w * h)
  const sizes: number[] = [0]
  const stack = new Int32Array(w * h)
  let label = 0
  for (let p0 = 0; p0 < w * h; p0++) {
    if (labels[p0] || d[p0 * 4 + 3] < alphaMin) continue
    label++
    let sp = 0, size = 0
    stack[sp++] = p0
    labels[p0] = label
    while (sp) {
      const p = stack[--sp]
      size++
      const x = p % w, y = (p / w) | 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const n = yy * w + xx
        if (!labels[n] && d[n * 4 + 3] >= alphaMin) { labels[n] = label; stack[sp++] = n }
      }
    }
    sizes.push(size)
  }
  return { labels, sizes }
}

export interface AlphaAnalysis {
  width: number
  height: number
  hasTransparency: boolean
  bbox: { x: number; y: number; w: number; h: number } | null
  margins: { top: number; right: number; bottom: number; left: number } | null
  /** 의미 있는 덩어리 수 */
  objects: number
  /** 잔여 픽셀 조각 수 */
  specks: number
  /** 불투명 영역 중 반투명(알파 40~230) 비율 */
  semiRatio: number
  /** 경계 픽셀 중 거의 흰색 비율 */
  whiteEdgeRatio: number
}

export function analyzeAlpha(c: Canvas): AlphaAnalysis {
  // 큰 이미지는 축소본으로 분석(덩어리·반투명 판단엔 충분)
  const scale = Math.min(1, 1200 / Math.max(c.width, c.height))
  const a = scale < 1 ? resizeCanvas(c, c.width * scale, c.height * scale) : c
  const { width: w, height: h } = a
  const d = ctx2d(a).getImageData(0, 0, w, h).data
  let minX = w, minY = h, maxX = -1, maxY = -1, transparent = 0, visible = 0, semi = 0, edge = 0, whiteEdge = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4
    const al = d[i + 3]
    if (al < 250) transparent++
    if (al < 24) continue
    visible++
    if (al < 230) semi++
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    const isEdge = (x > 0 && d[i - 1] < 24) || (x < w - 1 && d[i + 7] < 24) ||
      (y > 0 && d[i - w * 4 + 3] < 24) || (y < h - 1 && d[i + w * 4 + 3] < 24)
    if (isEdge) {
      edge++
      if (d[i] > 232 && d[i + 1] > 232 && d[i + 2] > 232) whiteEdge++
    }
  }
  const { sizes } = components(d, w, h, 24)
  const total = sizes.reduce((s, v) => s + v, 0)
  const objects = sizes.slice(1).filter((s) => s >= total * 0.02).length
  const specks = sizes.slice(1).filter((s) => s < total * 0.0015).length
  const inv = 1 / scale
  const bbox = maxX < 0 ? null : { x: minX * inv, y: minY * inv, w: (maxX - minX + 1) * inv, h: (maxY - minY + 1) * inv }
  return {
    width: c.width,
    height: c.height,
    hasTransparency: transparent > 0,
    bbox,
    margins: bbox ? {
      top: Math.round(bbox.y), left: Math.round(bbox.x),
      right: Math.max(0, Math.round(c.width - bbox.x - bbox.w)), bottom: Math.max(0, Math.round(c.height - bbox.y - bbox.h)),
    } : null,
    objects,
    specks,
    semiRatio: visible ? semi / visible : 0,
    whiteEdgeRatio: edge ? whiteEdge / edge : 0,
  }
}

/** 투명 영역 기준 여백 없이 자르기 (margin px만 남김) */
export function tightCrop(c: Canvas, margin = 0): Canvas {
  const { width: w, height: h } = c
  const d = ctx2d(c).getImageData(0, 0, w, h).data
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] < 8) continue
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (maxX < 0) return c
  minX = Math.max(0, minX - margin); minY = Math.max(0, minY - margin)
  maxX = Math.min(w - 1, maxX + margin); maxY = Math.min(h - 1, maxY + margin)
  const out = makeCanvas(maxX - minX + 1, maxY - minY + 1)
  ctx2d(out).drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height)
  return out
}

export function resizeCanvas(c: Canvas, w: number, h: number): Canvas {
  const out = makeCanvas(w, h)
  const ctx = ctx2d(out)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(c, 0, 0, out.width, out.height)
  return out
}

/** 긴 변이 target 이상이 되도록 2배씩 단계 확대(품질 저하 최소화) */
export function upscaleLongSide(c: Canvas, target: number): Canvas {
  let cur = c
  const long = () => Math.max(cur.width, cur.height)
  while (long() < target) {
    const f = Math.min(2, target / long())
    cur = resizeCanvas(cur, cur.width * f, cur.height * f)
  }
  return cur
}

export function downscaleLongSide(c: Canvas, max: number): Canvas {
  const long = Math.max(c.width, c.height)
  if (long <= max) return c
  const f = max / long
  return resizeCanvas(c, c.width * f, c.height * f)
}

/** 비율에 맞춰 자르기. fx/fy = 0~1 초점 위치 */
export function cropToAspect(c: Canvas, aw: number, ah: number, fx = 0.5, fy = 0.5): Canvas {
  const target = aw / ah
  let w = c.width, h = c.height
  if (w / h > target) w = Math.round(h * target)
  else h = Math.round(w / target)
  const x = Math.round((c.width - w) * fx)
  const y = Math.round((c.height - h) * fy)
  const out = makeCanvas(w, h)
  ctx2d(out).drawImage(c, x, y, w, h, 0, 0, w, h)
  return out
}

export function flattenOnWhite(c: Canvas): Canvas {
  const out = makeCanvas(c.width, c.height)
  const ctx = ctx2d(out)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(c, 0, 0)
  return out
}

// ---------- 인코딩 + DPI 기록 ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(bytes: Uint8Array) {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function setPngDpi(buf: Uint8Array, dpi: number): Uint8Array {
  const ppm = Math.round(dpi / 0.0254)
  // 기존 pHYs 제거
  const chunks: Uint8Array[] = [buf.slice(0, 8)]
  let off = 8
  let inserted = false
  while (off < buf.length) {
    const len = new DataView(buf.buffer, buf.byteOffset + off).getUint32(0)
    const type = String.fromCharCode(...buf.slice(off + 4, off + 8))
    const chunk = buf.slice(off, off + 12 + len)
    off += 12 + len
    if (type === 'pHYs') continue
    chunks.push(chunk)
    if (type === 'IHDR' && !inserted) {
      const c = new Uint8Array(21)
      const dv = new DataView(c.buffer)
      dv.setUint32(0, 9)
      c.set([0x70, 0x48, 0x59, 0x73], 4) // pHYs
      dv.setUint32(8, ppm)
      dv.setUint32(12, ppm)
      c[16] = 1
      dv.setUint32(17, crc32(c.slice(4, 17)))
      chunks.push(c)
      inserted = true
    }
  }
  const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0))
  let p = 0
  for (const c of chunks) { out.set(c, p); p += c.length }
  return out
}

export function setJpegDpi(buf: Uint8Array, dpi: number): Uint8Array {
  // FFD8 FFE0 len 'JFIF\0' ver(2) units(1) Xd(2) Yd(2)
  if (buf[2] === 0xff && buf[3] === 0xe0 && String.fromCharCode(...buf.slice(6, 10)) === 'JFIF') {
    const out = buf.slice()
    out[13] = 1
    out[14] = dpi >> 8; out[15] = dpi & 0xff
    out[16] = dpi >> 8; out[17] = dpi & 0xff
    return out
  }
  const app0 = new Uint8Array([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, dpi >> 8, dpi & 0xff, dpi >> 8, dpi & 0xff, 0, 0])
  const out = new Uint8Array(buf.length + app0.length)
  out.set(buf.slice(0, 2))
  out.set(app0, 2)
  out.set(buf.slice(2), 2 + app0.length)
  return out
}

export function readDpi(buf: Uint8Array, mime: string): number | null {
  if (mime === 'image/png') {
    let off = 8
    while (off < buf.length - 12) {
      const dv = new DataView(buf.buffer, buf.byteOffset + off)
      const len = dv.getUint32(0)
      const type = String.fromCharCode(...buf.slice(off + 4, off + 8))
      if (type === 'pHYs') return dv.getUint8(16) === 1 ? Math.round(dv.getUint32(8) * 0.0254) : null
      if (type === 'IDAT') return null
      off += 12 + len
    }
    return null
  }
  if (mime === 'image/jpeg' && buf[2] === 0xff && buf[3] === 0xe0 && buf[13] === 1) return (buf[14] << 8) | buf[15]
  return null
}

function canvasToBlob(c: Canvas, mime: string, q?: number) {
  return new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('인코딩 실패'))), mime, q))
}

export async function encodePng(c: Canvas, dpi = 120) {
  const raw = new Uint8Array(await (await canvasToBlob(c, 'image/png')).arrayBuffer())
  return new Blob([setPngDpi(raw, dpi) as BlobPart], { type: 'image/png' })
}

export async function encodeJpeg(c: Canvas, dpi = 120, quality = 0.92) {
  const raw = new Uint8Array(await (await canvasToBlob(flattenOnWhite(c), 'image/jpeg', quality)).arrayBuffer())
  return new Blob([setJpegDpi(raw, dpi) as BlobPart], { type: 'image/jpeg' })
}

export async function thumbnail(c: Canvas, max = 360) {
  return canvasToBlob(downscaleLongSide(c, max), 'image/png')
}

// ---------- 유사도: dHash (흑백 기준 → 색만 바꾼 동일 요소도 잡힘) ----------

export function dHash(c: Canvas): string {
  const s = makeCanvas(9, 8)
  const ctx = ctx2d(s)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, 9, 8)
  ctx.drawImage(c, 0, 0, 9, 8)
  const d = ctx.getImageData(0, 0, 9, 8).data
  const g = (x: number, y: number) => {
    const i = (y * 9 + x) * 4
    return d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114
  }
  let bits = ''
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += g(x, y) > g(x + 1, y) ? '1' : '0'
  // 윤곽(알파) 해시도 추가 — 색 반전에도 모양이 같으면 잡힘
  const m = makeCanvas(9, 8)
  const mc = ctx2d(m)
  mc.drawImage(c, 0, 0, 9, 8)
  const md = mc.getImageData(0, 0, 9, 8).data
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += md[(y * 9 + x) * 4 + 3] > md[(y * 9 + x + 1) * 4 + 3] ? '1' : '0'
  let hex = ''
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
}

export function hamming(a: string, b: string) {
  if (a.length !== b.length) return Infinity
  let n = 0
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) { n += x & 1; x >>= 1 }
  }
  return n
}

export async function blobBytes(b: Blob) {
  return new Uint8Array(await b.arrayBuffer())
}
