import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AiRunner } from '../components/AiRunner'
import { StatusBadge, TypeBadge, TypePicker, useObjectUrl } from '../components/ui'
import { aiImage, blobToBase64, CHAT_URL, PROVIDER_LABEL } from '../lib/ai'
import { runAutoChecks, videoDuration } from '../lib/checks'
import { db, getBlob, nowIso, putBlob, uid, type CheckResult, type Item } from '../lib/db'
import { uploadFile } from '../lib/drive'
import {
  analyzeAlpha, blobToCanvas, cropToAspect, DEFAULT_BG_OPTIONS, dHash, downscaleLongSide, encodeJpeg, encodePng,
  removeBackground, thumbnail, tightCrop, upscaleLongSide, type BgRemoveOptions,
} from '../lib/imaging'
import { imagePromptsRequest, metadataRequest, reviewRequest } from '../lib/prompts'
import { ASPECTS, GROUP_LABEL, PROMPT_RULES, rulesFor, SPECS, TYPE_FOLDER, TYPE_LABEL, type AspectId, type ElementType } from '../lib/rules'
import { useSettings, type Provider } from '../lib/settings'
import { copyText, downloadBlob, extractJson, fmtBytes, safeFileName, ymd } from '../lib/utils'
import { DEFAULT_TRACE, svgToCanvas, traceToSvg, type TraceOptions } from '../lib/vectorize'

export interface WorkbenchStart {
  key: number
  itemId?: string
  topic?: string
  type?: ElementType
  planId?: string
  notes?: string
}

const STEPS = ['기획', '프롬프트', '이미지', '후가공', '정보', '검수·저장'] as const

function newItem(s: WorkbenchStart): Item {
  const t = nowIso()
  return {
    id: uid(), title: s.topic ?? '', theme: s.topic, type: s.type ?? 'svg', status: 'making', planId: s.planId,
    promptLog: [], keywords: [], autoChecks: [], manualChecks: {}, createdAt: t, updatedAt: t, aspect: '16:9',
    notes: s.notes,
  }
}

export function Workbench({ start, openWork }: { start: WorkbenchStart; openWork: (s: Omit<WorkbenchStart, 'key'>) => void }) {
  const [item, setItem] = useState<Item | null>(start.itemId ? null : newItem(start))
  const [step, setStep] = useState(0)
  const [source, setSource] = useState<Blob | null>(null)
  const [final, setFinal] = useState<Blob | null>(null)
  const [saved, setSaved] = useState(false)
  const others = useLiveQuery(() => db.items.toArray(), []) ?? []

  useEffect(() => {
    if (!start.itemId) return
    ;(async () => {
      const it = await db.items.get(start.itemId!)
      if (!it) return
      setItem(it)
      setSource((await getBlob(it.id, 'source')) ?? null)
      setFinal((await getBlob(it.id, 'final')) ?? null)
      setSaved(true)
      setStep(it.status === 'making' ? 3 : 5)
    })()
  }, [start.itemId])

  if (!item) return <p className="muted">불러오는 중…</p>
  const patch = (p: Partial<Item>) => setItem((i) => (i ? { ...i, ...p, updatedAt: nowIso() } : i))

  const save = async (extra: Partial<Item> = {}) => {
    const it = { ...item, ...extra, updatedAt: nowIso() }
    if (final && it.type !== 'video') {
      const c = it.type === 'svg' ? await svgToCanvas(await final.text(), 600) : downscaleLongSide(await blobToCanvas(final), 600)
      it.dhash = dHash(c)
      await putBlob(it.id, 'thumb', await thumbnail(c))
    } else if (final && it.type === 'video') {
      await db.blobs.delete(`${it.id}:thumb`)
    }
    if (source) await putBlob(it.id, 'source', source)
    if (final) await putBlob(it.id, 'final', final)
    await db.items.put(it)
    setItem(it)
    setSaved(true)
    return it
  }

  const goto = async (n: number) => {
    if (saved || source) await save()
    setStep(n)
  }

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row between">
        <div className="row">
          <h1>{item.title || '새 요소'}</h1>
          <TypeBadge type={item.type} />
          <StatusBadge status={item.status} />
        </div>
        <div className="row">
          <span className="small muted">{saved ? '보관함에 저장됨' : '아직 저장 안 됨'}</span>
          <button onClick={() => save()}>💾 저장</button>
          <button onClick={() => openWork({})}>+ 새 작업</button>
        </div>
      </div>
      <div className="steps">
        {STEPS.map((s, i) => (
          <button key={s} className={i === step ? 'active' : ''} onClick={() => goto(i)}>{i + 1}. {s}</button>
        ))}
      </div>

      {step === 0 && <PlanStep item={item} patch={patch} next={() => goto(1)} />}
      {step === 1 && <PromptStep item={item} patch={patch} others={others} next={() => goto(2)} />}
      {step === 2 && (
        <SourceStep item={item} source={source} onSource={(b) => { setSource(b); setFinal(null) }} next={() => goto(3)}
          onDirectFinal={(b) => { setSource(b); setFinal(b); setStep(item.type === 'video' ? 3 : 4) }} />
      )}
      {step === 3 && <ProcessStep item={item} patch={patch} source={source} final={final} setFinal={setFinal} next={() => goto(4)} />}
      {step === 4 && <InfoStep item={item} patch={patch} next={() => goto(5)} />}
      {step === 5 && <ReviewStep item={item} patch={patch} final={final} others={others} save={save} />}
    </div>
  )
}

