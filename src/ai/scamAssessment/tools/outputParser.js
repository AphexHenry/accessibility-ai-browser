'use strict';

function safeJsonParse(text) {
  const source = String(text || '').trim();
  if (!source) return null;
  const stripped = source
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

function clampScore(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return 5;
  return Math.max(0, Math.min(10, Math.round(num * 10) / 10));
}

function clampConfidence(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return 0.35;
  return Math.max(0, Math.min(1, Math.round(num * 100) / 100));
}

function normalizeReasons(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, 4);
}

function parseAssessment(content) {
  const parsed = safeJsonParse(content);
  if (!parsed || typeof parsed !== 'object') {
    return {
      score: 5,
      confidence: 0.2,
      verdict: 'medium',
      reasons: ['Model response could not be parsed safely.'],
      recommended_user_action: 'Be cautious and verify the site independently.',
      fallback: true,
    };
  }

  const verdict = ['low', 'medium', 'high'].includes(parsed.verdict) ? parsed.verdict : 'medium';
  return {
    score: clampScore(parsed.score),
    confidence: clampConfidence(parsed.confidence),
    verdict,
    reasons: normalizeReasons(parsed.reasons),
    recommended_user_action: String(parsed.recommended_user_action || '').trim()
      || 'Be cautious and verify the site independently.',
    fallback: false,
  };
}

module.exports = { parseAssessment };
