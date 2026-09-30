import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AiRunner } from '../components/AiRunner'
import { toast } from '../components/toast'
import { StatusBadge, TypeBadge, useObjectUrl } from '../components/ui'
import { aiImage, blobToBase64, CHAT_URL, PROVIDER_LABEL } from '../lib/ai'
import { runAutoChecks, videoDuration } from '../lib/checks'
import { db, getBlob, nowIso, promptKey, putBlob, toMemoryBlob, uid, type CheckResult, type Item, type SavedPrompt } from '../lib/db'
import { driveConnected } from '../lib/drive'
import { uploadItemToDrive } from '../lib/driveItems'
import {
  analyzeAlpha, blobToCanvas, edgeContact, cropToAspect, DEFAULT_BG_OPTIONS, dHash, downscaleLongSide, encodeJpeg, encodePng,
  removeBackground, thumbnail, tightCrop, upscaleLongSide, type BgRemoveOptions,
} from '../lib/imaging'
import { imagePromptsRequest, metadataRequest, reviewRequest } from '../lib/prompts'
import { ASPECTS, GROUP_LABEL, PROMPT_RULES, rulesFor, SPECS, TYPE_FOLDER, TYPE_LABEL, type AspectId, type ElementType, type Rule } from '../lib/rules'
import { updateSettings, useSettings, type Provider } from '../lib/settings'
import { allRecords, sitePatch } from '../lib/sites'
import { copyText, downloadBlob, extractJson, fmtBytes, MB, safeFileName } from '../lib/utils'
import { DEFAULT_TRACE, svgToCanvas, traceToSvg, type TraceOptions } from '../lib/vectorize'

export interface WorkbenchStart {
  key: number
  itemId?: string
  topic?: string
  type?: ElementType
  planId?: string
  notes?: string
}

const STEPS = [
  { name: '기획', hint: '주제·타입 정하고 프롬프트 고르기' },
  { name: '이미지', hint: '생성하거나 파일 올리기' },
  { name: '다듬기', hint: '배경 제거·크롭·변환' },
  { name: '검수·저장', hint: '제목·키워드 정리하고 규칙 확인' },
] as const

