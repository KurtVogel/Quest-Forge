# Agent dialogues — Claude ↔ Codex, through a file

A bounded written debate between two frontier models from different vendors, on one
question, on one checkout, while Vesa is away or watching. The value is the
DISAGREEMENT LIST at the end: where two models with different blind spots still weigh a
tradeoff differently is exactly what Vesa should decide. Two agents agreeing by
statement two is the failure mode, not deadlock.

**A dialogue authorizes nothing.** It never changes code, never writes IDEAS.md,
DECISIONS.md, or STATUS.md, and none of its proposals are settled project decisions
until Vesa says so. Active dialogues are git-ignored so the scheduled audits and
future sessions cannot mistake an argument for a decision. A closed transcript may be
kept as `<name>.closed.md` (un-ignored) when Vesa wants the record.

## Mechanics

- One file per dialogue: `docs/agent-dialogues/<date>-<slug>.md`. Both agents run on
  the SAME checkout (this repo, this machine). No commits mid-dialogue.
- The header carries `Status`, `Next speaker`, `Turn cap`, and `Timeout`. Only the
  named next speaker writes. A turn = re-read the whole file immediately before
  writing, append your statement at the END, flip `Next speaker`, write the file in
  ONE write. Never edit an earlier statement.
- Waiting: poll the file every 20–30 s for `Next speaker: <you>`. If the other side
  has not written within `Timeout`, append `## Timeout (<you>)` with a one-line
  note, set `Status: closed`, and stop.
- Cap: `Turn cap` statements EACH (default 4). Either side may write
  `Ready to close: yes` at the end of a statement; when both have said it the next
  speaker writes the Close instead of a statement. The LAST statement's author
  always writes the Close. The other side may then append ONE short `## Dissent`
  only if the Close misrepresents their position, then sets `Status: closed`.

## Statement shape (every statement, every side)

```
## <Agent> <n>
**Position.** What you claim, in a few sentences.
**Objections.** To the other side's LAST statement, numbered, each with the reason.
  Write "none" explicitly if you have none — silence is not agreement.
**Concessions.** What in their last statement changed your mind, numbered, or "none".
**Cites.** Files, functions, DECISIONS/IDEAS entries, playtest reports that carry
  your claims. Argue from the repo, not from memory of it.
**Question.** ONE question for the other side.
Ready to close: no | yes
```

Every proposal for the project must say: (a) what the PLAYER feels that they do not
feel today, (b) which existing shelf it lands on (name the file / subsystem — a shelf
that already exists beats a new one), (c) rough cost (one session / several / a
research spike), (d) the IDEAS.md entry it duplicates or extends, if any.

When a disagreement turns out to be about Vesa's taste rather than about facts or
code, both sides stop arguing it and list it under `Questions for Vesa` instead.

## Close shape

```
## Close
**Agreed.** Numbered, each one sentence, with the strongest reason.
**Contested.** Numbered; for each, one sentence per side on why they hold.
**Recommended next slices.** Ranked, ≤3, each with cost and the shelf it lands on.
**Questions for Vesa.** The taste calls only Vesa can make.
**What we read.** The files each side actually opened.
```
