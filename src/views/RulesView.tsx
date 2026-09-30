import { TypeBadge } from '../components/ui'
import { ASPECTS, CROP_MARGIN_MAX_RATIO, GROUP_LABEL, PROMPT_RULES, RULES, SPECS, SVG_MAX_COLORS, TYPE_LABEL, type ElementType, type Rule } from '../lib/rules'

const MODE: Record<Rule['mode'], { label: string; cls: string }> = {
  auto: { label: '자동 검사', cls: 'ok' },
  ai: { label: 'AI 검수 + 직접 확인', cls: 'accent' },
  manual: { label: '직접 확인', cls: '' },
}

export function RulesView() {
  const types = Object.keys(TYPE_LABEL) as ElementType[]
  return (
    <div className="col" style={{ gap: 16, maxWidth: 1000 }}>
      <div>
        <h1>규칙</h1>
        <p className="muted small">모든 요소는 작업대 마지막 단계에서 아래 규칙을 전부 통과해야 “업로드 준비 완료”가 돼요. 규칙 원본: <code>src/lib/rules.ts</code> · <code>RULES.md</code></p>
      </div>

      <div className="card">
        <h3>파일 규격</h3>
        <table>
          <thead><tr><th>타입</th><th>확장자</th><th>최소 DPI</th><th>최소 px(긴 변)</th><th>최대 px</th><th>최대 용량</th></tr></thead>
          <tbody>
            {types.map((t) => {
              const s = SPECS[t]
              return (
                <tr key={t}>
                  <td><TypeBadge type={t} /></td><td>{s.ext.toUpperCase()}</td><td>{s.minDpi ?? '-'}</td>
                  <td>{s.minPxSmall ? `${s.minPxSmall} (아이콘·이모티콘·캐릭터) / ${s.minPx} (그 외)` : s.minPx ?? '-'}</td>
                  <td>{s.maxPx ?? '-'}</td><td>{s.maxMB < 1 ? `${s.maxMB * 1000}KB` : `${s.maxMB}MB`}{s.maxSeconds ? ` (${s.maxSeconds}초 이내)` : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="small muted mt">SVG 색상 {SVG_MAX_COLORS}개 이하 · 요소 크롭 여백은 긴 변의 {CROP_MARGIN_MAX_RATIO * 100}% 이하 · 배경 비율: {ASPECTS.map((a) => a.id).join(', ')}</p>
      </div>

      {(Object.keys(GROUP_LABEL) as Rule['group'][]).map((g) => (
        <div key={g} className="card">
          <h3>{GROUP_LABEL[g]}</h3>
          <div className="checklist">
            {RULES.filter((r) => r.group === g).map((r) => (
              <div key={r.id} className="check">
                <span className={`badge ${MODE[r.mode].cls}`} style={{ gridColumn: '1 / -1', justifySelf: 'start' }}>{MODE[r.mode].label}</span>
                <div style={{ gridColumn: '1 / -1' }}>
                  <div>{r.text}</div>
                  {r.detail && <div className="detail">{r.detail}</div>}
                  <div className="row" style={{ gap: 4, marginTop: 4 }}>
                    {(r.types === 'all' ? types : r.types).map((t) => <TypeBadge key={t} type={t} />)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="card">
        <h3>AI 프롬프트에 자동으로 들어가는 규칙</h3>
        {types.map((t) => (
          <details key={t}>
            <summary><TypeBadge type={t} /></summary>
            <pre className="small pre">{PROMPT_RULES[t]}</pre>
          </details>
        ))}
      </div>
    </div>
  )
}
