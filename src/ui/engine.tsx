import { createContext, ReactNode, useContext, useSyncExternalStore } from 'react'
import { EngineSnapshot, SyncEngine } from '../sync/engine'
import { createLocalStore, createSessionStore } from '../state/storage'

export const engine = new SyncEngine(createLocalStore(), createSessionStore())

const EngineContext = createContext<SyncEngine>(engine)

export function EngineProvider({ children }: { children: ReactNode }) {
  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>
}

export function useEngine(): SyncEngine {
  return useContext(EngineContext)
}

export function useSnapshot(): EngineSnapshot {
  const instance = useEngine()
  return useSyncExternalStore(
    (listener) => instance.subscribe(listener),
    () => instance.getSnapshot(),
  )
}
