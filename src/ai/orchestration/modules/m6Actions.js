'use strict';

const { ORCHESTRATION_CONFIG } = require('../config');
const { ACTION_DICTIONARY, getActionsByAvailability } = require('../actions/dictionary');
const { validateM6Output } = require('../schemas');
const { safeJsonParse } = require('../utils');

function buildPrompt({ userMessage, pageSnapshot, allowedActions, intent, interactionMode, actionTarget }) {
  return `You are a browser action planner.
Decide if the user's request requires browser or app actions.

User request: "${userMessage}"

Detected intent: "${intent}"
Interaction mode: "${interactionMode}"
Action target: "${actionTarget}"

Page snapshot:
${pageSnapshot}

Allowed actions:
${JSON.stringify(allowedActions)}

For action arguments:
- For "navigateTo", always use args {"target":"<url or query>"}.

Respond with JSON:
{
  "action_required": true | false,
  "plan": [{ "step": 1, "action": "action_name", "args": {}, "rationale": "..." }]
}`;
}

async function runM6({ state, runtimeChat }) {
  const sharedOnly = state.scope === 'general' && state.action_target === 'shared';
  const allowedActions = sharedOnly
    ? getActionsByAvailability('shared')
    : ACTION_DICTIONARY;
  const prompt = buildPrompt({
    userMessage: state.user_message,
    pageSnapshot: (state.page_snapshot || '').slice(0, 20_000),
    allowedActions,
    intent: state.intent || 'unknown',
    interactionMode: state.interaction_mode || 'unknown',
    actionTarget: state.action_target || 'none',
  });
  const response = await runtimeChat([{ role: 'user', content: prompt }]);
  const parsed = safeJsonParse(response?.content);
  const valid = validateM6Output(parsed);
  if (!valid.ok) {
    return { action_required: false, plan: [], fallback: true };
  }
  const allowedActionNames = new Set(allowedActions.map((action) => action.name));
  const plan = parsed.plan
    .filter((step) => allowedActionNames.has(step.action))
    .slice(0, ORCHESTRATION_CONFIG.maxActionSteps)
    .map((step, index) => ({
    step: Number(step.step) || index + 1,
    action: step.action,
    args: step.args || {},
    rationale: typeof step.rationale === 'string' ? step.rationale : '',
    }));
  return { action_required: parsed.action_required && plan.length > 0, plan, fallback: false };
}

module.exports = { runM6 };
