import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { toast } from '../components/toast'
import { Modal, TypeBadge, useObjectUrl } from '../components/ui'
import { db, deleteItem, getBlob, nowIso, STATUS_LABEL, type Item, type ItemStatus } from '../lib/db'
import { connectDrive, driveConnected } from '../lib/drive'
import { uploadItemToDrive } from '../lib/driveItems'
import { SPECS, TYPE_LABEL, type ElementType } from '../lib/rules'
import { copyText, downloadBlob, fmtBytes, safeFileName, ymd } from '../lib/utils'
import type { WorkbenchStart } from './Workbench'

const STATUSES = Object.keys(STATUS_LABEL) as ItemStatus[]
const TYPES = Object.keys(TYPE_LABEL) as ElementType[]
const STATUS_HINT: Record<ItemStatus, string> = {
  making: '아직 만드는 중',
  ready: '검수 통과, 올리기만 하면 돼요',
  uploaded: '디자인허브에 올리고 심사 기다리는 중',
  approved: '승인돼서 판매 중',
  rejected: '심사에서 거부됨',
}

/** 상태를 바꿀 수 있는지 — 검수를 통과하지 않은 '제작 중' 요소는 업로드 이후 단계로 못 보냄 */
function moveBlock(item: Item, to: ItemStatus): string | null {
  if (to === item.status || to === 'making') return null
  if (item.status === 'making') return '작업대에서 검수를 통과해야 해요'
  if (item.fileLost?.length) return '파일을 다시 만들어야 해요'
  return null
}

function statusPatch(item: Item, to: ItemStatus, reason?: string): Partial<Item> {
  const p: Partial<Item> = { status: to, updatedAt: nowIso() }
  if (to === 'ready') p.readyAt = item.readyAt ?? nowIso()
  if (to === 'uploaded' || to === 'approved' || to === 'rejected') p.uploadedAt = item.uploadedAt ?? ymd()
  if (to === 'approved') p.approvedAt = item.approvedAt ?? ymd()
  if (to === 'rejected' && reason) p.rejectReason = reason
  return p
}

type Sort = 'new' | 'old' | 'name' | 'status'

