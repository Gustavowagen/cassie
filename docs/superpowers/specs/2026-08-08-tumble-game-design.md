# Tumble — cascading 5×6 slot

Date: 2026-08-08

A new game type (`tumble`), separate from `slots`. Full-board wins only, a
fixed 5×6 board, an admin-selectable 1–5% house edge, and a Gates-of-Olympus
style cascade: winning symbols pop, survivors fall, fresh symbols rain in, and
the new board pays again if it still qualifies.

## Rules

- 30 cells (5 rows × 6 columns). Every cell is an independent weighted draw.
- Symbols pay on **count anywhere on the board** — there are no paylines.
- Each symbol has its **own threshold** and is judged **independently**, so
  several symbols can pay on the same board. All of them pay and all of them
  pop; there is no tie-break.
- Three pay tiers per symbol: exactly the threshold, one above, two-or-more
  above.
- A paying board tumbles: every winning cell is removed, the survivors in each
  column keep their order and settle at the bottom, and fresh draws fill from
  the top. The cascade repeats until no symbol qualifies.
- **Every tumble pays**, and a round's wins add together.
- **Multiplier orbs** may drop on any paying tumble. All orbs collected in a
  round sum, and that total multiplies the round's whole win. Orbs never pay on
  their own — with no win the multiplier is irrelevant.

## Symbol table

Weights match `slots` so the design skins in `src/lib/slotsDesigns.ts` apply
unchanged.

| Symbol | Weight | Threshold | Pay (raw) | P(qualifies on opening board) |
|---|---|---|---|---|
| dot | 0.35 | 15 | 0.25 / 0.6 / 1.5 | 6.52% |
| square | 0.25 | 12 | 0.6 / 1.5 / 4 | 5.07% |
| diamond | 0.20 | 11 | 1.2 / 3 / 8 | 2.56% |
| star | 0.12 | 9 | 2.5 / 6.5 / 18 | 0.69% |
| seven | 0.08 | 8 | 6 / 16 / 50 | 0.20% |

The invariant the balance rests on: **a rarer symbol needs strictly fewer
cells, yet still wins strictly less often than every more-common symbol.**
Thresholds are strictly decreasing (15 > 12 > 11 > 9 > 8) while the exact
binomial tail probabilities are also strictly decreasing (6.52% > 5.07% >
2.56% > 0.69% > 0.20%). "A lot of a common symbol" is ~33× more likely than
"a few of the rarest". `engine.test.ts` asserts both orderings.

## Orbs

Per paying tumble: 0 orbs 84%, 1 orb 14%, 2 orbs 2%.

Values: ×2 (72%), ×3 (15%), ×5 (6%), ×10 (3%), ×25 (2%), ×50 (1.2%),
×100 (0.6%), ×250 (0.2%).

Orb values are **never** scaled by the house edge — the player sees ×25 on the
board and gets exactly ×25. Only the pay table moves with the edge.

## Exact RTP

Scoring depends on the board only through per-symbol **counts**, and a tumble
replaces each popped cell with an independent draw. So a round is a Markov
chain over count vectors summing to 30 — and only C(34,4) = **324,632** vectors
of sum ≤ 30 exist. The game is therefore solved **exactly**, not simulated.

The transition is evaluated by pushing a partial board up to a full one one
cell at a time (1.6M ops), instead of enumerating multinomial refills per
state.

Round payout is `W × max(1, M)`, where `W` is the summed pay of every tumble
and `M` the summed orb value. Since `max(1, M) = M + 1{M=0}` and `M` is a sum
of `L` i.i.d. draws independent of the board:

```
E[payout] = mu · E[W·L] + E[W · q^L]
```

with `mu` = expected orb value added by one winning step (0.8442) and
`q` = P(a winning step drops no orb) (0.84). `E[W·L]` and `E[W·q^L]` are each
solved as linear fixpoints over the chain, alongside `E[L]` and `E[q^L]`.

**`BASELINE_RTP = 1.070847083099`** (raw table, scale 1). `edgeScale` divides
it back down, so whichever edge the admin picks is the exact realized RTP.

### Resulting shape

- Hit rate: **15.01%** of spins
- Tumbles per winning round: **1.52**
- A round drops at least one orb: **3.36%**
- Orbs carry **62%** of total RTP

### Why these numbers

The cascade **ratchets**: symbols that don't win are never removed, so their
counts only grow while a chain runs. That makes rare symbols reachable by
grinding rather than luck, and it inflates RTP fast — an early candidate
(thresholds 13/11/10/8/7) came out at **767%** before orbs. Thresholds were
raised until chains stayed short enough that the published pay table lands near
scale 1 rather than being divided by 2.6 into humiliating numbers.

Orb strength is the other half of that tension: orb frequency and RTP share are
locked together (a ×2 floor means frequent orbs necessarily eat RTP, which
shrinks base pays). The chosen setting keeps the low symbol paying a visible
0.23× at a 3% edge while orbs still carry most of the upside.

### Verification

- Exact solve re-derived in `engine.test.ts` from the engine's own constants,
  so any edit to a threshold, pay or orb weight fails until `BASELINE_RTP` is
  recomputed. Mutation-checked: it rejects a 10th-decimal perturbation.
- Cross-checked against a literal simulation of the game (20M rounds, 3 seeds):
  chain-only RTP within **0.02–0.12%**, Rao-Blackwellised within **0.003–0.17%**,
  full simulation within 0.24–0.66% (the residual is the 250× orb tail).
- The orb algebra `E[max(1,M)|L] = L·mu + q^L` checked directly at L = 1,2,3,5
  (within 0.06%).
- End-to-end against the **deployed** edge function (700 live spins, 3% edge):
  Rao-Blackwellised RTP **0.9754** vs 0.97 target; hit rate 13.5%,
  tumbles/win 1.494, orb rounds 3.17% — all consistent with the model; zero
  structural errors over 600 rounds.

Raw-payout means from a few hundred spins read far below 0.97 — that is
expected, not a bug: most of the RTP sits in a heavy orb tail, so a small
sample almost always undershoots.

## Implementation

| Piece | Location |
|---|---|
| Engine (spin, cascade, orbs, payout) | `supabase/functions/tumble/engine.ts` |
| Edge function | `supabase/functions/tumble/index.ts` |
| Tests incl. exact RTP solve | `supabase/functions/tumble/engine.test.ts` |
| UI + cascade animation | `src/components/games/Tumble.tsx` |
| Shared symbol art / theme chrome | `src/components/games/slotsSkin.tsx` |
| Hook | `src/hooks/useTumble.ts` |
| Types | `src/types/index.ts` (`Tumble*`) |
| Migration | `supabase/migrations/047_tumble.sql` |

`slotsSkin.tsx` was extracted from `Slots.tsx` so both games share one copy of
the per-design icon art and theme chrome; `Slots.tsx` keeps its own reel layout
and spin animation.

The whole round resolves server-side in one request, so the bet and payout
settle in a single atomic balance update. The client only replays the returned
steps: the bet leaves the local balance the instant it is placed, and the
server's authoritative balance is applied only once the cascade animation
finishes, so the balance can never spoil the outcome mid-reveal.

## Settings

`casino_games.settings` for a tumble instance:

- `houseEdge` — one of 0.01…0.05. Missing/off-menu → 0.03, enforced
  server-side in `resolveHouseEdge` (the admin UI is not trusted).
- `design` — a `slotsDesigns.ts` id. Never affects odds.

Board size and reward mode are fixed by the game, so unlike slots there is
nothing else to configure.
