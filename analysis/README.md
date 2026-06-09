# analysis/ — win/loss correlate mining (AI-coach substrate)

Python sidecar over the match store (SQLite is the TS↔Python contract; this package never
imports the TS code, only reads the DB + `src/metadata/*.json`).

Spec: `docs/superpowers/specs/2026-06-09-correlate-mining-design.md`.

## Setup

```powershell
cd analysis
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
```

## Run

```powershell
# pooled 3v3 + per character
.\.venv\Scripts\python -m wae                       # pooled, bracket 3v3
.\.venv\Scripts\python -m wae --character Phlares
.\.venv\Scripts\python -m wae --character Phluglishph
```

Outputs to `output/analysis/`:
- `influence-<label>.md` — the human findings report (tiered: coachable process features
  vs context vs outcome-adjacent)
- `influence-<label>.json` — the machine artifact for the future AI coach: every screened
  feature with effect size + FDR q-values, model importances, and per-feature win/loss
  quantile **anchors** for placing a live match against history
- `features-<label>.csv` — the raw feature matrix

## Tests

```powershell
.\.venv\Scripts\python -m pytest tests -q
```
