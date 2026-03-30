'use strict';

const { validateM0InteractionOutput } = require('../schemas');
const { safeJsonParse } = require('../utils');

function includesAny(text, needles) {
  return needles.some((needle) => text.includes(needle));
}

function fallbackFromHeuristics({ userMessage, intent }) {
  const text = String(userMessage || '').trim().toLowerCase();
  if (!text) {
    return {
      interaction_mode: 'inform',
      action_target: 'none',
      needs_page_understanding: false,
      confidence: 0,
      rationale: 'empty message',
      fallback: true,
    };
  }

  const pageOnlyNeedles = [
    'click ',
    'fill ',
    'type ',
    'select ',
    'choose ',
    'scroll',
    'highlight',
    'focus ',
    'on this page',
    'on the page',
  ];

  const sharedActionNeedles = [
    'search for ',
    'look up ',
    'go to ',
    'open ',
    'bring me to',
    'navigate to',
    'take me to',
    'visit ',
    'back',
    'forward',
    'reload',
    'refresh',
  ];

  if (includesAny(text, pageOnlyNeedles)) {
    return {
      interaction_mode: 'act',
      action_target: 'page_only',
      needs_page_understanding: true,
      confidence: 0.7,
      rationale: 'page-manipulation verbs detected in request',
      fallback: true,
    };
  }

  if (includesAny(text, sharedActionNeedles) || intent === 'navigation' || intent === 'app_settings') {
    return {
      interaction_mode: 'act',
      action_target: 'shared',
      needs_page_understanding: false,
      confidence: 0.7,
      rationale: 'shared browser/app action phrasing detected',
      fallback: true,
    };
  }

  return {
    interaction_mode: 'inform',
    action_target: 'none',
    needs_page_understanding: false,
    confidence: 0.6,
    rationale: 'no reliable imperative action signal detected',
    fallback: true,
  };
}

function buildPrompt({ userMessage, url, title, conversationSnippet, intent }) {
  return `You are an interaction-mode classifier for a browser assistant.
Determine whether the user wants information or wants the assistant to perform actions.

User request: "${userMessage}"
Detected coarse intent: "${intent}"

Page meta (context only):
URL: ${url}
Title: ${title}

Recent conversation (last 2 turns):
${conversationSnippet}

Classify with strict JSON only (no prose):
{
  "interaction_mode": "inform" | "act",
  "action_target": "none" | "shared" | "page_only",
  "needs_page_understanding": true | false,
  "confidence": 0.0-1.0,
  "rationale": "one sentence"
}

Guidelines:
- "inform": user asks for explanation or factual answer only.
- "act": user asks assistant to do something.
- "shared": browser/app actions that do not need page structure understanding (navigate/search/open settings/back/reload).
- "page_only": actions that require page elements/content/structure (click/fill/select/scroll to an element).
- If unsure, prefer "inform" with lower confidence.`;
}

async function runM0Interaction({ state, runtimeChat }) {
  const conversationSnippet = state.conversation
    .slice(-2)
    .map((turn) => `${turn.role}: ${turn.content}`)
    .join('\n');
  const prompt = buildPrompt({
    userMessage: state.user_message,
    url: state.page.url || '',
    title: state.page.title || '',
    conversationSnippet: conversationSnippet || '(none)',
    intent: state.intent || 'unknown',
  });
  const response = await runtimeChat([{ role: 'user', content: prompt }]);
  const parsed = safeJsonParse(response?.content);
  const valid = validateM0InteractionOutput(parsed);
  if (!valid.ok) {
    return fallbackFromHeuristics({
      userMessage: state.user_message,
      intent: state.intent,
    });
  }
  return {
    interaction_mode: parsed.interaction_mode,
    action_target: parsed.action_target,
    needs_page_understanding: parsed.needs_page_understanding,
    confidence: parsed.confidence,
    rationale: parsed.rationale,
    fallback: false,
  };
}

module.exports = { runM0Interaction };
