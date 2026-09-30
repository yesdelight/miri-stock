// 한 번에 여러 개 만들기: 주제 하나 → 서로 다른 프롬프트 N개 → 이미지 N장(API 자동 또는 구독 계정에서 만들어 한꺼번에 올리기)
// → 자동 다듬기·저장 → 제목·키워드 → 자동 검수 → 검수 대기 줄. "업로드 준비 완료"는 여전히 작업대에서 하나씩(사람이 최종 확인).
import { useLiveQuery } from 'dexie-react-hooks'
import { Layers, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { AiRunner } from '../components/AiRunner'
import { toast } from '../components/toast'
import { TypeBadge, useObjectUrl } from '../components/ui'
import { aiImage, aiText, CHAT_URL, isLimitError, PROVIDER_LABEL } from '../lib/ai'
import { runAutoChecks } from '../lib/checks'
import { db, deleteItem, getBlob, nowIso, promptKey, putBlob, toMemoryBlob, uid, type Item } from '../lib/db'
import { autoProcess, thumbAndHash } from '../lib/pipeline'
import { batchMetadataRequest, imagePromptsRequest } from '../lib/prompts'
import { ASPECTS, PROMPT_RULES, TYPE_LABEL, type AspectId, type ElementType } from '../lib/rules'
import { hasTextApi, updateSettings, useSettings } from '../lib/settings'
import { copyText, extractJson } from '../lib/utils'
import type { WorkbenchStart } from './Workbench'

type BatchType = Exclude<ElementType, 'video'>
const TYPES: BatchType[] = ['svg', 'png', 'background']

interface Row { id: string; prompt: string; memo?: string; source?: Blob; tool?: string; state: 'wait' | 'gen' | 'ok' | 'err'; err?: string }

export function Batch({ openWork }: { openWork: (s: Omit<WorkbenchStart, 'key'>) => void }) {
  const s = useSettings()
  const [topic, setTopic] = useState('')
  const [type, setType] = useState<BatchType>('svg')
  const [count, setCount] = useState(4)
  const [style, setStyle] = useState('')
  const [aspect, setAspect] = useState<AspectId>('16:9')
  const [smallSize, setSmallSize] = useState(false)
  const [planId, setPlanId] = useState<string | undefined>()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState('')
  const [limitHit, setLimitHit] = useState('')
  const [madeIds, setMadeIds] = useState<string[]>([])
  const [needMeta, setNeedMeta] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const promptOf = useRef(new Map<string, string>())

  const key = promptKey(type, topic.trim())
  const bank = useLiveQuery(() => (topic.trim() ? db.promptBank.where('key').equals(key).toArray() : []), [key]) ?? []
  const items = useLiveQuery(() => db.items.toArray(), []) ?? []
  const tasks = useLiveQuery(() => db.plans.where('kind').equals('task').filter((p) => !p.done).toArray(), []) ?? []
  const made = items.filter((i) => madeIds.includes(i.id))
  const unused = bank.filter((b) => !b.usedBy || !items.some((i) => i.id === b.usedBy))
  const apiImage = s.imageProvider !== 'manual'
  const chat = s.manualChat === 'claude' ? 'openai' : s.manualChat
  const withImage = rows.filter((r) => r.source)

  const previous = [...items.filter((i) => i.type === type).flatMap((i) => i.promptLog.map((l) => l.prompt)), ...bank.map((b) => b.prompt)]
  const saveSuggestions = async (text: string) => {
    const list = extractJson<{ prompt: string; memo?: string }[]>(text).filter((v) => v?.prompt)
    const have = new Set(bank.map((b) => b.prompt.trim()))
    const t = nowIso()
    const add = list.filter((v) => !have.has(v.prompt.trim())).map((v) => ({ id: uid(), key, topic: topic.trim(), type, prompt: v.prompt.trim(), memo: v.memo, createdAt: t }))
    await db.promptBank.bulkAdd(add)
    setPicked((p) => new Set([...p, ...add.map((a) => a.id)].slice(0, count)))
  }

  const startRows = () => {
    const chosen = unused.filter((b) => picked.has(b.id))
    setRows(chosen.map((b) => ({ id: b.id, prompt: b.prompt, memo: b.memo, state: 'wait' })))
    setMadeIds([])
  }
  const full = (p: string) => `${p}\n\n${PROMPT_RULES[type]}`
  const size = type === 'background' ? (() => { const a = ASPECTS.find((x) => x.id === aspect)!; return a.w > a.h ? 'landscape' : a.w < a.h ? 'portrait' : 'square' })() : 'square'
  const setRow = (id: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)))

  // API로 자동 생성 — 한도·크레딧이 끝나면 멈추고 수동으로 이어가기 안내
  const generateAll = async () => {
    setLimitHit('')
    for (const r of rows.filter((x) => !x.source)) {
      setRow(r.id, { state: 'gen', err: undefined })
      setBusy(`🎨 ${rows.indexOf(r) + 1}/${rows.length} 생성 중…`)
      try {
        const b = await aiImage(full(r.prompt), size)
        setRow(r.id, { source: b, state: 'ok', tool: s.imageProvider === 'openai' ? 'OpenAI' : 'Gemini' })
      } catch (e) {
        setRow(r.id, { state: 'err', err: (e as Error).message })
        if (isLimitError(e)) { setLimitHit((e as Error).message); break }
      }
    }
    setBusy('')
  }

  const copyAll = async () => {
    const text = `아래 ${rows.length}개 프롬프트로 이미지를 각각 1장씩, 순서대로 만들어줘. 한 번에 하나씩 만들어도 좋아.\n\n` +
      rows.map((r, i) => `[${i + 1}번]\n${r.prompt}`).join('\n\n') + `\n\n[모든 이미지에 공통으로 지킬 규칙]\n${PROMPT_RULES[type]}`
    const ok = await copyText(text)
    toast(ok ? `${rows.length}개 프롬프트를 복사했어요. ${PROVIDER_LABEL[chat]}에 붙여넣고, 만든 그림을 번호 순서대로 내려받아 한꺼번에 끌어다 놓으세요.` : '복사가 막혔어요.', ok ? 'info' : 'bad')
    return ok
  }

  // 여러 파일을 한꺼번에: 이미지 없는 줄에 순서대로(파일 이름 순) 채움
  const takeFiles = async (files: File[], onlyRow?: string) => {
    const imgs = files.filter((f) => f.type.startsWith('image/')).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    if (!imgs.length) { toast('이미지 파일을 올려 주세요.', 'bad'); return }
    const targets = onlyRow ? rows.filter((r) => r.id === onlyRow) : rows.filter((r) => !r.source)
    let n = 0
    for (const [i, f] of imgs.entries()) {
      const r = targets[i]
      if (!r) break
      const b = await toMemoryBlob(f)
      if (b) { setRow(r.id, { source: b, state: 'ok', tool: PROVIDER_LABEL[chat] }); n++ }
    }
    if (imgs.length > targets.length) toast(`이미지가 ${imgs.length - targets.length}장 남아서 버렸어요. 줄 수보다 많아요.`, 'info')
    else if (n) toast(`${n}장을 순서대로 넣었어요. 번호가 맞는지 확인하세요.`)
  }

  // 다듬고 보관함에 저장 → 제목·키워드 → 자동 검수
  const processAll = async () => {
    const ids: string[] = []
    const saved = new Set<string>()
    const plan = tasks.find((t) => t.id === planId)
    for (const [i, r] of withImage.entries()) {
      setBusy(`✨ 다듬는 중… ${i + 1}/${withImage.length}`)
      try {
        const t = nowIso()
        const base: Item = {
          id: uid(), title: `${topic.trim()} ${i + 1}`, theme: topic.trim(), type, status: 'making', planId: plan?.id,
          prompt: r.prompt, promptLog: [{ at: t, prompt: r.prompt, tool: r.tool ? `batch:${r.tool}` : 'batch' }], aiTool: r.tool,
          keywords: [], autoChecks: [], manualChecks: {}, createdAt: t, updatedAt: t,
          aspect: type === 'background' ? aspect : undefined, smallSize: type === 'png' ? smallSize : undefined, notes: style || undefined,
        }
        const { final, patch } = await autoProcess(base, r.source!)
        const th = await thumbAndHash(base, final)
        await putBlob(base.id, 'source', r.source!)
        await putBlob(base.id, 'final', final)
        if (th.thumb) await putBlob(base.id, 'thumb', th.thumb)
        await db.items.put({ ...base, ...patch, dhash: th.dhash })
        await db.promptBank.update(r.id, { usedBy: base.id })
        promptOf.current.set(base.id, r.prompt)
        ids.push(base.id)
        saved.add(r.id)
      } catch (e) {
        console.error(e)
        setRow(r.id, { state: 'err', err: `다듬기 실패: ${(e as Error).message}` })
      }
    }
    setMadeIds(ids)
    setRows((rs) => rs.filter((r) => !saved.has(r.id)))
    setBusy('')
    if (!ids.length) return
    toast(`📦 ${ids.length}개를 보관함 “제작 중”에 넣었어요.`)
    if (hasTextApi()) {
      setBusy('✨ 제목·키워드 만드는 중…')
      try { await applyMeta(await aiText(metaReq(ids)), ids) } catch (e) {
        toast(`제목·키워드 자동 생성 실패: ${(e as Error).message}`, 'bad')
        setNeedMeta(true)
      } finally { setBusy('') }
    } else setNeedMeta(true)
    await checkAll(ids)
  }

  const metaReq = (ids: string[]) => {
    const list = ids.map((id, i) => ({ n: i + 1, topic: topic.trim(), prompt: promptOf.current.get(id) ?? items.find((x) => x.id === id)?.prompt }))
    return batchMetadataRequest(type, list)
  }
  const applyMeta = async (text: string, ids = madeIds) => {
    const list = extractJson<{ n: number; title: string; keywords: string[] }[]>(text)
    for (const m of list) {
      const id = ids[m.n - 1]
      if (!id || !m.title) continue
      await db.items.update(id, { title: m.title.trim(), keywords: [...new Set((m.keywords ?? []).map((k) => k.trim()).filter(Boolean))], updatedAt: nowIso() })
    }
    setNeedMeta(false)
    await checkAll(ids)
  }

  const checkAll = async (ids: string[]) => {
    const all = await db.items.toArray()
    for (const id of ids) {
      const it = all.find((x) => x.id === id)
      const file = it && (await getBlob(id, 'final'))
      if (!it || !file) continue
      const res = await runAutoChecks({
        itemId: it.id, type: it.type, file, aspect: it.aspect, smallSize: it.smallSize, prompt: it.prompt, promptLogCount: it.promptLog.length,
        title: it.title, keywords: it.keywords, dhash: it.dhash, others: all, durationSec: it.durationSec, edgeCut: it.edgeCut,
      })
      await db.items.update(id, { autoChecks: res })
    }
  }

  const discard = async (it: Item) => {
    if (!confirm(`“${it.title}”을(를) 버릴까요? 쓴 프롬프트는 다시 “안 씀”으로 돌아가요.`)) return
    const b = await db.promptBank.where('usedBy').equals(it.id).toArray()
    await Promise.all(b.map((x) => db.promptBank.update(x.id, { usedBy: undefined })))
    await deleteItem(it.id)
    setMadeIds((m) => m.filter((x) => x !== it.id))
  }

  const setupDone = rows.length > 0 || made.length > 0

  return (
    <div className="col" style={{ gap: 14, paddingBottom: 40 }}>
      <div className="row between">
        <h1 className="row" style={{ gap: 8 }}><Layers size={22} />한 번에 여러 개 만들기</h1>
        <span className="small muted">{apiImage ? `이미지: ${s.imageProvider === 'openai' ? 'OpenAI' : 'Gemini'} API 자동` : `이미지: 구독 계정(${PROVIDER_LABEL[chat]})에서 만들어 올리기`}</span>
      </div>
      <p className="muted small" style={{ marginTop: -8 }}>
        주제 하나로 서로 다른 요소를 여러 개 만들어 “검수 대기 줄”에 쌓아요. 규칙 검수와 “업로드 준비 완료”는 작업대에서 하나씩 확인해요.
      </p>

      {/* 1. 무엇을 */}
      <div className="card col">
        <h3 style={{ margin: 0 }}>① 무엇을 몇 개</h3>
        <div className="grid g2">
          <label className="big">주제<input value={topic} onChange={(e) => { setTopic(e.target.value); setPicked(new Set()); setPlanId(undefined) }} placeholder="예: 단풍잎, 크리스마스 오너먼트" disabled={setupDone} /></label>
          <label>원하는 느낌 (선택)<input value={style} onChange={(e) => setStyle(e.target.value)} placeholder="예: 파스텔톤, 둥근 선" disabled={setupDone} /></label>
        </div>
        {!setupDone && tasks.length > 0 && (
          <div className="row" style={{ gap: 4 }}>
            <span className="small muted">캘린더 작업:</span>
            {tasks.slice(0, 6).map((p) => (
              <button key={p.id} className={`small ${planId === p.id ? 'primary' : ''}`} onClick={() => { setTopic(p.title); setPlanId(p.id); if (p.types[0] && p.types[0] !== 'video') setType(p.types[0] as BatchType); setStyle(p.notes?.slice(0, 60) ?? '') }}>{p.title}</button>
            ))}
          </div>
        )}
        <div className="row">
          <div className="seg">
            {TYPES.map((t) => <button key={t} className={`small ${type === t ? 'primary' : ''}`} disabled={setupDone} onClick={() => { setType(t); setPicked(new Set()) }}>{TYPE_LABEL[t]}</button>)}
          </div>
          <label className="inline small">개수
            <select value={count} onChange={(e) => setCount(+e.target.value)} disabled={setupDone}>
              {[2, 3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n}개</option>)}
            </select>
          </label>
          {type === 'background' && (
            <label className="inline small">비율
              <select value={aspect} onChange={(e) => setAspect(e.target.value as AspectId)} disabled={setupDone}>
                {ASPECTS.map((a) => <option key={a.id} value={a.id}>{a.id}</option>)}
              </select>
            </label>
          )}
          {type === 'png' && <label className="inline small"><input type="checkbox" checked={smallSize} onChange={(e) => setSmallSize(e.target.checked)} disabled={setupDone} />작은 아이콘(700px)</label>}
        </div>
      </div>

      {/* 2. 프롬프트 */}
      {topic.trim() && !setupDone && (
        <div className="card col">
          <h3 style={{ margin: 0 }}>② 프롬프트 고르기 <span className="small muted">({picked.size}/{count}개 선택)</span></h3>
          <AiRunner primary={unused.length < count} label={`서로 다른 프롬프트 ${count}개 추천받기`} doneText="추천 프롬프트를 보관하고 골라 뒀어요."
            build={() => imagePromptsRequest({ topic: topic.trim(), type, count, previous, style })} onResult={saveSuggestions} />
          {unused.map((b) => (
            <label key={b.id} className={`variant ${picked.has(b.id) ? 'on' : ''}`} style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={picked.has(b.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(b.id); else n.delete(b.id); return n })} />
              <span className="col" style={{ gap: 2 }}><b className="small">{b.memo || '추천 프롬프트'}</b><span className="small mono">{b.prompt}</span></span>
            </label>
          ))}
          {unused.length === 0 && <p className="small muted">이 주제·타입으로 남은 프롬프트가 없어요. 위 버튼으로 추천받으세요. (이미 쓴 프롬프트는 거부 위험이 있어 빼요)</p>}
          <button className="primary" style={{ alignSelf: 'flex-start' }} disabled={!picked.size} onClick={startRows}>이 {picked.size}개로 시작 →</button>
        </div>
      )}

      {/* 3. 이미지 */}
      {rows.length > 0 && (
        <div className="card col">
          <div className="row between">
            <h3 style={{ margin: 0 }}>③ 이미지 <span className="small muted">({withImage.length}/{rows.length})</span></h3>
            <button className="small ghost" onClick={() => { if (confirm('처음부터 다시 할까요? 아직 저장 안 한 이미지는 사라져요.')) setRows([]) }}>처음으로</button>
          </div>
          {apiImage && !limitHit && (
            <button className="primary" style={{ alignSelf: 'flex-start' }} onClick={generateAll} disabled={!!busy || withImage.length === rows.length}>🎨 남은 {rows.length - withImage.length}장 자동 생성</button>
          )}
          {limitHit && (
            <div className="note warn small">
              <b>크레딧·사용 한도가 끝난 것 같아요.</b> 여기서부터는 구독 계정으로 만들어 올리면 돼요. 이미 만든 {withImage.length}장은 그대로 있어요.
              <div className="row mt"><button className="small primary" onClick={() => { updateSettings({ imageProvider: 'manual' }); setLimitHit('') }}>수동 모드로 계속하기</button></div>
            </div>
          )}
          {!apiImage && (
            <div className="row">
              <button className="primary" onClick={async () => { if (await copyAll()) window.open(CHAT_URL[chat], '_blank', 'noopener') }}>📋 {rows.length}개 전부 복사하고 {PROVIDER_LABEL[chat]} 열기</button>
              <button className="small" onClick={copyAll}>📋 복사만</button>
            </div>
          )}
          <div className="canvasbox drop empty" style={{ minHeight: 90 }} onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); takeFiles([...e.dataTransfer.files]) }} onClick={() => fileRef.current?.click()}>
            <div style={{ textAlign: 'center', padding: 12 }}>
              <b>📥 만든 이미지를 한꺼번에 끌어다 놓기</b>
              <p className="small muted">빈 줄에 파일 이름 순서대로 들어가요 (예: 1.png, 2.png…) · 줄마다 따로 넣어도 돼요</p>
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { takeFiles([...(e.target.files ?? [])]); e.target.value = '' }} />
          <div className="brows">
            {rows.map((r, i) => <BatchRow key={r.id} n={i + 1} row={r} onFile={(f) => takeFiles([f], r.id)} onCopy={() => copyText(full(r.prompt)).then(() => toast(`${i + 1}번 프롬프트를 복사했어요.`, 'info'))}
              onRemove={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} />)}
          </div>
          <div className="row">
            <button className="primary" disabled={!withImage.length || !!busy} onClick={processAll}>✨ {withImage.length}개 다듬고 보관함에 넣기</button>
            {busy && <b className="small">{busy}</b>}
          </div>
          <p className="small muted">배경 제거·여백 없이 크롭·최소 크기 확대·{type === 'svg' ? 'SVG 변환(색 5개 이하)' : type === 'png' ? 'PNG 120dpi' : '비율 크롭·JPG 120dpi'}를 기본값으로 해요. 결과가 이상하면 작업대 “다듬기”에서 조정할 수 있어요.</p>
        </div>
      )}

      {/* 4. 검수 대기 줄 */}
      {made.length > 0 && (
        <div className="card col">
          <h3 style={{ margin: 0 }}>④ 검수 대기 줄 ({made.length})</h3>
          {needMeta && (
            <AiRunner primary label={`${made.length}개 제목·키워드 한 번에 만들기`} doneText="제목과 키워드를 채웠어요."
              build={() => metaReq(madeIds)} onResult={(t) => applyMeta(t)} />
          )}
          {busy && <b className="small">{busy}</b>}
          <div className="brows">
            {made.map((it) => <MadeRow key={it.id} item={it} onOpen={() => openWork({ itemId: it.id, step: 3 })} onDiscard={() => discard(it)} />)}
          </div>
          <p className="small muted">하나씩 열어서 눈으로 확인하고 “업로드 준비 완료”를 눌러요. 보관함 “제작 중”에서도 볼 수 있어요.</p>
          <button className="small" style={{ alignSelf: 'flex-start' }} onClick={() => { setRows([]); setMadeIds([]); setPicked(new Set()) }}>같은 주제로 더 만들기</button>
        </div>
      )}
    </div>
  )
}

