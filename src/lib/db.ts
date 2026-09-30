import Dexie, { type EntityTable } from 'dexie'
import type { AspectId, ElementType } from './rules'

export type ItemStatus = 'making' | 'ready' | 'uploaded' | 'approved' | 'rejected'

export const STATUS_LABEL: Record<ItemStatus, string> = {
  making: '제작 중',
  ready: '업로드 대기',
  uploaded: '심사 중',
  approved: '판매 중',
  rejected: '거부됨',
}

export interface CheckResult {
  ruleId: string
  ok: boolean | null // null = 판단 불가/경고
  message: string
}

export interface Item {
  id: string
  title: string
  type: ElementType
  status: ItemStatus
  theme?: string
  planId?: string
  prompt?: string
  /** 프롬프트 증빙 기록 */
  promptLog: { at: string; prompt: string; tool: string }[]
  aiTool?: string
  keywords: string[]
  aspect?: AspectId
  /** PNG: 아이콘·이모티콘·캐릭터 사이즈(최소 700px) 여부 */
  smallSize?: boolean
  width?: number
  height?: number
  bytes?: number
  durationSec?: number
  dhash?: string
  /** 저장소에서 읽을 수 없게 된 파일(Safari 저장 문제). 다시 올리거나 다시 처리해야 함 */
  fileLost?: ('source' | 'final')[]
  /** 배경 제거 후 원본 가장자리에 닿은 변(잘린 피사체 의심). 빈 배열 = 안 닿음 */
  edgeCut?: string[]
  autoChecks: CheckResult[]
  manualChecks: Record<string, boolean>
  aiReview?: { at: string; text: string; pass: boolean | null }
  rejectReason?: string
  notes?: string
  driveFileId?: string
  driveLink?: string
  createdAt: string
  updatedAt: string
  readyAt?: string
  uploadedAt?: string // YYYY-MM-DD
  approvedAt?: string
}

export interface StoredBlob {
  key: string // `${itemId}:${kind}`
  itemId: string
  kind: 'source' | 'final' | 'thumb'
  /** 예전 방식(Blob 그대로). Safari에서 저장 실패가 있어 새로 저장할 땐 data/type 사용 */
  blob?: Blob
  data?: ArrayBuffer
  /** 최후 수단: base64 문자열(ArrayBuffer 저장도 실패하는 환경) */
  b64?: string
  type?: string
}

export interface Idea {
  id: string
  title: string
  notes?: string
  types: ElementType[]
  source: 'me' | 'ai' | 'trend'
  tags: string[]
  createdAt: string
  pinned?: boolean
}

export interface Plan {
  id: string
  title: string
  kind: 'theme' | 'task'
  start: string // YYYY-MM-DD
  end: string
  types: ElementType[]
  notes?: string
  color?: string
  ideaId?: string
  done?: boolean
}

/** AI가 추천한 프롬프트 보관 — 주제·타입별로 남겨 다음 작업에 재사용 */
export interface SavedPrompt {
  id: string
  /** `${type}:${주제}` */
  key: string
  topic: string
  type: import('./rules').ElementType
  prompt: string
  memo?: string
  createdAt: string
  /** 이 프롬프트로 만든 요소 */
  usedBy?: string
}

export const promptKey = (type: string, topic: string) => `${type}:${topic.trim().toLowerCase().replace(/\s+/g, ' ')}`

export interface Revenue {
  id: string
  month: string // YYYY-MM
  amount: number
  memo?: string
  itemId?: string
  /** 어느 타입에서 난 수익인지(선택) — 통계의 타입별 수익 */
  type?: ElementType
}

export const db = new Dexie('miri-stock') as Dexie & {
  items: EntityTable<Item, 'id'>
  blobs: EntityTable<StoredBlob, 'key'>
  ideas: EntityTable<Idea, 'id'>
  plans: EntityTable<Plan, 'id'>
  revenue: EntityTable<Revenue, 'id'>
  promptBank: EntityTable<SavedPrompt, 'id'>
}

db.version(1).stores({
  items: 'id, type, status, createdAt, uploadedAt, planId',
  blobs: 'key, itemId',
  ideas: 'id, createdAt',
  plans: 'id, start, end, kind',
  revenue: 'id, month',
})
// v2: 프롬프트 보관함 추가 (기존 데이터는 그대로)
db.version(2).stores({
  promptBank: 'id, key, usedBy, createdAt',
})

export const uid = () => crypto.randomUUID()
export const nowIso = () => new Date().toISOString()

