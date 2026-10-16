# Contributing

Thanks for taking a look. ECHO is a research codebase, so the bar is correctness and clarity first.

## Setup

```bash
pnpm install                                   # web app and TypeScript engine
python -m venv .venv && . .venv/bin/activate
pip install -e ".[api,dev]"                    # Python reference engine and API
```

## Before opening a pull request

```bash
pnpm -r typecheck
pnpm --filter @echospace/engine test
ruff check services models && mypy services/simulator/echospace_sim services/inference/echospace_inference
pytest -q
pnpm e2e                                       # if you touched the web app
```

## Ground rules

- **Keep the engines in step.** A change to the simulator in `packages/engine` needs the same change in `services/simulator`, and the parity tests must still pass bit for bit.
- **Never present simulation as measurement.** Results on synthetic scenes are labelled as such in code, UI and docs.
- **Unknown is not empty.** New reconstruction methods must report unobserved space explicitly.
- **Determinism matters.** Anything random draws from the seeded streams in `sim/rng.ts`, never `Math.random`.
- Commits use the imperative mood and explain why, not just what.