// ---------- 1. 기획 ----------
function PlanStep({ item, patch, next }: { item: Item; patch: (p: Partial<Item>) => void; next: () => void }) {
  const plans = useLiveQuery(() => db.plans.where('kind').equals('task').toArray(), []) ?? []
  const open = plans.filter((p) => !p.done).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 12)
  const spec = SPECS[item.type]
  return (
    <div className="grid wb" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
      <div className="card col">
        <label>무엇을 만들까요? (주제)<input value={item.title} onChange={(e) => patch({ title: e.target.value, theme: e.target.value })} placeholder="예: 단풍잎, 크리스마스 양말, 파스텔 물결 배경" /></label>
        <label>타입</label>
        <TypePicker value={[item.type]} onChange={(v) => patch({ type: v[0] })} />
        {item.type === 'png' && (
          <label className="inline"><input type="checkbox" checked={!!item.smallSize} onChange={(e) => patch({ smallSize: e.target.checked })} />아이콘·이모티콘·캐릭터 사이즈 (최소 700px, 아니면 1500px)</label>
        )}
        {item.type === 'background' && (
          <label>비율
            <select value={item.aspect} onChange={(e) => patch({ aspect: e.target.value as AspectId })}>
              {ASPECTS.map((a) => <option key={a.id} value={a.id}>{a.id} — {a.note}</option>)}
            </select>
          </label>
        )}
        <label>메모 / 스타일<textarea rows={3} value={item.notes ?? ''} onChange={(e) => patch({ notes: e.target.value })} placeholder="예: 파스텔톤, 둥근 선, 귀여운 느낌" /></label>
        <div className="note small">
          <b>{TYPE_LABEL[item.type]} 규격</b> · {spec.ext.toUpperCase()}
          {spec.minPx && ` · 최소 ${item.type === 'png' && item.smallSize ? spec.minPxSmall : spec.minPx}px`}
          {spec.maxPx && ` · 최대 ${spec.maxPx}px`}
          {spec.minDpi && ` · ${spec.minDpi}dpi`} · 최대 {spec.maxMB < 1 ? `${spec.maxMB * 1000}KB` : `${spec.maxMB}MB`}
          {spec.maxSeconds && ` · ${spec.maxSeconds}초 이내`}
        </div>
        {item.type === 'svg' && <div className="note info small">SVG는 색 변경이 가능해서 수요가 높아요. 색 5개 이하·단순한 플랫 그림일 때만 가능 — 3D·그라데이션·질감이 있으면 PNG로 만드세요. 같은 디자인을 SVG/PNG 둘 다 올리면 안 돼요.</div>}
        {item.type === 'background' && <div className="note warn small">배경은 피사체(인물·동물·사물) 없는 그래픽/추상 또는 조화로운 패턴만. 실사 사진, 해변·실험실 같은 장면 일러스트는 거부돼요.</div>}
        <button className="primary" onClick={next} disabled={!item.title.trim()}>다음: 프롬프트 →</button>
      </div>
      <div className="card">
        <h3>캘린더에 잡힌 작업에서 고르기</h3>
        {open.length === 0 && <p className="small muted">잡힌 작업이 없어요.</p>}
        <div className="col">
          {open.map((p) => (
            <button key={p.id} style={{ textAlign: 'left' }} onClick={() => patch({ title: p.title, theme: p.title, planId: p.id, type: p.types[0] ?? item.type, notes: p.notes })}>
              <span className="small muted">{p.start.slice(5)}</span> {p.title} {p.types.map((t) => <TypeBadge key={t} type={t} />)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------- 2. 프롬프트 ----------
function PromptStep({ item, patch, others, next }: { item: Item; patch: (p: Partial<Item>) => void; others: Item[]; next: () => void }) {
  const [variants, setVariants] = useState<{ prompt: string; memo: string }[]>([])
  const [count, setCount] = useState(4)
  const previous = useMemo(() => others.filter((o) => o.id !== item.id && (o.theme === item.theme || o.type === item.type)).flatMap((o) => o.promptLog.map((l) => l.prompt)), [others, item])
  const s = useSettings()

  const use = (prompt: string, tool = 'manual') => {
    patch({ prompt, promptLog: [...item.promptLog, { at: nowIso(), prompt, tool }] })
  }

  return (
    <div className="grid wb" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
      <div className="card col">
        <h3>프롬프트 만들기</h3>
        <div className="row">
          <label className="inline small">개수<input type="number" min={1} max={10} value={count} onChange={(e) => setCount(+e.target.value)} style={{ width: 60 }} /></label>
        </div>
        <AiRunner primary label="서로 다른 프롬프트 뽑기"
          build={() => imagePromptsRequest({ topic: item.title, type: item.type, count, previous, style: item.notes })}
          onResult={(t) => setVariants(extractJson(t))} />
        {variants.map((v, i) => (
          <div key={i} className="note col" style={{ gap: 6 }}>
            <span className="small muted">{v.memo}</span>
            <span className="small" style={{ fontFamily: 'ui-monospace, monospace' }}>{v.prompt}</span>
            <div className="row"><button className="small primary" onClick={() => use(v.prompt, 'ai-suggested')}>이걸로 사용</button><button className="small" onClick={() => copyText(v.prompt)}>복사</button></div>
          </div>
        ))}
        <details>
          <summary className="small muted">자동으로 들어가는 {TYPE_LABEL[item.type]} 규칙</summary>
          <pre className="small pre">{PROMPT_RULES[item.type]}</pre>
        </details>
      </div>
      <div className="card col">
        <h3>사용할 프롬프트</h3>
        <textarea rows={7} value={item.prompt ?? ''} onChange={(e) => patch({ prompt: e.target.value })} placeholder="직접 써도 되고, 왼쪽에서 골라도 돼요. 이 기록이 '직접 작성한 프롬프트' 증빙으로 저장돼요." />
        <div className="row">
          <button className="small" onClick={() => item.prompt && use(item.prompt, 'edited')} disabled={!item.prompt}>기록에 추가</button>
          <button className="small" onClick={() => item.prompt && copyText(item.prompt)} disabled={!item.prompt}>📋 복사</button>
          {(['openai', 'gemini'] as Provider[]).map((p) => <a key={p} href={CHAT_URL[p]} target="_blank" rel="noreferrer"><button className="small">{PROVIDER_LABEL[p]}에서 생성 ↗</button></a>)}
        </div>
        <p className="small muted">이미지 생성: {s.imageProvider === 'manual' ? '수동(구독 계정에서 생성 후 다음 단계에서 파일 업로드)' : `${s.imageProvider === 'openai' ? 'OpenAI' : 'Gemini'} API — 다음 단계에서 바로 생성`}</p>
        {item.promptLog.length > 0 && (
          <details open>
            <summary className="small">프롬프트 기록 {item.promptLog.length}개 (증빙)</summary>
            <div className="col small">
              {item.promptLog.map((l, i) => <div key={i} className="muted">{l.at.slice(0, 16).replace('T', ' ')} · {l.tool} — {l.prompt.slice(0, 120)}</div>)}
            </div>
          </details>
        )}
        <button className="primary" onClick={() => { if (item.prompt && !item.promptLog.some((l) => l.prompt === item.prompt)) use(item.prompt, 'manual'); next() }}>다음: 이미지 →</button>
      </div>
    </div>
  )
}

// ---------- 3. 이미지 ----------
function SourceStep({ item, source, onSource, onDirectFinal, next }: {
  item: Item; source: Blob | null; onSource: (b: Blob) => void; onDirectFinal: (b: Blob) => void; next: () => void
}) {
  const s = useSettings()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const url = useObjectUrl(source)
  const inputRef = useRef<HTMLInputElement>(null)

  const accept = item.type === 'video' ? 'video/mp4' : item.type === 'svg' ? 'image/*,.svg' : 'image/*'
  const take = (f: File | Blob) => {
    setErr('')
    if (item.type === 'video' && !f.type.startsWith('video/')) return setErr('동영상 파일(MP4)을 올려 주세요.')
    if (item.type !== 'video' && !f.type.startsWith('image/')) return setErr('이미지 파일을 올려 주세요.')
    if (item.type === 'svg' && f.type === 'image/svg+xml') return onDirectFinal(f) // 이미 SVG면 벡터화 생략
    if (item.type === 'video') return onDirectFinal(f)
    onSource(f)
  }

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])][0]
      if (f) take(f)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  const generate = async () => {
    setBusy(true); setErr('')
    try {
      const a = ASPECTS.find((x) => x.id === item.aspect)
      const size = item.type === 'background' && a ? (a.w > a.h ? 'landscape' : a.w < a.h ? 'portrait' : 'square') : 'square'
      onSource(await aiImage(`${item.prompt}\n\n${PROMPT_RULES[item.type]}`, size))
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="grid wb" style={{ gridTemplateColumns: 'minmax(0,1fr) 320px' }}>
      <div className="card col">
        <div
          className="canvasbox"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) take(f) }}
          onClick={() => !source && inputRef.current?.click()}
          style={{ cursor: source ? 'default' : 'pointer' }}
        >
          {url ? (item.type === 'video' ? <video src={url} controls /> : <img src={url} alt="원본" />) : (
            <p className="muted" style={{ textAlign: 'center', padding: 24 }}>여기로 파일을 끌어놓거나 클릭해서 선택<br />또는 Ctrl/⌘+V로 붙여넣기</p>
          )}
        </div>
        <input ref={inputRef} type="file" accept={accept} hidden onChange={(e) => e.target.files?.[0] && take(e.target.files[0])} />
        <div className="row">
          <button onClick={() => inputRef.current?.click()}>📁 파일 선택</button>
          {item.type !== 'video' && s.imageProvider !== 'manual' && (
            <button className="primary" onClick={generate} disabled={busy || !item.prompt}>{busy ? '생성 중… (최대 1분)' : `🎨 ${s.imageProvider === 'openai' ? 'OpenAI' : 'Gemini'}로 생성`}</button>
          )}
        </div>
        {err && <div className="note bad small">{err}</div>}
      </div>
      <div className="card col">
        <h3>팁</h3>
        {item.type === 'video' ? (
          <p className="small">Sora·Veo 등으로 만든 MP4를 올리세요. 30초 이내, 120MB 이하. 프롬프트는 2단계에서 저장돼요.</p>
        ) : (
          <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
            <li>흰 배경 + 피사체 하나로 뽑아야 배경 제거가 깔끔해요.</li>
            <li>같은 프롬프트로 여러 장 뽑아 여러 개 올리면 “어뷰징” 거부 사유예요. 가장 좋은 1장만.</li>
            {item.type === 'svg' && <li>이미 Inkscape 등에서 만든 .svg 파일을 올리면 벡터화를 건너뛰고 바로 검수로 가요.</li>}
            <li>업로드한 원본은 보관함에 같이 저장돼요.</li>
          </ul>
        )}
        <button className="primary" onClick={next} disabled={!source}>다음: 후가공 →</button>
      </div>
    </div>
  )
}

