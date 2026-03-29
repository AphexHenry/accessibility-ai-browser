'use strict';

class OrchestrationMetrics {
  constructor() {
    this.totalRequests = 0;
    this.generalRequests = 0;
    this.pageRelatedRequests = 0;
    this.fallbackEvents = 0;
    this.totalDurationMs = 0;
  }

  recordRequest({ scope, durationMs, fallback }) {
    this.totalRequests += 1;
    if (scope === 'general') this.generalRequests += 1;
    if (scope === 'page_related') this.pageRelatedRequests += 1;
    if (fallback) this.fallbackEvents += 1;
    this.totalDurationMs += Number(durationMs || 0);
  }

  snapshot() {
    const avgDuration = this.totalRequests
      ? Math.round(this.totalDurationMs / this.totalRequests)
      : 0;
    return {
      totalRequests: this.totalRequests,
      generalRequests: this.generalRequests,
      pageRelatedRequests: this.pageRelatedRequests,
      fallbackEvents: this.fallbackEvents,
      avgDurationMs: avgDuration,
    };
  }
}

module.exports = { OrchestrationMetrics };
