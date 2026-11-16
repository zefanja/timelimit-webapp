// Phase 1 smoke test against a real timelimit-server (no UI).
//
//   npm run smoke -- --server http://localhost:8181 --mail me@example.com \
//       --password geheim [--log ./server.log] [--simulate-child]
//
// --log: path of the server log (NODE_ENV=development prints the mail with
//        the login code); otherwise the code is asked on the terminal.
// --simulate-child: registers a simulated child device, uploads an encrypted
//        app list and checks that the web app can decrypt it.

import { readFileSync, existsSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { actions } from '../src/actions/parentActions'
import { generateFamilyId } from '../src/crypto/bytes'
import { MINUTES_PER_WEEK, serializeBlockedTimes, setRange } from '../src/logic/blockedTimes'
import { getLocalDateInfo } from '../src/logic/time'
import { getCategoriesOfChild, getChildren, getParents, hasPremium } from '../src/state/familyState'
import { MemoryStore } from '../src/state/storage'
import { SyncEngine } from '../src/sync/engine'
import { SetupFlow } from '../src/sync/setup'
import { ChildSimulator } from './childSimulator'

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf('--' + name)
  if (index === -1) return fallback
  return process.argv[index + 1]
}

const flag = (name: string) => process.argv.includes('--' + name)

const serverUrl = arg('server', 'http://localhost:8181')!
const mail = arg('mail', 'smoke-' + Date.now() + '@example.com')!
const password = arg('password', 'smoke-password-123')!
const logFile = arg('log')
const simulateChild = flag('simulate-child')

let failures = 0
function check(condition: boolean, message: string) {
  console.log((condition ? '  ✔ ' : '  ✘ ') + message)
  if (!condition) failures++
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function readCode(previousLogLength: number): Promise<string> {
  if (logFile && existsSync(logFile)) {
    for (let i = 0; i < 50; i++) {
      const content = readFileSync(logFile, 'utf8').slice(previousLogLength)
      const match = /"code":\s*"([^"]+)"/.exec(content)
      if (match) return match[1]
      await sleep(200)
    }
    throw new Error('code not found in server log')
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const code = await rl.question('Code aus der Mail: ')
  rl.close()
  return code
}

