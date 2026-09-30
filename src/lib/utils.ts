export const pad = (n: number) => String(n).padStart(2, '0')

export function ymd(d: Date = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseYmd(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(s: string, n: number) {
  const d = parseYmd(s)
  d.setDate(d.getDate() + n)
  return ymd(d)
}

export function daysBetween(a: string, b: string) {
  return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86400000)
}

export function fmtBytes(n?: number) {
  if (n == null) return '-'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export function fmtWon(n: number) {
  return `${Math.round(n).toLocaleString('ko-KR')}원`
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function safeFileName(s: string) {
  return s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 60) || 'untitled'
}

/** 두 문자열의 단어 집합 유사도(0~1) */
export function jaccard(a: string, b: string) {
  const tok = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1))
  const A = tok(a)
  const B = tok(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  A.forEach((w) => B.has(w) && inter++)
  return inter / (A.size + B.size - inter)
}

/** AI 응답에서 JSON 추출 */
export function extractJson<T = unknown>(text: string): T {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fence ? fence[1] : text
  const start = body.search(/[[{]/)
  if (start < 0) throw new Error('응답에서 JSON을 찾지 못했어요.')
  const open = body[start]
  const close = open === '[' ? ']' : '}'
  const end = body.lastIndexOf(close)
  return JSON.parse(body.slice(start, end + 1)) as T
}

export async function copyText(s: string) {
  try {
    await navigator.clipboard.writeText(s)
    return true
  } catch {
    return false
  }
}
