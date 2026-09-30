// 통계·수익: 진행 흐름, 심사 대기, 타입·테마별 성과, 거부 사유, 수익 기록
import { useLiveQuery } from 'dexie-react-hooks'
import { BarChart3, Clock, Hourglass, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import { toast } from '../components/toast'
import { Tabs, TypeBadge } from '../components/ui'
import { db, nowIso, STATUS_LABEL, type Item, type ItemStatus } from '../lib/db'
import { TYPE_LABEL, type ElementType } from '../lib/rules'
import { addDays, daysBetween, fmtWon, ymd } from '../lib/utils'
import { Revenue } from './Revenue'

const STATUSES = Object.keys(STATUS_LABEL) as ItemStatus[]
const TYPES = Object.keys(TYPE_LABEL) as ElementType[]
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '-')

export function Stats() {
  const [tab, setTab] = useState<'stats' | 'revenue'>('stats')
  return (
    <div className="col" style={{ gap: 4 }}>
      <Tabs tabs={[{ id: 'stats', label: '통계' }, { id: 'revenue', label: '수익 기록' }]} value={tab} onChange={setTab} />
      {tab === 'stats' ? <StatsBody /> : <Revenue />}
    </div>
  )
}

function StatsBody() {
  const items = useLiveQuery(() => db.items.toArray(), []) ?? []
  const revenue = useLiveQuery(() => db.revenue.toArray(), []) ?? []
  const today = ymd()
  const month = today.slice(0, 7)
  const uploaded = items.filter((i) => i.uploadedAt)
  const approved = items.filter((i) => i.status === 'approved')
  const rejected = items.filter((i) => i.status === 'rejected')
  const decided = approved.length + rejected.length
  const totalRev = revenue.reduce((s, r) => s + r.amount, 0)

  if (!items.length) {
    return (
      <div className="lib-empty" style={{ marginTop: 12 }}>
        <BarChart3 size={36} />
        <b>아직 통계를 낼 요소가 없어요</b>
        <p className="small muted">요소를 만들고 업로드하면 여기에서 흐름과 성과를 볼 수 있어요.</p>
      </div>
    )
  }

  const last30 = Array.from({ length: 30 }, (_, i) => addDays(today, i - 29))
  const perDay = last30.map((d) => ({ d, n: uploaded.filter((i) => i.uploadedAt === d).length }))
  const maxDay = Math.max(1, ...perDay.map((p) => p.n))
  const maxStatus = Math.max(1, ...STATUSES.map((s) => items.filter((i) => i.status === s).length))

  const waiting = items.filter((i) => i.status === 'uploaded')
    .map((i) => ({ i, days: daysBetween(i.uploadedAt ?? i.updatedAt.slice(0, 10), today) }))
    .sort((a, b) => b.days - a.days)

  const byTheme = new Map<string, Item[]>()
  for (const i of items) {
    const k = (i.theme || i.title || '(주제 없음)').trim()
    byTheme.set(k, [...(byTheme.get(k) ?? []), i])
  }
  const themes = [...byTheme.entries()]
    .map(([k, list]) => ({ k, made: list.length, up: list.filter((i) => i.uploadedAt).length, ok: list.filter((i) => i.status === 'approved').length, no: list.filter((i) => i.status === 'rejected').length }))
    .sort((a, b) => b.ok - a.ok || b.up - a.up || b.made - a.made)
    .slice(0, 8)

  const reasons = rejected.reduce<Record<string, number>>((acc, i) => { const k = i.rejectReason?.trim() || '(사유 미기록)'; acc[k] = (acc[k] ?? 0) + 1; return acc }, {})

  const setStatus = async (it: Item, to: ItemStatus) => {
    await db.items.update(it.id, { status: to, updatedAt: nowIso(), ...(to === 'approved' ? { approvedAt: ymd() } : {}) })
    toast(`“${it.title}” → ${STATUS_LABEL[to]}`)
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid g4">
        <Kpi icon={<TrendingUp size={16} />} l="만든 요소" v={items.length} sub={`이번 달 ${items.filter((i) => i.createdAt.startsWith(month)).length}개`} />
        <Kpi icon={<Clock size={16} />} l="올린 요소" v={uploaded.length} sub={`이번 달 ${uploaded.filter((i) => i.uploadedAt!.startsWith(month)).length}개`} />
        <Kpi icon={<BarChart3 size={16} />} l="승인률" v={pct(approved.length, decided)} sub={`판매 중 ${approved.length} · 거부 ${rejected.length}`} />
        <Kpi icon={<TrendingUp size={16} />} l="누적 수익" v={fmtWon(totalRev)} sub={approved.length ? `판매 요소당 ${fmtWon(totalRev / approved.length)}` : '판매 중 요소 없음'} />
      </div>

      <div className="grid g2">
        <div className="card">
          <h3>진행 흐름</h3>
          <div className="col" style={{ gap: 8 }}>
            {STATUSES.map((s) => {
              const n = items.filter((i) => i.status === s).length
              return (
                <div key={s} className="flow-row">
                  <span className="flow-l"><i className={`dot st-${s}`} />{STATUS_LABEL[s]}</span>
                  <div className="flow-bar"><span className={`st-${s}`} style={{ width: `${(n / maxStatus) * 100}%` }} /></div>
                  <b className="flow-n">{n}</b>
                </div>
              )
            })}
          </div>
        </div>
        <div className="card">
          <h3>최근 30일 업로드</h3>
          <div className="bars" role="img" aria-label="최근 30일 일별 업로드 수">
            {perDay.map((p) => (
              <div key={p.d} className="bar-col" title={`${p.d}: ${p.n}개`}>
                <div className="bar-fill" style={{ height: `${(p.n / maxDay) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="row between small muted"><span>{last30[0].slice(5)}</span><span>하루 최대 {maxDay}개</span><span>오늘</span></div>
        </div>
      </div>

      <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}><Hourglass size={16} style={{ verticalAlign: -2 }} /> 심사 기다리는 중 ({waiting.length})</h3><span className="small muted">결과가 나오면 바로 여기서 바꿔요</span></div>
        {waiting.length === 0 ? <p className="small muted mt">심사 중인 요소가 없어요.</p> : (
          <table className="mt">
            <thead><tr><th>요소</th><th>올린 날</th><th>기다린 날</th><th style={{ textAlign: 'right' }}>결과</th></tr></thead>
            <tbody>
              {waiting.map(({ i, days }) => (
                <tr key={i.id}>
                  <td><TypeBadge type={i.type} /> {i.title}</td>
                  <td className="small">{i.uploadedAt}</td>
                  <td><span className={`badge ${days >= 14 ? 'bad' : days >= 7 ? 'warn' : ''}`}>{days}일째</span></td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="small" onClick={() => setStatus(i, 'approved')}><i className="dot st-approved" />판매 중</button>{' '}
                    <button className="small" onClick={() => setStatus(i, 'rejected')}><i className="dot st-rejected" />거부됨</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid g2">
        <div className="card">
          <h3>타입별 성과</h3>
          <table>
            <thead><tr><th>타입</th><th>만듦</th><th>올림</th><th>판매 중</th><th>승인률</th><th>수익</th></tr></thead>
            <tbody>
              {TYPES.map((t) => {
                const ti = items.filter((i) => i.type === t)
                const ok = ti.filter((i) => i.status === 'approved').length
                const no = ti.filter((i) => i.status === 'rejected').length
                const rv = revenue.filter((r) => r.type === t).reduce((s, r) => s + r.amount, 0)
                return (
                  <tr key={t}>
                    <td><TypeBadge type={t} /></td><td>{ti.length}</td><td>{ti.filter((i) => i.uploadedAt).length}</td>
                    <td>{ok}</td><td>{pct(ok, ok + no)}</td><td className="small">{rv ? fmtWon(rv) : '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="small muted mt">수익은 “수익 기록”에서 타입을 고른 것만 합쳐요.</p>
        </div>
        <div className="card">
          <h3>잘 되는 주제 TOP 8</h3>
          <table>
            <thead><tr><th>주제</th><th>만듦</th><th>올림</th><th>판매 중</th><th>승인률</th></tr></thead>
            <tbody>
              {themes.map((t) => (
                <tr key={t.k}><td className="small">{t.k}</td><td>{t.made}</td><td>{t.up}</td><td><b>{t.ok}</b></td><td>{pct(t.ok, t.ok + t.no)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>거부 사유 모아보기</h3>
        {rejected.length === 0 ? <p className="small muted">거부된 요소가 없어요. 👏</p> : (
          <div className="col" style={{ gap: 6 }}>
            {Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
              <div key={k} className="flow-row">
                <span className="flow-l small" style={{ width: 'auto', flex: 1 }}>{k}</span>
                <b className="flow-n">{n}</b>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Kpi({ icon, l, v, sub }: { icon: React.ReactNode; l: string; v: number | string; sub?: string }) {
  return (
    <div className="card stat">
      <span className="l row" style={{ gap: 6 }}>{icon}{l}</span>
      <span className="v">{v}</span>
      {sub && <span className="small muted">{sub}</span>}
    </div>
  )
}
