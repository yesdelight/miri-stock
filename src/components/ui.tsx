import { useEffect, useState, type ReactNode } from 'react'
import { STATUS_LABEL, type ItemStatus } from '../lib/db'
import { TYPE_LABEL, type ElementType } from '../lib/rules'

export function TypeBadge({ type }: { type: ElementType }) {
  return <span className={`badge t-${type}`}>{TYPE_LABEL[type]}</span>
}

const STATUS_CLS: Record<ItemStatus, string> = { making: '', ready: 'accent', uploaded: 'warn', approved: 'ok', rejected: 'bad' }
export function StatusBadge({ status }: { status: ItemStatus }) {
  return <span className={`badge ${STATUS_CLS[status]}`}>{STATUS_LABEL[status]}</span>
}

export function Modal({ onClose, children, title }: { onClose: () => void; children: ReactNode; title: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="row between mb">
          <h2>{title}</h2>
          <button className="ghost" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.id} className={t.id === value ? 'active' : ''} onClick={() => onChange(t.id)}>{t.label}</button>
      ))}
    </div>
  )
}

/** Blob → object URL (자동 해제) */
export function useObjectUrl(blob: Blob | null | undefined) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!blob) { setUrl(undefined); return }
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}

export function TypePicker({ value, onChange, multi }: { value: ElementType[]; onChange: (v: ElementType[]) => void; multi?: boolean }) {
  return (
    <div className="row">
      {(Object.keys(TYPE_LABEL) as ElementType[]).map((t) => {
        const on = value.includes(t)
        return (
          <button
            key={t}
            className={`small ${on ? 'primary' : ''}`}
            onClick={() => onChange(multi ? (on ? value.filter((x) => x !== t) : [...value, t]) : [t])}
          >
            {TYPE_LABEL[t]}
          </button>
        )
      })}
    </div>
  )
}
