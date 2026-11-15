// Local copy of the family data, built from pull-status responses with
// incremental merging (the server only sends what changed since the versions
// we report in the next request).

import {
  ClientDataStatus,
  ServerDataStatus,
  ServerDeviceData,
  ServerSessionDurationItem,
  ServerTimeLimitRule,
  ServerUpdatedCategoryBaseData,
  ServerUsedTimeItem,
  ServerUserEntry,
} from '../api/types'

export interface CategoryState {
  base: ServerUpdatedCategoryBaseData
  apps: Array<string>
  rules: Array<ServerTimeLimitRule>
  usedTimes: Array<ServerUsedTimeItem>
  sessionDurations: Array<ServerSessionDurationItem>
  versions: { base: string; apps: string; rules: string; usedTime: string; tasks?: string }
}

export interface FamilyState {
  users: Array<ServerUserEntry>
  usersVersion: string
  devices: Array<ServerDeviceData>
  devicesVersion: string
  categories: Record<string, CategoryState>
  fullVersion: number
  apiLevel: number
  message: string | null
  lastSyncAt: number | null
}

export const emptyFamilyState = (): FamilyState => ({
  users: [],
  usersVersion: '',
  devices: [],
  devicesVersion: '',
  categories: {},
  fullVersion: 0,
  apiLevel: 0,
  message: null,
  lastSyncAt: null,
})

/**
 * Highest client level the server code knows (get-server-data-status):
 *  3 tasks, 4 encrypted app lists, 5 DH, 6 U2F, 7 ping, 8 "750 or newer".
 * Level 8 only affects the server campaign message; the web app does not
 * implement DH/U2F/ping, but reporting a level only adds data to the
 * response, which is ignored when not needed.
 */
export const CLIENT_LEVEL = 8

export function buildClientDataStatus(
  state: FamilyState,
  extra: { kri?: number | null; kr?: number | null; devicesDetail?: Record<string, { appsB?: string; appsD?: string }> } = {},
): ClientDataStatus {
  const categories: ClientDataStatus['categories'] = {}

  for (const [categoryId, category] of Object.entries(state.categories)) {
    categories[categoryId] = { ...category.versions }
  }

  const result: ClientDataStatus = {
    devices: state.devicesVersion,
    apps: {},
    categories,
    users: state.usersVersion,
    clientLevel: CLIENT_LEVEL,
  }

  if (extra.devicesDetail && Object.keys(extra.devicesDetail).length > 0) result.devicesDetail = extra.devicesDetail
  if (extra.kri !== undefined && extra.kri !== null) result.kri = extra.kri
  if (extra.kr !== undefined && extra.kr !== null) result.kr = extra.kr

  return result
}

const emptyCategory = (base: ServerUpdatedCategoryBaseData): CategoryState => ({
  base,
  apps: [],
  rules: [],
  usedTimes: [],
  sessionDurations: [],
  versions: { base: '', apps: '', rules: '', usedTime: '', tasks: '' },
})

/** returns a new state; the input is not modified */
export function applyServerDataStatus(previous: FamilyState, status: ServerDataStatus, now: number = Date.now()): FamilyState {
  const next: FamilyState = {
    ...previous,
    categories: { ...previous.categories },
    fullVersion: status.fullVersion,
    apiLevel: status.apiLevel,
    message: status.message ?? null,
    lastSyncAt: now,
  }

  if (status.users) {
    next.users = status.users.data
    next.usersVersion = status.users.version
  }

  if (status.devices) {
    next.devices = status.devices.data
    next.devicesVersion = status.devices.version
  }

  for (const categoryId of status.rmCategories ?? []) {
    delete next.categories[categoryId]
  }

  for (const base of status.categoryBase ?? []) {
    const old = next.categories[base.categoryId] ?? emptyCategory(base)
    next.categories[base.categoryId] = { ...old, base, versions: { ...old.versions, base: base.version } }
  }

  const withCategory = (categoryId: string, update: (category: CategoryState) => CategoryState) => {
    const old = next.categories[categoryId]
    // data for categories without base data is ignored; the next sync asks again
    if (old) next.categories[categoryId] = update(old)
  }

  for (const item of status.categoryApp ?? []) {
    withCategory(item.categoryId, (c) => ({ ...c, apps: item.apps, versions: { ...c.versions, apps: item.version } }))
  }

  for (const item of status.rules ?? []) {
    withCategory(item.categoryId, (c) => ({ ...c, rules: item.rules, versions: { ...c.versions, rules: item.version } }))
  }

  for (const item of status.usedTimes ?? []) {
    withCategory(item.categoryId, (c) => ({
      ...c,
      usedTimes: item.times,
      sessionDurations: item.sessionDurations,
      versions: { ...c.versions, usedTime: item.version },
    }))
  }

  for (const item of status.tasks ?? []) {
    withCategory(item.categoryId, (c) => ({ ...c, versions: { ...c.versions, tasks: item.version } }))
  }

  return next
}

// ---- selectors ----

export const getParents = (state: FamilyState) => state.users.filter((user) => user.type === 'parent')
export const getChildren = (state: FamilyState) => state.users.filter((user) => user.type === 'child')
export const getUser = (state: FamilyState, userId: string) => state.users.find((user) => user.id === userId)
export const getDevice = (state: FamilyState, deviceId: string) => state.devices.find((device) => device.deviceId === deviceId)

export function getCategoriesOfChild(state: FamilyState, childId: string): Array<CategoryState> {
  return Object.values(state.categories)
    .filter((category) => category.base.childId === childId)
    .sort((a, b) => a.base.sort - b.base.sort || a.base.title.localeCompare(b.base.title))
}

export function getDevicesOfUser(state: FamilyState, userId: string) {
  return state.devices.filter((device) => device.currentUserId === userId)
}

export const hasPremium = (state: FamilyState, now: number = Date.now()) =>
  state.fullVersion === 1 || state.fullVersion > now
