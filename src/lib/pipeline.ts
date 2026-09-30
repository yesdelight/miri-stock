// 화면 없이 도는 기본 다듬기 — "한 번에 여러 개 만들기"에서 사용.
// 작업대의 다듬기 단계(ElementProcess/BackgroundProcess)와 같은 기본값으로 처리한다. 결과가 이상하면 작업대에서 다시 조정.
import type { Item } from './db'
import {
  analyzeAlpha, blobToCanvas, cropToAspect, DEFAULT_BG_OPTIONS, dHash, downscaleLongSide, edgeContact, encodeJpeg, encodePng,
  removeBackground, thumbnail, tightCrop, upscaleLongSide,
} from './imaging'
import { ASPECTS, SPECS } from './rules'
import { DEFAULT_TRACE, svgToCanvas, traceToSvg } from './vectorize'

export async function autoProcess(item: Item, source: Blob): Promise<{ final: Blob; patch: Partial<Item> }> {
  const spec = SPECS[item.type]
  if (item.type === 'video') return { final: source, patch: { bytes: source.size } }

  if (item.type === 'background') {
    const a = ASPECTS.find((x) => x.id === item.aspect) ?? ASPECTS[0]
    let c = cropToAspect(await blobToCanvas(source), a.w, a.h, 0.5, 0.5)
    c = downscaleLongSide(upscaleLongSide(c, spec.minPx!), spec.maxPx!)
    const final = await encodeJpeg(c, spec.minDpi!)
    return { final, patch: { width: c.width, height: c.height, bytes: final.size, aspect: a.id } }
  }

  let c = await blobToCanvas(source)
  if (!analyzeAlpha(c).hasTransparency) c = removeBackground(c, DEFAULT_BG_OPTIONS)
  const edgeCut = edgeContact(c)
  c = tightCrop(c, 0)

  if (item.type === 'svg') {
    const { svg } = traceToSvg(c, DEFAULT_TRACE)
    const final = new Blob([svg], { type: 'image/svg+xml' })
    const f = DEFAULT_TRACE.outputSize / Math.max(c.width, c.height)
    return { final, patch: { edgeCut, width: Math.round(c.width * f), height: Math.round(c.height * f), bytes: final.size } }
  }

  const min = item.smallSize ? spec.minPxSmall! : spec.minPx!
  let out = c
  if (Math.max(c.width, c.height) < min) out = upscaleLongSide(c, min)
  out = downscaleLongSide(out, spec.maxPx!)
  const final = await encodePng(out, spec.minDpi!)
  return { final, patch: { edgeCut, width: out.width, height: out.height, bytes: final.size } }
}

/** 보관함 미리보기와 중복 검사용 dHash */
export async function thumbAndHash(item: Item, final: Blob): Promise<{ thumb?: Blob; dhash?: string }> {
  if (item.type === 'video') return {}
  const c = item.type === 'svg' ? await svgToCanvas(await final.text(), 600) : downscaleLongSide(await blobToCanvas(final), 600)
  return { thumb: await thumbnail(c), dhash: dHash(c) }
}
