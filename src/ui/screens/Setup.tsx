import { FormEvent, useEffect, useState } from 'react'
import { describeError, normalizeServerUrl, ApiError } from '../../api/client'
import { StatusByMailAddress } from '../../api/parent'
import { getParents } from '../../state/familyState'
import { browserTimeZone } from '../../logic/time'
import { defaultDeviceName, SetupFlow } from '../../sync/setup'
import { createLocalStore } from '../../state/storage'
import { useEngine } from '../engine'
import { Spinner } from '../components/common'

type Step = 'server' | 'mail' | 'code' | 'create' | 'signin'

const store = createLocalStore()

export function SetupScreen() {
  const engine = useEngine()
  const [step, setStep] = useState<Step>('server')
  const [serverUrl, setServerUrl] = useState(() => store.get('lastServerUrl') ?? '')
  const [flow, setFlow] = useState<SetupFlow | null>(null)
  const [mail, setMail] = useState('')
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<StatusByMailAddress | null>(null)
  const [parentName, setParentName] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [deviceName, setDeviceName] = useState(defaultDeviceName())
  const [timeZone, setTimeZone] = useState(browserTimeZone())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // when the app is served by the bundled nginx (same origin as the API),
  // the server address is simply the current origin
  useEffect(() => {
    if (serverUrl) return
    const origin = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '')
    fetch(origin + '/time')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data && typeof data.ms === 'number') setServerUrl((current) => current || origin)
      })
      .catch(() => undefined)
  }, [serverUrl])

  async function guarded(fn: () => Promise<void>) {
    setError(null)
    setBusy(true)
    try {
      await fn()
    } catch (ex) {
      setError(describeError(ex))
    } finally {
      setBusy(false)
    }
  }

  const submitServer = (event: FormEvent) => {
    event.preventDefault()
    void guarded(async () => {
      const url = normalizeServerUrl(serverUrl)
      // reachability check: the server answers on /time
      const response = await fetch(url + '/time').catch(() => null)
      if (!response || !response.ok) {
        throw new Error(
          `Unter ${url} antwortet kein TimeLimit-Server. Hinweis: Der Server erlaubt keine Zugriffe von fremden Webseiten (CORS) – ` +
            'die Web-App muss unter derselben Adresse wie der Server laufen (siehe README, nginx-Proxy).',
        )
      }
      store.set('lastServerUrl', url)
      setServerUrl(url)
      setFlow(new SetupFlow(url))
      setStep('mail')
    })
  }

  const submitMail = (event: FormEvent) => {
    event.preventDefault()
    void guarded(async () => {
      await flow!.requestCode(mail)
      setStep('code')
    })
  }

  const submitCode = (event: FormEvent) => {
    event.preventDefault()
    void guarded(async () => {
      try {
        const result = await flow!.enterCode(code)
        setStatus(result)
        setStep(result.status === 'with family' ? 'signin' : 'create')
      } catch (ex) {
        if (ex instanceof ApiError && ex.kind === 'forbidden') throw new Error('Der Code ist falsch. Bitte erneut versuchen.')
        if (ex instanceof ApiError && ex.kind === 'gone') {
          setStep('mail')
          setCode('')
          throw new Error('Der Code ist abgelaufen oder wurde zu oft falsch eingegeben. Bitte einen neuen Code anfordern.')
        }
        throw ex
      }
    })
  }

  const submitCreate = (event: FormEvent) => {
    event.preventDefault()
    void guarded(async () => {
      if (password.length < 4) throw new Error('Das Passwort ist zu kurz.')
      if (password !== password2) throw new Error('Die Passwörter stimmen nicht überein.')
      const { result, secondHash } = await flow!.createFamily({ parentName: parentName.trim() || 'Elternteil', password, timeZone, deviceName })
      engine.initializeSession({ serverUrl, ...result })
      const parent = getParents(engine.getSnapshot().confirmed)[0]
      if (parent) engine.unlockWithSecondHash(parent.id, secondHash, true)
      void engine.sync()
    })
  }

  const submitSignIn = (event: FormEvent) => {
    event.preventDefault()
    void guarded(async () => {
      const result = await flow!.signIn({ deviceName })
      engine.initializeSession({ serverUrl, ...result })
      void engine.sync()
    })
  }

  return (
    <div className="setup">
      <img className="logo" src={import.meta.env.BASE_URL + "icon.svg"} alt="" />
      <h1 className="center">TimeLimit Eltern</h1>
      <p className="center muted">Verwaltung für deinen eigenen TimeLimit-Server</p>

      {error && <div className="banner error" role="alert">{error}</div>}

      {step === 'server' && (
        <form className="card" onSubmit={submitServer}>
          <div className="field">
            <label htmlFor="server">Server-Adresse</label>
            <input id="server" type="url" inputMode="url" autoComplete="url" placeholder="https://timelimit.example.org" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} required />
          </div>
          <p className="small muted">Die Adresse deines selbst gehosteten timelimit-servers – normalerweise die Adresse dieser Web-App selbst. Sie wird nur in diesem Browser gespeichert.</p>
          <button className="primary block" disabled={busy}>{busy ? <Spinner /> : 'Weiter'}</button>
        </form>
      )}

      {step === 'mail' && (
        <form className="card" onSubmit={submitMail}>
          <p className="small muted">Server: {serverUrl}</p>
          <div className="field">
            <label htmlFor="mail">Deine Mail-Adresse</label>
            <input id="mail" type="email" autoComplete="email" value={mail} onChange={(e) => setMail(e.target.value)} required />
          </div>
          <button className="primary block" disabled={busy}>{busy ? <Spinner /> : 'Anmeldecode senden'}</button>
          <button type="button" className="ghost block" onClick={() => setStep('server')}>Anderer Server</button>
        </form>
      )}

      {step === 'code' && (
        <form className="card" onSubmit={submitCode}>
          <p>Wir haben einen Code an <strong>{mail}</strong> geschickt. Er besteht aus mehreren Wörtern.</p>
          <div className="field">
            <label htmlFor="code">Code aus der Mail</label>
            <input id="code" type="text" autoComplete="one-time-code" autoCapitalize="off" value={code} onChange={(e) => setCode(e.target.value)} required />
          </div>
          <button className="primary block" disabled={busy}>{busy ? <Spinner /> : 'Anmelden'}</button>
          <button type="button" className="ghost block" onClick={() => setStep('mail')}>Neuen Code anfordern</button>
        </form>
      )}

      {step === 'create' && status && (
        <form className="card" onSubmit={submitCreate}>
          <h2>Neue Familie anlegen</h2>
          {!status.canCreateFamily && <div className="banner error">Auf diesem Server ist das Anlegen neuer Familien deaktiviert (DISABLE_SIGNUP).</div>}
          {!status.alwaysPro && (
            <div className="banner warn">Der Server läuft ohne ALWAYS_PRO. Einige Funktionen (z. B. Extrazeit, Sperren) sind nach der Testphase nur mit Premium möglich – freischalten unter Einstellungen → Admin.</div>
          )}
          <div className="field">
            <label htmlFor="pname">Dein Name</label>
            <input id="pname" type="text" value={parentName} onChange={(e) => setParentName(e.target.value)} placeholder="z. B. Mama" required />
          </div>
          <div className="field">
            <label htmlFor="pw">Elternpasswort</label>
            <input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="pw2">Passwort wiederholen</label>
            <input id="pw2" type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} required />
          </div>
          <p className="small muted">Mit diesem Passwort meldest du dich auch auf den Kind-Handys als Elternteil an. Es wird nie im Klartext gespeichert oder übertragen.</p>
          <div className="field">
            <label htmlFor="tz">Zeitzone</label>
            <input id="tz" type="text" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="dname">Name dieses Geräts</label>
            <input id="dname" type="text" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
          </div>
          <button className="primary block" disabled={busy || !status.canCreateFamily}>{busy ? <Spinner /> : 'Familie anlegen'}</button>
        </form>
      )}

      {step === 'signin' && (
        <form className="card" onSubmit={submitSignIn}>
          <h2>Bei deiner Familie anmelden</h2>
          <p>Zu dieser Mail-Adresse gibt es bereits eine Familie. Diese Web-App wird als zusätzliches Elterngerät hinzugefügt.</p>
          <div className="field">
            <label htmlFor="dname2">Name dieses Geräts</label>
            <input id="dname2" type="text" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
          </div>
          <button className="primary block" disabled={busy}>{busy ? <Spinner /> : 'Anmelden'}</button>
        </form>
      )}
    </div>
  )
}
