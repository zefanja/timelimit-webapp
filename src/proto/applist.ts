// Minimal protobuf decoder for io/timelimit/proto/applist.proto
// (only the messages needed to read app lists of child devices).

import { unzlibSync } from 'fflate'

export interface InstalledApp {
  packageName: string
  title: string
  isLaunchable: boolean
  recommendation: 'none' | 'whitelist' | 'blacklist'
}

export interface InstalledAppActivity {
  packageName: string
  className: string
  title: string
}

export interface InstalledAppsList {
  apps: Array<InstalledApp>
  activities: Array<InstalledAppActivity>
}

export interface InstalledAppsDifference {
  added: InstalledAppsList | null
  removedPackages: Array<string>
  removedActivities: Array<{ packageName: string; className: string }>
}

export interface SavedAppsDifference {
  apps: InstalledAppsDifference | null
  baseGeneration: bigint
  baseCounter: bigint
}

class Reader {
  private pos = 0
  constructor(private readonly data: Uint8Array) {}

  get done() {
    return this.pos >= this.data.length
  }

  varint(): bigint {
    let result = 0n
    let shift = 0n

    for (;;) {
      if (this.pos >= this.data.length) throw new Error('truncated varint')
      const byte = this.data[this.pos++]
      result |= BigInt(byte & 0x7f) << shift
      if ((byte & 0x80) === 0) return result
      shift += 7n
      if (shift > 70n) throw new Error('varint too long')
    }
  }

  bytes(): Uint8Array {
    const length = Number(this.varint())
    if (this.pos + length > this.data.length) throw new Error('truncated field')
    const result = this.data.subarray(this.pos, this.pos + length)
    this.pos += length
    return result
  }

  skip(wireType: number) {
    switch (wireType) {
      case 0: this.varint(); break
      case 1: this.pos += 8; break
      case 2: this.bytes(); break
      case 5: this.pos += 4; break
      default: throw new Error('unsupported wire type ' + wireType)
    }
  }

  fields(handler: (field: number, wireType: number) => boolean) {
    while (!this.done) {
      const tag = Number(this.varint())
      const field = tag >>> 3
      const wireType = tag & 7
      if (!handler(field, wireType)) this.skip(wireType)
    }
  }
}

const decoder = new TextDecoder()
const str = (r: Reader) => decoder.decode(r.bytes())
const toInt64 = (value: bigint) => BigInt.asIntN(64, value)

function decodeApp(data: Uint8Array): InstalledApp {
  const r = new Reader(data)
  const app: InstalledApp = { packageName: '', title: '', isLaunchable: false, recommendation: 'none' }

  r.fields((field, wire) => {
    if (field === 1 && wire === 2) app.packageName = str(r)
    else if (field === 2 && wire === 2) app.title = str(r)
    else if (field === 3 && wire === 0) app.isLaunchable = r.varint() !== 0n
    else if (field === 4 && wire === 0) {
      const value = Number(r.varint())
      app.recommendation = value === 1 ? 'whitelist' : value === 2 ? 'blacklist' : 'none'
    } else return false
    return true
  })

  return app
}

function decodeActivity(data: Uint8Array): InstalledAppActivity {
  const r = new Reader(data)
  const item: InstalledAppActivity = { packageName: '', className: '', title: '' }

  r.fields((field, wire) => {
    if (wire !== 2) return false
    if (field === 1) item.packageName = str(r)
    else if (field === 2) item.className = str(r)
    else if (field === 3) item.title = str(r)
    else return false
    return true
  })

  return item
}

export function decodeInstalledAppsList(data: Uint8Array): InstalledAppsList {
  const r = new Reader(data)
  const result: InstalledAppsList = { apps: [], activities: [] }

  r.fields((field, wire) => {
    if (wire !== 2) return false
    if (field === 1) result.apps.push(decodeApp(r.bytes()))
    else if (field === 2) result.activities.push(decodeActivity(r.bytes()))
    else return false
    return true
  })

  return result
}

function decodeDifference(data: Uint8Array): InstalledAppsDifference {
  const r = new Reader(data)
  const result: InstalledAppsDifference = { added: null, removedPackages: [], removedActivities: [] }

  r.fields((field, wire) => {
    if (wire !== 2) return false
    if (field === 1) result.added = decodeInstalledAppsList(r.bytes())
    else if (field === 2) result.removedPackages.push(str(r))
    else if (field === 3) {
      const item = decodeActivity(r.bytes())
      result.removedActivities.push({ packageName: item.packageName, className: item.className })
    } else return false
    return true
  })

  return result
}

export function decodeSavedAppsDifference(data: Uint8Array): SavedAppsDifference {
  const r = new Reader(data)
  const result: SavedAppsDifference = { apps: null, baseGeneration: 0n, baseCounter: 0n }

  r.fields((field, wire) => {
    if (field === 1 && wire === 2) result.apps = decodeDifference(r.bytes())
    else if (field === 2 && wire === 0) result.baseGeneration = toInt64(r.varint())
    else if (field === 3 && wire === 0) result.baseCounter = toInt64(r.varint())
    else return false
    return true
  })

  return result
}

/** the Android client compresses with java.util.zip.DeflaterOutputStream (zlib format) */
export const inflate = (data: Uint8Array): Uint8Array => unzlibSync(data)

/** applies base + diff like DecryptProcessor.handleEncryptedApps */
export function mergeAppLists(base: InstalledAppsList, diff: InstalledAppsDifference | null): InstalledAppsList {
  const apps = new Map(base.apps.map((app) => [app.packageName, app]))
  let activities = [...base.activities]

  if (diff) {
    for (const name of diff.removedPackages) apps.delete(name)

    const removed = new Set(diff.removedActivities.map((item) => item.packageName + '\n' + item.className))
    activities = activities.filter((item) => !removed.has(item.packageName + '\n' + item.className))

    for (const app of diff.added?.apps ?? []) apps.set(app.packageName, app)
    activities.push(...(diff.added?.activities ?? []))
  }

  return { apps: [...apps.values()], activities }
}
