import { useState } from 'react'
import { Dashboard } from './views/Dashboard'
import { Planner } from './views/Planner'
import { Workbench, type WorkbenchStart } from './views/Workbench'
import { Library } from './views/Library'
import { Revenue } from './views/Revenue'
import { RulesView } from './views/RulesView'
import { SettingsView } from './views/SettingsView'
import { Tabs } from './components/ui'

type View = 'home' | 'work' | 'manage' | 'rules' | 'settings'
type HomeTab = 'dashboard' | 'calendar'
type ManageTab = 'library' | 'revenue'

export default function App() {
  const [view, setView] = useState<View>('home')
  const [homeTab, setHomeTab] = useState<HomeTab>('dashboard')
  const [manageTab, setManageTab] = useState<ManageTab>('library')
  const [start, setStart] = useState<WorkbenchStart>({ key: 0 })

  const openWork = (s: Omit<WorkbenchStart, 'key'>) => {
    setStart({ ...s, key: Date.now() })
    setView('work')
  }

  const nav: { id: View; label: string }[] = [
    { id: 'home', label: '📊 대시보드·캘린더' },
    { id: 'work', label: '🛠 작업대' },
    { id: 'manage', label: '🗂 보관함·수익' },
  ]

  return (
    <div className="app">
      <nav className="nav">
        <div className="brand">Miri Stock<small>디자인허브 요소 작업실</small></div>
        {nav.map((n) => (
          <button key={n.id} className={view === n.id ? 'active' : ''} onClick={() => setView(n.id)}>{n.label}</button>
        ))}
        <div className="spacer" />
        <button className={view === 'rules' ? 'active' : ''} onClick={() => setView('rules')}>📏 규칙</button>
        <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}>⚙️ 설정</button>
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
    </div>
  )
}
