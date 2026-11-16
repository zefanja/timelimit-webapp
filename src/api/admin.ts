// Premium unlock via the admin API of the server.
// Authentication for /admin: HTTP basic auth, any user name, password = ADMIN_TOKEN.
//
// Current upstream server (only unlock-premium-v2):
//   1. POST /parent/create-identity-token  (signed with SIGN_SECRET, 404 without it)
//   2. POST /admin/unlock-premium-v2 { purchaseToken, purchaseId, dryRun, type }
// Older servers additionally have POST /admin/unlock-premium { mail, duration },
// which is used as fallback.

import { ApiClient, ApiError } from './client'

function basicAuth(adminToken: string) {
  return { Authorization: 'Basic ' + btoa('admin:' + adminToken) }
}

export function getAdminStatus(client: ApiClient, adminToken: string): Promise<unknown> {
  return client.request('/admin/status', undefined, { method: 'GET', headers: basicAuth(adminToken) })
}

interface UnlockV2Result {
  ok: boolean
  error?: string
  detail?: string
  wasAlreadyExecuted?: boolean
  lastPurchase?: { timestring?: string }
}

const unlockErrors: Record<string, string> = {
  'token invalid': 'Identitäts-Token ungültig (SIGN_SECRET geändert?)',
  'can not renew now': 'Premium läuft noch zu lange – eine Verlängerung ist erst kurz vor Ablauf möglich',
  'purchase id already used': 'Kauf-ID bereits verwendet',
  'family not found': 'Familie nicht gefunden',
}

export async function unlockPremium(
  client: ApiClient,
  params: {
    adminToken: string
    duration: 'month' | 'year'
    deviceAuthToken: string
    parentUserId: string
    parentPasswordSecondHash: string
    mail: string
  },
): Promise<void> {
  let identityToken: string | null = null

  try {
    const result = await client.post<{ token: string }>('/parent/create-identity-token', {
      deviceAuthToken: params.deviceAuthToken,
      parentUserId: params.parentUserId,
      parentPasswordSecondHash: params.parentPasswordSecondHash,
      purpose: 'purchase',
    })
    identityToken = result.token
  } catch (ex) {
    if (!(ex instanceof ApiError && ex.kind === 'notFound')) throw ex
  }

  if (identityToken) {
    const purchaseId = 'webapp-' + params.duration + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
    const result = await client.request<UnlockV2Result>(
      '/admin/unlock-premium-v2',
      { purchaseToken: identityToken, purchaseId, dryRun: false, type: params.duration },
      { headers: basicAuth(params.adminToken) },
    )

    if (!result.ok) {
      const message = unlockErrors[result.error ?? ''] ?? result.error ?? 'unbekannter Fehler'
      throw new Error(`Freischaltung abgelehnt: ${message}${result.detail ? ' (' + result.detail + ')' : ''}`)
    }
    return
  }

  // no SIGN_SECRET on the server: try the legacy endpoint of older servers
  try {
    await client.request('/admin/unlock-premium', { mail: params.mail, duration: params.duration }, { headers: basicAuth(params.adminToken) })
  } catch (ex) {
    if (ex instanceof ApiError && ex.kind === 'notFound') {
      throw new Error('Der Server braucht für die Freischaltung SIGN_SECRET (und ADMIN_TOKEN). Alternativ ALWAYS_PRO=yes setzen.')
    }
    throw ex
  }
}
