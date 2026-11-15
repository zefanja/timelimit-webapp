import { describe, expect, it } from 'vitest'
import { randomBytes } from '../src/crypto/bytes'
import {
  decryptCryptContainer,
  encryptCryptContainer,
  readCryptContainerHeader,
  WrongCryptKeyError,
} from '../src/crypto/cryptContainer'
import {
  curveSharedSecret,
  curveSign,
  curveVerify,
  decryptKeyBlock,
  encryptKeyBlock,
  generateCurveKeyPair,
  serializeKeyRequestSignedData,
  serializeKeyResponseSignedData,
} from '../src/crypto/keyExchange'
import { decodeInstalledAppsList, decodeSavedAppsDifference, inflate, mergeAppLists } from '../src/proto/applist'
import { deflate, encodeInstalledAppsList, encodeSavedAppsDifference } from '../src/proto/applistEncode'
import { hasServerBuild, requireFromServer } from './helpers'

describe('crypt container', () => {
  it('round trips and checks header, nonce and aad', () => {
    const key = randomBytes(16)
    const data = new TextEncoder().encode('hallo welt')
    const container = encryptCryptContainer(key, data, { generation: 3n, counter: 9n, iv: -5 })

    expect(readCryptContainerHeader(container)).toEqual({ generation: 3n, counter: 9n, iv: -5 })
    expect(new TextDecoder().decode(decryptCryptContainer(key, container))).toBe('hallo welt')

    expect(() => decryptCryptContainer(randomBytes(16), container)).toThrow(WrongCryptKeyError)

    const tampered = new Uint8Array(container)
    tampered[7] ^= 1 // generation is authenticated data
    expect(() => decryptCryptContainer(key, tampered)).toThrow(WrongCryptKeyError)
  })
})

describe('key exchange', () => {
  it('signs and verifies', () => {
    const pair = generateCurveKeyPair()
    const message = randomBytes(100)
    const signature = curveSign(pair.privateKey, message)
    expect(signature.length).toBe(64)
    expect(curveVerify(pair.publicKey, message, signature)).toBe(true)
    message[0] ^= 1
    expect(curveVerify(pair.publicKey, message, signature)).toBe(false)
  })

  it('derives the same shared secret on both sides and transports a key', () => {
    const a = generateCurveKeyPair()
    const b = generateCurveKeyPair()
    const s1 = curveSharedSecret(a.privateKey, b.publicKey)
    const s2 = curveSharedSecret(b.privateKey, a.publicKey)
    expect(s1).toEqual(s2)

    const key = randomBytes(16)
    expect(decryptKeyBlock(s2, encryptKeyBlock(s1, key))).toEqual(key)
  })

  it('serializes KeyRequestSignedData like the Android client', () => {
    const tempKey = new Uint8Array(32).fill(7)
    const bytes = serializeKeyRequestSignedData({ deviceSequenceNumber: 5, deviceId: 'abc', categoryId: null, type: 1, tempKey })

    const expected = [
      0, 0, 0, 20, ...new TextEncoder().encode('KeyRequestSignedData'),
      0, 0, 0, 0, 0, 0, 0, 5,
      1, // deviceId != null
      1, 0, 0, 0, 3, 97, 98, 99, // optional deviceId
      0, // categoryId absent
      0, 0, 0, 1,
      ...tempKey,
    ]
    expect(Array.from(bytes)).toEqual(expected)

    const response = serializeKeyResponseSignedData({
      request: { deviceSequenceNumber: 5, deviceId: 'abc', categoryId: null, type: 1, tempKey },
      senderDevicePublicKey: new Uint8Array(32).fill(1),
      tempKey: new Uint8Array(32).fill(2),
      encryptedKey: new Uint8Array(16).fill(3),
    })
    expect(response.length).toBe(4 + 21 + 4 + 32 + 4 + 32 + 4 + 16 + expected.length)
  })

  it.skipIf(!hasServerBuild)('produces SEND_KEY_REQUEST actions the server accepts', () => {
    const { isSerializedAppLogicAction } = requireFromServer('build/api/validator.js')
    const { parseAppLogicAction } = requireFromServer('build/action/serialization/index.js')
    const pair = generateCurveKeyPair()
    const temp = generateCurveKeyPair()
    const action = {
      type: 'SEND_KEY_REQUEST',
      dsn: 1,
      deviceId: 'abcdef',
      dataType: 1,
      tempKey: Buffer.from(temp.publicKey).toString('base64'),
      signature: Buffer.from(curveSign(pair.privateKey, new Uint8Array([1]))).toString('base64'),
    }
    expect(isSerializedAppLogicAction(action)).toBe(true)
    expect(() => parseAppLogicAction(action)).not.toThrow()
  })
})

describe('app list protobuf', () => {
  const base = {
    apps: [
      { packageName: 'a.b', title: 'Älpha', isLaunchable: true, recommendation: 'none' as const },
      { packageName: 'c.d', title: 'Delta', isLaunchable: false, recommendation: 'blacklist' as const },
    ],
    activities: [{ packageName: 'a.b', className: 'a.b.Main', title: 'Main' }],
  }

  it('round trips the base list through zlib', () => {
    expect(decodeInstalledAppsList(inflate(deflate(encodeInstalledAppsList(base))))).toEqual(base)
  })

  it('decodes and applies a difference', () => {
    const diff = {
      apps: {
        added: { apps: [{ packageName: 'e.f', title: 'Echo', isLaunchable: true, recommendation: 'whitelist' as const }], activities: [] },
        removedPackages: ['c.d'],
        removedActivities: [{ packageName: 'a.b', className: 'a.b.Main' }],
      },
      baseGeneration: 2n,
      baseCounter: 300n,
    }

    const decoded = decodeSavedAppsDifference(encodeSavedAppsDifference(diff))
    expect(decoded).toEqual(diff)

    const merged = mergeAppLists(base, decoded.apps)
    expect(merged.apps.map((app) => app.packageName)).toEqual(['a.b', 'e.f'])
    expect(merged.activities).toEqual([])
  })
})
