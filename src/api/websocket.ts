// socket.io connection for live updates ("should sync").

import { io, Socket } from 'socket.io-client'

export interface LiveConnection {
  close(): void
  readonly connected: boolean
}

export function connectLive({
  serverUrl,
  deviceAuthToken,
  onShouldSync,
  onConnectedDevices,
  onStatus,
}: {
  serverUrl: string
  deviceAuthToken: string
  onShouldSync: (isImportant: boolean) => void
  onConnectedDevices?: (deviceIds: Array<string>) => void
  onStatus?: (connected: boolean) => void
}): LiveConnection {
  const url = new URL(serverUrl)
  const basePath = url.pathname.replace(/\/+$/, '')

  const socket: Socket = io(url.origin, {
    path: basePath + '/socket.io',
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 30000,
  })

  socket.on('connect', () => {
    // one devicelogin per connection; a reconnect is a new connection
    socket.emit('devicelogin', deviceAuthToken, () => {
      onStatus?.(true)
      // something could have changed while we were offline
      onShouldSync(true)
    })
  })

  socket.on('disconnect', () => onStatus?.(false))
  socket.on('connect_error', () => onStatus?.(false))

  socket.on('should sync', (payload: { isImportant?: boolean } | undefined) => {
    onShouldSync(!!payload?.isImportant)
  })

  socket.on('connected devices', (deviceIds: Array<string>) => {
    if (Array.isArray(deviceIds)) onConnectedDevices?.(deviceIds)
  })

  return {
    close: () => socket.close(),
    get connected() {
      return socket.connected
    },
  }
}
