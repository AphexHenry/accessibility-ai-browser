'use strict';

const ORCHESTRATION_CONFIG = Object.freeze({
  featureFlagStoreKey: 'aiOrchestrationV1',
  scopeConfidenceThreshold: 0.65,
  modelContextBudget: 4096,
  followupMaxRetries: 1,
  pageCacheTtlMs: 30_000,
  maxRecentTurns: 8,
  maxContextFacts: 12,
  maxActionSteps: 5,
  budget: Object.freeze({
    systemPrompt: 300,
    userMessage: 150,
    contextFacts: 300,
    actionSchema: 200,
    htmlBudget: 2800,
    responseReserve: 346,
  }),
});

module.exports = { ORCHESTRATION_CONFIG };
