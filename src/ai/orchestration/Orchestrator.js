'use strict';

const { ORCHESTRATION_CONFIG } = require('./config');
const { createRequestState } = require('./state');
const { PageSnapshotCache } = require('./cache/pageSnapshotCache');
const { runM1 } = require('./modules/m1Scope');
const { runM3 } = require('./modules/m3Context');
const { runM4 } = require('./modules/m4Gap');
const { runM5 } = require('./modules/m5Budget');
const { runM6 } = require('./modules/m6Actions');
const { runM7 } = require('./modules/m7Response');
const { estimateTokens, nowMs } = require('./utils');
const { executeActionPlan } = require('./actions/executor');
const { OrchestrationMetrics } = require('./metrics');

class Orchestrator {
  constructor({ runtimeChat, simplifyCurrentPage, getPageMeta, getWebContents, memoryLookup, logger }) {
    this.runtimeChat = runtimeChat;
    this.simplifyCurrentPage = simplifyCurrentPage;
    this.getPageMeta = getPageMeta;
    this.getWebContents = getWebContents;
    this.memoryLookup = memoryLookup || (async () => []);
    this.logger = logger || (() => {});
    this.pageCache = new PageSnapshotCache(ORCHESTRATION_CONFIG.pageCacheTtlMs);
    this.metrics = new OrchestrationMetrics();
  }

  log(state, event, extra = {}) {
    const row = { t: Date.now(), event, ...extra };
    state.logs.push(row);
    this.logger(`[orchestration:${state.request_id}] ${event}`, extra);
  }

