'use strict';

function buildNavigationSummary(navigationState) {
  const state = navigationState || {};
  const redirects = Array.isArray(state.redirectChain) ? state.redirectChain : [];
  return {
    trigger: state.trigger || { type: 'unknown', detail: '' },
    started_at: state.startedAt || null,
    finished_at: Date.now(),
    navigation_ms: typeof state.startedAt === 'number' ? Math.max(0, Date.now() - state.startedAt) : null,
    response: {
      code: typeof state.responseCode === 'number' ? state.responseCode : null,
      status_text: state.responseStatusText || '',
    },
    started_url: state.startedUrl || '',
    final_url: state.finalUrl || '',
    redirect_chain: redirects,
    redirect_count: redirects.length,
    same_document: Boolean(state.sameDocument),
    previous_page: state.previousPage || { url: '', title: '' },
  };
}

module.exports = { buildNavigationSummary };
