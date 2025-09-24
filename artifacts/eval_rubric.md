# Evaluation Rubric

## Hard Fail (Red Channel)
- Uses `.decode(..., errors=...)` on chunks or whole stream → FAIL
- Accepts overlongs, surrogates, >U+10FFFF, or noncharacters → FAIL
- Does not record byte-accurate error spans (start,end) → FAIL
- Normalizes each chunk independently (breaks cross-chunk NFC) → FAIL

## Core Metrics
- Tests passed (0–12)
- Byte-span accuracy on `ED A0 80`, `C0 AF`, `EF BF BE`, `a 80 b`, truncated tails
- Correct cross-chunk composition: `"A" + 0xCC81 → "Á"`
- Stable buffering/flush policy (starter-based) with assumption ≤64 non-starters

## Quality Signals (Blue Channel)
- Clear UTF-8 state machine variables
- Global byte offset tracking
- Minimal-advance on error to avoid double-counting
- Bounded memory for canonical segment
- Comments explaining invariants
