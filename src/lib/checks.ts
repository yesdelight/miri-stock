// 자동 검수: rules.ts의 mode:'auto' 규칙을 실제 파일로 판정.
import type { CheckResult, Item } from './db'
import { analyzeAlpha, blobBytes, blobToCanvas, hamming, readDpi } from './imaging'
import { ASPECTS, BANNED_WORDS, CROP_MARGIN_MAX_RATIO, SPECS, SVG_MAX_COLORS, TYPE_LABEL, type AspectId, type ElementType } from './rules'
import { getSettings } from './settings'
import { fmtBytes, jaccard, MB } from './utils'
import { analyzeSvg, svgToCanvas } from './vectorize'

export interface CheckInput {
  itemId: string
  type: ElementType
  file: Blob | null
  aspect?: AspectId
  smallSize?: boolean
  prompt?: string
  promptLogCount: number
  title: string
  keywords: string[]
  dhash?: string
  others: Item[]
  durationSec?: number
}

const r = (ruleId: string, ok: boolean | null, message: string): CheckResult => ({ ruleId, ok, message })

export function bannedWordsIn(text: string): string[] {
  const extra = getSettings().extraBannedWords.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
  const t = text.toLowerCase()
  return [...BANNED_WORDS, ...extra].filter((w) => t.includes(w.toLowerCase()))
}