// ── 파일 저장 ──────────────────────────────────────────────
// Safari(맥 Dock 웹앱 포함)는 IndexedDB에 Blob/File을 그대로 넣거나, 예전에 넣어 둔 Blob을
// 다시 읽을 때 실패하는 경우가 있다("Error preparing Blob/File data to be stored…").
// 그래서 ① 저장은 항상 ArrayBuffer(실패 시 base64 문자열)로 하고
// ② 읽을 땐 항상 메모리에 새로 만든 Blob을 돌려준다(디스크에 묶인 Blob을 앱 안에 들고 다니지 않음).

/** 어떤 Blob/File이든 메모리 기반 Blob으로 복사. 읽을 수 없으면 undefined */
export async function toMemoryBlob(b: Blob): Promise<Blob | undefined> {
  try {
    return new Blob([await b.arrayBuffer()], { type: b.type })
  } catch (e) {
    console.warn('파일을 읽을 수 없음', e)
    return undefined
  }
}

const toB64 = (data: ArrayBuffer) => {
  const u = new Uint8Array(data)
  let bin = ''
  for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(bin)
}

export async function putBlob(itemId: string, kind: StoredBlob['kind'], blob: Blob) {
  const key = `${itemId}:${kind}`
  const data = await blob.arrayBuffer()
  try {
    await db.blobs.put({ key, itemId, kind, data, type: blob.type })
  } catch (e) {
    console.warn('ArrayBuffer 저장 실패 → base64로 저장', e)
    await db.blobs.put({ key, itemId, kind, b64: toB64(data), type: blob.type })
  }
}

function recordToBlob(r: StoredBlob): Blob | undefined {
  if (r.data) return new Blob([r.data], { type: r.type ?? '' })
  if (r.b64) {
    const bin = atob(r.b64)
    const u = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
    return new Blob([u], { type: r.type ?? '' })
  }
  return undefined
}

/** 저장된 파일을 메모리 Blob으로. 없거나 읽을 수 없으면 undefined */
export async function getBlob(itemId: string, kind: StoredBlob['kind']): Promise<Blob | undefined> {
  const r = await db.blobs.get(`${itemId}:${kind}`)
  if (!r) return undefined
  return recordToBlob(r) ?? (r.blob ? await toMemoryBlob(r.blob) : undefined)
}

/**
 * 시작할 때 한 번: 예전 방식(Blob 그대로)으로 저장된 파일을 새 방식으로 바꿔 둠.
 * 읽을 수 없는 파일은 지우지 않고(복구 가능성), 해당 요소에 fileLost로 표시만 한다.
 */
export async function migrateBlobs(onProgress?: (done: number, total: number) => void) {
  const keys = (await db.blobs.toCollection().primaryKeys()) as string[]
  let done = 0
  const lost = new Map<string, Set<StoredBlob['kind']>>()
  for (const key of keys) {
    let r: StoredBlob | undefined
    try { r = await db.blobs.get(key) } catch { r = undefined }
    if (r && !r.data && !r.b64 && r.blob) {
      const m = await toMemoryBlob(r.blob)
      if (m) await putBlob(r.itemId, r.kind, m)
      else {
        if (!lost.has(r.itemId)) lost.set(r.itemId, new Set())
        lost.get(r.itemId)!.add(r.kind)
      }
    }
    onProgress?.(++done, keys.length)
  }
  for (const [itemId, kinds] of lost) {
    await db.items.update(itemId, { fileLost: [...kinds].filter((k) => k !== 'thumb') })
  }
  return { total: keys.length, lost: lost.size }
}

export async function deleteItem(id: string) {
  await db.transaction('rw', db.items, db.blobs, async () => {
    await db.items.delete(id)
    await db.blobs.where('itemId').equals(id).delete()
  })
}

/** 메타데이터 백업(파일 제외) */
export async function exportBackup() {
  return {
    version: 1,
    exportedAt: nowIso(),
    items: await db.items.toArray(),
    ideas: await db.ideas.toArray(),
    plans: await db.plans.toArray(),
    revenue: await db.revenue.toArray(),
    promptBank: await db.promptBank.toArray(),
  }
}

export async function importBackup(data: Awaited<ReturnType<typeof exportBackup>>) {
  await db.transaction('rw', [db.items, db.ideas, db.plans, db.revenue, db.promptBank], async () => {
    await db.items.bulkPut(data.items ?? [])
    await db.ideas.bulkPut(data.ideas ?? [])
    await db.plans.bulkPut(data.plans ?? [])
    await db.revenue.bulkPut(data.revenue ?? [])
    await db.promptBank.bulkPut(data.promptBank ?? [])
  })
}
