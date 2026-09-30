// 시작 화면(로딩)과 새 버전 알림
import { useEffect, useState } from 'react'
import { db, migrateBlobs } from '../lib/db'
import { toast } from './toast'

export function Splash({ msg, hide }: { msg: string; hide?: boolean }) {
  return (
    <div className={`splash ${hide ? 'hide' : ''}`} aria-busy={!hide} aria-live="polite">
      <div className="logo">
        <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M9 8l7 8 7-8M16 16v9" fill="none" stroke="#fff" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" /></svg>
      </div>
      <div className="name">YESDELIGHT Stock</div>
      <div className="sub">Stock Studio · 요소 작업실</div>
      <div className="bar"><span /></div>
      <div className="msg">{msg}</div>
    </div>
  )
}

/** 앱 시작 준비: 저장소 열기 + 예전 형식 파일 정리. 최소 0.7초는 시작 화면을 보여줌 */
export function useBoot() {
  const [msg, setMsg] = useState('작업실 여는 중…')
  const [phase, setPhase] = useState<'loading' | 'fading' | 'done'>('loading')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const t0 = performance.now()
      let lost = 0
      try {
        await db.open()
        setMsg('저장된 작업 확인 중…')
        const r = await migrateBlobs((d, t) => alive && t > 3 && setMsg(`저장된 파일 정리 중… ${d}/${t}`))
        lost = r.lost
      } catch (e) {
        console.error(e)
        setMsg('저장소를 여는 중 문제가 있었어요. 그래도 계속할게요.')
      }
      const wait = Math.max(0, 700 - (performance.now() - t0))
      await new Promise((r) => setTimeout(r, wait))
      if (!alive) return
      setPhase('fading')
      setTimeout(() => alive && setPhase('done'), 380)
      if (lost) toast(`읽을 수 없는 파일이 있는 요소가 ${lost}개 있어요. 보관함에서 ⚠️ 표시된 요소를 열면 다시 만드는 방법을 알려줘요.`, 'info')
    })()
    return () => { alive = false }
  }, [])

  return { msg, phase }
}

/** 배포된 최신 버전과 지금 실행 중인 버전이 다르면 새로고침 안내 (웹앱이 옛 파일을 붙잡고 있을 때 대비) */
export function UpdateBanner() {
  const [outdated, setOutdated] = useState(false)
  useEffect(() => {
    const current = document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/index-"]')?.getAttribute('src') ?? ''
    if (!current) return // 개발 모드
    const check = async () => {
      try {
        const html = await (await fetch(`./index.html?v=${Date.now()}`, { cache: 'no-store' })).text()
        const latest = html.match(/assets\/index-[\w-]+\.js/)?.[0]
        if (latest && !current.includes(latest)) setOutdated(true)
      } catch { /* 오프라인 등 — 무시 */ }
    }
    check()
    const onVisible = () => document.visibilityState === 'visible' && check()
    document.addEventListener('visibilitychange', onVisible)
    const t = setInterval(check, 10 * 60 * 1000)
    return () => { document.removeEventListener('visibilitychange', onVisible); clearInterval(t) }
  }, [])
  if (!outdated) return null
  return (
    <div className="update-banner" role="status">
      <span>✨ 새 버전이 나왔어요.</span>
      <button className="small primary" onClick={() => location.reload()}>지금 적용하기</button>
    </div>
  )
}
