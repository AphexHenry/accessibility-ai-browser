'use strict';

const { validateM0TaskOutput } = require('../schemas');
const { safeJsonParse } = require('../utils');

function includesAny(text, needles) {
  return needles.some((needle) => text.includes(needle));
}

function fallbackFromHeuristics({ userMessage, intent }) {
  const text = String(userMessage || '').trim().toLowerCase();
  if (!text) {
    return {
      task_kind: 'general_info',
      confidence: 0,
      rationale: 'empty message',
      fallback: true,
    };
  }

  const pageActionNeedles = [
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

  const browserActionNeedles = [
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
    'find me ',
  ];

  const pageInfoNeedles = [
    'what is on this page',
    'summarize this page',
    'summarise this page',
    'on this page',
    'on the page',
    'from this page',
  ];

  if (includesAny(text, pageActionNeedles)) {
    return {
      task_kind: 'page_actions',
      confidence: 0.7,
      rationale: 'page manipulation verbs detected in request',
      fallback: true,
    };
  }

  if (includesAny(text, pageInfoNeedles)) {
    return {
      task_kind: 'page_info',
      confidence: 0.65,
      rationale: 'request asks for information from current page context',
      fallback: true,
    };
  }

  if (includesAny(text, browserActionNeedles) || intent === 'navigation' || intent === 'app_settings') {
    return {
      task_kind: 'browser_actions',
      confidence: 0.7,
      rationale: 'navigation/browser-action phrasing detected',
      fallback: true,
    };
  }

  return {
    task_kind: 'general_info',
    confidence: 0.6,
    rationale: 'no reliable browser/page action signal detected',
    fallback: true,
  };
}

function buildPrompt({ userMessage, url, title, conversationSnippet, intent }) {
  return `You are a first-step task router for a browser assistant.
Classify the user request into exactly one task kind.

User request: "${userMessage}"
Detected coarse intent: "${intent}"

Page meta (context only):
URL: ${url}
Title: ${title}

Recent conversation (last 2 turns):
${conversationSnippet}

Respond with strict JSON only:
{
  "task_kind": "general_info" | "browser_actions" | "page_info" | "page_actions",
  "confidence": 0.0-1.0,
  "rationale": "one sentence"
}

Decision policy:
- "general_info": answerable without current-page analysis and without performing browser actions.
- "browser_actions": navigation/browser-level actions (go/open/search web/back/forward/reload/open settings).
- "page_info": user needs information from the current page content/state.
- "page_actions": user asks to interact with page elements (click/fill/select/scroll/focus/highlight).
- If user asks to "find/search/look up" something on a website, prefer "browser_actions".
- If the user refers to the currently open page/site/tab (deictic references like "this page/site/tab", "here", "the page I am on", including equivalent phrasing in any language), classify as page-related:
  - use "page_info" for analysis, judgment, explanation, summary, risk/safety/trust evaluation, or questions about what is shown.
  - use "page_actions" only when an on-page interaction is requested.
- A request is "general_info" only when it can be answered independently of the current tab content/state.
- When uncertain between "general_info" and "page_info", prefer "page_info" if the request appears grounded in the current tab.
- Do not treat subjective wording (e.g., opinions) as a reason to avoid page-related routing when the request is about the current page.
- Choose exactly one task kind.`;
}

async function runM0Task({ state, runtimeChat }) {
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
  const valid = validateM0TaskOutput(parsed);
  if (!valid.ok) {
    return fallbackFromHeuristics({
      userMessage: state.user_message,
      intent: state.intent,
    });
  }
  return {
    task_kind: parsed.task_kind,
    confidence: parsed.confidence,
    rationale: parsed.rationale,
    fallback: false,
  };
}

module.exports = { runM0Task };
