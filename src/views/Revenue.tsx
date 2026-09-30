// 수익 기록 — 디자인허브 정산 내역을 월별로 입력
import { useLiveQuery } from 'dexie-react-hooks'
import { Trash2, Wallet } from 'lucide-react'
import { useState } from 'react'
import { TypeBadge } from '../components/ui'
import { db, uid } from '../lib/db'
import { TYPE_LABEL, type ElementType } from '../lib/rules'
import { fmtWon, pad } from '../lib/utils'

export function Revenue() {
  const rev = useLiveQuery(() => db.revenue.orderBy('month').reverse().toArray(), []) ?? []
  const now = new Date()
  const [month, setMonth] = useState(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`)
  const [amount, setAmount] = useState('')
  const [type, setType] = useState<'' | ElementType>('')
  const [memo, setMemo] = useState('')

  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
  })
  const sum = (m: string) => rev.filter((r) => r.month === m).reduce((s, r) => s + r.amount, 0)
  const max = Math.max(1, ...months.map(sum))
  const total = rev.reduce((s, r) => s + r.amount, 0)

  const add = async () => {
    const n = Number(amount.replace(/[^\d.-]/g, ''))
    if (!n) return
    await db.revenue.add({ id: uid(), month, amount: n, memo: memo || undefined, type: type || undefined })
    setAmount(''); setMemo('')
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid g3">
        <div className="card stat"><span className="l">누적 수익</span><span className="v">{fmtWon(total)}</span></div>
        <div className="card stat"><span className="l">이번 달</span><span className="v">{fmtWon(sum(months[11]))}</span><span className="small muted">지난달 {fmtWon(sum(months[10]))}</span></div>
        <div className="card stat"><span className="l">최근 12개월 평균</span><span className="v">{fmtWon(months.reduce((s, m) => s + sum(m), 0) / 12)}</span></div>
      </div>

      <div className="grid g2">
        <div className="card col">
          <h3 style={{ margin: 0 }}>수익 기록 추가</h3>
          <p className="small muted">디자인허브 정산 내역을 월별로 적어 두세요. 타입을 고르면 통계에서 어떤 타입이 잘 버는지 보여요.</p>
          <div className="rev-form">
            <label>월<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
            <label>금액(원)<input placeholder="예: 12000" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /></label>
            <label>타입(선택)
              <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                <option value="">전체·모름</option>
                {(Object.keys(TYPE_LABEL) as ElementType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
            </label>
            <label className="grow">메모<input placeholder="예: 9월 정산" value={memo} onChange={(e) => setMemo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /></label>
          </div>
          <button className="primary" style={{ alignSelf: 'flex-start' }} onClick={add} disabled={!amount.trim()}>추가</button>
        </div>

        <div className="card">
          <h3>월별 수익 (최근 12개월)</h3>
          <div className="bars" role="img" aria-label="월별 수익 막대">
            {months.map((m) => (
              <div key={m} className="bar-col" title={`${m}: ${fmtWon(sum(m))}`}>
                <div className="bar-fill ok" style={{ height: `${(sum(m) / max) * 100}%` }} />
                <span>{Number(m.slice(5))}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>기록</h3>
        {rev.length === 0 ? (
          <div className="empty-mini"><Wallet size={28} /><span>아직 기록이 없어요. 첫 정산을 받으면 위에서 추가해 보세요.</span></div>
        ) : (
          <table>
            <thead><tr><th>월</th><th>금액</th><th>타입</th><th>메모</th><th /></tr></thead>
            <tbody>
              {rev.map((r) => (
                <tr key={r.id}>
                  <td>{r.month}</td><td><b>{fmtWon(r.amount)}</b></td>
                  <td>{r.type ? <TypeBadge type={r.type} /> : <span className="muted small">-</span>}</td>
                  <td className="small">{r.memo}</td>
                  <td><button className="ghost small danger" title="삭제" onClick={() => db.revenue.delete(r.id)}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
