// 사이트별 심사 기록 도우미 (디자인허브·툴디·Adobe Stock …)
import { nowIso, summarizeSites, type Item, type SiteRecord, type SiteStatus } from './db'
import type { Site } from './settings'
import { ymd } from './utils'

export const SITE_STATUSES: SiteStatus[] = ['uploaded', 'approved', 'rejected']
export const SITE_STATUS_LABEL: Record<SiteStatus | 'none', string> = {
  none: '안 올림',
  uploaded: '심사 중',
  approved: '판매 중',
  rejected: '거부됨',
}

/** 설정에서 지운 사이트라도 기록이 남아 있으면 이름 대신 id로 보여줌 */
export function siteOf(sites: Site[], id: string): Site {
  return sites.find((s) => s.id === id) ?? { id, name: id, short: id, url: '' }
}

/** 이 요소에 보여줄 사이트: 설정의 사이트 + 기록만 남은 사이트 */
export function sitesFor(item: Item, sites: Site[]): Site[] {
  const extra = Object.keys(item.sites ?? {}).filter((id) => !sites.some((s) => s.id === id))
  return [...sites, ...extra.map((id) => siteOf(sites, id))]
}

/** 한 사이트의 상태 바꾸기(null = 기록 지우기) → 전체 상태도 다시 계산한 patch */
export function sitePatch(item: Item, siteId: string, to: SiteStatus | null, opt: { reason?: string; date?: string } = {}): Partial<Item> {
  const sites = { ...(item.sites ?? {}) }
  if (!to) delete sites[siteId]
  else {
    const prev = sites[siteId]
    const rec: SiteRecord = { ...prev, status: to, uploadedAt: opt.date ?? prev?.uploadedAt ?? ymd() }
    if (to === 'approved') rec.approvedAt = prev?.approvedAt ?? ymd()
    else delete rec.approvedAt
    if (opt.reason !== undefined) rec.rejectReason = opt.reason || undefined
    sites[siteId] = rec
  }
  const base = item.status === 'making' ? 'ready' : item.status
  return { sites, ...summarizeSites(base, sites), readyAt: item.readyAt ?? nowIso(), updatedAt: nowIso() }
}

/** 사이트 기록 필드만 고치기(날짜·거부 사유) */
export function siteFieldPatch(item: Item, siteId: string, p: Partial<SiteRecord>): Partial<Item> {
  const cur = item.sites?.[siteId]
  if (!cur) return {}
  const sites = { ...item.sites, [siteId]: { ...cur, ...p } }
  return { sites, ...summarizeSites(item.status, sites), updatedAt: nowIso() }
}

/** 모든 요소의 사이트 기록을 펼침 */
export function allRecords(items: Item[]) {
  return items.flatMap((i) => Object.entries(i.sites ?? {}).map(([site, rec]) => ({ i, site, rec })))
}
