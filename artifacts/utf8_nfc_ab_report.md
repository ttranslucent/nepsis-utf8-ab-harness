# A/B: Same model, different prompt architecture

**Task:** Streaming UTF-8 → NFC with byte-accurate error slices across chunk boundaries  
**Model:** Claude Opus 4.1  
**Only change:** Prompt architecture (Naked vs Nepsis-scaffold)

## Results
- Naked: 8/11 tests passed
- Scaffold: 11/11 tests passed

## Naked failures
1. Hangul Jamo cross-chunk: emitted 한 (decomposed) instead of "한" (precomposed).
2. Overlong "/" (C0 AF): emitted two replacement chars (��) instead of one.
3. Truncated tail (E2 82): logged multiple byte errors instead of one span (expected [(0,2)]).

## Why scaffold wins
- Starter-based flush with Hangul Jamo awareness → safe cross-chunk NFC.
- Single-span error policy for invalid runs and truncated tails.
- Overlong/surrogate/plane-limit checks with minimal-advance on error.

## Takeaway
Identical model capacity; **process constraints** (Nepsis-style scaffold) change the outcome.
