'use strict';

const { clipboard } = require('electron');
const { getActionSpec } = require('./dictionary');

function scriptForAction(action, args) {
  const esc = JSON.stringify;
  switch (action) {
    case 'highlight':
      return `(() => { const el = document.querySelector(${esc(args.selector)}); if (!el) return { ok:false, error:'not found' }; el.style.outline='3px solid #4f8ef7'; el.dataset.aiHighlight='1'; return { ok:true }; })();`;
    case 'scrollTo':
      return `(() => { const el = document.querySelector(${esc(args.selector)}); if (!el) return { ok:false, error:'not found' }; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return { ok:true }; })();`;
    case 'focusElement':
      return `(() => { const el = document.querySelector(${esc(args.selector)}); if (!el) return { ok:false, error:'not found' }; el.focus(); return { ok:true }; })();`;
    case 'fillInput':
      return `(() => { const el = document.querySelector(${esc(args.selector)}); if (!el) return { ok:false, error:'not found' }; if (!('value' in el)) return { ok:false, error:'not an input' }; el.value = ${esc(args.value || '')}; el.dispatchEvent(new Event('input', { bubbles:true })); el.dispatchEvent(new Event('change', { bubbles:true })); return { ok:true }; })();`;
    case 'clickElement':
      return `(() => { const el = document.querySelector(${esc(args.selector)}); if (!el) return { ok:false, error:'not found' }; el.click(); return { ok:true }; })();`;
    case 'selectOption':
      return `(() => { const el = document.querySelector(${esc(args.selector)}); if (!el) return { ok:false, error:'not found' }; if (!el.options) return { ok:false, error:'not a select' }; el.value = ${esc(args.value || '')}; el.dispatchEvent(new Event('change', { bubbles:true })); return { ok:true }; })();`;
    case 'injectCSS':
      return `(() => { let style = document.getElementById('__ai_assistant_style__'); if (!style) { style = document.createElement('style'); style.id='__ai_assistant_style__'; document.head.appendChild(style); } style.textContent = ${esc(args.css || '')}; return { ok:true }; })();`;
    case 'removeHighlights':
      return `(() => { document.querySelectorAll('[data-ai-highlight="1"]').forEach((el) => { el.style.outline=''; delete el.dataset.aiHighlight; }); return { ok:true }; })();`;
    default:
      return '';
  }
}

async function executeActionPlan({ webContents, actionPlan, allowConfirmActions }) {
  const results = [];
  for (const step of actionPlan) {
    const spec = getActionSpec(step.action);
    if (!spec) {
      results.push({ ...step, status: 'skipped', result: { ok: false, error: 'unknown action' } });
      continue;
    }
    if (spec.risk === 'confirm' && !allowConfirmActions) {
      results.push({ ...step, status: 'needs_confirmation', result: { ok: false, error: 'confirmation required' } });
      continue;
    }

    if (step.action === 'copyToClipboard') {
      clipboard.writeText(String(step.args?.text || ''));
      results.push({ ...step, status: 'done', result: { ok: true } });
      continue;
    }

    const script = scriptForAction(step.action, step.args || {});
    if (!script) {
      results.push({ ...step, status: 'skipped', result: { ok: false, error: 'unsupported action' } });
      continue;
    }
    try {
      const runResult = await webContents.executeJavaScript(script, true);
      results.push({ ...step, status: runResult?.ok ? 'done' : 'error', result: runResult || { ok: false } });
    } catch (err) {
      results.push({ ...step, status: 'error', result: { ok: false, error: err.message } });
    }
  }
  return results;
}

module.exports = { executeActionPlan };