const TYPE_INFO: Record<ElementType, { icon: string; desc: string }> = {
  svg: { icon: '✒️', desc: '색 5개 이하 단순한 플랫 그림. 색을 바꿀 수 있어 인기' },
  png: { icon: '🖼', desc: '3D·그라데이션·질감 있는 그림. 배경 투명' },
  background: { icon: '🌈', desc: '피사체 없는 그래픽·패턴. 16:9 등 비율 선택' },
  video: { icon: '🎬', desc: '30초 이내 MP4' },
}

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
  const [saveError, setSaveError] = useState('')
  const [moving, setMoving] = useState(false)
  // 이미 저장한 파일은 다시 쓰지 않음(큰 파일을 매 단계마다 다시 저장하지 않게)
  const savedSource = useRef<Blob | null>(null)
  const savedFinal = useRef<Blob | null>(null)
  const others = useLiveQuery(() => db.items.toArray(), []) ?? []
  // 단축키: ⌘/Ctrl+Enter 다음, ⌘/Ctrl+Shift+Enter 이전, ⌘/Ctrl+S 저장
  const keyRef = useRef<{ next?: () => void; prev?: () => void; save?: () => void }>({})
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === 'Enter') { e.preventDefault(); (e.shiftKey ? keyRef.current.prev : keyRef.current.next)?.() }
      else if (e.key === 's' || e.key === 'S' || e.key === 'ㄴ') { e.preventDefault(); keyRef.current.save?.() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!start.itemId) return
    ;(async () => {
      const it = await db.items.get(start.itemId!)
      if (!it) return
      const src = (await getBlob(it.id, 'source')) ?? null
      const fin = (await getBlob(it.id, 'final')) ?? null
      savedSource.current = src
      savedFinal.current = fin
      // 읽을 수 없는 파일 표시(예전 Safari 저장 문제)
      const lost: ('source' | 'final')[] = []
      if (!src && (it.fileLost?.includes('source') || it.bytes != null)) lost.push('source')
      if (!fin && (it.fileLost?.includes('final') || it.bytes != null)) lost.push('final')
      setItem({ ...it, fileLost: lost.length ? lost : undefined })
      setSource(src)
      setFinal(fin)
      setSaved(true)
      setStep(lost.length ? (src ? 2 : 1) : it.status === 'making' ? 2 : 3)
    })()
  }, [start.itemId])

  if (!item) return <p className="muted">불러오는 중…</p>
  const patch = (p: Partial<Item>) => setItem((i) => (i ? { ...i, ...p, updatedAt: nowIso() } : i))

  const save = async (extra: Partial<Item> = {}) => {
    const it = { ...item, ...extra, updatedAt: nowIso() }
    if (final && it.type !== 'video') {
      try {
        const c = it.type === 'svg' ? await svgToCanvas(await final.text(), 600) : downscaleLongSide(await blobToCanvas(final), 600)
        it.dhash = dHash(c)
        await putBlob(it.id, 'thumb', await thumbnail(c))
      } catch (e) {
        console.warn('미리보기 만들기 실패', e) // 저장은 계속
      }
    } else if (final && it.type === 'video') {
      await db.blobs.delete(`${it.id}:thumb`)
    }
    if (source && source !== savedSource.current) { await putBlob(it.id, 'source', source); savedSource.current = source }
    if (final && final !== savedFinal.current) { await putBlob(it.id, 'final', final); savedFinal.current = final }
    // 새 파일로 저장됐으면 '파일 없음' 표시 해제
    const lost = (it.fileLost ?? []).filter((k) => (k === 'source' ? !source : !final))
    it.fileLost = lost.length ? lost : undefined
    await db.items.put(it)
    setItem(it)
    setSaved(true)
    setSaveError('')
    return it
  }

  const trySave = async (extra: Partial<Item> = {}) => {
    try {
      return await save(extra)
    } catch (e) {
      console.error(e)
      const msg = (e as Error)?.message || String(e)
      setSaveError(msg)
      toast(`보관함에 저장하지 못했어요: ${msg}`, 'bad')
      return null
    }
  }

  // 아직 다시 만들지 않은 '읽을 수 없는 파일'
  const lostNow = (item.fileLost ?? []).filter((k) => (k === 'source' ? !source : !final))

  // 단계별 완료 조건 — 다음으로 넘어가기 전에 무엇이 필요한지
  const done = [
    item.title.trim() !== '' && !!item.prompt?.trim(),
    !!source,
    !!final,
    item.status !== 'making',
  ]
  const blocker = [
    !item.title.trim() ? '주제를 입력하세요' : '프롬프트를 입력하거나 골라 주세요',
    '이미지를 올리거나 생성하세요',
    '다듬기가 끝나야 해요',
    '',
  ][step]

  const goto = async (n: number) => {
    if (step === 0 && item.prompt && !item.promptLog.some((l) => l.prompt === item.prompt)) {
      patch({ promptLog: [...item.promptLog, { at: nowIso(), prompt: item.prompt, tool: 'manual' }] })
    }
    setMoving(true)
    // 저장이 실패해도 단계는 넘어가고, 위에 '저장 안 됨'과 이유를 보여줌(작업 내용은 화면에 그대로 있음)
    if (saved || source) await trySave()
    setMoving(false)
    setStep(n)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  keyRef.current = {
    next: () => { if (step < STEPS.length - 1 && done[step] && !moving) goto(step + 1) },
    prev: () => { if (step > 0 && !moving) goto(step - 1) },
    save: () => { trySave().then((r) => r && toast('저장했어요.')) },
  }

  return (
    <div className="col" style={{ gap: 14, paddingBottom: 70 }}>
      <div className="row between">
        <div className="row">
          <h1>{item.title || '새 요소 만들기'}</h1>
          <TypeBadge type={item.type} />
          <StatusBadge status={item.status} />
        </div>
        <div className="row">
          {saveError ? (
            <span className="row small" style={{ color: 'var(--bad)' }} title={saveError}>
              ⚠️ 저장 안 됨 <button className="small" onClick={() => trySave().then((r) => r && toast('저장했어요.'))}>다시 저장</button>
            </span>
          ) : (
            <span className="small muted">{saved ? '✓ 보관함에 자동 저장' : '이미지를 올리면 자동 저장돼요'}</span>
          )}
          <button className="small" onClick={() => openWork({})}>＋ 새로 시작</button>
        </div>
      </div>

      <ol className="stepper">
        {STEPS.map((s, i) => (
          <li key={s.name}>
            <button className={`${i === step ? 'active' : ''} ${done[i] ? 'done' : ''}`} disabled={moving} onClick={() => goto(i)}>
              <span className="dot">{done[i] && i !== step ? '✓' : i + 1}</span>
              <span className="lbl">{s.name}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="muted small" style={{ marginTop: -6 }}>{step + 1}단계 · {STEPS[step].hint}</p>
      {lostNow.length > 0 && (
        <div className="note bad small row between">
          <span>
            ⚠️ 저장돼 있던 {lostNow.includes('source') ? '원본 이미지' : '완성 파일'}를 읽을 수 없어요(예전 버전의 Safari 저장 문제).{' '}
            {lostNow.includes('source') ? '2단계에서 원본 파일을 다시 올려 주세요. 다운로드해 둔 파일이나 AI에서 받은 이미지를 쓰면 돼요.' : '3단계에서 “다시 처리”를 누르면 원본으로 다시 만들어져요.'}
          </span>
          {step !== (lostNow.includes('source') ? 1 : 2) && (
            <button className="small" onClick={() => goto(lostNow.includes('source') ? 1 : 2)}>{lostNow.includes('source') ? '2단계로' : '3단계로'} →</button>
          )}
        </div>
      )}

      {step === 0 && (
        <div className="col" style={{ gap: 14 }}>
          <PlanStep item={item} patch={patch} />
          {item.title.trim() ? <PromptStep item={item} patch={patch} others={others} /> : (
            <div className="card muted small" style={{ textAlign: 'center', padding: 24 }}>주제를 입력하면 여기서 프롬프트를 고를 수 있어요.</div>
          )}
        </div>
      )}
      {step === 1 && (
        <SourceStep item={item} source={source} onSource={(b) => { setSource(b); setFinal(null); toast('이미지를 받았어요. 다음 단계에서 자동으로 다듬어요.') }}
          onDirectFinal={(b) => { setSource(b); setFinal(b); setStep(item.type === 'video' ? 2 : 3); toast('파일을 받았어요.') }} />
      )}
      {step === 2 && <ProcessStep item={item} patch={patch} source={source} final={final} setFinal={setFinal} />}
      {step === 3 && (
        <div className="col" style={{ gap: 14 }}>
          <InfoStep item={item} patch={patch} />
          <ReviewStep item={item} patch={patch} final={final} others={others} save={trySave} openWork={openWork} goStep={goto} />
        </div>
      )}

      <div className="bottombar">
        <button onClick={() => goto(step - 1)} disabled={step === 0 || moving}>← 이전</button>
        <span className="small muted grow" style={{ textAlign: 'center' }}>{!done[step] && blocker}</span>
        {step < STEPS.length - 1 && (
          <button className="primary" onClick={() => goto(step + 1)} disabled={moving || !done[step]}>
            {moving ? '저장 중…' : `다음: ${STEPS[step + 1].name} →`}
          </button>
        )}
      </div>
    </div>
  )
}

// ---------- 1. 무엇을 ----------
function PlanStep({ item, patch }: { item: Item; patch: (p: Partial<Item>) => void }) {
  const plans = useLiveQuery(() => db.plans.where('kind').equals('task').toArray(), []) ?? []
  const open = plans.filter((p) => !p.done).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 8)
  const spec = SPECS[item.type]
  return (
    <div className="grid wb" style={{ gridTemplateColumns: 'minmax(0,1fr) 300px' }}>
      <div className="card col" style={{ gap: 14 }}>
        <label className="big">무엇을 만들까요?
          <input value={item.title} onChange={(e) => patch({ title: e.target.value, theme: e.target.value })} placeholder="예: 단풍잎, 크리스마스 양말, 파스텔 물결 배경" autoFocus />
        </label>
        <div className="col" style={{ gap: 6 }}>
          <span className="small muted">어떤 타입으로?</span>
          <div className="typecards">
            {(Object.keys(TYPE_LABEL) as ElementType[]).map((t) => (
              <button key={t} className={`typecard ${item.type === t ? 'on' : ''}`} onClick={() => patch({ type: t })}>
                <span className="ic">{TYPE_INFO[t].icon}</span>
                <b>{TYPE_LABEL[t]}</b>
                <span className="small muted">{TYPE_INFO[t].desc}</span>
              </button>
            ))}
          </div>
        </div>
        {item.type === 'png' && (
          <label className="inline"><input type="checkbox" checked={!!item.smallSize} onChange={(e) => patch({ smallSize: e.target.checked })} />작은 아이콘·이모티콘·캐릭터예요 (최소 700px, 아니면 1500px)</label>
        )}
        {item.type === 'background' && (
          <div className="col" style={{ gap: 6 }}>
            <span className="small muted">비율</span>
            <div className="row">
              {ASPECTS.map((a) => (
                <button key={a.id} className={`small ${item.aspect === a.id ? 'primary' : ''}`} title={a.note} onClick={() => patch({ aspect: a.id as AspectId })}>{a.id}</button>
              ))}
            </div>
            <span className="small muted">{ASPECTS.find((a) => a.id === item.aspect)?.note}</span>
          </div>
        )}
        <label>원하는 느낌 (선택)<input value={item.notes ?? ''} onChange={(e) => patch({ notes: e.target.value })} placeholder="예: 파스텔톤, 둥근 선, 귀여운 느낌" /></label>
        <div className="note small">
          📐 <b>{TYPE_LABEL[item.type]} 규격</b> · {spec.ext.toUpperCase()}
          {spec.minPx && ` · 최소 ${item.type === 'png' && item.smallSize ? spec.minPxSmall : spec.minPx}px`}
          {spec.maxPx && ` · 최대 ${spec.maxPx}px`}
          {spec.minDpi && ` · ${spec.minDpi}dpi`} · 최대 {spec.maxMB < 1 ? `${spec.maxMB * 1000}KB` : `${spec.maxMB}MB`}
          {spec.maxSeconds && ` · ${spec.maxSeconds}초 이내`} — 앱이 자동으로 맞춰요
        </div>
        {item.type === 'svg' && <div className="note info small">💡 3D·그라데이션·질감이 있으면 PNG로 만드세요. 같은 그림을 SVG·PNG 둘 다 올리면 안 돼요.</div>}
        {item.type === 'background' && <div className="note warn small">⚠️ 사람·동물·사물이 보이면 안 돼요. 추상 그래픽이나 패턴만 가능해요.</div>}
      </div>
      <div className="card col">
        <h3>📅 캘린더에 잡힌 작업</h3>
        {open.length === 0 && <p className="small muted">잡힌 작업이 없어요. 대시보드·캘린더에서 아이디어를 날짜에 넣으면 여기에 나와요.</p>}
        {open.map((p) => (
          <button key={p.id} className={`listbtn ${item.planId === p.id ? 'on' : ''}`} onClick={() => patch({ title: p.title, theme: p.title, planId: p.id, type: p.types[0] ?? item.type, notes: p.notes })}>
            <span className="small muted">{p.start.slice(5).replace('-', '/')}</span> {p.title} {p.types.slice(0, 1).map((t) => <TypeBadge key={t} type={t} />)}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------- 2. 프롬프트 ----------
function PromptStep({ item, patch, others }: { item: Item; patch: (p: Partial<Item>) => void; others: Item[] }) {
  const topic = (item.theme || item.title).trim()
  const key = promptKey(item.type, topic)
  // 이 주제·타입으로 받았던 추천 프롬프트 — 안 쓴 것부터
  const bank = useLiveQuery(() => db.promptBank.where('key').equals(key).toArray(), [key]) ?? []
  // 저장 안 하고 버린 작업이 고른 프롬프트는 '안 씀'으로 취급
  const usedBy = (sp: SavedPrompt) => (sp.usedBy && (sp.usedBy === item.id || others.some((o) => o.id === sp.usedBy)) ? sp.usedBy : undefined)
  const sorted = [...bank].sort((a, b) => Number(!!usedBy(a)) - Number(!!usedBy(b)) || b.createdAt.localeCompare(a.createdAt))
  const unused = bank.filter((b) => !usedBy(b)).length
  const previous = useMemo(
    () => [...others.filter((o) => o.id !== item.id && (o.theme === item.theme || o.type === item.type)).flatMap((o) => o.promptLog.map((l) => l.prompt)), ...bank.map((b) => b.prompt)],
    [others, item, bank],
  )
  const usedTitle = (id?: string) => (id === item.id ? '이 작업' : others.find((o) => o.id === id)?.title || '다른 요소')

  const saveSuggestions = async (text: string) => {
    const list = extractJson<{ prompt: string; memo?: string }[]>(text).filter((v) => v?.prompt)
    const have = new Set(bank.map((b) => b.prompt.trim()))
    const t = nowIso()
    await db.promptBank.bulkAdd(list.filter((v) => !have.has(v.prompt.trim())).map((v) => ({ id: uid(), key, topic, type: item.type, prompt: v.prompt.trim(), memo: v.memo, createdAt: t })))
  }

  const choose = async (sp: SavedPrompt) => {
    const u = usedBy(sp)
    if (u && u !== item.id && !confirm(`이 프롬프트는 “${usedTitle(u)}”에 이미 썼어요. 같은 프롬프트로 또 만들면 거부될 수 있어요. 그래도 쓸까요?`)) return
    // 이 작업이 전에 고른 프롬프트는 다시 '안 씀'으로
    await Promise.all(bank.filter((b) => b.usedBy === item.id && b.id !== sp.id).map((b) => db.promptBank.update(b.id, { usedBy: undefined })))
    await db.promptBank.update(sp.id, { usedBy: item.id })
    patch({ prompt: sp.prompt, promptLog: [...item.promptLog, { at: nowIso(), prompt: sp.prompt, tool: 'ai-suggested' }] })
    toast('이 프롬프트로 정했어요. 나머지는 보관돼서 다음에 쓸 수 있어요.')
  }

  return (
    <div className="grid wb" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
      <div className="card col">
        <h3>① 프롬프트 고르기</h3>
        <p className="small muted">
          “{topic || '주제'}” {TYPE_LABEL[item.type]}로 받은 추천이 여기 계속 보관돼요.
          {bank.length > 0 ? ` 안 쓴 프롬프트 ${unused}개 남음.` : ' 규칙이 자동으로 들어가고, 전에 쓴 것과 겹치지 않게 뽑아요.'}
        </p>
        <AiRunner primary={unused === 0} label={bank.length ? '4개 더 추천받기' : '프롬프트 4개 추천받기'} doneText="추천 프롬프트를 보관했어요. 마음에 드는 걸 고르세요."
          build={() => imagePromptsRequest({ topic, type: item.type, count: 4, previous, style: item.notes })}
          onResult={saveSuggestions} />
        {sorted.map((sp) => {
          const mine = item.prompt === sp.prompt
          const u = usedBy(sp)
          return (
            <div key={sp.id} className={`variant ${mine ? 'on' : ''} ${u && !mine ? 'used' : ''}`}>
              <button className="variant-body" onClick={() => choose(sp)}>
                <b className="small">
                  {mine ? '✓ 선택됨 · ' : u ? `사용함(${usedTitle(u)}) · ` : ''}{sp.memo || '추천 프롬프트'}
                </b>
                <span className="small mono">{sp.prompt}</span>
              </button>
              {!u && <button className="small ghost danger" title="이 추천 지우기" onClick={() => db.promptBank.delete(sp.id)}>🗑</button>}
            </div>
          )
        })}
      </div>
      <div className="card col">
        <h3>② 사용할 프롬프트</h3>
        <textarea rows={7} value={item.prompt ?? ''} onChange={(e) => patch({ prompt: e.target.value })} placeholder="왼쪽에서 고르거나 직접 써도 돼요 (영어 추천)" />
        <p className="small muted">🔒 쓴 프롬프트는 “직접 작성한 프롬프트” 증빙으로 자동 기록돼요.</p>
        {item.promptLog.length > 0 && (
          <details>
            <summary className="small">기록 {item.promptLog.length}개 보기</summary>
            <div className="col small">
              {item.promptLog.map((l, i) => <div key={i} className="muted">{l.at.slice(5, 16).replace('T', ' ')} — {l.prompt.slice(0, 100)}</div>)}
            </div>
          </details>
        )}
        <details>
          <summary className="small muted">자동으로 붙는 {TYPE_LABEL[item.type]} 규칙 보기</summary>
          <pre className="small pre">{PROMPT_RULES[item.type]}</pre>
        </details>
      </div>
    </div>
  )
}

// ---------- 3. 이미지 ----------
function SourceStep({ item, source, onSource, onDirectFinal }: {
  item: Item; source: Blob | null; onSource: (b: Blob) => void; onDirectFinal: (b: Blob) => void
}) {
  const s = useSettings()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const url = useObjectUrl(source)
  const inputRef = useRef<HTMLInputElement>(null)
  const fullPrompt = `${item.prompt ?? item.title}\n\n${PROMPT_RULES[item.type]}`

  const accept = item.type === 'video' ? 'video/mp4' : item.type === 'svg' ? 'image/*,.svg' : 'image/*'
  const take = async (file: File | Blob) => {
    setErr('')
    if (item.type === 'video' && !file.type.startsWith('video/')) return setErr('동영상 파일(MP4)을 올려 주세요.')
    if (item.type !== 'video' && !file.type.startsWith('image/')) return setErr('이미지 파일을 올려 주세요.')
    // 올린 파일은 바로 메모리로 복사해서 사용(Safari에서 파일 참조가 끊기는 문제 방지)
    const f = await toMemoryBlob(file)
    if (!f) return setErr('파일을 읽을 수 없어요. 파일을 다시 선택해 주세요.')
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
      onSource(await aiImage(fullPrompt, size))
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const sendTo = async (p: Provider) => {
    updateSettings({ manualChat: p })
    const ok = await copyText(fullPrompt)
    window.open(CHAT_URL[p], '_blank', 'noopener')
    toast(ok ? `복사했어요! ${PROVIDER_LABEL[p]}에 붙여넣고 그림을 만든 뒤, 다운로드해서 여기로 가져오세요.` : '복사가 막혔어요.', ok ? 'info' : 'bad')
  }

  return (
    <div className="grid wb" style={{ gridTemplateColumns: 'minmax(0,1fr) 320px' }}>
      <div className="card col">
        <div
          className={`canvasbox drop ${source ? '' : 'empty'}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) take(f) }}
          onClick={() => !source && inputRef.current?.click()}
        >
          {url ? (item.type === 'video' ? <video src={url} controls /> : <img src={url} alt="원본" />) : (
            <div style={{ textAlign: 'center', padding: 24 }}>
              <div style={{ fontSize: 36 }}>📥</div>
              <b>파일을 여기로 끌어놓기</b>
              <p className="small muted">또는 클릭해서 선택 · 복사한 이미지는 Ctrl/⌘+V</p>
            </div>
          )}
        </div>
        <input ref={inputRef} type="file" accept={accept} hidden onChange={(e) => e.target.files?.[0] && take(e.target.files[0])} />
        {source && <button className="small" style={{ alignSelf: 'flex-start' }} onClick={() => inputRef.current?.click()}>다른 파일로 바꾸기</button>}
        {err && <div className="note bad small">{err}</div>}
      </div>
      <div className="card col">
        {item.type === 'video' ? (
          <>
            <h3>동영상 만들기</h3>
            <p className="small">Sora·Veo 등에서 프롬프트로 만든 MP4를 왼쪽에 올리세요. 30초 이내, 120MB 이하.</p>
            <button className="small" onClick={() => copyText(fullPrompt).then(() => toast('프롬프트를 복사했어요.', 'info'))}>📋 프롬프트 복사</button>
          </>
        ) : (
          <>
            <h3>그림 만들기</h3>
            {s.imageProvider !== 'manual' ? (
              <button className="primary" onClick={generate} disabled={busy || !item.prompt}>
                {busy ? '⏳ 생성 중… (최대 1분)' : `🎨 ${s.imageProvider === 'openai' ? 'OpenAI' : 'Gemini'}로 바로 생성`}
              </button>
            ) : (
              <>
                <p className="small muted">① 버튼을 누르면 프롬프트가 복사되고 AI가 열려요 (이미 열려 있으면 “복사만”) → ② 붙여넣어 그림 생성 → ③ 그림을 다운로드해서 왼쪽에 끌어놓기</p>
                <button className="primary" onClick={() => sendTo(s.manualChat === 'claude' ? 'openai' : s.manualChat)}>
                  📋 복사하고 {PROVIDER_LABEL[s.manualChat === 'claude' ? 'openai' : s.manualChat]} 열기
                </button>
                <div className="row">
                  <button className="small" onClick={() => copyText(fullPrompt).then((ok) => toast(ok ? '복사했어요. 열려 있는 AI 창에 붙여넣으세요.' : '복사가 막혔어요.', ok ? 'info' : 'bad'))}>📋 복사만</button>
                  <button className="small" onClick={() => sendTo(s.manualChat === 'gemini' ? 'openai' : 'gemini')}>
                    {PROVIDER_LABEL[s.manualChat === 'gemini' ? 'openai' : 'gemini']}로 열기
                  </button>
                </div>
              </>
            )}
            <div className="note small">
              <b>잘 되는 팁</b>
              <ul style={{ paddingLeft: 18, margin: '4px 0 0' }}>
                <li>흰 배경 + 피사체 하나로 뽑기</li>
                <li>같은 프롬프트로 여러 장 올리면 거부돼요. 제일 좋은 1장만</li>
                {item.type === 'svg' && <li>이미 만든 .svg 파일도 올릴 수 있어요</li>}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ---------- 4. 다듬기 ----------
function ProcessStep({ item, patch, source, final, setFinal }: {
  item: Item; patch: (p: Partial<Item>) => void; source: Blob | null; final: Blob | null; setFinal: (b: Blob | null) => void
}) {
  if (!source) return <div className="card"><p className="muted">2단계에서 이미지를 먼저 올려 주세요.</p></div>
  if (item.type === 'video') return <VideoProcess item={item} patch={patch} final={final} />
  if (item.type === 'background') return <BackgroundProcess item={item} patch={patch} source={source} final={final} setFinal={setFinal} />
  return <ElementProcess item={item} patch={patch} source={source} final={final} setFinal={setFinal} />
}

const tick = () => new Promise((r) => setTimeout(r, 20))

function ElementProcess({ item, patch, source, final, setFinal }: {
  item: Item; patch: (p: Partial<Item>) => void; source: Blob; final: Blob | null; setFinal: (b: Blob | null) => void
}) {
  const [opt, setOpt] = useState<BgRemoveOptions>(DEFAULT_BG_OPTIONS)
  const [skipBg, setSkipBg] = useState<boolean | null>(null)
  // 여백: 피사체 긴 변 대비 % (규칙: 거의 없게 → 최대 1%)
  const [marginPct, setMarginPct] = useState(0)
  const [autoUp, setAutoUp] = useState(true)
  const [trace, setTrace] = useState<TraceOptions>(DEFAULT_TRACE)
  const [palette, setPalette] = useState<string[]>([])
  const [busy, setBusy] = useState('')
  const [info, setInfo] = useState<{ objects: number; specks: number; white: number } | null>(null)
  const [cut, setCut] = useState<HTMLCanvasElement | null>(null)
  const [showSrc, setShowSrc] = useState(false)
  const srcUrl = useObjectUrl(source)
  const finalUrl = useObjectUrl(final)
  const spec = SPECS[item.type]
  const isSvg = item.type === 'svg'

  const makePng = async (c: HTMLCanvasElement) => {
    const min = item.smallSize ? spec.minPxSmall! : spec.minPx!
    let out = c
    // 확대 후 다시 자르지 않음 — 다시 자르면 여백이 사라지고 최소 크기보다 작아짐
    if (autoUp && Math.max(c.width, c.height) < min) out = upscaleLongSide(c, min)
    out = downscaleLongSide(out, spec.maxPx!)
    const b = await encodePng(out, spec.minDpi!)
    setFinal(b)
    patch({ width: out.width, height: out.height, bytes: b.size })
  }

  const makeSvg = async (c: HTMLCanvasElement, lock?: string[]) => {
    const { svg, palette: pal } = traceToSvg(c, { ...trace, lockedPalette: lock })
    setPalette(pal.filter((c) => svg.includes(c))) // 실제로 쓰인 색만
    const b = new Blob([svg], { type: 'image/svg+xml' })
    setFinal(b)
    const f = trace.outputSize / Math.max(c.width, c.height)
    patch({ width: Math.round(c.width * f), height: Math.round(c.height * f), bytes: b.size })
  }

  const run = async (skip: boolean) => {
    setBusy(isSvg ? '배경 제거 → SVG 변환 중… (몇 초)' : '배경 제거·크롭 중…')
    await tick()
    try {
      let c = await blobToCanvas(source)
      if (!skip) c = removeBackground(c, opt)
      patch({ edgeCut: edgeContact(c) })
      c = tightCrop(c, 0)
      if (marginPct > 0) c = tightCrop(c, Math.round((Math.max(c.width, c.height) * marginPct) / 100))
      setCut(c)
      const a = analyzeAlpha(c)
      setInfo({ objects: a.objects, specks: a.specks, white: Math.round(a.whiteEdgeRatio * 100) })
      if (isSvg) await makeSvg(c)
      else await makePng(c)
    } finally { setBusy('') }
  }

  // 들어오면 기본값으로 바로 자동 처리
  useEffect(() => {
    blobToCanvas(source).then((c) => {
      const skip = analyzeAlpha(c).hasTransparency
      setSkipBg(skip)
      if (!final) run(skip)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  const retrace = async (lock?: string[]) => {
    if (!cut) return
    setBusy('SVG 다시 변환 중…'); await tick()
    try { await makeSvg(cut, lock) } finally { setBusy('') }
  }

  const num = (k: keyof BgRemoveOptions, min: number, max: number, label: string, help: string) => (
    <label title={help}>{label}: {opt[k] as number}<input type="range" min={min} max={max} value={opt[k] as number} onChange={(e) => setOpt({ ...opt, [k]: +e.target.value })} /></label>
  )
  const tnum = (k: keyof TraceOptions, min: number, max: number, step: number, label: string) => (
    <label>{label}: {trace[k] as number}<input type="range" min={min} max={max} step={step} value={trace[k] as number} onChange={(e) => setTrace({ ...trace, [k]: +e.target.value })} /></label>
  )
  const tooBig = isSvg && !!final && final.size > SPECS.svg.maxMB * MB

  return (
    <div className="grid wb" style={{ gridTemplateColumns: 'minmax(0,1fr) 320px' }}>
      <div className="card col">
        <div className="row between">
          <b>{busy ? `⏳ ${busy}` : final ? `✅ 완성된 ${isSvg ? 'SVG' : 'PNG'}` : '결과'}</b>
          <label className="inline small"><input type="checkbox" checked={showSrc} onChange={(e) => setShowSrc(e.target.checked)} />원본과 비교</label>
        </div>
        <div className={showSrc ? 'grid g2' : ''}>
          {showSrc && <div className="canvasbox"><img src={srcUrl} alt="원본" /></div>}
          <div className="canvasbox outline">
            {finalUrl ? <img src={finalUrl} alt="결과" /> : <span className="muted small">{busy || '처리 대기'}</span>}
          </div>
        </div>
        {final && (
          <div className="row">
            <span className="badge">{item.width}×{item.height}px</span>
            <span className={`badge ${tooBig ? 'bad' : ''}`}>{fmtBytes(final.size)}</span>
            {isSvg && <span className="badge">색 {palette.length}개</span>}
            {info && info.objects > 1 && <span className="badge warn">덩어리 {info.objects}개</span>}
            {info && info.white > 25 && <span className="badge warn">흰 테두리 의심</span>}
            {!!item.edgeCut?.length && <span className="badge warn">원본 {item.edgeCut.join('·')} 가장자리에 닿음</span>}
          </div>
        )}
        {!!item.edgeCut?.length && (
          <div className="note warn small">⚠️ 그림이 원본 이미지의 {item.edgeCut.join('·')} 끝에 닿아 있어요. 원래 그림이 잘려서 생성된 거라면 “불완전한 형태”로 거부될 수 있어요. 프롬프트에 “small even padding, fully inside the frame”이 들어가 있으니 다시 생성해 보세요.</div>
        )}
        {tooBig && <div className="note bad small">150KB를 넘었어요. 오른쪽 “세부 조정”에서 색상 수나 추적 해상도를 낮추고 다시 변환하세요.</div>}
        <p className="small muted">체크무늬 = 투명한 부분 · <b>빨간 점선 네모 = 저장되는 파일의 테두리</b>(그림과 점선 사이가 거의 붙어 있어야 규칙 통과)</p>
      </div>

      <div className="card col">
        <h3>결과가 이상하면</h3>
        <div className="col" style={{ gap: 6 }}>
          <button className="small listbtn" onClick={() => { setOpt({ ...opt, tolerance: Math.min(120, opt.tolerance + 20) }); }}>
            흰 배경이 덜 지워졌어요 → 허용 범위 올리기 ({opt.tolerance})
          </button>
          <button className="small listbtn" onClick={() => { setOpt({ ...opt, tolerance: Math.max(5, opt.tolerance - 15) }); }}>
            그림까지 지워졌어요 → 허용 범위 낮추기 ({opt.tolerance})
          </button>
          <button className={`small listbtn ${opt.shrink ? 'on' : ''}`} onClick={() => setOpt({ ...opt, shrink: opt.shrink ? 0 : 1 })}>
            가장자리에 흰 테두리가 보여요 → 1px 깎기 {opt.shrink ? '✓' : ''}
          </button>
          <button className={`small listbtn ${marginPct ? 'on' : ''}`} onClick={() => setMarginPct(marginPct ? 0 : 0.5)}>
            너무 꽉 끼어 보여요 → 여백 살짝 주기(0.5%) {marginPct ? '✓' : ''}
          </button>
          <button className={`small listbtn ${opt.keepLargestOnly ? 'on' : ''}`} onClick={() => setOpt({ ...opt, keepLargestOnly: !opt.keepLargestOnly })}>
            다른 조각이 같이 있어요 → 제일 큰 것만 남기기 {opt.keepLargestOnly ? '✓' : ''}
          </button>
          <button className={`small listbtn ${opt.removeEnclosed ? 'on' : ''}`} onClick={() => setOpt({ ...opt, removeEnclosed: !opt.removeEnclosed })}>
            안쪽 구멍(도넛 속 등)이 흰색이에요 → 투명하게 {opt.removeEnclosed ? '✓' : ''}
          </button>
        </div>
        <button className="primary" onClick={() => run(!!skipBg)} disabled={!!busy}>{busy ? '처리 중…' : '🔄 다시 처리'}</button>

        {isSvg && palette.length > 0 && (
          <div className="col" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <b className="small">🎨 색상 (눌러서 바꾸기)</b>
            <div className="row">
              {palette.map((c, i) => (
                <input key={i} type="color" value={c} style={{ width: 36, height: 30, padding: 2 }}
                  onChange={(e) => setPalette(palette.map((p, j) => (j === i ? e.target.value : p)))} />
              ))}
            </div>
            <button className="small" onClick={() => retrace(palette)} disabled={!!busy}>이 색으로 다시 변환</button>
          </div>
        )}

        <details>
          <summary className="small">⚙️ 세부 조정</summary>
          <div className="col" style={{ marginTop: 8 }}>
            <label className="inline"><input type="checkbox" checked={!!skipBg} onChange={(e) => setSkipBg(e.target.checked)} />이미 투명 배경 — 배경 제거 안 함</label>
            {num('tolerance', 5, 120, '배경 허용 범위', '높을수록 배경색과 비슷한 색까지 지워요')}
            {num('shrink', 0, 3, '경계 깎기(px)', '흰 테두리가 남을 때')}
            <label className="inline"><input type="checkbox" checked={opt.defringe} onChange={(e) => setOpt({ ...opt, defringe: e.target.checked })} />경계 부드럽게(흰 테두리 제거)</label>
            <label className="inline"><input type="checkbox" checked={opt.removeSpecks} onChange={(e) => setOpt({ ...opt, removeSpecks: e.target.checked })} />잔여 점 지우기</label>
            <label>여백 (피사체 크기 대비, 규칙상 최대 1%)
              <select value={marginPct} onChange={(e) => setMarginPct(+e.target.value)}>
                {[0, 0.25, 0.5, 0.75, 1].map((v) => <option key={v} value={v}>{v === 0 ? '없음(딱 맞게)' : `${v}%`}</option>)}
              </select>
            </label>
            {item.type === 'png' && <label className="inline"><input type="checkbox" checked={autoUp} onChange={(e) => setAutoUp(e.target.checked)} />최소 {item.smallSize ? spec.minPxSmall : spec.minPx}px까지 자동 확대</label>}
            {isSvg && (
              <>
                {tnum('colors', 1, 5, 1, '색상 수(최대 5)')}
                {tnum('traceSize', 300, 1600, 100, '추적 해상도(낮을수록 단순·가벼움)')}
                {tnum('pathomit', 0, 40, 1, '작은 조각 무시')}
                {tnum('precision', 0.2, 3, 0.1, '곡선 단순화')}
                {tnum('crackStroke', 0, 3, 0.5, '틈(크랙) 방지 선')}
                {tnum('outputSize', 500, 6000, 100, '출력 크기(px)')}
              </>
            )}
          </div>
        </details>
        {final && <button className="small ghost" onClick={() => downloadBlob(final, `${safeFileName(item.title)}.${SPECS[item.type].ext}`)}>⬇ 파일 다운로드</button>}
      </div>
    </div>
  )
}

function BackgroundProcess({ item, patch, source, final, setFinal }: {
  item: Item; patch: (p: Partial<Item>) => void; source: Blob; final: Blob | null; setFinal: (b: Blob | null) => void
}) {
  const [fx, setFx] = useState(0.5)
  const [fy, setFy] = useState(0.5)
  const [busy, setBusy] = useState(false)
  const finalUrl = useObjectUrl(final)
  const spec = SPECS.background
  const first = useRef(true)

  useEffect(() => {
    // 처음엔 결과가 있으면 그대로, 비율·위치를 바꾸면 자동 재처리
    if (first.current && final) { first.current = false; return }
    first.current = false
    let cancel = false
    const t = setTimeout(async () => {
      setBusy(true)
      try {
        const a = ASPECTS.find((x) => x.id === item.aspect) ?? ASPECTS[0]
        let c = cropToAspect(await blobToCanvas(source), a.w, a.h, fx, fy)
        c = downscaleLongSide(upscaleLongSide(c, spec.minPx!), spec.maxPx!)
        const b = await encodeJpeg(c, spec.minDpi!)
        if (cancel) return
        setFinal(b)
        patch({ width: c.width, height: c.height, bytes: b.size })
      } finally { if (!cancel) setBusy(false) }
    }, 250)
    return () => { cancel = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.aspect, fx, fy, source])

  return (
    <div className="grid wb" style={{ gridTemplateColumns: 'minmax(0,1fr) 300px' }}>
      <div className="card col">
        <b>{busy ? '⏳ 처리 중…' : '✅ 완성된 배경'}</b>
        <div className="canvasbox">{finalUrl ? <img src={finalUrl} alt="배경 결과" /> : <span className="muted small">처리 중…</span>}</div>
        {final && <div className="row"><span className="badge">{item.width}×{item.height}px</span><span className="badge">{fmtBytes(final.size)}</span><span className="badge">JPG 120dpi</span></div>}
      </div>
      <div className="card col">
        <span className="small muted">비율</span>
        <div className="row">
          {ASPECTS.map((a) => (
            <button key={a.id} className={`small ${item.aspect === a.id ? 'primary' : ''}`} title={a.note} onClick={() => patch({ aspect: a.id as AspectId })}>{a.id}</button>
          ))}
        </div>
        <label>자를 위치 (좌↔우)<input type="range" min={0} max={1} step={0.01} value={fx} onChange={(e) => setFx(+e.target.value)} /></label>
        <label>자를 위치 (위↕아래)<input type="range" min={0} max={1} step={0.01} value={fy} onChange={(e) => setFy(+e.target.value)} /></label>
        <p className="small muted">2500px보다 작으면 자동으로 키워요. 많이 흐려 보이면 Upscayl(무료) 같은 프로그램으로 키운 파일을 다시 올려도 돼요.</p>
        {final && <button className="small ghost" onClick={() => downloadBlob(final, `${safeFileName(item.title)}_${item.aspect?.replace(':', 'x')}.jpg`)}>⬇ 파일 다운로드</button>}
      </div>
    </div>
  )
}

function VideoProcess({ item, patch, final }: { item: Item; patch: (p: Partial<Item>) => void; final: Blob | null }) {
  const url = useObjectUrl(final)
  useEffect(() => {
    if (final) videoDuration(final).then((d) => patch({ durationSec: d, bytes: final.size }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [final])
  return (
    <div className="card col">
      <div className="canvasbox">{url && <video src={url} controls />}</div>
      <div className="row">
        {item.durationSec != null && <span className={`badge ${item.durationSec > 30 ? 'bad' : ''}`}>{item.durationSec.toFixed(1)}초</span>}
        <span className="badge">{fmtBytes(final?.size)}</span>
      </div>
      <p className="small muted">동영상은 따로 다듬을 게 없어요. 길이·용량만 검사해요.</p>
    </div>
  )
}

// ---------- 5. 제목·키워드 ----------
function InfoStep({ item, patch }: { item: Item; patch: (p: Partial<Item>) => void }) {
  const [kw, setKw] = useState('')
  const addKw = () => {
    if (!kw.trim()) return
    patch({ keywords: [...new Set([...item.keywords, ...kw.split(',').map((s) => s.trim()).filter(Boolean)])] })
    setKw('')
  }
  return (
    <div className="card col" style={{ maxWidth: 760, gap: 14 }}>
      <AiRunner primary label="제목·키워드 자동으로 만들기" doneText="제목과 키워드를 채웠어요."
        build={() => metadataRequest({ topic: item.theme || item.title, type: item.type, prompt: item.prompt })}
        onResult={(t) => { const j = extractJson<{ title: string; keywords: string[] }>(t); patch({ title: j.title, keywords: [...new Set(j.keywords.map((k) => k.trim()).filter(Boolean))] }) }} />
      <label className="big">제목<input value={item.title} onChange={(e) => patch({ title: e.target.value })} /></label>
      <div className="col" style={{ gap: 6 }}>
        <div className="row between">
          <span className="small muted">키워드 {item.keywords.length}개 <span className={item.keywords.length >= 20 ? '' : 'warn-text'}>(20~30개 권장)</span></span>
          {item.keywords.length > 0 && <button className="small" onClick={() => copyText(item.keywords.join(', ')).then(() => toast('키워드를 복사했어요. 업로드 화면에 붙여넣으세요.', 'info'))}>📋 전체 복사</button>}
        </div>
        <div className="row" style={{ gap: 4 }}>
          {item.keywords.map((k) => (
            <button key={k} className="chipbtn" onClick={() => patch({ keywords: item.keywords.filter((x) => x !== k) })} title="눌러서 삭제">{k} ✕</button>
          ))}
        </div>
        <div className="row">
          <input className="grow" placeholder="키워드 추가 (쉼표로 여러 개, Enter)" value={kw} onChange={(e) => setKw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addKw()} />
          <button className="small" onClick={addKw}>추가</button>
        </div>
      </div>
      <label>만든 AI 도구 (증빙용, 선택)<input value={item.aiTool ?? ''} onChange={(e) => patch({ aiTool: e.target.value })} placeholder="예: ChatGPT, Gemini" /></label>
    </div>
  )
}

// ---------- 6. 검수·저장 ----------
// 검수 항목 → 고치러 갈 단계(0부터)
const FIX_STEP: Record<string, number> = {
  spec: 2, 'tight-crop': 2, 'bg-removed': 2, 'single-object': 2, 'not-cut': 1, 'no-transparency': 2,
  'svg-colors': 2, 'svg-no-raster': 2, 'bg-rect': 2, 'own-prompt': 0, 'no-prompt-abuse': 0,
  'no-recolor': 1, 'one-format': 0,
}

function ReviewStep({ item, patch, final, others, save, openWork, goStep }: {
  item: Item; patch: (p: Partial<Item>) => void; final: Blob | null; others: Item[]; save: (p?: Partial<Item>) => Promise<Item | null>
  openWork: (s: Omit<WorkbenchStart, 'key'>) => void; goStep: (n: number) => void
}) {
  const { sites } = useSettings()
  const [running, setRunning] = useState(false)
  const [dhash, setDhash] = useState(item.dhash)
  const [reviewImg, setReviewImg] = useState<{ mime: string; base64: string } | null>(null)
  const url = useObjectUrl(final)
  const rules = rulesFor(item.type)
  const topic = (item.theme || item.title).trim()
  const leftPrompts = useLiveQuery(() => db.promptBank.where('key').equals(promptKey(item.type, topic)).filter((p) => !p.usedBy).count(), [item.type, topic]) ?? 0
  // 지금까지 거부된 이유 TOP 3 — 같은 실수 방지
  const topReasons = useMemo(() => {
    const m = new Map<string, number>()
    for (const { rec } of allRecords(others)) {
      const r = rec.status === 'rejected' ? rec.rejectReason?.trim() : ''
      if (r) m.set(r, (m.get(r) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  }, [others])

  const run = async () => {
    setRunning(true)
    try {
      if (!final) { patch({ autoChecks: [] }); return }
      let h = dhash
      if (final && item.type !== 'video') {
        const c = item.type === 'svg' ? await svgToCanvas(await final.text(), 600) : downscaleLongSide(await blobToCanvas(final), 600)
        h = dHash(c)
        setDhash(h)
      }
      const res = await runAutoChecks({
        itemId: item.id, type: item.type, file: final, aspect: item.aspect, smallSize: item.smallSize, prompt: item.prompt,
        promptLogCount: item.promptLog.length, title: item.title, keywords: item.keywords, dhash: h, others, durationSec: item.durationSec, edgeCut: item.edgeCut,
      })
      patch({ autoChecks: res, dhash: h })
    } catch (e) {
      // 예전 검사 결과를 그대로 보여주지 않고, 파일을 못 읽었다고 알림
      console.error(e)
      patch({ autoChecks: [{ ruleId: 'spec', ok: false, message: `최종 파일을 읽지 못했어요(${(e as Error)?.message || e}). 3단계 “다듬기”에서 다시 처리해 주세요.` }] })
    } finally { setRunning(false) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run() }, [final, item.title, item.keywords.length, item.prompt])

  useEffect(() => {
    if (!final || item.type === 'video') return
    ;(async () => {
      const c = item.type === 'svg' ? await svgToCanvas(await final.text(), 1024) : downscaleLongSide(await blobToCanvas(final), 1024)
      setReviewImg({ mime: 'image/png', base64: await blobToBase64(await encodePng(c, 72)) })
    })().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [final])

  const byRule = new Map<string, CheckResult>(item.autoChecks.map((c) => [c.ruleId, c]))
  const autoRules = rules.filter((r) => r.mode === 'auto')
  const humanRules = rules.filter((r) => r.mode !== 'auto')
  const failing = autoRules.filter((r) => byRule.get(r.id)?.ok === false)
  const warns = autoRules.filter((r) => byRule.get(r.id)?.ok === null && !item.manualChecks[`ack:${r.id}`])
  const passed = autoRules.filter((r) => byRule.get(r.id)?.ok === true || (byRule.get(r.id)?.ok === null && item.manualChecks[`ack:${r.id}`]))
  const unchecked = humanRules.filter((r) => !item.manualChecks[r.id])
  const pending = autoRules.filter((r) => !byRule.has(r.id) && !(r.id === 'no-prompt-abuse' && !item.prompt))
  const gateOk = !!final && failing.length === 0 && warns.length === 0 && unchecked.length === 0 && pending.length === 0 && item.title.trim() !== ''
  const total = autoRules.length + humanRules.length
  const okCount = passed.length + (humanRules.length - unchecked.length)
  const setChecks = (ids: string[], v: boolean) => patch({ manualChecks: { ...item.manualChecks, ...Object.fromEntries(ids.map((id) => [id, v])) } })

  const markReady = async () => {
    const it = await save({ status: 'ready', readyAt: nowIso() })
    if (!it) return
    toast('✅ 업로드 준비 완료로 저장했어요!')
    // Drive에 연결돼 있으면 최종 파일도 바로 Drive에 보관(앱 저장소가 사라져도 되살릴 수 있게)
    if (final && driveConnected()) {
      try {
        await uploadItemToDrive(it, final)
        const fresh = await db.items.get(it.id)
        patch({ driveFileId: fresh?.driveFileId, driveLink: fresh?.driveLink })
        toast(`☁️ Drive “${TYPE_FOLDER[item.type]}” 폴더에도 보관했어요.`, 'info')
      } catch (e) { console.warn('Drive 자동 보관 실패', e) }
    }
  }
  const markUploaded = async (siteId: string, name: string) => {
    const it = await save(sitePatch(item, siteId, 'uploaded'))
    if (!it) return
    if (it.planId) await db.plans.update(it.planId, { done: true })
    toast(`📤 ${name}에 오늘 올렸다고 기록했어요. 심사 결과는 보관함에서 바꿔 주세요.`)
  }
  const toDrive = async () => {
    if (!final) return
    toast('Drive에 올리는 중…', 'info')
    try {
      const it = await save()
      if (!it) return
      await uploadItemToDrive(it, final)
      const fresh = await db.items.get(it.id)
      patch({ driveFileId: fresh?.driveFileId, driveLink: fresh?.driveLink })
      toast(`☁️ Drive “${TYPE_FOLDER[item.type]}” 폴더에 저장했어요.`)
    } catch (e) { toast(`Drive 오류: ${(e as Error).message}`, 'bad') }
  }

  const autoRow = (r: Rule) => {
    const c = byRule.get(r.id)
    const cls = !c ? '' : c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'warn'
    return (
      <div key={r.id} className={`check ${cls}`}>
        <span>{!c ? '…' : c.ok === true ? '✅' : c.ok === false ? '❌' : '⚠️'}</span>
        <div>
          <div>{r.text}</div>
          {c && <div className="detail">{c.message}</div>}
          <div className="row" style={{ gap: 6, marginTop: 4 }}>
            {c?.ok === null && (
              <label className="inline small"><input type="checkbox" checked={!!item.manualChecks[`ack:${r.id}`]} onChange={(e) => setChecks([`ack:${r.id}`], e.target.checked)} />직접 봤는데 괜찮아요</label>
            )}
            {c && c.ok !== true && FIX_STEP[r.id] != null && (
              <button className="small" onClick={() => goStep(item.type === 'video' && r.id === 'spec' ? 1 : FIX_STEP[r.id])}>고치러 가기 →</button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid wb" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.2fr)' }}>
      <div className="col">
        <div className="card col">
          <div className="canvasbox outline" style={{ minHeight: 200 }}>
            {url && (item.type === 'video' ? <video src={url} controls /> : <img src={url} alt="최종 파일" />)}
            {!url && <span className="muted small">최종 파일이 없어요 — 3단계 “다듬기”를 먼저 하세요.</span>}
          </div>
          <div className="row between">
            <span className="small muted">{item.width && `${item.width}×${item.height}px · `}{fmtBytes(final?.size)}</span>
            <button className="small ghost" onClick={run} disabled={running}>{running ? '검사 중…' : '🔄 다시 검사'}</button>
          </div>
        </div>

        <div className={`card col gate ${gateOk ? 'ok' : ''}`}>
          <div className="row between">
            <h3 style={{ margin: 0 }}>{gateOk ? '🎉 업로드해도 돼요!' : '검수 진행'}</h3>
            <b>{okCount} / {total}</b>
          </div>
          <div className="bar"><span style={{ width: `${(okCount / total) * 100}%`, background: gateOk ? 'var(--ok)' : 'var(--accent)' }} /></div>
          {!gateOk && (
            <div className="small">
              {!final && <div>· 최종 파일이 없어요</div>}
              {failing.length > 0 && <div>· ❌ 고쳐야 할 것 {failing.length}개 (아래 자동 검수)</div>}
              {warns.length > 0 && <div>· ⚠️ 눈으로 확인할 것 {warns.length}개</div>}
              {unchecked.length > 0 && <div>· 👀 체크할 항목 {unchecked.length}개 (오른쪽)</div>}
            </div>
          )}
          {gateOk && <div className="note ok small">업로드할 때 <b>“생성형 AI로 만든 콘텐츠” 체크</b>를 꼭 하세요.</div>}
          <div className="row">
            <button className="primary" disabled={!gateOk} onClick={markReady}>✅ 업로드 준비 완료</button>
          </div>
          <div className="row" style={{ gap: 4 }}>
            <span className="small muted">📤 오늘 올린 곳</span>
            {sites.map((x) => {
              const done = !!item.sites?.[x.id]
              return (
                <button key={x.id} className="small" disabled={!gateOk || done} title={done ? `${x.name}에 이미 기록됨` : `${x.name}에 오늘 올렸다고 기록`}
                  onClick={() => markUploaded(x.id, x.short)}>{done ? '✓ ' : ''}{x.short}</button>
              )
            })}
          </div>
          <div className="row">
            <button className="small" disabled={!final} onClick={() => final && downloadBlob(final, `${safeFileName(item.title)}.${SPECS[item.type].ext}`)}>⬇ 다운로드</button>
            <button className="small" disabled={!final} onClick={toDrive}>☁️ Drive에 저장</button>
            <button className="small" onClick={() => copyText(item.keywords.join(', ')).then(() => toast('키워드 복사됨', 'info'))} disabled={!item.keywords.length}>📋 키워드 복사</button>
            {item.driveLink && <a href={item.driveLink} target="_blank" rel="noreferrer" className="small">Drive에서 보기 ↗</a>}
          </div>
        </div>

        {item.status !== 'making' && (
          <button className="next-card" onClick={() => openWork({ topic, type: item.type, notes: item.notes })}>
            <span className="nc-ic">🔁</span>
            <span className="col" style={{ gap: 2, alignItems: 'flex-start' }}>
              <b>같은 주제로 다음 거 만들기</b>
              <span className="small muted">“{topic}” {TYPE_LABEL[item.type]}{leftPrompts > 0 ? ` · 남은 추천 프롬프트 ${leftPrompts}개로 바로 시작` : ' · 새 프롬프트를 추천받아 시작'}</span>
            </span>
            <span className="nc-go">→</span>
          </button>
        )}

        {topReasons.length > 0 && (
          <div className="note warn small">
            <b>⚠️ 지금까지 자주 거부된 이유</b> — 올리기 전에 한 번 더 확인하세요
            <ol style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {topReasons.map(([r, n]) => <li key={r}>{r} <span className="muted">({n}번)</span></li>)}
            </ol>
          </div>
        )}

        <div className="card col">
          <h3>🤖 자동 검수</h3>
          <div className="checklist">
            {[...failing, ...autoRules.filter((r) => byRule.get(r.id)?.ok === null), ...pending].map(autoRow)}
          </div>
          {passed.filter((r) => byRule.get(r.id)?.ok === true).length > 0 && (
            <details>
              <summary className="small">✅ 통과 {passed.filter((r) => byRule.get(r.id)?.ok === true).length}개 보기</summary>
              <div className="checklist" style={{ marginTop: 6 }}>{autoRules.filter((r) => byRule.get(r.id)?.ok === true).map(autoRow)}</div>
            </details>
          )}
        </div>
      </div>

      <div className="card col">
        <div className="row between">
          <h3 style={{ margin: 0 }}>👀 눈으로 확인하기 <span className="muted small">({humanRules.length - unchecked.length}/{humanRules.length})</span></h3>
          {unchecked.length > 0 ? (
            <button className="small primary" onClick={() => {
              if (confirm(`아래 ${humanRules.length}개 규칙을 모두 직접 보고 확인했나요?\n(업로드 전 마지막 확인이에요. 위반이 있으면 거부될 수 있어요.)`)) setChecks(humanRules.map((r) => r.id), true)
            }}>✅ 전체 확인했어요</button>
          ) : (
            <button className="small ghost" onClick={() => setChecks(humanRules.map((r) => r.id), false)}>전체 해제</button>
          )}
        </div>
        <p className="small muted">AI가 먼저 봐 주고, 마지막 확인은 직접 해요. 규칙을 다 읽어 봤다면 “전체 확인했어요”로 한 번에, 아니면 묶음별 “모두 확인”이나 하나씩 체크해요.</p>
        {item.type !== 'video' && (
          <AiRunner label="AI에게 이미지 검수 맡기기" needsImage doneText="AI 검수 결과가 나왔어요."
            build={() => ({ ...reviewRequest(item.type), image: reviewImg ?? undefined })}
            disabled={!reviewImg}
            onResult={(t) => {
              const j = extractJson<{ results: { ruleId: string; ok: boolean; note: string }[]; issues: string[]; verdict: string; summary: string }>(t)
              const pass = j.verdict === 'pass' ? true : j.verdict === 'reject' ? false : null
              patch({ aiReview: { at: nowIso(), pass, text: `${j.summary}\n${j.results.map((r) => `${r.ok ? '✅' : '❌'} ${r.note}`).join('\n')}${j.issues?.length ? `\n결함: ${j.issues.join(', ')}` : ''}` } })
            }} />
        )}
        {item.aiReview && <div className={`note small pre ${item.aiReview.pass ? 'ok' : item.aiReview.pass === false ? 'bad' : 'warn'}`}>{item.aiReview.text}</div>}
        {(['ai-before', 'ai-upload', 'ai-reject', 'quality', 'legal', 'type'] as const).map((g) => {
          const list = humanRules.filter((r) => r.group === g)
          if (!list.length) return null
          const allOn = list.every((r) => item.manualChecks[r.id])
          return (
            <div key={g} className={`group ${allOn ? 'done' : ''}`}>
              <div className="row between">
                <b className="small">{allOn ? '✅ ' : ''}{GROUP_LABEL[g]} <span className="muted">({list.filter((r) => item.manualChecks[r.id]).length}/{list.length})</span></b>
                <button className="small ghost" onClick={() => setChecks(list.map((r) => r.id), !allOn)}>{allOn ? '해제' : '모두 확인'}</button>
              </div>
              {!allOn && list.map((r) => (
                <label key={r.id} className={`check ${item.manualChecks[r.id] ? 'ok' : ''}`} style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!item.manualChecks[r.id]} onChange={(e) => setChecks([r.id], e.target.checked)} />
                  <div style={{ color: 'var(--text)' }}>{r.text}{r.mode === 'ai' && <span className="badge accent" style={{ marginLeft: 6 }}>AI 검수</span>}{r.detail && <div className="detail">{r.detail}</div>}</div>
                </label>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
