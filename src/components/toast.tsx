import { useSyncExternalStore } from 'react'

type Kind = 'ok' | 'bad' | 'info'
interface T { id: number; text: string; kind: Kind }

let toasts: T[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function toast(text: string, kind: Kind = 'ok') {
  if (toasts.some((t) => t.text === text)) return // 같은 알림이 떠 있으면 또 띄우지 않음
  const id = Date.now() + Math.random()
  toasts = [...toasts, { id, text, kind }]
  emit()
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); emit() }, kind === 'bad' ? 9000 : 3500)
}

export function Toasts() {
  const list = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb) }, () => toasts)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => { toasts = toasts.filter((x) => x.id !== t.id); emit() }} title="눌러서 닫기">
          {t.text}
        </div>
      ))}
    </div>
  )
}
