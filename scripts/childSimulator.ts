// Simulates a TimeLimit child device against a real server (for the smoke
// test only): registers with an add-device token, uploads a public key and an
// encrypted app list and answers key requests like the Android client.

import { ApiClient } from '../src/api/client'
import { pullStatus, pushActions } from '../src/api/sync'
import { ServerDataStatus } from '../src/api/types'
import { base64Decode, base64Encode, randomBytes } from '../src/crypto/bytes'
import { encryptCryptContainer } from '../src/crypto/cryptContainer'
import {
  CRYPT_TYPE_APP_LIST_BASE,
  CRYPT_TYPE_APP_LIST_DIFF,
  curveSharedSecret,
  curveSign,
  curveVerify,
  encryptKeyBlock,
  generateCurveKeyPair,
  serializeKeyRequestSignedData,
  serializeKeyResponseSignedData,
} from '../src/crypto/keyExchange'
import { InstalledAppsList } from '../src/proto/applist'
import { deflate, encodeInstalledAppsList, encodeSavedAppsDifference } from '../src/proto/applistEncode'
import { applyServerDataStatus, buildClientDataStatus, emptyFamilyState, FamilyState } from '../src/state/familyState'

export class ChildSimulator {
  private seq = 1
  private signing = generateCurveKeyPair()
  private keys: Record<number, Uint8Array> = {
    [CRYPT_TYPE_APP_LIST_BASE]: randomBytes(16),
    [CRYPT_TYPE_APP_LIST_DIFF]: randomBytes(16),
  }
  state: FamilyState = emptyFamilyState()
  private kri: number | null = null
  answeredRequests = 0

  private constructor(
    readonly client: ApiClient,
    readonly deviceAuthToken: string,
    readonly deviceId: string,
  ) {}

  static async register(client: ApiClient, registerToken: string) {
    const result = await client.post<{ deviceAuthToken: string; ownDeviceId: string }>('/child/add-device', {
      registerToken,
      childDevice: { model: 'Simulator' },
      deviceName: 'Kind-Simulator',
      clientLevel: 8,
    })
    return new ChildSimulator(client, result.deviceAuthToken, result.ownDeviceId)
  }

  private async push(actions: Array<object>) {
    const result = await pushActions(this.client, {
      deviceAuthToken: this.deviceAuthToken,
      actions: actions.map((action) => ({
        encodedAction: JSON.stringify(action),
        sequenceNumber: this.seq++,
        integrity: '',
        type: 'appLogic' as const,
        userId: '',
      })),
    })
    if (result.shouldDoFullSync) throw new Error('child: server rejected app logic action')
  }

  async uploadKeyAndApps(apps: InstalledAppsList) {
    const base = encryptCryptContainer(this.keys[CRYPT_TYPE_APP_LIST_BASE], deflate(encodeInstalledAppsList(apps)), {
      generation: 0n,
      counter: 0n,
      iv: 42,
    })
    const diff = encryptCryptContainer(
      this.keys[CRYPT_TYPE_APP_LIST_DIFF],
      deflate(
        encodeSavedAppsDifference({
          apps: {
            added: { apps: [{ packageName: 'org.example.added', title: 'Nachträglich installiert', isLaunchable: true, recommendation: 'none' }], activities: [] },
            removedPackages: [apps.apps[0].packageName],
            removedActivities: [],
          },
          baseGeneration: 0n,
          baseCounter: 0n,
        }),
      ),
      { generation: 0n, counter: 0n, iv: 7 },
    )

    await this.push([
      { type: 'UPLOAD_DEVICE_PUBLIC_KEY', key: base64Encode(this.signing.publicKey) },
      { type: 'UPDATE_INSTALLED_APPS', b: base64Encode(base), d: base64Encode(diff), w: false },
    ])
  }

  async pull(): Promise<ServerDataStatus> {
    const status = await pullStatus(this.client, {
      deviceAuthToken: this.deviceAuthToken,
      status: buildClientDataStatus(this.state, { kri: this.kri }),
    })
    this.state = applyServerDataStatus(this.state, status)
    return status
  }

  /** answers pending key requests, like KeyRequestProcessor */
  async answerKeyRequests(): Promise<number> {
    const status = await this.pull()
    const replies: Array<object> = []

    for (const request of status.krq ?? []) {
      if (this.kri === null || request.srvSeq > this.kri) this.kri = request.srvSeq
      if (request.deviceId !== this.deviceId) continue

      const sender = this.state.devices.find((device) => device.deviceId === request.senId)
      if (!sender?.pk) continue

      const senderKey = base64Decode(sender.pk)
      const requestSignedData = {
        deviceSequenceNumber: request.senSeq,
        deviceId: request.deviceId ?? null,
        categoryId: request.categoryId ?? null,
        type: request.type,
        tempKey: base64Decode(request.tempKey),
      }

      if (!curveVerify(senderKey, serializeKeyRequestSignedData(requestSignedData), base64Decode(request.signature))) {
        throw new Error('child: invalid key request signature')
      }

      const temp = generateCurveKeyPair()
      const shared = curveSharedSecret(temp.privateKey, requestSignedData.tempKey)
      const encryptedKey = encryptKeyBlock(shared, this.keys[request.type])
      const signature = curveSign(
        this.signing.privateKey,
        serializeKeyResponseSignedData({ request: requestSignedData, senderDevicePublicKey: senderKey, tempKey: temp.publicKey, encryptedKey }),
      )

      replies.push({
        type: 'REPLY_TO_KEY_REQUEST',
        rsn: request.srvSeq,
        tempKey: base64Encode(temp.publicKey),
        encryptedKey: base64Encode(encryptedKey),
        signature: base64Encode(signature),
      })
    }

    if (replies.length > 0) await this.push(replies)
    this.answeredRequests += replies.length
    return replies.length
  }
}
