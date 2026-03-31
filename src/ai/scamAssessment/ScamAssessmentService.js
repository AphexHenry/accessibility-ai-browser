'use strict';

const fs = require('fs');
const path = require('path');

const { buildNavigationSummary } = require('./tools/navigationContext');
const { buildScamAssessmentPrompt } = require('./tools/promptBuilder');
const { parseAssessment } = require('./tools/outputParser');

const TYPE_A_ALLOWLIST_CSV = path.join(__dirname, '../../../domains_green_list/type_a_allowlist.csv');
const CHARS_PER_TOKEN_ESTIMATE = 4;
const INPUT_TOKEN_RATIO = 0.75;
const TOKEN_HEADROOM = 512;

let allowlistedDomains = null;
let allowlistLoadError = null;

function normalizeHost(input) {
  return String(input || '').trim().toLowerCase().replace(/\.$/, '');
}

function loadAllowlistedDomains(logger) {
  if (allowlistedDomains) return allowlistedDomains;
  if (allowlistLoadError) return new Set();

  try {
    const csv = fs.readFileSync(TYPE_A_ALLOWLIST_CSV, 'utf8');
    const lines = csv.split(/\r?\n/);
    const set = new Set();
    for (const line of lines) {
      const domain = normalizeHost(line);
      if (!domain || domain === 'domain') continue;
      set.add(domain);
    }
    allowlistedDomains = set;
    logger?.('[scam-assessment] loaded allowlist', { count: set.size });
    return allowlistedDomains;
  } catch (err) {
    allowlistLoadError = err;
    logger?.('[scam-assessment] allowlist load failed', { error: err.message, path: TYPE_A_ALLOWLIST_CSV });
    return new Set();
  }
}

function isAllowlistedUrl(url, logger) {
  if (!url) return false;

  let hostname = '';
  try {
    hostname = normalizeHost(new URL(url).hostname);
  } catch (_err) {
    return false;
  }
  if (!hostname) return false;

  const set = loadAllowlistedDomains(logger);
  if (set.has(hostname)) return true;

  // Treat subdomains of an allowlisted domain as safe too.
  const labels = hostname.split('.');
  for (let idx = 1; idx < labels.length; idx += 1) {
    const suffix = labels.slice(idx).join('.');
    if (set.has(suffix)) return true;
  }
  return false;
}

class ScamAssessmentService {
  constructor({ runtimeChat, simplifyCurrentPage, getWebContents, getPageMeta, getModelContextWindowInfo, logger, onResult }) {
    this.runtimeChat = runtimeChat;
    this.simplifyCurrentPage = simplifyCurrentPage;
    this.getWebContents = getWebContents;
    this.getPageMeta = getPageMeta;
    this.getModelContextWindowInfo = getModelContextWindowInfo || (() => ({
      modelId: '',
      modelContextTokens: null,
      runtimeContextTokens: 4096,
      effectiveContextTokens: 4096,
    }));
    this.logger = logger || (() => {});
    this.onResult = onResult || (() => {});
    this.latest = {
      status: 'idle',
      score: null,
      confidence: 0,
      verdict: 'medium',
      reasons: [],
      recommended_user_action: '',
      explanation: '',
      fallback: false,
      url: '',
      title: '',
      started_at: null,
      finished_at: null,
      error: null,
    };
    this.currentJobId = 0;
  }

  getLatest() {
    return this.latest;
  }

  emit(result) {
    this.latest = result;
    this.onResult(result);
  }

  computePromptBudgetChars() {
    const ctx = this.getModelContextWindowInfo();
    const effectiveContextTokens = Number(ctx?.effectiveContextTokens) > 0
      ? Number(ctx.effectiveContextTokens)
      : 4096;
    const inputTokenBudget = Math.max(
      512,
      Math.floor(effectiveContextTokens * INPUT_TOKEN_RATIO) - TOKEN_HEADROOM
    );
    return {
      modelId: ctx?.modelId || '',
      modelContextTokens: Number(ctx?.modelContextTokens) || null,
      runtimeContextTokens: Number(ctx?.runtimeContextTokens) || 4096,
      effectiveContextTokens,
      inputTokenBudget,
      promptCharBudget: inputTokenBudget * CHARS_PER_TOKEN_ESTIMATE,
    };
  }

