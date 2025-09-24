[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](
  https://github.com/codespaces/new?hide_repo_select=true&ref=main&repo=ttranslucent%2Fnepsis-utf8-ab-harness
)

# Nepsis UTF-8 → NFC A/B Harness

Public harness for reproducing **A/B constraint satisfaction** — same model, different prompt architecture.  
This repository now packages both the hosted demo assets and the full experiment kit used to compare
"naked" vs Nepsis-scaffolded solutions on a failure-prone streaming UTF-8 → NFC task.

---

## Repository Layout
- `index.html`, `docs/` – landing content for the hosted walkthrough.
- `utf8_experiment_runner.html` – second-page experience that bundles task brief, prompts, and automation instructions.
- `prompts/` – naked vs Nepsis scaffolding prompts for the Utf8StreamNormalizer task.
- `tests/test_stream_utf8_normalizer.py` – acceptance tests (pytest) exercised by the harness.
- `solution.py` – working copy for the active candidate; swap in outputs during experiments.
- `solution_naked.py`, `solution_scaffold.py` – captured model responses for each condition.
- `artifacts/` – logs, scorecards, and automated evaluator outputs.
- `nepsis/` – Python package providing CLI tooling (`nepsis.cli.nepsis`) including the dual-condition evaluator.

---

## Running the Experiment Locally
```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install pytest
python3 -m nepsis.cli.nepsis run-experiment \
  --model-name "Claude Opus 4.1" \
  --notes "Automated run"
```
This command will:
1. Swap in `solution_naked.py` and run `pytest -q tests/test_stream_utf8_normalizer.py`.
2. Swap in `solution_scaffold.py` and rerun the suite.
3. Emit structured artifacts under `artifacts/automated_*.{json,txt,md,csv}` and print a summary JSON payload.

Manual protocol (if you want step-by-step control):
1. Paste `prompts/naked.txt` into your model, place the reply into `solution.py`, run `pytest -q`, log the results.
2. Repeat with `prompts/scaffold.txt`.
3. Optionally capture reflections in `artifacts/` for longitudinal tracking.

### Scoring Heuristics
- **Red Channel** (critical): no `bytes.decode(..., errors=...)`, reject overlongs, surrogates, >U+10FFFF, noncharacters, record precise byte spans, and avoid per-chunk normalization.
- **Blue Channel** (quality): explicit decoder state, bounded buffering, clear flush policy, comments explaining invariants.

Use `artifacts/scorecard.csv` or the auto-generated `artifacts/automated_scorecard.csv` to log trials across models.

---

## Deployment Notes
The repository is configured for static hosting (e.g., Vercel). Pushes to `main` update both the landing page and
experiment runner. To publish a new run, regenerate artifacts locally and commit the updated `artifacts/automated_*`
files or link to externally hosted reports.

For formal evaluation access under NDA, contact: 📧 ttranslucent@gmail.com
