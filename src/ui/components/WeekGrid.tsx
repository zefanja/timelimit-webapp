import { useMemo, useRef, useState } from 'react'
import { blockedShare, MINUTES_PER_WEEK, parseBlockedTimes, serializeBlockedTimes, setRange } from '../../logic/blockedTimes'
import { getLocalDateInfo, WEEKDAYS_SHORT } from '../../logic/time'

const SLOT_OPTIONS = [60, 30] as const

/** editable weekly plan of blocked times (tap or drag to toggle) */
export function WeekGrid({ value, timeZone, onSave, saving }: { value: string; timeZone: string; onSave: (serialized: string) => void; saving: boolean }) {
  const [mask, setMask] = useState<Uint8Array>(() => parseBlockedTimes(value))
  const [slot, setSlot] = useState<(typeof SLOT_OPTIONS)[number]>(60)
  const paintValue = useRef<boolean | null>(null)
  const lastCell = useRef<string | null>(null)
  const dirty = useMemo(() => serializeBlockedTimes(mask) !== value, [mask, value])
  const nowMinute = getLocalDateInfo(Date.now(), timeZone).minuteOfWeek
  const rows = (24 * 60) / slot

  const apply = (day: number, row: number, on: boolean) => {
    const start = day * 1440 + row * slot
    setMask((current) => setRange(current, start, start + slot, on))
  }

  const cellFromPoint = (x: number, y: number) => {
    const element = document.elementFromPoint(x, y) as HTMLElement | null
    if (!element?.dataset.day) return null
    return { day: Number(element.dataset.day), row: Number(element.dataset.row) }
  }

  const onPointerDown = (event: React.PointerEvent) => {
    const cell = cellFromPoint(event.clientX, event.clientY)
    if (!cell) return
    const start = cell.day * 1440 + cell.row * slot
    const on = blockedShare(mask, start, start + slot) < 1
    paintValue.current = on
    lastCell.current = `${cell.day}:${cell.row}`
    apply(cell.day, cell.row, on)
    ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (paintValue.current === null) return
    const cell = cellFromPoint(event.clientX, event.clientY)
    if (!cell) return
    const key = `${cell.day}:${cell.row}`
    if (key === lastCell.current) return
    lastCell.current = key
    apply(cell.day, cell.row, paintValue.current)
  }

  const stop = () => {
    paintValue.current = null
    lastCell.current = null
  }

  const cells = []
  for (let row = 0; row < rows; row++) {
    const minute = row * slot
    cells.push(
      <div className="hour" key={'h' + row}>
        {minute % 60 === 0 && (minute / 60) % (slot === 30 ? 2 : 1) === 0 ? String(minute / 60).padStart(2, '0') : ''}
      </div>,
    )
    for (let day = 0; day < 7; day++) {
      const start = day * 1440 + minute
      const share = blockedShare(mask, start, start + slot)
      const isNow = nowMinute >= start && nowMinute < start + slot
      cells.push(
        <div
          key={day + ':' + row}
          data-day={day}
          data-row={row}
          className={'cell' + (share === 1 ? ' on' : share > 0 ? ' part' : '') + (isNow ? ' now' : '')}
          style={slot === 30 ? { height: 10 } : undefined}
        />,
      )
    }
  }

  return (
    <div>
      <p className="small muted">Rot = gesperrt. Tippen oder mit dem Finger ziehen, um Zeiten zu sperren oder freizugeben. Der Rahmen markiert die aktuelle Zeit.</p>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="small muted">Raster:</span>
        {SLOT_OPTIONS.map((option) => (
          <button key={option} className={'small' + (slot === option ? ' primary' : '')} onClick={() => setSlot(option)}>
            {option} min
          </button>
        ))}
      </div>
      <div className="week" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={stop} onPointerCancel={stop} onPointerLeave={stop}>
        <div />
        {WEEKDAYS_SHORT.map((day) => (
          <div className="head" key={day}>{day}</div>
        ))}
        {cells}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="small" onClick={() => setMask(setRange(mask, 0, MINUTES_PER_WEEK, false))}>Alles frei</button>
        <button className="small" onClick={() => setMask(nightPreset())}>Nachts sperren (20–7 Uhr)</button>
        <span className="grow" />
        <button className="small" disabled={!dirty} onClick={() => setMask(parseBlockedTimes(value))}>Zurücksetzen</button>
        <button className="primary" disabled={!dirty || saving} onClick={() => onSave(serializeBlockedTimes(mask))}>Speichern</button>
      </div>
    </div>
  )
}

function nightPreset(): Uint8Array {
  let mask: Uint8Array = new Uint8Array(MINUTES_PER_WEEK)
  for (let day = 0; day < 7; day++) {
    mask = setRange(mask, day * 1440, day * 1440 + 7 * 60, true)
    mask = setRange(mask, day * 1440 + 20 * 60, day * 1440 + 1440, true)
  }
  return mask
}