// ---------- 4. 후가공 ----------
function ProcessStep({ item, patch, source, final, setFinal, next }: {
  item: Item; patch: (p: Partial<Item>) => void; source: Blob | null; final: Blob | null; setFinal: (b: Blob | null) => void; next: () => void
}) {
  if (!source) return <div className="card"><p className="muted">이미지 단계에서 파일을 먼저 올려 주세요.</p></div>
  if (item.type === 'video') return <VideoProcess item={item} patch={patch} final={final} next={next} />
  if (item.type === 'background') return <BackgroundProcess item={item} patch={patch} source={source} final={final} setFinal={setFinal} next={next} />
  return <ElementProcess item={item} patch={patch} source={source} final={final} setFinal={setFinal} next={next} />
}

function ElementProcess({ item, patch, source, final, setFinal, next }: {
  item: Item; patch: (p: Partial<Item>) => void; source: Blob; final: Blob | null; setFinal: (b: Blob | null) => void; next: () => void
}) {
  const [opt, setOpt] = useState<BgRemoveOptions>(DEFAULT_BG_OPTIONS)
  const [skipBg, setSkipBg] = useState(false)
  const [margin, setMargin] = useState(0)
  const [autoUp, setAutoUp] = useState(true)
  const [trace, setTrace] = useState<TraceOptions>(DEFAULT_TRACE)
  const [palette, setPalette] = useState<string[]>([])
  const [busy, setBusy] = useState('')
  const [info, setInfo] = useState('')
  const [cut, setCut] = useState<HTMLCanvasElement | null>(null)
  const [cutBlob, setCutBlob] = useState<Blob | null>(null)
  const cutUrl = useObjectUrl(cutBlob)
  const finalUrl = useObjectUrl(final)
  const spec = SPECS[item.type]

  useEffect(() => {
    // 이미 투명 배경 PNG면 배경 제거 생략 기본값
    blobToCanvas(source).then((c) => setSkipBg(analyzeAlpha(c).hasTransparency))
  }, [source])

  const runCut = async () => {
    setBusy('배경 제거·크롭 중…')
    await new Promise((r) => setTimeout(r, 20))
    try {
      let c = await blobToCanvas(source)
      if (!skipBg) c = removeBackground(c, opt)
      c = tightCrop(c, margin)
      setCut(c)
      setCutBlob(await encodePng(downscaleLongSide(c, 1400)))
      const a = analyzeAlpha(c)
      setInfo(`크롭 후 ${c.width}×${c.height}px · 덩어리 ${a.objects}개 · 잔여 조각 ${a.specks}개 · 흰 경계 ${Math.round(a.whiteEdgeRatio * 100)}%`)
      if (item.type === 'png') await makePng(c)
      else setPalette([])
    } finally { setBusy('') }
  }

  const makePng = async (c: HTMLCanvasElement) => {
    const min = item.smallSize ? spec.minPxSmall! : spec.minPx!
    let out = c
    if (autoUp && Math.max(c.width, c.height) < min) out = tightCrop(upscaleLongSide(c, min), 0)
    out = downscaleLongSide(out, spec.maxPx!)
    const b = await encodePng(out, spec.minDpi!)
    setFinal(b)
    patch({ width: out.width, height: out.height, bytes: b.size })
  }

  const runTrace = async (lock?: string[]) => {
    if (!cut) return
    setBusy('SVG로 변환 중… (몇 초 걸려요)')
    await new Promise((r) => setTimeout(r, 20))
    try {
      const { svg, palette: pal } = traceToSvg(cut, { ...trace, lockedPalette: lock })
      setPalette(pal)
      const b = new Blob([svg], { type: 'image/svg+xml' })
      setFinal(b)
      const f = trace.outputSize / Math.max(cut.width, cut.height)
      patch({ width: Math.round(cut.width * f), height: Math.round(cut.height * f), bytes: b.size })
    } finally { setBusy('') }
  }

  const num = (k: keyof BgRemoveOptions, min: number, max: number, label: string) => (
    <label>{label}: {opt[k] as number}<input type="range" min={min} max={max} value={opt[k] as number} onChange={(e) => setOpt({ ...opt, [k]: +e.target.value })} /></label>
  )
  const tnum = (k: keyof TraceOptions, min: number, max: number, step: number, label: string) => (
    <label>{label}: {trace[k] as number}<input type="range" min={min} max={max} step={step} value={trace[k] as number} onChange={(e) => setTrace({ ...trace, [k]: +e.target.value })} /></label>
  )

  return (
    <div className="grid wb" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px' }}>
      <div className="col">
        <div className="grid g2">
          <div className="card col">
            <b className="small">① 배경 제거 + 여백 없이 크롭</b>
            <div className="canvasbox outline">{cutUrl ? <img src={cutUrl} alt="배경 제거 결과" /> : <span className="muted small">오른쪽에서 “적용”</span>}</div>
            {info && <span className="small muted">{info}</span>}
          </div>
          <div className="card col">
            <b className="small">② 최종 {item.type === 'svg' ? 'SVG' : 'PNG'}</b>
            <div className="canvasbox outline">{finalUrl ? <img src={finalUrl} alt="최종 결과" /> : <span className="muted small">{item.type === 'svg' ? '“SVG 변환”을 누르세요' : '①을 적용하면 생성'}</span>}</div>
            {final && <span className="small muted">{item.width}×{item.height}px · {fmtBytes(final.size)} {item.type === 'svg' && final.size > 150_000 && <b style={{ color: 'var(--bad)' }}>— 150KB 초과! 추적 해상도를 낮추거나 노이즈 제거를 올리세요</b>}</span>}
          </div>
        </div>
        <p className="small muted">빨간 점선 = 이미지 경계. 점선과 그림 사이에 여백이 거의 없어야 해요. 체크무늬가 보이는 곳이 투명 영역이에요.</p>
      </div>

      <div className="card col">
        <label className="inline"><input type="checkbox" checked={skipBg} onChange={(e) => setSkipBg(e.target.checked)} />이미 투명 배경이라 배경 제거 생략</label>
        {!skipBg && (
          <>
            {num('tolerance', 5, 120, '배경 허용 범위')}
            {num('shrink', 0, 3, '경계 깎기(px)')}
            <label className="inline"><input type="checkbox" checked={opt.defringe} onChange={(e) => setOpt({ ...opt, defringe: e.target.checked })} />흰 테두리 제거(디프린지)</label>
            <label className="inline"><input type="checkbox" checked={opt.removeEnclosed} onChange={(e) => setOpt({ ...opt, removeEnclosed: e.target.checked })} />안쪽 배경색 구멍도 투명하게</label>
          </>
        )}
        <label className="inline"><input type="checkbox" checked={opt.removeSpecks} onChange={(e) => setOpt({ ...opt, removeSpecks: e.target.checked })} />잔여 픽셀 제거</label>
        <label className="inline"><input type="checkbox" checked={opt.keepLargestOnly} onChange={(e) => setOpt({ ...opt, keepLargestOnly: e.target.checked })} />가장 큰 덩어리만 남기기(단일 객체)</label>
        <label>크롭 여백(px): {margin}<input type="range" min={0} max={10} value={margin} onChange={(e) => setMargin(+e.target.value)} /></label>
        {item.type === 'png' && <label className="inline"><input type="checkbox" checked={autoUp} onChange={(e) => setAutoUp(e.target.checked)} />최소 해상도({item.smallSize ? spec.minPxSmall : spec.minPx}px)까지 자동 확대</label>}
        <button className="primary" onClick={runCut} disabled={!!busy}>{busy || '적용'}</button>

        {item.type === 'svg' && cut && (
          <div className="col" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <b className="small">SVG 변환 (색상 정리·크랙 방지)</b>
            {tnum('colors', 1, 5, 1, '색상 수(최대 5)')}
            {tnum('traceSize', 300, 1600, 100, '추적 해상도')}
            {tnum('pathomit', 0, 40, 1, '노이즈 제거')}
            {tnum('precision', 0.2, 3, 0.1, '곡선 단순화')}
            {tnum('crackStroke', 0, 3, 0.5, '크랙 방지 선 두께')}
            {tnum('outputSize', 500, 6000, 100, '출력 크기(px)')}
            <button className="primary" onClick={() => runTrace()} disabled={!!busy}>{busy || 'SVG 변환'}</button>
            {palette.length > 0 && (
              <div className="col">
                <span className="small muted">색상 잠금 — 색을 바꾸고 “이 팔레트로 다시 변환”</span>
                <div className="row">
                  {palette.map((c, i) => (
                    <input key={i} type="color" value={c} style={{ width: 36, height: 30, padding: 2 }}
                      onChange={(e) => setPalette(palette.map((p, j) => (j === i ? e.target.value : p)))} />
                  ))}
                </div>
                <button className="small" onClick={() => runTrace(palette)} disabled={!!busy}>이 팔레트로 다시 변환</button>
              </div>
            )}
          </div>
        )}
        {final && (
          <div className="row">
            <button onClick={() => downloadBlob(final, `${safeFileName(item.title)}.${SPECS[item.type].ext}`)}>⬇ 다운로드</button>
            <button className="primary" onClick={next}>다음: 정보 →</button>
          </div>
        )}
      </div>
    </div>
  )
}

