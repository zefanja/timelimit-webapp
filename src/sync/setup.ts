// First-time setup: mail login, create family or sign in into an existing one.

import { sendMailLoginCode, signInByMailCode } from '../api/auth'
import { ApiClient } from '../api/client'
import { createFamily, getStatusByMailAddress, NewDeviceResult, signInIntoFamily, StatusByMailAddress } from '../api/parent'
import { createParentPassword } from '../crypto/password'
import { CLIENT_LEVEL } from '../state/familyState'

export const WEB_DEVICE_MODEL = 'Web-App'

export function defaultDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Web-App'
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser'
  return `Web-App (${browser})`
}

export class SetupFlow {
  readonly client: ApiClient
  private mailLoginToken: string | null = null
  mailAuthToken: string | null = null
  status: StatusByMailAddress | null = null

  constructor(readonly serverUrl: string) {
    this.client = new ApiClient(serverUrl)
  }

  async requestCode(mail: string) {
    const { mailLoginToken } = await sendMailLoginCode(this.client, { mail: mail.trim(), locale: 'de' })
    this.mailLoginToken = mailLoginToken
  }

  async enterCode(code: string): Promise<StatusByMailAddress> {
    if (!this.mailLoginToken) throw new Error('Bitte zuerst einen Code anfordern.')
    const { mailAuthToken } = await signInByMailCode(this.client, { mailLoginToken: this.mailLoginToken, receivedCode: code })
    this.mailAuthToken = mailAuthToken
    this.status = await getStatusByMailAddress(this.client, mailAuthToken)
    return this.status
  }

  async createFamily(params: { parentName: string; password: string; timeZone: string; deviceName: string }): Promise<{
    result: NewDeviceResult
    secondHash: string
  }> {
    if (!this.mailAuthToken) throw new Error('Nicht angemeldet')
    const parentPassword = await createParentPassword(params.password)
    const result = await createFamily(this.client, {
      mailAuthToken: this.mailAuthToken,
      parentPassword,
      parentDevice: { model: WEB_DEVICE_MODEL },
      deviceName: params.deviceName,
      parentName: params.parentName,
      timeZone: params.timeZone,
      clientLevel: CLIENT_LEVEL,
    })
    return { result, secondHash: parentPassword.secondHash }
  }

  async signIn(params: { deviceName: string }): Promise<NewDeviceResult> {
    if (!this.mailAuthToken) throw new Error('Nicht angemeldet')
    return signInIntoFamily(this.client, {
      mailAuthToken: this.mailAuthToken,
      parentDevice: { model: WEB_DEVICE_MODEL },
      deviceName: params.deviceName,
      clientLevel: CLIENT_LEVEL,
    })
  }
}
