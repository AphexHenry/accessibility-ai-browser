'use strict';

const { ORCHESTRATION_CONFIG } = require('../config');

function normalizeFact(content, source) {
  return { source, content: String(content || '').trim() };
}

function dedupeFacts(facts) {
  const seen = new Set();
  const out = [];
  for (const fact of facts) {
    if (!fact.content) continue;
    const key = `${fact.source}:${fact.content.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fact);
    if (out.length >= ORCHESTRATION_CONFIG.maxContextFacts) break;
  }
  return out;
}

function extractConversationFacts(conversation) {
  const recent = Array.isArray(conversation)
    ? conversation.slice(-ORCHESTRATION_CONFIG.maxRecentTurns)
    : [];

  return recent
    .filter((turn) => turn && typeof turn.content === 'string' && turn.content.trim())
    .filter((turn) => !/<[a-z][\s\S]*>/i.test(turn.content))
    .map((turn) => normalizeFact(`${turn.role}: ${turn.content}`, 'conversation'));
}

async function runM3({ state, memoryLookup }) {
  let memoryFacts = [];
  try {
    memoryFacts = await memoryLookup(state.user_message);
  } catch {
    memoryFacts = [];
  }
  const normalizedMemory = (memoryFacts || [])
    .slice(0, 3)
    .map((item) => normalizeFact(item.content || item, 'memory'));

  const conversationFacts = extractConversationFacts(state.conversation);
  const followupFacts = (state.followup_answers || []).map((answer) =>
    normalizeFact(answer, 'user_clarification')
  );

  return dedupeFacts([...normalizedMemory, ...conversationFacts, ...followupFacts]);
}

module.exports = { runM3 };
