import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { AiRunner } from '../components/AiRunner'
import { Modal, TypeBadge, TypePicker } from '../components/ui'
import { db, nowIso, uid, type Idea, type Plan } from '../lib/db'
import { ideasRequest, planRequest, trendRequest } from '../lib/prompts'
import type { ElementType } from '../lib/rules'
import { seasonEvents } from '../lib/seasons'
import { addDays, extractJson, pad, ymd } from '../lib/utils'
import type { WorkbenchStart } from './Workbench'

type Open = (s: Omit<WorkbenchStart, 'key'>) => void
const DOW = ['월', '화', '수', '목', '금', '토', '일']

export function Planner({ openWork }: { openWork: Open }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })
  const [showSeasons, setShowSeasons] = useState(true)
  const [edit, setEdit] = useState<Partial<Plan> | null>(null)
  const [dropDay, setDropDay] = useState<string | null>(null)
  const plans = useLiveQuery(() => db.plans.toArray(), []) ?? []
  const items = useLiveQuery(() => db.items.toArray(), []) ?? []
  const ideas = useLiveQuery(() => db.ideas.orderBy('createdAt').reverse().toArray(), []) ?? []
  const today = ymd()

  const monthStr = `${cursor.y}-${pad(cursor.m + 1)}`
  const days = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1)
    const start = addDays(ymd(first), -((first.getDay() + 6) % 7))
    return Array.from({ length: 42 }, (_, i) => addDays(start, i))
  }, [cursor])
  const seasons = useMemo(() => [...seasonEvents(cursor.y - 1), ...seasonEvents(cursor.y)], [cursor.y])

  const move = (n: number) => setCursor(({ y, m }) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() } })

  const onDrop = async (day: string, e: React.DragEvent) => {
    e.preventDefault()
    setDropDay(null)
    const ideaId = e.dataTransfer.getData('text/idea')
    const planId = e.dataTransfer.getData('text/plan')
    if (ideaId) {
      const idea = await db.ideas.get(ideaId)
      if (idea) await db.plans.add({ id: uid(), kind: 'task', title: idea.title, start: day, end: day, types: idea.types, notes: idea.notes, ideaId })
    } else if (planId) {
      const p = await db.plans.get(planId)
      if (p) { const len = Math.round((new Date(p.end).getTime() - new Date(p.start).getTime()) / 86400000); await db.plans.update(planId, { start: day, end: addDays(day, len) }) }
    }
  }

  const monthThemes = plans.filter((p) => p.kind === 'theme' && p.start <= days[41] && p.end >= days[0])
  const monthSeasons = showSeasons ? seasons.filter((s) => s.start <= days[41] && s.end >= days[0]) : []

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 320px' }} data-layout="planner">
      <style>{`@media (max-width: 1100px){[data-layout=planner]{grid-template-columns:1fr !important}}`}</style>
      <div className="col" style={{ gap: 12 }}>
        <div className="row between">
          <div className="row">
            <button onClick={() => move(-1)} aria-label="이전 달">‹</button>
            <h2 style={{ minWidth: 120, textAlign: 'center' }}>{cursor.y}년 {cursor.m + 1}월</h2>
            <button onClick={() => move(1)} aria-label="다음 달">›</button>
            <button className="small" onClick={() => { const d = new Date(); setCursor({ y: d.getFullYear(), m: d.getMonth() }) }}>오늘</button>
          </div>
          <div className="row">
            <label className="inline small"><input type="checkbox" checked={showSeasons} onChange={(e) => setShowSeasons(e.target.checked)} />시즌 표시</label>
            <button className="small" onClick={() => setEdit({ kind: 'theme', start: `${monthStr}-01`, end: `${monthStr}-07`, types: [] })}>+ 테마</button>
            <button className="small" onClick={() => setEdit({ kind: 'task', start: today, end: today, types: ['svg'] })}>+ 작업</button>
          </div>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <div className="row between">
            <div className="col" style={{ gap: 4 }}>
              <b className="small">이 달의 테마</b>
              <div className="row">
                {monthThemes.map((t) => <button key={t.id} className="chip theme small" style={{ width: 'auto' }} onClick={() => setEdit(t)}>{t.title} · {t.start.slice(5)}~{t.end.slice(5)}</button>)}
                {monthSeasons.map((s) => <span key={s.title + s.start} className="chip season" style={{ width: 'auto' }}>{s.title} {s.start.slice(5)}~{s.end.slice(5)}</span>)}
                {!monthThemes.length && !monthSeasons.length && <span className="small muted">없음</span>}
              </div>
            </div>
            <AiRunner
              label="AI로 이 달 캘린더 짜기"
              build={() => planRequest({
                month: monthStr,
                seasons: [...seasonEvents(cursor.y), ...seasonEvents(cursor.y + 1)].filter((s) => s.start >= `${monthStr}-01` && s.start <= addDays(`${monthStr}-01`, 110)).map((s) => `${s.title}(${s.start})`),
                existingPlans: monthThemes.map((t) => t.title),
              })}
              onResult={async (text) => {
                const arr = extractJson<{ title: string; start: string; end: string; types?: ElementType[]; notes?: string }[]>(text)
                await db.plans.bulkAdd(arr.map((a) => ({ id: uid(), kind: 'theme' as const, title: a.title, start: a.start, end: a.end, types: a.types ?? [], notes: a.notes })))
              }}
            />
          </div>
        </div>

        <div className="cal">
          {DOW.map((d) => <div key={d} className="dow">{d}</div>)}
          {days.map((day) => {
            const inMonth = day.startsWith(monthStr)
            const tasks = plans.filter((p) => p.kind === 'task' && p.start === day)
            const themes = plans.filter((p) => p.kind === 'theme' && (p.start === day || (p.start < day && p.end >= day && new Date(day).getDay() === 1)))
            const seas = showSeasons ? seasons.filter((s) => s.start === day) : []
            const up = items.filter((i) => i.uploadedAt === day).length
            const made = items.filter((i) => i.readyAt?.slice(0, 10) === day).length
            return (
              <div
                key={day}
                className={`day ${inMonth ? '' : 'other'} ${day === today ? 'today' : ''} ${dropDay === day ? 'drop' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDropDay(day) }}
                onDragLeave={() => setDropDay((d) => (d === day ? null : d))}
                onDrop={(e) => onDrop(day, e)}
                onDoubleClick={() => setEdit({ kind: 'task', start: day, end: day, types: ['svg'] })}
              >
                <span className="num">{Number(day.slice(8))}</span>
                {seas.map((s) => <span key={s.title} className="chip season" title={s.ideas.join(', ')}>🎉 {s.title}</span>)}
                {themes.map((t) => <button key={t.id} className="chip theme" onClick={() => setEdit(t)}>▸ {t.title}</button>)}
                {tasks.map((t) => (
                  <button
                    key={t.id}
                    className={`chip task ${t.done ? 'done' : ''}`}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plan', t.id)}
                    onClick={() => setEdit(t)}
                    title={t.notes}
                  >
                    {t.title}
                  </button>
                ))}
                {(up > 0 || made > 0) && (
                  <span className="chip uploaded">{made > 0 && `완성 ${made}`}{made > 0 && up > 0 && ' · '}{up > 0 && `업로드 ${up}`}</span>
                )}
              </div>
            )
          })}
        </div>
        <p className="small muted">아이디어를 날짜로 끌어다 놓으면 작업이 돼요. 작업 칩도 끌어서 날짜를 옮길 수 있어요. 빈 칸을 더블클릭하면 새 작업.</p>
      </div>

      <IdeaBoard ideas={ideas} openWork={openWork} monthStr={monthStr} />

      {edit && <PlanModal plan={edit} onClose={() => setEdit(null)} openWork={openWork} />}
    </div>
  )
}

function IdeaBoard({ ideas, openWork, monthStr }: { ideas: Idea[]; openWork: Open; monthStr: string }) {
  const [title, setTitle] = useState('')
  const [types, setTypes] = useState<ElementType[]>(['svg'])
  const [focus, setFocus] = useState('')
  const [filter, setFilter] = useState<'all' | Idea['source']>('all')

  const add = async (list: Omit<Idea, 'id' | 'createdAt'>[]) => {
    const existing = new Set(ideas.map((i) => i.title))
    await db.ideas.bulkAdd(list.filter((l) => !existing.has(l.title)).map((l) => ({ ...l, id: uid(), createdAt: nowIso() })))
  }
  const parse = (source: Idea['source']) => async (text: string) => {
    const arr = extractJson<{ title: string; types?: ElementType[]; notes?: string; tags?: string[] }[]>(text)
    await add(arr.map((a) => ({ title: a.title, types: (a.types ?? ['svg']).filter((t) => ['svg', 'png', 'background', 'video'].includes(t)), notes: a.notes, tags: a.tags ?? [], source })))
  }
  const shown = ideas.filter((i) => filter === 'all' || i.source === filter).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))

  return (
    <div className="card col" style={{ gap: 10, alignSelf: 'start', maxHeight: 'calc(100vh - 100px)', overflow: 'auto' }}>
      <h3 style={{ margin: 0 }}>💡 아이디어 보관함</h3>
      <div className="col" style={{ gap: 6 }}>
        <input placeholder="직접 추가 (예: 붕어빵 SVG)" value={title} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) { add([{ title: title.trim(), types, source: 'me', tags: [] }]); setTitle('') } }} />
        <TypePicker value={types} onChange={setTypes} multi />
      </div>
      <div className="note col" style={{ gap: 8 }}>
        <input placeholder="AI에게 줄 주제 (예: 12월 연말, 카페 메뉴, 비워두면 이번 달)" value={focus} onChange={(e) => setFocus(e.target.value)} />
        <AiRunner label="아이디어 추천" build={() => ideasRequest({ focus: focus || `${monthStr} 시즌과 1~2달 뒤 시즌`, count: 12, existing: ideas.map((i) => i.title) })} onResult={parse('ai')} />
        <AiRunner label="트렌드 서치(웹 검색)" build={() => trendRequest({ month: monthStr, existing: ideas.map((i) => i.title) })} onResult={parse('trend')} />
      </div>
      <div className="row">
        {(['all', 'me', 'ai', 'trend'] as const).map((f) => (
          <button key={f} className={`small ${filter === f ? 'primary' : ''}`} onClick={() => setFilter(f)}>{{ all: '전체', me: '내 메모', ai: 'AI 추천', trend: '트렌드' }[f]}</button>
        ))}
      </div>
      {shown.length === 0 && <p className="small muted">아이디어가 없어요.</p>}
      {shown.map((i) => (
        <div key={i.id} className="idea" draggable onDragStart={(e) => e.dataTransfer.setData('text/idea', i.id)}>
          <div className="row between">
            <b>{i.pinned && '📌 '}{i.title}</b>
            <span className="row" style={{ gap: 2 }}>
              <label className="small" title="날짜 지정(모바일)" style={{ position: 'relative', cursor: 'pointer' }}>📅
                <input type="date" aria-label="날짜 지정" style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                  onChange={(e) => e.target.value && db.plans.add({ id: uid(), kind: 'task', title: i.title, start: e.target.value, end: e.target.value, types: i.types, notes: i.notes, ideaId: i.id })} />
              </label>
              <button className="ghost small" title="고정" onClick={() => db.ideas.update(i.id, { pinned: !i.pinned })}>📌</button>
              <button className="ghost small" title="작업대로" onClick={() => openWork({ topic: i.title, type: i.types[0], notes: i.notes })}>🛠</button>
              <button className="ghost small danger" title="삭제" onClick={() => db.ideas.delete(i.id)}>✕</button>
            </span>
          </div>
          <div className="row" style={{ gap: 4 }}>
            {i.types.map((t) => <TypeBadge key={t} type={t} />)}
            <span className="badge">{{ me: '내 메모', ai: 'AI', trend: '트렌드' }[i.source]}</span>
            {i.tags.slice(0, 3).map((t) => <span key={t} className="badge">#{t}</span>)}
          </div>
          {i.notes && <p className="small muted">{i.notes}</p>}
        </div>
      ))}
    </div>
  )
}

function PlanModal({ plan, onClose, openWork }: { plan: Partial<Plan>; onClose: () => void; openWork: Open }) {
  const [p, setP] = useState<Partial<Plan>>({ types: [], ...plan })
  const isNew = !plan.id
  const save = async () => {
    if (!p.title?.trim() || !p.start) return
    const full: Plan = { id: p.id ?? uid(), kind: p.kind ?? 'task', title: p.title.trim(), start: p.start, end: p.kind === 'task' ? p.start : (p.end ?? p.start), types: p.types ?? [], notes: p.notes, done: p.done, ideaId: p.ideaId }
    await db.plans.put(full)
    onClose()
  }
  return (
    <Modal title={isNew ? (p.kind === 'theme' ? '테마 추가' : '작업 추가') : p.title ?? ''} onClose={onClose}>
      <div className="col">
        <div className="row">
          <button className={`small ${p.kind === 'task' ? 'primary' : ''}`} onClick={() => setP({ ...p, kind: 'task' })}>작업(하루)</button>
          <button className={`small ${p.kind === 'theme' ? 'primary' : ''}`} onClick={() => setP({ ...p, kind: 'theme' })}>테마(기간)</button>
        </div>
        <label>제목<input value={p.title ?? ''} onChange={(e) => setP({ ...p, title: e.target.value })} autoFocus /></label>
        <div className="row">
          <label>{p.kind === 'theme' ? '시작' : '날짜'}<input type="date" value={p.start ?? ''} onChange={(e) => setP({ ...p, start: e.target.value })} /></label>
          {p.kind === 'theme' && <label>끝<input type="date" value={p.end ?? ''} onChange={(e) => setP({ ...p, end: e.target.value })} /></label>}
        </div>
        <label>타입</label>
        <TypePicker value={p.types ?? []} onChange={(types) => setP({ ...p, types })} multi />
        <label>메모<textarea rows={4} value={p.notes ?? ''} onChange={(e) => setP({ ...p, notes: e.target.value })} /></label>
        {p.kind === 'task' && <label className="inline"><input type="checkbox" checked={!!p.done} onChange={(e) => setP({ ...p, done: e.target.checked })} />완료</label>}
        <div className="row between mt">
          <div className="row">
            <button className="primary" onClick={save}>저장</button>
            {!isNew && (
              <button onClick={() => { onClose(); openWork({ topic: p.title ?? '', type: (p.types?.[0] ?? 'svg') as ElementType, planId: p.kind === 'task' ? p.id : undefined, notes: p.notes }) }}>
                🛠 작업대로
              </button>
            )}
          </div>
          {!isNew && <button className="danger" onClick={async () => { await db.plans.delete(p.id!); onClose() }}>삭제</button>}
        </div>
      </div>
    </Modal>
  )
}
