'use strict';

const { validateM4Output } = require('../schemas');
const { safeJsonParse } = require('../utils');

function buildGapPrompt({ userMessage, contextFacts, url, title }) {
  const facts = contextFacts.length
    ? contextFacts.map((fact) => `- ${fact.content}`).join('\n')
    : '(none)';
  return `You are deciding whether you have enough information to answer a user's request reliably.

User request: "${userMessage}"

Available context facts:
${facts}

Page: ${url} — ${title}

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
