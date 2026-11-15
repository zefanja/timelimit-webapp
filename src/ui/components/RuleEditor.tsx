import { useState } from 'react'
import { actions } from '../../actions/parentActions'
import { ServerTimeLimitRule } from '../../api/types'
import { generateFamilyId } from '../../crypto/bytes'
import { formatDayMask, formatDuration, formatMinuteOfDay, parseTimeOfDay } from '../../logic/time'
import { useEngine } from '../engine'
import { DayPicker, DurationInput, Modal, useAction } from './common'

export function describeRule(rule: ServerTimeLimitRule): string {
  const days = formatDayMask(rule.dayMask)
  const multipleDays = (rule.dayMask & (rule.dayMask - 1)) !== 0
  let text = rule.maxTime === 0 ? `${days}: gesperrt` : `${days}: ${formatDuration(rule.maxTime)}${multipleDays ? (rule.perDay ? ' pro Tag' : ' zusammen') : ''}`
  if (rule.start !== 0 || rule.end !== 1439) text += `, nur ${formatMinuteOfDay(rule.start)}–${formatMinuteOfDay(rule.end + 1 > 1439 ? 1439 : rule.end + 1)}`
  if (rule.session > 0) text += `, Sitzung max. ${formatDuration(rule.session)} / Pause ${formatDuration(rule.pause)}`
  if (rule.extraTime) text += ', gilt auch für Extrazeit'
  return text
}

export function RuleEditor({ categoryId, rule, onClose }: { categoryId: string; rule: ServerTimeLimitRule | null; onClose: () => void }) {
  const engine = useEngine()
  const { busy, run } = useAction()
  const [days, setDays] = useState(rule?.dayMask ?? 31)
  const [maxTime, setMaxTime] = useState(rule?.maxTime ?? 60 * 60_000)
  const [perDay, setPerDay] = useState(rule?.perDay ?? true)
  const [extraTime, setExtraTime] = useState(rule?.extraTime ?? false)
  const [limitWindow, setLimitWindow] = useState(rule ? rule.start !== 0 || rule.end !== 1439 : false)
  const [start, setStart] = useState(formatMinuteOfDay(rule?.start ?? 0))
  const [end, setEnd] = useState(formatMinuteOfDay(rule && rule.end !== 1439 ? rule.end + 1 : 0))
  const [sessions, setSessions] = useState(rule ? rule.session > 0 : false)
  const [session, setSession] = useState(rule?.session || 30 * 60_000)
  const [pause, setPause] = useState(rule?.pause || 15 * 60_000)

  const save = () =>
    run(async () => {
      if (days === 0) throw new Error('Bitte mindestens einen Tag wählen.')
      let startMinute = 0
      let endMinute = 1439
      if (limitWindow) {
        const s = parseTimeOfDay(start)
        const e = parseTimeOfDay(end)
        if (s === null || e === null) throw new Error('Bitte Uhrzeiten als HH:MM eingeben.')
        startMinute = s
        // the end is inclusive in TimeLimit ("00:00" as end means end of day)
        endMinute = e === 0 ? 1439 : e - 1
        if (endMinute < startMinute) throw new Error('Das Ende muss nach dem Beginn liegen.')
      }
      const data = {
        time: maxTime,
        days,
        extraTime,
        start: startMinute,
        end: endMinute,
        dur: sessions ? session : 0,
        pause: sessions ? pause : 0,
        perDay,
      }
      await engine.run(rule ? actions.updateRule({ ruleId: rule.id, ...data }) : actions.createRule({ ruleId: generateFamilyId(), categoryId, ...data }))
      onClose()
    }, 'Regel gespeichert')

  const multipleDays = (days & (days - 1)) !== 0

  return (
    <Modal
      title={rule ? 'Regel bearbeiten' : 'Neue Regel'}
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Abbrechen</button>
          <button className="primary" disabled={busy} onClick={save}>Speichern</button>
        </>
      }
    >
      <div className="field">
        <label>Tage</label>
        <DayPicker mask={days} onChange={setDays} />
      </div>
      <div className="field">
        <label>Maximale Nutzungsdauer (0 = gesperrt)</label>
        <DurationInput value={maxTime} onChange={setMaxTime} maxHours={multipleDays && !perDay ? 99 : 24} />
      </div>
      {multipleDays && (
        <div className="field">
          <label className="check">
            <input type="radio" name="perday" checked={perDay} onChange={() => setPerDay(true)} /> für jeden Tag einzeln
          </label>
          <label className="check">
            <input type="radio" name="perday" checked={!perDay} onChange={() => setPerDay(false)} /> für alle gewählten Tage zusammen (Wochenbudget)
          </label>
        </div>
      )}
      <label className="check">
        <input type="checkbox" checked={extraTime} onChange={(e) => setExtraTime(e.target.checked)} /> Regel gilt auch bei Nutzung von Extrazeit
      </label>
      <label className="check">
        <input type="checkbox" checked={limitWindow} onChange={(e) => setLimitWindow(e.target.checked)} /> Nur in einem Zeitfenster
      </label>
      {limitWindow && (
        <div className="row">
          <div className="grow">
            <label htmlFor="rs">von</label>
            <input id="rs" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="grow">
            <label htmlFor="re">bis</label>
            <input id="re" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
      )}
      <label className="check">
        <input type="checkbox" checked={sessions} onChange={(e) => setSessions(e.target.checked)} /> Sitzungsdauer begrenzen (mit Pause)
      </label>
      {sessions && (
        <div className="row">
          <div className="grow">
            <label>Sitzung</label>
            <DurationInput value={session} onChange={setSession} maxHours={12} />
          </div>
          <div className="grow">
            <label>Pause</label>
            <DurationInput value={pause} onChange={setPause} maxHours={12} />
          </div>
        </div>
      )}
    </Modal>
  )
}
