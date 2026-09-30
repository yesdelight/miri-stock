// Drive에서 복구: 앱 저장소가 사라졌을 때 [Miri] Stock 폴더의 파일로 요소를 되살림
//  ① 기록은 있는데 파일이 없는 요소 → Drive 파일을 다시 받아 넣음
//  ② Drive에만 있는 파일 → 새 요소로 만듦(프롬프트·키워드·심사 기록은 다시 입력해야 함)
import { videoDuration } from './checks'
import { db, exportBackup, getBlob, importBackup, nowIso, putBlob, uid, type Item } from './db'
import { downloadBlobFile, downloadFile, findFile, isFolder, listFolder, rootFolderId, uploadFile, type DriveEntry } from './drive'
import { blobToCanvas, dHash, downscaleLongSide, thumbnail } from './imaging'
import { ASPECTS, TYPE_FOLDER, type AspectId, type ElementType } from './rules'
import { analyzeSvg, svgToCanvas } from './vectorize'

const MIME: Record<ElementType, string> = { background: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml', video: 'video/mp4' }

export interface RecoveryScan {
  /** Drive 백업을 먼저 불러왔는지 */
  restoredBackup: boolean
  refill: Item[]
  orphans: (DriveEntry & { type: ElementType })[]
}

/** 파일 이름 `제목_ab12cd.png` → '제목' */
export const titleFromName = (name: string) => name.replace(/\.[^.]+$/, '').replace(/_[0-9a-f]{6}$/i, '').replace(/_/g, ' ').trim()

/** Drive의 타입별 폴더(연-월 하위 폴더 포함)에 있는 파일 전부 */
async function driveElementFiles() {
  const root = await rootFolderId()
  const top = await listFolder(root)
  const out: (DriveEntry & { type: ElementType })[] = []
  for (const [type, folder] of Object.entries(TYPE_FOLDER) as [ElementType, string][]) {
    const dir = top.find((e) => isFolder(e) && e.name === folder)
    if (!dir) continue
    const walk = async (id: string, depth: number) => {
      for (const e of await listFolder(id)) {
        if (isFolder(e)) { if (depth < 2) await walk(e.id, depth + 1) } else out.push({ ...e, type })
      }
    }
    await walk(dir.id, 0)
  }
  return out
}

export async function scanRecovery(): Promise<RecoveryScan> {
  let restoredBackup = false
  // 요소가 하나도 없으면(새 앱) Drive 백업 기록부터 불러옴
  if ((await db.items.count()) === 0) {
    const id = await findFile('miri-stock-backup.json', ['_backup'])
    if (id) { await importBackup(JSON.parse(await downloadFile(id))); restoredBackup = true }
  }
  const items = await db.items.toArray()
  const refill: Item[] = []
  for (const it of items) {
    if (it.driveFileId && !(await getBlob(it.id, 'final').catch(() => undefined))) refill.push(it)
  }
  const known = new Set(items.map((i) => i.driveFileId).filter(Boolean))
  const orphans = (await driveElementFiles()).filter((f) => !known.has(f.id))
  return { restoredBackup, refill, orphans }
}

const nearAspect = (w: number, h: number): AspectId | undefined =>
  ASPECTS.find((a) => Math.abs(w / h - a.w / a.h) < 0.01)?.id

/** 파일을 원본·최종으로 넣고 크기·미리보기·dHash 계산 */
async function putFiles(itemId: string, type: ElementType, blob: Blob): Promise<Partial<Item>> {
  await putBlob(itemId, 'source', blob)
  await putBlob(itemId, 'final', blob)
  const p: Partial<Item> = { bytes: blob.size }
  if (type === 'video') {
    p.durationSec = await videoDuration(blob)
    return p
  }
  let c
  if (type === 'svg') {
    const text = await blob.text()
    const a = analyzeSvg(text)
    p.width = a.width ?? undefined
    p.height = a.height ?? undefined
    c = await svgToCanvas(text, 600)
  } else {
    const full = await blobToCanvas(blob)
    p.width = full.width
    p.height = full.height
    c = downscaleLongSide(full, 600)
  }
  p.dhash = dHash(c)
  await putBlob(itemId, 'thumb', await thumbnail(c))
  if (type === 'background' && p.width && p.height) p.aspect = nearAspect(p.width, p.height)
  return p
}

export async function runRecovery(scan: RecoveryScan, onProgress: (msg: string) => void) {
  const total = scan.refill.length + scan.orphans.length
  let n = 0, refilled = 0, created = 0
  const failed: string[] = []
  for (const it of scan.refill) {
    onProgress(`파일 받는 중… ${++n}/${total} · ${it.title}`)
    try {
      const blob = await downloadBlobFile(it.driveFileId!, MIME[it.type])
      const p = await putFiles(it.id, it.type, blob)
      await db.items.update(it.id, { ...p, fileLost: undefined, updatedAt: nowIso() })
      refilled++
    } catch (e) { console.error(e); failed.push(it.title) }
  }
  const tasks = await db.plans.where('kind').equals('task').toArray()
  for (const f of scan.orphans) {
    const title = titleFromName(f.name)
    onProgress(`요소 만드는 중… ${++n}/${total} · ${title}`)
    try {
      const blob = await downloadBlobFile(f.id, MIME[f.type])
      const id = uid()
      const p = await putFiles(id, f.type, blob)
      const plan = tasks.find((t) => t.title.trim() === title)
      const item: Item = {
        id, title, theme: title, type: f.type, status: 'making', planId: plan?.id,
        promptLog: [], keywords: [], autoChecks: [], manualChecks: {},
        notes: '🛟 Drive 파일에서 복구한 요소예요. 프롬프트·키워드·심사 기록은 다시 입력하고 검수를 다시 해 주세요.',
        driveFileId: f.id, driveLink: f.webViewLink,
        createdAt: f.createdTime || nowIso(), updatedAt: nowIso(), ...p,
      }
      await db.items.add(item)
      created++
    } catch (e) { console.error(e); failed.push(title) }
  }
  return { refilled, created, failed }
}

// ── 자동 백업 ──────────────────────────────────────────────
const AUTO_KEY = 'miri-auto-backup'

/** 기록이 바뀌었을 때만 Drive _backup에 덮어쓰기. 로그인 창은 띄우지 않음(연결돼 있을 때만) */
export async function autoBackup(): Promise<boolean> {
  const data = await exportBackup()
  const sig = JSON.stringify([data.items.map((i) => i.updatedAt), data.ideas.length, data.plans.map((p) => `${p.id}${p.done}`), data.revenue.length, data.promptBank.length])
  let last = ''
  try { last = localStorage.getItem(AUTO_KEY) ?? '' } catch { /* 무시 */ }
  if (sig === last || (!data.items.length && !data.ideas.length && !data.plans.length)) return false
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
  const existing = await findFile('miri-stock-backup.json', ['_backup'])
  await uploadFile(blob, 'miri-stock-backup.json', ['_backup'], existing)
  // 날짜별 사본도 남김(하루 한 파일) — 잘못 덮어써도 전날 것으로 되돌릴 수 있게
  const daily = `miri-stock-backup-${nowIso().slice(0, 10)}.json`
  await uploadFile(blob, daily, ['_backup', '날짜별'], await findFile(daily, ['_backup', '날짜별']))
  try { localStorage.setItem(AUTO_KEY, sig); localStorage.setItem(`${AUTO_KEY}-at`, nowIso()) } catch { /* 무시 */ }
  return true
}

export function lastAutoBackup() {
  try { return localStorage.getItem(`${AUTO_KEY}-at`) } catch { return null }
}
