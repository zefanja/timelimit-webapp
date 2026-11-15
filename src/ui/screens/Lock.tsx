import { FormEvent, useState } from 'react'
import { describeError } from '../../api/client'
import { getParents } from '../../state/familyState'
import { useEngine, useSnapshot } from '../engine'
import { Spinner } from '../components/common'

export function LockScreen() {
  const engine = useEngine()
  const snapshot = useSnapshot()
  const parents = getParents(snapshot.confirmed)
  const [parentId, setParentId] = useState<string>('')
  const [password, setPassword] = useState('')
  const [keep, setKeep] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const selected = parentId || parents.find((p) => p.mail)?.id || parents[0]?.id || ''

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await engine.unlock(selected, password, keep)
      setPassword('')
      void engine.sync()
    } catch (ex) {
      setError(describeError(ex))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="setup">
      <img className="logo" src={import.meta.env.BASE_URL + "icon.svg"} alt="" />
      <h1 className="center">Elternbereich</h1>
      {error && <div className="banner error" role="alert">{error}</div>}

      {parents.length === 0 ? (
        <div className="card center">
          <p>Familiendaten werden geladen …</p>
          {snapshot.lastError && <div className="banner error">{snapshot.lastError}</div>}
          <button onClick={() => void engine.sync({ full: true })} disabled={snapshot.syncing}>
            {snapshot.syncing ? <Spinner /> : 'Erneut versuchen'}
          </button>
        </div>
      ) : (
        <form className="card" onSubmit={submit}>
          {parents.length > 1 && (
            <div className="field">
              <label htmlFor="parent">Elternteil</label>
              <select id="parent" value={selected} onChange={(e) => setParentId(e.target.value)}>
                {parents.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="pw">Elternpasswort{parents.length === 1 ? ` von ${parents[0].name}` : ''}</label>
            <input id="pw" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <label className="check">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            Entsperrt bleiben, bis der Tab geschlossen wird
          </label>
          <button className="primary block" disabled={busy}>{busy ? <Spinner /> : 'Entsperren'}</button>
        </form>
      )}
    </div>
  )
}
