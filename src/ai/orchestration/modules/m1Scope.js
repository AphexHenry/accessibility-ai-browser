'use strict';

const { ORCHESTRATION_CONFIG } = require('../config');
const { validateM1Output } = require('../schemas');
const { safeJsonParse } = require('../utils');

function buildPrompt({ userMessage, url, title, conversationSnippet }) {
  return `You are a request router for a browser assistant.
Classify the user's request into one of two scopes:

- "general": answerable from general knowledge alone, no need to see the page.
- "page_related": requires understanding the current page's content, structure, or state.

Page context (for reference only, do not analyse content):
URL: ${url}
Title: ${title}

Recent conversation (last 2 turns):
${conversationSnippet}

User request: "${userMessage}"

Respond with a JSON object only, no explanation:
{
  "scope": "general" | "page_related",
  "confidence": 0.0-1.0,
  "rationale": "one sentence"
}`;
}

async function runM1({ state, runtimeChat }) {
  const conversationSnippet = state.conversation
    .slice(-2)
    .map((turn) => `${turn.role}: ${turn.content}`)
    .join('\n');

  const prompt = buildPrompt({
    userMessage: state.user_message,
    url: state.page.url || '',
    title: state.page.title || '',
    conversationSnippet: conversationSnippet || '(none)',
  });

  const response = await runtimeChat([
    { role: 'user', content: prompt },
  ]);
  const parsed = safeJsonParse(response?.content);
  const valid = validateM1Output(parsed);
  if (!valid.ok) {
    return {
      scope: 'page_related',
      confidence: 0,
      rationale: `fallback due to parse error: ${valid.reason}`,
      fallback: true,
    };
  }

  let scope = parsed.scope;
  if (scope === 'general' && parsed.confidence < ORCHESTRATION_CONFIG.scopeConfidenceThreshold) {
    scope = 'page_related';
  }
  return {
    scope,
    confidence: parsed.confidence,
    rationale: parsed.rationale,
    fallback: false,
  };
}

module.exports = { runM1 };
