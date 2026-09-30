// AI 작업 실행기: API 키가 있으면 바로 호출, 없으면 구독 계정(ChatGPT Plus / Gemini Pro / Claude Pro)에
// 프롬프트를 복사해 붙여넣고 답변을 다시 붙여넣는 수동 모드.
import { useState } from 'react'
import { aiText, CHAT_URL, PROVIDER_LABEL, type AiRequest } from '../lib/ai'
import { hasTextApi, updateSettings, useSettings, type Provider } from '../lib/settings'
import { copyText } from '../lib/utils'
import { toast } from './toast'

interface Props {
  label: string
  build: () => AiRequest
  onResult: (text: string) => void | Promise<void>
  disabled?: boolean
  /** 수동 모드에서 이미지 첨부가 필요한 경우 안내 */
  needsImage?: boolean
  primary?: boolean
  /** 완료 후 알림 문구 */
  doneText?: string
}

export function AiRunner({ label, build, onResult, disabled, needsImage, primary, doneText }: Props) {
  const s = useSettings()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [manual, setManual] = useState<AiRequest | null>(null)
  const [paste, setPaste] = useState('')
  const [showBox, setShowBox] = useState(false)
  const api = hasTextApi(s)

  const finish = async (text: string) => {
    await onResult(text)
    toast(doneText ?? `${label} 완료!`)
  }

  const run = async () => {
    setErr('')
    const req = build()
    if (!api) { setManual(req); setPaste(''); setShowBox(false); return }
    setBusy(true)
    try {
      await finish(await aiText(req))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const fullPrompt = manual
    ? `${manual.system}\n\n---\n\n${manual.prompt}${manual.webSearch ? '\n\n(웹 검색을 사용해서 최신 정보로 답해줘.)' : ''}`
    : ''

  const sendTo = async (p: Provider) => {
    updateSettings({ manualChat: p })
    const ok = await copyText(fullPrompt)
    window.open(CHAT_URL[p], '_blank', 'noopener')
    toast(ok ? `복사했어요! ${PROVIDER_LABEL[p]} 입력창에 붙여넣기(⌘V / Ctrl+V) 하세요.` : '복사가 막혔어요. 아래 “프롬프트 보기”에서 직접 복사하세요.', ok ? 'info' : 'bad')
  }

  const apply = async (text: string) => {
    setErr('')
    try {
      await finish(text)
      setManual(null)
    } catch (e) {
      setErr(`답변을 읽지 못했어요. 답변 전체(코드 블록 포함)를 복사했는지 확인해 주세요. (${(e as Error).message})`)
      setShowBox(true)
      setPaste(text)
    }
  }

  const pasteFromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText()
      if (!t.trim()) throw new Error('empty')
      await apply(t)
    } catch {
      setShowBox(true)
      toast('클립보드를 읽을 수 없어서 입력칸을 열었어요. 여기에 붙여넣어 주세요.', 'info')
    }
  }

  const others = (Object.keys(CHAT_URL) as Provider[]).filter((p) => p !== s.manualChat)

  return (
    <div className="col" style={{ gap: 6 }}>
      <button className={primary ? 'primary' : ''} onClick={run} disabled={disabled || busy} style={{ alignSelf: 'flex-start' }}>
        {busy ? '⏳ AI가 생각 중…' : `✨ ${label}`}
      </button>
      {err && <div className="note bad small">{err}</div>}
      {manual && (
        <div className="manual">
          <div className="manual-step">
            <span className="num">1</span>
            <div className="col" style={{ gap: 6 }}>
              <b>AI에게 보내기</b>
              <div className="row">
                <button className="primary small" onClick={() => sendTo(s.manualChat)}>📋 복사하고 {PROVIDER_LABEL[s.manualChat]} 열기</button>
                {others.map((p) => <button key={p} className="small" onClick={() => sendTo(p)}>{PROVIDER_LABEL[p]}</button>)}
              </div>
              <span className="small muted">열린 창에 붙여넣고 보내세요{needsImage ? '. 검수할 이미지 파일도 같이 첨부해요' : ''}.</span>
            </div>
          </div>
          <div className="manual-step">
            <span className="num">2</span>
            <div className="col" style={{ gap: 6 }}>
              <b>답변 가져오기</b>
              <span className="small muted">AI 답변 아래 복사 버튼(📋)으로 답변 전체를 복사한 뒤 👇</span>
              <div className="row">
                <button className="primary small" onClick={pasteFromClipboard}>📥 복사한 답변 붙여넣기</button>
                <button className="small ghost" onClick={() => setShowBox(!showBox)}>직접 붙여넣기</button>
              </div>
              {showBox && (
                <>
                  <textarea rows={5} placeholder="AI 답변 전체를 여기에 붙여넣기" value={paste} onChange={(e) => setPaste(e.target.value)} autoFocus />
                  <button className="small primary" style={{ alignSelf: 'flex-start' }} onClick={() => apply(paste)} disabled={!paste.trim()}>적용</button>
                </>
              )}
            </div>
          </div>
          <div className="row between">
            <details>
              <summary className="small muted">프롬프트 보기</summary>
              <textarea readOnly rows={6} value={fullPrompt} />
            </details>
            <button className="small ghost" onClick={() => setManual(null)}>닫기</button>
          </div>
        </div>
      )}
    </div>
  )
}
