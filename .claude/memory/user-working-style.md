---
name: user-working-style
description: "How the Humboldt user likes to work — ask first, incremental, push commits, keep CLAUDE.md synced"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: dbd8c410-b7d7-4542-881b-bd83b4d4d633
---

Working preferences observed on [[project-map-quiz]]:

- **Ask clarifying questions BEFORE big/creative changes.** The user explicitly and repeatedly wants
  to be asked ("ask any questions that arise", "do not assume"). Use AskUserQuestion for real forks;
  they engage well and often refine the option (e.g. corrected the name-identity model, self-hosted
  uploads). Don't over-ask trivia — decide sensible defaults and state them.
- **Build incrementally and test rigorously** before moving on. They deliberately staged: scaffold →
  sync test → editor → join flow → game. They like "very basic" first passes to test, then extend.
- **Commit + push are expected** — pushing to `main` is how DB migrations deploy
  ([[deploy-verify-workflow]]). Keep commits scoped; end messages with the Co-Authored-By trailer.
- **Keep CLAUDE.md as the living architecture doc** — update it in the same commit as any
  architectural change (their own rule, and they open the file to review edits).

**Why:** the user is the sole developer/operator of a one-off live-event app; they value being in the
loop on decisions and want durable, self-consistent docs over speed.

**How to apply:** lead with questions on forks, recommend an option, show a short design before large
implementations; verify + report honestly (what's tested vs not); update CLAUDE.md + push. Strict
5-colour palette always ([[color-palette-rule]]).
