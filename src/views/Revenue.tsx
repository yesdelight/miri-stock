import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { TypeBadge } from '../components/ui'
import { db, uid } from '../lib/db'
import { TYPE_LABEL, type ElementType } from '../lib/rules'
import { fmtWon, pad } from '../lib/utils'

export function Revenue() {
  const rev = useLiveQuery(() => db.revenue.orderBy('month').reverse().toArray(), []) ?? []
  const items = useLiveQuery(() => db.items.toArray(), []) ?? []
  const now = new Date()
  const [month, setMonth] = useState(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`)
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')

  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
  })
  const sum = (m: string) => rev.filter((r) => r.month === m).reduce((s, r) => s + r.amount, 0)
  const max = Math.max(1, ...months.map(sum))
  const total = rev.reduce((s, r) => s + r.amount, 0)
  const approved = items.filter((i) => i.status === 'approved')
  const approvedByMonth = (m: string) => items.filter((i) => i.approvedAt?.startsWith(m) || (i.status === 'approved' && !i.approvedAt && i.uploadedAt?.startsWith(m))).length
  const rejected = items.filter((i) => i.status === 'rejected')
  const reasons = rejected.reduce<Record<string, number>>((acc, i) => { const k = i.rejectReason?.trim() || '(사유 미기록)'; acc[k] = (acc[k] ?? 0) + 1; return acc }, {})

  const add = async () => {
    const n = Number(amount.replace(/[^\d.-]/g, ''))
    if (!n) return
    await db.revenue.add({ id: uid(), month, amount: n, memo: memo || undefined })
    setAmount(''); setMemo('')
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid g4">
        <div className="card stat"><span className="l">누적 수익</span><span className="v">{fmtWon(total)}</span></div>
        <div className="card stat"><span className="l">이번 달</span><span className="v">{fmtWon(sum(months[11]))}</span><span className="small muted">지난달 {fmtWon(sum(months[10]))}</span></div>
        <div className="card stat"><span className="l">판매 중 요소</span><span className="v">{approved.length}</span></div>
        <div className="card stat"><span className="l">요소당 누적 수익</span><span className="v">{approved.length ? fmtWon(total / approved.length) : '-'}</span></div>
      </div>

      <div className="grid g2">
        <div className="card">
          <h3>월별 수익 (최근 12개월)</h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 150 }} role="img" aria-label="월별 수익 막대">
            {months.map((m) => (
              <div key={m} title={`${m}: ${fmtWon(sum(m))} · 승인 ${approvedByMonth(m)}개`} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                <div style={{ height: `${(sum(m) / max) * 100}%`, minHeight: sum(m) ? 3 : 1, background: sum(m) ? 'var(--ok)' : 'var(--line)', borderRadius: '3px 3px 0 0' }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {months.map((m) => <span key={m} className="small muted" style={{ flex: 1, textAlign: 'center' }}>{Number(m.slice(5))}월</span>)}
          </div>
        </div>
        <div className="card col">
          <h3>수익 기록 추가</h3>
          <p className="small muted">디자인허브 정산 내역을 월별로 적어 두세요.</p>
          <div className="row">
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            <input placeholder="금액(원)" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 120 }} />
            <input className="grow" placeholder="메모" value={memo} onChange={(e) => setMemo(e.target.value)} />
            <button className="primary" onClick={add}>추가</button>
          </div>
          <table>
            <thead><tr><th>월</th><th>금액</th><th>메모</th><th /></tr></thead>
            <tbody>
              {rev.slice(0, 24).map((r) => (
                <tr key={r.id}><td>{r.month}</td><td>{fmtWon(r.amount)}</td><td className="small">{r.memo}</td>
                  <td><button className="ghost small danger" onClick={() => db.revenue.delete(r.id)}>✕</button></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid g2">
        <div className="card">
          <h3>타입별 성과</h3>
          <table>
            <thead><tr><th>타입</th><th>올림</th><th>판매 중</th><th>승인률</th></tr></thead>
            <tbody>
              {(Object.keys(TYPE_LABEL) as ElementType[]).map((t) => {
                const up = items.filter((i) => i.type === t && i.uploadedAt)
                const ok = up.filter((i) => i.status === 'approved').length
                const no = up.filter((i) => i.status === 'rejected').length
                return <tr key={t}><td><TypeBadge type={t} /></td><td>{up.length}</td><td>{ok}</td><td>{ok + no ? `${Math.round((ok / (ok + no)) * 100)}%` : '-'}</td></tr>
              })}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>거부 사유 모아보기</h3>
          {rejected.length === 0 && <p className="small muted">거부된 요소가 없어요.</p>}
          <table><tbody>
            {Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => <tr key={k}><td className="small">{k}</td><td>{n}</td></tr>)}
          </tbody></table>
        </div>
      </div>
    </div>
  )
}
