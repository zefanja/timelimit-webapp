// Small byte helpers that work in browsers and in Node (>= 18).

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export const utf8Encode = (value: string): Uint8Array => textEncoder.encode(value)
export const utf8Decode = (value: Uint8Array): string => textDecoder.decode(value)

export function concatBytes(...parts: Array<Uint8Array>): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(total)
  let offset = 0

  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }

  return result
}

/** unsigned 32 bit big endian (like Buffer.writeUInt32BE / java DataOutput.writeInt for values >= 0) */
export function uint32BE(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError('value out of range for uint32: ' + value)
  }

  const result = new Uint8Array(4)
  new DataView(result.buffer).setUint32(0, value, false)
  return result
}

/** signed 32 bit big endian (java writeInt) */
export function int32BE(value: number): Uint8Array {
  const result = new Uint8Array(4)
  new DataView(result.buffer).setInt32(0, value, false)
  return result
}

/** unsigned 64 bit big endian (like Buffer.writeBigUInt64BE) */
export function uint64BE(value: number | bigint): Uint8Array {
  const big = BigInt(value)

  if (big < 0n || big > 0xffffffffffffffffn) {
    throw new RangeError('value out of range for uint64: ' + value)
  }

  const result = new Uint8Array(8)
  new DataView(result.buffer).setBigUint64(0, big, false)
  return result
}

/** signed 64 bit big endian (java writeLong) */
export function int64BE(value: number | bigint): Uint8Array {
  const result = new Uint8Array(8)
  new DataView(result.buffer).setBigInt64(0, BigInt(value), false)
  return result
}

export function base64Encode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function base64Decode(value: string): Uint8Array {
  const binary = atob(value)
  const result = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) result[i] = binary.charCodeAt(i)
  return result
}

export function randomBytes(length: number): Uint8Array {
  const result = new Uint8Array(length)
  globalThis.crypto.getRandomValues(result)
  return result
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** a TimeLimit "id within family": 6 alphanumeric characters */
export function generateFamilyId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  // rejection sampling to avoid modulo bias
  let result = ''
  while (result.length < 6) {
    const [byte] = randomBytes(1)
    if (byte < 248) result += alphabet[byte % 62]
  }
  return result
}
