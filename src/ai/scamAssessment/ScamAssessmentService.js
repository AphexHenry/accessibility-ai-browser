'use strict';

const { buildNavigationSummary } = require('./tools/navigationContext');
const { buildScamAssessmentPrompt } = require('./tools/promptBuilder');
const { parseAssessment } = require('./tools/outputParser');

class ScamAssessmentService {
  constructor({ runtimeChat, simplifyCurrentPage, getWebContents, getPageMeta, logger, onResult }) {
    this.runtimeChat = runtimeChat;
    this.simplifyCurrentPage = simplifyCurrentPage;
    this.getWebContents = getWebContents;
    this.getPageMeta = getPageMeta;
    this.logger = logger || (() => {});
    this.onResult = onResult || (() => {});
    this.latest = {
      status: 'idle',
      score: null,
      confidence: 0,
      verdict: 'medium',
      reasons: [],
      recommended_user_action: '',
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

    try {
      const snapshot = await this.simplifyCurrentPage(webContents, pageMeta.url || '');
      if (jobId !== this.currentJobId) return;

      const prompt = buildScamAssessmentPrompt({
        pageMeta,
        navigation: navSummary,
        pageSnapshot: snapshot?.markdown || '',
      });
      this.logger('[scam-assessment] prompt', {
        url: pageMeta.url,
        title: pageMeta.title,
        snapshot_chars: snapshot?.markdown?.length || 0,
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

      const parsed = parseAssessment(response?.content || '');
      const finalResult = {
        status: 'done',
        score: parsed.score,
        confidence: parsed.confidence,
        verdict: parsed.verdict,
        reasons: parsed.reasons,
        recommended_user_action: parsed.recommended_user_action,
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
