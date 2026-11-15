import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildActionHmacInput, calculateParentActionIntegrity } from '../src/crypto/integrity'
import { hasServerBuild, requireFromServer } from './helpers'

// independent reference built with node:crypto and Buffer, structured like the
// server's calculateActionHmac (Buffer.writeBigUInt64BE / writeUInt32BE)
function reference({ secondHash, sequenceNumber, deviceId, encodedAction }: {
  secondHash: string
  sequenceNumber: number
  deviceId: string
  encodedAction: string
}) {
  const long = Buffer.alloc(8)
  long.writeBigUInt64BE(BigInt(sequenceNumber))
  const deviceIdBytes = Buffer.from(deviceId, 'utf8')
  const actionBytes = Buffer.from(encodedAction, 'utf8')
  const deviceIdLength = Buffer.alloc(4)
  deviceIdLength.writeUInt32BE(deviceIdBytes.length)
  const actionLength = Buffer.alloc(4)
  actionLength.writeUInt32BE(actionBytes.length)

  return createHmac('sha256', Buffer.from(secondHash, 'utf8'))
    .update(long)
    .update(deviceIdLength)
    .update(deviceIdBytes)
    .update(actionLength)
    .update(actionBytes)
    .digest()
}

const cases = [
  { secondHash: '$2a$10$abcdefghijklmnopqrstuuSb1Qd6CflN5TfR1tq0wWBEZ6PIG7M5i', sequenceNumber: 1, deviceId: 'abc123', encodedAction: '{"type":"DELETE_CATEGORY","categoryId":"xyz789"}' },
  { secondHash: '$2a$10$abcdefghijklmnopqrstuuSb1Qd6CflN5TfR1tq0wWBEZ6PIG7M5i', sequenceNumber: 2 ** 40 + 17, deviceId: 'Zz9yX1', encodedAction: '{"type":"RENAME_CHILD","childId":"aaaaaa","newName":"Jürgen 🚀"}' },
  { secondHash: 'x', sequenceNumber: 0, deviceId: '', encodedAction: '' },
]

describe('action integrity', () => {
  it('lays out the HMAC input as uint64BE ‖ uint32BE len ‖ id ‖ uint32BE len ‖ action', () => {
    const input = buildActionHmacInput({ sequenceNumber: 258, deviceId: 'ab', encodedAction: 'ä' })
    expect(Array.from(input)).toEqual([0, 0, 0, 0, 0, 0, 1, 2, 0, 0, 0, 2, 97, 98, 0, 0, 0, 2, 0xc3, 0xa4])
  })

  it.each(cases)('matches the node:crypto reference (seq $sequenceNumber)', async (testCase) => {
    const integrity = await calculateParentActionIntegrity(testCase)
    expect(integrity).toBe('password:' + reference(testCase).toString('base64'))
  })

  it.skipIf(!hasServerBuild)('matches the server binary helpers (TIMELIMIT_SERVER_DIR)', async () => {
    const { intToBuffer, longToBuffer } = requireFromServer('build/util/binary-number.js')

    for (const testCase of cases) {
      const deviceIdBytes = Buffer.from(testCase.deviceId, 'utf8')
      const actionBytes = Buffer.from(testCase.encodedAction, 'utf8')
      const expected = createHmac('sha256', Buffer.from(testCase.secondHash, 'utf8'))
        .update(longToBuffer(BigInt(testCase.sequenceNumber)))
        .update(intToBuffer(deviceIdBytes.length))
        .update(deviceIdBytes)
        .update(intToBuffer(actionBytes.length))
        .update(actionBytes)
        .digest()

      expect(await calculateParentActionIntegrity(testCase)).toBe('password:' + expected.toString('base64'))
    }
  })
})
