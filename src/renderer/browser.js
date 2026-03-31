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
const scamScoreBadge = document.getElementById('scam-score-badge');
const scamScoreValue = document.getElementById('scam-score-value');
const scamScoreHelp  = document.getElementById('scam-score-help');

/* ── State ───────────────────────────────────────────────────────────────── */

let sidebarOpen = false;
const conversation = [];
let pendingFollowupRequest = null;
let pendingActionConfirmRequest = null;

function scoreSeverity(score) {
  if (typeof score !== 'number') return 'medium';
  if (score <= 3.3) return 'low';
  if (score <= 6.6) return 'medium';
  return 'high';
}

function renderScamBadge(result) {
  const status = result?.status || 'idle';
  const explanation = String(result?.explanation || '').trim();
  const isFallback = Boolean(result?.fallback);
  scamScoreBadge.classList.remove('low', 'medium', 'high');

  if (status === 'running') {
    scamScoreValue.textContent = 'Analyzing...';
    scamScoreBadge.classList.add('medium');
    scamScoreBadge.title = 'Background scam assessment is running.';
    scamScoreHelp.title = 'AI is analyzing this page now.';
    scamScoreHelp.setAttribute('aria-label', `Scam assessment explanation. ${scamScoreHelp.title}`);
    return;
  }

  if (status === 'error') {
    scamScoreValue.textContent = '--/10';
    scamScoreBadge.classList.add('medium');
    scamScoreBadge.title = result?.error || 'Scam assessment could not run.';
    scamScoreHelp.title = explanation || 'Scam assessment failed, so no explanation is available.';
    scamScoreHelp.setAttribute('aria-label', `Scam assessment explanation. ${scamScoreHelp.title}`);
    return;
  }

  if (status === 'done' && isFallback) {
    scamScoreValue.textContent = 'Unknown';
    scamScoreBadge.classList.add('medium');
    scamScoreBadge.title = (result?.reasons || []).join(' | ') || 'Scam score unavailable due to invalid model output.';
    scamScoreHelp.title = explanation || 'The model response could not be parsed, so no numeric score is shown.';
    scamScoreHelp.setAttribute('aria-label', `Scam assessment explanation. ${scamScoreHelp.title}`);
    return;
  }

  if (status === 'done' && typeof result?.score === 'number') {
    const score = Math.max(0, Math.min(10, result.score));
    const severity = scoreSeverity(score);
    scamScoreValue.textContent = `${score.toFixed(1)}/10`;
    scamScoreBadge.classList.add(severity);
    scamScoreBadge.title = (result?.reasons || []).join(' | ') || 'Scam likelihood estimated from page and navigation context.';
    scamScoreHelp.title = explanation || 'Risk estimate is based on page content and recent navigation signals.';
    scamScoreHelp.setAttribute('aria-label', `Scam assessment explanation. ${scamScoreHelp.title}`);
    return;
  }

  scamScoreValue.textContent = '--/10';
  scamScoreBadge.classList.add('medium');
  scamScoreBadge.title = 'Scam score unavailable for this page.';
  scamScoreHelp.title = 'Scam explanation unavailable.';
  scamScoreHelp.setAttribute('aria-label', `Scam assessment explanation. ${scamScoreHelp.title}`);
}

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
window.api.onScamAssessmentUpdated((result) => {
  renderScamBadge(result);
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

async function initScamBadge() {
  try {
    const latest = await window.api.getLatestScamAssessment();
    renderScamBadge(latest);
  } catch {
    renderScamBadge({ status: 'error', error: 'Failed to fetch scam score.' });
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
  conversation.push({ role: 'user', content: prompt });

  try {
    let payload = {
      message: prompt,
      conversation: conversation.slice(-10),
      followupCount: 0,
      confirmActions: false,
    };

    if (pendingFollowupRequest) {
      payload = {
        ...pendingFollowupRequest,
        followupAnswer: prompt,
      };
      pendingFollowupRequest = null;
    } else if (pendingActionConfirmRequest) {
      const normalized = prompt.toLowerCase();
      const approved = ['yes', 'y', 'confirm', 'ok', 'sure'].includes(normalized);
      const original = pendingActionConfirmRequest;
      pendingActionConfirmRequest = null;
      if (!approved) {
        thinking.remove();
        appendMessage('assistant', 'Action execution canceled. I can still answer without taking page actions.');
        conversation.push({ role: 'assistant', content: 'Action execution canceled.' });
        btnSend.disabled = false;
        promptEl.focus();
        return;
      }
      payload = {
        ...original,
        confirmActions: true,
      };
    }

    const result = await window.api.ai.chat(payload);
    thinking.remove();

    if (result?.kind === 'followup_required') {
      pendingFollowupRequest = {
        ...payload,
        followupCount: result.followupCount || 1,
      };
      appendMessage('assistant', result.question || 'Could you clarify your request?');
      conversation.push({ role: 'assistant', content: result.question || 'Could you clarify your request?' });
      return;
    }

    if (result?.kind === 'action_confirmation_required') {
      pendingActionConfirmRequest = { ...payload };
      appendMessage('assistant', result.question || 'Please confirm this action by replying yes.');
      conversation.push({ role: 'assistant', content: result.question || 'Please confirm this action by replying yes.' });
      return;
    }

    const content = result?.content || '(empty response)';
    appendMessage('assistant', content);
    conversation.push({ role: 'assistant', content });
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

initScamBadge();
