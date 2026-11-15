// The sync engine: owns the persisted session, the action queue, the family
// state and the app list crypto state. Works in the browser and in Node
// (scripts/smoke.ts), the UI subscribes to snapshots.

import { AppLogicAction, describeAction, ParentAction } from '../actions/parentActions'
import { ApiClient, ApiError, describeError } from '../api/client'
import { createAddDeviceToken, removeDevice } from '../api/parent'
import { isDeviceRemoved, MAX_ACTIONS_PER_REQUEST, pullStatus, pushActions } from '../api/sync'
import { ClientPushAction, ServerDataStatus } from '../api/types'
import { connectLive, LiveConnection } from '../api/websocket'
import { calculateParentActionIntegrity } from '../crypto/integrity'
import { deriveSecondHash, verifyPassword } from '../crypto/password'
import { applyParentActionLocally } from '../logic/optimistic'
import {
  applyServerDataStatus,
  buildClientDataStatus,
  emptyFamilyState,
  FamilyState,
  getUser,
} from '../state/familyState'
import { KeyValueStore, readJson, writeJson } from '../state/storage'
import { CryptoState, devicesDetailStatus, emptyCryptoState, processAfterPull, resetDeviceKeys } from './appListCrypto'

export interface SessionData {
  serverUrl: string
  deviceAuthToken: string
  ownDeviceId: string
  /** strictly increasing, never reset */
  nextSequenceNumber: number
  createdAt: number
}

export interface QueuedAction {
  sequenceNumber: number
  type: 'parent' | 'appLogic'
  userId: string
  encodedAction: string
  integrity: string
  description: string
  createdAt: number
  /** set after a push attempt failed with a network error */
  attempts: number
}

export interface SyncErrorEntry {
  at: number
  message: string
}

export interface EngineSnapshot {
  session: SessionData | null
  confirmed: FamilyState
  /** confirmed state + pending actions */
  display: FamilyState
  queue: Array<QueuedAction>
  syncing: boolean
  liveConnected: boolean
  connectedDeviceIds: Array<string>
  lastError: string | null
  errors: Array<SyncErrorEntry>
  unlockedParentId: string | null
  crypto: CryptoState
  lastRawStatus: ServerDataStatus | null
  deviceRemoved: boolean
}

const KEYS = {
  session: 'session',
  queue: 'queue',
  family: 'family',
  crypto: 'crypto',
  unlocked: 'unlocked',
}

export class SignatureRejectedError extends Error {}

export class SyncEngine {
  private session: SessionData | null
  private queue: Array<QueuedAction>
  private confirmed: FamilyState
  private crypto: CryptoState
  private secondHash: string | null = null
  private unlockedParentId: string | null = null
  private listeners = new Set<(snapshot: EngineSnapshot) => void>()
  private syncChain: Promise<void> = Promise.resolve()
  private syncing = false
  private syncRequested = false
  private forceFullSync = false
  private live: LiveConnection | null = null
  private liveConnected = false
  private connectedDeviceIds: Array<string> = []
  private lastError: string | null = null
  private errors: Array<SyncErrorEntry> = []
  private lastRawStatus: ServerDataStatus | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryDelay = 5_000
  private deviceRemoved = false
  private snapshotCache: EngineSnapshot | null = null

  constructor(
    private readonly store: KeyValueStore,
    private readonly sessionStore: KeyValueStore | null = null,
  ) {
    this.session = readJson<SessionData | null>(store, KEYS.session, null)
    this.queue = readJson<Array<QueuedAction>>(store, KEYS.queue, [])
    this.confirmed = readJson<FamilyState>(store, KEYS.family, emptyFamilyState())
    this.crypto = { ...emptyCryptoState(), ...readJson<Partial<CryptoState>>(store, KEYS.crypto, {}) }

    const unlocked = sessionStore ? readJson<{ parentId: string; secondHash: string } | null>(sessionStore, KEYS.unlocked, null) : null
    if (unlocked && this.session) {
      this.unlockedParentId = unlocked.parentId
      this.secondHash = unlocked.secondHash
    }
  }

  // ---------- state access ----------

