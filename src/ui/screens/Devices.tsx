import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { actions } from '../../actions/parentActions'
import { ServerDeviceData } from '../../api/types'
import { getChildren, getParents, getUser } from '../../state/familyState'
import { formatTimestamp } from '../../logic/time'
import { useEngine, useSnapshot } from '../engine'
import { ConfirmButton, Icon, Modal, Spinner, useAction } from '../components/common'

const protectionNames: Record<string, string> = {
  none: 'kein Schutz',
  'simple device admin': 'Geräteadministrator',
  'password device admin': 'Geräteadministrator (Passwort)',
  'device owner': 'Geräteeigentümer',
}

export function describeManipulation(device: ServerDeviceData): Array<string> {
  const warnings: Array<string> = []
  if (device.cProtectionLevel !== device.hProtectionLevel) warnings.push(`Schutzstufe gesenkt (${protectionNames[device.cProtectionLevel] ?? device.cProtectionLevel})`)
  if (device.cUsageStats !== device.hUsageStats && device.cUsageStats === 'not granted') warnings.push('Nutzungsdatenzugriff entzogen')
  if (device.cNotificationAccess !== device.hNotificationAccess && device.cNotificationAccess === 'not granted') warnings.push('Benachrichtigungszugriff entzogen')
  if (device.cOverlay !== device.hOverlay && device.cOverlay === 'not granted') warnings.push('Überlagerungsrecht entzogen')
  if (device.wasAsEnabled && !device.asEnabled) warnings.push('Bedienungshilfe deaktiviert')
  if (device.cAppVersion < device.hAppVersion) warnings.push('App-Version herabgestuft')
  if (device.tDisablingAdmin) warnings.push('Versuch, den Geräteadministrator zu deaktivieren')
  if (device.reboot && device.rebootIsManipulation) warnings.push('Neustart')
  if (device.hadManipulation) warnings.push('frühere Manipulation erkannt')
  if (device.mFlags !== 0 || device.hadManipulationFlags !== 0) warnings.push('weitere Manipulationshinweise')
  return warnings
}

export function DevicesScreen() {
  const snapshot = useSnapshot()
  const state = snapshot.display
  const [adding, setAdding] = useState(false)
  const own = snapshot.session?.ownDeviceId

  return (
    <>
      <button className="primary block" style={{ marginBottom: 12 }} onClick={() => setAdding(true)}>
        <Icon name="plus" /> Kindgerät hinzufügen
      </button>

      {state.devices.map((device) => (
        <DeviceCard key={device.deviceId} device={device} isOwn={device.deviceId === own} connected={snapshot.connectedDeviceIds.includes(device.deviceId)} />
      ))}

      {adding && <AddDeviceModal onClose={() => setAdding(false)} />}
    </>
  )
}

