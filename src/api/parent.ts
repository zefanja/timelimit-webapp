import { ApiClient } from './client'
import { ParentPasswordPayload } from '../crypto/password'
import { ServerDataStatus } from './types'

export interface StatusByMailAddress {
  status: 'with family' | 'without family'
  mail: string
  canCreateFamily: boolean
  alwaysPro: boolean
}

export interface NewDeviceResult {
  deviceAuthToken: string
  ownDeviceId: string
  data: ServerDataStatus
}

export function getStatusByMailAddress(client: ApiClient, mailAuthToken: string): Promise<StatusByMailAddress> {
  return client.post('/parent/get-status-by-mail-address', { mailAuthToken })
}

export function createFamily(
  client: ApiClient,
  params: {
    mailAuthToken: string
    parentPassword: ParentPasswordPayload
    parentDevice: { model: string }
    deviceName: string
    parentName: string
    timeZone: string
    clientLevel: number
  },
): Promise<NewDeviceResult> {
  return client.post('/parent/create-family', params)
}

export function signInIntoFamily(
  client: ApiClient,
  params: { mailAuthToken: string; parentDevice: { model: string }; deviceName: string; clientLevel: number },
): Promise<NewDeviceResult> {
  return client.post('/parent/sign-in-into-family', params)
}

export function createAddDeviceToken(
  client: ApiClient,
  params: { deviceAuthToken: string; parentId: string; parentPasswordSecondHash: string },
): Promise<{ token: string; deviceId: string }> {
  return client.post('/parent/create-add-device-token', params)
}

export function removeDevice(
  client: ApiClient,
  params: { deviceAuthToken: string; parentUserId: string; parentPasswordSecondHash: string; deviceId: string },
): Promise<{ ok: true }> {
  return client.post('/parent/remove-device', params)
}
