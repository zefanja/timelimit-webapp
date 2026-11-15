// Approximation of the TimeLimit logic for "used today" and "remaining today"
// (Android: logic/RemainingTime.kt). Parent categories are taken into
// account; sessions, blocked time areas of the user and network limits are not.

import { ServerTimeLimitRule, ServerUsedTimeItem } from '../api/types'
import { CategoryState, FamilyState } from '../state/familyState'
import { getLocalDateInfo, LocalDateInfo } from './time'
import { isBlockedAt } from './blockedTimes'

const FULL_DAY_START = 0
const FULL_DAY_END = 24 * 60 - 1

export function getUsedTimeOfDay(usedTimes: Array<ServerUsedTimeItem>, dayOfEpoch: number): number {
  return usedTimes
    .filter((item) => item.day === dayOfEpoch && item.start === FULL_DAY_START && item.end === FULL_DAY_END)
    .reduce((sum, item) => sum + item.time, 0)
}

function isRuleActive(rule: ServerTimeLimitRule, now: number) {
  return rule.e === undefined || rule.e === 0 || rule.e > now
}

function remainingByRules(
  usedTimes: Array<ServerUsedTimeItem>,
  rules: Array<ServerTimeLimitRule>,
  assumeMaximalExtraTime: boolean,
  firstDayOfWeekAsEpochDay: number,
  dayOfWeek: number,
): number | null {
  const values = rules
    .filter((rule) => !assumeMaximalExtraTime || rule.extraTime)
    .map((rule) => {
      let used = 0

      for (const item of usedTimes) {
        const doesWeekMatch = item.day >= firstDayOfWeekAsEpochDay && item.day <= firstDayOfWeekAsEpochDay + 6
        if (!doesWeekMatch) continue

        const itemDayOfWeek = item.day - firstDayOfWeekAsEpochDay
        const matches = rule.perDay ? itemDayOfWeek === dayOfWeek : (rule.dayMask & (1 << itemDayOfWeek)) !== 0

        if (matches && rule.start === item.start && rule.end === item.end) used += item.time
      }

      return Math.max(0, rule.maxTime - used)
    })

  return values.length === 0 ? null : Math.min(...values)
}

export interface RemainingTime {
  default: number
  includingExtraTime: number
}

export function getRemainingTime(
  category: CategoryState,
  date: LocalDateInfo,
  now: number,
): RemainingTime | null {
  const relatedRules = category.rules.filter(
    (rule) =>
      isRuleActive(rule, now) &&
      (rule.dayMask & (1 << date.dayOfWeek)) !== 0 &&
      date.minuteOfDay >= rule.start &&
      date.minuteOfDay <= rule.end,
  )

  const extraTime = category.base.extraTimeDay === -1 || category.base.extraTimeDay === date.dayOfEpoch ? category.base.extraTime : 0
  const firstDayOfWeek = date.dayOfEpoch - date.dayOfWeek

  const withoutExtra = remainingByRules(category.usedTimes, relatedRules, false, firstDayOfWeek, date.dayOfWeek)
  const withExtra = remainingByRules(category.usedTimes, relatedRules, true, firstDayOfWeek, date.dayOfWeek)

  if (withoutExtra === null) return null

  if (withExtra !== null) {
    const additional = Math.max(0, withExtra - withoutExtra)
    return { default: withoutExtra, includingExtraTime: withoutExtra + Math.min(extraTime, additional) }
  }

  return { default: withoutExtra, includingExtraTime: withoutExtra + extraTime }
}

export type CategoryStatus =
  | { kind: 'limitsDisabled'; until: number }
  | { kind: 'temporarilyBlocked'; until: number | null }
  | { kind: 'blockedTime' }
  | { kind: 'timeOver' }
  | { kind: 'ok'; remaining: number | null }

export interface CategorySummary {
  categoryId: string
  title: string
  usedToday: number
  remaining: RemainingTime | null
  extraTime: number
  status: CategoryStatus
}

export function summarizeCategory(state: FamilyState, category: CategoryState, timeZone: string, now: number = Date.now()): CategorySummary {
  const date = getLocalDateInfo(now, timeZone)
  const child = state.users.find((user) => user.id === category.base.childId)

  let remaining = getRemainingTime(category, date, now)

  // a parent category can restrict further
  const parent = category.base.parentCategoryId ? state.categories[category.base.parentCategoryId] : undefined
  if (parent && parent.base.childId === category.base.childId) {
    const parentRemaining = getRemainingTime(parent, date, now)
    if (parentRemaining) {
      remaining = remaining
        ? {
            default: Math.min(remaining.default, parentRemaining.default),
            includingExtraTime: Math.min(remaining.includingExtraTime, parentRemaining.includingExtraTime),
          }
        : parentRemaining
    }
  }

  const extraTime =
    category.base.extraTimeDay === -1 || category.base.extraTimeDay === date.dayOfEpoch ? category.base.extraTime : 0

  let status: CategoryStatus
  const userLimitsDisabled = child && child.disableLimitsUntil > now ? child.disableLimitsUntil : 0
  const categoryLimitsDisabled = category.base.dlu > now ? category.base.dlu : 0

  if (userLimitsDisabled || categoryLimitsDisabled) {
    status = { kind: 'limitsDisabled', until: Math.max(userLimitsDisabled, categoryLimitsDisabled) }
  } else if (category.base.tempBlocked && (category.base.tempBlockTime === 0 || category.base.tempBlockTime > now)) {
    status = { kind: 'temporarilyBlocked', until: category.base.tempBlockTime || null }
  } else if (
    isBlockedAt(category.base.blockedTimes, date.minuteOfWeek) ||
    (parent && isBlockedAt(parent.base.blockedTimes, date.minuteOfWeek))
  ) {
    status = { kind: 'blockedTime' }
  } else if (remaining && remaining.includingExtraTime <= 0) {
    status = { kind: 'timeOver' }
  } else {
    status = { kind: 'ok', remaining: remaining ? remaining.includingExtraTime : null }
  }

  return {
    categoryId: category.base.categoryId,
    title: category.base.title,
    usedToday: getUsedTimeOfDay(category.usedTimes, date.dayOfEpoch),
    remaining,
    extraTime,
    status,
  }
}