function BackgroundProcess({ item, patch, source, final, setFinal, next }: {
  item: Item; patch: (p: Partial<Item>) => void; source: Blob; final: Blob | null; setFinal: (b: Blob | null) => void; next: () => void
}) {
  const [fx, setFx] = useState(0.5)
  const [fy, setFy] = useState(0.5)
  const [busy, setBusy] = useState(false)
  const finalUrl = useObjectUrl(final)
  const spec = SPECS.background
  const run = async () => {
    setBusy(true)
    try {
      const a = ASPECTS.find((x) => x.id === item.aspect) ?? ASPECTS[0]
      let c = cropToAspect(await blobToCanvas(source), a.w, a.h, fx, fy)
      c = downscaleLongSide(upscaleLongSide(c, spec.minPx!), spec.maxPx!)
      const b = await encodeJpeg(c, spec.minDpi!)
      setFinal(b)
      patch({ width: c.width, height: c.height, bytes: b.size })
    } finally { setBusy(false) }
  }
  return (
    <div className="grid wb" style={{ gridTemplateColumns: 'minmax(0,1fr) 320px' }}>
      <div className="card col">
        <div className="canvasbox">{finalUrl ? <img src={finalUrl} alt="배경 결과" /> : <span className="muted small">오른쪽에서 “적용”</span>}</div>
        {final && <span className="small muted">{item.width}×{item.height}px · {fmtBytes(final.size)} · JPG 120dpi</span>}
      </div>
      <div className="card col">
        <label>비율
          <select value={item.aspect} onChange={(e) => patch({ aspect: e.target.value as AspectId })}>
            {ASPECTS.map((a) => <option key={a.id} value={a.id}>{a.id} — {a.note}</option>)}
          </select>
        </label>
        <label>가로 위치: {Math.round(fx * 100)}%<input type="range" min={0} max={1} step={0.01} value={fx} onChange={(e) => setFx(+e.target.value)} /></label>
        <label>세로 위치: {Math.round(fy * 100)}%<input type="range" min={0} max={1} step={0.01} value={fy} onChange={(e) => setFy(+e.target.value)} /></label>
        <p className="small muted">긴 변 {spec.minPx}px 미만이면 자동 확대돼요. AI 원본(1~1.5K)을 크게 늘리면 흐려질 수 있어요 — 패턴·추상 배경은 대체로 괜찮지만, 필요하면 Upscayl(무료) 같은 업스케일러로 키운 파일을 다시 올리세요.</p>
        <button className="primary" onClick={run} disabled={busy}>{busy ? '처리 중…' : '적용'}</button>
        {final && (
          <div className="row">
            <button onClick={() => downloadBlob(final, `${safeFileName(item.title)}_${item.aspect?.replace(':', 'x')}.jpg`)}>⬇ 다운로드</button>
            <button className="primary" onClick={next}>다음: 정보 →</button>
          </div>
        )}
      </div>
    </div>
  )
}

