'use strict';

const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const path = require('path');
const AIBridgeService = require('./ai/AIBridgeService');

const TOOLBAR_HEIGHT = 52;
const SIDEBAR_WIDTH = 380;

let mainWindow = null;
let contentView = null;
let setupWindow = null;
let sidebarOpen = false;
let aiBridge = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  contentView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  mainWindow.contentView.addChildView(contentView);

  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'browser.html'));
  mainWindow.show();
  updateContentViewBounds();

  contentView.webContents.loadURL('https://www.google.com');

  contentView.webContents.on('did-navigate', (_event, url) => {
    mainWindow.webContents.send('nav:url-changed', url);
  });
  contentView.webContents.on('did-navigate-in-page', (_event, url) => {
    mainWindow.webContents.send('nav:url-changed', url);
  });
  contentView.webContents.on('page-title-updated', (_event, title) => {
    mainWindow.setTitle(title + ' — Accessibility AI Browser');
  });

  mainWindow.on('resize', updateContentViewBounds);
}

function updateContentViewBounds() {
  if (!mainWindow || !contentView) return;
  const [width, height] = mainWindow.getContentSize();
  const sidebarW = sidebarOpen ? SIDEBAR_WIDTH : 0;
  contentView.setBounds({
    x: 0,
    y: TOOLBAR_HEIGHT,
    width: width - sidebarW,
    height: height - TOOLBAR_HEIGHT,
  });
}

function openSetupWindow() {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.focus();
    return;
  }
  setupWindow = new BrowserWindow({
    width: 760,
    height: 560,
    parent: mainWindow,
    modal: true,
    resizable: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  setupWindow.loadFile(path.join(__dirname, 'renderer', 'setup', 'setup.html'));
  setupWindow.on('closed', () => { setupWindow = null; });
}

// ── Navigation IPC ────────────────────────────────────────────────────────────

ipcMain.on('nav:load', (_event, url) => {
  let target = url.trim();
  if (!target.startsWith('http://') && !target.startsWith('https://')) {
    if (target.includes('.') && !target.includes(' ')) {
      target = 'https://' + target;
    } else {
      target = 'https://www.google.com/search?q=' + encodeURIComponent(target);
    }
  }
  contentView.webContents.loadURL(target);
});

ipcMain.on('nav:back', () => {
  if (contentView.webContents.canGoBack()) contentView.webContents.goBack();
});
ipcMain.on('nav:forward', () => {
  if (contentView.webContents.canGoForward()) contentView.webContents.goForward();
});
ipcMain.on('nav:reload', () => contentView.webContents.reload());

// ── Sidebar IPC ───────────────────────────────────────────────────────────────

ipcMain.on('sidebar:toggle', (_event, open) => {
  sidebarOpen = open;
  updateContentViewBounds();
});

// ── Setup IPC ─────────────────────────────────────────────────────────────────

ipcMain.on('setup:open', () => openSetupWindow());
ipcMain.on('setup:close', () => {
  if (setupWindow && !setupWindow.isDestroyed()) setupWindow.close();
});

// ── AI IPC ────────────────────────────────────────────────────────────────────

ipcMain.handle('ai:getState', () => aiBridge.getState());
ipcMain.handle('ai:chat', (_event, messages) => aiBridge.chat(messages));
ipcMain.handle('ai:setupModel', (_event, config) => aiBridge.setupModel(config));
ipcMain.handle('ai:useExistingModel', (_event, modelPath) => aiBridge.useExistingModel(modelPath));
ipcMain.handle('ai:setRuntimeBinaryPath', (_event, binaryPath) => aiBridge.setRuntimeBinaryPath(binaryPath));

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  aiBridge = new AIBridgeService();
  await createWindow();

  const state = await aiBridge.getState();
  if (!state.setupCompleted) {
    openSetupWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
