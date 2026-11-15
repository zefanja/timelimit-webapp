import { useEffect, useState } from 'react'
import { getUser } from '../state/familyState'
import { useEngine, useSnapshot } from './engine'
import { Icon, Spinner, ToastProvider } from './components/common'
import { ChildDetailScreen } from './screens/ChildDetail'
import { DevicesScreen } from './screens/Devices'
import { LockScreen } from './screens/Lock'
import { OverviewScreen } from './screens/Overview'
import { SettingsScreen } from './screens/Settings'
import { SetupScreen } from './screens/Setup'

type Route = { name: 'overview' } | { name: 'child'; childId: string } | { name: 'devices' } | { name: 'settings' }

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '')
  const [name, id] = hash.split('/')
  if (name === 'kind' && id) return { name: 'child', childId: id }
  if (name === 'geraete') return { name: 'devices' }
  if (name === 'einstellungen') return { name: 'settings' }
  return { name: 'overview' }
}

function routeToHash(route: Route) {
  switch (route.name) {
    case 'child': return '#/kind/' + route.childId
    case 'devices': return '#/geraete'
    case 'settings': return '#/einstellungen'
    default: return '#/'
  }
}

function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(parseHash)
  useEffect(() => {
    const onChange = () => setRoute(parseHash())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return [route, (next) => { window.location.hash = routeToHash(next) }]
}

export function App() {
  return (
    <ToastProvider>
      <Root />
    </ToastProvider>
  )
}

function Root() {
  const engine = useEngine()
  const snapshot = useSnapshot()
  const configured = snapshot.session !== null

  // background sync + live updates while configured
  useEffect(() => {
    if (!configured) return
    engine.startLive()
    void engine.sync()

    const onVisible = () => document.visibilityState === 'visible' && void engine.sync()
    const onOnline = () => void engine.sync()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    // fallback polling when the websocket is not available
    const timer = setInterval(() => document.visibilityState === 'visible' && void engine.sync(), 60_000)

    return () => {
      engine.stopLive()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      clearInterval(timer)
    }
  }, [engine, configured, snapshot.session?.deviceAuthToken])

  if (!configured) return <SetupScreen />

  if (snapshot.deviceRemoved) {
    return (
      <div className="setup">
        <div className="card">
          <h2>Gerät entfernt</h2>
          <p>Diese Web-App wurde aus der Familie entfernt. Melde dich neu an, um sie wieder zu verwenden.</p>
          <button className="primary" onClick={() => engine.signOut()}>Neu einrichten</button>
        </div>
      </div>
    )
  }

  if (snapshot.unlockedParentId === null) return <LockScreen />

  return <Shell />
}

function Shell() {
  const snapshot = useSnapshot()
  const engine = useEngine()
  const [route, navigate] = useRoute()

  let title = 'Übersicht'
  if (route.name === 'child') title = getUser(snapshot.display, route.childId)?.name ?? 'Kind'
  if (route.name === 'devices') title = 'Geräte'
  if (route.name === 'settings') title = 'Einstellungen'

  const pending = snapshot.queue.filter((item) => item.type === 'parent').length

  return (
    <div className="app">
      <header className="topbar">
        {route.name === 'child' && (
          <button className="icon" aria-label="Zurück" onClick={() => navigate({ name: 'overview' })}>
            <Icon name="back" />
          </button>
        )}
        <h1>{title}</h1>
        {pending > 0 && <span className="pill warn" title="Änderungen werden übertragen">{pending} ausstehend</span>}
        <button className="icon" aria-label="Synchronisieren" onClick={() => void engine.sync()} disabled={snapshot.syncing}>
          {snapshot.syncing ? <Spinner /> : <Icon name="sync" />}
        </button>
        <button className="icon" aria-label="Sperren" onClick={() => engine.lock()}>
          <Icon name="lock" />
        </button>
      </header>

      {snapshot.lastError && (
        <div className="banner error" role="alert">
          {snapshot.lastError}
        </div>
      )}

      {route.name === 'overview' && <OverviewScreen openChild={(childId) => navigate({ name: 'child', childId })} />}
      {route.name === 'child' && <ChildDetailScreen childId={route.childId} onBack={() => navigate({ name: 'overview' })} />}
      {route.name === 'devices' && <DevicesScreen />}
      {route.name === 'settings' && <SettingsScreen />}

      <nav className="bottomnav" aria-label="Hauptnavigation">
        <div className="bottomnav-inner">
          <button className={route.name === 'overview' || route.name === 'child' ? 'active' : ''} onClick={() => navigate({ name: 'overview' })}>
            <Icon name="home" /> Übersicht
          </button>
          <button className={route.name === 'devices' ? 'active' : ''} onClick={() => navigate({ name: 'devices' })}>
            <Icon name="devices" /> Geräte
          </button>
          <button className={route.name === 'settings' ? 'active' : ''} onClick={() => navigate({ name: 'settings' })}>
            <Icon name="settings" /> Einstellungen
          </button>
        </div>
      </nav>
    </div>
  )
}
