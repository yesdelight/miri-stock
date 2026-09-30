import { useLiveQuery } from 'dexie-react-hooks'
import { BarChart3, CalendarDays, FolderOpen, Globe, Home, Keyboard, Monitor, Moon, Plus, Ruler, Settings, Store, Sun, Wrench, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Splash, UpdateBanner, useBoot } from './components/Boot'
import { Toasts } from './components/toast'
import { Modal } from './components/ui'
import { db, type ItemStatus } from './lib/db'
import { updateSettings, useSettings } from './lib/settings'
import { Dashboard } from './views/Dashboard'
import { Library } from './views/Library'
import { Planner } from './views/Planner'
import { RulesView } from './views/RulesView'
import { SettingsView } from './views/SettingsView'
import { Stats } from './views/Stats'
import { Workbench, type WorkbenchStart } from './views/Workbench'

export type View = 'home' | 'calendar' | 'work' | 'library' | 'stats' | 'rules' | 'settings'

const NAV: { id: View; label: string; icon: LucideIcon }[] = [
  { id: 'home', label: '홈', icon: Home },
  { id: 'calendar', label: '캘린더·아이디어', icon: CalendarDays },
  { id: 'work', label: '작업대', icon: Wrench },
  { id: 'library', label: '보관함', icon: FolderOpen },
  { id: 'stats', label: '통계·수익', icon: BarChart3 },
]

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null
  return !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))
}

export default function App() {
  const boot = useBoot()
  const s = useSettings()
  const waiting = useLiveQuery(() => db.items.where('status').equals('ready').count(), []) ?? 0
  const [view, setView] = useState<View>('home')
  const [start, setStart] = useState<WorkbenchStart>({ key: 0 })
  const [keysOpen, setKeysOpen] = useState(false)
  const [lib, setLib] = useState<{ key: number; status?: ItemStatus }>({ key: 0 })
  const goLibrary = (status?: ItemStatus) => { setLib({ key: Date.now(), status }); setView('library') }

  const openWork = (w: Omit<WorkbenchStart, 'key'>) => {
    setStart({ ...w, key: Date.now() })
    setView('work')
  }

  // 테마 적용
  useEffect(() => {
    const el = document.documentElement
    if (s.theme === 'auto') delete el.dataset.theme
    else el.dataset.theme = s.theme
  }, [s.theme])

  // 전역 단축키: N 새 요소, 1~5 메뉴, ? 단축키 보기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return
      if (e.key === 'n' || e.key === 'N' || e.key === 'ㅜ') { e.preventDefault(); setStart({ key: Date.now() }); setView('work') }
      else if (/^[1-5]$/.test(e.key)) setView(NAV[Number(e.key) - 1].id)
      else if (e.key === '?') setKeysOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (boot.phase === 'loading') return <><Splash msg={boot.msg} /><Toasts /></>

  const ThemeIcon = s.theme === 'dark' ? Moon : s.theme === 'light' ? Sun : Monitor
  const nextTheme = { auto: 'light', light: 'dark', dark: 'auto' } as const

  return (
    <div className="app">
      {boot.phase === 'fading' && <Splash msg={boot.msg} hide />}
      <UpdateBanner />
      <nav className="nav">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32"><path d="M9 8l7 8 7-8M16 16v9" fill="none" stroke="#fff" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" /></svg>
          </span>
          <span className="brand-name">YESDELIGHT<small>Stock Studio</small></span>
        </div>
        <button className="newbtn" onClick={() => openWork({})} title="새 요소 만들기 (N)"><Plus size={16} />새 요소 만들기</button>
        {NAV.map((n, i) => (
          <button key={n.id} className={`navbtn ${view === n.id ? 'active' : ''}`} onClick={() => setView(n.id)} title={`${n.label} (${i + 1})`}>
            <n.icon size={17} strokeWidth={2} />
            <span className="grow">{n.label}</span>
            {n.id === 'library' && waiting > 0 && <span className="navcount" title="업로드 대기 중인 요소">{waiting}</span>}
          </button>
        ))}
        <div className="spacer" />
        <a className="navbtn" href="https://designhub.miricanvas.com/ko/login" target="_blank" rel="noreferrer" title="미리캔버스 디자인허브(새 창)">
          <Globe size={17} /><span className="grow">디자인허브</span><span className="muted small">↗</span>
        </a>
        <a className="navbtn" href="https://www.tooldi.com/creator/channel/MjE0NTU0" target="_blank" rel="noreferrer" title="툴디 크리에이터 채널(새 창)">
          <Store size={17} /><span className="grow">툴디</span><span className="muted small">↗</span>
        </a>
        <button className={`navbtn ${view === 'rules' ? 'active' : ''}`} onClick={() => setView('rules')}><Ruler size={17} /><span className="grow">규칙</span></button>
        <button className={`navbtn ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}><Settings size={17} /><span className="grow">설정</span></button>
        <div className="nav-foot">
          <button className="iconbtn" title={`테마: ${{ auto: '자동', light: '라이트', dark: '다크' }[s.theme]} (눌러서 바꾸기)`} onClick={() => updateSettings({ theme: nextTheme[s.theme] })}><ThemeIcon size={16} /></button>
          <button className="iconbtn" title="단축키 (?)" onClick={() => setKeysOpen(true)}><Keyboard size={16} /></button>
          <span className="version" title="앱 버전(배포 시각·커밋)">v {__BUILD__}</span>
        </div>
      </nav>
      <main className="main">
        {view === 'home' && <Dashboard openWork={openWork} go={setView} goLibrary={goLibrary} />}
        {view === 'calendar' && <Planner openWork={openWork} />}
        {view === 'work' && <Workbench key={start.key} start={start} openWork={openWork} />}
        {view === 'library' && <Library key={lib.key} openWork={openWork} initialStatus={lib.status} />}
        {view === 'stats' && <Stats />}
        {view === 'rules' && <RulesView />}
        {view === 'settings' && <SettingsView />}
      </main>
      {keysOpen && (
        <Modal title="단축키" onClose={() => setKeysOpen(false)}>
          <table className="keys">
            <tbody>
              <tr><td><kbd>N</kbd></td><td>새 요소 만들기</td></tr>
              <tr><td><kbd>1</kbd>~<kbd>5</kbd></td><td>홈 · 캘린더 · 작업대 · 보관함 · 통계로 이동</td></tr>
              <tr><td><kbd>⌘/Ctrl</kbd>+<kbd>Enter</kbd></td><td>작업대: 다음 단계</td></tr>
              <tr><td><kbd>⌘/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd></td><td>작업대: 이전 단계</td></tr>
              <tr><td><kbd>⌘/Ctrl</kbd>+<kbd>S</kbd></td><td>작업대: 저장</td></tr>
              <tr><td><kbd>?</kbd></td><td>이 창 열기</td></tr>
            </tbody>
          </table>
          <p className="small muted mt">글자를 입력하는 칸에 있을 때는 N·숫자 단축키가 동작하지 않아요.</p>
        </Modal>
      )}
      <Toasts />
    </div>
  )
}
