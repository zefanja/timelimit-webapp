// Handling of encrypted app lists of child devices (pull hook).
// Mirrors CryptDataHandler / KeyResponseProcessor / DecryptProcessor of the
// Android client, reduced to what a parent-only device needs: it never
// encrypts own data and does not answer key requests of other devices.

import { AppLogicAction } from '../actions/parentActions'
import { ServerDataStatus, ServerDeviceData } from '../api/types'
import { base64Decode, base64Encode } from '../crypto/bytes'
import {
  decryptCryptContainer,
  readCryptContainerHeader,
  CRYPT_KEY_SIZE,
  InvalidCryptContainerError,
  WrongCryptKeyError,
} from '../crypto/cryptContainer'
import {
  CRYPT_TYPE_APP_LIST_BASE,
  CRYPT_TYPE_APP_LIST_DIFF,
  curveSharedSecret,
  curveSign,
  curveVerify,
  decryptKeyBlock,
  generateCurveKeyPair,
  PUBLIC_KEY_SIZE,
  serializeKeyRequestSignedData,
  serializeKeyResponseSignedData,
  SIGNATURE_SIZE,
} from '../crypto/keyExchange'
import {
  decodeInstalledAppsList,
  decodeSavedAppsDifference,
  inflate,
  InstalledApp,
  mergeAppLists,
} from '../proto/applist'

export type ContainerStatus = 'missingKey' | 'ok' | 'cryptoDamage' | 'contentDamage' | 'downgrade'

export interface ContainerState {
  serverVersion: string
  data: string // base64
  generation: string // bigint as string
  nextCounter: string
  key: string | null // base64
  status: ContainerStatus
}

export interface PendingKeyRequest {
  deviceId: string
  type: number
  dsn: number
  generation: string
  tempPublicKey: string
  tempPrivateKey: string
  sentAt: number
}

export interface AppListEntry {
  apps: Array<InstalledApp>
  updatedAt: number
}

export interface CryptoState {
  signingPublicKey: string | null
  signingPrivateKey: string | null
  nextSigningSequenceNumber: number
  lastKeyRequestServerSeq: number | null
  lastKeyResponseServerSeq: number | null
  containers: Record<string, ContainerState> // key: deviceId + ':' + type
  pendingRequests: Array<PendingKeyRequest>
  appLists: Record<string, AppListEntry>
  log: Array<string>
}

export const emptyCryptoState = (): CryptoState => ({
  signingPublicKey: null,
  signingPrivateKey: null,
  nextSigningSequenceNumber: 1,
  lastKeyRequestServerSeq: null,
  lastKeyResponseServerSeq: null,
  containers: {},
  pendingRequests: [],
  appLists: {},
  log: [],
})

const containerKey = (deviceId: string, type: number) => deviceId + ':' + type

function addLog(state: CryptoState, message: string) {
  state.log = [...state.log.slice(-49), new Date().toISOString() + ' ' + message]
}

export function devicesDetailStatus(state: CryptoState): Record<string, { appsB?: string; appsD?: string }> {
  const result: Record<string, { appsB?: string; appsD?: string }> = {}

  for (const [key, container] of Object.entries(state.containers)) {
    const [deviceId, type] = key.split(':')
    const entry = (result[deviceId] = result[deviceId] ?? {})
    if (Number(type) === CRYPT_TYPE_APP_LIST_BASE) entry.appsB = container.serverVersion
    else if (Number(type) === CRYPT_TYPE_APP_LIST_DIFF) entry.appsD = container.serverVersion
  }

  return result
}

export interface PostPullResult {
  state: CryptoState
  actions: Array<AppLogicAction>
  appListsChanged: boolean
}

/** forces new key requests for one device (e.g. button "App-Liste neu anfordern") */
export function resetDeviceKeys(input: CryptoState, deviceId: string): CryptoState {
  const state: CryptoState = structuredClone(input)
  state.pendingRequests = state.pendingRequests.filter((item) => item.deviceId !== deviceId)
  for (const type of [CRYPT_TYPE_APP_LIST_BASE, CRYPT_TYPE_APP_LIST_DIFF]) {
    const container = state.containers[containerKey(deviceId, type)]
    if (container) container.status = 'missingKey'
  }
  return state
}