  async handleRequest(payload) {
    const pageMeta = this.getPageMeta();
    const state = createRequestState({
      tabId: 'active',
      userMessage: payload?.message || '',
      conversation: payload?.conversation || [],
      pageMeta,
    });
    state.followup_count = Number(payload?.followupCount || 0);
    if (payload?.followupAnswer) {
      state.followup_answers.push(payload.followupAnswer);
    }

    const started = nowMs();
    try {
      // M1 + M3 foundation
      const m1Start = nowMs();
      const [m1, contextFacts] = await Promise.all([
        runM1({ state, runtimeChat: this.runtimeChat }).catch(() => ({
          scope: 'page_related',
          confidence: 0,
          rationale: 'fallback due to classifier failure',
          fallback: true,
        })),
        runM3({ state, memoryLookup: this.memoryLookup }),
      ]);
      state.timings.m1_m3 = nowMs() - m1Start;
      state.scope = m1.scope;
      state.scope_confidence = m1.confidence;
      state.scope_rationale = m1.rationale;
      state.context_facts = contextFacts;
      this.log(state, 'm1.scope_decided', { scope: state.scope, confidence: state.scope_confidence });

      if (state.scope === 'general') {
        const m7 = await runM7({ state, runtimeChat: this.runtimeChat });
        state.final_response_id = m7.final_response_id;
        this.metrics.recordRequest({ scope: state.scope, durationMs: nowMs() - started, fallback: false });
        return {
          kind: 'final_response',
          content: m7.content,
          metadata: this.buildMetadata(state, started),
        };
      }

      // M2 with cache
      const webContents = this.getWebContents();
      if (!webContents || webContents.isDestroyed()) {
        throw new Error('No active page available for page-related request.');
      }
      const cacheHit = this.pageCache.get(state.tab_id, state.page.url, state.page.title);
      if (cacheHit) {
        state.page_snapshot = cacheHit.markdown;
        state.snapshot_metrics = cacheHit.metrics;
      } else {
        try {
          const snapshot = await this.simplifyCurrentPage(webContents, state.page.url);
          state.page_snapshot = snapshot.markdown;
          state.snapshot_metrics = {
            markdownLength: snapshot.markdownLength,
            elementMapLength: snapshot.elementMapLength,
            elementCount: snapshot.elementCount,
          };
          state.snapshot_token_estimate = estimateTokens(snapshot.markdown);
          this.pageCache.set(state.tab_id, state.page.url, state.page.title, {
            markdown: snapshot.markdown,
            metrics: state.snapshot_metrics,
          });
        } catch (err) {
          state.page_snapshot = '';
          state.uncertainty_reason = `Could not read current page content: ${err.message}`;
          this.log(state, 'm2.failed', { error: err.message });
        }
      }

      // M4 followup loop
      const gap = await runM4({ state, runtimeChat: this.runtimeChat }).catch(() => ({
        has_enough_info: true,
        missing: null,
        followup_question: null,
        fallback: true,
      }));
      state.missing_info = !gap.has_enough_info;
      if (!gap.has_enough_info) {
        state.followup_questions.push(gap.followup_question || 'Could you clarify your request?');
        if (!payload?.followupAnswer && state.followup_count < ORCHESTRATION_CONFIG.followupMaxRetries) {
          return {
            kind: 'followup_required',
            question: state.followup_questions[state.followup_questions.length - 1],
            followupCount: state.followup_count + 1,
            metadata: this.buildMetadata(state, started),
          };
        }
        state.uncertainty_reason = gap.missing || 'Insufficient context after follow-up.';
      }

      // M5 + M6 in parallel
      const [budgeted, actionPlan] = await Promise.all([
        runM5({ state, runtimeChat: this.runtimeChat }).catch(() => ({
          pageSnapshot: (state.page_snapshot || '').slice(0, 8000),
          metrics: {
            htmlBudget: ORCHESTRATION_CONFIG.budget.htmlBudget,
            fullTokens: estimateTokens(state.page_snapshot || ''),
            finalTokens: estimateTokens((state.page_snapshot || '').slice(0, 8000)),
            reductionLevel: 'fallback_error',
            selectedSections: [],
          },
        })),
        runM6({ state, runtimeChat: this.runtimeChat }).catch(() => ({
          action_required: false,
          plan: [],
          fallback: true,
        })),
      ]);
      state.budget_enforced = true;
      state.relevant_snapshot = budgeted.pageSnapshot;
      state.relevant_snippets = budgeted.metrics.selectedSections || [];
      state.budget_metrics = budgeted.metrics;
      state.action_required = actionPlan.action_required;
      state.action_plan = actionPlan.plan;

      const confirmationPending = state.action_plan.some((step) =>
        ['fillInput', 'clickElement', 'selectOption', 'injectCSS'].includes(step.action)
      );
      if (confirmationPending && !payload?.confirmActions) {
        return {
          kind: 'action_confirmation_required',
          question: 'This request may perform page-changing actions. Reply "yes" to confirm execution.',
          followupCount: state.followup_count,
          metadata: this.buildMetadata(state, started),
        };
      }

      state.action_results = await executeActionPlan({
        webContents,
        actionPlan: state.action_plan,
        allowConfirmActions: Boolean(payload?.confirmActions),
      });

      const m7 = await runM7({ state, runtimeChat: this.runtimeChat });
      state.final_response_id = m7.final_response_id;
      this.metrics.recordRequest({
        scope: state.scope,
        durationMs: nowMs() - started,
        fallback: Boolean(state.uncertainty_reason),
      });
      return {
        kind: 'final_response',
        content: m7.content,
        metadata: this.buildMetadata(state, started),
      };
    } catch (err) {
      this.log(state, 'orchestrator.error', { error: err.message });
      this.metrics.recordRequest({
        scope: state.scope || 'page_related',
        durationMs: nowMs() - started,
        fallback: true,
      });
      return {
        kind: 'final_response',
        content: `I hit an internal orchestration error: ${err.message}`,
        metadata: this.buildMetadata(state, started),
      };
    }
  }

  buildMetadata(state, startedAt) {
    return {
      request_id: state.request_id,
      scope: state.scope,
      scope_confidence: state.scope_confidence,
      followup_count: state.followup_count,
      action_required: state.action_required,
      budget_metrics: state.budget_metrics,
      duration_ms: nowMs() - startedAt,
      logs: state.logs,
      aggregate_metrics: this.metrics.snapshot(),
    };
  }
}

module.exports = { Orchestrator };
