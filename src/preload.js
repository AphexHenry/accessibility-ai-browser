'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Navigation
  navigate: (url) => ipcRenderer.send('nav:load', url),
  goBack: () => ipcRenderer.send('nav:back'),
  goForward: () => ipcRenderer.send('nav:forward'),
  reload: () => ipcRenderer.send('nav:reload'),
  onUrlChanged: (cb) => ipcRenderer.on('nav:url-changed', (_event, url) => cb(url)),

  // Sidebar
  setSidebarOpen: (open) => ipcRenderer.send('sidebar:toggle', open),

  // Setup window
  openSetup: () => ipcRenderer.send('setup:open'),
  closeSetup: () => ipcRenderer.send('setup:close'),

  // AI
  ai: {
    getState: () => ipcRenderer.invoke('ai:getState'),
    chat: (messages) => ipcRenderer.invoke('ai:chat', messages),
    setupModel: (config) => ipcRenderer.invoke('ai:setupModel', config),
    useExistingModel: (modelPath) => ipcRenderer.invoke('ai:useExistingModel', modelPath),
    setRuntimeBinaryPath: (binaryPath) => ipcRenderer.invoke('ai:setRuntimeBinaryPath', binaryPath),
  },
});
