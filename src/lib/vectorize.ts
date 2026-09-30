// PNG → SVG 벡터화: 색상 정리(k-means로 N색 고정) → imagetracerjs → 투명 레이어 제거·색 hex화·크랙 방지 스트로크.
import ImageTracer from 'imagetracerjs'
import { downscaleLongSide, type Canvas } from './imaging'

export interface TraceOptions {
  colors: number // 1~5
  /** 추적 해상도(긴 변 px) — 낮을수록 단순·용량 작음 */
  traceSize: number
  /** 이 길이보다 짧은 경로 제거(노이즈) */
  pathomit: number
  /** 곡선 정밀도(낮을수록 정밀·용량 큼) */
  precision: number
  /** 크랙 방지: 같은 색 스트로크 두께 */
  crackStroke: number
  /** 출력 SVG 긴 변 크기 */
  outputSize: number
  /** 고정 팔레트(색상 잠금). 지정 시 colors 무시 */
  lockedPalette?: string[]
}

export const DEFAULT_TRACE: TraceOptions = {
  colors: 4,
  traceSize: 800,
  pathomit: 10,
  precision: 1,
  crackStroke: 1,
  outputSize: 2000,
}

type RGB = [number, number, number]

const hex = (c: RGB) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
export const hexToRgb = (h: string): RGB => {
  const s = h.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as RGB
}

/** 불투명 픽셀에서 대표색 k개 추출 */
export function extractPalette(c: Canvas, k: number): string[] {
  const s = downscaleLongSide(c, 200)
  const d = s.getContext('2d')!.getImageData(0, 0, s.width, s.height).data
  const px: RGB[] = []
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] >= 128) px.push([d[i], d[i + 1], d[i + 2]])
  if (!px.length) return []
  // k-means++ 초기화
  const centers: RGB[] = [px[Math.floor(px.length / 2)]]
  while (centers.length < k) {
    let best = px[0], bestD = -1
    for (let i = 0; i < px.length; i += 7) {
      const p = px[i]
      const dmin = Math.min(...centers.map((c) => (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2))
      if (dmin > bestD) { bestD = dmin; best = p }
    }
    if (bestD <= 0) break
    centers.push([...best] as RGB)
  }
  for (let it = 0; it < 12; it++) {
    const sum = centers.map(() => [0, 0, 0, 0])
    for (const p of px) {
      let bi = 0, bd = Infinity
      centers.forEach((c, i) => {
        const dd = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2
        if (dd < bd) { bd = dd; bi = i }
      })
      sum[bi][0] += p[0]; sum[bi][1] += p[1]; sum[bi][2] += p[2]; sum[bi][3]++
    }
    sum.forEach((s, i) => { if (s[3]) centers[i] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]] })
  }
  return centers.map(hex)
}

export function traceToSvg(c: Canvas, opt: TraceOptions): { svg: string; palette: string[] } {
  const palette = opt.lockedPalette?.length ? opt.lockedPalette : extractPalette(c, opt.colors)
  const src = downscaleLongSide(c, opt.traceSize)
  const ctx = src.getContext('2d', { willReadFrequently: true })!
  const img = ctx.getImageData(0, 0, src.width, src.height)
  const d = img.data
  // 반투명 정리: 알파 128 기준 이진화, 투명 픽셀 RGB 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0 } else d[i + 3] = 255
  }
  const pal = [{ r: 0, g: 0, b: 0, a: 0 }, ...palette.map((h) => { const [r, g, b] = hexToRgb(h); return { r, g, b, a: 255 } })]
  const raw: string = ImageTracer.imagedataToSVG(img, {
    pal,
    colorquantcycles: 1,
    mincolorratio: 0,
    ltres: opt.precision,
    qtres: opt.precision,
    pathomit: opt.pathomit,
    rightangleenhance: true,
    linefilter: true,
    blurradius: 0,
    strokewidth: opt.crackStroke,
    roundcoords: 1,
    viewbox: true,
    desc: false,
    scale: 1,
  })
  return { svg: cleanSvg(raw, src.width, src.height, opt.outputSize), palette }
}

function cleanSvg(raw: string, w: number, h: number, outLong: number) {
  const f = outLong / Math.max(w, h)
  const ow = Math.round(w * f), oh = Math.round(h * f)
  const paths = raw.match(/<path[^>]*\/>/g) ?? []
  const toHex = (s: string) => s.replace(/rgb\((\d+),(\d+),(\d+)\)/g, (_, r, g, b) => hex([+r, +g, +b]))
  const kept = paths
    .filter((p) => !/opacity="0(\.0+)?"/.test(p))
    .map((p) => toHex(p).replace(/\s*opacity="1"/, '').replace(/\s*desc="[^"]*"/, ''))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ow}" height="${oh}" viewBox="0 0 ${w} ${h}">` +
    kept.join('') + '</svg>'
}

export interface SvgAnalysis {
  bytes: number
  width: number | null
  height: number | null
  colors: string[]
  hasRaster: boolean
  hasText: boolean
  hasGradient: boolean
  evenOdd: boolean
}

export function analyzeSvg(svg: string): SvgAnalysis {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const root = doc.documentElement
  const num = (v: string | null) => (v ? parseFloat(v) : null)
  let width = num(root.getAttribute('width'))
  let height = num(root.getAttribute('height'))
  const vb = root.getAttribute('viewBox')?.split(/[\s,]+/).map(Number)
  if ((!width || !height) && vb?.length === 4) { width = vb[2]; height = vb[3] }
  const colors = new Set<string>()
  const norm = (v: string) => {
    v = v.trim().toLowerCase()
    if (!v || v === 'none' || v === 'transparent' || v.startsWith('url(')) return null
    const m = v.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/)
    if (m) return hex([+m[1], +m[2], +m[3]])
    if (/^#[0-9a-f]{3}$/.test(v)) return '#' + [...v.slice(1)].map((x) => x + x).join('')
    return v
  }
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of ['fill', 'stroke', 'stop-color']) {
      const c = el.getAttribute(attr)
      if (c) { const n = norm(c); if (n) colors.add(n) }
    }
    const style = el.getAttribute('style')
    style?.split(';').forEach((decl) => {
      const [k, v] = decl.split(':')
      if (v && ['fill', 'stroke'].includes(k.trim())) { const n = norm(v); if (n) colors.add(n) }
    })
  })
  return {
    bytes: new Blob([svg]).size,
    width,
    height,
    colors: [...colors],
    hasRaster: doc.querySelector('image') !== null,
    hasText: doc.querySelector('text') !== null,
    hasGradient: doc.querySelector('linearGradient, radialGradient') !== null,
    evenOdd: /evenodd/.test(svg),
  }
}

export async function svgToCanvas(svg: string, long = 1000): Promise<Canvas> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const f = long / Math.max(img.naturalWidth || long, img.naturalHeight || long)
    const c = document.createElement('canvas')
    c.width = Math.round((img.naturalWidth || long) * f)
    c.height = Math.round((img.naturalHeight || long) * f)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c
  } finally {
    URL.revokeObjectURL(url)
  }
}