export function Library({ openWork }: { openWork: (s: Omit<WorkbenchStart, 'key'>) => void }) {
  const [status, setStatus] = useState<'all' | ItemStatus>('all')
  const [type, setType] = useState<'all' | ElementType>('all')
  const [drive, setDrive] = useState<'all' | 'saved' | 'unsaved'>('all')
  const [sort, setSort] = useState<Sort>('new')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState('')
  const items = useLiveQuery(() => db.items.toArray(), []) ?? []

  const base = items.filter((i) =>
    (type === 'all' || i.type === type) &&
    (drive === 'all' || (drive === 'saved') === !!i.driveFileId) &&
    (!q || `${i.title} ${i.keywords.join(' ')} ${i.theme ?? ''}`.toLowerCase().includes(q.toLowerCase())))
  const count = (s: ItemStatus) => base.filter((i) => i.status === s).length
  const shown = useMemo(() => {
    const list = base.filter((i) => status === 'all' || i.status === status)
    const by: Record<Sort, (a: Item, b: Item) => number> = {
      new: (a, b) => b.createdAt.localeCompare(a.createdAt),
      old: (a, b) => a.createdAt.localeCompare(b.createdAt),
      name: (a, b) => a.title.localeCompare(b.title, 'ko'),
      status: (a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || b.createdAt.localeCompare(a.createdAt),
    }
    return list.sort(by[sort])
  }, [base, status, sort])

  const selecting = picked.size > 0
  const pickedItems = items.filter((i) => picked.has(i.id))
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allShownPicked = shown.length > 0 && shown.every((i) => picked.has(i.id))
  const clear = () => setPicked(new Set())

  const bulkStatus = async (to: ItemStatus) => {
    const movable = pickedItems.filter((i) => !moveBlock(i, to) && i.status !== to)
    const blocked = pickedItems.filter((i) => moveBlock(i, to))
    if (!movable.length) {
      toast(blocked.length ? `바꿀 수 있는 요소가 없어요 — ${blocked.length}개는 ${moveBlock(blocked[0], to)}.` : `이미 모두 “${STATUS_LABEL[to]}”예요.`, 'info')
      return
    }
    let reason: string | undefined
    if (to === 'rejected') reason = prompt('거부 사유를 적어 두면 다음에 같은 실수를 피할 수 있어요 (선택)') ?? undefined
    await db.transaction('rw', db.items, async () => {
      for (const it of movable) await db.items.update(it.id, statusPatch(it, to, reason))
    })
    toast(`${movable.length}개를 “${STATUS_LABEL[to]}”로 바꿨어요.${blocked.length ? ` (${blocked.length}개는 검수 전이라 그대로)` : ''}`)
    clear()
  }

  const bulkDrive = async () => {
    const list = pickedItems.filter((i) => !i.driveFileId && i.bytes != null && !i.fileLost?.length)
    if (!list.length) { toast('올릴 파일이 없어요 (이미 Drive에 있거나 파일이 없는 요소예요).', 'info'); return }
    let ok = 0, skipped = 0
    try {
      if (!driveConnected()) await connectDrive()
      for (const [n, it] of list.entries()) {
        setBusy(`☁️ Drive에 올리는 중… ${n + 1}/${list.length}`)
        if (await uploadItemToDrive(it)) ok++
        else skipped++
      }
      toast(`☁️ ${ok}개를 Drive 타입별 폴더에 올렸어요.${skipped ? ` (파일 없는 ${skipped}개 건너뜀)` : ''}`)
      clear()
    } catch (e) {
      toast(`Drive 오류: ${(e as Error).message} — ${ok}개까지 올렸어요. 다시 누르면 나머지만 올려요.`, 'bad')
    } finally { setBusy('') }
  }

  const bulkDownload = async () => {
    let n = 0
    for (const it of pickedItems) {
      const b = await getBlob(it.id, 'final')
      if (!b) continue
      downloadBlob(b, `${safeFileName(it.title)}.${SPECS[it.type].ext}`)
      n++
      await new Promise((r) => setTimeout(r, 350)) // 브라우저가 연속 다운로드를 막지 않게
    }
    toast(n ? `⬇ ${n}개를 내려받았어요.` : '내려받을 파일이 없어요.', n ? 'ok' : 'info')
  }

  const bulkDelete = async () => {
    if (!confirm(`선택한 ${picked.size}개를 삭제할까요? 파일도 함께 지워지고 되돌릴 수 없어요.`)) return
    for (const id of picked) await deleteItem(id)
    toast(`🗑 ${picked.size}개를 삭제했어요.`)
    clear()
  }

  const chip = <T extends string>(val: T, cur: T, set: (v: T) => void, label: React.ReactNode) => (
    <button className={`fchip ${cur === val ? 'on' : ''}`} onClick={() => { set(val); clear() }}>{label}</button>
  )

  return (
    <div className="lib">
      <div className="lib-head">
        <div className="lib-tabs" role="tablist">
          <button role="tab" className={status === 'all' ? 'on' : ''} onClick={() => { setStatus('all'); clear() }}>
            전체 <span className="n">{base.length}</span>
          </button>
          {STATUSES.map((s) => (
            <button key={s} role="tab" className={status === s ? 'on' : ''} title={STATUS_HINT[s]} onClick={() => { setStatus(s); clear() }}>
              <i className={`dot st-${s}`} />{STATUS_LABEL[s]} <span className="n">{count(s)}</span>
            </button>
          ))}
        </div>
        <div className="lib-tools">
          <div className="search">
            <span aria-hidden="true">🔍</span>
            <input placeholder="제목·키워드 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="정렬">
            <option value="new">최신순</option>
            <option value="old">오래된순</option>
            <option value="name">이름순</option>
            <option value="status">상태순</option>
          </select>
        </div>
      </div>

      <div className="lib-filters">
        {chip<'all' | ElementType>('all', type, setType, '모든 타입')}
        {TYPES.map((t) => <span key={t}>{chip<'all' | ElementType>(t, type, setType, TYPE_LABEL[t])}</span>)}
        <span className="sep" />
        {chip('all', drive, setDrive, 'Drive 전체')}
        {chip('unsaved', drive, setDrive, 'Drive에 없음')}
        {chip('saved', drive, setDrive, '☁️ 저장됨')}
        <span className="grow" />
        {shown.length > 0 && (
          <button className="fchip" onClick={() => setPicked(allShownPicked ? new Set() : new Set(shown.map((i) => i.id)))}>
            {allShownPicked ? '선택 해제' : `☑︎ 보이는 ${shown.length}개 모두 선택`}
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="lib-empty">
          <div style={{ fontSize: 40 }}>🗂</div>
          <b>{items.length ? '조건에 맞는 요소가 없어요' : '아직 만든 요소가 없어요'}</b>
          <p className="small muted">{items.length ? '필터를 바꾸거나 검색어를 지워 보세요.' : '작업대에서 첫 요소를 만들면 여기 모여요.'}</p>
          {!items.length && <button className="primary" onClick={() => openWork({})}>＋ 새 요소 만들기</button>}
        </div>
      ) : (
        <div className="cards">
          {shown.map((i) => (
            <Card key={i.id} item={i} picked={picked.has(i.id)} selecting={selecting}
              onPick={() => toggle(i.id)} onOpen={() => (selecting ? toggle(i.id) : setOpenId(i.id))} />
          ))}
        </div>
      )}

      {selecting && (
        <div className="actionbar" role="toolbar" aria-label="선택한 요소 작업">
          <div className="ab-count"><b>{picked.size}</b>개 선택<button className="ghost small" onClick={clear}>해제</button></div>
          <div className="ab-group">
            <span className="ab-label">상태 바꾸기</span>
            {STATUSES.map((s) => (
              <button key={s} className="ab-status" onClick={() => bulkStatus(s)} disabled={!!busy} title={STATUS_HINT[s]}>
                <i className={`dot st-${s}`} />{STATUS_LABEL[s]}
              </button>
            ))}
          </div>
          <div className="ab-group">
            {busy ? <b className="small">{busy}</b> : (
              <>
                <button onClick={bulkDrive}>☁️ Drive</button>
                <button onClick={bulkDownload}>⬇ 받기</button>
                <button className="danger" onClick={bulkDelete}>🗑</button>
              </>
            )}
          </div>
        </div>
      )}

      {openId && items.find((i) => i.id === openId) && (
        <Detail item={items.find((i) => i.id === openId)!} onClose={() => setOpenId(null)} openWork={openWork} />
      )}
    </div>
  )
}

function Card({ item, picked, selecting, onPick, onOpen }: { item: Item; picked: boolean; selecting: boolean; onPick: () => void; onOpen: () => void }) {
  const blob = useLiveQuery(() => getBlob(item.id, 'thumb'), [item.id, item.updatedAt])
  const url = useObjectUrl(blob)
  const date = item.uploadedAt ?? item.createdAt.slice(0, 10)
  return (
    <div className={`card2 ${picked ? 'picked' : ''} ${selecting ? 'selecting' : ''}`} onClick={onOpen}>
      <div className="c-img">
        {url ? <img src={url} alt={item.title} /> : <span className="c-ph">{item.type === 'video' ? '🎬' : '🖼'}</span>}
        <button className="c-check" aria-label={picked ? '선택 해제' : '선택'} onClick={(e) => { e.stopPropagation(); onPick() }}>{picked ? '✓' : ''}</button>
        <div className="c-flags">
          {item.driveFileId && <span title="Drive에 저장됨">☁️</span>}
          {!!item.fileLost?.length && <span title="파일을 다시 만들어야 해요">⚠️</span>}
        </div>
      </div>
      <div className="c-body">
        <b className="c-title" title={item.title}>{item.title || '(제목 없음)'}</b>
        <div className="c-row">
          <TypeBadge type={item.type} />
          <span className={`spill st-${item.status}`}><i className={`dot st-${item.status}`} />{STATUS_LABEL[item.status]}</span>
        </div>
        <div className="c-meta">
          <span>{item.width ? `${item.width}×${item.height}` : '크기 없음'}</span>
          <span>{date.slice(5).replace('-', '/')}{item.uploadedAt ? ' 업로드' : ''}</span>
        </div>
      </div>
    </div>
  )
}

function Detail({ item, onClose, openWork }: { item: Item; onClose: () => void; openWork: (s: Omit<WorkbenchStart, 'key'>) => void }) {
  const [reason, setReason] = useState(item.rejectReason ?? '')
  const blob = useLiveQuery(() => getBlob(item.id, 'thumb'), [item.id, item.updatedAt])
  const url = useObjectUrl(blob)
  const set = (p: Partial<Item>) => db.items.update(item.id, { ...p, updatedAt: nowIso() })
  const download = async () => {
    const b = await getBlob(item.id, 'final')
    if (b) downloadBlob(b, `${safeFileName(item.title)}.${SPECS[item.type].ext}`)
    else toast('내려받을 파일이 없어요.', 'info')
  }
  const fails = item.autoChecks.filter((c) => c.ok === false).length
  return (
    <Modal title={item.title || '(제목 없음)'} onClose={onClose}>
      <div className="detail">
        <div className="d-img">{url ? <img src={url} alt={item.title} /> : <span className="c-ph">{item.type === 'video' ? '🎬' : '🖼'}</span>}</div>
        <div className="col" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 6 }}>
            <TypeBadge type={item.type} />
            {fails > 0 && <span className="badge bad">검수 실패 {fails}</span>}
            {item.driveFileId && <span className="badge ok">☁️ Drive</span>}
          </div>
          <div className="col" style={{ gap: 6 }}>
            <span className="small muted">상태</span>
            <div className="status-steps">
              {STATUSES.map((s) => {
                const block = moveBlock(item, s)
                return (
                  <button key={s} className={`ss ${item.status === s ? 'on' : ''} st-${s}`} disabled={!!block} title={block ?? STATUS_HINT[s]}
                    onClick={() => set(statusPatch(item, s))}>
                    <i className={`dot st-${s}`} />{STATUS_LABEL[s]}
                  </button>
                )
              })}
            </div>
            <span className="small muted">{item.status === 'making' ? '🔒 작업대에서 검수를 통과하면 다음 상태로 바꿀 수 있어요.' : STATUS_HINT[item.status]}</span>
          </div>
          {item.status === 'rejected' && (
            <label>거부 사유 (다음에 같은 실수 안 하게)
              <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} onBlur={() => set({ rejectReason: reason })} />
            </label>
          )}
          <dl className="d-info">
            <dt>규격</dt><dd>{item.width ? `${item.width}×${item.height}px` : '-'} · {fmtBytes(item.bytes)}{item.aspect && item.type === 'background' ? ` · ${item.aspect}` : ''}</dd>
            <dt>만든 날</dt><dd>{item.createdAt.slice(0, 10)}{item.readyAt && ` · 완성 ${item.readyAt.slice(0, 10)}`}</dd>
            <dt>업로드</dt><dd><input type="date" value={item.uploadedAt ?? ''} onChange={(e) => set({ uploadedAt: e.target.value || undefined })} /></dd>
            <dt>키워드</dt>
            <dd className="small">{item.keywords.join(', ') || '-'} {item.keywords.length > 0 && <button className="small ghost" onClick={() => copyText(item.keywords.join(', ')).then(() => toast('키워드 복사됨', 'info'))}>📋 복사</button>}</dd>
            <dt>프롬프트</dt><dd className="small">{item.prompt ?? '-'}<div className="muted">기록 {item.promptLog.length}개{item.aiTool ? ` · ${item.aiTool}` : ''}</div></dd>
            {item.driveLink && <><dt>Drive</dt><dd><a href={item.driveLink} target="_blank" rel="noreferrer">파일 열기 ↗</a></dd></>}
          </dl>
        </div>
      </div>
      <div className="row between mt">
        <div className="row">
          <button className="primary" onClick={() => { onClose(); openWork({ itemId: item.id }) }}>🛠 작업대에서 열기</button>
          <button onClick={download}>⬇ 다운로드</button>
        </div>
        <button className="danger ghost" onClick={async () => { if (confirm('이 요소를 삭제할까요? 파일도 함께 지워져요.')) { await deleteItem(item.id); onClose() } }}>🗑 삭제</button>
      </div>
    </Modal>
  )
}
