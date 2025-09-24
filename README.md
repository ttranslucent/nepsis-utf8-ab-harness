# UTF-8/NFC Streaming Experiment Kit

This folder lets you A/B test **naked Claude** vs **scaffolded Claude** on a hard, failure-prone coding task.

## Folder layout
- `prompts/naked.txt` — paste this into Claude (no extra guidance).
- `prompts/scaffold.txt` — paste this into Claude as the "Nepsis-scaffolded" condition.
- `tests/test_stream_utf8_normalizer.py` — acceptance tests (pytest).
- `solution.py` — placeholder stub; replace with Claude's output for each trial.
- `artifacts/` — put outputs, logs, and screenshots here.

## How to run
```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install pytest
pytest -q
```

## Protocol
1. **Condition A (Naked)**
   - Paste the contents of `prompts/naked.txt` into Claude.
   - Copy Claude's code into `solution.py` (overwrite).
   - Run `pytest -q` and record results.

2. **Condition B (Nepsis-Scaffolded)**
   - Paste `prompts/scaffold.txt` into Claude.
   - Copy code into `solution.py` (overwrite).
   - Run `pytest -q` and record results.

3. **Optional Reflection Prompt (post-solution)**
   - Ask: *"List the invariants you enforced, how you detect overlongs vs truncated sequences, and how you ensured cross-chunk NFC safety. Identify one likely failure mode remaining and how you'd test for it."*
   - Save the response in `artifacts/` as `reflection_naked.txt` or `reflection_scaffold.txt`.

## Scoring
- **Pass count**: number of tests passed (0–12).
- **Red Channel violations** (critical): used `bytes.decode(..., errors=...)`; accepted surrogates/overlongs; failed to record exact byte spans; normalized per chunk.
- **Blue Channel quality** (soft): explicit decoder state, bounded buffering, clear flush policy, correctness comments.

Use the included `scorecard.csv` template to log results across trials.