  subscribe(listener: (snapshot: EngineSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot(): EngineSnapshot {
    if (this.snapshotCache) return this.snapshotCache

    let display = this.confirmed
    for (const item of this.queue) {
      if (item.type !== 'parent') continue
      try {
        display = applyParentActionLocally(display, JSON.parse(item.encodedAction) as ParentAction)
      } catch {
        // ignore broken entries
      }
    }

    this.snapshotCache = {
      session: this.session,
      confirmed: this.confirmed,
      display,
      queue: this.queue,
      syncing: this.syncing,
      liveConnected: this.liveConnected,
      connectedDeviceIds: this.connectedDeviceIds,
      lastError: this.lastError,
      errors: this.errors,
      unlockedParentId: this.unlockedParentId,
      crypto: this.crypto,
      lastRawStatus: this.lastRawStatus,
      deviceRemoved: this.deviceRemoved,
    }

    return this.snapshotCache
  }

  private emit() {
    this.snapshotCache = null
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) listener(snapshot)
  }

  get isConfigured() {
    return this.session !== null
  }

  get client(): ApiClient {
    if (!this.session) throw new Error('Nicht eingerichtet')
    return new ApiClient(this.session.serverUrl)
  }

  // ---------- session ----------

  /** called after create-family or sign-in-into-family */
  initializeSession(params: { serverUrl: string; deviceAuthToken: string; ownDeviceId: string; data: ServerDataStatus }) {
    this.stopLive()
    this.session = {
      serverUrl: params.serverUrl,
      deviceAuthToken: params.deviceAuthToken,
      ownDeviceId: params.ownDeviceId,
      nextSequenceNumber: 1,
      createdAt: Date.now(),
    }
    this.queue = []
    this.crypto = emptyCryptoState()
    this.confirmed = applyServerDataStatus(emptyFamilyState(), params.data)
    this.lastRawStatus = params.data
    this.deviceRemoved = false
    this.lock()
    this.persistAll()
    this.emit()
  }

  /** forgets everything (the device stays registered on the server until it is removed there) */
  signOut() {
    this.stopLive()
    this.lock()
    this.session = null
    this.queue = []
    this.confirmed = emptyFamilyState()
    this.crypto = emptyCryptoState()
    this.lastRawStatus = null
    this.errors = []
    this.lastError = null
    for (const key of Object.values(KEYS)) this.store.remove(key)
    this.emit()
  }

  private persistAll() {
    writeJson(this.store, KEYS.session, this.session)
    writeJson(this.store, KEYS.queue, this.queue)
    writeJson(this.store, KEYS.family, this.confirmed)
    writeJson(this.store, KEYS.crypto, this.crypto)
  }

  // ---------- parent unlock ----------

  /**
   * Checks the password against the bcrypt hash from pull-status and derives
   * the secondHash (signing key). Throws when the password is wrong.
   */
  async unlock(parentId: string, password: string, keepUnlocked: boolean): Promise<void> {
    const parent = getUser(this.confirmed, parentId)
    if (!parent || parent.type !== 'parent') throw new Error('Elternteil nicht gefunden')

    if (parent.password && !(await verifyPassword(password, parent.password))) {
      throw new Error('Das Passwort ist falsch.')
    }

    this.secondHash = await deriveSecondHash(password, parent.secondPasswordSalt)
    this.unlockedParentId = parentId

    if (this.sessionStore) {
      if (keepUnlocked) writeJson(this.sessionStore, KEYS.unlocked, { parentId, secondHash: this.secondHash })
      else this.sessionStore.remove(KEYS.unlocked)
    }

    this.emit()
  }

  /** for create-family: the password was just set, no need to verify */
  unlockWithSecondHash(parentId: string, secondHash: string, keepUnlocked: boolean) {
    this.secondHash = secondHash
    this.unlockedParentId = parentId
    if (this.sessionStore && keepUnlocked) writeJson(this.sessionStore, KEYS.unlocked, { parentId, secondHash })
    this.emit()
  }

  lock() {
    this.secondHash = null
    this.unlockedParentId = null
    this.sessionStore?.remove(KEYS.unlocked)
    this.emit()
  }

  get isUnlocked() {
    return this.secondHash !== null && this.unlockedParentId !== null
  }

  private requireUnlocked(): { parentId: string; secondHash: string } {
    if (!this.secondHash || !this.unlockedParentId) throw new Error('Bitte zuerst mit dem Elternpasswort entsperren.')
    return { parentId: this.unlockedParentId, secondHash: this.secondHash }
  }

  // ---------- queue ----------

  private takeSequenceNumber(): number {
    if (!this.session) throw new Error('Nicht eingerichtet')
    const value = this.session.nextSequenceNumber
    this.session = { ...this.session, nextSequenceNumber: value + 1 }
    // persist before the number is used anywhere
    writeJson(this.store, KEYS.session, this.session)
    return value
  }

  /** queues parent actions (signed with the secondHash) and starts a sync */
  async run(actionsToRun: ParentAction | Array<ParentAction>, options: { sync?: boolean } = {}): Promise<void> {
    const list = Array.isArray(actionsToRun) ? actionsToRun : [actionsToRun]
    const { parentId, secondHash } = this.requireUnlocked()
    const session = this.session
    if (!session) throw new Error('Nicht eingerichtet')

    for (const action of list) {
      const encodedAction = JSON.stringify(action)
      const sequenceNumber = this.takeSequenceNumber()
      const integrity = await calculateParentActionIntegrity({
        secondHash,
        sequenceNumber,
        deviceId: session.ownDeviceId,
        encodedAction,
      })

      this.queue = [
        ...this.queue,
        {
          sequenceNumber,
          type: 'parent',
          userId: parentId,
          encodedAction,
          integrity,
          description: describeAction(action),
          createdAt: Date.now(),
          attempts: 0,
        },
      ]
    }

    writeJson(this.store, KEYS.queue, this.queue)
    this.emit()

    if (options.sync !== false) await this.sync()
  }

  private queueAppLogic(list: Array<AppLogicAction>) {
    for (const action of list) {
      this.queue = [
        ...this.queue,
        {
          sequenceNumber: this.takeSequenceNumber(),
          type: 'appLogic',
          userId: '',
          encodedAction: JSON.stringify(action),
          integrity: '',
          description: action.type,
          createdAt: Date.now(),
          attempts: 0,
        },
      ]
    }
    writeJson(this.store, KEYS.queue, this.queue)
  }

  /** removes all pending actions (debug view) */
  discardQueue() {
    this.queue = []
    writeJson(this.store, KEYS.queue, this.queue)
    this.emit()
  }

  // ---------- sync ----------

  /** push all pending actions, then pull. Calls are serialized. */
  sync(options: { full?: boolean } = {}): Promise<void> {
    if (options.full) this.forceFullSync = true
    if (this.syncing) {
      this.syncRequested = true
      return this.syncChain
    }

    this.syncChain = this.syncChain.then(() => this.runSyncLoop()).catch(() => undefined)
    return this.syncChain
  }

  private async runSyncLoop() {
    if (!this.session) return
    this.syncing = true
    this.lastError = null
    this.emit()

    try {
      let rounds = 0
      do {
        this.syncRequested = false
        await this.syncOnce()
        rounds++
      } while ((this.syncRequested || this.queue.length > 0) && rounds < 5)

      this.retryDelay = 5_000
    } catch (ex) {
      this.reportError(ex)
      this.scheduleRetry()
    } finally {
      this.syncing = false
      this.persistAll()
      this.emit()
    }
  }

  private reportError(ex: unknown) {
    const message = describeError(ex)
    this.lastError = message
    this.errors = [...this.errors.slice(-19), { at: Date.now(), message }]
  }

  private scheduleRetry() {
    if (this.retryTimer || this.queue.length === 0) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.sync()
    }, this.retryDelay)
    this.retryDelay = Math.min(this.retryDelay * 2, 5 * 60_000)
  }

  private async syncOnce() {
    const session = this.session
    if (!session) return
    const client = new ApiClient(session.serverUrl)

    // push
    while (this.queue.length > 0) {
      const batch = this.queue.slice(0, MAX_ACTIONS_PER_REQUEST)
      const payload: Array<ClientPushAction> = batch.map((item) => ({
        encodedAction: item.encodedAction,
        sequenceNumber: item.sequenceNumber,
        integrity: item.integrity,
        type: item.type,
        userId: item.userId,
      }))

      let result: { shouldDoFullSync: boolean }

      try {
        result = await pushActions(client, { deviceAuthToken: session.deviceAuthToken, actions: payload })
      } catch (ex) {
        // same sequence numbers will be sent again: the server ignores duplicates
        this.queue = this.queue.map((item) => (batch.includes(item) ? { ...item, attempts: item.attempts + 1 } : item))
        writeJson(this.store, KEYS.queue, this.queue)
        await this.handleAuthError(ex)
        throw ex
      }

      const sent = new Set(batch)
      this.queue = this.queue.filter((item) => !sent.has(item))
      writeJson(this.store, KEYS.queue, this.queue)

      if (result.shouldDoFullSync) {
        this.forceFullSync = true
        const parentActions = batch.filter((item) => item.type === 'parent')
        if (parentActions.length > 0) {
          this.reportError(
            new SignatureRejectedError(
              'Der Server hat mindestens eine Änderung abgelehnt (Signatur ungültig – Passwort falsch? – oder Premium/ungültige Daten): ' +
                parentActions.map((item) => item.description).join(', '),
            ),
          )
        } else {
          this.errors = [
            ...this.errors.slice(-19),
            { at: Date.now(), message: 'Server meldet einen Fehler bei: ' + batch.map((item) => item.description).join(', ') },
          ]
        }
      }
    }

    // pull
    const full = this.forceFullSync
    this.forceFullSync = false
    const base = full ? emptyFamilyState() : this.confirmed

    const status = await pullStatus(client, {
      deviceAuthToken: session.deviceAuthToken,
      status: buildClientDataStatus(full ? emptyFamilyState() : this.confirmed, {
        kri: this.crypto.lastKeyRequestServerSeq,
        kr: this.crypto.lastKeyResponseServerSeq,
        devicesDetail: full ? {} : devicesDetailStatus(this.crypto),
      }),
    }).catch(async (ex) => {
      await this.handleAuthError(ex)
      throw ex
    })

    this.lastRawStatus = status
    this.confirmed = applyServerDataStatus(base, status)

    // app list crypto
    try {
      const result = processAfterPull({
        input: this.crypto,
        status,
        devices: this.confirmed.devices,
        ownDeviceId: session.ownDeviceId,
      })
      this.crypto = result.state
      if (result.actions.length > 0) {
        this.queueAppLogic(result.actions)
        this.syncRequested = true
      }
    } catch (ex) {
      this.reportError(new Error('App-Listen: ' + describeError(ex)))
    }

    this.persistAll()
    this.emit()
  }

  private async handleAuthError(ex: unknown) {
    if (ex instanceof ApiError && ex.kind === 'unauthorized' && this.session) {
      try {
        const result = await isDeviceRemoved(new ApiClient(this.session.serverUrl), this.session.deviceAuthToken)
        if (result.isDeviceRemoved) {
          this.deviceRemoved = true
          this.stopLive()
        }
      } catch {
        // ignore
      }
    }
  }

  // ---------- live updates ----------

  startLive() {
    if (this.live || !this.session) return
    const session = this.session
    let timer: ReturnType<typeof setTimeout> | null = null

    this.live = connectLive({
      serverUrl: session.serverUrl,
      deviceAuthToken: session.deviceAuthToken,
      onShouldSync: () => {
        // debounce bursts of notifications
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => void this.sync(), 300)
      },
      onConnectedDevices: (ids) => {
        this.connectedDeviceIds = ids
        this.emit()
      },
      onStatus: (connected) => {
        this.liveConnected = connected
        this.emit()
      },
    })
  }

  stopLive() {
    this.live?.close()
    this.live = null
    this.liveConnected = false
  }

  // ---------- direct parent API calls ----------

  async createAddDeviceToken(): Promise<{ token: string; deviceId: string }> {
    const { parentId, secondHash } = this.requireUnlocked()
    const session = this.session!
    return createAddDeviceToken(this.client, {
      deviceAuthToken: session.deviceAuthToken,
      parentId,
      parentPasswordSecondHash: secondHash,
    })
  }

  async removeDevice(deviceId: string): Promise<void> {
    const { parentId, secondHash } = this.requireUnlocked()
    const session = this.session!
    await removeDevice(this.client, {
      deviceAuthToken: session.deviceAuthToken,
      parentUserId: parentId,
      parentPasswordSecondHash: secondHash,
      deviceId,
    })
    await this.sync()
  }

  requestAppListAgain(deviceId: string) {
    this.crypto = resetDeviceKeys(this.crypto, deviceId)
    writeJson(this.store, KEYS.crypto, this.crypto)
    void this.sync({ full: true })
  }

  get secondHashForDebug() {
    return this.secondHash !== null
  }
}
