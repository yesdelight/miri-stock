// Google Drive 연동: Google Identity Services 토큰 → Drive REST v3.
// 이미 만들어 둔 "[Miri] Stock" 폴더에 쓰려면 drive 범위가 필요(drive.file은 앱이 만든 파일만 접근 가능).
import { getSettings } from './settings'

const SCOPE = 'https://www.googleapis.com/auth/drive'
let token: { value: string; exp: number } | null = null

interface TokenClient { requestAccessToken(o?: { prompt?: string }): void }
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(cfg: {
            client_id: string
            scope: string
            callback: (r: { access_token?: string; expires_in?: number; error?: string }) => void
          }): TokenClient
        }
      }
    }
  }
}

function loadGis(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve()
  return new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.onload = () => res()
    s.onerror = () => rej(new Error('Google 로그인 스크립트를 불러오지 못했어요.'))
    document.head.appendChild(s)
  })
}

export function driveConnected() {
  return Boolean(token && token.exp > Date.now())
}

export async function connectDrive(): Promise<void> {
  const { googleClientId } = getSettings()
  if (!googleClientId) throw new Error('설정에서 Google OAuth 클라이언트 ID를 입력하세요.')
  await loadGis()
  await new Promise<void>((res, rej) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: googleClientId,
      scope: SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) return rej(new Error(r.error ?? '로그인 실패'))
        token = { value: r.access_token, exp: Date.now() + (r.expires_in ?? 3600) * 1000 - 60000 }
        res()
      },
    })
    client.requestAccessToken({ prompt: token ? '' : 'consent' })
  })
}

async function api(path: string, init: RequestInit = {}) {
  if (!driveConnected()) await connectDrive()
  const res = await fetch(`https://www.googleapis.com${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token!.value}` },
  })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new Error(j.error?.message ?? `Drive 오류 ${res.status}`)
  }
  return res.json()
}

const folderCache = new Map<string, string>()

export async function rootFolderId(): Promise<string> {
  const s = getSettings()
  if (s.driveFolderId) return s.driveFolderId
  return ensureFolder(s.driveFolderName, 'root')
}

export async function ensureFolder(name: string, parent: string): Promise<string> {
  const key = `${parent}/${name}`
  if (folderCache.has(key)) return folderCache.get(key)!
  const q = encodeURIComponent(
    `name = '${name.replace(/'/g, "\\'")}' and '${parent}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  )
  const found = await api(`/drive/v3/files?q=${q}&fields=files(id)`)
  let id: string = found.files?.[0]?.id
  if (!id) {
    const created = await api('/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parents: [parent], mimeType: 'application/vnd.google-apps.folder' }),
    })
    id = created.id
  }
  folderCache.set(key, id)
  return id
}

/** 하위 경로(예: ['SVG', '2026-10'])에 파일 업로드. existingId가 있으면 덮어쓰기 */
export async function uploadFile(blob: Blob, name: string, subPath: string[], existingId?: string) {
  let parent = await rootFolderId()
  for (const seg of subPath) parent = await ensureFolder(seg, parent)
  const meta = existingId ? { name } : { name, parents: [parent] }
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }))
  form.append('file', blob)
  const url = existingId
    ? `/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id,webViewLink`
    : '/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink'
  return (await api(url, { method: existingId ? 'PATCH' : 'POST', body: form })) as { id: string; webViewLink: string }
}

export async function findFile(name: string, subPath: string[]): Promise<string | undefined> {
  let parent = await rootFolderId()
  for (const seg of subPath) parent = await ensureFolder(seg, parent)
  const q = encodeURIComponent(`name = '${name}' and '${parent}' in parents and trashed = false`)
  const r = await api(`/drive/v3/files?q=${q}&fields=files(id)`)
  return r.files?.[0]?.id
}

export async function downloadFile(id: string): Promise<string> {
  if (!driveConnected()) await connectDrive()
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
    headers: { Authorization: `Bearer ${token!.value}` },
  })
  if (!res.ok) throw new Error(`Drive 오류 ${res.status}`)
  return res.text()
}
