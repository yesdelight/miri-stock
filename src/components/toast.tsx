import { useSyncExternalStore } from 'react'

type Kind = 'ok' | 'bad' | 'info'
interface T { id: number; text: string; kind: Kind }

let toasts: T[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function toast(text: string, kind: Kind = 'ok') {
  const id = Date.now() + Math.random()
  toasts = [...toasts, { id, text, kind }]
  emit()
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); emit() }, kind === 'bad' ? 6000 : 3500)
}

export function Toasts() {
  const list = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb) }, () => toasts)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
    </div>
  )
}
