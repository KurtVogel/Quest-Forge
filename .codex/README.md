# Quest Forge — Codex working guide

Codex and Claude use the same project memory. Start with [AGENTS.md](../AGENTS.md);
keep its shared guidance in sync with [CLAUDE.md](../CLAUDE.md). This file contains
Codex-specific orientation, not a second architecture guide or backlog.

## Find the right document

| File | Read it for | Update it when |
| --- | --- | --- |
| [STATUS](../docs/STATUS.md) | Latest handoff and validation gaps | Work ships or a choice is settled; keep the current handoff at the top |
| [IDEAS](../docs/IDEAS.md) | Proposals and design thinking | An idea emerges or changes status; retain rejection reasons |
| [DECISIONS](../docs/DECISIONS.md) | Settled choices and rationale | A choice is settled; newest first; discuss reversals explicitly |
| [Strengthening](../docs/SCHEDULED_STRENGTHENING.md#open-findings-queue) | P0/P1/P2 correctness findings | A finding is verified or fixed; date the completion |
| [WOW](../docs/SCHEDULED_WOW.md#open-proposals) | W0/W1/W2 player-experience proposals | A selected slice ships; preserve queue cap and backlog-neutral audit rules |
| [Memory research](../docs/MEMORY_RESEARCH.md) | Memory doctrine, contenders, adoption queue | Evidence changes an assessment or a selected proposal ships |
| [Product](../docs/PRODUCT.md) | Product pillars and player value | Product direction is explicitly revised |
| [LLM wow layer](../docs/LLM_WOW_LAYER.md) | Narrative-memory design background | That design changes |

Search relevant sections instead of loading the historical archive on every turn:

```powershell
Get-Content docs/STATUS.md -TotalCount 60
rg -n '^## ' docs/DECISIONS.md docs/SCHEDULED_STRENGTHENING.md
rg -n '^\- \[ \]' docs/SCHEDULED_STRENGTHENING.md docs/SCHEDULED_WOW.md
rg -n -i 'combat|morale|telegraph' docs/IDEAS.md docs/DECISIONS.md
```

Read surrounding matching entries before acting; a match alone does not establish current
status. STATUS is a handoff; the live queues own their current open items.

## Session workflow

1. Inspect `git status --short --branch`, fetch origin, and review recent commits.
   On a clean master, use `git pull --ff-only origin master`. Preserve existing edits;
   investigate divergence instead of resetting or force-pushing. Follow the repository's
   master-only workflow, including its code-shipping deployment rule.
2. Read the current STATUS handoff and task-relevant entries above. Inspect code only
   as needed. Recheck old findings against current implementation.
3. For race/class/combat/balance work, use `rpg-balance-master` when available. Its
   [definition](agents/rpg-balance-master.toml) and
   [shared memory index](../.claude/agent-memory/rpg-balance-master/MEMORY.md) are tracked.
   Read relevant rulings explicitly; agent-memory files are not a substitute for loading
   their contents. If the runtime does not expose the agent, read its definition and
   rulings, perform the review directly, and report that limitation.
4. Use `npm.cmd` / `npx.cmd` on Windows. Run AGENTS' required checks for changed code;
   distinguish unit tests, build, real-provider playtests, and deployment evidence.
   For documentation-only work, check the diff, links, and twin consistency.
5. Update the shared handoff, decisions, and idea/queue statuses as applicable. Record
   what remains unverified. Keep durable project knowledge in tracked files so either
   tool can continue without access to this chat.

## Instruction loading and tool boundaries

The root AGENTS guide was about 145 KB at this review (2026-09-28), above Codex's default
32 KiB combined instruction budget. [config.toml](config.toml) sets
`project_doc_max_bytes = 196608` (192 KiB) for this project. Start a new session after a
configuration change; project configuration must be trusted for it to apply. Essential
navigation sits first in both root guides in case a runtime applies a smaller limit.
If supplied instructions are truncated, read relevant remaining sections explicitly.
Longer term, compact the root guides and move historical detail into linked references
rather than repeatedly raising the cap.

Official reference: [Codex AGENTS.md discovery and size limits](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

- This README is explicitly linked from AGENTS; arbitrary Markdown files are not
  automatically loaded. There is no need for a third root CODEX.md twin.
- Claude configuration and scheduled tasks do not become Codex tools or automations
  simply because files exist. Existing schedules remain owned by their documented
  runners. Consume their queues; create or migrate a schedule only when asked. An
  explicitly requested audit follows the same registry, rotation, and reporting rules.
- Keep shared balance findings under `.claude/agent-memory/rpg-balance-master/` and link
  them from its MEMORY index. `.codex/agent-memory/` bridges existing Codex notes.
  Avoid two independent sets of rulings; promote project-wide choices into DECISIONS.
- Tool availability, credentials, and hosted Linux browser paths are session capabilities,
  not guarantees of this Windows checkout. Check availability without printing secrets.
  Report unavailable real-provider validation honestly.
