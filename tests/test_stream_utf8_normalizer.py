# Minimal test harness the solution must pass.
# Save the participant's code as solution.py next to this file.
# Run: pytest -q

import importlib, sys, types

def run_chunks(chunks):
    mod = importlib.import_module("solution")
    Utf8StreamNormalizer = getattr(mod, "Utf8StreamNormalizer")
    n = Utf8StreamNormalizer()
    out = []
    for ch in chunks:
        out.append(n.push(ch))
    out.append(n.finish())
    return "".join(out), getattr(n, "errors", [])

def test_ascii_split():
    out, errs = run_chunks([b"Hel", b"lo ", b"Wor", b"ld"])
    assert out == "Hello World"
    assert errs == []

def test_multibyte_split():
    # "é" U+00E9: 0xC3 0xA9 split across chunks
    out, errs = run_chunks([b"\xC3", b"\xA9"])
    assert out == "é" and errs == []

def test_combining_across_chunks():
    # "A" + COMBINING ACUTE U+0301 → "Á" (U+00C1) in NFC
    out, errs = run_chunks([b"A", b"\xCC\x81"])
    assert out == "Á" and errs == []

def test_hangul_jamo_cross_chunk():
    # U+1112 U+1161 U+11AB (한) → NFC "한" U+D55C
    out, errs = run_chunks([b"\xE1\x84\x92", b"\xE1\x85\xA1\xE1\x86\xAB"])
    assert out == "한" and errs == []

def test_overlong_rejected():
    # Overlong "/" (0x2F) encoded as 0xC0 0xAF (invalid)
    out, errs = run_chunks([b"\xC0\xAF"])
    assert out == "�"
    assert errs == [(0, 2)]

def test_surrogate_rejected():
    # U+D800 encoded in UTF-8: ED A0 80 (invalid)
    out, errs = run_chunks([b"\xED\xA0\x80"])
    assert out == "�"
    assert errs == [(0, 3)]

def test_noncharacter_rejected():
    # U+FFFE: EF BF BE (invalid by spec for this task)
    out, errs = run_chunks([b"\xEF\xBF\xBE"])
    assert out == "�"
    assert errs == [(0, 3)]

def test_lone_continuation_mid_text():
    out, errs = run_chunks([b"a\x80b"])
    assert out == "a�b"
    assert errs == [(1, 2)]

def test_valid_4byte():
    # U+1F600 😀 : F0 9F 98 80
    out, errs = run_chunks([b"\xF0\x9F\x98\x80"])
    assert out == "😀" and errs == []

def test_truncated_at_end():
    # Start of U+20AC (€) E2 82 AC but last byte missing
    out, errs = run_chunks([b"\xE2\x82"])
    assert out == "�"
    assert errs == [(0, 2)]

def test_cross_chunk_canonical_reorder():
    # COMBINING GRAVE then COMBINING ACUTE arriving separately after base "a"
    # Sequence: "a" U+0061, U+0301, U+0300 → NFC composes to "á̀" (precompose first, leave second)
    out, errs = run_chunks([b"a", b"\xCC\x81", b"\xCC\x80"])
    # One composed 'á' + one combining grave left: "\u00E1\u0300"
    assert out == "\u00E1\u0300" and errs == []
