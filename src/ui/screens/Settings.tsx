import { useState } from 'react'
import { unlockPremium } from '../../api/admin'
import { ApiClient, describeError } from '../../api/client'
import { getUser, hasPremium } from '../../state/familyState'
import { formatTimestamp } from '../../logic/time'
import { useEngine, useSnapshot } from '../engine'
import { ConfirmButton, Modal, useAction } from '../components/common'

export function SettingsScreen() {
  const snapshot = useSnapshot()
  const engine = useEngine()
  const { busy, run } = useAction()
  const state = snapshot.confirmed
  const parent = snapshot.unlockedParentId ? getUser(state, snapshot.unlockedParentId) : undefined
  const [adminToken, setAdminToken] = useState('')
  const [duration, setDuration] = useState<'month' | 'year'>('year')
  const [debug, setDebug] = useState(false)

  const premium = hasPremium(state)

  return (
    <>
      <div className="card">
        <h3>Server</h3>
        <p className="mono">{snapshot.session?.serverUrl}</p>
        <p className="small muted">
          API-Level {state.apiLevel || '–'} · Live-Verbindung: {snapshot.liveConnected ? 'aktiv' : 'getrennt'} · letzter Abgleich: {state.lastSyncAt ? formatTimestamp(state.lastSyncAt) : '–'}
        </p>
        <button disabled={snapshot.syncing} onClick={() => engine.sync({ full: true })}>Vollständig neu laden</button>
      </div>

      <div className="card">
        <h3>Premium</h3>
        <p>
          Status:{' '}
          {state.fullVersion === 1 ? (
            <span className="pill ok">immer aktiv (ALWAYS_PRO)</span>
          ) : premium ? (
            <span className="pill ok">aktiv bis {formatTimestamp(state.fullVersion)}</span>
          ) : (
            <span className="pill bad">nicht aktiv</span>
          )}
        </p>
        {state.fullVersion !== 1 && (
          <>
            <p className="small muted">
              Am einfachsten: den Server mit <span className="mono">ALWAYS_PRO=yes</span> starten. Alternativ hier über die Admin-API freischalten (benötigt <span className="mono">ADMIN_TOKEN</span> und <span className="mono">SIGN_SECRET</span> auf dem Server).
            </p>
            <div className="field">
              <label htmlFor="admintoken">Admin-Token</label>
              <input id="admintoken" type="password" autoComplete="off" value={adminToken} onChange={(e) => setAdminToken(e.target.value)} />
            </div>
            <div className="row">
              <select aria-label="Dauer" value={duration} onChange={(e) => setDuration(e.target.value as 'month' | 'year')} style={{ width: 'auto' }}>
                <option value="month">1 Monat</option>
                <option value="year">1 Jahr</option>
              </select>
              <button
                className="primary"
                disabled={busy || !adminToken}
                onClick={() =>
                  run(async () => {
                    await unlockPremium(new ApiClient(snapshot.session!.serverUrl), {
                      adminToken,
                      duration,
                      mail: parent?.mail ?? '',
                      ...engine.parentCredentials(),
                    })
                    setAdminToken('')
                    await engine.sync()
                  }, 'Premium freigeschaltet')
                }
              >
                Premium freischalten
              </button>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h3>Sitzung</h3>
        <p className="small muted">Angemeldet als {parent?.name ?? '–'}{parent?.mail ? ` (${parent.mail})` : ''}.</p>
        <div className="row">
          <button onClick={() => engine.lock()}>Sperren</button>
          <ConfirmButton
            confirm="Abmelden löscht alle Daten dieser Web-App im Browser. Für eine erneute Anmeldung brauchst du einen Mail-Code; dabei entsteht ein neues Elterngerät. Das alte kannst du danach unter „Geräte“ entfernen."
            onConfirm={() => engine.signOut()}
          >
            Abmelden
          </ConfirmButton>
        </div>
      </div>

      <div className="card">
        <div className="row spread">
          <h3>Fehlersuche</h3>
          <button className="small" onClick={() => setDebug(true)}>Debug-Ansicht</button>
        </div>
        <p className="small muted">Warteschlange: {snapshot.queue.length} · Fehler: {snapshot.errors.length}</p>
      </div>

      <p className="small muted center">TimeLimit Web-App {__APP_VERSION__} · getestet mit timelimit-server API-Level 9</p>

      {debug && <DebugModal onClose={() => setDebug(false)} />}
    </>
  )
}

function DebugModal({ onClose }: { onClose: () => void }) {
  const snapshot = useSnapshot()
  const engine = useEngine()
  const [tab, setTab] = useState<'errors' | 'queue' | 'raw' | 'crypto'>('errors')

  return (
    <Modal title="Debug" onClose={onClose} actions={<button onClick={onClose}>Schließen</button>}>
      <div className="tabs">
        {(['errors', 'queue', 'raw', 'crypto'] as const).map((item) => (
          <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>
            {{ errors: 'Fehler', queue: 'Warteschlange', raw: 'pull-status', crypto: 'App-Listen' }[item]}
          </button>
        ))}
      </div>
      {tab === 'errors' && (
        <ul className="list small">
          {snapshot.errors.length === 0 && <li>Keine Fehler.</li>}
          {[...snapshot.errors].reverse().map((entry, index) => (
            <li key={index}>
              <span className="muted">{formatTimestamp(entry.at)}</span> {entry.message}
            </li>
          ))}
        </ul>
      )}
      {tab === 'queue' && (
        <>
          <p className="small muted">Nächste Sequenznummer: {snapshot.session?.nextSequenceNumber} · Geräte-ID: {snapshot.session?.ownDeviceId}</p>
          <ul className="list small">
            {snapshot.queue.length === 0 && <li>Leer.</li>}
            {snapshot.queue.map((item) => (
              <li key={item.sequenceNumber}>
                #{item.sequenceNumber} {item.type}: {item.description} {item.attempts > 0 && `(${item.attempts} Versuche)`}
              </li>
            ))}
          </ul>
          {snapshot.queue.length > 0 && (
            <ConfirmButton confirm="Alle nicht übertragenen Änderungen verwerfen?" onConfirm={() => engine.discardQueue()}>
              Warteschlange verwerfen
            </ConfirmButton>
          )}
        </>
      )}
      {tab === 'raw' && <pre className="raw">{JSON.stringify(snapshot.lastRawStatus, null, 2)}</pre>}
      {tab === 'crypto' && (
        <pre className="raw">
          {JSON.stringify(
            {
              publicKey: snapshot.crypto.signingPublicKey,
              pendingRequests: snapshot.crypto.pendingRequests.map(({ tempPrivateKey: _hidden, ...rest }) => rest),
              containers: Object.fromEntries(Object.entries(snapshot.crypto.containers).map(([k, v]) => [k, { status: v.status, generation: v.generation, version: v.serverVersion, hasKey: !!v.key }])),
              appLists: Object.fromEntries(Object.entries(snapshot.crypto.appLists).map(([k, v]) => [k, v.apps.length + ' Apps'])),
              log: snapshot.crypto.log,
            },
            null,
            2,
          )}
        </pre>
      )}
      <p className="small muted">Fehler beim Abgleich: {describeError(snapshot.lastError ?? 'keiner')}</p>
    </Modal>
  )
}