function BatchRow({ n, row, onFile, onCopy, onRemove }: { n: number; row: Row; onFile: (f: File) => void; onCopy: () => void; onRemove: () => void }) {
  const url = useObjectUrl(row.source ?? null)
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className={`brow ${row.state}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (f) onFile(f) }}>
      <span className="bn">{n}</span>
      <button className="bthumb" onClick={() => ref.current?.click()} title="이 줄에 이미지 넣기">
        {url ? <img src={url} alt="" /> : <span className="small muted">{row.state === 'gen' ? '⏳' : '＋'}</span>}
      </button>
      <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
      <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
        <b className="small">{row.memo || `프롬프트 ${n}`}</b>
        <span className="small mono muted bprompt">{row.prompt}</span>
        {row.err && <span className="small" style={{ color: 'var(--bad)' }}>{row.err}</span>}
      </div>
      <button className="small ghost" onClick={onCopy} title="이 프롬프트만 복사">📋</button>
      <button className="small ghost danger" onClick={onRemove} title="이 줄 빼기"><Trash2 size={14} /></button>
    </div>
  )
}

function MadeRow({ item, onOpen, onDiscard }: { item: Item; onOpen: () => void; onDiscard: () => void }) {
  const blob = useLiveQuery(() => getBlob(item.id, 'thumb'), [item.id, item.updatedAt])
  const url = useObjectUrl(blob)
  const fails = item.autoChecks.filter((c) => c.ok === false).length
  const warns = item.autoChecks.filter((c) => c.ok === null).length
  return (
    <div className="brow">
      <span className="bthumb">{url ? <img src={url} alt="" /> : '…'}</span>
      <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
        <b className="small">{item.title}</b>
        <span className="row small" style={{ gap: 4 }}>
          <TypeBadge type={item.type} />
          {item.status !== 'making' ? <span className="badge ok">준비 완료</span>
            : !item.autoChecks.length ? <span className="badge">검사 중…</span>
              : <>{fails > 0 && <span className="badge bad">고칠 것 {fails}</span>}{warns > 0 && <span className="badge warn">확인 {warns}</span>}{!fails && !warns && <span className="badge ok">자동 검수 통과</span>}</>}
          <span className="muted">키워드 {item.keywords.length}개</span>
        </span>
      </div>
      <button className="small primary" onClick={onOpen}>검수하기 →</button>
      <button className="small ghost danger" onClick={onDiscard} title="버리기"><Trash2 size={14} /></button>
    </div>
  )
}
