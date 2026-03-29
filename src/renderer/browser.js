'use strict';

/* ── DOM refs ────────────────────────────────────────────────────────────── */

const btnBack        = document.getElementById('btn-back');
const btnForward     = document.getElementById('btn-forward');
const btnReload      = document.getElementById('btn-reload');
const addressBar     = document.getElementById('address-bar');
const addressForm    = document.getElementById('address-form');
const btnAiToggle    = document.getElementById('btn-ai-toggle');
const sidebar        = document.getElementById('ai-sidebar');
const btnCloseSidebar= document.getElementById('btn-close-sidebar');
const btnCopyPage    = document.getElementById('btn-copy-page');
const btnSetup       = document.getElementById('btn-setup');
const runtimeBanner  = document.getElementById('runtime-banner');
const runtimeStatus  = document.getElementById('runtime-status-text');
const messagesEl     = document.getElementById('messages');
const composer       = document.getElementById('composer');
const promptEl       = document.getElementById('prompt');
const btnSend        = document.getElementById('btn-send');

/* ── State ───────────────────────────────────────────────────────────────── */

let sidebarOpen = false;

/* ── Navigation ──────────────────────────────────────────────────────────── */

btnBack.addEventListener('click',    () => window.api.goBack());
btnForward.addEventListener('click', () => window.api.goForward());
btnReload.addEventListener('click',  () => window.api.reload());

addressForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const url = addressBar.value.trim();
  if (url) window.api.navigate(url);
  addressBar.blur();
});

addressBar.addEventListener('focus', () => addressBar.select());

window.api.onUrlChanged((url) => {
  addressBar.value = url;
});

/* ── Sidebar ─────────────────────────────────────────────────────────────── */

function setSidebar(open) {
  sidebarOpen = open;
  sidebar.hidden = !open;
  btnAiToggle.setAttribute('aria-pressed', String(open));
  window.api.setSidebarOpen(open);

  if (open) {
    checkRuntimeStatus();
    promptEl.focus();
  }
}

btnAiToggle.addEventListener('click', () => setSidebar(!sidebarOpen));
btnCloseSidebar.addEventListener('click', () => setSidebar(false));
btnCopyPage.addEventListener('click', async () => {
  btnCopyPage.disabled = true;
  const initialLabel = btnCopyPage.textContent;
  btnCopyPage.textContent = 'Copying...';
  try {
    const result = await window.api.copyPageSemanticMarkdown();
    const length = result?.length || 0;
    const elementCount = result?.elementCount || 0;
    appendMessage(
      'assistant',
      `Copied minimized page markdown + visible element map (${length} chars, ${elementCount} elements).`
    );
    btnCopyPage.textContent = 'Copied';
  } catch (err) {
    appendMessage('error', 'Could not copy page markdown: ' + err.message);
    btnCopyPage.textContent = 'Copy failed';
  } finally {
    setTimeout(() => {
      btnCopyPage.textContent = initialLabel;
      btnCopyPage.disabled = false;
    }, 1400);
  }
});
btnSetup.addEventListener('click', () => window.api.openSetup());

/* ── Runtime status ──────────────────────────────────────────────────────── */

async function checkRuntimeStatus() {
  try {
    const state = await window.api.ai.getState();
    if (!state.setupCompleted) {
      showBanner('Model not set up. Click Setup to get started.', false);
    } else if (!state.runtimeHealthy) {
      showBanner('llama-server is not running. Start it or check your setup.', false);
    } else {
      runtimeBanner.hidden = true;
    }
  } catch {
    showBanner('Could not reach AI service.', false);
  }
}

function showBanner(text, ok = false) {
  runtimeStatus.textContent = text;
  runtimeBanner.hidden = false;
  runtimeBanner.classList.toggle('ok', ok);
}

/* ── Chat ────────────────────────────────────────────────────────────────── */

function appendMessage(role, content) {
  const el = document.createElement('article');
  el.className = 'message ' + role;
  el.textContent = content;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = promptEl.value.trim();
  if (!prompt) return;

  promptEl.value = '';
  btnSend.disabled = true;
  appendMessage('user', prompt);

  const thinking = appendMessage('assistant typing', '');

  try {
    const result = await window.api.ai.chat([{ role: 'user', content: prompt }]);
    thinking.remove();
    appendMessage('assistant', result?.content || '(empty response)');
    runtimeBanner.hidden = true;
  } catch (err) {
    thinking.remove();
    appendMessage('error', 'Error: ' + err.message);
  } finally {
    btnSend.disabled = false;
    promptEl.focus();
  }
});

/* Cmd/Ctrl+Enter submits from the textarea */
promptEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    composer.requestSubmit();
  }
});
