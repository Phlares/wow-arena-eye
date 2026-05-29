# wow-arena-eye — v1 Design (Spine + Comparative Scorecard)

**Date:** 2026-05-29
**Status:** Approved design, pre-implementation
**Author:** brainstormed with Claude

---

## 1. What this is

A personal tool that ingests a top-tier WoW arena player's own combat logs and video
recordings, derives objective per-match behavioral metrics, and presents a **comparative
scorecard** — "what I did this match, and how it compares to my own history (same comp,
same map, my season-best, my win-vs-loss split)."

It is the foundation for a longer-term dream: an analysis layer that *infers* which
behaviors drive wins vs losses, and eventually an AI/agent layer that reviews matches and
coaches in natural language. v1 deliberately builds only the data spine and the scorecard;
everything else is named and deferred.

### The core insight that shapes the project

The user is consistently a **top-10 Affliction warlock in NA / top-25 world**. That makes
their own play a high-quality reference signal. We do **not** need external expert data to
start: compute a wide battery of measurable behaviors, then let the user's *own win/loss
outcomes* reveal which behaviors separate their wins from their losses, holding comp / map /
rating band constant. The user is the benchmark. External ladder data (drustvar, murlok.io,
dataforazeroth, wowarenalogs) is a later enrichment, and is mostly macro (ratings, comp
popularity, talent builds) rather than the micro behavioral signal that is the actual goal.

---

## 2. Non-negotiable principles

1. **Public-ready, private-separate.** The repo is generic and shippable. All private data
   — logs, videos, the database, the player's identity (GUID/name/realm), and every
   filesystem path — lives **outside** the repo and is supplied via local config. **No
   hardcoded paths, no committed player identity, no bulky data/fixtures in the repo.** Ship
   a `config.example` template; the real config is git-ignored.
2. **Read-only against the game.** We only ever *read* the combat log the game writes. We
   never write into the WoW install, never read game memory, never automate gameplay. This
   is the sanctioned, ban-safe path (confirmed below).
3. **Capture broadly now, decide intelligence later.** v1 does not try to pick the "right"
   metrics. It tracks a wide, extensible feature surface and **stores enough granularity to
   derive new metrics retroactively** without re-ingesting. A feature registry makes adding
   a tracked variable a small, isolated change.
4. **Season-safe comparisons.** Raw throughput is meaningless across seasons (Midnight
   squished item level ~560 / stats >99%). Every record is stamped with patch/season; the
   tool never compares absolute numbers across season boundaries — only within, or via
   normalized/relative measures.
5. **The store is the contract.** v1 is single-language (TypeScript/Node). Later phases
   (inference, agents, post-training/LoRA) read/write the same local database without
   touching v1.

---

## 3. Decomposition (the full dream, phased)

| Phase | Deliverable | Status |
|---|---|---|
| **1. Ingest & store** | Read logs (wowarenalogs parser) → align to video sidecars → normalize into local DB; also ingest all video sidecars for macro baseline | **v1** |
| **2. Metric battery** | Broad, extensible feature extraction (Affliction 3v3 first) | **v1** |
| **3. Comparative scorecard** | Per-match metrics + deltas vs own history/season-best/win-loss split | **v1** |
| 4. Inference | Win-vs-loss feature importance — "what my winning self does differently" | next |
| 5. AI / agent narrative | LangGraph agent reads the store → contextual coaching prose | later |
| 6. Enrichment | External benchmarks, season-context currency, synced video-review UI | later |

**v1 = phases 1–3.** Phase 4 is the immediate follow-on and the store/feature-registry are
designed to feed it (and an eventual training pipeline).

---

## 4. Architecture (v1)

Four components, all TypeScript/Node, joined by a local SQLite database.

```
live .txt log ──tail(read-only)──▶ ParserAdapter (wowarenalogs) ──▶ match objects
                                                                        │
        Warcraft Recorder .json sidecar ──▶ SidecarMatcher ────────────┤ (+video path, result, MMR, deaths)
                                                                        ▼
                                            Normalizer ──▶ SQLite ──▶ MetricBattery ──▶ Scorecard (JSON + CLI)
```

- **`LogWatcher`** — watches the configured logs *directory*, filters `WoWCombatLog*.txt`,
  reads only new `[lastSize → currentSize]` byte ranges per file, resets offset to 0 when a
  new session file appears. Never writes to the watched directory. Mirrors Warcraft
  Recorder's `CombatLogWatcher.ts` (the verified reference implementation). Works equally on
  a live directory or a directory of staged copies — the path is config.
- **`ParserAdapter`** — vendors the wowarenalogs `WoWCombatLogParser` **unmodified** (git
  submodule / vendored source; not on npm). Feeds it lines, receives typed `IArenaMatch` /
  `IShuffleRound` objects: combatants, specs, talents/gear (`COMBATANT_INFO`), full ordered
  event stream, win/loss, MMR, per-unit derived buckets (`spellCastEvents`, `auraEvents`,
  `actionIn/Out`, `deathRecords`, `advancedActions`).
