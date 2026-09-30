import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from './lib/db'
import { Dashboard } from './views/Dashboard'
import { Planner } from './views/Planner'
import { Workbench, type WorkbenchStart } from './views/Workbench'
import { Library } from './views/Library'
import { Revenue } from './views/Revenue'
import { RulesView } from './views/RulesView'
import { SettingsView } from './views/SettingsView'
import { Tabs } from './components/ui'
import { Toasts } from './components/toast'
import { Splash, UpdateBanner, useBoot } from './components/Boot'

type View = 'home' | 'work' | 'manage' | 'rules' | 'settings'
type HomeTab = 'dashboard' | 'calendar'
type ManageTab = 'library' | 'revenue'

export default function App() {
  const boot = useBoot()
  // 사이드바 숫자: 업로드 대기 / 파일 다시 필요
  const waiting = useLiveQuery(() => db.items.where('status').equals('ready').count(), []) ?? 0
  const [view, setView] = useState<View>('home')
  const [homeTab, setHomeTab] = useState<HomeTab>('dashboard')
  const [manageTab, setManageTab] = useState<ManageTab>('library')
  const [start, setStart] = useState<WorkbenchStart>({ key: 0 })

  const openWork = (s: Omit<WorkbenchStart, 'key'>) => {
    setStart({ ...s, key: Date.now() })
    setView('work')
  }

  const nav: { id: View; label: string }[] = [
    { id: 'home', label: '🏠 홈·캘린더' },
    { id: 'work', label: '🛠 작업대' },
    { id: 'manage', label: '🗂 보관함·수익' },
  ]

  if (boot.phase === 'loading') return <><Splash msg={boot.msg} /><Toasts /></>

  return (
    <div className="app">
      {boot.phase === 'fading' && <Splash msg={boot.msg} hide />}
      <UpdateBanner />
      <nav className="nav">
        <div className="brand">Miri Stock<small>디자인허브 요소 작업실</small></div>
        <button className="newbtn" onClick={() => openWork({})}>＋ 새 요소 만들기</button>
        {nav.map((n) => (
          <button key={n.id} className={view === n.id ? 'active' : ''} onClick={() => setView(n.id)}>
            {n.label}
            {n.id === 'manage' && waiting > 0 && <span className="navcount" title="업로드 대기 중인 요소">{waiting}</span>}
          </button>
        ))}
        <div className="spacer" />
        <button className={view === 'rules' ? 'active' : ''} onClick={() => setView('rules')}>📏 규칙</button>
        <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}>⚙️ 설정</button>
        <span className="version" title="앱 버전(배포 시각·커밋)">버전 {__BUILD__}</span>
      </nav>
      <main className="main">
        {view === 'home' && (
          <>
            <Tabs
              tabs={[{ id: 'dashboard', label: '현황' }, { id: 'calendar', label: '콘텐츠 캘린더·아이디어' }]}
              value={homeTab}
              onChange={setHomeTab}
            />
            {homeTab === 'dashboard'
              ? <Dashboard openWork={openWork} goCalendar={() => setHomeTab('calendar')} />
              : <Planner openWork={openWork} />}
          </>
        )}
        {view === 'work' && <Workbench key={start.key} start={start} openWork={openWork} />}
        {view === 'manage' && (
          <>
            <Tabs
              tabs={[{ id: 'library', label: '요소 보관함' }, { id: 'revenue', label: '수익' }]}
              value={manageTab}
              onChange={setManageTab}
            />
            {manageTab === 'library' ? <Library openWork={openWork} /> : <Revenue />}
          </>
        )}
        {view === 'rules' && <RulesView />}
        {view === 'settings' && <SettingsView />}
      </main>
      <Toasts />
    </div>
  )
}
