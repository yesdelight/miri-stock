// 요소 파일을 Drive의 타입별 폴더([Miri] Stock/배경·PNG 요소·SVG 요소·동영상/연-월)에 올리기
import { db, getBlob, nowIso, type Item } from './db'
import { uploadFile } from './drive'
import { SPECS, TYPE_FOLDER } from './rules'
import { safeFileName, ymd } from './utils'

export const driveFileName = (item: Item) => `${safeFileName(item.title)}_${item.id.slice(0, 6)}.${SPECS[item.type].ext}`

/** 최종 파일을 올리고 요소에 Drive 링크를 기록. 최종 파일이 없으면 false */
export async function uploadItemToDrive(item: Item, file?: Blob | null): Promise<boolean> {
  const blob = file ?? (await getBlob(item.id, 'final'))
  if (!blob) return false
  const month = (item.readyAt ?? item.createdAt ?? ymd()).slice(0, 7)
  const r = await uploadFile(blob, driveFileName(item), [TYPE_FOLDER[item.type], month], item.driveFileId)
  await db.items.update(item.id, { driveFileId: r.id, driveLink: r.webViewLink, updatedAt: nowIso() })
  return true
}
