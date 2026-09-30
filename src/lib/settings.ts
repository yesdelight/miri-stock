import { useSyncExternalStore } from 'react'

export type Provider = 'claude' | 'openai' | 'gemini'
export type AiMode = 'api' | 'manual'

/** 요소를 올리는 사이트 — 설정에서 추가·수정 */
export interface Site {
  id: string
  name: string
  /** 뱃지에 쓰는 짧은 이름 */
  short: string
  url: string
}

export const DEFAULT_SITES: Site[] = [
  { id: 'designhub', name: '미리캔버스 디자인허브', short: '디자인허브', url: 'https://designhub.miricanvas.com/ko/login' },
  { id: 'tooldi', name: '툴디', short: '툴디', url: 'https://www.tooldi.com/creator/channel/MjE0NTU0' },
  { id: 'adobe', name: 'Adobe Stock', short: 'Adobe', url: 'https://contributor.stock.adobe.com/' },
]

export interface Settings {
  aiMode: AiMode
  textProvider: Provider
  /** 수동 모드에서 주로 쓰는 채팅 서비스 */
  manualChat: Provider
  imageProvider: 'openai' | 'gemini' | 'manual'
  anthropicKey: string
  openaiKey: string
  geminiKey: string
  claudeModel: string
  openaiModel: string
  openaiImageModel: string
  geminiModel: string
  geminiImageModel: string
  googleClientId: string
  driveFolderId: string
  driveFolderName: string
  extraBannedWords: string
  /** 시즌 요소 제작 권장 선행 기간(일) */
  leadDays: number
  /** 화면 테마 */
  theme: 'auto' | 'light' | 'dark'
  /** 올리는 사이트 목록 */
  sites: Site[]
  /** API 무료 크레딧 끝나는 날(YYYY-MM-DD) — 홈에서 미리 알려줌 */
  creditEndsAt: string
}

const DEFAULTS: Settings = {
  aiMode: 'manual',
  textProvider: 'claude',
  manualChat: 'openai',
  imageProvider: 'manual',
  anthropicKey: '',
  openaiKey: '',
  geminiKey: '',
  claudeModel: 'claude-opus-5-5',
  openaiModel: 'gpt-5',
  openaiImageModel: 'gpt-image-1',
  geminiModel: 'gemini-2.5-flash',
  geminiImageModel: 'gemini-2.5-flash-image',
  googleClientId: '783969864925-v0jrdb2onvuokglgus8fq23mk9rpdfn0.apps.googleusercontent.com',
  driveFolderId: '1Pkj1EW5dDaZrJkdB1FZKiEzBjtfNISBV',
  driveFolderName: '[Miri] Stock',
  extraBannedWords: '',
  leadDays: 45,
  theme: 'auto',
  sites: DEFAULT_SITES,
  creditEndsAt: '',
}

const KEY = 'miri-stock-settings'
let current: Settings = load()
const listeners = new Set<() => void>()

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    const s: Settings = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
    // 이전에 빈 값으로 저장돼 있어도 기본 클라이언트 ID·폴더를 사용
    if (!s.googleClientId) s.googleClientId = DEFAULTS.googleClientId
    if (!s.driveFolderId) s.driveFolderId = DEFAULTS.driveFolderId
    if (!Array.isArray(s.sites) || !s.sites.length) s.sites = DEFAULT_SITES
    return s
  } catch {
    return { ...DEFAULTS }
  }
}

export function getSettings() {
  return current
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    /* 저장 불가 환경 — 메모리에만 유지 */
  }
  listeners.forEach((l) => l())
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}

export function hasTextApi(s: Settings = current) {
  if (s.aiMode !== 'api') return false
  return Boolean({ claude: s.anthropicKey, openai: s.openaiKey, gemini: s.geminiKey }[s.textProvider])
}
