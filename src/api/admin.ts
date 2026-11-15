// Admin API of the server (only available when ADMIN_TOKEN is set).
// Authentication: HTTP basic auth, any user name, password = ADMIN_TOKEN.

import { ApiClient } from './client'

function basicAuth(adminToken: string) {
  return { Authorization: 'Basic ' + btoa('admin:' + adminToken) }
}

export function getAdminStatus(client: ApiClient, adminToken: string): Promise<unknown> {
  return client.request('/admin/status', undefined, { method: 'GET', headers: basicAuth(adminToken) })
}

/** POST /admin/unlock-premium { mail, duration: "month" | "year" } */
export function unlockPremium(
  client: ApiClient,
  { adminToken, mail, duration }: { adminToken: string; mail: string; duration: 'month' | 'year' },
): Promise<{ ok: boolean }> {
  return client.request('/admin/unlock-premium', { mail, duration }, { headers: basicAuth(adminToken) })
}
