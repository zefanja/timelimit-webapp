import { describe, expect, it } from 'vitest'
import { actions } from '../src/actions/parentActions'
import { ServerDataStatus, ServerUpdatedCategoryBaseData } from '../src/api/types'
import { blockedShare, MINUTES_PER_WEEK, parseBlockedTimes, serializeBlockedTimes, setRange } from '../src/logic/blockedTimes'
import { applyParentActionLocally } from '../src/logic/optimistic'
import { getRemainingTime, getUsedTimeOfDay, summarizeCategory } from '../src/logic/remainingTime'
import { getLocalDateInfo } from '../src/logic/time'
import { applyServerDataStatus, buildClientDataStatus, emptyFamilyState } from '../src/state/familyState'
import { hasServerBuild, requireFromServer } from './helpers'

const base = (patch: Partial<ServerUpdatedCategoryBaseData> = {}): ServerUpdatedCategoryBaseData => ({
  categoryId: 'cat001',
  childId: 'kid001',
  title: 'Spiele',
  blockedTimes: '',
  extraTime: 0,
  extraTimeDay: -1,
  tempBlocked: false,
  tempBlockTime: 0,
  version: 'v1',
  parentCategoryId: '',
  blockAllNotifications: false,
  timeWarnings: 0,
  mblCharging: 0,
  mblMobile: 0,
  sort: 0,
  networks: [],
  dlu: 0,
  flags: 0,
  blockNotificationDelay: 0,
  atw: [],
  ...patch,
})

describe('blocked times', () => {
  it('round trips', () => {
    let mask: Uint8Array = new Uint8Array(MINUTES_PER_WEEK)
    mask = setRange(mask, 0, 60, true)
    mask = setRange(mask, 1200, 1440, true)
    mask = setRange(mask, MINUTES_PER_WEEK - 10, MINUTES_PER_WEEK, true)
    const serialized = serializeBlockedTimes(mask)
    expect(serialized).toBe(`0,60,1200,1440,${MINUTES_PER_WEEK - 10},${MINUTES_PER_WEEK}`)
    expect(parseBlockedTimes(serialized)).toEqual(mask)
    expect(blockedShare(mask, 0, 120)).toBe(0.5)
    expect(serializeBlockedTimes(new Uint8Array(MINUTES_PER_WEEK))).toBe('')
  })

  it.skipIf(!hasServerBuild)('is accepted by the server bitmask validator', () => {
    const { validateBitmask } = requireFromServer('build/util/bitmask.js')
    const mask = setRange(setRange(new Uint8Array(MINUTES_PER_WEEK), 5, 100, true), MINUTES_PER_WEEK - 1, MINUTES_PER_WEEK, true)
    expect(() => validateBitmask(serializeBlockedTimes(mask), MINUTES_PER_WEEK)).not.toThrow()
  })
})

describe('time', () => {
  it('computes the local day like the Android client', () => {
    // 2024-01-01 is a monday; 23:30 UTC on sunday 2023-12-31 is monday 00:30 in Berlin
    const info = getLocalDateInfo(Date.UTC(2023, 11, 31, 23, 30), 'Europe/Berlin')
    expect(info.dayOfWeek).toBe(0)
    expect(info.dayOfEpoch).toBe(19723)
    expect(info.minuteOfDay).toBe(30)
    expect(info.minuteOfWeek).toBe(30)
  })
})

