'use strict';

const { validateM4Output } = require('../schemas');
const { safeJsonParse } = require('../utils');

function buildSnapshotExcerpt(snapshot, maxChars = 6000) {
  const text = String(snapshot || '').trim();
  if (!text) return '(no page snapshot available)';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}

function buildGapPrompt({ userMessage, contextFacts, url, title, pageSnapshot }) {
  const facts = contextFacts.length
    ? contextFacts.map((fact) => `- ${fact.content}`).join('\n')
    : '(none)';
  const snapshotExcerpt = buildSnapshotExcerpt(pageSnapshot);
  return `You are deciding whether you have enough information to answer a user's request reliably.

User request: "${userMessage}"

Available context facts:
${facts}

Page: ${url} — ${title}

Page snapshot excerpt (from the currently open page):
${snapshotExcerpt}

Decision guidance:
- For page-related requests, use the page snapshot excerpt as primary evidence.
- Do NOT require external reputation/reviews unless the user explicitly asks for them.
- Return has_enough_info=true when the snapshot is sufficient for a best-effort answer with uncertainty notes.
- Return has_enough_info=false only when required information is genuinely missing from the provided context/snapshot.

Answer with a JSON object only:
{
  "has_enough_info": true | false,
  "missing": "brief description of what is missing, or null",
  "followup_question": "one focused question to ask the user, or null"
}`;
}

async function runM4({ state, runtimeChat }) {
  const prompt = buildGapPrompt({
    userMessage: state.user_message,
    contextFacts: state.context_facts,
    url: state.page.url || '',
    title: state.page.title || '',
    pageSnapshot: state.page_snapshot || '',
  });
  const response = await runtimeChat([{ role: 'user', content: prompt }]);
  const parsed = safeJsonParse(response?.content);
  const valid = validateM4Output(parsed);
  if (!valid.ok) {
    return {
      has_enough_info: true,
      missing: null,
      followup_question: null,
      fallback: true,
    };
  }
  return { ...parsed, fallback: false };
}

module.exports = { runM4 };
