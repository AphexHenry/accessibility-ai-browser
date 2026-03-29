# AI Request Orchestration (Design Draft)

This document describes the **planned logic** for handling user AI requests in `src/renderer/browser.js`.
It is a product/engineering design draft only; it does **not** imply these steps are implemented yet.

## Goal

When a user sends a request, run several background assessments before producing the final answer so the assistant can decide:
- whether to answer directly from general knowledge,
- whether page HTML context is required,
- whether additional information is needed,
- whether browser actions should be executed (from a safe allowed-action dictionary).

## Non-goals (for now)

- No runtime implementation yet.
- No final prompt wording locked yet.
- No model-specific tuning locked yet.

## High-level pipeline

1. Receive user request.
2. Classify request intent:
   - **General knowledge** (no dependency on current page content), or
   - **Current page related** (depends on DOM/visible content/active page state).
3. If general knowledge:
   - Reply directly.
4. If current page related:
   - Run HTML minification pipeline and store result.
   - Check if extra information is required.
   - If required, attempt retrieval from conversation history (without raw HTML blobs) and user memory.
   - If still missing, ask user targeted follow-up question, store answer, and retry evaluation.
   - Ensure HTML payload fits context budget.
   - If still too large, further reduce and ask AI which page segments are most relevant, then provide only those segments.
   - Determine whether user request requires browser actions.
   - If actions are needed, map to allowed manipulation dictionary and execute in JS.
   - Return final answer to user.

## Detailed decision flow

## Step 1: Request intake

Input:
- user message text,
- short conversation context,
- memory snippets (if available),
- current page metadata (URL/title),
- optional minified HTML (if already cached for this tab and still valid).

Store:
- request id,
- timestamp,
- tab id / page id.

## Step 2: Determine request type

Decision: **Does this request require understanding the current page HTML?**

Signals for page-related requests:
- references like "this page", "here", "this button", "this section",
- tasks requiring element-level understanding,
- user asks "why is this not accessible?" for current content,
- intent that depends on visible layout/structure.

Signals for general knowledge:
- conceptual questions independent of current page,
- standards/spec explanations not tied to current DOM.

Output:
- `request_scope = general | page_related`
- confidence score + short rationale (for debugging/analytics later).

## Step 3: General knowledge branch

If `request_scope = general`:
- answer directly with normal chat pipeline,
- avoid expensive HTML operations,
- return response.

## Step 4: Page-related branch: HTML acquisition + minification

1. Capture current page representation.
2. Run HTML minifier/semantic reducer.
3. Store reduced HTML artifact and metadata:
   - char count,
   - token estimate,
   - extraction time,
   - source page fingerprint.

Notes:
- Keep a cache keyed by page fingerprint to avoid repeated expensive reductions.
- Prefer semantic reductions preserving landmarks, headings, form controls, labels, and actionable nodes.

## Step 5: Missing-information assessment loop

After initial page reduction, check if request is still underspecified.

Decision: **Do we need more information to answer correctly?**

If no:
- continue.

If yes:
1. Search conversation history (excluding raw HTML bodies).
2. Search structured user memory.
3. If found:
   - attach found facts,
   - store them as context inputs.
4. If not found:
   - ask user a focused follow-up question,
   - store user answer,
   - loop back to reassess whether enough info exists.

Exit condition:
- enough information for reliable answer/action planning.

## Step 6: Context-window budget enforcement

Before AI inference, enforce max context budget.

Decision: **Does reduced HTML fit the model context budget with other prompt parts?**

If yes:
- pass reduced HTML as context.

If no:
1. Apply stronger reduction (drop low-signal nodes, compress attributes, keep accessibility-critical elements).
2. If still too large:
   - run a "relevance selector" pass:
     - ask AI (or lightweight heuristic) which sections are likely relevant to user intent,
     - keep only selected segments/snippets.
3. Pass only selected relevant snippets + compact page summary.

## Step 7: Action requirement assessment

Decision: **Does the request require performing browser/page actions?**

Examples:
- highlight an element,
- click a button,
- modify CSS for preview/testing,
- scroll/focus/select.

If no:
- produce analysis/explanation-only response.

If yes:
1. Map intent to an allowed action in action dictionary.
2. Validate arguments and safety constraints.
3. Execute action in JS.
4. Capture action result/status.
5. Include executed-action feedback in final response.

## Step 8: Final response generation

Construct final response from:
- user request,
- selected context (memory + conversation + reduced/selected HTML),
- action execution outputs (if any).

Return:
- user-facing answer,
- optional short "what I used" trace internally (not necessarily shown).

## Proposed internal state model

Per request:
- `request_id`
- `scope_classification` (+ confidence)
- `html_artifact_id` (if page-related)
- `context_budget_stats`
- `missing_info_status`
- `followup_questions[]`
- `selected_actions[]`
- `final_response_id`

Per page/tab cache:
- `page_fingerprint`
- `minified_html`
- `token_estimate`
- `created_at`

## Action dictionary (concept)

Maintain an explicit allowlist of safe actions, each with:
- action name,
- expected arguments schema,
- permission/safety constraints,
- JS executor function mapping,
- rollback strategy if possible.

No free-form code execution should be allowed outside this dictionary.

## Suggested background tasks (concurrent where possible)

After message intake, run in parallel where dependencies permit:
- scope classifier,
- memory lookup,
- conversation fact extraction,
- page fingerprint + cached artifact check.

Run HTML minification only if classifier indicates page-related (or high uncertainty threshold policy decides to prefetch).

## Open design questions

- What confidence threshold decides general vs page-related fallback behavior?
- Which token budgeting method is used (exact tokenizer vs estimate)?
- Should follow-up questions be single-shot or multi-question form?
- How long should minified HTML cache stay valid across dynamic page changes?
- Which actions are enabled in v1 of the action dictionary?

## Minimal pseudo-flow

```text
onUserRequest(request):
  scope = classifyScope(request)
  if scope == GENERAL:
    return replyGeneral(request)

  html = minifyCurrentPage()
  while needsMoreInfo(request, html):
    info = findInConversationOrMemory(request)
    if info.missing:
      answer = askUserForMissingInfo(info.question)
      store(answer)
    else:
      attach(info)

  html = enforceContextBudget(html, request)
  actionPlan = detectRequiredActions(request, html)
  actionResult = maybeExecuteAllowedActions(actionPlan)
  return replyWithContextAndActions(request, html, actionResult)
```