describe('remaining time', () => {
  const now = Date.UTC(2024, 0, 3, 12, 0) // wednesday, 13:00 Berlin
  const date = getLocalDateInfo(now, 'Europe/Berlin')

  const category = {
    base: base(),
    apps: [],
    rules: [
      { id: 'rule01', extraTime: false, dayMask: 127, maxTime: 60 * 60_000, start: 0, end: 1439, session: 0, pause: 0, perDay: true },
      { id: 'rule02', extraTime: false, dayMask: 31, maxTime: 3 * 60 * 60_000, start: 0, end: 1439, session: 0, pause: 0, perDay: false },
    ],
    usedTimes: [
      { day: date.dayOfEpoch, time: 20 * 60_000, start: 0, end: 1439 },
      { day: date.dayOfEpoch - 1, time: 150 * 60_000, start: 0, end: 1439 },
      { day: date.dayOfEpoch - 7, time: 999 * 60_000, start: 0, end: 1439 }, // last week
    ],
    sessionDurations: [],
    versions: { base: '', apps: '', rules: '', usedTime: '' },
  }

  it('uses daily and weekly rules', () => {
    expect(getUsedTimeOfDay(category.usedTimes, date.dayOfEpoch)).toBe(20 * 60_000)
    // daily: 60 - 20 = 40; weekly (mo-fr): 180 - 170 = 10
    expect(getRemainingTime(category, date, now)).toEqual({ default: 10 * 60_000, includingExtraTime: 10 * 60_000 })
  })

  it('adds extra time of today', () => {
    const withExtra = { ...category, base: base({ extraTime: 15 * 60_000, extraTimeDay: date.dayOfEpoch }) }
    expect(getRemainingTime(withExtra, date, now)?.includingExtraTime).toBe(25 * 60_000)
    const old = { ...category, base: base({ extraTime: 15 * 60_000, extraTimeDay: date.dayOfEpoch - 1 }) }
    expect(getRemainingTime(old, date, now)?.includingExtraTime).toBe(10 * 60_000)
  })

  it('reports temporary blocks', () => {
    let state = emptyFamilyState()
    state = { ...state, categories: { cat001: { ...category, base: base({ tempBlocked: true }) } } }
    expect(summarizeCategory(state, state.categories.cat001, 'Europe/Berlin', now).status.kind).toBe('temporarilyBlocked')
  })
})

describe('family state', () => {
  const status: ServerDataStatus = {
    fullVersion: 1,
    apiLevel: 9,
    users: { version: 'u1', data: [] },
    devices: { version: 'd1', data: [] },
    categoryBase: [base()],
    categoryApp: [{ categoryId: 'cat001', apps: ['a.b'], version: 'a1' }],
    rules: [{ categoryId: 'cat001', rules: [], version: 'r1' }],
    usedTimes: [{ categoryId: 'cat001', times: [], sessionDurations: [], version: 't1' }],
  }

  it('merges incrementally and reports versions', () => {
    let state = applyServerDataStatus(emptyFamilyState(), status)
    expect(buildClientDataStatus(state).categories).toEqual({ cat001: { base: 'v1', apps: 'a1', rules: 'r1', usedTime: 't1', tasks: '' } })

    state = applyServerDataStatus(state, { fullVersion: 1, apiLevel: 9, categoryApp: [{ categoryId: 'cat001', apps: [], version: 'a2' }] })
    expect(state.categories.cat001.apps).toEqual([])
    expect(state.categories.cat001.versions.rules).toBe('r1')
    expect(state.usersVersion).toBe('u1')

    state = applyServerDataStatus(state, { fullVersion: 1, apiLevel: 9, rmCategories: ['cat001'] })
    expect(state.categories).toEqual({})
  })

  it('applies optimistic changes', () => {
    let state = applyServerDataStatus(emptyFamilyState(), status)
    state = applyParentActionLocally(state, actions.incrementExtraTime('cat001', 60_000, 100))
    state = applyParentActionLocally(state, actions.incrementExtraTime('cat001', 60_000, 100))
    expect(state.categories.cat001.base.extraTime).toBe(120_000)
    state = applyParentActionLocally(state, actions.incrementExtraTime('cat001', 60_000, 101))
    expect(state.categories.cat001.base.extraTime).toBe(60_000)

    state = applyParentActionLocally(state, actions.createCategory({ childId: 'kid001', categoryId: 'cat002', title: 'Lernen' }))
    state = applyParentActionLocally(state, actions.addCategoryApps('cat002', ['a.b']))
    expect(state.categories.cat001.apps).toEqual([])
    expect(state.categories.cat002.apps).toEqual(['a.b'])
  })
})
