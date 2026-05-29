# wow-arena-eye

Personal WoW arena analysis tool. Ingests your own combat logs (via the wowarenalogs
parser) and Warcraft Recorder videos, derives objective per-match metrics, and produces a
comparative scorecard against your own history.

All data paths and player identity are supplied via a local `config.json` (git-ignored).
Copy `config.example.json` to `config.json` and fill in your paths.

See `docs/superpowers/specs/` for the design and `docs/superpowers/plans/` for plans.
