import { useRef, useState } from 'react'
import { aiText, PROVIDER_LABEL } from '../lib/ai'
import { exportBackup, importBackup } from '../lib/db'
import { connectDrive, downloadFile, findFile, uploadFile } from '../lib/drive'
import { updateSettings, useSettings, type Provider } from '../lib/settings'
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

  return (
    <div className="col" style={{ gap: 16, maxWidth: 820 }}>
      <h1>설정</h1>
      {msg && <div className="note info small">{msg}</div>}

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
          테스트 모드로 두고 본인 계정을 테스트 사용자로 넣으면 돼요. 파일은 <b>{s.driveFolderName}</b> / 배경·PNG·SVG·동영상 / 연-월 폴더에 저장돼요.
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
