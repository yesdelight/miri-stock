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

/** 용량 한도는 10진수 기준(1MB = 1,000,000B)으로 판정 — 1024 기준보다 엄격해서 어느 쪽이든 통과 */
export const MB = 1_000_000

export function fmtBytes(n?: number) {
  if (n == null) return '-'
  if (n < 1000) return `${n} B`
  if (n < MB) return `${(n / 1000).toFixed(1)} KB`
  return `${(n / MB).toFixed(2)} MB`
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

/** 마지막 extractJson이 잘린 답변을 복구했는지(앞부분만 사용) */
export let jsonWasRepaired = false

const stripTrailingCommas = (s: string) => s.replace(/,(\s*[}\]])/g, '$1')

/** 중간에 잘린 JSON을 마지막으로 완성된 값까지 자르고 괄호를 닫아 복구 */
function repairTruncated(s: string): string {
  const stack: string[] = []
  let inStr = false, esc = false
  let cut: { pos: number; stack: string[] } | null = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{' || c === '[') { stack.push(c); cut = { pos: i + 1, stack: [...stack] } }
    else if (c === '}' || c === ']') {
      stack.pop()
      cut = { pos: i + 1, stack: [...stack] }
      if (!stack.length) return s.slice(0, i + 1)
    } else if (c === ',') cut = { pos: i, stack: [...stack] }
  }
  if (!cut) return s
  const closers = cut.stack.reverse().map((b) => (b === '{' ? '}' : ']')).join('')
  return s.slice(0, cut.pos) + closers
}

function parseBlock(body: string): unknown {
  const start = body.search(/[[{]/)
  if (start < 0) throw new Error('no json')
  const from = body.slice(start)
  const close = from[0] === '[' ? ']' : '}'
  const whole = from.slice(0, from.lastIndexOf(close) + 1)
  for (const cand of [whole, stripTrailingCommas(whole)]) {
    try { return JSON.parse(cand) } catch { /* 다음 시도 */ }
  }
  const fixed = stripTrailingCommas(repairTruncated(stripTrailingCommas(from)))
  let v = JSON.parse(fixed)
  if (Array.isArray(v)) v = v.filter((x) => !(x && typeof x === 'object' && !Array.isArray(x) && !Object.keys(x).length))
  jsonWasRepaired = true
  return v
}

/** ChatGPT·Gemini 웹 검색 답변에 붙는 출처 표시 제거 (따옴표가 섞여 JSON을 깨뜨림) */
function stripCitations(t: string) {
  return t
    .replace(/:?[\w-]*content-?reference[^\s{}"]*\{[^{}]*\}/gi, '') // :chatgpt-content-reference{index="0"}
    .replace(/:?contentReference\[[^\]]*\](\{[^{}]*\})?/g, '') // :contentReference[oaicite:0]{index=0}
    .replace(/\[oaicite:\d+\]/g, '')
    .replace(/[\uE200-\uE2FF][^\uE200-\uE2FF]*?[\uE200-\uE2FF]/g, '') // 보이지 않는 인용 문자 묶음
    .replace(/【[^】]*】/g, '')
    .replace(/\[cite(?:_start|_end)?:?[^\]]*\]/gi, '')
}

/** 마지막 수단: 따옴표가 깨진 JSON에서 "키": "값" / "키": [..] 쌍을 정규식으로 주워 객체 목록을 만듦 */
function looseObjects(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const chunk of text.split(/\}\s*,?\s*\{/)) {
    const obj: Record<string, unknown> = {}
    for (const m of chunk.matchAll(/"(\w+)"\s*:\s*(\[[^\]]*\]|"(?:[^"\\\n]|\\.)*"(?=\s*[,}\n])|-?\d+(?:\.\d+)?|true|false)/g)) {
      const raw = m[2]
      try { obj[m[1]] = JSON.parse(raw) } catch {
        obj[m[1]] = raw.startsWith('[') ? [...raw.matchAll(/"([^"]*)"/g)].map((x) => x[1]) : raw.replace(/^"|"$/g, '')
      }
    }
    if (Object.keys(obj).length) out.push(obj)
  }
  return out
}

/** AI 응답에서 JSON 추출. 코드 블록 여러 개·잘린 답변·끝 쉼표·출처 표시도 최대한 살림 */
export function extractJson<T = unknown>(raw: string): T {
  jsonWasRepaired = false
  const text = stripCitations(raw)
  const blocks = [...text.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)(?:```|$)/g)].map((m) => m[1]).filter((b) => /[[{]/.test(b))
  const sources = blocks.length ? blocks : [text]
  const parsed: unknown[] = []
  for (const b of sources) {
    try { parsed.push(parseBlock(b)) } catch { /* 이 블록은 건너뜀 */ }
  }
  if (!parsed.length) {
    const loose = looseObjects(text)
    if (!loose.length) throw new Error('답변에서 JSON을 찾지 못했어요')
    jsonWasRepaired = true
    return (text.trimStart().startsWith('{') && loose.length === 1 ? loose[0] : loose) as T
  }
  if (parsed.length > 1 && parsed.every(Array.isArray)) return (parsed as unknown[][]).flat() as T
  return parsed[0] as T
}

export async function copyText(s: string) {
  try {
    await navigator.clipboard.writeText(s)
    return true
  } catch {
    return false
  }
}
