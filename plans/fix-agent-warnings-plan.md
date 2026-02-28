# Plan: Fix Agent Configuration Warnings

**Created:** 2026-02-27
**Status:** Ready for Atlas Execution

## Summary

Fix CLI warnings for all 7 `.agent.md` files in `.github/agents/`. There are two categories of issues: (1) unknown/unsupported frontmatter fields (`agents`, `handoffs`) and (2) model names that don't match any available model in the Copilot environment.

## Context & Analysis

**Relevant Files:**
- `.github/agents/Atlas.agent.md`: has `agents: ["*"]` (unknown field) + bad model name
- `.github/agents/Prometheus.agent.md`: has `handoffs:` block (unknown field) + bad model name
- `.github/agents/Code-Review-subagent.agent.md`: bad model name
- `.github/agents/Explorer-subagent.agent.md`: bad model name
- `.github/agents/Frontend-Engineer-subagent.agent.md`: bad model name
- `.github/agents/Oracle-subagent.agent.md`: bad model name
- `.github/agents/Sisyphus-subagent.agent.md`: bad model name

**Current Model Values → Issue:**

| File | Current `model` value | Problem |
|------|----------------------|---------|
| Atlas | `'Claude Sonnet 4.6 (copilot)'` | "4.6" doesn't exist |
| Prometheus | `'claude-opus-4.6'` | "4.6" doesn't exist, wrong format |
| Code-Review-subagent | `'GPT-5.2 (copilot)'` | "5.2" doesn't exist |
| Explorer-subagent | `'Gemini 3 Flash (Preview) (copilot)'` | "Gemini 3" doesn't exist |
| Frontend-Engineer-subagent | `'Gemini 3 Pro (Preview) (copilot)'` | "Gemini 3" doesn't exist |
| Oracle-subagent | `'GPT-5.2 (copilot)'` | "5.2" doesn't exist |
| Sisyphus-subagent | `'Claude-Sonnet-4.6(copilot)'` | "4.6" doesn't exist, wrong format |

**Reference from docs:** The `model` field should use the display name from the VS Code model picker. Format examples: `"Claude Sonnet 4"`, `"Claude Sonnet 4.5 (copilot)"`, `"GPT-5 (copilot)"`. Arrays are supported for fallback: `['first-choice', 'fallback']`.

## Implementation

### Phase 1: Remove Unknown Fields

**Objective:** Eliminate `agents` and `handoffs` warnings.

**Atlas.agent.md — Remove `agents: ["*"]`:**
The docs say omitting `agents` means "all agents allowed" — identical to the intent of `["*"]`. Simply delete the line.

```yaml
# BEFORE:
agents: ["*"]
model: 'Claude Sonnet 4.6 (copilot)'

# AFTER:
model: 'Claude Sonnet 4.6 (copilot)'
```

**Prometheus.agent.md — Remove `handoffs:` block:**
The CLI doesn't support this field. Remove the entire block (3 lines).

```yaml
# BEFORE:
model: 'claude-opus-4.6'
handoffs:
  - label: Start implementation with Atlas
    agent: Atlas
    prompt: Implement the plan

# AFTER:
model: 'claude-opus-4.6'
```

### Phase 2: Fix Model Names

**Objective:** Use model names that actually exist in the Copilot environment.

**IMPORTANT:** Before making changes, the executor (Atlas/user) MUST check which models are actually available. Open the VS Code model picker (dropdown in Copilot Chat) and note the exact display names.

**If the user cannot check the model picker**, the safest fix is to either:
- **Option A (recommended):** Remove the `model:` field entirely from all agents — this uses the default model for everything, which eliminates all warnings.
- **Option B:** Use model fallback arrays with known-good base names (without version suffixes).

**Option A — Remove all `model:` lines:**

| File | Remove line |
|------|-------------|
| Atlas.agent.md | `model: 'Claude Sonnet 4.6 (copilot)'` |
| Prometheus.agent.md | `model: 'claude-opus-4.6'` |
| Code-Review-subagent.agent.md | `model: 'GPT-5.2 (copilot)'` |
| Explorer-subagent.agent.md | `model: 'Gemini 3 Flash (Preview) (copilot)'` |
| Frontend-Engineer-subagent.agent.md | `model: 'Gemini 3 Pro (Preview) (copilot)'` |
| Oracle-subagent.agent.md | `model: 'GPT-5.2 (copilot)'` |
| Sisyphus-subagent.agent.md | `model: 'Claude-Sonnet-4.6(copilot)'` |

**Option B — Use likely-correct model names with fallbacks:**

Based on the doc examples and typical Copilot model availability, replace with:

| File | Intended tier | Suggested `model` value |
|------|--------------|------------------------|
| Atlas | Strong reasoning | `['Claude Sonnet 4 (copilot)', 'GPT-4o (copilot)']` |
| Prometheus | Strongest reasoning | `['Claude Opus 4 (copilot)', 'Claude Sonnet 4 (copilot)']` |
| Code-Review-subagent | Fast + cheap | `['GPT-4o (copilot)', 'Claude Sonnet 4 (copilot)']` |
| Explorer-subagent | Fast + cheap | `['Gemini 2.0 Flash (copilot)', 'GPT-4o mini (copilot)']` |
| Frontend-Engineer-subagent | Good reasoning | `['Gemini 2.5 Pro (copilot)', 'Claude Sonnet 4 (copilot)']` |
| Oracle-subagent | Fast + cheap | `['GPT-4o (copilot)', 'Claude Sonnet 4 (copilot)']` |
| Sisyphus-subagent | Strong coding | `['Claude Sonnet 4 (copilot)', 'GPT-4o (copilot)']` |

> **Note:** These are best guesses. The exact available model names depend on the user's Copilot subscription and VS Code version. Verify against the model picker before applying.

### Acceptance Criteria

- [ ] No "unknown field" warnings for any agent file
- [ ] No "model is not available" warnings for any agent file
- [ ] All agents still function correctly (can be invoked, subagents work)

## Open Questions

1. **Which models are actually available?**
   - **Recommendation:** Open the VS Code model picker (Copilot Chat → model dropdown) and use those exact names.
   - If uncertain, go with Option A (remove all `model:` fields) — it's the safest fix.

## Notes for Atlas

- Phase 1 (field removal) is safe to apply immediately — no ambiguity.
- Phase 2 (model names) requires user input to determine the correct model names. If the user doesn't specify, apply **Option A** (remove `model:` lines entirely).
- After changes, re-run the CLI that showed the warnings to verify they're gone.
