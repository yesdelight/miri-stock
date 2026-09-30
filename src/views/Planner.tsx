import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { AiRunner } from '../components/AiRunner'
import { Modal, TypeBadge, TypePicker } from '../components/ui'
import { db, nowIso, uid, type Idea, type Plan } from '../lib/db'
import { ideasRequest, planRequest, trendRequest } from '../lib/prompts'
import type { ElementType } from '../lib/rules'
import { seasonEvents } from '../lib/seasons'
import { addDays, extractJson, pad, parseYmd, ymd } from '../lib/utils'
import type { WorkbenchStart } from './Workbench'

type Open = (s: Omit<WorkbenchStart, 'key'>) => void
const DOW = ['월', '화', '수', '목', '금', '토', '일']

export function Planner({ openWork }: { openWork: Open }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })
  // 기본은 '앞으로 6주' — 월말에도 다음 달이 같이 보이게
  const [mode, setMode] = useState<'ahead' | 'month'>('ahead')
  const [offset, setOffset] = useState(0)
  const [showSeasons, setShowSeasons] = useState(true)
  const [edit, setEdit] = useState<Partial<Plan> | null>(null)
  const [dropDay, setDropDay] = useState<string | null>(null)
  const plans = useLiveQuery(() => db.plans.toArray(), []) ?? []
  const items = useLiveQuery(() => db.items.toArray(), []) ?? []
  const ideas = useLiveQuery(() => db.ideas.orderBy('createdAt').reverse().toArray(), []) ?? []
  const today = ymd()

  const monthStr = `${cursor.y}-${pad(cursor.m + 1)}`
  const days = useMemo(() => {
    let start: string
    if (mode === 'ahead') {
      const t = parseYmd(today)
      start = addDays(today, -((t.getDay() + 6) % 7) + offset * 7)
    } else {
      const first = new Date(cursor.y, cursor.m, 1)
      start = addDays(ymd(first), -((first.getDay() + 6) % 7))
    }
    return Array.from({ length: 42 }, (_, i) => addDays(start, i))
  }, [cursor, mode, offset, today])
  const rangeStart = days[0], rangeEnd = days[41]
  const seasons = useMemo(() => {
    const y = Number(rangeStart.slice(0, 4))
    return [...seasonEvents(y - 1), ...seasonEvents(y), ...seasonEvents(y + 1)]
  }, [rangeStart])

  const move = (n: number) => {
    if (mode === 'ahead') setOffset((o) => o + n * 4)
    else setCursor(({ y, m }) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() } })
  }
  const goToday = () => { setOffset(0); const d = new Date(); setCursor({ y: d.getFullYear(), m: d.getMonth() }) }
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`
  const title = mode === 'ahead' ? `${md(rangeStart)} ~ ${md(rangeEnd)}` : `${cursor.y}년 ${cursor.m + 1}월`

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
            <button onClick={() => move(-1)} aria-label="이전">‹</button>
            <h2 style={{ minWidth: 140, textAlign: 'center' }}>{title}</h2>
            <button onClick={() => move(1)} aria-label="다음">›</button>
            <button className="small" onClick={goToday}>오늘</button>
            <span className="seg">
              <button className={`small ${mode === 'ahead' ? 'primary' : ''}`} onClick={() => setMode('ahead')}>앞으로 6주</button>
              <button className={`small ${mode === 'month' ? 'primary' : ''}`} onClick={() => setMode('month')}>월별</button>
            </span>
          </div>
          <div className="row">
            <label className="inline small"><input type="checkbox" checked={showSeasons} onChange={(e) => setShowSeasons(e.target.checked)} />시즌 표시</label>
            <button className="small" onClick={() => setEdit({ kind: 'theme', start: today, end: addDays(today, 6), types: [] })}>+ 테마</button>
            <button className="small" onClick={() => setEdit({ kind: 'task', start: today, end: today, types: ['svg'] })}>+ 작업</button>
          </div>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <div className="row between">
            <div className="col" style={{ gap: 4 }}>
              <b className="small">이 기간의 테마·시즌</b>
              <div className="row">
                {monthThemes.map((t) => <button key={t.id} className="chip theme small" style={{ width: 'auto' }} onClick={() => setEdit(t)}>{t.title} · {t.start.slice(5)}~{t.end.slice(5)}</button>)}
                {monthSeasons.map((s) => <span key={s.title + s.start} className="chip season" style={{ width: 'auto' }}>{s.title} {s.start.slice(5)}~{s.end.slice(5)}</span>)}
                {!monthThemes.length && !monthSeasons.length && <span className="small muted">없음</span>}
              </div>
            </div>
            <AiRunner
              label="AI로 이 기간 캘린더 짜기"
              build={() => planRequest({
                start: rangeStart < today ? today : rangeStart,
                end: rangeEnd,
                seasons: seasons.filter((s) => s.start >= rangeStart && s.start <= addDays(rangeEnd, 70)).map((s) => `${s.title}(${s.start})`),
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
            const inMonth = mode === 'ahead' ? day >= today : day.startsWith(monthStr)
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
                <span className="num">{day.endsWith('-01') || day === days[0] ? md(day) : Number(day.slice(8))}</span>
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

      <IdeaBoard ideas={ideas} plans={plans} openWork={openWork} />

      {edit && <PlanModal plan={edit} onClose={() => setEdit(null)} openWork={openWork} />}
    </div>
  )
}

type IdeaTab = 'todo' | 'scheduled' | 'done'

function IdeaBoard({ ideas, plans, openWork }: { ideas: Idea[]; plans: Plan[]; openWork: Open }) {
  const [title, setTitle] = useState('')
  const [types, setTypes] = useState<ElementType[]>(['svg'])
  const [focus, setFocus] = useState('')
  const [source, setSource] = useState<'all' | Idea['source']>('all')
  const [tab, setTab] = useState<IdeaTab>('todo')
  const [open, setOpen] = useState<string | null>(null)

  const add = async (list: Omit<Idea, 'id' | 'createdAt'>[]) => {
    const existing = new Set(ideas.map((i) => i.title))
    await db.ideas.bulkAdd(list.filter((l) => !existing.has(l.title)).map((l) => ({ ...l, id: uid(), createdAt: nowIso() })))
  }
  const parse = (src: Idea['source']) => async (text: string) => {
    const arr = extractJson<{ title: string; types?: ElementType[]; notes?: string; tags?: string[] }[]>(text)
    await add(arr.map((a) => ({ title: a.title, types: (a.types ?? ['svg']).filter((t) => ['svg', 'png', 'background', 'video'].includes(t)), notes: a.notes, tags: a.tags ?? [], source: src })))
    setTab('todo')
  }

  // 캘린더에 들어간 아이디어는 '일정 잡힘', 그 작업을 끝내면 '완료'
  const plansOf = (id: string) => plans.filter((p) => p.ideaId === id).sort((a, b) => a.start.localeCompare(b.start))
  const statusOf = (i: Idea): IdeaTab => {
    const ps = plansOf(i.id)
    if (!ps.length) return 'todo'
    return ps.every((p) => p.done) ? 'done' : 'scheduled'
  }
  const bySource = ideas.filter((i) => source === 'all' || i.source === source)
  const counts = { todo: 0, scheduled: 0, done: 0 }
  bySource.forEach((i) => counts[statusOf(i)]++)
  const shown = bySource.filter((i) => statusOf(i) === tab).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))
  const schedule = (i: Idea, day: string) => db.plans.add({ id: uid(), kind: 'task', title: i.title, start: day, end: day, types: i.types, notes: i.notes, ideaId: i.id })
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`

  return (
    <div className="card col" style={{ gap: 10, alignSelf: 'start', maxHeight: 'calc(100vh - 100px)', overflow: 'auto' }}>
      <h3 style={{ margin: 0 }}>💡 아이디어 보관함</h3>
      <div className="col" style={{ gap: 6 }}>
        <input placeholder="직접 추가 (예: 붕어빵 SVG) + Enter" value={title} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) { add([{ title: title.trim(), types, source: 'me', tags: [] }]); setTitle(''); setTab('todo') } }} />
        <TypePicker value={types} onChange={setTypes} multi />
      </div>
      <div className="note col" style={{ gap: 8 }}>
        <input placeholder="AI에게 줄 주제 (예: 12월 연말, 카페 메뉴 · 비워두면 다가오는 시즌)" value={focus} onChange={(e) => setFocus(e.target.value)} />
        <AiRunner label="아이디어 추천" build={() => ideasRequest({ focus: focus || `오늘(${ymd()}) 기준 앞으로 4~10주 사이 시즌·기념일`, count: 12, existing: ideas.map((i) => i.title) })} onResult={parse('ai')} />
        <AiRunner label="트렌드 서치(웹 검색)" build={() => trendRequest({ existing: ideas.map((i) => i.title) })} onResult={parse('trend')} />
      </div>

      <div className="seg" style={{ alignSelf: 'stretch', display: 'flex' }}>
        {([['todo', '대기'], ['scheduled', '일정 잡힘'], ['done', '완료']] as const).map(([k, l]) => (
          <button key={k} className={`small grow ${tab === k ? 'primary' : ''}`} onClick={() => setTab(k)}>{l} {counts[k]}</button>
        ))}
      </div>
      <div className="row between">
        <span className="small muted">{tab === 'todo' ? '👉 카드를 캘린더 날짜로 끌어다 놓으세요' : tab === 'scheduled' ? '캘린더에 들어간 아이디어' : '작업을 끝낸 아이디어'}</span>
        <select className="small" value={source} onChange={(e) => setSource(e.target.value as typeof source)} aria-label="출처">
          <option value="all">모든 출처</option><option value="me">내 메모</option><option value="ai">AI 추천</option><option value="trend">트렌드</option>
        </select>
      </div>

      {shown.length === 0 && <p className="small muted">{tab === 'todo' ? '대기 중인 아이디어가 없어요. 위에서 추가하거나 AI에게 추천받으세요.' : '없어요.'}</p>}
      {shown.map((i) => {
        const ps = plansOf(i.id)
        const expanded = open === i.id
        return (
          <div key={i.id} className={`idea ${tab !== 'todo' ? 'placed' : ''}`} draggable={tab === 'todo'} onDragStart={(e) => e.dataTransfer.setData('text/idea', i.id)}>
            <div className="row between" style={{ alignItems: 'flex-start' }}>
              <b>{i.pinned && '📌 '}{i.title}</b>
              {ps.length > 0 && <span className={`badge ${tab === 'done' ? 'ok' : 'accent'}`}>{tab === 'done' ? '✓ 완료' : `📅 ${ps.map((p) => md(p.start)).join(', ')}`}</span>}
            </div>
            <div className="row" style={{ gap: 4 }}>
              {i.types.map((t) => <TypeBadge key={t} type={t} />)}
              <span className="badge">{{ me: '내 메모', ai: 'AI', trend: '트렌드' }[i.source]}</span>
              {i.tags.slice(0, 3).map((t) => <span key={t} className="badge">#{t}</span>)}
            </div>
            {i.notes && (
              <p className={`small muted ${expanded ? '' : 'clamp2'}`} onClick={() => setOpen(expanded ? null : i.id)} style={{ cursor: 'pointer' }} title={expanded ? '접기' : '펼치기'}>{i.notes}</p>
            )}
            <div className="idea-actions">
              {tab === 'todo' && (
                <label className="act" title="날짜를 골라 캘린더에 넣기">📅 날짜 정하기
                  <input type="date" aria-label="날짜 정하기" onChange={(e) => e.target.value && schedule(i, e.target.value)} />
                </label>
              )}
              <button className="act" title="작업대에서 바로 만들기" onClick={() => openWork({ topic: i.title, type: i.types[0], notes: i.notes, planId: ps.find((p) => !p.done)?.id })}>🛠 만들기</button>
              {tab === 'todo' && <button className="act" title="목록 맨 위에 고정" onClick={() => db.ideas.update(i.id, { pinned: !i.pinned })}>📌 {i.pinned ? '고정 해제' : '고정'}</button>}
              {tab === 'scheduled' && <button className="act" title="캘린더에서 빼고 대기로 돌리기" onClick={() => db.plans.bulkDelete(ps.map((p) => p.id))}>↩ 일정 취소</button>}
              <button className="act danger" title="아이디어 삭제" onClick={() => confirm(`“${i.title}” 아이디어를 삭제할까요?`) && db.ideas.delete(i.id)}>🗑</button>
            </div>
          </div>
        )
      })}
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
