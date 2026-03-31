'use strict';

function buildScamAssessmentPrompt({ pageMeta, navigation, pageSnapshot }) {
  return `You are a website risk analyst.
Assess how likely the current website is a scam.

Output strict JSON only:
{
  "score": 0-10,
  "confidence": 0.0-1.0,
  "verdict": "low" | "medium" | "high",
  "reasons": ["short bullet", "short bullet", "short bullet"],
  "recommended_user_action": "one short sentence",
  "explanation": "very short explanation under 200 characters"
}

Scoring policy:
- 0 means no scam signals found.
- 10 means very likely scam.
- Use conservative scoring when evidence is weak.
- Never invent facts. If information is missing, lower confidence.
- Keep reasons short and grounded in provided data.
- Keep explanation plain language and under 200 characters.

[PAGE META]
URL: ${pageMeta?.url || ''}
Title: ${pageMeta?.title || ''}

[NAVIGATION CONTEXT]
${JSON.stringify(navigation || {}, null, 2)}

[MINIFIED PAGE SNAPSHOT]
${pageSnapshot || '(empty page snapshot)'}`;
}

module.exports = { buildScamAssessmentPrompt };
