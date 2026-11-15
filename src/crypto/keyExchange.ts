// Key exchange for encrypted app lists (Android: io.timelimit.android.logic.crypto.*).
//
// Every device has a Curve25519 signing key pair whose public key is uploaded
// with the app logic action UPLOAD_DEVICE_PUBLIC_KEY. To read the encrypted app
// list of a child device, the web app sends SEND_KEY_REQUEST with a temporary
// X25519 key and a signature. The child device answers with REPLY_TO_KEY_REQUEST:
// the AES key encrypted (AES-ECB, one block) with the X25519 shared secret and a
// signature over KeyResponseSignedData. Signatures use the Signal/libsignal
// "curve25519 signature" scheme which curve25519-js implements.

import * as curve from 'curve25519-js'
import { ecb } from '@noble/ciphers/aes'
import { concatBytes, int32BE, int64BE, randomBytes, utf8Encode } from './bytes'

export const PUBLIC_KEY_SIZE = 32
export const PRIVATE_KEY_SIZE = 32
export const SIGNATURE_SIZE = 64

export interface CurveKeyPair {
  publicKey: Uint8Array
  privateKey: Uint8Array
}

export function generateCurveKeyPair(): CurveKeyPair {
  const pair = curve.generateKeyPair(randomBytes(32))

  return { publicKey: Uint8Array.from(pair.public), privateKey: Uint8Array.from(pair.private) }
}

export function curveSign(privateKey: Uint8Array, message: Uint8Array): Uint8Array {
  return Uint8Array.from(curve.sign(privateKey, message, randomBytes(64)))
}

export function curveVerify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  if (publicKey.length !== PUBLIC_KEY_SIZE || signature.length !== SIGNATURE_SIZE) return false

  try {
    return curve.verify(publicKey, message, signature)
  } catch {
    return false
  }
}

export function curveSharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return Uint8Array.from(curve.sharedKey(privateKey, publicKey))
}

export interface KeyRequestSignedData {
  deviceSequenceNumber: number
  deviceId: string | null
  categoryId: string | null
  type: number
  tempKey: Uint8Array
}

function serializeString(value: string): Uint8Array {
  const bytes = utf8Encode(value)
  return concatBytes(int32BE(bytes.length), bytes)
}

function serializeBool(value: boolean): Uint8Array {
  return Uint8Array.of(value ? 1 : 0)
}

function serializeOptionalString(value: string | null): Uint8Array {
  return value === null ? serializeBool(false) : concatBytes(serializeBool(true), serializeString(value))
}

export function serializeKeyRequestSignedData(data: KeyRequestSignedData): Uint8Array {
  if (data.tempKey.length !== 32) throw new Error('invalid temp key')

  return concatBytes(
    serializeString('KeyRequestSignedData'),
    int64BE(data.deviceSequenceNumber),
    // the Android client writes this flag in addition to the optional string itself
    serializeBool(data.deviceId !== null),
    serializeOptionalString(data.deviceId),
    serializeOptionalString(data.categoryId),
    int32BE(data.type),
    data.tempKey,
  )
}

export interface KeyResponseSignedData {
  request: KeyRequestSignedData
  senderDevicePublicKey: Uint8Array
  tempKey: Uint8Array
  encryptedKey: Uint8Array
}

function serializeByteArray(value: Uint8Array): Uint8Array {
  return concatBytes(int32BE(value.length), value)
}

export function serializeKeyResponseSignedData(data: KeyResponseSignedData): Uint8Array {
  return concatBytes(
    serializeString('KeyResponseSignedData'),
    serializeByteArray(data.senderDevicePublicKey),
    serializeByteArray(data.tempKey),
    serializeByteArray(data.encryptedKey),
    serializeKeyRequestSignedData(data.request),
  )
}

/** AES-128-ECB, one block, without padding (the key is exactly one block) */
export function decryptKeyBlock(sharedSecret: Uint8Array, encryptedKey: Uint8Array): Uint8Array {
  return ecb(sharedSecret.subarray(0, 16), { disablePadding: true }).decrypt(encryptedKey)
}

export function encryptKeyBlock(sharedSecret: Uint8Array, key: Uint8Array): Uint8Array {
  return ecb(sharedSecret.subarray(0, 16), { disablePadding: true }).encrypt(key)
}

export const CRYPT_TYPE_APP_LIST_BASE = 1
export const CRYPT_TYPE_APP_LIST_DIFF = 2
