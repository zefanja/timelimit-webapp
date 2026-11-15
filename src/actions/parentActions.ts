// Typed builders for parent actions. Field names follow
// src/action/*.ts (Serialized*Action) of timelimit-server.

import { ParentPasswordPayload } from '../crypto/password'

export interface SerializedTimeLimitRule {
  ruleId: string
  categoryId: string
  time: number // maximum time in ms
  days: number // day mask, bit 0 = monday
  extraTime: boolean // apply to extra time usage
  start?: number // minute of day
  end?: number // minute of day
  dur?: number // session duration ms
  pause?: number // session pause ms
  perDay?: boolean
  e?: number // expires at (timestamp)
}

export type ParentAction =
  | { type: 'ADD_USER'; name: string; userType: 'parent' | 'child'; userId: string; password?: ParentPasswordPayload; timeZone: string }
  | { type: 'REMOVE_USER'; userId: string; authentication?: string }
  | { type: 'RENAME_CHILD'; childId: string; newName: string }
  | { type: 'SET_DEVICE_USER'; deviceId: string; userId: string }
  | { type: 'CREATE_CATEGORY'; childId: string; categoryId: string; title: string }
  | { type: 'DELETE_CATEGORY'; categoryId: string }
  | { type: 'UPDATE_CATEGORY_TITLE'; categoryId: string; newTitle: string }
  | { type: 'ADD_CATEGORY_APPS'; categoryId: string; packageNames: Array<string> }
  | { type: 'REMOVE_CATEGORY_APPS'; categoryId: string; packageNames: Array<string> }
  | { type: 'SET_CATEGORY_FOR_UNASSIGNED_APPS'; childId: string; categoryId: string }
  | { type: 'CREATE_TIMELIMIT_RULE'; rule: SerializedTimeLimitRule }
  | ({ type: 'UPDATE_TIMELIMIT_RULE' } & Omit<SerializedTimeLimitRule, 'categoryId'>)
  | { type: 'DELETE_TIMELIMIT_RULE'; ruleId: string }
  | { type: 'UPDATE_CATEGORY_BLOCKED_TIMES'; categoryId: string; times: string }
  | { type: 'INCREMENT_CATEGORY_EXTRATIME'; categoryId: string; addedExtraTime: number; day?: number }
  | { type: 'SET_CATEGORY_EXTRA_TIME'; categoryId: string; newExtraTime: number; day?: number }
  | { type: 'UPDATE_CATEGORY_TEMPORARILY_BLOCKED'; categoryId: string; blocked: boolean; endTime?: number }
  | { type: 'UPDATE_CATEGORY_DISABLE_LIMITS'; categoryId: string; endTime: number }
  | { type: 'SET_USER_DISABLE_LIMITS_UNTIL'; childId: string; time: number }
  | { type: 'UPDATE_DEVICE_NAME'; deviceId: string; name: string }
  | {
      type: 'IGNORE_MANIPULATION'
      deviceId: string
      admin: boolean
      adminA: boolean
      downgrade: boolean
      notification: boolean
      usageStats: boolean
      hadManipulation: boolean
      reboot?: boolean
      overlay?: boolean
      accessibilityService?: boolean
      ignoreHadManipulationFlags?: number
      ignoreManipulationFlags?: number
    }
  | { type: 'SET_PARENT_CATEGORY'; categoryId: string; parentCategory: string }
  | { type: 'CHANGE_PARENT_PASSWORD'; userId: string; hash: string; secondSalt: string; secondHashEncrypted: string; integrity: string }

export type AppLogicAction =
  | { type: 'UPLOAD_DEVICE_PUBLIC_KEY'; key: string }
  | {
      type: 'SEND_KEY_REQUEST'
      dsn: number
      deviceId?: string
      categoryId?: string
      dataType: number
      tempKey: string
      signature: string
    }
  | { type: 'FINISH_KEY_REQUEST'; dsn: number }

const MINUTES_PER_DAY = 24 * 60

