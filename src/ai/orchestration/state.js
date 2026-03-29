'use strict';

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function createRequestState({ tabId, userMessage, conversation, pageMeta }) {
  return {
    request_id: createId('req'),
    timestamp: Date.now(),
    tab_id: tabId || 'active',
    user_message: userMessage,
    conversation: Array.isArray(conversation) ? conversation : [],
    page: pageMeta || { url: '', title: '' },

    scope: null,
    scope_confidence: 0,
    scope_rationale: '',

    page_snapshot: null,
    snapshot_metrics: { markdownLength: 0, elementMapLength: 0, elementCount: 0 },
    snapshot_token_estimate: 0,

    context_facts: [],
    missing_info: false,
    followup_questions: [],
    followup_answers: [],
    followup_count: 0,

    budget_enforced: false,
    relevant_snippets: [],
    budget_metrics: null,

    action_required: false,
    action_plan: [],
    action_results: [],

    uncertainty_reason: null,
    final_response_id: null,
    timings: {},
    logs: [],
  };
}

module.exports = { createRequestState, createId };
