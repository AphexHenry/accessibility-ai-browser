'use strict';

const { ORCHESTRATION_CONFIG } = require('../config');
const { estimateTokens } = require('../utils');
const { validateM5Output } = require('../schemas');

function scoreElementLine(line, userMessage) {
  const lowered = line.toLowerCase();
  let score = 0;
  if (lowered.includes('id=')) score += 2;
  if (lowered.includes('name=')) score += 2;
  if (lowered.includes('aria-label=')) score += 2;
  if (lowered.includes('role=')) score += 1;
  if (lowered.includes('href=')) score += 1;
  const words = String(userMessage || '').toLowerCase().split(/\s+/).filter(Boolean);
  for (const word of words) {
    if (word.length > 3 && lowered.includes(word)) score += 1;
  }
  return score;
}

function splitSnapshot(snapshot) {
  const marker = '\n## Visible Element Map\n';
  const idx = snapshot.indexOf(marker);
  if (idx === -1) return { markdown: snapshot, elementMap: '' };
  return {
    markdown: snapshot.slice(0, idx),
    elementMap: snapshot.slice(idx + marker.length),
  };
}

function compactControls(markdown) {
  const lines = markdown.split('\n').filter((line) => /^[-*]\s+/.test(line) || /^#+\s+/.test(line));
  return lines.slice(0, 80).join('\n');
}

async function runM5({ state, runtimeChat }) {
  const budget = ORCHESTRATION_CONFIG.budget;
  const totalContextOverhead =
    budget.systemPrompt + budget.userMessage + budget.contextFacts + budget.actionSchema + budget.responseReserve;
  const htmlBudget = Math.max(256, ORCHESTRATION_CONFIG.modelContextBudget - totalContextOverhead);
  const fullSnapshot = state.page_snapshot || '';

  let selectedSnapshot = fullSnapshot;
  let reductionLevel = 'none';
  let selectedSections = [];

  if (estimateTokens(selectedSnapshot) > htmlBudget) {
    const split = splitSnapshot(fullSnapshot);
    if (split.elementMap) {
      const rankedLines = split.elementMap
        .split('\n')
        .map((line) => ({ line, score: scoreElementLine(line, state.user_message) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 180)
        .map((item) => item.line);
      selectedSnapshot = `${split.markdown}\n## Visible Element Map\n${rankedLines.join('\n')}`;
      reductionLevel = 'trim_element_map';
    }
  }

  if (estimateTokens(selectedSnapshot) > htmlBudget) {
    const sections = selectedSnapshot
      .split(/\n(?=#{1,3}\s)/g)
      .filter(Boolean)
      .map((section, index) => ({ id: `section-${index + 1}`, content: section.trim() }));
    const sectionPrompt = `The following page is too long to include in full.
Select the sections most relevant to answering the user's request.

User request: "${state.user_message}"

Page snapshot sections:
${sections.map((s) => `[${s.id}]\n${s.content}`).join('\n\n')}

Return JSON array of section ids only.`;
    let ids = [];
    try {
      const resp = await runtimeChat([{ role: 'user', content: sectionPrompt }]);
      const parsed = require('../utils').safeJsonParse(resp?.content);
      if (Array.isArray(parsed)) ids = parsed.filter((id) => typeof id === 'string');
    } catch {
      ids = [];
    }
    if (ids.length) {
      selectedSections = ids;
      const keep = sections.filter((s) => ids.includes(s.id)).map((s) => s.content);
      selectedSnapshot = keep.join('\n\n');
      reductionLevel = 'relevance_selector';
    }
  }

  if (estimateTokens(selectedSnapshot) > htmlBudget) {
    const split = splitSnapshot(selectedSnapshot);
    const compact = compactControls(split.markdown || selectedSnapshot);
    selectedSnapshot = compact || split.markdown || selectedSnapshot.slice(0, 8000);
    reductionLevel = 'headings_and_controls';
  }

  const output = {
    pageSnapshot: selectedSnapshot,
    metrics: {
      htmlBudget,
      fullTokens: estimateTokens(fullSnapshot),
      finalTokens: estimateTokens(selectedSnapshot),
      reductionLevel,
      selectedSections,
    },
  };
  const valid = validateM5Output(output);
  if (!valid.ok) {
    return {
      pageSnapshot: fullSnapshot.slice(0, 8000),
      metrics: {
        htmlBudget,
        fullTokens: estimateTokens(fullSnapshot),
        finalTokens: estimateTokens(fullSnapshot.slice(0, 8000)),
        reductionLevel: 'fallback',
        selectedSections: [],
      },
    };
  }
  return output;
}

module.exports = { runM5 };