/** helpers so that UI code does not need to know the field names */
export const actions = {
  addChild: (p: { userId: string; name: string; timeZone: string }): ParentAction => ({
    type: 'ADD_USER',
    name: p.name,
    userType: 'child',
    userId: p.userId,
    timeZone: p.timeZone,
  }),
  removeUser: (userId: string): ParentAction => ({ type: 'REMOVE_USER', userId }),
  renameChild: (childId: string, newName: string): ParentAction => ({ type: 'RENAME_CHILD', childId, newName }),
  setDeviceUser: (deviceId: string, userId: string): ParentAction => ({ type: 'SET_DEVICE_USER', deviceId, userId }),
  createCategory: (p: { childId: string; categoryId: string; title: string }): ParentAction => ({ type: 'CREATE_CATEGORY', ...p }),
  deleteCategory: (categoryId: string): ParentAction => ({ type: 'DELETE_CATEGORY', categoryId }),
  renameCategory: (categoryId: string, newTitle: string): ParentAction => ({ type: 'UPDATE_CATEGORY_TITLE', categoryId, newTitle }),
  addCategoryApps: (categoryId: string, packageNames: Array<string>): ParentAction => ({
    type: 'ADD_CATEGORY_APPS',
    categoryId,
    packageNames: [...new Set(packageNames)],
  }),
  removeCategoryApps: (categoryId: string, packageNames: Array<string>): ParentAction => ({
    type: 'REMOVE_CATEGORY_APPS',
    categoryId,
    packageNames: [...new Set(packageNames)],
  }),
  setCategoryForUnassignedApps: (childId: string, categoryId: string): ParentAction => ({
    type: 'SET_CATEGORY_FOR_UNASSIGNED_APPS',
    childId,
    categoryId,
  }),
  createRule: (rule: SerializedTimeLimitRule): ParentAction => ({ type: 'CREATE_TIMELIMIT_RULE', rule: normalizeRule(rule) }),
  updateRule: (rule: Omit<SerializedTimeLimitRule, 'categoryId'>): ParentAction => {
    const { categoryId: _ignored, ...rest } = normalizeRule({ ...rule, categoryId: '' })
    return { type: 'UPDATE_TIMELIMIT_RULE', ...rest }
  },
  deleteRule: (ruleId: string): ParentAction => ({ type: 'DELETE_TIMELIMIT_RULE', ruleId }),
  setBlockedTimes: (categoryId: string, times: string): ParentAction => ({ type: 'UPDATE_CATEGORY_BLOCKED_TIMES', categoryId, times }),
  incrementExtraTime: (categoryId: string, addedExtraTime: number, day: number = -1): ParentAction => ({
    type: 'INCREMENT_CATEGORY_EXTRATIME',
    categoryId,
    addedExtraTime,
    day,
  }),
  setExtraTime: (categoryId: string, newExtraTime: number, day: number = -1): ParentAction => ({
    type: 'SET_CATEGORY_EXTRA_TIME',
    categoryId,
    newExtraTime,
    day,
  }),
  setTemporarilyBlocked: (categoryId: string, blocked: boolean, endTime?: number): ParentAction =>
    blocked && endTime !== undefined
      ? { type: 'UPDATE_CATEGORY_TEMPORARILY_BLOCKED', categoryId, blocked, endTime }
      : { type: 'UPDATE_CATEGORY_TEMPORARILY_BLOCKED', categoryId, blocked },
  setCategoryDisableLimits: (categoryId: string, endTime: number): ParentAction => ({
    type: 'UPDATE_CATEGORY_DISABLE_LIMITS',
    categoryId,
    endTime,
  }),
  setUserDisableLimitsUntil: (childId: string, time: number): ParentAction => ({ type: 'SET_USER_DISABLE_LIMITS_UNTIL', childId, time }),
  renameDevice: (deviceId: string, name: string): ParentAction => ({ type: 'UPDATE_DEVICE_NAME', deviceId, name }),
  ignoreAllManipulation: (deviceId: string): ParentAction => ({
    type: 'IGNORE_MANIPULATION',
    deviceId,
    admin: true,
    adminA: true,
    downgrade: true,
    notification: true,
    usageStats: true,
    hadManipulation: true,
    reboot: true,
    overlay: true,
    accessibilityService: true,
    ignoreHadManipulationFlags: 0,
    ignoreManipulationFlags: 0,
  }),
}

function normalizeRule(rule: SerializedTimeLimitRule): SerializedTimeLimitRule {
  const start = rule.start ?? 0
  const end = rule.end ?? MINUTES_PER_DAY - 1

  const result: SerializedTimeLimitRule = {
    ruleId: rule.ruleId,
    categoryId: rule.categoryId,
    time: Math.max(0, Math.round(rule.time)),
    days: rule.days & 127,
    extraTime: rule.extraTime,
    start,
    end,
    dur: rule.dur ?? 0,
    pause: rule.pause ?? 0,
    perDay: rule.perDay ?? false,
  }

  if (rule.e !== undefined) result.e = rule.e

  return result
}

export function describeAction(action: ParentAction): string {
  switch (action.type) {
    case 'ADD_USER': return `Benutzer „${action.name}“ anlegen`
    case 'REMOVE_USER': return 'Benutzer löschen'
    case 'RENAME_CHILD': return `Kind umbenennen in „${action.newName}“`
    case 'SET_DEVICE_USER': return 'Gerät zuweisen'
    case 'CREATE_CATEGORY': return `Kategorie „${action.title}“ anlegen`
    case 'DELETE_CATEGORY': return 'Kategorie löschen'
    case 'UPDATE_CATEGORY_TITLE': return `Kategorie umbenennen in „${action.newTitle}“`
    case 'ADD_CATEGORY_APPS': return `${action.packageNames.length} App(s) zuordnen`
    case 'REMOVE_CATEGORY_APPS': return `${action.packageNames.length} App(s) entfernen`
    case 'SET_CATEGORY_FOR_UNASSIGNED_APPS': return 'Standardkategorie setzen'
    case 'CREATE_TIMELIMIT_RULE': return 'Regel anlegen'
    case 'UPDATE_TIMELIMIT_RULE': return 'Regel ändern'
    case 'DELETE_TIMELIMIT_RULE': return 'Regel löschen'
    case 'UPDATE_CATEGORY_BLOCKED_TIMES': return 'Sperrzeiten ändern'
    case 'INCREMENT_CATEGORY_EXTRATIME': return `+${Math.round(action.addedExtraTime / 60000)} min Extrazeit`
    case 'SET_CATEGORY_EXTRA_TIME': return 'Extrazeit setzen'
    case 'UPDATE_CATEGORY_TEMPORARILY_BLOCKED': return action.blocked ? 'Sofort sperren' : 'Sperre aufheben'
    case 'UPDATE_CATEGORY_DISABLE_LIMITS': return 'Limits der Kategorie pausieren'
    case 'SET_USER_DISABLE_LIMITS_UNTIL': return 'Limits des Kindes pausieren'
    case 'UPDATE_DEVICE_NAME': return `Gerät umbenennen in „${action.name}“`
    case 'IGNORE_MANIPULATION': return 'Manipulationswarnung ignorieren'
    case 'SET_PARENT_CATEGORY': return 'Übergeordnete Kategorie setzen'
    case 'CHANGE_PARENT_PASSWORD': return 'Elternpasswort ändern'
  }
}
