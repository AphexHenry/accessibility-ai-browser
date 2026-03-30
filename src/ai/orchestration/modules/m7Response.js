'use strict';

const { createId } = require('../state');

const BASE_SYSTEM_PROMPT = `You are a helpful browser assistant embedded in a web browser.
You have access to the current page content and can perform safe browser actions.
Be concise. Prefer short answers unless depth is clearly needed.
Never reveal your internal reasoning steps or tool names.
If you performed actions on the page, mention what you did briefly at the end.
Only claim an action happened when its execution status is "done".
If actions failed, explicitly say they failed and include a brief reason.
Do not claim you searched/found results unless actions explicitly show that happened in this request.`;

function serializeFacts(facts) {
  if (!facts || !facts.length) return '(none)';
  return facts.map((fact) => `- [${fact.source}] ${fact.content}`).join('\n');
}

function serializeActions(actions) {
  if (!actions || !actions.length) return '(none)';
  return actions
    .map((action) => {
      const details = action?.result?.error
        ? ` (${action.result.error})`
        : action?.result?.target
          ? ` (${action.result.target})`
          : '';
      return `- step ${action.step}: ${action.action} => ${action.status}${details}`;
    })
    .join('\n');
}

function buildUserTurn(state) {
  if (state.scope === 'general' && (!state.action_results || !state.action_results.length)) {
    return `[CONTEXT FACTS]
${serializeFacts(state.context_facts)}

[USER REQUEST]
${state.user_message}`;
  }
  return `[CONTEXT FACTS]
${serializeFacts(state.context_facts)}

[PAGE: ${state.page.url || ''} — ${state.page.title || ''}]
${state.relevant_snapshot || state.page_snapshot || '(no page snapshot)'}

[ACTIONS PERFORMED]
${serializeActions(state.action_results)}

[USER REQUEST]
${state.user_message}

If information is uncertain due to incomplete page context, say so briefly.`;
}

async function runM7({ state, runtimeChat }) {
  const messages = [
    { role: 'system', content: BASE_SYSTEM_PROMPT },
    { role: 'user', content: buildUserTurn(state) },
  ];
  const response = await runtimeChat(messages);
  return {
    final_response_id: createId('resp'),
    content: response?.content || '',
  };
}

module.exports = { runM7 };