  async assess(navigationState) {
    const webContents = this.getWebContents();
    if (!webContents || webContents.isDestroyed()) return;

    const pageMeta = this.getPageMeta();
    const navSummary = buildNavigationSummary(navigationState);
    const startedAt = Date.now();
    const jobId = ++this.currentJobId;

    this.emit({
      ...this.latest,
      status: 'running',
      url: pageMeta.url || '',
      title: pageMeta.title || '',
      started_at: startedAt,
      finished_at: null,
      error: null,
    });

    if (isAllowlistedUrl(pageMeta.url, this.logger)) {
      const allowlistedResult = {
        status: 'done',
        score: 0,
        confidence: 1,
        verdict: 'low',
        reasons: ['Domain is in trusted allowlist.'],
        recommended_user_action: 'No scam indicators from domain trust pre-check.',
        explanation: 'This domain is in our private safe list.',
        fallback: false,
        url: pageMeta.url || '',
        title: pageMeta.title || '',
        started_at: startedAt,
        finished_at: Date.now(),
        error: null,
      };
      this.logger('[scam-assessment] allowlist bypass', {
        url: pageMeta.url,
        hostname: (() => {
          try {
            return new URL(pageMeta.url || '').hostname;
          } catch (_err) {
            return '';
          }
        })(),
      });
      this.emit(allowlistedResult);
      return;
    }

    try {
      const snapshot = await this.simplifyCurrentPage(webContents, pageMeta.url || '');
      if (jobId !== this.currentJobId) return;

      const budget = this.computePromptBudgetChars();
      const rawSnapshot = snapshot?.markdown || '';
      const promptWithoutSnapshot = buildScamAssessmentPrompt({
        pageMeta,
        navigation: navSummary,
        pageSnapshot: '',
      });
      const maxSnapshotChars = Math.max(0, budget.promptCharBudget - promptWithoutSnapshot.length);
      const truncationSuffix = '\n...[truncated for model context budget]';
      const snapshotWasTruncated = rawSnapshot.length > maxSnapshotChars;
      const snapshotForPrompt = snapshotWasTruncated
        ? rawSnapshot.slice(0, Math.max(0, maxSnapshotChars - truncationSuffix.length)) + truncationSuffix
        : rawSnapshot;
      const prompt = buildScamAssessmentPrompt({
        pageMeta,
        navigation: navSummary,
        pageSnapshot: snapshotForPrompt,
      });
      this.logger('[scam-assessment] prompt', {
        url: pageMeta.url,
        title: pageMeta.title,
        model_id: budget.modelId,
        model_ctx_tokens: budget.modelContextTokens,
        runtime_ctx_tokens: budget.runtimeContextTokens,
        effective_ctx_tokens: budget.effectiveContextTokens,
        input_token_budget: budget.inputTokenBudget,
        prompt_char_budget: budget.promptCharBudget,
        prompt_chars: prompt.length,
        snapshot_chars: rawSnapshot.length,
        snapshot_prompt_chars: snapshotForPrompt.length,
        snapshot_truncated: snapshotWasTruncated,
        redirects: navSummary.redirect_count,
      });

      const response = await this.runtimeChat([
        {
          role: 'system',
          content: 'You assess scam likelihood from page content and navigation context. Respond with strict JSON only.',
        },
        { role: 'user', content: prompt },
      ]);
      if (jobId !== this.currentJobId) return;
      const rawContent = String(response?.content || '');
      this.logger('[scam-assessment] raw model response', {
        chars: rawContent.length,
        has_content: Boolean(rawContent.trim()),
        content: rawContent,
      });

      const parsed = parseAssessment(rawContent);
      this.logger('[scam-assessment] parsed model response', {
        fallback: Boolean(parsed.fallback),
        verdict: parsed.verdict,
        score: parsed.score,
        confidence: parsed.confidence,
        reasons_count: Array.isArray(parsed.reasons) ? parsed.reasons.length : 0,
      });
      const finalResult = {
        status: 'done',
        score: parsed.score,
        confidence: parsed.confidence,
        verdict: parsed.verdict,
        reasons: parsed.reasons,
        recommended_user_action: parsed.recommended_user_action,
        explanation: parsed.explanation,
        fallback: Boolean(parsed.fallback),
        url: pageMeta.url || '',
        title: pageMeta.title || '',
        started_at: startedAt,
        finished_at: Date.now(),
        error: null,
      };
      this.logger('[scam-assessment] result', finalResult);
      this.emit(finalResult);
    } catch (err) {
      if (jobId !== this.currentJobId) return;
      this.logger('[scam-assessment] failed', { error: err.message });
      this.emit({
        status: 'error',
        score: null,
        confidence: 0,
        verdict: 'medium',
        reasons: [],
        recommended_user_action: '',
        explanation: 'Scam assessment failed, so no detailed explanation is available.',
        fallback: false,
        url: pageMeta.url || '',
        title: pageMeta.title || '',
        started_at: startedAt,
        finished_at: Date.now(),
        error: err.message,
      });
    }
  }
}

module.exports = { ScamAssessmentService };
