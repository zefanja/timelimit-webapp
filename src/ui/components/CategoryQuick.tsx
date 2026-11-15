import { actions } from '../../actions/parentActions'
import { CategoryState, FamilyState } from '../../state/familyState'
import { summarizeCategory } from '../../logic/remainingTime'
import { formatDuration, formatTimestamp, getLocalDateInfo } from '../../logic/time'
import { useEngine } from '../engine'
import { useAction } from './common'

export function CategoryStatusLine({ state, category, timeZone, now }: { state: FamilyState; category: CategoryState; timeZone: string; now: number }) {
  const summary = summarizeCategory(state, category, timeZone, now)
  const total = summary.usedToday + (summary.remaining?.includingExtraTime ?? 0)
  const share = summary.remaining && total > 0 ? Math.min(1, summary.usedToday / total) : 0

  let status
  switch (summary.status.kind) {
    case 'limitsDisabled':
      status = <span className="pill warn">Limits pausiert bis {formatTimestamp(summary.status.until)}</span>
      break
    case 'temporarilyBlocked':
      status = <span className="pill bad">Gesperrt{summary.status.until ? ' bis ' + formatTimestamp(summary.status.until) : ''}</span>
      break
    case 'blockedTime':
      status = <span className="pill bad">Sperrzeit</span>
      break
    case 'timeOver':
      status = <span className="pill bad">Zeit aufgebraucht</span>
      break
    case 'ok':
      status = summary.status.remaining === null ? <span className="pill">ohne Zeitlimit</span> : <span className="pill ok">noch {formatDuration(summary.status.remaining)}</span>
      break
  }

  return (
    <>
      <div className="cat-title">
        <strong>{summary.title}</strong>
        {status}
      </div>
      {summary.remaining && (
        <div className={'progress' + (summary.remaining.includingExtraTime <= 0 ? ' over' : '')} aria-hidden="true">
          <div style={{ width: `${Math.round(share * 100)}%` }} />
        </div>
      )}
      <div className="small muted">
        Heute genutzt: {formatDuration(summary.usedToday)}
        {summary.extraTime > 0 && <> · Extrazeit: {formatDuration(summary.extraTime)}</>}
      </div>
    </>
  )
}

export function CategoryQuickActions({ category, timeZone }: { category: CategoryState; timeZone: string }) {
  const engine = useEngine()
  const { busy, run } = useAction()
  const today = getLocalDateInfo(Date.now(), timeZone).dayOfEpoch
  const blocked = category.base.tempBlocked && (category.base.tempBlockTime === 0 || category.base.tempBlockTime > Date.now())
  const id = category.base.categoryId

  return (
    <div className="quick">
      <button disabled={busy} onClick={() => run(() => engine.run(actions.incrementExtraTime(id, 15 * 60_000, today)), '+15 min Extrazeit für heute')}>
        +15 min
      </button>
      <button disabled={busy} onClick={() => run(() => engine.run(actions.incrementExtraTime(id, 30 * 60_000, today)), '+30 min Extrazeit für heute')}>
        +30 min
      </button>
      {blocked ? (
        <button className="primary" disabled={busy} onClick={() => run(() => engine.run(actions.setTemporarilyBlocked(id, false)), 'Sperre aufgehoben')}>
          Entsperren
        </button>
      ) : (
        <button className="danger" disabled={busy} onClick={() => run(() => engine.run(actions.setTemporarilyBlocked(id, true)), 'Gesperrt')}>
          Jetzt sperren
        </button>
      )}
    </div>
  )
}
