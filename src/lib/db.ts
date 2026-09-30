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
  blob: Blob
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

export async function putBlob(itemId: string, kind: StoredBlob['kind'], blob: Blob) {
  await db.blobs.put({ key: `${itemId}:${kind}`, itemId, kind, blob })
}
export async function getBlob(itemId: string, kind: StoredBlob['kind']) {
  return (await db.blobs.get(`${itemId}:${kind}`))?.blob
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
