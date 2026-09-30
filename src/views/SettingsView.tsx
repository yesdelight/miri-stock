import { useRef, useState } from 'react'
import { aiText, PROVIDER_LABEL } from '../lib/ai'
import { exportBackup, importBackup } from '../lib/db'
import { connectDrive, downloadFile, driveConnected, findFile, uploadFile } from '../lib/drive'
import { lastAutoBackup, runRecovery, scanRecovery, titleFromName } from '../lib/driveRecovery'
import { DEFAULT_SITES, updateSettings, useSettings, type Provider, type Site } from '../lib/settings'
import { downloadBlob, ymd } from '../lib/utils'

export function SettingsView() {
  const s = useSettings()
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const field = (k: keyof typeof s, label: string, type = 'text', placeholder = '') => (
    <label>{label}
      <input type={type} value={String(s[k])} placeholder={placeholder} autoComplete="off"
        onChange={(e) => updateSettings({ [k]: type === 'number' ? Number(e.target.value) : e.target.value })} />
    </label>
  )
  const act = async (fn: () => Promise<string>) => {
    setMsg('처리 중…')
    try { setMsg(await fn()) } catch (e) { setMsg(`오류: ${(e as Error).message}`) }
  }

  const lastAuto = lastAutoBackup()
  const recover = async () => {
    try {
      setMsg('Drive를 살펴보는 중…')
      if (!driveConnected()) await connectDrive()
      const scan = await scanRecovery()
      const pre = scan.restoredBackup ? 'Drive 백업 기록을 먼저 불러왔어요.\n\n' : ''
      if (!scan.refill.length && !scan.orphans.length) { setMsg(`${pre}복구할 게 없어요. 모든 요소의 파일이 제자리에 있어요.`); return }
      const list = scan.orphans.map((o) => `· ${titleFromName(o.name)}`).join('\n')
      if (!confirm(`${pre}파일 다시 받기: ${scan.refill.length}개\nDrive에만 있어서 새로 만들 요소: ${scan.orphans.length}개${list ? `\n${list}` : ''}\n\n복구할까요?`)) { setMsg(''); return }
      const r = await runRecovery(scan, setMsg)
      setMsg(`🛟 복구 끝! 파일 다시 받음 ${r.refilled}개 · 새로 만든 요소 ${r.created}개${r.failed.length ? ` · 실패 ${r.failed.join(', ')}` : ''}. 새로 만든 요소는 보관함 “제작 중”에서 프롬프트·키워드를 넣고 검수해 주세요.`)
    } catch (e) { setMsg(`오류: ${(e as Error).message}`) }
  }

  return (
    <div className="col" style={{ gap: 16, maxWidth: 820 }}>
      <h1>설정</h1>
      {msg && <div className="note info small" style={{ position: 'sticky', top: 8, zIndex: 5, whiteSpace: 'pre-line' }}>{msg}</div>}

      <div className="card col">
        <h3>화면</h3>
        <div className="seg" style={{ alignSelf: 'flex-start' }}>
          {([['auto', '자동(컴퓨터 설정)'], ['light', '라이트'], ['dark', '다크']] as const).map(([k, l]) => (
            <button key={k} className={`small ${s.theme === k ? 'primary' : ''}`} onClick={() => updateSettings({ theme: k })}>{l}</button>
          ))}
        </div>
        <p className="small muted">왼쪽 아래 해·달 버튼으로도 바꿀 수 있어요. 단축키는 <kbd>?</kbd>를 누르면 볼 수 있어요.</p>
      </div>

      <SitesCard />

      <div className="card col">
        <h3>AI 연결</h3>
        <div className="note small">
          <b>구독(ChatGPT Plus · Gemini Pro · Claude Pro)과 API는 별개예요.</b> 구독만 있으면 “구독 계정 수동 모드”로 쓰세요 —
          앱이 규칙이 들어간 프롬프트를 만들어 주면 복사해서 채팅에 붙여넣고, 답변을 다시 붙여넣으면 자동으로 정리돼요.
          버튼 한 번에 끝내고 싶으면 API 키(사용량만큼 과금)를 넣으세요. 키는 이 브라우저에만 저장돼요.
        </div>
        <div className="row">
          <button className={s.aiMode === 'manual' ? 'primary' : ''} onClick={() => updateSettings({ aiMode: 'manual' })}>구독 계정 수동 모드</button>
          <button className={s.aiMode === 'api' ? 'primary' : ''} onClick={() => updateSettings({ aiMode: 'api' })}>API 자동 모드</button>
        </div>
        {s.aiMode === 'api' && (
          <>
            <label>글·기획·검수에 쓸 AI
              <select value={s.textProvider} onChange={(e) => updateSettings({ textProvider: e.target.value as Provider })}>
                {(Object.keys(PROVIDER_LABEL) as Provider[]).map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
              </select>
            </label>
            <div className="grid g2">
              {field('anthropicKey', 'Anthropic API 키', 'password', 'sk-ant-…')}
              {field('claudeModel', 'Claude 모델')}
              {field('openaiKey', 'OpenAI API 키', 'password', 'sk-…')}
              {field('openaiModel', 'OpenAI 모델')}
              {field('geminiKey', 'Gemini API 키', 'password', 'AIza…')}
              {field('geminiModel', 'Gemini 모델')}
            </div>
            <button className="small" onClick={() => act(async () => `연결 성공: ${(await aiText({ system: '짧게 답해.', prompt: '"연결 OK"라고만 답해.', effort: 'low' })).slice(0, 60)}`)}>연결 테스트</button>
            <label>무료 크레딧 끝나는 날 (선택)
              <input type="date" value={s.creditEndsAt} onChange={(e) => updateSettings({ creditEndsAt: e.target.value })} style={{ maxWidth: 200 }} />
            </label>
            <div className="note small">
              💡 크레딧(예: Google Cloud 무료 체험)이 끝나도 앱은 그대로 쓸 수 있어요. 끝나기 3주 전부터 홈에서 알려주고,
              한도·결제 오류가 나면 같은 작업을 <b>구독 계정 수동 모드</b>(복사 → 채팅 → 붙여넣기)로 바로 이어가요.
              모르는 사이 요금이 나가지 않게 Google Cloud 콘솔에서 <b>예산 알림</b>을 걸어 두세요.
            </div>
          </>
        )}
        <label>이미지 생성
          <select value={s.imageProvider} onChange={(e) => updateSettings({ imageProvider: e.target.value as typeof s.imageProvider })}>
            <option value="manual">수동 — ChatGPT/Gemini 앱에서 만들고 파일 업로드</option>
            <option value="openai">OpenAI API (키 필요)</option>
            <option value="gemini">Gemini API (키 필요)</option>
          </select>
        </label>
        {s.imageProvider !== 'manual' && (
          <div className="grid g2">
            {s.imageProvider === 'openai' ? field('openaiImageModel', 'OpenAI 이미지 모델') : field('geminiImageModel', 'Gemini 이미지 모델')}
          </div>
        )}
        <p className="small muted">Claude는 이미지 생성 기능이 없어서 기획·트렌드·검수에만 쓰여요.</p>
      </div>

      <div className="card col">
        <h3>Google Drive</h3>
        <p className="small muted">
          Google Cloud Console → API 및 서비스 → OAuth 클라이언트 ID(웹 애플리케이션) 만들기 → “승인된 JavaScript 원본”에 이 앱 주소 추가 → Drive API 사용 설정.
          테스트 모드로 두고 본인 계정을 테스트 사용자로 넣으면 돼요. 파일은 <b>{s.driveFolderName}</b> / 배경·PNG 요소·SVG 요소·동영상 / 연-월 폴더에 저장돼요.
        </p>
        <div className="grid g2">
          {field('googleClientId', 'OAuth 클라이언트 ID', 'text', '…apps.googleusercontent.com')}
          {field('driveFolderId', '[Miri] Stock 폴더 ID')}
        </div>
        <div className="row">
          <button onClick={() => act(async () => { await connectDrive(); return 'Drive 연결됨' })}>Drive 연결</button>
          <a href={`https://drive.google.com/drive/folders/${s.driveFolderId}`} target="_blank" rel="noreferrer"><button>폴더 열기 ↗</button></a>
        </div>
      </div>

      <div className="card col">
        <h3>백업</h3>
        <p className="small muted">요소 파일은 이 브라우저(IndexedDB)에 저장돼요. 기록(아이디어·캘린더·요소 정보·수익)은 아래로 백업하세요. 파일 자체는 작업대에서 Drive에 올려 두면 안전해요.</p>
        <div className="row">
          <button onClick={() => act(async () => { downloadBlob(new Blob([JSON.stringify(await exportBackup(), null, 1)], { type: 'application/json' }), `miri-stock-backup-${ymd()}.json`); return '백업 파일을 내려받았어요.' })}>⬇ 백업 파일</button>
          <button onClick={() => fileRef.current?.click()}>⬆ 백업 불러오기</button>
          <button onClick={() => act(async () => {
            const blob = new Blob([JSON.stringify(await exportBackup())], { type: 'application/json' })
            const existing = await findFile('miri-stock-backup.json', ['_backup'])
            await uploadFile(blob, 'miri-stock-backup.json', ['_backup'], existing)
            return 'Drive에 백업했어요.'
          })}>☁️ Drive에 백업</button>
          <button onClick={() => act(async () => {
            const id = await findFile('miri-stock-backup.json', ['_backup'])
            if (!id) return 'Drive에 백업이 없어요.'
            await importBackup(JSON.parse(await downloadFile(id)))
            return 'Drive 백업을 불러왔어요.'
          })}>☁️ Drive에서 복원</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={async (e) => {
            const f = e.target.files?.[0]
            if (f) act(async () => { await importBackup(JSON.parse(await f.text())); return '불러왔어요.' })
          }} />
        </div>
        <div className="note small">
          <b>🛟 앱 저장소가 비었을 때 (웹앱을 다시 만들었거나 브라우저 데이터를 지웠을 때)</b><br />
          Drive <code>[Miri] Stock</code> 폴더의 파일로 요소를 되살려요. 요소가 하나도 없으면 Drive 백업 기록부터 불러와요.
          기록은 있는데 파일이 없는 요소는 파일을 다시 받고, Drive에만 있는 파일은 “제작 중” 요소로 만들어요
          — 이 요소들은 프롬프트·키워드·심사 기록을 다시 넣고 검수를 다시 해야 해요.
          <div className="row mt">
            <button className="primary" onClick={recover}>🛟 Drive 파일로 복구</button>
            <span className="small muted">{lastAuto ? `자동 백업: ${new Date(lastAuto).toLocaleString('ko-KR')}` : 'Drive에 연결돼 있으면 기록이 바뀔 때마다 자동으로 백업해요.'}</span>
          </div>
        </div>
      </div>

      <div className="card col">
        <h3>규칙 보조 설정</h3>
        {field('leadDays', '시즌 요소 제작 선행 기간(일)', 'number')}
        <label>추가 금지 단어 (쉼표·줄바꿈 구분 — 캐릭터·브랜드·작가명)
          <textarea rows={3} value={s.extraBannedWords} onChange={(e) => updateSettings({ extraBannedWords: e.target.value })} />
        </label>
      </div>
    </div>
  )
}

function SitesCard() {
  const { sites } = useSettings()
  const [draft, setDraft] = useState({ name: '', url: '' })
  const edit = (id: string, p: Partial<Site>) => updateSettings({ sites: sites.map((x) => (x.id === id ? { ...x, ...p } : x)) })
  const remove = (x: Site) => {
    if (!confirm(`“${x.name}”을(를) 목록에서 뺄까요? 이미 남긴 심사 기록은 지워지지 않아요.`)) return
    updateSettings({ sites: sites.filter((y) => y.id !== x.id) })
  }
  const add = () => {
    const name = draft.name.trim()
    if (!name) return
    const id = name.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '') || `site-${Date.now()}`
    if (sites.some((x) => x.id === id)) { alert('같은 이름의 사이트가 이미 있어요.'); return }
    updateSettings({ sites: [...sites, { id, name, short: name.length > 8 ? name.slice(0, 8) : name, url: draft.url.trim() }] })
    setDraft({ name: '', url: '' })
  }
  return (
    <div className="card col">
      <h3>올리는 사이트</h3>
      <p className="small muted">보관함에서 사이트마다 심사 상태(심사 중·판매 중·거부)를 따로 기록해요. 왼쪽 메뉴의 바로가기도 이 목록을 따라가요.</p>
      <div style={{ overflowX: 'auto' }}><table>
        <thead><tr><th>이름</th><th>짧은 이름(뱃지)</th><th>주소</th><th /></tr></thead>
        <tbody>
          {sites.map((x) => (
            <tr key={`${x.id}|${x.name}|${x.short}|${x.url}`}>
              <td><input defaultValue={x.name} onBlur={(e) => e.target.value.trim() && edit(x.id, { name: e.target.value.trim() })} /></td>
              <td><input defaultValue={x.short} style={{ width: 110 }} onBlur={(e) => e.target.value.trim() && edit(x.id, { short: e.target.value.trim() })} /></td>
              <td><input defaultValue={x.url} placeholder="https://…" onBlur={(e) => edit(x.id, { url: e.target.value.trim() })} /></td>
              <td><button className="ghost small danger" title="목록에서 빼기" disabled={sites.length <= 1} onClick={() => remove(x)}>빼기</button></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div className="row">
        <input placeholder="사이트 이름 (예: Freepik)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <input placeholder="주소 (선택)" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button onClick={add} disabled={!draft.name.trim()}>추가</button>
        <span className="grow" />
        <button className="small ghost" onClick={() => confirm('기본 목록(디자인허브·툴디·Adobe Stock)으로 되돌릴까요?') && updateSettings({ sites: DEFAULT_SITES })}>기본값</button>
      </div>
      <p className="small muted">검수 규칙은 디자인허브 기준이에요. Adobe Stock은 제목·키워드를 영어로 쓰고, 올릴 때 “생성형 AI로 만듦”을 꼭 체크하세요.</p>
    </div>
  )
}
