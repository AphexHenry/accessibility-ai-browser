'use strict';

const fs = require('fs');
const { app, BrowserWindow, WebContentsView, ipcMain, clipboard } = require('electron');
const path = require('path');
const AIBridgeService = require('./ai/AIBridgeService');

const TOOLBAR_HEIGHT = 52;
const SIDEBAR_WIDTH = 380;

let mainWindow = null;
let contentView = null;
let setupWindow = null;
let sidebarOpen = false;
let aiBridge = null;
let domToSemanticMarkdownBundle = null;

function getDomToSemanticMarkdownBundle() {
  if (domToSemanticMarkdownBundle) return domToSemanticMarkdownBundle;
  const bundlePath = path.join(
    app.getAppPath(),
    'node_modules',
    'dom-to-semantic-markdown',
    'dist',
    'browser',
    'bundle.js'
  );
  domToSemanticMarkdownBundle = fs.readFileSync(bundlePath, 'utf8');
  return domToSemanticMarkdownBundle;
}

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
ipcMain.handle('page:copySemanticMarkdown', async () => {
  if (!contentView || contentView.webContents.isDestroyed()) {
    throw new Error('No active page to capture.');
  }

  const webContents = contentView.webContents;
  const currentUrl = webContents.getURL();
  let websiteDomain;
  try {
    websiteDomain = new URL(currentUrl).origin;
  } catch {
    websiteDomain = undefined;
  }

  const conversionOptions = {
    extractMainContent: true,
    refifyUrls: true,
    includeMetaData: 'basic',
    websiteDomain,
  };

  const script = `
    (() => {
      ${getDomToSemanticMarkdownBundle()}

      const html = document.documentElement?.outerHTML || '';
      if (!html) {
        return { markdown: '' };
      }

      const markdown = htmlToSMD.convertHtmlToMarkdown(html, ${JSON.stringify(conversionOptions)});
      const MAX_ELEMENTS = 350;
      const MAX_CLASSES = 4;
      const MAX_TEXT_LENGTH = 70;

      const isVisible = (el) => {
        if (!(el instanceof Element)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          return false;
        }
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const normalize = (value) => String(value || '').trim().replace(/\\s+/g, ' ');
      const truncate = (value, max) => (value.length > max ? value.slice(0, max - 1) + '…' : value);
      const escapeQuotes = (value) => value.replace(/"/g, '\\"');

      const selector = [
        'a', 'button', 'input', 'select', 'textarea', 'label', 'form',
        '[role]', '[aria-label]', '[name]', '[id]', '[class]',
      ].join(',');

      const lines = [];
      const seen = new Set();
      const candidates = document.querySelectorAll(selector);
      for (const el of candidates) {
        if (lines.length >= MAX_ELEMENTS) break;
        if (!isVisible(el)) continue;

        const tag = el.tagName.toLowerCase();
        const id = normalize(el.id);
        const classes = Array.from(el.classList || [])
          .map((cls) => normalize(cls))
          .filter(Boolean)
          .slice(0, MAX_CLASSES);
        const nameAttr = normalize(el.getAttribute('name'));
        const role = normalize(el.getAttribute('role'));
        const type = normalize(el.getAttribute('type'));
        const ariaLabel = normalize(el.getAttribute('aria-label'));
        const href = tag === 'a' ? normalize(el.getAttribute('href')) : '';
        const text = truncate(normalize(el.textContent), MAX_TEXT_LENGTH);

        const base = tag + (id ? '#' + id : '') + (classes.length ? '.' + classes.join('.') : '');
        const attrs = [];
        if (nameAttr) attrs.push('name="' + escapeQuotes(nameAttr) + '"');
        if (type) attrs.push('type="' + escapeQuotes(type) + '"');
        if (role) attrs.push('role="' + escapeQuotes(role) + '"');
        if (ariaLabel) attrs.push('aria-label="' + escapeQuotes(ariaLabel) + '"');
        if (href) attrs.push('href="' + escapeQuotes(href) + '"');
        if (text) attrs.push('text="' + escapeQuotes(text) + '"');

        const line = base + (attrs.length ? ' ' + attrs.join(' ') : '');
        if (!line || seen.has(line)) continue;
        seen.add(line);
        lines.push(line);
      }

      const elementMap = lines.join('\\n');
      const combinedText = elementMap
        ? markdown + '\\n\\n---\\n## Visible Element Map\\n' + elementMap
        : markdown;

      return {
        markdown: combinedText,
        markdownLength: markdown.length,
        elementMapLength: elementMap.length,
        elementCount: lines.length,
      };
    })();
  `;

  const result = await webContents.executeJavaScript(script, true);
  const markdown = (result?.markdown || '').trim();
  if (!markdown) {
    throw new Error('Could not generate minimized page content.');
  }

  clipboard.writeText(markdown);
  return {
    ok: true,
    length: markdown.length,
    markdownLength: result?.markdownLength || 0,
    elementMapLength: result?.elementMapLength || 0,
    elementCount: result?.elementCount || 0,
  };
});

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
