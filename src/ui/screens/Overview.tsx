import { useEffect, useState } from 'react'
import { actions } from '../../actions/parentActions'
import { generateFamilyId } from '../../crypto/bytes'
import { getCategoriesOfChild, getChildren, getDevicesOfUser, hasPremium } from '../../state/familyState'
import { browserTimeZone } from '../../logic/time'
import { useEngine, useSnapshot } from '../engine'
import { CategoryQuickActions, CategoryStatusLine } from '../components/CategoryQuick'
import { Icon, Modal, useAction } from '../components/common'

export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

export function OverviewScreen({ openChild }: { openChild: (childId: string) => void }) {
  const snapshot = useSnapshot()
  const state = snapshot.display
  const children = getChildren(state)
  const now = useNow()
  const [adding, setAdding] = useState(false)

  return (
    <>
      {!hasPremium(state, now) && state.lastSyncAt && (
        <div className="banner warn">
          Premium ist nicht aktiv – Extrazeit, Sperren und manche Regeln werden vom Server abgelehnt. Freischalten unter Einstellungen → Admin.
        </div>
      )}
      {state.message && <div className="banner info">{state.message}</div>}

      {children.length === 0 && (
        <div className="card center">
          <p>Noch kein Kind angelegt.</p>
          <button className="primary" onClick={() => setAdding(true)}>Kind hinzufügen</button>
        </div>
      )}

      {children.map((child) => {
        const categories = getCategoriesOfChild(state, child.id)
        const devices = getDevicesOfUser(state, child.id)
        return (
          <div className="card" key={child.id}>
            <div className="card-header">
              <h2>{child.name}</h2>
              <button className="icon" aria-label={`${child.name} verwalten`} onClick={() => openChild(child.id)}>
                <Icon name="chevron" />
              </button>
            </div>
            <div className="small muted" style={{ marginBottom: 8 }}>
              {devices.length === 0 ? 'Kein Gerät zugewiesen' : devices.map((d) => d.name).join(', ')}
              {child.disableLimitsUntil > now && <span className="pill warn" style={{ marginLeft: 6 }}>alle Limits pausiert</span>}
            </div>
            {categories.length === 0 && <p className="muted small">Keine Kategorien.</p>}
            {categories.map((category) => (
              <div className="cat" key={category.base.categoryId}>
                <CategoryStatusLine state={state} category={category} timeZone={child.timeZone} now={now} />
                <CategoryQuickActions category={category} timeZone={child.timeZone} />
              </div>
            ))}
          </div>
        )
      })}

      {children.length > 0 && (
        <button className="block" onClick={() => setAdding(true)}>
          <Icon name="plus" /> Kind hinzufügen
        </button>
      )}

      {adding && <AddChildModal onClose={() => setAdding(false)} />}
    </>
  )
}

function AddChildModal({ onClose }: { onClose: () => void }) {
  const engine = useEngine()
  const { busy, run } = useAction()
  const [name, setName] = useState('')
  const [defaults, setDefaults] = useState(true)

  const submit = () =>
    run(async () => {
      if (!name.trim()) throw new Error('Bitte einen Namen eingeben.')
      const childId = generateFamilyId()
      const list = [actions.addChild({ userId: childId, name: name.trim(), timeZone: browserTimeZone() })]

      if (defaults) {
        const allowed = generateFamilyId()
        const games = generateFamilyId()
        list.push(
          actions.createCategory({ childId, categoryId: allowed, title: 'Erlaubte Apps' }),
          actions.createCategory({ childId, categoryId: games, title: 'Spiele' }),
          actions.createRule({ ruleId: generateFamilyId(), categoryId: games, time: 30 * 60_000, days: 31, extraTime: false, perDay: true }),
          actions.createRule({ ruleId: generateFamilyId(), categoryId: games, time: 2 * 60 * 60_000, days: 96, extraTime: false, perDay: true }),
        )
      }

      await engine.run(list)
      onClose()
    }, 'Kind angelegt')

  return (
    <Modal
      title="Kind hinzufügen"
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Abbrechen</button>
          <button className="primary" disabled={busy} onClick={submit}>Anlegen</button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="childname">Name</label>
        <input id="childname" type="text" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <label className="check">
        <input type="checkbox" checked={defaults} onChange={(e) => setDefaults(e.target.checked)} />
        Kategorien „Erlaubte Apps“ und „Spiele“ (30 min Mo–Fr, 2 h am Wochenende) anlegen
      </label>
    </Modal>
  )
}