export function processAfterPull({
  input,
  status,
  devices,
  ownDeviceId,
  now = Date.now(),
}: {
  input: CryptoState
  status: ServerDataStatus
  devices: Array<ServerDeviceData>
  ownDeviceId: string
  now?: number
}): PostPullResult {
  const state: CryptoState = structuredClone(input)
  const actions: Array<AppLogicAction> = []
  let appListsChanged = false

  if (status.apiLevel < 4) return { state, actions, appListsChanged }

  // 1. own signing key
  const ownDevice = devices.find((device) => device.deviceId === ownDeviceId)

  if (!state.signingPrivateKey || !state.signingPublicKey) {
    const pair = generateCurveKeyPair()
    state.signingPublicKey = base64Encode(pair.publicKey)
    state.signingPrivateKey = base64Encode(pair.privateKey)
    actions.push({ type: 'UPLOAD_DEVICE_PUBLIC_KEY', key: state.signingPublicKey })
    addLog(state, 'Signaturschlüssel erzeugt')
  } else if (ownDevice && ownDevice.pk !== state.signingPublicKey) {
    actions.push({ type: 'UPLOAD_DEVICE_PUBLIC_KEY', key: state.signingPublicKey })
    addLog(state, 'Signaturschlüssel erneut hochgeladen')
  }

  // key requests are only useful once the server (and therefore the child
  // devices) know our public key
  const isOwnKeyKnownToServer = !!ownDevice && ownDevice.pk === state.signingPublicKey
  const signingPrivateKey = base64Decode(state.signingPrivateKey!)
  const signingPublicKey = base64Decode(state.signingPublicKey!)

  // 2. received encrypted containers
  for (const item of status.devices2 ?? []) {
    if (item.deviceId === ownDeviceId) continue

    const handle = (type: number, data: { version: string; data: string } | undefined) => {
      if (!data) return
      const key = containerKey(item.deviceId, type)
      const old = state.containers[key]

      if (old && old.data === data.data) {
        old.serverVersion = data.version
        return
      }

      const container: ContainerState = old
        ? { ...old, serverVersion: data.version, data: data.data }
        : { serverVersion: data.version, data: data.data, generation: '0', nextCounter: '0', key: null, status: 'missingKey' }

      let header
      try {
        header = readCryptContainerHeader(base64Decode(data.data))
      } catch {
        container.status = 'cryptoDamage'
        state.containers[key] = container
        return
      }

      const generation = BigInt(container.generation)

      if (header.generation < generation) {
        container.status = 'downgrade'
      } else if (header.generation > generation || container.key === null) {
        container.status = 'missingKey'
      } else if (header.counter < BigInt(container.nextCounter)) {
        container.status = 'downgrade'
      } else {
        try {
          decryptCryptContainer(base64Decode(container.key), base64Decode(data.data))
          container.status = 'ok'
          container.nextCounter = (header.counter + 1n).toString()
        } catch {
          container.status = 'missingKey'
        }
      }

      state.containers[key] = container
    }

    handle(CRYPT_TYPE_APP_LIST_BASE, item.appsBase)
    handle(CRYPT_TYPE_APP_LIST_DIFF, item.appsDiff)
  }

  // 3. key responses
  let maxKr = state.lastKeyResponseServerSeq
  for (const response of status.kr ?? []) {
    if (state.lastKeyResponseServerSeq !== null && response.srvSeq <= state.lastKeyResponseServerSeq) continue
    if (maxKr === null || response.srvSeq > maxKr) maxKr = response.srvSeq

    const request = state.pendingRequests.find((item) => item.dsn === response.rqSeq)
    if (!request) continue

    const sender = devices.find((device) => device.deviceId === response.sender)
    if (!sender?.pk) {
      addLog(state, `Antwort von ${response.sender} ignoriert: kein öffentlicher Schlüssel`)
      continue
    }

    const senderKey = base64Decode(sender.pk)
    const tempKey = base64Decode(response.tempKey)
    const encryptedKey = base64Decode(response.cryptKey)
    const signature = base64Decode(response.signature)

    if (
      senderKey.length !== PUBLIC_KEY_SIZE ||
      tempKey.length !== PUBLIC_KEY_SIZE ||
      signature.length !== SIGNATURE_SIZE ||
      encryptedKey.length !== CRYPT_KEY_SIZE
    ) {
      addLog(state, 'Antwort ignoriert: falsche Datenlänge')
      continue
    }

    const signedData = serializeKeyResponseSignedData({
      request: {
        deviceSequenceNumber: request.dsn,
        deviceId: request.deviceId,
        categoryId: null,
        type: request.type,
        tempKey: base64Decode(request.tempPublicKey),
      },
      senderDevicePublicKey: signingPublicKey,
      tempKey,
      encryptedKey,
    })

    if (!curveVerify(senderKey, signedData, signature)) {
      addLog(state, `Antwort von ${response.sender} ignoriert: Signatur ungültig`)
      continue
    }

    const shared = curveSharedSecret(base64Decode(request.tempPrivateKey), tempKey)
    const decryptedKey = decryptKeyBlock(shared, encryptedKey)
    const key = containerKey(request.deviceId, request.type)
    const container = state.containers[key]

    if (!container) continue

    try {
      const encrypted = base64Decode(container.data)
      const header = readCryptContainerHeader(encrypted)
      decryptCryptContainer(decryptedKey, encrypted)

      container.key = base64Encode(decryptedKey)
      container.generation = header.generation.toString()
      container.nextCounter = (header.counter + 1n).toString()
      container.status = 'ok'

      state.pendingRequests = state.pendingRequests.filter((item) => item !== request)
      actions.push({ type: 'FINISH_KEY_REQUEST', dsn: request.dsn })
      addLog(state, `Schlüssel für ${request.deviceId}/${request.type} erhalten`)
    } catch (ex) {
      if (ex instanceof WrongCryptKeyError || ex instanceof InvalidCryptContainerError) {
        addLog(state, `Schlüssel von ${response.sender} passt nicht`)
      } else throw ex
    }
  }
  state.lastKeyResponseServerSeq = maxKr

  // 4. key requests of other devices are not answered, only acknowledged
  for (const request of status.krq ?? []) {
    if (state.lastKeyRequestServerSeq === null || request.srvSeq > state.lastKeyRequestServerSeq) {
      state.lastKeyRequestServerSeq = request.srvSeq
    }
  }

  // 5. new key requests for containers without key
  if (isOwnKeyKnownToServer) {
    for (const [key, container] of Object.entries(state.containers)) {
      if (container.status !== 'missingKey') continue

      const [deviceId, typeString] = key.split(':')
      const type = Number(typeString)

      if (!devices.some((device) => device.deviceId === deviceId)) continue

      let header
      try {
        header = readCryptContainerHeader(base64Decode(container.data))
      } catch {
        continue
      }

      const existing = state.pendingRequests.find((item) => item.deviceId === deviceId && item.type === type)
      if (existing && BigInt(existing.generation) >= header.generation) continue

      const tempPair = generateCurveKeyPair()
      const dsn = state.nextSigningSequenceNumber++

      const signature = curveSign(
        signingPrivateKey,
        serializeKeyRequestSignedData({ deviceSequenceNumber: dsn, deviceId, categoryId: null, type, tempKey: tempPair.publicKey }),
      )

      actions.push({
        type: 'SEND_KEY_REQUEST',
        dsn,
        deviceId,
        dataType: type,
        tempKey: base64Encode(tempPair.publicKey),
        signature: base64Encode(signature),
      })

      state.pendingRequests = [
        ...state.pendingRequests.filter((item) => item !== existing),
        {
          deviceId,
          type,
          dsn,
          generation: header.generation.toString(),
          tempPublicKey: base64Encode(tempPair.publicKey),
          tempPrivateKey: base64Encode(tempPair.privateKey),
          sentAt: now,
        },
      ]

      addLog(state, `Schlüssel für ${deviceId}/${type} angefragt`)
    }
  }

  // 6. decrypt app lists
  const deviceIds = new Set(Object.keys(state.containers).map((key) => key.split(':')[0]))

  for (const deviceId of deviceIds) {
    const base = state.containers[containerKey(deviceId, CRYPT_TYPE_APP_LIST_BASE)]
    const diff = state.containers[containerKey(deviceId, CRYPT_TYPE_APP_LIST_DIFF)]

    if (!base || base.status !== 'ok' || !base.key) continue
    // the diff can be missing directly after a new base was uploaded
    if (diff && (diff.status !== 'ok' || !diff.key)) continue

    try {
      const baseEncrypted = base64Decode(base.data)
      const baseHeader = readCryptContainerHeader(baseEncrypted)
      const baseList = decodeInstalledAppsList(inflate(decryptCryptContainer(base64Decode(base.key), baseEncrypted)))

      let diffContent = null
      if (diff && diff.key) {
        const decoded = decodeSavedAppsDifference(inflate(decryptCryptContainer(base64Decode(diff.key), base64Decode(diff.data))))
        if (decoded.baseGeneration === baseHeader.generation && decoded.baseCounter === baseHeader.counter) {
          diffContent = decoded.apps
        }
      }

      const merged = mergeAppLists(baseList, diffContent)
      const old = state.appLists[deviceId]
      const sorted = merged.apps.sort((a, b) => a.title.localeCompare(b.title, 'de'))

      if (!old || JSON.stringify(old.apps) !== JSON.stringify(sorted)) {
        state.appLists[deviceId] = { apps: sorted, updatedAt: now }
        appListsChanged = true
      }
    } catch (ex) {
      base.status = ex instanceof WrongCryptKeyError ? 'cryptoDamage' : 'contentDamage'
      addLog(state, `App-Liste von ${deviceId} konnte nicht gelesen werden: ${ex instanceof Error ? ex.message : ex}`)
    }
  }

  return { state, actions, appListsChanged }
}

