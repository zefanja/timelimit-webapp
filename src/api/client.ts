// fetch wrapper with typed errors

export type ApiErrorKind =
  | 'badRequest' // 400
  | 'unauthorized' // 401
  | 'forbidden' // 403
  | 'notFound' // 404
  | 'conflict' // 409
  | 'gone' // 410
  | 'rateLimited' // 429
  | 'server' // 5xx
  | 'network'
  | 'invalidResponse'

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    readonly status: number | null,
    message: string,
    readonly path?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const kindByStatus: Record<number, ApiErrorKind> = {
  400: 'badRequest',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'notFound',
  409: 'conflict',
  410: 'gone',
  429: 'rateLimited',
}

const germanMessage: Record<ApiErrorKind, string> = {
  badRequest: 'Der Server hat die Anfrage abgelehnt (ungültige Daten).',
  unauthorized: 'Nicht berechtigt – Anmeldung ungültig oder Passwort falsch.',
  forbidden: 'Zugriff verweigert.',
  notFound: 'Nicht gefunden.',
  conflict: 'Konflikt mit dem aktuellen Zustand auf dem Server.',
  gone: 'Der Vorgang ist abgelaufen – bitte neu starten.',
  rateLimited: 'Zu viele Anfragen – bitte kurz warten.',
  server: 'Serverfehler.',
  network: 'Server nicht erreichbar.',
  invalidResponse: 'Unerwartete Antwort vom Server.',
}

export function normalizeServerUrl(input: string): string {
  let value = input.trim()
  if (value === '') throw new Error('Bitte eine Server-Adresse eingeben.')
  if (!/^https?:\/\//i.test(value)) value = 'https://' + value
  const url = new URL(value)
  return url.origin + url.pathname.replace(/\/+$/, '')
}

export class ApiClient {
  constructor(
    readonly serverUrl: string,
    private readonly options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
  ) {}

  async request<T>(
    path: string,
    body?: unknown,
    init: { method?: 'GET' | 'POST'; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000)
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch.bind(globalThis)

    let response: Response

    try {
      response = await fetchImpl(this.serverUrl + path, {
        method: init.method ?? 'POST',
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          Accept: 'application/json',
          ...init.headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
    } catch (ex) {
      const reason = ex instanceof Error ? ex.message : String(ex)
      throw new ApiError('network', null, germanMessage.network + ' (' + reason + ')', path)
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      const kind = kindByStatus[response.status] ?? (response.status >= 500 ? 'server' : 'invalidResponse')
      let detail = ''
      try {
        detail = (await response.text()).slice(0, 200)
      } catch {
        // ignore
      }
      throw new ApiError(kind, response.status, `${germanMessage[kind]} (HTTP ${response.status}${detail ? ': ' + detail : ''})`, path)
    }

    const text = await response.text()

    if (text === '' || text === 'OK') return undefined as T

    try {
      return JSON.parse(text) as T
    } catch {
      throw new ApiError('invalidResponse', response.status, germanMessage.invalidResponse, path)
    }
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, body)
  }
}

export function describeError(ex: unknown): string {
  if (ex instanceof ApiError) return ex.message
  if (ex instanceof Error) return ex.message
  return String(ex)
}
