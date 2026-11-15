// "blocked times" are a bitmask over the minutes of a week (monday 00:00 = 0,
// length 7 * 24 * 60). Serialized as sorted split points "start,end,start,end"
// where each pair is a half-open range [start, end).

export const MINUTES_PER_WEEK = 7 * 24 * 60

export function parseBlockedTimes(serialized: string, length: number = MINUTES_PER_WEEK): Uint8Array {
  const result = new Uint8Array(length)
  if (serialized === '') return result

  const points = serialized.split(',').map((item) => parseInt(item, 10))

  for (let i = 0; i + 1 < points.length; i += 2) {
    const start = Math.max(0, points[i])
    const end = Math.min(length, points[i + 1])
    for (let j = start; j < end; j++) result[j] = 1
  }

  return result
}

export function serializeBlockedTimes(bitmask: Uint8Array): string {
  const points: Array<number> = []
  let inRange = false

  for (let i = 0; i < bitmask.length; i++) {
    if (bitmask[i] && !inRange) {
      points.push(i)
      inRange = true
    } else if (!bitmask[i] && inRange) {
      points.push(i)
      inRange = false
    }
  }

  if (inRange) points.push(bitmask.length)

  return points.join(',')
}

export function setRange(bitmask: Uint8Array, start: number, end: number, value: boolean): Uint8Array {
  const copy = new Uint8Array(bitmask)
  for (let i = Math.max(0, start); i < Math.min(copy.length, end); i++) copy[i] = value ? 1 : 0
  return copy
}

/** share of blocked minutes in [start, end): 0 = free, 1 = fully blocked */
export function blockedShare(bitmask: Uint8Array, start: number, end: number): number {
  let count = 0
  for (let i = start; i < end; i++) count += bitmask[i]
  return count / (end - start)
}

export function isBlockedAt(serialized: string, minuteOfWeek: number): boolean {
  return parseBlockedTimes(serialized)[minuteOfWeek] === 1
}
