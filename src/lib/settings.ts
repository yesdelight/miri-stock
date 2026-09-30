import { useSyncExternalStore } from 'react'

export type Provider = 'claude' | 'openai' | 'gemini'
export type AiMode = 'api' | 'manual'

export interface Settings {
  aiMode: AiMode
  textProvider: Provider
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
}

const DEFAULTS: Settings = {
  aiMode: 'manual',
  textProvider: 'claude',
  imageProvider: 'manual',
  anthropicKey: '',
  openaiKey: '',
  geminiKey: '',
  claudeModel: 'claude-opus-5-5',
  openaiModel: 'gpt-5',
  openaiImageModel: 'gpt-image-1',
  geminiModel: 'gemini-2.5-flash',
  geminiImageModel: 'gemini-2.5-flash-image',
  googleClientId: '',
  driveFolderId: '1Pkj1EW5dDaZrJkdB1FZKiEzBjtfNISBV',
  driveFolderName: '[Miri] Stock',
  extraBannedWords: '',
  leadDays: 45,
}

const KEY = 'miri-stock-settings'
let current: Settings = load()
const listeners = new Set<() => void>()

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
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
