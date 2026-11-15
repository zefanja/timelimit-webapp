// Applies pending (not yet confirmed) parent actions to a copy of the
// confirmed state, so that the UI can show changes immediately.
// The confirmed state from the server always wins after the next pull.

import { ParentAction } from '../actions/parentActions'
import { ServerUpdatedCategoryBaseData } from '../api/types'
import { CategoryState, FamilyState } from '../state/familyState'

function updateCategory(state: FamilyState, categoryId: string, update: (category: CategoryState) => CategoryState): FamilyState {
  const category = state.categories[categoryId]
  if (!category) return state
  return { ...state, categories: { ...state.categories, [categoryId]: update(category) } }
}

function updateBase(state: FamilyState, categoryId: string, patch: Partial<ServerUpdatedCategoryBaseData>): FamilyState {
  return updateCategory(state, categoryId, (category) => ({ ...category, base: { ...category.base, ...patch } }))
}

export function applyParentActionLocally(state: FamilyState, action: ParentAction): FamilyState {
  switch (action.type) {
    case 'ADD_USER':
      if (state.users.some((user) => user.id === action.userId)) return state
      return {
        ...state,
        users: [
          ...state.users,
          {
            id: action.userId,
            name: action.name,
            password: action.password?.hash ?? '',
            secondPasswordSalt: action.password?.secondSalt ?? '',
            type: action.userType,
            timeZone: action.timeZone,
            disableLimitsUntil: 0,
            mail: '',
            currentDevice: '',
            categoryForNotAssignedApps: '',
            relaxPrimaryDevice: false,
            mailNotificationFlags: 0,
            blockedTimes: '',
            flags: 0,
          },
        ],
      }
    case 'REMOVE_USER': {
      const categories = Object.fromEntries(
        Object.entries(state.categories).filter(([, category]) => category.base.childId !== action.userId),
      )
      return { ...state, users: state.users.filter((user) => user.id !== action.userId), categories }
    }
    case 'RENAME_CHILD':
      return { ...state, users: state.users.map((user) => (user.id === action.childId ? { ...user, name: action.newName } : user)) }
    case 'SET_DEVICE_USER':
      return {
        ...state,
        devices: state.devices.map((device) => (device.deviceId === action.deviceId ? { ...device, currentUserId: action.userId } : device)),
      }
    case 'CREATE_CATEGORY': {
      if (state.categories[action.categoryId]) return state
      const sort = Math.max(-1, ...Object.values(state.categories).filter((c) => c.base.childId === action.childId).map((c) => c.base.sort)) + 1
      const base: ServerUpdatedCategoryBaseData = {
        categoryId: action.categoryId,
        childId: action.childId,
        title: action.title,
        blockedTimes: '',
        extraTime: 0,
        extraTimeDay: -1,
        tempBlocked: false,
        tempBlockTime: 0,
        version: '',
        parentCategoryId: '',
        blockAllNotifications: false,
        timeWarnings: 0,
        mblCharging: 0,
        mblMobile: 0,
        sort,
        networks: [],
        dlu: 0,
        flags: 0,
        blockNotificationDelay: 0,
        atw: [],
      }
      return {
        ...state,
        categories: {
          ...state.categories,
          [action.categoryId]: {
            base,
            apps: [],
            rules: [],
            usedTimes: [],
            sessionDurations: [],
            versions: { base: '', apps: '', rules: '', usedTime: '', tasks: '' },
          },
        },
      }
    }
    case 'DELETE_CATEGORY': {
      const categories = { ...state.categories }
      delete categories[action.categoryId]
      return { ...state, categories }
    }
    case 'UPDATE_CATEGORY_TITLE':
      return updateBase(state, action.categoryId, { title: action.newTitle })
    case 'ADD_CATEGORY_APPS': {
      const category = state.categories[action.categoryId]
      if (!category) return state
      const added = new Set(action.packageNames)
      // an app can only be in one category of a child
      let next = state
      for (const other of Object.values(state.categories)) {
        if (other.base.childId === category.base.childId && other.base.categoryId !== action.categoryId) {
          if (other.apps.some((app) => added.has(app))) {
            next = updateCategory(next, other.base.categoryId, (c) => ({ ...c, apps: c.apps.filter((app) => !added.has(app)) }))
          }
        }
      }
      return updateCategory(next, action.categoryId, (c) => ({ ...c, apps: [...new Set([...c.apps, ...action.packageNames])] }))
    }
    case 'REMOVE_CATEGORY_APPS': {
      const removed = new Set(action.packageNames)
      return updateCategory(state, action.categoryId, (c) => ({ ...c, apps: c.apps.filter((app) => !removed.has(app)) }))
    }
    case 'SET_CATEGORY_FOR_UNASSIGNED_APPS':
      return {
        ...state,
        users: state.users.map((user) => (user.id === action.childId ? { ...user, categoryForNotAssignedApps: action.categoryId } : user)),
      }
    case 'CREATE_TIMELIMIT_RULE': {
      const rule = action.rule
      return updateCategory(state, rule.categoryId, (c) => ({
        ...c,
        rules: [
          ...c.rules.filter((r) => r.id !== rule.ruleId),
          {
            id: rule.ruleId,
            extraTime: rule.extraTime,
            dayMask: rule.days,
            maxTime: rule.time,
            start: rule.start ?? 0,
            end: rule.end ?? 1439,
            session: rule.dur ?? 0,
            pause: rule.pause ?? 0,
            perDay: rule.perDay ?? false,
            ...(rule.e !== undefined ? { e: rule.e } : {}),
          },
        ],
      }))
    }
    case 'UPDATE_TIMELIMIT_RULE': {
      const entry = Object.values(state.categories).find((c) => c.rules.some((r) => r.id === action.ruleId))
      if (!entry) return state
      return updateCategory(state, entry.base.categoryId, (c) => ({
        ...c,
        rules: c.rules.map((r) =>
          r.id === action.ruleId
            ? {
                ...r,
                extraTime: action.extraTime,
                dayMask: action.days,
                maxTime: action.time,
                start: action.start ?? r.start,
                end: action.end ?? r.end,
                session: action.dur ?? r.session,
                pause: action.pause ?? r.pause,
                perDay: action.perDay ?? r.perDay,
              }
            : r,
        ),
      }))
    }
    case 'DELETE_TIMELIMIT_RULE': {
      const entry = Object.values(state.categories).find((c) => c.rules.some((r) => r.id === action.ruleId))
      if (!entry) return state
      return updateCategory(state, entry.base.categoryId, (c) => ({ ...c, rules: c.rules.filter((r) => r.id !== action.ruleId) }))
    }
    case 'UPDATE_CATEGORY_BLOCKED_TIMES':
      return updateBase(state, action.categoryId, { blockedTimes: action.times })
    case 'INCREMENT_CATEGORY_EXTRATIME': {
      const category = state.categories[action.categoryId]
      if (!category) return state
      const day = action.day ?? -1
      const keep = day === category.base.extraTimeDay || category.base.extraTimeDay === -1
      return updateBase(state, action.categoryId, {
        extraTime: (keep ? category.base.extraTime : 0) + action.addedExtraTime,
        extraTimeDay: day,
      })
    }
    case 'SET_CATEGORY_EXTRA_TIME':
      return updateBase(state, action.categoryId, { extraTime: action.newExtraTime, extraTimeDay: action.day ?? -1 })
    case 'UPDATE_CATEGORY_TEMPORARILY_BLOCKED':
      return updateBase(state, action.categoryId, { tempBlocked: action.blocked, tempBlockTime: action.blocked ? action.endTime ?? 0 : 0 })
    case 'UPDATE_CATEGORY_DISABLE_LIMITS':
      return updateBase(state, action.categoryId, { dlu: action.endTime })
    case 'SET_USER_DISABLE_LIMITS_UNTIL':
      return { ...state, users: state.users.map((user) => (user.id === action.childId ? { ...user, disableLimitsUntil: action.time } : user)) }
    case 'UPDATE_DEVICE_NAME':
      return { ...state, devices: state.devices.map((device) => (device.deviceId === action.deviceId ? { ...device, name: action.name } : device)) }
    case 'IGNORE_MANIPULATION':
      return {
        ...state,
        devices: state.devices.map((device) =>
          device.deviceId === action.deviceId ? { ...device, hadManipulation: false, hadManipulationFlags: 0 } : device,
        ),
      }
    case 'SET_PARENT_CATEGORY':
      return updateBase(state, action.categoryId, { parentCategoryId: action.parentCategory })
    case 'CHANGE_PARENT_PASSWORD':
      return state
  }
}