- **`SidecarMatcher`** — links each parsed match to its Warcraft Recorder `.json` sidecar
  (and `.mp4` path) by start-epoch + zone + combatant set. Pulls in `result`, `teamMMR`,
  `deaths`, and the video path. Player GUID links the two cleanly (verified). Sidecar
  directories (live + archive) are config.
- **`Normalizer` → SQLite** — writes normalized, idempotent records.

### Language note (portfolio seams)

LangGraph and the ML/post-training ecosystem are Python-strong; the parser is TS. v1 stays
all-TS for shippability. When phases 4–5 arrive, Python joins **through the database** (or
LangGraph.js keeps the agent layer in TS — decided then). The DB schema, not a language, is
the integration boundary.

---

## 5. Data sources (verified reality, 2026-05-29)

| Source | Location (example — all config) | Coverage | Granularity |
|---|---|---|---|
| Live combat logs | `…\_retail_\Logs\WoWCombatLog-*.txt` | 531 files, current = build **12.0.5**, advanced logging ON, `COMBAT_LOG_VERSION,22` | Micro (every event) |
| Current videos + sidecars | `<current videos dir>` | 635 mp4 + 635 json, current 3v3 + Solo Shuffle | Macro per match |
| Archived videos + sidecars | `<archived videos dir>` (NAS) | ~13,850 mp4 + ~13,842 json, 2023-05 → 2026-01 | Macro per match |
| Archived logs | old repo `…\Logs` | 274 files, Jan–Jul 2025 (build 11.x) | Micro (older season) |
| Staged dev corpus | `<sampleLogsDir>` | 3 current 12.0.5 sessions (~160 arena matches); newest pairs with 2026-05-29 videos | Golden-test source |

**The asymmetry that matters:** video sidecars exist for ~2.5 years (macro: comp, specs,
result, deaths, MMR), but combat logs (micro: kicks, dispels, positioning) exist only where
logged. The tool is most powerful on current/ongoing matches, with a deep sidecar archive
for macro trends. Data older than ~1 year is treated as stale for *advice* (builds/matchups
drift) but remains valid for *timeless behavioral patterns* (e.g., "died while CC'd").

---

## 6. Metric battery (Affliction 3v3 first; broad and extensible)

Implemented behind a **feature registry**: each metric is a small registered unit
(id, description, category, the event types it consumes, and its compute fn). Adding a
metric is an isolated change; every metric is stamped with comp / map / patch-season /
rating band so it is only ever compared like-to-like.

**Seed categories (not exhaustive — the point is to keep adding):**

- **Pressure / offense:** damage uptime %, **time-not-doing-damage**, casts/min, DoT uptime
  per target (Agony/Corruption/UA), kill-window participation.
- **Disruption:** interrupts landed / **missed / attempted** (kicks), **what was kicked**
  (filler vs CC vs cooldown), CC casts landed, **CC aimed at healer vs DPS**, Felhunter
  devour/dispels, purges, spellsteal.
- **Defense / survival:** defensives used (Unending Resolve, Dark Pact, trinket/medallion,
  Healthstone) **timed against incoming-burst windows**, deaths, **deaths-while-CC'd**,
  damage taken during own offensive cooldowns.
- **Positioning** (from advanced-log `positionX/Y/facing`, verified present): **time in a
  position / region**, **time standing still**, spread from team, kiting distance, LoS/range
  proxies.
- **Tempo / reaction:** reaction time to enemy CC on your healer, time-to-defensive after
  burst begins.
- **Counterplay / loss-of-value:** key spells lost to **Spell Reflect / Grounding Totem /
  immunities** (derivable from `SPELL_MISSED`/`SPELL_AURA_BROKEN_SPELL`/reflect events);
  **enemy interrupt timing as % of cast elapsed**, by spell, by situation.

**Two explicit work items inside this phase:**
1. **Mine wowarenalogs' derived stats** (`ICombatUnit`) and adopt anything useful for free.
2. Persist raw-enough signal (position samples, per-cast outcomes, per-interrupt cast-time
   %) so **new metrics can be back-computed from stored data** without re-ingesting.

---

## 7. Storage schema (sketch) + the ML seam

Local SQLite. Tables (refined during planning):

- `match` — id (GUID+start key), bracket, map/zone, comp signature, result, duration,
  team MMRs, patch/season, video_path, sidecar_path, ingest metadata.
- `combatant` — per match: player ref, class, spec, talents/PvP talents, gear/ilvl, team.
- `event` — normalized events (or per-unit pre-bucketed sets) at granularity sufficient to
  back-compute new features (includes position samples, interrupt-vs-cast-time, etc.).
- `metric` — (match, metric_id, value, context stamp). Long/narrow so new metrics don't
  require schema changes.
