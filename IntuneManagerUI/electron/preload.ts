import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel: string, data?: unknown): Promise<unknown> => {
    return ipcRenderer.invoke(channel, data)
  },
  on: (channel: string, callback: (data: unknown) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  once: (channel: string, callback: (data: unknown) => void): void => {
    ipcRenderer.once(channel, (_event, data) => callback(data))
  },
  off: (channel: string, listener: (data: unknown) => void): void => {
    ipcRenderer.removeListener(channel, listener)
  }
})
