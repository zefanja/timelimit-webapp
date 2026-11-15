import { ApiClient } from './client'
import { ClientDataStatus, ClientPushAction, ServerDataStatus } from './types'

export const MAX_ACTIONS_PER_REQUEST = 50

export function pullStatus(
  client: ApiClient,
  params: { deviceAuthToken: string; status: ClientDataStatus },
): Promise<ServerDataStatus> {
  return client.post('/sync/pull-status', params)
}

export async function pushActions(
  client: ApiClient,
  params: { deviceAuthToken: string; actions: Array<ClientPushAction> },
): Promise<{ shouldDoFullSync: boolean }> {
  if (params.actions.length > MAX_ACTIONS_PER_REQUEST) {
    throw new Error('too many actions per request')
  }

  return client.post('/sync/push-actions', params)
}

export function isDeviceRemoved(client: ApiClient, deviceAuthToken: string): Promise<{ isDeviceRemoved: boolean }> {
  return client.post('/sync/is-device-removed', { deviceAuthToken })
}