- `dataset_export` (view) — **one row per match/round = wide feature vector + outcome.**
  This is the post-training/LoRA/inference hook: it turns history into a training set on
  demand and is what phase 4 and any agent reads.

Ingestion is **idempotent** (keyed on match GUID + start time); re-running never duplicates.

---

## 8. Comparative scorecard (v1 output)

For a given match, for each metric, show the value plus deltas vs:
- **(a)** rolling average against that same enemy comp,
- **(b)** that map,
- **(c)** the player's **season-best window** ("me at my best"),
- **(d)** the player's **win-vs-loss split**.

Simple above/below-your-norm flags. **No external benchmarks, no AI prose** in v1 — just
honest, comparative numbers. Output: structured JSON (for later layers) + a readable CLI
table. A real UI is a later phase.

---

## 9. Compliance & safe ingestion (settled)

- Reading the `WoWCombatLog-*.txt` the game writes is the **sanctioned, ban-safe** path used
  by every analysis tool; Midnight's "Secret Values" crackdown hit *in-game addons*, not the
  disk log. Bannable activities (memory reads, automation, file modification) are never
  touched.
- The watcher mirrors Warcraft Recorder's `CombatLogWatcher.ts`: directory watch + byte-offset
  tailing + new-file reset, **write-free**.
- **Development & tests run on the staged D: copies**, so nothing requires the live game and
  the install is only ever read.

---

## 10. Error handling

- Parser `malformed_arena_match_detected` → logged, skipped, surfaced in an ingest report.
- Log-without-sidecar and sidecar-without-log both tracked, never silently dropped.
- Idempotent ingestion (see §7).
- `linesNotParsedCount` per match surfaced as a data-quality signal.

---

## 11. Testing

- **Golden-file tests** on a **single small arena-match slice** (extracted from the staged
  corpus — *not* a 300 MB log; keep the repo lean) with hand-verified metric values; run the
  pipeline, assert exact outputs.
- Fixtures must be **small and shareable**; since logs contain other players'
  names/realms, golden fixtures are **anonymized** before being committed (or kept out of the
  repo and referenced via config if anonymization is impractical).
- Each metric in the registry gets a focused unit test.

---

## 12. Explicitly NOT in v1

AI/agent narrative; the win-vs-loss inference engine; external-benchmark comparison;
synced-video-review UI; Destruction/alt specs; Solo Shuffle specifics (healer drinking,
per-round comp). All named; all plumbed-for; none built.

---

## 13. Validated current-state format evidence (12.0.5, 2026-05-29)

| Evidence in live log | Confirms |
|---|---|
| `COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,12.0.5` | Advanced logging on; format version unchanged from 2025 |
| `ARENA_MATCH_START,1825,41,3v3,1` / `ARENA_MATCH_END,1,129,2464,2425` | Bracket string, winner, duration, both teams' MMR |
| `COMBATANT_INFO,Player-XX-XXXXXXXX,…,265,[(71916,91422,1)…]` | Talents/gear per match; player still Affliction (spec 265) |
| `SPELL_INTERRUPT,…,"Kick",…,116858,"Chaos Bolt"` | Kicks + exactly what was kicked |
| `SPELL_DISPEL,…,"Cleanse",…,118699,"Fear",…DEBUFF` | Dispels + what was dispelled; `SPELL_STOLEN` for spellsteal |
| `…1027.40,-331.80,0,6.1180,…` tail | positionX/Y + facing present → positioning metrics viable |
| Player GUID matches sidecar `player._GUID` | Clean log↔video identity link |

---

## 14. Key external references

- **wowarenalogs parser** — `github.com/wowarenalogs/wowarenalogs`, `packages/parser`
  (`@wowarenalogs/parser` v6+, TS, separable, not on npm → vendor from source). License is
  contradictory (repo CC BY-NC-ND vs parser `package.json` MIT); for personal/non-distributed
  use this is fine, and we use it **unmodified** as a dependency. If the project is ever
  shared, resolve licensing with the author or position as a companion to wowarenalogs.
- **Warcraft Recorder** — `github.com/aza547/wow-recorder`; sidecar schema in
  `src/main/types.ts`; `src/parsing/CombatLogWatcher.ts` is the watcher reference.
- **Season detection** — parse `BUILD_VERSION` from log header (free, local); optionally
  Blizzard Game Data API `/data/wow/pvp-season/index` (OAuth) for authoritative boundaries.
  Midnight PvP Season 1 started ~2026-03-17; Season 2 expected with patch 12.1 (no firm date).

---

## 15. Open questions for later phases (not v1 blockers)

- How "intelligence" emerges from the feature surface: statistical feature-importance,
  LLM reasoning, or training on the accumulated dataset — to be explored once data is flowing.
- External-benchmark connectors: which source, what auth, what cadence.
- Whether the agent layer stays TS (LangGraph.js) or introduces Python.