async function main() {
  console.log(`Server: ${serverUrl}\nMail:   ${mail}`)

  const setup = new SetupFlow(serverUrl)
  const logLength = logFile && existsSync(logFile) ? readFileSync(logFile, 'utf8').length : 0

  console.log('1. Mail-Login')
  await setup.requestCode(mail)
  const status = await setup.enterCode(await readCode(logLength))
  check(true, `angemeldet, Status: ${status.status}, alwaysPro: ${status.alwaysPro}`)

  const engine = new SyncEngine(new MemoryStore())

  if (status.status === 'without family') {
    console.log('2. Familie anlegen')
    const { result, secondHash } = await setup.createFamily({
      parentName: 'Smoke-Elternteil',
      password,
      timeZone: 'Europe/Berlin',
      deviceName: 'Web-App (Smoke)',
    })
    engine.initializeSession({ serverUrl, ...result })
    const parent = getParents(engine.getSnapshot().confirmed)[0]
    check(!!parent, 'Elternteil in den Familiendaten')
    check(parent?.password.startsWith('$2a$10$') ?? false, 'Passwort-Hash hat Präfix $2a$10$ (jBCrypt-kompatibel)')
    engine.unlockWithSecondHash(parent.id, secondHash, false)
  } else {
    console.log('2. In bestehende Familie anmelden')
    const result = await setup.signIn({ deviceName: 'Web-App (Smoke)' })
    engine.initializeSession({ serverUrl, ...result })
  }

  const parents = getParents(engine.getSnapshot().confirmed)
  const parent = parents.find((p) => p.mail === mail) ?? parents[0]

  console.log('3. Elternpasswort prüfen')
  let wrongRejected = false
  try {
    await engine.unlock(parent.id, password + 'x', false)
  } catch {
    wrongRejected = true
  }
  check(wrongRejected, 'falsches Passwort wird lokal abgelehnt')
  await engine.unlock(parent.id, password, false)
  check(engine.isUnlocked, 'mit richtigem Passwort entsperrt')

  console.log('4. pull-status')
  await engine.sync()
  const premium = hasPremium(engine.getSnapshot().confirmed)
  check(engine.getSnapshot().lastError === null, 'kein Fehler beim Sync')
  console.log(`   Premium: ${premium}, apiLevel: ${engine.getSnapshot().confirmed.apiLevel}`)

  console.log('5. Kind + Kategorie + Regel anlegen')
  const childId = generateFamilyId()
  const categoryId = generateFamilyId()
  const ruleId = generateFamilyId()
  const today = getLocalDateInfo(Date.now(), 'Europe/Berlin')

  await engine.run([
    actions.addChild({ userId: childId, name: 'Smoke-Kind', timeZone: 'Europe/Berlin' }),
    actions.createCategory({ childId, categoryId, title: 'Spiele' }),
    actions.createRule({ ruleId, categoryId, time: 60 * 60_000, days: 127, extraTime: false }),
    actions.updateRule({ ruleId, time: 45 * 60_000, days: 31, extraTime: false }),
    actions.setBlockedTimes(categoryId, serializeBlockedTimes(setRange(new Uint8Array(MINUTES_PER_WEEK), 20 * 60, 24 * 60, true))),
    actions.renameCategory(categoryId, 'Spiele & Videos'),
  ])

  let snapshot = engine.getSnapshot()
  check(snapshot.lastError === null, 'Server hat keine Aktion abgelehnt' + (snapshot.lastError ? ': ' + snapshot.lastError : ''))
  check(snapshot.queue.length === 0, 'Warteschlange leer')
  const child = getChildren(snapshot.confirmed).find((c) => c.id === childId)
  check(!!child, 'Kind in pull-status')
  const category = getCategoriesOfChild(snapshot.confirmed, childId).find((c) => c.base.categoryId === categoryId)
  check(category?.base.title === 'Spiele & Videos', 'Kategorie in pull-status (umbenannt)')
  check(category?.rules[0]?.maxTime === 45 * 60_000 && category?.rules[0]?.dayMask === 31, 'Regel angelegt und geändert')
  check(category?.base.blockedTimes === '1200,1440', 'Sperrzeiten gesetzt (Mo 20–24 Uhr)')

  console.log('6. Premium-Aktionen (Extrazeit, Sperren)')
  await engine.run([actions.incrementExtraTime(categoryId, 15 * 60_000, today.dayOfEpoch), actions.setTemporarilyBlocked(categoryId, true)])
  snapshot = engine.getSnapshot()
  const after = snapshot.confirmed.categories[categoryId]
  if (premium) {
    check(snapshot.lastError === null, 'kein Fehler')
    check(after?.base.extraTime === 15 * 60_000, 'Extrazeit 15 min gesetzt')
    check(after?.base.tempBlocked === true, 'Kategorie gesperrt')
    await engine.run(actions.setTemporarilyBlocked(categoryId, false))
  } else {
    check(snapshot.lastError !== null, 'ohne Premium meldet die App die Ablehnung: ' + snapshot.lastError)
  }

  console.log('7. falsche Signatur wird erkannt')
  engine.unlockWithSecondHash(parent.id, '$2a$10$' + 'x'.repeat(53), false)
  await engine.run(actions.renameChild(childId, 'Darf nicht klappen'))
  check(engine.getSnapshot().lastError?.includes('abgelehnt') ?? false, 'Ablehnung gemeldet: ' + engine.getSnapshot().lastError)
  check(getChildren(engine.getSnapshot().confirmed).find((c) => c.id === childId)?.name === 'Smoke-Kind', 'Name unverändert')
  await engine.unlock(parent.id, password, false)

  if (simulateChild) {
    console.log('8. Kindgerät simulieren (Kopplung + verschlüsselte App-Liste)')
    const { token, deviceId } = await engine.createAddDeviceToken()
    check(token.split(' ').length >= 3, `Kopplungscode erzeugt: „${token}“`)
    const childDevice = await ChildSimulator.register(engine.client, token)
    check(childDevice.deviceId === deviceId, 'Kindgerät mit erwarteter Geräte-ID registriert')

    await engine.run(actions.setDeviceUser(childDevice.deviceId, childId))
    await childDevice.uploadKeyAndApps({
      apps: [
        { packageName: 'com.example.removed', title: 'Wird entfernt', isLaunchable: true, recommendation: 'none' },
        { packageName: 'com.example.game', title: 'Spiel', isLaunchable: true, recommendation: 'none' },
        { packageName: 'com.example.browser', title: 'Browser', isLaunchable: true, recommendation: 'blacklist' },
      ],
      activities: [],
    })

    // parent: sees containers + uploads own key; second round sends key requests
    await engine.sync()
    await engine.sync()
    check(engine.getSnapshot().crypto.pendingRequests.length === 2, 'Schlüssel angefragt (Basis + Diff)')

    const answered = await childDevice.answerKeyRequests()
    check(answered === 2, 'Kindgerät hat Schlüsselanfragen beantwortet')

    await engine.sync()
    const list = engine.getSnapshot().crypto.appLists[childDevice.deviceId]
    const names = list?.apps.map((app) => app.packageName).sort() ?? []
    check(
      JSON.stringify(names) === JSON.stringify(['com.example.browser', 'com.example.game', 'org.example.added']),
      'App-Liste entschlüsselt und Diff angewendet: ' + names.join(', '),
    )
    check(engine.getSnapshot().crypto.pendingRequests.length === 0, 'Schlüsselanfragen abgeschlossen')

    await engine.run(actions.addCategoryApps(categoryId, ['com.example.game']))
    const childStatus = await childDevice.pull()
    check(!!childStatus, 'Kindgerät synchronisiert')
    check(childDevice.state.categories[categoryId]?.apps.includes('com.example.game') ?? false, 'App-Zuordnung kommt beim Kindgerät an')
    if (premium) {
      await engine.run(actions.incrementExtraTime(categoryId, 30 * 60_000, today.dayOfEpoch))
      await childDevice.pull()
      check(childDevice.state.categories[categoryId]?.base.extraTime === 45 * 60_000, 'Extrazeit kommt beim Kindgerät an')
    }

    await engine.removeDevice(childDevice.deviceId)
    check(!engine.getSnapshot().confirmed.devices.some((d) => d.deviceId === childDevice.deviceId), 'Gerät entfernt')
  }

  console.log('9. Aufräumen')
  await engine.run([actions.deleteCategory(categoryId), actions.removeUser(childId)])
  check(!getChildren(engine.getSnapshot().confirmed).some((c) => c.id === childId), 'Kind gelöscht')

  console.log(failures === 0 ? '\nOK – alle Prüfungen bestanden' : `\n${failures} Prüfung(en) fehlgeschlagen`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((ex) => {
  console.error('FEHLER:', ex)
  process.exit(1)
})
