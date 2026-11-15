import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { describeError } from '../../api/client'

// ---------- icons (inline, no dependency) ----------

const paths: Record<string, string> = {
  home: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  devices: 'M4 5h11a1 1 0 0 1 1 1v3h-2V7H5v10h7v2H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm13 5h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zm1 2v5h1v-5z',
  settings: 'M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm8.4 4.6.1-1.1-.1-1.1 2-1.6-2-3.4-2.4.9a8 8 0 0 0-1.9-1.1L15.8 2h-3.9l-.4 2.6a8 8 0 0 0-1.9 1.1l-2.4-.9-2 3.4 2 1.6-.1 1.1.1 1.1-2 1.6 2 3.4 2.4-.9c.6.5 1.2.8 1.9 1.1l.4 2.6h3.9l.4-2.6c.7-.3 1.3-.6 1.9-1.1l2.4.9 2-3.4z',
  back: 'M15 5 8 12l7 7',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V7a3 3 0 0 0-6 0z',
  sync: 'M4 12a8 8 0 0 1 13.7-5.7L20 4v6h-6l2.3-2.3A6 6 0 0 0 6 12zm16 0a8 8 0 0 1-13.7 5.7L4 20v-6h6l-2.3 2.3A6 6 0 0 0 18 12z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  edit: 'm4 17.2 10.6-10.6 2.8 2.8L6.8 20H4zM16 5.2l1.4-1.4a1 1 0 0 1 1.4 0l1.4 1.4a1 1 0 0 1 0 1.4L18.8 8z',
  trash: 'M9 3h6l1 2h4v2H4V5h4zm-3 6h12l-1 12H7z',
  chevron: 'm9 5 7 7-7 7',
}

export function Icon({ name, filled = true }: { name: keyof typeof paths | string; filled?: boolean }) {
  const isStroke = name === 'back' || name === 'chevron'
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={paths[name]}
        fill={isStroke || !filled ? 'none' : 'currentColor'}
        stroke={isStroke ? 'currentColor' : 'none'}
        strokeWidth={isStroke ? 2.2 : 0}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ---------- modal ----------

export function Modal({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  )
}

// ---------- toast ----------

const ToastContext = createContext<(message: string) => void>(() => undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback((text: string) => {
    setMessage(text)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(null), 3500)
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)

/** runs an async action, shows errors as toast and tracks a busy flag */
export function useAction() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const run = useCallback(
    async (fn: () => Promise<unknown> | unknown, success?: string) => {
      setBusy(true)
      try {
        await fn()
        if (success) toast(success)
        return true
      } catch (ex) {
        toast(describeError(ex))
        return false
      } finally {
        setBusy(false)
      }
    },
    [toast],
  )

  return { busy, run }
}

// ---------- confirm ----------

export function ConfirmButton({
  children,
  confirm,
  onConfirm,
  className = 'danger',
}: {
  children: ReactNode
  confirm: string
  onConfirm: () => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>
        {children}
      </button>
      {open && (
        <Modal
          title="Bist du sicher?"
          onClose={() => setOpen(false)}
          actions={
            <>
              <button onClick={() => setOpen(false)}>Abbrechen</button>
              <button
                className="danger"
                onClick={() => {
                  setOpen(false)
                  onConfirm()
                }}
              >
                Ja, fortfahren
              </button>
            </>
          }
        >
          <p>{confirm}</p>
        </Modal>
      )}
    </>
  )
}

// ---------- inputs ----------

export function DurationInput({ value, onChange, maxHours = 24 }: { value: number; onChange: (ms: number) => void; maxHours?: number }) {
  const totalMinutes = Math.round(value / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  return (
    <div className="row">
      <select aria-label="Stunden" value={hours} onChange={(e) => onChange((Number(e.target.value) * 60 + minutes) * 60_000)} style={{ width: 'auto' }}>
        {Array.from({ length: maxHours + 1 }, (_, h) => (
          <option key={h} value={h}>
            {h} h
          </option>
        ))}
      </select>
      <select aria-label="Minuten" value={minutes} onChange={(e) => onChange((hours * 60 + Number(e.target.value)) * 60_000)} style={{ width: 'auto' }}>
        {Array.from({ length: 12 }, (_, i) => i * 5).concat(minutes % 5 !== 0 ? [minutes] : []).sort((a, b) => a - b).map((m) => (
          <option key={m} value={m}>
            {m} min
          </option>
        ))}
      </select>
    </div>
  )
}

export function DayPicker({ mask, onChange }: { mask: number; onChange: (mask: number) => void }) {
  const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
  return (
    <div>
      <div className="daypicker">
        {days.map((day, index) => (
          <button key={day} type="button" className={mask & (1 << index) ? 'on' : ''} aria-pressed={!!(mask & (1 << index))} onClick={() => onChange(mask ^ (1 << index))}>
            {day}
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <button type="button" className="small ghost" onClick={() => onChange(31)}>Mo–Fr</button>
        <button type="button" className="small ghost" onClick={() => onChange(96)}>Wochenende</button>
        <button type="button" className="small ghost" onClick={() => onChange(127)}>Alle</button>
      </div>
    </div>
  )
}

export function Spinner() {
  return <span className="spinner" aria-label="lädt" />
}
