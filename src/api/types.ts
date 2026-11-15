// Types of the timelimit-server API (see src/object/serverdatastatus.ts,
// src/object/clientdatastatus.ts and src/api/schema.ts of the server).

export interface ServerDataStatus {
  devices?: ServerDeviceList
  devices2?: Array<ServerExtendedDeviceData>
  apps?: Array<ServerInstalledAppsData>
  rmCategories?: Array<string>
  categoryBase?: Array<ServerUpdatedCategoryBaseData>
  categoryApp?: Array<ServerUpdatedCategoryAssignedApps>
  usedTimes?: Array<ServerUpdatedCategoryUsedTimes>
  rules?: Array<ServerUpdatedTimeLimitRules>
  tasks?: Array<ServerUpdatedCategoryTasks>
  users?: ServerUserList
  krq?: Array<ServerKeyRequest>
  kr?: Array<ServerKeyResponse>
  pings?: Array<unknown>
  dh?: { v: string; k: string }
  u2f?: unknown
  fullVersion: number
  message?: string
  apiLevel: number
}

export interface ServerDeviceList {
  version: string
  data: Array<ServerDeviceData>
}

export interface ServerUserList {
  version: string
  data: Array<ServerUserEntry>
}

export interface ServerUserEntry {
  id: string
  name: string
  password: string
  secondPasswordSalt: string
  type: 'parent' | 'child'
  timeZone: string
  disableLimitsUntil: number
  mail: string
  currentDevice: string
  categoryForNotAssignedApps: string
  relaxPrimaryDevice: boolean
  mailNotificationFlags: number
  blockedTimes: string
  flags: number
  llc?: string
  pbd?: number
}

export type ProtectionLevel = 'none' | 'simple device admin' | 'password device admin' | 'device owner'
export type RuntimePermissionStatus = 'not granted' | 'granted' | 'not required'
export type NewPermissionStatus = 'not granted' | 'granted' | 'not supported'

export interface ServerDeviceData {
  deviceId: string
  name: string
  model: string
  addedAt: number
  currentUserId: string
  networkTime: 'disabled' | 'if possible' | 'enabled'
  cProtectionLevel: ProtectionLevel
  hProtectionLevel: ProtectionLevel
  cUsageStats: RuntimePermissionStatus
  hUsageStats: RuntimePermissionStatus
  cNotificationAccess: NewPermissionStatus
  hNotificationAccess: NewPermissionStatus
  cAppVersion: number
  hAppVersion: number
  tDisablingAdmin: boolean
  reboot: boolean
  hadManipulation: boolean
  hadManipulationFlags: number
  reportUninstall: boolean
  isUserKeptSignedIn: boolean
  showDeviceConnected: boolean
  defUser: string
  defUserTimeout: number
  rebootIsManipulation: boolean
  cOverlay: RuntimePermissionStatus
  hOverlay: RuntimePermissionStatus
  asEnabled: boolean
  wasAsEnabled: boolean
  activityLevelBlocking: boolean
  qOrLater: boolean
  mFlags: number
  pk?: string
  pType?: string
  pLevel: number
}

export interface ServerUpdatedCategoryBaseData {
  categoryId: string
  childId: string
  title: string
  blockedTimes: string
  extraTime: number
  extraTimeDay: number
  tempBlocked: boolean
  tempBlockTime: number
  version: string
  parentCategoryId: string
  blockAllNotifications: boolean
  timeWarnings: number
  mblCharging: number
  mblMobile: number
  sort: number
  networks: Array<{ itemId: string; hashedNetworkId: string }>
  dlu: number
  flags: number
  blockNotificationDelay: number
  atw: Array<number>
}

export interface ServerUpdatedCategoryAssignedApps {
  categoryId: string
  apps: Array<string>
  version: string
}

export interface ServerUsedTimeItem {
  day: number
  time: number
  start: number
  end: number
}

export interface ServerSessionDurationItem {
  md: number
  spd: number
  sm: number
  em: number
  l: number
  d: number
}

export interface ServerUpdatedCategoryUsedTimes {
  categoryId: string
  times: Array<ServerUsedTimeItem>
  sessionDurations: Array<ServerSessionDurationItem>
  version: string
}

export interface ServerTimeLimitRule {
  id: string
  extraTime: boolean
  dayMask: number
  maxTime: number
  start: number
  end: number
  session: number
  pause: number
  perDay: boolean
  e?: number
}

export interface ServerUpdatedTimeLimitRules {
  categoryId: string
  version: string
  rules: Array<ServerTimeLimitRule>
}

export interface ServerUpdatedCategoryTasks {
  categoryId: string
  version: string
  tasks: Array<{ i: string; t: string; d: number; p: boolean; l: number }>
}

export interface ServerInstalledAppsData {
  deviceId: string
  version: string
  apps: Array<{ packageName: string; title: string; isLaunchable: boolean; recommendation: string }>
  activities: Array<unknown>
}

export interface ServerCryptContainer {
  version: string
  data: string
}

export interface ServerExtendedDeviceData {
  deviceId: string
  appsBase?: ServerCryptContainer
  appsDiff?: ServerCryptContainer
}

export interface ServerKeyRequest {
  srvSeq: number
  senId: string
  senSeq: number
  deviceId?: string
  categoryId?: string
  type: number
  tempKey: string
  signature: string
}

export interface ServerKeyResponse {
  srvSeq: number
  sender: string
  rqSeq: number
  tempKey: string
  cryptKey: string
  signature: string
}

export interface CategoryDataStatus {
  base: string
  apps: string
  rules: string
  usedTime: string
  tasks?: string
}

export interface ClientDataStatus {
  devices: string
  apps: Record<string, string>
  categories: Record<string, CategoryDataStatus>
  users: string
  clientLevel?: number
  devicesDetail?: Record<string, { appsB?: string; appsD?: string }>
  kri?: number
  kr?: number
  dh?: string
  u2f?: string
}

export interface ClientPushAction {
  encodedAction: string
  sequenceNumber: number
  integrity: string
  type: 'appLogic' | 'parent' | 'child'
  userId: string
}