function VideoProcess({ item, patch, final, next }: { item: Item; patch: (p: Partial<Item>) => void; final: Blob | null; next: () => void }) {
  const url = useObjectUrl(final)
  useEffect(() => {
    if (final) videoDuration(final).then((d) => patch({ durationSec: d, bytes: final.size }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [final])
  return (
    <div className="card col">
      <div className="canvasbox">{url && <video src={url} controls />}</div>
      <span className="small muted">{item.durationSec != null && `${item.durationSec.toFixed(1)}초 · `}{fmtBytes(final?.size)}</span>
      <p className="small muted">동영상은 편집 기능이 없어요. 길이·용량만 검수해요.</p>
      <button className="primary" onClick={next} disabled={!final}>다음: 정보 →</button>
    </div>
  )
}

// ---------- 5. 정보 ----------
function InfoStep({ item, patch, next }: { item: Item; patch: (p: Partial<Item>) => void; next: () => void }) {
  const [kw, setKw] = useState('')
  return (
    <div className="card col" style={{ maxWidth: 760 }}>
      <AiRunner label="제목·키워드 만들기" build={() => metadataRequest({ topic: item.theme || item.title, type: item.type, prompt: item.prompt })}
        onResult={(t) => { const j = extractJson<{ title: string; keywords: string[] }>(t); patch({ title: j.title, keywords: [...new Set(j.keywords.map((k) => k.trim()).filter(Boolean))] }) }} />
      <label>제목<input value={item.title} onChange={(e) => patch({ title: e.target.value })} /></label>
      <label>키워드 ({item.keywords.length}개)</label>
      <div className="row">
        {item.keywords.map((k) => (
          <span key={k} className="badge">{k}<button className="ghost small" style={{ padding: 0 }} onClick={() => patch({ keywords: item.keywords.filter((x) => x !== k) })} aria-label={`${k} 삭제`}>✕</button></span>
        ))}
      </div>
      <div className="row">
        <input className="grow" placeholder="키워드 추가 (쉼표로 여러 개)" value={kw} onChange={(e) => setKw(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && kw.trim()) { patch({ keywords: [...new Set([...item.keywords, ...kw.split(',').map((s) => s.trim()).filter(Boolean)])] }); setKw('') } }} />
        <button className="small" onClick={() => copyText(item.keywords.join(', '))}>📋 키워드 복사</button>
      </div>
      <label>AI 도구(증빙용)<input value={item.aiTool ?? ''} onChange={(e) => patch({ aiTool: e.target.value })} placeholder="예: ChatGPT(GPT-image), Gemini, Midjourney" /></label>
      <button className="primary" onClick={next}>다음: 검수·저장 →</button>
    </div>
  )
}

// ---------- 6. 검수·저장 ----------
function ReviewStep({ item, patch, final, others, save }: {
  item: Item; patch: (p: Partial<Item>) => void; final: Blob | null; others: Item[]; save: (p?: Partial<Item>) => Promise<Item>
}) {
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState('')
  const [dhash, setDhash] = useState(item.dhash)
  const url = useObjectUrl(final)
  const rules = rulesFor(item.type)

  const run = async () => {
    setRunning(true)
    try {
      let h = dhash
      if (final && item.type !== 'video') {
        const c = item.type === 'svg' ? await svgToCanvas(await final.text(), 600) : downscaleLongSide(await blobToCanvas(final), 600)
        h = dHash(c)
        setDhash(h)
      }
      const res = await runAutoChecks({
        itemId: item.id, type: item.type, file: final, aspect: item.aspect, smallSize: item.smallSize, prompt: item.prompt,
        promptLogCount: item.promptLog.length, title: item.title, keywords: item.keywords, dhash: h, others, durationSec: item.durationSec,
      })
      patch({ autoChecks: res, dhash: h })
    } finally { setRunning(false) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run() }, [final, item.title, item.keywords.length, item.prompt])

  const byRule = new Map<string, CheckResult>(item.autoChecks.map((c) => [c.ruleId, c]))
  const autoRules = rules.filter((r) => r.mode === 'auto')
  const humanRules = rules.filter((r) => r.mode !== 'auto')
  const failing = autoRules.filter((r) => byRule.get(r.id)?.ok === false)
  const warns = autoRules.filter((r) => byRule.get(r.id)?.ok === null && !item.manualChecks[`ack:${r.id}`])
  const unchecked = humanRules.filter((r) => !item.manualChecks[r.id])
  const pending = autoRules.filter((r) => !byRule.has(r.id) && !(r.id === 'no-prompt-abuse' && !item.prompt))
  const gateOk = !!final && failing.length === 0 && warns.length === 0 && unchecked.length === 0 && pending.length === 0 && item.title.trim() !== ''
  const tick = (id: string, v: boolean) => patch({ manualChecks: { ...item.manualChecks, [id]: v } })

  const aiReviewImage = async () => {
    if (!final) throw new Error('최종 파일이 없어요.')
    const c = item.type === 'svg' ? await svgToCanvas(await final.text(), 1024) : downscaleLongSide(await blobToCanvas(final), 1024)
    return { mime: 'image/png', base64: await blobToBase64(await encodePng(c, 72)) }
  }
  const [reviewImg, setReviewImg] = useState<{ mime: string; base64: string } | null>(null)
  useEffect(() => { if (final && item.type !== 'video') aiReviewImage().then(setReviewImg).catch(() => {}) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [final])

  const markReady = async () => { await save({ status: 'ready', readyAt: nowIso() }); setMsg('업로드 대기로 저장했어요. 미리캔버스에 올린 뒤 “업로드했어요”를 누르세요.') }
  const markUploaded = async () => {
    const it = await save({ status: 'uploaded', uploadedAt: ymd() })
    if (it.planId) await db.plans.update(it.planId, { done: true })
    setMsg('오늘 업로드로 기록했어요. 심사 결과가 나오면 보관함에서 판매 중/거부로 바꾸세요.')
  }
  const toDrive = async () => {
    if (!final) return
    setMsg('Drive에 올리는 중…')
    try {
      const name = `${safeFileName(item.title)}_${item.id.slice(0, 6)}.${SPECS[item.type].ext}`
      const r = await uploadFile(final, name, [TYPE_FOLDER[item.type], ymd().slice(0, 7)], item.driveFileId)
      await save({ driveFileId: r.id, driveLink: r.webViewLink })
      setMsg('Drive에 저장했어요.')
    } catch (e) { setMsg(`Drive 오류: ${(e as Error).message}`) }
  }

  return (
    <div className="grid wb" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
      <div className="col">
        <div className="card col">
          <div className="canvasbox outline" style={{ minHeight: 200 }}>
            {url && (item.type === 'video' ? <video src={url} controls /> : <img src={url} alt="최종 파일" />)}
            {!url && <span className="muted small">최종 파일이 없어요 — 후가공 단계를 먼저 하세요.</span>}
          </div>
          <div className="row between">
            <span className="small muted">{item.width && `${item.width}×${item.height}px · `}{fmtBytes(final?.size)}</span>
            <button className="small" onClick={run} disabled={running}>{running ? '검사 중…' : '다시 검사'}</button>
          </div>
        </div>
        <div className="card col">
          <h3>🤖 자동 검수</h3>
          <div className="checklist">
            {autoRules.map((r) => {
              const c = byRule.get(r.id)
              const cls = !c ? '' : c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'warn'
              return (
                <div key={r.id} className={`check ${cls}`}>
                  <span>{!c ? '…' : c.ok === true ? '✅' : c.ok === false ? '❌' : '⚠️'}</span>
                  <div>
                    <div>{r.text}</div>
                    {c && <div className="detail">{c.message}</div>}
                    {c?.ok === null && (
                      <label className="inline small"><input type="checkbox" checked={!!item.manualChecks[`ack:${r.id}`]} onChange={(e) => tick(`ack:${r.id}`, e.target.checked)} />직접 확인했고 문제없음</label>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="col">
        <div className="card col">
          <h3>👀 직접 확인 (모두 체크해야 업로드 준비 완료)</h3>
          {item.type !== 'video' && (
            <AiRunner label="AI 비전 검수" needsImage build={() => ({ ...reviewRequest(item.type), image: reviewImg ?? undefined })}
              disabled={!reviewImg}
              onResult={(t) => {
                const j = extractJson<{ results: { ruleId: string; ok: boolean; note: string }[]; issues: string[]; verdict: string; summary: string }>(t)
                const pass = j.verdict === 'pass' ? true : j.verdict === 'reject' ? false : null
                patch({ aiReview: { at: nowIso(), pass, text: `${j.summary}\n${j.results.map((r) => `${r.ok ? '✅' : '❌'} [${r.ruleId}] ${r.note}`).join('\n')}${j.issues?.length ? `\n결함: ${j.issues.join(', ')}` : ''}` } })
              }} />
          )}
          {item.aiReview && <div className={`note small pre ${item.aiReview.pass ? 'ok' : item.aiReview.pass === false ? 'bad' : 'warn'}`}>{item.aiReview.text}</div>}
          {(['ai-before', 'ai-upload', 'ai-reject', 'quality', 'legal', 'type'] as const).map((g) => {
            const list = humanRules.filter((r) => r.group === g)
            if (!list.length) return null
            return (
              <div key={g} className="col" style={{ gap: 4 }}>
                <b className="small muted">{GROUP_LABEL[g]}</b>
                {list.map((r) => (
                  <label key={r.id} className={`check ${item.manualChecks[r.id] ? 'ok' : ''}`} style={{ cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!item.manualChecks[r.id]} onChange={(e) => tick(r.id, e.target.checked)} />
                    <div style={{ color: 'var(--text)' }}>{r.text}{r.mode === 'ai' && <span className="badge accent" style={{ marginLeft: 6 }}>AI 검수 대상</span>}{r.detail && <div className="detail">{r.detail}</div>}</div>
                  </label>
                ))}
              </div>
            )
          })}
        </div>

        <div className="card col">
          <h3>저장·업로드</h3>
          {!gateOk && (
            <div className="note warn small">
              아직 업로드하면 안 돼요:
              {!final && <div>· 최종 파일 없음</div>}
              {!item.title.trim() && <div>· 제목 없음</div>}
              {failing.map((r) => <div key={r.id}>· ❌ {r.text}</div>)}
              {warns.map((r) => <div key={r.id}>· ⚠️ {r.text} (직접 확인 체크 필요)</div>)}
              {pending.map((r) => <div key={r.id}>· 검사 대기: {r.text}</div>)}
              {unchecked.length > 0 && <div>· 직접 확인 {unchecked.length}개 남음</div>}
            </div>
          )}
          {gateOk && <div className="note ok small">모든 규칙 통과! 업로드할 때 “생성형 AI로 만든 콘텐츠” 체크를 잊지 마세요.</div>}
          <div className="row">
            <button onClick={() => save()}>💾 제작 중으로 저장</button>
            <button className="primary" disabled={!gateOk} onClick={markReady}>✅ 업로드 준비 완료</button>
            <button disabled={!gateOk} onClick={markUploaded}>📤 업로드했어요(오늘)</button>
          </div>
          <div className="row">
            <button disabled={!final} onClick={() => final && downloadBlob(final, `${safeFileName(item.title)}.${SPECS[item.type].ext}`)}>⬇ 파일 다운로드</button>
            <button disabled={!final} onClick={toDrive}>☁️ Drive에 저장</button>
            {item.driveLink && <a href={item.driveLink} target="_blank" rel="noreferrer" className="small">Drive에서 보기 ↗</a>}
          </div>
          {msg && <div className="note info small">{msg}</div>}
        </div>
      </div>
    </div>
  )
}
