// AI 작업 실행기: API 키가 있으면 바로 호출, 없으면 구독 계정(ChatGPT Plus / Gemini Pro / Claude Pro)에
// 프롬프트를 복사해 붙여넣고 답변을 다시 붙여넣는 수동 모드.
import { useState } from 'react'
import { aiText, CHAT_URL, PROVIDER_LABEL, type AiRequest } from '../lib/ai'
import { hasTextApi, useSettings, type Provider } from '../lib/settings'
import { copyText } from '../lib/utils'

interface Props {
  label: string
  build: () => AiRequest
  onResult: (text: string) => void | Promise<void>
  disabled?: boolean
  /** 수동 모드에서 이미지 첨부가 필요한 경우 안내 */
  needsImage?: boolean
  primary?: boolean
}

export function AiRunner({ label, build, onResult, disabled, needsImage, primary }: Props) {
  const s = useSettings()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [manual, setManual] = useState<AiRequest | null>(null)
  const [paste, setPaste] = useState('')
  const api = hasTextApi(s)

  const run = async () => {
    setErr('')
    const req = build()
    if (!api) { setManual(req); setPaste(''); return }
    setBusy(true)
    try {
      await onResult(await aiText(req))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const fullPrompt = manual ? `${manual.system}\n\n---\n\n${manual.prompt}${manual.webSearch ? '\n\n(웹 검색을 사용해서 최신 정보로 답해줘.)' : ''}` : ''

  const apply = async () => {
    setErr('')
    try {
      await onResult(paste)
      setManual(null)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row">
        <button className={primary ? 'primary' : ''} onClick={run} disabled={disabled || busy}>
          {busy ? '생각 중…' : `✨ ${label}`}
        </button>
        <span className="muted small">{api ? `${PROVIDER_LABEL[s.textProvider]} API` : '구독 계정 수동 모드'}</span>
      </div>
      {err && <div className="note bad small">{err}</div>}
      {manual && (
        <div className="note info col">
          <b>① 프롬프트 복사 → ② 채팅에 붙여넣기{needsImage ? ' (이미지 파일도 첨부)' : ''} → ③ 답변 전체를 아래에 붙여넣기</b>
          <div className="row">
            <button className="small" onClick={() => copyText(fullPrompt)}>📋 프롬프트 복사</button>
            {(Object.keys(CHAT_URL) as Provider[]).map((p) => (
              <a key={p} href={CHAT_URL[p]} target="_blank" rel="noreferrer">
                <button className="small">{PROVIDER_LABEL[p]} 열기 ↗</button>
              </a>
            ))}
          </div>
          <details>
            <summary className="small muted">프롬프트 보기</summary>
            <textarea readOnly rows={8} value={fullPrompt} />
          </details>
          <textarea rows={5} placeholder="AI 답변을 여기에 붙여넣기 (```json 블록 포함 그대로)" value={paste} onChange={(e) => setPaste(e.target.value)} />
          <div className="row">
            <button className="primary small" onClick={apply} disabled={!paste.trim()}>적용</button>
            <button className="small ghost" onClick={() => setManual(null)}>취소</button>
          </div>
        </div>
      )}
    </div>
  )
}
