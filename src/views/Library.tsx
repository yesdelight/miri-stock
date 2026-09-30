import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Modal, StatusBadge, TypeBadge, useObjectUrl } from '../components/ui'
import { db, deleteItem, getBlob, STATUS_LABEL, type Item, type ItemStatus } from '../lib/db'
import { SPECS, TYPE_LABEL, type ElementType } from '../lib/rules'
import { copyText, downloadBlob, fmtBytes, safeFileName, ymd } from '../lib/utils'
import { connectDrive, driveConnected } from '../lib/drive'
import { uploadItemToDrive } from '../lib/driveItems'
import { toast } from '../components/toast'
import type { WorkbenchStart } from './Workbench'

export function Library({ openWork }: { openWork: (s: Omit<WorkbenchStart, 'key'>) => void }) {
  const [type, setType] = useState<'all' | ElementType>('all')
  const [status, setStatus] = useState<'all' | ItemStatus>('all')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Item | null>(null)
  const [drive, setDrive] = useState<'all' | 'saved' | 'unsaved'>('all')
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const items = useLiveQuery(() => db.items.orderBy('createdAt').reverse().toArray(), []) ?? []
  const shown = items.filter((i) =>
    (type === 'all' || i.type === type) && (status === 'all' || i.status === status) &&
    (drive === 'all' || (drive === 'saved') === !!i.driveFileId) &&
    (!q || `${i.title} ${i.keywords.join(' ')} ${i.theme ?? ''}`.toLowerCase().includes(q.toLowerCase())))
  // 올릴 수 있는 것: 최종 파일이 있고 아직 Drive에 없는 것
  const canUpload = (i: Item) => !i.driveFileId && i.bytes != null
  const eligible = shown.filter(canUpload)
  const togglePick = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allPicked = eligible.length > 0 && eligible.every((i) => picked.has(i.id))

  const uploadPicked = async () => {
    const list = items.filter((i) => picked.has(i.id) && canUpload(i))
    if (!list.length) return
    setProgress({ done: 0, total: list.length })
    let ok = 0, skipped = 0
    try {
      if (!driveConnected()) await connectDrive() // 로그인은 처음 한 번만
      for (const [n, it] of list.entries()) {
        if (await uploadItemToDrive(it)) ok++
        else skipped++
        setProgress({ done: n + 1, total: list.length })
      }
      toast(`☁️ ${ok}개를 Drive 타입별 폴더에 올렸어요.${skipped ? ` (파일 없는 ${skipped}개 건너뜀)` : ''}`)
      setPicked(new Set())
      setPicking(false)
    } catch (e) {
      toast(`Drive 오류: ${(e as Error).message} — ${ok}개까지 올렸어요. 다시 누르면 나머지만 올려요.`, 'bad')
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row">
        <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="all">모든 타입</option>
          {(Object.keys(TYPE_LABEL) as ElementType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">모든 상태</option>
          {(Object.keys(STATUS_LABEL) as ItemStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select value={drive} onChange={(e) => setDrive(e.target.value as typeof drive)}>
          <option value="all">Drive 전체</option>
          <option value="unsaved">Drive에 없는 것</option>
          <option value="saved">Drive에 저장됨</option>
        </select>
        <input className="grow" placeholder="제목·키워드 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="small muted">{shown.length}개</span>
        {!picking && <button className="primary" onClick={() => { setPicking(true); setPicked(new Set()) }}>☁️ Drive에 올리기</button>}
      </div>
      {picking && (
        <div className="note info row between">
          <span className="row">
            <label className="inline"><input type="checkbox" checked={allPicked} disabled={!eligible.length}
              onChange={(e) => setPicked(e.target.checked ? new Set(eligible.map((i) => i.id)) : new Set())} />
              전체 선택 (올릴 수 있는 {eligible.length}개)</label>
            <span className="small muted">이미 Drive에 있는 것·파일이 없는 것은 빠져요</span>
          </span>
          <span className="row">
            {progress ? <b>⏳ {progress.done}/{progress.total} 올리는 중…</b> : (
              <>
                <button className="primary" disabled={!picked.size} onClick={uploadPicked}>선택한 {picked.size}개 올리기</button>
                <button className="ghost" onClick={() => { setPicking(false); setPicked(new Set()) }}>취소</button>
              </>
            )}
          </span>
        </div>
      )}
      {shown.length === 0 && <p className="muted">해당하는 요소가 없어요.</p>}
      <div className="thumbs">
        {shown.map((i) => (
          <Thumb key={i.id} item={i}
            pick={picking ? (canUpload(i) ? (picked.has(i.id) ? 'on' : 'off') : 'na') : undefined}
            onClick={() => (picking ? canUpload(i) && togglePick(i.id) : setSel(i))} />
        ))}
      </div>
      {sel && <Detail item={items.find((i) => i.id === sel.id) ?? sel} onClose={() => setSel(null)} openWork={openWork} />}
    </div>
  )
}

function Thumb({ item, onClick, pick }: { item: Item; onClick: () => void; pick?: 'on' | 'off' | 'na' }) {
  const blob = useLiveQuery(() => getBlob(item.id, 'thumb'), [item.id, item.updatedAt])
  const url = useObjectUrl(blob)
  return (
    <div className={`thumb ${pick === 'on' ? 'picked' : ''} ${pick === 'na' ? 'dim' : ''}`} onClick={onClick}>
      {pick && pick !== 'na' && <span className="pickbox">{pick === 'on' ? '✓' : ''}</span>}
      <div className="img">{url ? <img src={url} alt={item.title} /> : <span className="muted small">{item.type === 'video' ? '🎬' : '—'}</span>}</div>
      <div className="meta">
        <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title || '(제목 없음)'}</b>
        <div className="row" style={{ gap: 4 }}><TypeBadge type={item.type} /><StatusBadge status={item.status} />{item.driveFileId && <span className="badge ok">☁️ Drive</span>}{!!item.fileLost?.length && <span className="badge bad" title="저장된 파일을 읽을 수 없어요. 열어서 다시 만들어 주세요.">⚠️ 파일 다시 필요</span>}</div>
        <span className="muted">{item.uploadedAt ? `업로드 ${item.uploadedAt}` : item.createdAt.slice(0, 10)}</span>
      </div>
    </div>
  )
}

function Detail({ item, onClose, openWork }: { item: Item; onClose: () => void; openWork: (s: Omit<WorkbenchStart, 'key'>) => void }) {
  const [reason, setReason] = useState(item.rejectReason ?? '')
  const set = (p: Partial<Item>) => db.items.update(item.id, { ...p, updatedAt: new Date().toISOString() })
  const download = async () => {
    const b = await getBlob(item.id, 'final')
    if (b) downloadBlob(b, `${safeFileName(item.title)}.${SPECS[item.type].ext}`)
  }
  const fails = item.autoChecks.filter((c) => c.ok === false).length
  return (
    <Modal title={item.title || '(제목 없음)'} onClose={onClose}>
      <div className="col">
        <div className="row"><TypeBadge type={item.type} /><StatusBadge status={item.status} />{fails > 0 && <span className="badge bad">검수 실패 {fails}</span>}</div>
        <table>
          <tbody>
            <tr><th>규격</th><td>{item.width ? `${item.width}×${item.height}px` : '-'} · {fmtBytes(item.bytes)}{item.aspect && item.type === 'background' ? ` · ${item.aspect}` : ''}</td></tr>
            <tr><th>만든 날</th><td>{item.createdAt.slice(0, 10)}{item.readyAt && ` · 완성 ${item.readyAt.slice(0, 10)}`}</td></tr>
            <tr><th>업로드</th><td><input type="date" value={item.uploadedAt ?? ''} onChange={(e) => set({ uploadedAt: e.target.value || undefined })} /></td></tr>
            <tr><th>키워드</th><td className="small">{item.keywords.join(', ') || '-'} {item.keywords.length > 0 && <button className="small" onClick={() => copyText(item.keywords.join(', '))}>복사</button>}</td></tr>
            <tr><th>프롬프트</th><td className="small">{item.prompt ?? '-'}<div className="muted">기록 {item.promptLog.length}개 · {item.aiTool}</div></td></tr>
            {item.driveLink && <tr><th>Drive</th><td><a href={item.driveLink} target="_blank" rel="noreferrer">열기 ↗</a></td></tr>}
          </tbody>
        </table>
        <b className="small">상태 변경</b>
        <div className="row">
          {(Object.keys(STATUS_LABEL) as ItemStatus[]).map((s) => (
            <button key={s} className={`small ${item.status === s ? 'primary' : ''}`} onClick={() => set({
              status: s,
              ...(s === 'uploaded' && !item.uploadedAt ? { uploadedAt: ymd() } : {}),
              ...(s === 'approved' ? { approvedAt: ymd() } : {}),
            })}>{STATUS_LABEL[s]}</button>
          ))}
        </div>
        {item.status === 'rejected' && (
          <label>거부 사유 (다음에 같은 실수 안 하게)
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} onBlur={() => set({ rejectReason: reason })} />
          </label>
        )}
        <div className="row between mt">
          <div className="row">
            <button className="primary" onClick={() => { onClose(); openWork({ itemId: item.id }) }}>🛠 작업대에서 열기</button>
            <button onClick={download}>⬇ 다운로드</button>
          </div>
          <button className="danger" onClick={async () => { if (confirm('이 요소를 삭제할까요? 파일도 함께 지워져요.')) { await deleteItem(item.id); onClose() } }}>삭제</button>
        </div>
      </div>
    </Modal>
  )
}
