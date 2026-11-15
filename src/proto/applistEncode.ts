// Protobuf encoder for the app list messages. Only used by tests and the
// smoke script to simulate a child device.

import { zlibSync } from 'fflate'
import { concatBytes } from '../crypto/bytes'
import { InstalledAppsList, SavedAppsDifference } from './applist'

const encoder = new TextEncoder()

function varint(value: bigint | number): Uint8Array {
  let v = BigInt.asUintN(64, BigInt(value))
  const out: Array<number> = []
  do {
    let byte = Number(v & 0x7fn)
    v >>= 7n
    if (v !== 0n) byte |= 0x80
    out.push(byte)
  } while (v !== 0n)
  return Uint8Array.from(out)
}

const tag = (field: number, wire: number) => varint((field << 3) | wire)
const lengthDelimited = (field: number, data: Uint8Array) => concatBytes(tag(field, 2), varint(data.length), data)
const str = (field: number, value: string) => (value === '' ? new Uint8Array() : lengthDelimited(field, encoder.encode(value)))
const int = (field: number, value: bigint | number) => (BigInt(value) === 0n ? new Uint8Array() : concatBytes(tag(field, 0), varint(value)))

export function encodeInstalledAppsList(list: InstalledAppsList): Uint8Array {
  return concatBytes(
    ...list.apps.map((app) =>
      lengthDelimited(
        1,
        concatBytes(
          str(1, app.packageName),
          str(2, app.title),
          int(3, app.isLaunchable ? 1 : 0),
          int(4, app.recommendation === 'whitelist' ? 1 : app.recommendation === 'blacklist' ? 2 : 0),
        ),
      ),
    ),
    ...list.activities.map((item) => lengthDelimited(2, concatBytes(str(1, item.packageName), str(2, item.className), str(3, item.title)))),
  )
}

export function encodeSavedAppsDifference(diff: SavedAppsDifference): Uint8Array {
  const apps = diff.apps
    ? lengthDelimited(
        1,
        concatBytes(
          diff.apps.added ? lengthDelimited(1, encodeInstalledAppsList(diff.apps.added)) : new Uint8Array(),
          ...diff.apps.removedPackages.map((name) => str(2, name)),
          ...diff.apps.removedActivities.map((item) => lengthDelimited(3, concatBytes(str(1, item.packageName), str(2, item.className)))),
        ),
      )
    : new Uint8Array()

  return concatBytes(apps, int(2, diff.baseGeneration), int(3, diff.baseCounter))
}

export const deflate = (data: Uint8Array) => zlibSync(data)
