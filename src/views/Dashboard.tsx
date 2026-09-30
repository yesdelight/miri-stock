// 홈: 오늘 할 일 중심 — 만들 것 / 올릴 것 / 심사 결과 확인할 것
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowRight, CalendarDays, CheckCircle2, ChevronDown, ExternalLink, Hammer, Hourglass, Sparkles, UploadCloud } from 'lucide-react'
import { useState } from 'react'
import { TypeBadge } from '../components/ui'
import { db, type Item, type ItemStatus, type Plan } from '../lib/db'
import { seasonEvents } from '../lib/seasons'
import { useSettings } from '../lib/settings'
import { addDays, daysBetween, fmtWon, ymd } from '../lib/utils'
import type { View } from '../App'
import type { WorkbenchStart } from './Workbench'

type Props = {
  openWork: (s: Omit<WorkbenchStart, 'key'>) => void
  go: (v: View) => void
  goLibrary: (status?: ItemStatus) => void
}

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`
const greeting = () => {
  const h = new Date().getHours()
  return h < 6 ? '늦은 밤이에요' : h < 12 ? '좋은 아침이에요' : h < 18 ? '좋은 오후예요' : '좋은 저녁이에요'
}

export function Dashboard({ openWork, go, goLibrary }: Props) {
  const items = useLiveQuery(() => db.items.toArray(), []) ?? []
  const plans = useLiveQuery(() => db.plans.toArray(), []) ?? []
  const ideaCount = useLiveQuery(() => db.ideas.count(), []) ?? 0
  const revenue = useLiveQuery(() => db.revenue.toArray(), []) ?? []
  const { leadDays } = useSettings()
  const [showDone, setShowDone] = useState(false)
  const [hideGuide, setHideGuide] = useState(() => { try { return localStorage.getItem('miri-hide-guide') === '1' } catch { return false } })
  const today = ymd()
  const month = today.slice(0, 7)

  const tasks = plans.filter((p) => p.kind === 'task')
  const todayTasks = tasks.filter((p) => !p.done && p.start <= today).sort((a, b) => a.start.localeCompare(b.start))
  const ready = items.filter((i) => i.status === 'ready').sort((a, b) => (a.readyAt ?? '').localeCompare(b.readyAt ?? ''))
  const reviewing = items.filter((i) => i.status === 'uploaded')
    .map((i) => ({ i, days: daysBetween(i.uploadedAt ?? i.updatedAt.slice(0, 10), today) }))
    .sort((a, b) => b.days - a.days)
  const making = items.filter((i) => i.status === 'making').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  // 다가오는 2주: 안 끝난 것 먼저, 끝난 것은 접어서 아래
  const upcoming = tasks.filter((p) => p.start > today && p.start <= addDays(today, 14))
  const upcomingTodo = upcoming.filter((p) => !p.done).sort((a, b) => a.start.localeCompare(b.start))
  const recentDone = tasks.filter((p) => p.done && p.start >= addDays(today, -7) && p.start <= addDays(today, 14)).sort((a, b) => b.start.localeCompare(a.start))
  const themes = plans.filter((p) => p.kind === 'theme' && p.start <= addDays(today, 14) && p.end >= today)

  const year = new Date().getFullYear()
  const seasons = [...seasonEvents(year), ...seasonEvents(year + 1)]
    .map((s) => ({ ...s, until: daysBetween(today, s.start) }))
    .filter((s) => s.until >= 0 && s.until <= leadDays + 30)
    .slice(0, 5)

  const uploadedMonth = items.filter((i) => i.uploadedAt?.startsWith(month)).length
  const monthRevenue = revenue.filter((r) => r.month === month).reduce((s, r) => s + r.amount, 0)

  const guide = [
    { done: ideaCount > 0 || plans.length > 0, title: '만들 거리 모으기', desc: '캘린더·아이디어에서 AI 추천이나 트렌드 서치로 주제를 모아요', go: () => go('calendar') },
    { done: items.length > 0, title: '첫 요소 만들기', desc: '작업대 4단계를 따라가면 규칙에 맞게 다듬고 검수까지 해줘요', go: () => openWork({}) },
    { done: items.some((i) => i.uploadedAt), title: '올리고 기록하기', desc: '디자인허브에 올린 뒤 상태를 “심사 중”으로 바꾸면 여기서 챙겨줘요', go: () => goLibrary('ready') },
  ]
  const showGuide = !hideGuide && guide.some((g) => !g.done)
  const summary = [
    todayTasks.length && `만들 것 ${todayTasks.length}개`,
    ready.length && `올릴 것 ${ready.length}개`,
    reviewing.length && `심사 결과 확인 ${reviewing.length}개`,
  ].filter(Boolean).join(' · ')

  return (
    <div className="home">
      <header className="home-head">
        <div>
          <p className="muted small">{new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })}</p>
          <h1>{greeting()} 👋</h1>
          <p className="muted">{summary ? `오늘은 ${summary}가 있어요.` : '오늘은 급한 일이 없어요. 새 요소를 만들어 볼까요?'}</p>
        </div>
        <div className="row">
          <button onClick={() => go('calendar')}><CalendarDays size={15} />캘린더</button>
          <button className="primary" onClick={() => openWork({})}><Sparkles size={15} />새 요소 만들기</button>
        </div>
      </header>

      {showGuide && (
        <div className="card col">
          <div className="row between">
            <h3 style={{ margin: 0 }}>이렇게 시작해요</h3>
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

      <section className="today">
        <TodayCard
          tone="make" icon={<Hammer size={18} />} title="오늘 만들 것" count={todayTasks.length + making.length}
          empty={<>오늘 잡힌 작업이 없어요.<button className="linkbtn" onClick={() => go('calendar')}>캘린더에서 잡기 →</button></>}
        >
          {todayTasks.slice(0, 4).map((p) => <TaskRow key={p.id} p={p} today={today} onGo={() => openWork({ topic: p.title, type: p.types[0], planId: p.id, notes: p.notes })} />)}
          {making.slice(0, Math.max(0, 4 - todayTasks.length)).map((i) => (
            <Row key={i.id} item={i} sub="만드는 중" action="이어서" onGo={() => openWork({ itemId: i.id })} />
          ))}
        </TodayCard>

        <TodayCard
          tone="upload" icon={<UploadCloud size={18} />} title="올릴 것" count={ready.length}
          empty="검수를 통과한 요소가 없어요."
          foot={ready.length > 0 && (
            <div className="row">
              <a href="https://designhub.miricanvas.com/ko/login" target="_blank" rel="noreferrer"><button className="small primary"><ExternalLink size={13} />디자인허브 열기</button></a>
              <button className="small" onClick={() => goLibrary('ready')}>보관함에서 보기</button>
            </div>
          )}
        >
          {ready.slice(0, 4).map((i) => <Row key={i.id} item={i} sub={i.readyAt ? `${md(i.readyAt.slice(0, 10))} 완성` : '완성'} action="열기" onGo={() => openWork({ itemId: i.id })} />)}
        </TodayCard>

        <TodayCard
          tone="review" icon={<Hourglass size={18} />} title="심사 결과 확인" count={reviewing.length}
          empty="심사 중인 요소가 없어요."
          foot={reviewing.length > 0 && <button className="small" onClick={() => goLibrary('uploaded')}>결과 입력하러 가기 →</button>}
        >
          {reviewing.slice(0, 4).map(({ i, days }) => (
            <Row key={i.id} item={i} sub={<span className={`badge ${days >= 14 ? 'bad' : days >= 7 ? 'warn' : ''}`}>{days}일째 기다림</span>} action="결과" onGo={() => goLibrary('uploaded')} />
          ))}
        </TodayCard>
      </section>

      <div className="grid g2">
        <div className="card col">
          <div className="row between">
            <h3 style={{ margin: 0 }}>다가오는 2주</h3>
            <button className="small ghost" onClick={() => go('calendar')}>캘린더 열기 <ArrowRight size={13} /></button>
          </div>
          {themes.length > 0 && <div className="row" style={{ gap: 4 }}>{themes.map((t) => <span key={t.id} className="chip theme" style={{ width: 'auto' }}>{t.title}</span>)}</div>}
          {upcomingTodo.length === 0 && <p className="small muted">2주 안에 잡힌 작업이 없어요. 캘린더에서 아이디어를 날짜로 끌어다 놓으세요.</p>}
          {upcomingTodo.map((p) => <TaskRow key={p.id} p={p} today={today} onGo={() => openWork({ topic: p.title, type: p.types[0], planId: p.id, notes: p.notes })} />)}
          {recentDone.length > 0 && (
            <>
              <button className="done-toggle" onClick={() => setShowDone(!showDone)}>
                <CheckCircle2 size={14} />완료 {recentDone.length}개 <ChevronDown size={14} style={{ transform: showDone ? 'rotate(180deg)' : undefined }} />
              </button>
              {showDone && recentDone.map((p) => <TaskRow key={p.id} p={p} today={today} />)}
            </>
          )}
        </div>

        <div className="card col">
          <h3 style={{ margin: 0 }}>지금 만들어야 할 시즌</h3>
          <p className="small muted">시즌 {leadDays}일 전까지 올려야 검색에 잡혀요.</p>
          {seasons.map((s) => (
            <div key={s.title + s.start} className="season-row">
              <div>
                <b>{s.title}</b> <span className="small muted">{md(s.start)} · D-{s.until}</span>
                <div className="small muted">{s.ideas.slice(0, 4).join(', ')}</div>
              </div>
              <span className={`badge ${s.until <= leadDays ? (s.until <= 14 ? 'bad' : 'warn') : ''}`}>
                {s.until <= 14 ? '늦음' : s.until <= leadDays ? '지금 제작' : '준비'}
              </span>
            </div>
          ))}
        </div>
      </div>

      <button className="mini-stats" onClick={() => go('stats')}>
        <span><b>{items.length}</b> 만든 요소</span>
        <span><b>{uploadedMonth}</b> 이번 달 업로드</span>
        <span><b>{items.filter((i) => i.status === 'approved').length}</b> 판매 중</span>
        <span><b>{fmtWon(monthRevenue)}</b> 이번 달 수익</span>
        <span className="muted">통계 자세히 <ArrowRight size={13} /></span>
      </button>
    </div>
  )
}

function TodayCard({ tone, icon, title, count, empty, foot, children }: {
  tone: 'make' | 'upload' | 'review'; icon: React.ReactNode; title: string; count: number; empty: React.ReactNode; foot?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className={`tcard t-${tone}`}>
      <div className="tc-head">
        <span className="tc-ic">{icon}</span>
        <b>{title}</b>
        <span className="tc-n">{count}</span>
      </div>
      <div className="tc-body">{count === 0 ? <p className="small muted tc-empty">{empty}</p> : children}</div>
      {foot && <div className="tc-foot">{foot}</div>}
    </div>
  )
}

function Row({ item, sub, action, onGo }: { item: Item; sub: React.ReactNode; action: string; onGo: () => void }) {
  return (
    <div className="trow">
      <TypeBadge type={item.type} />
      <span className="trow-t" title={item.title}>{item.title || '(제목 없음)'}</span>
      <span className="small muted">{sub}</span>
      <button className="small" onClick={onGo}>{action}</button>
    </div>
  )
}

function TaskRow({ p, today, onGo }: { p: Plan; today: string; onGo?: () => void }) {
  const late = !p.done && p.start < today
  return (
    <div className={`trow ${p.done ? 'is-done' : ''}`}>
      <span className={`small ${late ? 'late' : 'muted'}`} style={{ minWidth: 38 }}>{p.start === today ? '오늘' : md(p.start)}</span>
      <span className="trow-t" title={p.notes}>{p.done && '✓ '}{p.title}</span>
      {p.types.slice(0, 1).map((t) => <TypeBadge key={t} type={t} />)}
      {onGo && !p.done && <button className="small" onClick={onGo}>만들기</button>}
    </div>
  )
}
