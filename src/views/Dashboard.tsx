import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, STATUS_LABEL, type ItemStatus } from '../lib/db'
import { TYPE_LABEL, type ElementType } from '../lib/rules'
import { seasonEvents } from '../lib/seasons'
import { useSettings } from '../lib/settings'
import { addDays, daysBetween, fmtWon, ymd } from '../lib/utils'
import { StatusBadge, TypeBadge } from '../components/ui'
import type { WorkbenchStart } from './Workbench'

const TYPES = Object.keys(TYPE_LABEL) as ElementType[]
const STATUSES = Object.keys(STATUS_LABEL) as ItemStatus[]

export function Dashboard({ openWork, goCalendar }: { openWork: (s: Omit<WorkbenchStart, 'key'>) => void; goCalendar: () => void }) {
  const items = useLiveQuery(() => db.items.toArray(), []) ?? []
  const ideaCount = useLiveQuery(() => db.ideas.count(), []) ?? 0
  const [hideGuide, setHideGuide] = useState(() => { try { return localStorage.getItem('miri-hide-guide') === '1' } catch { return false } })
  const plans = useLiveQuery(() => db.plans.toArray(), []) ?? []
  const revenue = useLiveQuery(() => db.revenue.toArray(), []) ?? []
  const { leadDays } = useSettings()
  const today = ymd()
  const month = today.slice(0, 7)
  const weekStart = addDays(today, -((new Date().getDay() + 6) % 7))

  const count = (st: ItemStatus) => items.filter((i) => i.status === st).length
  const uploadedAll = items.filter((i) => i.uploadedAt)
  const approved = count('approved'), rejected = count('rejected')
  const rate = approved + rejected ? Math.round((approved / (approved + rejected)) * 100) : null
  const monthRevenue = revenue.filter((r) => r.month === month).reduce((s, r) => s + r.amount, 0)

  const last30 = Array.from({ length: 30 }, (_, i) => addDays(today, i - 29))
  const perDay = last30.map((d) => ({ d, n: uploadedAll.filter((i) => i.uploadedAt === d).length }))
  const maxDay = Math.max(1, ...perDay.map((p) => p.n))

  const year = new Date().getFullYear()
  const seasons = [...seasonEvents(year), ...seasonEvents(year + 1)]
    .map((s) => ({ ...s, until: daysBetween(today, s.start) }))
    .filter((s) => s.until >= 0 && s.until <= leadDays + 30)
    .slice(0, 6)

  const weekTasks = plans
    .filter((p) => p.kind === 'task' && p.start <= addDays(weekStart, 6) && p.end >= weekStart)
    .sort((a, b) => a.start.localeCompare(b.start))
  const themesNow = plans.filter((p) => p.kind === 'theme' && p.start <= today && p.end >= today)
  const recent = [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6)

  const guide = [
    { done: ideaCount > 0 || plans.length > 0, title: '만들 거리 모으기', desc: '캘린더·아이디어에서 AI 추천이나 트렌드 서치로 주제를 모아요', go: goCalendar },
    { done: items.length > 0, title: '첫 요소 만들기', desc: '작업대에서 6단계를 따라가면 규칙에 맞게 다듬고 검수까지 해줘요', go: () => openWork({}) },
    { done: uploadedAll.length > 0, title: '올리고 기록하기', desc: '미리캔버스에 올린 뒤 “오늘 업로드했어요”를 누르면 여기 통계에 쌓여요', go: goCalendar },
  ]
  const showGuide = !hideGuide && guide.some((g) => !g.done)

  return (
    <div className="col" style={{ gap: 16 }}>
      {showGuide && (
        <div className="card col">
          <div className="row between">
            <h3 style={{ margin: 0 }}>👋 이렇게 시작해요</h3>
            <button className="small ghost" onClick={() => { setHideGuide(true); try { localStorage.setItem('miri-hide-guide', '1') } catch { /* 무시 */ } }}>숨기기</button>
          </div>
          <div className="guide">
            {guide.map((g, i) => (
              <button key={g.title} className={`g ${g.done ? 'done' : ''}`} onClick={g.go}>
                <span className="n">{g.done ? '✓' : i + 1}</span>
                <span className="col" style={{ gap: 2 }}><b>{g.title}</b><span className="small muted">{g.desc}</span></span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid g4">
        <Stat v={items.length} l="만든 요소(전체)" />
        <Stat v={uploadedAll.length} l="올린 요소" sub={`오늘 ${uploadedAll.filter((i) => i.uploadedAt === today).length} · 이번 주 ${uploadedAll.filter((i) => i.uploadedAt! >= weekStart).length} · 이번 달 ${uploadedAll.filter((i) => i.uploadedAt!.startsWith(month)).length}`} />
        <Stat v={approved} l="판매 중(승인)" sub={rate == null ? '승인률 -' : `승인률 ${rate}% (거부 ${rejected})`} />
        <Stat v={fmtWon(monthRevenue)} l="이번 달 수익" sub={`누적 ${fmtWon(revenue.reduce((s, r) => s + r.amount, 0))}`} />
      </div>

      <div className="grid g2">
        <div className="card">
          <h3>진행 상태</h3>
          <div className="col">
            {STATUSES.map((st) => (
              <div key={st} className="row between">
                <StatusBadge status={st} />
                <b>{count(st)}</b>
              </div>
            ))}
          </div>
          <h3 className="mt">타입별</h3>
          <table>
            <thead><tr><th>타입</th><th>제작</th><th>업로드</th><th>판매 중</th><th>거부</th></tr></thead>
            <tbody>
              {TYPES.map((t) => {
                const ti = items.filter((i) => i.type === t)
                return (
                  <tr key={t}>
                    <td><TypeBadge type={t} /></td>
                    <td>{ti.length}</td>
                    <td>{ti.filter((i) => i.uploadedAt).length}</td>
                    <td>{ti.filter((i) => i.status === 'approved').length}</td>
                    <td>{ti.filter((i) => i.status === 'rejected').length}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>최근 30일 업로드</h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 110 }} role="img" aria-label="최근 30일 일별 업로드 수">
            {perDay.map((p) => (
              <div key={p.d} title={`${p.d}: ${p.n}개`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                <div style={{ height: `${(p.n / maxDay) * 100}%`, minHeight: p.n ? 3 : 1, background: p.n ? 'var(--accent)' : 'var(--line)', borderRadius: '3px 3px 0 0' }} />
              </div>
            ))}
          </div>
          <div className="row between small muted"><span>{last30[0].slice(5)}</span><span>최대 {maxDay}개/일</span><span>오늘</span></div>

          <h3 className="mt">지금 만들어야 할 시즌</h3>
          <p className="small muted mb">시즌 {leadDays}일 전까지 올려야 검색에 잡혀요.</p>
          <div className="col">
            {seasons.map((s) => (
              <div key={s.title + s.start} className="row between">
                <div>
                  <b>{s.title}</b> <span className="small muted">{s.start.slice(5)} · D-{s.until}</span>
                  <div className="small muted">{s.ideas.slice(0, 4).join(', ')}</div>
                </div>
                <span className={`badge ${s.until <= leadDays ? (s.until <= 14 ? 'bad' : 'warn') : ''}`}>
                  {s.until <= 14 ? '늦음' : s.until <= leadDays ? '지금 제작' : '준비'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid g2">
        <div className="card">
          <div className="row between"><h3>이번 주 할 일</h3><button className="small" onClick={goCalendar}>캘린더 열기</button></div>
          {themesNow.length > 0 && <p className="small mb">진행 중 테마: {themesNow.map((t) => t.title).join(', ')}</p>}
          {weekTasks.length === 0 && <p className="muted small">이번 주 잡힌 작업이 없어요. 캘린더에서 아이디어를 날짜로 끌어다 놓으세요.</p>}
          <div className="col">
            {weekTasks.map((p) => (
              <div key={p.id} className="row between">
                <span style={{ textDecoration: p.done ? 'line-through' : undefined }}>
                  <span className="small muted">{p.start.slice(5)}</span> {p.title} {p.types.map((t) => <TypeBadge key={t} type={t} />)}
                </span>
                <button className="small" onClick={() => openWork({ topic: p.title, type: p.types[0], planId: p.id, notes: p.notes })}>작업대로 →</button>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>최근 작업</h3>
          {recent.length === 0 && <p className="muted small">아직 만든 요소가 없어요. 작업대에서 첫 요소를 만들어 보세요.</p>}
          <div className="col">
            {recent.map((i) => (
              <div key={i.id} className="row between">
                <span><TypeBadge type={i.type} /> {i.title || '(제목 없음)'}</span>
                <span className="row"><StatusBadge status={i.status} /><button className="small" onClick={() => openWork({ itemId: i.id })}>열기</button></span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ v, l, sub }: { v: number | string; l: string; sub?: string }) {
  return (
    <div className="card stat">
      <span className="l">{l}</span>
      <span className="v">{v}</span>
      {sub && <span className="small muted">{sub}</span>}
    </div>
  )
}
