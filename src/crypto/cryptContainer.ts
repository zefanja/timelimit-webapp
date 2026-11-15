// Decryption of TimeLimit "crypt containers" (encrypted app lists).
//
// Format (Android: io.timelimit.android.crypto.CryptContainer):
//   header = int64BE(generation) ‖ int64BE(counter) ‖ int32BE(iv)   (20 bytes)
//   body   = AES-128-GCM ciphertext ‖ 16 byte tag
//   nonce  = int32BE(iv) ‖ int64BE(counter)                         (12 bytes)
//   aad    = int64BE(generation)

import { gcm } from '@noble/ciphers/aes'
import { int64BE, int32BE, concatBytes } from './bytes'

export const CRYPT_KEY_SIZE = 16
const HEADER_SIZE = 8 + 8 + 4
const TAG_SIZE = 16

export interface CryptContainerHeader {
  generation: bigint
  counter: bigint
  iv: number
}

export class InvalidCryptContainerError extends Error {}
export class WrongCryptKeyError extends Error {}

export function readCryptContainerHeader(input: Uint8Array): CryptContainerHeader {
  if (input.length < HEADER_SIZE + TAG_SIZE) throw new InvalidCryptContainerError('container too short')

  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)

  return {
    generation: view.getBigInt64(0, false),
    counter: view.getBigInt64(8, false),
    iv: view.getInt32(16, false),
  }
}

export function decryptCryptContainer(key: Uint8Array, input: Uint8Array): Uint8Array {
  if (key.length !== CRYPT_KEY_SIZE) throw new WrongCryptKeyError('invalid key size')

  const header = readCryptContainerHeader(input)
  const nonce = concatBytes(int32BE(header.iv), int64BE(header.counter))
  const aad = int64BE(header.generation)

  try {
    return gcm(key, nonce, aad).decrypt(input.subarray(HEADER_SIZE))
  } catch {
    throw new WrongCryptKeyError('authentication failed')
  }
}

/** only used by tests: produces a container like the Android client does */
export function encryptCryptContainer(
  key: Uint8Array,
  plaintext: Uint8Array,
  params: { generation: bigint; counter: bigint; iv: number },
): Uint8Array {
  const nonce = concatBytes(int32BE(params.iv), int64BE(params.counter))
  const aad = int64BE(params.generation)
  const encrypted = gcm(key, nonce, aad).encrypt(plaintext)

  return concatBytes(int64BE(params.generation), int64BE(params.counter), int32BE(params.iv), encrypted)
}
