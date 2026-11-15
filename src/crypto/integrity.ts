// Integrity value for parent actions ("password:" + base64(HMAC)).
//
// Mirrors calculateActionHmac() of the server
// (src/function/sync/apply-actions/integrity.ts):
//   key  = utf8(secondHash)
//   data = uint64BE(sequenceNumber)
//        ‖ uint32BE(len(deviceIdBytes)) ‖ deviceIdBytes
//        ‖ uint32BE(len(encodedActionBytes)) ‖ encodedActionBytes
//   hmac = HMAC-SHA256(key, data)

import { base64Encode, concatBytes, uint32BE, uint64BE, utf8Encode } from './bytes'

export function buildActionHmacInput({
  sequenceNumber,
  deviceId,
  encodedAction,
}: {
  sequenceNumber: number
  deviceId: string
  encodedAction: string
}): Uint8Array {
  if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber < 0) {
    throw new RangeError('invalid sequence number')
  }

  const deviceIdBytes = utf8Encode(deviceId)
  const actionBytes = utf8Encode(encodedAction)

  return concatBytes(
    uint64BE(sequenceNumber),
    uint32BE(deviceIdBytes.length),
    deviceIdBytes,
    uint32BE(actionBytes.length),
    actionBytes,
  )
}

export async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  return new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', cryptoKey, data as BufferSource))
}

export async function calculateActionHmac(params: {
  secondHash: string
  sequenceNumber: number
  deviceId: string
  encodedAction: string
}): Promise<Uint8Array> {
  return hmacSha256(utf8Encode(params.secondHash), buildActionHmacInput(params))
}

export async function calculateParentActionIntegrity(params: {
  secondHash: string
  sequenceNumber: number
  deviceId: string
  encodedAction: string
}): Promise<string> {
  return 'password:' + base64Encode(await calculateActionHmac(params))
}
