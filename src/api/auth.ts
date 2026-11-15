import { ApiClient } from './client'

export type SendMailLoginCodeResult =
  | { mailLoginToken: string }
  | { mailAddressNotWhitelisted: true }
  | { mailServerBlacklisted: true }
  | { blacklisted?: true; [key: string]: unknown }

export async function sendMailLoginCode(
  client: ApiClient,
  { mail, locale = 'de', deviceAuthToken }: { mail: string; locale?: string; deviceAuthToken?: string },
): Promise<{ mailLoginToken: string }> {
  const result = await client.post<SendMailLoginCodeResult>('/auth/send-mail-login-code-v2', {
    mail,
    locale,
    ...(deviceAuthToken ? { deviceAuthToken } : {}),
  })

  if ('mailLoginToken' in result && typeof result.mailLoginToken === 'string') {
    return { mailLoginToken: result.mailLoginToken }
  }

  if ('mailAddressNotWhitelisted' in result) {
    throw new Error('Diese Mail-Adresse ist auf dem Server nicht freigegeben (MAIL_WHITELIST).')
  }

  if ('mailServerBlacklisted' in result) {
    throw new Error('Dieser Mail-Anbieter wird vom Server nicht unterstützt.')
  }

  throw new Error('Unbekannte Antwort vom Server: ' + JSON.stringify(result))
}

export async function signInByMailCode(
  client: ApiClient,
  { mailLoginToken, receivedCode }: { mailLoginToken: string; receivedCode: string },
): Promise<{ mailAuthToken: string }> {
  return client.post('/auth/sign-in-by-mail-code', { mailLoginToken, receivedCode: receivedCode.trim() })
}
