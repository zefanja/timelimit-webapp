// Date helpers in the child's time zone (Intl based, no dependencies).

export interface LocalDateInfo {
  year: number
  month: number // 1..12
  day: number
  hour: number
  minute: number
  dayOfWeek: number // 0 = monday … 6 = sunday (TimeLimit convention)
  dayOfEpoch: number // days since 1970-01-01 of the local date
  minuteOfDay: number
  minuteOfWeek: number
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone)
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
      })
    } catch {
      formatter = new Intl.DateTimeFormat('en-US', {
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
      })
    }
    formatterCache.set(timeZone, formatter)
  }
  return formatter
}

export function getLocalDateInfo(timestamp: number, timeZone: string): LocalDateInfo {
  const parts = getFormatter(timeZone).formatToParts(new Date(timestamp))
  const get = (type: string) => parseInt(parts.find((part) => part.type === type)?.value ?? '0', 10)

  const year = get('year')
  const month = get('month')
  const day = get('day')
  const hour = get('hour') % 24
  const minute = get('minute')

  const dayOfEpoch = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
  // 1970-01-01 was a thursday (= 3 in the monday based convention)
  const dayOfWeek = (((dayOfEpoch + 3) % 7) + 7) % 7
  const minuteOfDay = hour * 60 + minute

  return {
    year,
    month,
    day,
    hour,
    minute,
    dayOfWeek,
    dayOfEpoch,
    minuteOfDay,
    minuteOfWeek: dayOfWeek * 24 * 60 + minuteOfDay,
  }
}

export const browserTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin'
  } catch {
    return 'Europe/Berlin'
  }
}

export const WEEKDAYS_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
export const WEEKDAYS_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']

export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  if (minutes === 0) return `${hours} h`
  return `${hours} h ${minutes} min`
}

export function formatMinuteOfDay(minute: number): string {
  const h = Math.floor(minute / 60)
  const m = minute % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function parseTimeOfDay(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const h = parseInt(match[1], 10)
  const m = parseInt(match[2], 10)
  if (h > 23 || m > 59) return null
  return h * 60 + m
}

export function formatDayMask(mask: number): string {
  if ((mask & 127) === 127) return 'täglich'
  if ((mask & 127) === 31) return 'Mo–Fr'
  if ((mask & 127) === 96) return 'Sa–So'
  if ((mask & 127) === 0) return 'nie'
  return WEEKDAYS_SHORT.filter((_, index) => (mask & (1 << index)) !== 0).join(', ')
}

export function formatTimestamp(timestamp: number): string {
  if (!timestamp) return '–'
  return new Date(timestamp).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
}