function DeviceCard({ device, isOwn, connected }: { device: ServerDeviceData; isOwn: boolean; connected: boolean }) {
  const snapshot = useSnapshot()
  const engine = useEngine()
  const { busy, run } = useAction()
  const state = snapshot.display
  const user = getUser(state, device.currentUserId)
  const warnings = describeManipulation(device)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(device.name)
  const isParentDevice = device.model === 'Web-App' || getParents(state).some((p) => p.id === device.currentUserId)

  return (
    <div className="card">
      <div className="card-header">
        <h3>{device.name}{isOwn && <span className="pill" style={{ marginLeft: 6 }}>dieses Gerät</span>}</h3>
        {!isOwn && (
          <span className="small muted row" title={connected ? 'verbunden' : 'nicht verbunden'}>
            <span className={'dot' + (connected ? ' on' : '')} /> {connected ? 'online' : ''}
          </span>
        )}
      </div>
      <div className="small muted">
        {device.model} · hinzugefügt {formatTimestamp(device.addedAt)}
        {device.cAppVersion > 0 && <> · App-Version {device.cAppVersion}</>}
      </div>

      {warnings.length > 0 && !isOwn && (
        <div className="banner warn" style={{ marginTop: 8 }}>
          <strong>Manipulationswarnung:</strong> {warnings.join(', ')}
          <div style={{ marginTop: 6 }}>
            <button className="small" disabled={busy} onClick={() => run(() => engine.run(actions.ignoreAllManipulation(device.deviceId)), 'Warnung ignoriert')}>
              Ignorieren
            </button>
          </div>
        </div>
      )}

      {!isOwn && !isParentDevice && (
        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor={'u' + device.deviceId}>Benutzer</label>
          <select
            id={'u' + device.deviceId}
            value={device.currentUserId}
            disabled={busy}
            onChange={(e) => run(() => engine.run(actions.setDeviceUser(device.deviceId, e.target.value)), 'Benutzer geändert')}
          >
            <option value="">– niemand (Gerät nicht eingeschränkt) –</option>
            {getChildren(state).map((child) => (
              <option key={child.id} value={child.id}>{child.name}</option>
            ))}
            {user && user.type === 'parent' && <option value={user.id}>{user.name} (Elternteil)</option>}
          </select>
        </div>
      )}

      <div className="row" style={{ marginTop: 8 }}>
        <button className="small" onClick={() => setRenaming(true)}><Icon name="edit" /> Umbenennen</button>
        {!isOwn && (
          <ConfirmButton
            className="danger small"
            confirm={`„${device.name}“ aus der Familie entfernen? Auf dem Gerät muss TimeLimit danach neu eingerichtet werden.`}
            onConfirm={() => run(() => engine.removeDevice(device.deviceId), 'Gerät entfernt')}
          >
            <Icon name="trash" /> Entfernen
          </ConfirmButton>
        )}
      </div>

      {renaming && (
        <Modal
          title="Gerät umbenennen"
          onClose={() => setRenaming(false)}
          actions={
            <>
              <button onClick={() => setRenaming(false)}>Abbrechen</button>
              <button className="primary" disabled={!name.trim()} onClick={() => run(async () => { await engine.run(actions.renameDevice(device.deviceId, name.trim())); setRenaming(false) })}>
                Speichern
              </button>
            </>
          }
        >
          <input type="text" aria-label="Gerätename" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Modal>
      )}
    </div>
  )
}

function AddDeviceModal({ onClose }: { onClose: () => void }) {
  const engine = useEngine()
  const snapshot = useSnapshot()
  const [token, setToken] = useState<{ token: string; deviceId: string } | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    engine
      .createAddDeviceToken()
      .then(async (result) => {
        if (cancelled) return
        setToken(result)
        setQr(await QRCode.toDataURL(result.token, { margin: 1, width: 440 }))
      })
      .catch((ex) => !cancelled && setError(ex instanceof Error ? ex.message : String(ex)))
    return () => {
      cancelled = true
    }
  }, [engine])

  const added = token && snapshot.confirmed.devices.some((device) => device.deviceId === token.deviceId)

  return (
    <Modal title="Kindgerät hinzufügen" onClose={onClose} actions={<button onClick={onClose}>{added ? 'Fertig' : 'Schließen'}</button>}>
      {error && <div className="banner error">{error}</div>}
      {!token && !error && <p className="center"><Spinner /></p>}
      {token && !added && (
        <>
          <ol className="small">
            <li>TimeLimit (F-Droid) auf dem Kind-Handy installieren und öffnen.</li>
            <li>„Vernetzter Modus“ → „Als Kindgerät hinzufügen“ wählen.</li>
            <li>Server-Adresse <span className="mono">{snapshot.session?.serverUrl}</span> einstellen.</li>
            <li>Diesen Code eingeben oder den QR-Code scannen:</li>
          </ol>
          <div className="token" aria-label="Kopplungscode">{token.token}</div>
          {qr && <img className="qr" src={qr} alt="QR-Code mit dem Kopplungscode" />}
          <p className="small muted center">Der Code ist nur kurze Zeit gültig. Dieses Fenster aktualisiert sich automatisch, sobald das Gerät verbunden ist.</p>
        </>
      )}
      {added && <div className="banner info">Das Gerät wurde hinzugefügt. Weise es jetzt unter „Benutzer“ einem Kind zu.</div>}
    </Modal>
  )
}
