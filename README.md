# wow-arena-eye

Personal WoW arena analysis tool. Ingests your own combat logs (via the vendored
[wowarenalogs](https://github.com/wowarenalogs/wowarenalogs) parser) and Warcraft Recorder
videos, derives objective per-match metrics, and produces a comparative scorecard against
your own history. See `docs/superpowers/specs/` for the design and `docs/superpowers/plans/`
for plans.

## Requirements
- Node.js >= 22
- git

## Setup (after cloning)
This project vendors the wowarenalogs parser as a git submodule and builds it locally.
Run the one-time bootstrap:

    npm run setup

This initializes the submodule, builds the parser, and installs dependencies.

Then create your local config (git-ignored) from the template and fill in your paths:

    cp config.example.json config.json
    # edit config.json: set sampleLogsDir, videoDirs, outputDir, and your player identity

## Usage

    npm test                                   # run the test suite
    npm run ingest -- <path-to-combat-log>     # parse a log; writes match summaries to outputDir

All data paths and player identity come from the git-ignored `config.json`. Nothing private
is committed.