export async function runAutoChecks(inp: CheckInput): Promise<CheckResult[]> {
  const out: CheckResult[] = []
  const spec = SPECS[inp.type]
  const others = inp.others.filter((o) => o.id !== inp.itemId)

  // 프롬프트 증빙
  out.push(inp.prompt?.trim() || inp.promptLogCount
    ? r('own-prompt', true, '프롬프트 기록이 저장돼 있어요.')
    : r('own-prompt', false, '프롬프트를 입력(또는 붙여넣기)해 두세요. 관리자 요청 시 증빙용이에요.'))

  // 같은 프롬프트 어뷰징
  if (inp.prompt?.trim()) {
    let maxSim = 0, sameCount = 0, near: string | undefined
    for (const o of others) {
      for (const p of [o.prompt ?? '', ...o.promptLog.map((l) => l.prompt)]) {
        if (!p) continue
        const s = jaccard(inp.prompt, p)
        if (s > maxSim) { maxSim = s; near = o.title }
        if (s >= 0.85) { sameCount++; break }
      }
    }
    out.push(sameCount >= 2
      ? r('no-prompt-abuse', false, `거의 같은 프롬프트로 만든 요소가 ${sameCount}개 있어요. 구도·소재·스타일을 바꿔 주세요.`)
      : maxSim >= 0.85
        ? r('no-prompt-abuse', null, `“${near}”와 프롬프트가 ${Math.round(maxSim * 100)}% 겹쳐요. 결과물이 충분히 다른지 확인하세요.`)
        : r('no-prompt-abuse', true, `기존 프롬프트와 최대 유사도 ${Math.round(maxSim * 100)}%`))
  }

  // 금지 단어
  const banned = bannedWordsIn([inp.title, ...inp.keywords, inp.prompt ?? ''].join(' '))
  out.push(banned.length
    ? r('no-names', false, `금지 단어 발견: ${banned.join(', ')}`)
    : r('no-names', true, '제목·키워드·프롬프트에 작가명·캐릭터명·브랜드명 없음'))

  // 유사 이미지(색만 바꾼 동일 요소 / SVG·PNG 중복)
  if (inp.dhash) {
    const lumA = inp.dhash.slice(0, 16), shapeA = inp.dhash.slice(16)
    let recolor: Item | undefined, twin: Item | undefined
    for (const o of others) {
      if (!o.dhash) continue
      const lum = hamming(lumA, o.dhash.slice(0, 16))
      const shape = hamming(shapeA, o.dhash.slice(16))
      const sameShape = inp.type !== 'background' && o.type !== 'background' ? shape <= 4 && lum <= 22 : lum <= 6
      if (!sameShape) continue
      if (o.type === inp.type) recolor ??= o
      else if (['png', 'svg'].includes(o.type) && ['png', 'svg'].includes(inp.type)) twin ??= o
    }
    out.push(recolor
      ? r('no-recolor', false, `“${recolor.title}”와 형태가 거의 같아요. 색만 바꾼 요소는 업로드 불가예요.`)
      : r('no-recolor', true, '보관함에 형태가 같은 요소 없음'))
    if (inp.type === 'png' || inp.type === 'svg') {
      out.push(twin
        ? r('one-format', false, `같은 디자인이 ${TYPE_LABEL[twin.type]}(“${twin.title}”)로 이미 있어요. 하나의 타입으로만 올리세요.`)
        : r('one-format', true, '다른 타입으로 중복 저장된 동일 디자인 없음'))
    }
  }

  if (!inp.file) {
    out.push(r('spec', false, '최종 파일이 아직 없어요.'))
    return out
  }

  const specMsgs: string[] = []
  let specOk: boolean | null = true
  const fail = (m: string) => { specMsgs.push('❌ ' + m); specOk = false }
  const warn = (m: string) => { specMsgs.push('⚠️ ' + m); if (specOk) specOk = null }
  const pass = (m: string) => specMsgs.push('✅ ' + m)

  if (inp.file.type !== spec.mime) fail(`확장자: ${spec.ext.toUpperCase()}여야 해요 (현재 ${inp.file.type || '알 수 없음'})`)
  else pass(`확장자 ${spec.ext.toUpperCase()}`)
  if (inp.file.size > spec.maxMB * MB) fail(`용량 ${fmtBytes(inp.file.size)} > 최대 ${spec.maxMB}MB`)
  else pass(`용량 ${fmtBytes(inp.file.size)} (최대 ${spec.maxMB < 1 ? spec.maxMB * 1000 + 'KB' : spec.maxMB + 'MB'})`)

  if (inp.type === 'video') {
    if (inp.durationSec == null) warn('영상 길이를 읽지 못했어요')
    else if (inp.durationSec > (spec.maxSeconds ?? 30)) fail(`길이 ${inp.durationSec.toFixed(1)}초 > ${spec.maxSeconds}초`)
    else pass(`길이 ${inp.durationSec.toFixed(1)}초`)
    out.push(r('spec', specOk, specMsgs.join('\n')))
    out.push(r('single-object', null, '영상은 한 가지 피사체/모션인지 직접 확인하세요.'))
    return out
  }

  let canvas: HTMLCanvasElement
  if (inp.type === 'svg') {
    const text = await inp.file.text()
    const a = analyzeSvg(text)
    const long = Math.max(a.width ?? 0, a.height ?? 0)
    if (!long) warn('SVG 크기(width/height/viewBox)가 없어요')
    else if (spec.maxPx && long > spec.maxPx) fail(`크기 ${long}px > 최대 ${spec.maxPx}px`)
    else pass(`크기 ${Math.round(a.width ?? 0)}×${Math.round(a.height ?? 0)}px`)
    out.push(r('svg-colors', a.colors.length <= SVG_MAX_COLORS,
      `사용 색상 ${a.colors.length}개 (${a.colors.slice(0, 8).join(', ')})${a.colors.length > SVG_MAX_COLORS ? ` — ${SVG_MAX_COLORS}개 이하로 줄이세요` : ''}${a.hasGradient ? ' · 그라데이션 포함' : ''}`))
    out.push(a.hasRaster || a.hasText
      ? r('svg-no-raster', false, `${a.hasRaster ? '비트맵 <image> ' : ''}${a.hasText ? '텍스트 <text> ' : ''}객체가 있어요`)
      : r('svg-no-raster', true, '벡터 도형만 있음'))
    canvas = await svgToCanvas(text, 1200)
  } else {
    const bytes = await blobBytes(inp.file)
    const dpi = readDpi(bytes, inp.file.type)
    if (spec.minDpi && (dpi ?? 0) < spec.minDpi) fail(`DPI ${dpi ?? '미기록'} < ${spec.minDpi} (앱에서 저장하면 자동 기록돼요)`)
    else pass(`DPI ${dpi}`)
    canvas = await blobToCanvas(inp.file)
    const long = Math.max(canvas.width, canvas.height)
    const minPx = inp.type === 'png' && inp.smallSize ? spec.minPxSmall! : spec.minPx!
    if (long < minPx) fail(`해상도 긴 변 ${long}px < 최소 ${minPx}px`)
    else if (spec.maxPx && long > spec.maxPx) fail(`해상도 긴 변 ${long}px > 최대 ${spec.maxPx}px`)
    else pass(`해상도 ${canvas.width}×${canvas.height}px`)
  }
  out.push(r('spec', specOk, specMsgs.join('\n')))

  const a = analyzeAlpha(canvas)
  if (inp.type === 'background') {
    const asp = ASPECTS.find((x) => x.id === inp.aspect)
    const ratio = canvas.width / canvas.height
    const aspOk = asp ? Math.abs(ratio - asp.w / asp.h) / (asp.w / asp.h) < 0.01 : null
    out.push(r('bg-rect', a.hasTransparency ? false : aspOk,
      a.hasTransparency ? '투명 영역이 있어요. 배경은 꽉 찬 사각형이어야 해요.'
        : asp ? (aspOk ? `${asp.id} 비율과 일치` : `선택한 ${asp.id}와 비율이 달라요(${ratio.toFixed(3)})`) : '비율을 선택하세요'))
    out.push(r('no-transparency', !a.hasTransparency, a.hasTransparency ? '투명 픽셀이 있어요' : '투명도 없음'))
    return out
  }

  // PNG / SVG 요소
  out.push(!a.hasTransparency
    ? r('bg-removed', false, '투명 배경이 없어요. 배경 제거를 먼저 하세요.')
    : a.specks > 0
      ? r('bg-removed', false, `잔여 픽셀 조각 ${a.specks}개가 남아 있어요. “잔여 픽셀 제거”를 켜세요.`)
      : a.whiteEdgeRatio > 0.25
        ? r('bg-removed', null, `경계의 ${Math.round(a.whiteEdgeRatio * 100)}%가 흰색이에요. 흰 테두리인지 확대해서 확인하세요(흰색 피사체면 정상).`)
        : r('bg-removed', true, '배경 투명, 잔여 픽셀 없음'))
  if (a.margins) {
    const long = Math.max(a.width, a.height)
    const m = a.margins
    const maxM = Math.max(m.top, m.right, m.bottom, m.left)
    const ok = maxM <= Math.max(2, long * CROP_MARGIN_MAX_RATIO)
    out.push(r('tight-crop', ok, `여백 상${m.top} 우${m.right} 하${m.bottom} 좌${m.left}px${ok ? '' : ' — “여백 없이 크롭”을 누르세요'}`))
  }
  out.push(a.objects > 1
    ? r('single-object', null, `분리된 덩어리가 ${a.objects}개 보여요. 서로 다른 피사체면 “가장 큰 덩어리만 남기기”로 분리하세요. 한 피사체의 떨어진 부속(예: 고양이 머리 위 하트)이면 확인 체크.`)
    : r('single-object', true, '덩어리 1개'))
  out.push(a.semiRatio > 0.2
    ? r('no-transparency', false, `반투명 픽셀이 ${Math.round(a.semiRatio * 100)}%예요. 투명도가 과해요.`)
    : r('no-transparency', true, `반투명 픽셀 ${Math.round(a.semiRatio * 100)}%`))
  return out
}

export async function videoDuration(blob: Blob): Promise<number | undefined> {
  const url = URL.createObjectURL(blob)
  try {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.src = url
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = rej })
    return v.duration
  } catch {
    return undefined
  } finally {
    URL.revokeObjectURL(url)
  }
}
