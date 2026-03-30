'use strict';

const { ORCHESTRATION_CONFIG } = require('./config');
const { createRequestState } = require('./state');
const { PageSnapshotCache } = require('./cache/pageSnapshotCache');
const { assessIntent } = require('./modules/m0Intent');
const { runM0Interaction } = require('./modules/m0Interaction');
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
  constructor({ runtimeChat, simplifyCurrentPage, getPageMeta, getWebContents, memoryLookup, logger, openSetup }) {
    this.runtimeChat = runtimeChat;
    this.simplifyCurrentPage = simplifyCurrentPage;
    this.getPageMeta = getPageMeta;
    this.getWebContents = getWebContents;
    this.memoryLookup = memoryLookup || (async () => []);
    this.logger = logger || (() => {});
    this.openSetup = openSetup;
    this.pageCache = new PageSnapshotCache(ORCHESTRATION_CONFIG.pageCacheTtlMs);
    this.metrics = new OrchestrationMetrics();
  }

  log(state, event, extra = {}) {
    const row = { t: Date.now(), event, ...extra };
    state.logs.push(row);
    this.logger(`[orchestration:${state.request_id}] ${event}`, extra);
  }

  truncateForLog(value, maxChars = 700) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (!text) return '';
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}... [truncated ${text.length - maxChars} chars]`;
  }

  summarizeMessages(messages) {
    if (!Array.isArray(messages)) return [];
    return messages.map((msg) => ({
      role: msg?.role || 'unknown',
      content: this.truncateForLog(msg?.content || ''),
    }));
  }

  wrapRuntimeChat(state, moduleName) {
    return async (messages) => {
      this.log(state, `${moduleName}.prompt`, { messages: this.summarizeMessages(messages) });
      const response = await this.runtimeChat(messages);
      this.log(state, `${moduleName}.response`, {
        content: this.truncateForLog(response?.content || ''),
      });
      return response;
    };
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
      this.log(state, 'request.received', {
        message: this.truncateForLog(state.user_message, 300),
        followup_count: state.followup_count,
        has_followup_answer: Boolean(payload?.followupAnswer),
        confirm_actions: Boolean(payload?.confirmActions),
        page: {
          url: this.truncateForLog(state.page?.url || '', 300),
          title: this.truncateForLog(state.page?.title || '', 160),
        },
      });

      const intent = assessIntent(state.user_message);
      state.intent = intent.intent;
      state.intent_rationale = intent.rationale;
      state.allow_shared_actions = intent.allow_shared_actions;
      this.log(state, 'm0.intent_assessed', {
        intent: state.intent,
        allow_shared_actions: state.allow_shared_actions,
      });

      // M0b + M1 + M3 foundation
      const foundationStart = nowMs();
      const [m0b, m1, contextFacts] = await Promise.all([
        runM0Interaction({ state, runtimeChat: this.wrapRuntimeChat(state, 'm0b') }).catch(() => ({
          interaction_mode: 'inform',
          action_target: state.allow_shared_actions ? 'shared' : 'none',
          needs_page_understanding: false,
          confidence: 0,
          rationale: 'fallback due to classifier failure',
          fallback: true,
        })),
        runM1({ state, runtimeChat: this.wrapRuntimeChat(state, 'm1') }).catch(() => ({
          scope: 'page_related',
          confidence: 0,
          rationale: 'fallback due to classifier failure',
          fallback: true,
        })),
        runM3({ state, memoryLookup: this.memoryLookup }),
      ]);
      state.timings.m0b_m1_m3 = nowMs() - foundationStart;
      state.interaction_mode = m0b.interaction_mode;
      state.action_target = m0b.action_target;
      state.interaction_confidence = m0b.confidence;
      state.interaction_rationale = m0b.rationale;
      state.needs_page_understanding = Boolean(m0b.needs_page_understanding);
      if (state.action_target === 'shared') {
        state.allow_shared_actions = true;
      }
      state.scope = m1.scope;
      state.scope_confidence = m1.confidence;
      state.scope_rationale = m1.rationale;
      state.context_facts = contextFacts;
      this.log(state, 'm0b.output', {
        interaction_mode: state.interaction_mode,
        action_target: state.action_target,
        needs_page_understanding: state.needs_page_understanding,
        confidence: state.interaction_confidence,
        rationale: this.truncateForLog(state.interaction_rationale, 300),
      });
      this.log(state, 'm1.scope_decided', { scope: state.scope, confidence: state.scope_confidence });
      this.log(state, 'm1.output', {
        scope: state.scope,
        confidence: state.scope_confidence,
        rationale: this.truncateForLog(state.scope_rationale, 300),
      });
      this.log(state, 'm3.output', {
        context_facts_count: state.context_facts.length,
      });

      if (state.scope === 'general' && state.interaction_mode === 'inform') {
        const m7 = await runM7({ state, runtimeChat: this.wrapRuntimeChat(state, 'm7') });
        state.final_response_id = m7.final_response_id;
        this.log(state, 'm7.output', { content: this.truncateForLog(m7.content || '', 600) });
        this.metrics.recordRequest({ scope: state.scope, durationMs: nowMs() - started, fallback: false });
        return {
          kind: 'final_response',
          content: m7.content,
          metadata: this.buildMetadata(state, started),
        };
      }

      const webContents = this.getWebContents();
      const needsPageContext = state.scope === 'page_related'
        || (state.interaction_mode === 'act' && state.action_target === 'page_only')
        || state.needs_page_understanding;
      if (needsPageContext && (!webContents || webContents.isDestroyed())) {
        throw new Error('No active page available for this request.');
      }
      if (needsPageContext) {
        // M2 with cache
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
      }

      if (needsPageContext) {
        // M4 followup loop
        const gap = await runM4({ state, runtimeChat: this.wrapRuntimeChat(state, 'm4') }).catch(() => ({
          has_enough_info: true,
          missing: null,
          followup_question: null,
          fallback: true,
        }));
        this.log(state, 'm4.output', {
          has_enough_info: gap.has_enough_info,
          missing: this.truncateForLog(gap.missing || '', 240),
          followup_question: this.truncateForLog(gap.followup_question || '', 240),
          fallback: Boolean(gap.fallback),
        });
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
      }

      if (needsPageContext) {
        // M5 always, M6 only for actionable requests.
        const [budgeted, actionPlan] = await Promise.all([
          runM5({ state, runtimeChat: this.wrapRuntimeChat(state, 'm5') }).catch(() => ({
            pageSnapshot: (state.page_snapshot || '').slice(0, 8000),
            metrics: {
              htmlBudget: ORCHESTRATION_CONFIG.budget.htmlBudget,
              fullTokens: estimateTokens(state.page_snapshot || ''),
              finalTokens: estimateTokens((state.page_snapshot || '').slice(0, 8000)),
              reductionLevel: 'fallback_error',
              selectedSections: [],
            },
          })),
          state.interaction_mode === 'act'
            ? runM6({ state, runtimeChat: this.wrapRuntimeChat(state, 'm6') }).catch(() => ({
              action_required: false,
              plan: [],
              fallback: true,
            }))
            : Promise.resolve({ action_required: false, plan: [], skipped: true }),
        ]);
        state.budget_enforced = true;
        state.relevant_snapshot = budgeted.pageSnapshot;
        state.relevant_snippets = budgeted.metrics.selectedSections || [];
        state.budget_metrics = budgeted.metrics;
        state.action_required = actionPlan.action_required;
        state.action_plan = actionPlan.plan;
        this.log(state, 'm5.output', {
          reductionLevel: budgeted?.metrics?.reductionLevel,
          fullTokens: budgeted?.metrics?.fullTokens,
          finalTokens: budgeted?.metrics?.finalTokens,
          selectedSections: budgeted?.metrics?.selectedSections || [],
        });
        if (state.interaction_mode === 'act') {
          this.log(state, 'm6.output', {
            action_required: state.action_required,
            plan: state.action_plan,
          });
        } else {
          this.log(state, 'm6.skipped', { reason: 'interaction_mode=inform' });
        }
      } else {
        const actionPlan = state.interaction_mode === 'act'
          ? await runM6({ state, runtimeChat: this.wrapRuntimeChat(state, 'm6') }).catch(() => ({
            action_required: false,
            plan: [],
            fallback: true,
          }))
          : { action_required: false, plan: [], skipped: true };
        state.action_required = actionPlan.action_required;
        state.action_plan = actionPlan.plan;
        if (state.interaction_mode === 'act') {
          this.log(state, 'm6.output', {
            action_required: state.action_required,
            plan: state.action_plan,
          });
        } else {
          this.log(state, 'm6.skipped', { reason: 'interaction_mode=inform' });
        }
      }

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
        openSetup: this.openSetup,
      });
      this.log(state, 'actions.executed', { results: state.action_results });

      const m7 = await runM7({ state, runtimeChat: this.wrapRuntimeChat(state, 'm7') });
      state.final_response_id = m7.final_response_id;
      this.log(state, 'm7.output', { content: this.truncateForLog(m7.content || '', 600) });
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
      intent: state.intent,
      interaction_mode: state.interaction_mode,
      action_target: state.action_target,
      interaction_confidence: state.interaction_confidence,
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
