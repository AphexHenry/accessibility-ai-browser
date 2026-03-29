'use strict';

/* ── DOM refs ──────────────────────────────────────────────────────────────── */

const binaryPathEl    = document.getElementById('binary-path');
const btnSaveBinary   = document.getElementById('btn-save-binary');
const binaryStatus    = document.getElementById('binary-status');

const tabDownload     = document.getElementById('tab-download');
const tabExisting     = document.getElementById('tab-existing');
const panelDownload   = document.getElementById('panel-download');
const panelExisting   = document.getElementById('panel-existing');

const modelSelect     = document.getElementById('model-select');
const modelInfo       = document.getElementById('model-info');
const downloadDir     = document.getElementById('download-dir');
const btnDownload     = document.getElementById('btn-download');
const progressWrap    = document.getElementById('progress-wrap');
const progressBar     = document.getElementById('download-progress');
const progressLabel   = document.getElementById('progress-label');
const downloadStatus  = document.getElementById('download-status');

const existingPath    = document.getElementById('existing-path');
const btnUseExisting  = document.getElementById('btn-use-existing');
const existingStatus  = document.getElementById('existing-status');

const btnClose        = document.getElementById('btn-close');

/* ── Init ──────────────────────────────────────────────────────────────────── */

async function init() {
  const state = await window.api.ai.getState();

  if (state.llamaServerBinaryPath) {
    binaryPathEl.value = state.llamaServerBinaryPath;
  }
  if (state.modelPath) {
    existingPath.value = state.modelPath;
  }

  const catalog = state.catalog || {};
  for (const [id, model] of Object.entries(catalog)) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = model.name;
    modelSelect.appendChild(option);
  }
}

init().catch(console.error);

/* ── Binary path ───────────────────────────────────────────────────────────── */

btnSaveBinary.addEventListener('click', async () => {
  const p = binaryPathEl.value.trim();
  if (!p) { setStatus(binaryStatus, 'Enter a path.', 'error'); return; }
  try {
    await window.api.ai.setRuntimeBinaryPath(p);
    setStatus(binaryStatus, 'Saved llama-server executable path.', 'success');
  } catch (err) {
    setStatus(binaryStatus, err.message, 'error');
  }
});

/* ── Tabs ──────────────────────────────────────────────────────────────────── */

tabDownload.addEventListener('click', () => switchTab('download'));
tabExisting.addEventListener('click', () => switchTab('existing'));

function switchTab(which) {
  const isDownload = which === 'download';
  tabDownload.classList.toggle('active', isDownload);
  tabDownload.setAttribute('aria-selected', String(isDownload));
  tabExisting.classList.toggle('active', !isDownload);
  tabExisting.setAttribute('aria-selected', String(!isDownload));
  panelDownload.hidden = !isDownload;
  panelExisting.hidden = isDownload;
}

/* ── Model catalog ─────────────────────────────────────────────────────────── */

modelSelect.addEventListener('change', async () => {
  const id = modelSelect.value;
  if (!id) {
    modelInfo.textContent = '';
    btnDownload.disabled = true;
    return;
  }
  const state = await window.api.ai.getState();
  const model = state.catalog?.[id];
  if (model) {
    const mb = Math.round(model.sizeBytes / 1_000_000);
    modelInfo.textContent = `${model.description}  ·  ~${mb >= 1000 ? (mb / 1000).toFixed(1) + ' GB' : mb + ' MB'}`;
  }
  btnDownload.disabled = false;
});

/* ── Download ──────────────────────────────────────────────────────────────── */

btnDownload.addEventListener('click', async () => {
  const modelId = modelSelect.value;
  const dir = downloadDir.value.trim() || '~/Downloads/ai-models';

  if (!modelId) { setStatus(downloadStatus, 'Select a model first.', 'error'); return; }

  btnDownload.disabled = true;
  progressWrap.hidden = false;
  setStatus(downloadStatus, 'Starting download…');

  try {
    await window.api.ai.setupModel({ modelId, downloadDir: dir });
    progressBar.value = 100;
    progressLabel.textContent = '100%';
    setStatus(downloadStatus, 'Download complete. Model is ready.', 'success');
  } catch (err) {
    setStatus(downloadStatus, 'Download failed: ' + err.message, 'error');
    btnDownload.disabled = false;
  }
});

/* ── Existing model ────────────────────────────────────────────────────────── */

btnUseExisting.addEventListener('click', async () => {
  const p = existingPath.value.trim();
  if (!p) { setStatus(existingStatus, 'Enter a path to a .gguf file.', 'error'); return; }
  try {
    await window.api.ai.useExistingModel(p);
    setStatus(existingStatus, 'Model configured. Ready to chat.', 'success');
  } catch (err) {
    setStatus(existingStatus, err.message, 'error');
  }
});

/* ── Close ─────────────────────────────────────────────────────────────────── */

btnClose.addEventListener('click', () => window.api.closeSetup());

/* ── Helpers ───────────────────────────────────────────────────────────────── */

function setStatus(el, text, type = '') {
  el.textContent = text;
  el.className = 'status-msg' + (type ? ' ' + type : '');
}
