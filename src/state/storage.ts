// Key/value persistence. Uses localStorage when available (wrapped in
// try/catch, it can throw in private mode) and falls back to memory.

export interface KeyValueStore {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

export class MemoryStore implements KeyValueStore {
  private readonly data = new Map<string, string>()
  get(key: string) {
    return this.data.get(key) ?? null
  }
  set(key: string, value: string) {
    this.data.set(key, value)
  }
  remove(key: string) {
    this.data.delete(key)
  }
}

class WebStorageStore implements KeyValueStore {
  private readonly fallback = new MemoryStore()

  constructor(private readonly storage: () => Storage | undefined, private readonly prefix: string) {}

  get(key: string) {
    try {
      const value = this.storage()?.getItem(this.prefix + key)
      if (value !== null && value !== undefined) return value
    } catch {
      // ignore
    }
    return this.fallback.get(key)
  }

  set(key: string, value: string) {
    this.fallback.set(key, value)
    try {
      this.storage()?.setItem(this.prefix + key, value)
    } catch {
      // ignore (quota, private mode)
    }
  }

  remove(key: string) {
    this.fallback.remove(key)
    try {
      this.storage()?.removeItem(this.prefix + key)
    } catch {
      // ignore
    }
  }
}

const PREFIX = 'timelimit-web:'

export const createLocalStore = (): KeyValueStore =>
  new WebStorageStore(() => (typeof localStorage !== 'undefined' ? localStorage : undefined), PREFIX)

export const createSessionStore = (): KeyValueStore =>
  new WebStorageStore(() => (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined), PREFIX)

export function readJson<T>(store: KeyValueStore, key: string, fallback: T): T {
  const raw = store.get(key)
  if (raw === null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJson(store: KeyValueStore, key: string, value: unknown) {
  store.set(key, JSON.stringify(value))
}
