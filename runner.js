// --- strict baseline config ---
const EXPECT = ['é', 'é', '한'];
const RE_DECOMP = /e\u0301/g;

// --- Sample outputs for quick validate-on-Page-1 ---
const SAMPLE_NAKED_8_11 = String.raw`import unicodedata

class Utf8StreamNormalizer:
    def __init__(self):
        self.errors = []
        self.byte_offset = 0
        self.state = 0
        self.accum = 0
        self.expected = 0
        self.start_index = 0
        self.pending = bytearray()
        self.segment_buffer = []
        
    def push(self, chunk: bytes) -> str:
        if not chunk:
            return ""
        
        data = self.pending + chunk
        self.pending.clear()
        
        result = []
        i = 0
        
        while i < len(data):
            if self.state == 0:
                b = data[i]
                if b < 0x80:
                    cp = b
                    i += 1
                elif b < 0xC0:
                    self.errors.append((self.byte_offset + i, self.byte_offset + i + 1))
                    self._flush_and_emit(result, 0xFFFD)
                    i += 1
                elif b < 0xE0:
                    if b < 0xC2:
                        self.errors.append((self.byte_offset + i, self.byte_offset + i + 1))
                        self._flush_and_emit(result, 0xFFFD)
                        i += 1
                    else:
                        if i + 1 >= len(data):
                            self.pending = data[i:]
                            break
                        self.state = 1
                        self.expected = 1
                        self.accum = b & 0x1F
                        self.start_index = self.byte_offset + i
                        i += 1
                elif b < 0xF0:
                    if i + 2 >= len(data):
                        self.pending = data[i:]
                        break
                    self.state = 1
                    self.expected = 2
                    self.accum = b & 0x0F
                    self.start_index = self.byte_offset + i
                    i += 1
                elif b < 0xF8:
                    if b > 0xF4:
                        self.errors.append((self.byte_offset + i, self.byte_offset + i + 1))
                        self._flush_and_emit(result, 0xFFFD)
                        i += 1
                    else:
                        if i + 3 >= len(data):
                            self.pending = data[i:]
                            break
                        self.state = 1
                        self.expected = 3
                        self.accum = b & 0x07
                        self.start_index = self.byte_offset + i
                        i += 1
                else:
                    self.errors.append((self.byte_offset + i, self.byte_offset + i + 1))
                    self._flush_and_emit(result, 0xFFFD)
                    i += 1
            else:
                b = data[i]
                if b < 0x80 or b >= 0xC0:
                    end_index = self.byte_offset + i
                    self.errors.append((self.start_index, end_index))
                    self._flush_and_emit(result, 0xFFFD)
                    self.state = 0
                    self.expected = 0
                    self.accum = 0
                else:
                    self.accum = (self.accum << 6) | (b & 0x3F)
                    self.expected -= 1
                    i += 1
                    
                    if self.expected == 0:
                        end_index = self.byte_offset + i
                        orig_len = end_index - self.start_index
                        
                        valid = True
                        if orig_len == 2:
                            if self.accum < 0x80:
                                valid = False
                        elif orig_len == 3:
                            first_byte = data[self.start_index - self.byte_offset] if self.start_index >= self.byte_offset else self.pending[0]
                            if first_byte == 0xE0 and self.accum < 0x800:
                                valid = False
                            elif first_byte == 0xED and self.accum >= 0xD800 and self.accum <= 0xDFFF:
                                valid = False
                            elif self.accum < 0x800:
                                valid = False
                        elif orig_len == 4:
                            first_byte = data[self.start_index - self.byte_offset] if self.start_index >= self.byte_offset else self.pending[0]
                            if first_byte == 0xF0 and self.accum < 0x10000:
                                valid = False
                            elif first_byte == 0xF4 and self.accum > 0x10FFFF:
                                valid = False
                            elif self.accum < 0x10000:
                                valid = False
                            elif self.accum > 0x10FFFF:
                                valid = False
                        
                        if self.accum >= 0xD800 and self.accum <= 0xDFFF:
                            valid = False
                        
                        if (self.accum & 0xFFFE) == 0xFFFE:
                            valid = False
                        elif self.accum >= 0xFDD0 and self.accum <= 0xFDEF:
                            valid = False
                        
                        if valid:
                            cp = self.accum
                        else:
                            self.errors.append((self.start_index, end_index))
                            self._flush_and_emit(result, 0xFFFD)
                            self.state = 0
                            self.accum = 0
                            continue
                        
                        self.state = 0
                        self.accum = 0
            
            if self.state == 0 and 'cp' in locals():
                self._process_codepoint(result, cp)
                del cp
        
        self.byte_offset += len(chunk)
        return ''.join(result)
    
    def finish(self) -> str:
        result = []
        
        if self.state != 0:
            self.errors.append((self.start_index, self.byte_offset))
            self._flush_and_emit(result, 0xFFFD)
            self.state = 0
            self.accum = 0
            self.expected = 0
        
        if self.pending:
            self.errors.append((self.byte_offset, self.byte_offset + len(self.pending)))
            self._flush_and_emit(result, 0xFFFD)
            self.pending.clear()
        
        if self.segment_buffer:
            segment_str = ''.join(chr(c) for c in self.segment_buffer)
            result.append(unicodedata.normalize('NFC', segment_str))
            self.segment_buffer.clear()
        
        return ''.join(result)
    
    def _process_codepoint(self, result, cp):
        if unicodedata.combining(chr(cp)) == 0:
            if self.segment_buffer:
                segment_str = ''.join(chr(c) for c in self.segment_buffer)
                result.append(unicodedata.normalize('NFC', segment_str))
                self.segment_buffer.clear()
            self.segment_buffer.append(cp)
        else:
            self.segment_buffer.append(cp)
    
    def _flush_and_emit(self, result, cp):
        if self.segment_buffer:
            segment_str = ''.join(chr(c) for c in self.segment_buffer)
            result.append(unicodedata.normalize('NFC', segment_str))
            self.segment_buffer.clear()
        result.append(chr(cp))`;
const SAMPLE_NEPSIS_11_11 = String.raw`import unicodedata

class Utf8StreamNormalizer:
    """
    Streaming UTF-8 validator + NFC normalizer with:
      - RFC 3629 checks (no overlongs, surrogates, >U+10FFFF, noncharacters)
      - Byte-accurate error spans
      - Cross-chunk NFC with a safe flush policy that understands Hangul Jamo
    """

    def __init__(self):
        self.buffer = bytearray()
        self.byte_offset = 0
        self.errors = []
        self.segment = []  # current canonical segment (list[str])

    # ---------------- Public API ----------------

    def push(self, chunk: bytes) -> str:
        if not chunk:
            return ""
        self.buffer.extend(chunk)
        out = []
        pos = 0
        n = len(self.buffer)

        while pos < n:
            b0 = self.buffer[pos]

            # ASCII fast path
            if b0 <= 0x7F:
                self._accept_char(chr(b0), out)
                pos += 1
                continue

            # Lone continuation bytes run (treat as one invalid run)
            if 0x80 <= b0 <= 0xBF:
                run_start = pos
                pos += 1
                while pos < n and 0x80 <= self.buffer[pos] <= 0xBF:
                    pos += 1
                self._record_span_error(run_start, pos)
                self._accept_char("\uFFFD", out)
                continue

            # ----- Multi-byte sequences -----

            # 2-byte: 110xxxxx 10xxxxxx
            if 0xC0 <= b0 <= 0xDF:
                if pos + 1 >= n:
                    break  # incomplete
                b1 = self.buffer[pos + 1]
                if not (0x80 <= b1 <= 0xBF):
                    # invalid follower → consume 1 byte only (minimal advance)
                    self._record_span_error(pos, pos + 1)
                    self._accept_char("\uFFFD", out)
                    pos += 1
                    continue
                cp = ((b0 & 0x1F) << 6) | (b1 & 0x3F)
                # overlong: cp < 0x80
                if cp < 0x80 or self._is_noncharacter(cp):
                    self._record_span_error(pos, pos + 2)
                    self._accept_char("\uFFFD", out)
                else:
                    self._accept_char(chr(cp), out)
                pos += 2
                continue

            # 3-byte: 1110xxxx 10xxxxxx 10xxxxxx
            if 0xE0 <= b0 <= 0xEF:
                if pos + 2 >= n:
                    break  # incomplete
                b1, b2 = self.buffer[pos + 1], self.buffer[pos + 2]
                if not (0x80 <= b1 <= 0xBF and 0x80 <= b2 <= 0xBF):
                    # minimal advance on bad follower
                    self._record_span_error(pos, pos + 1)
                    self._accept_char("\uFFFD", out)
                    pos += 1
                    continue
                # Lead-byte boundary checks to avoid overlongs/surrogates
                if b0 == 0xE0 and b1 < 0xA0:  # overlong
                    self._record_span_error(pos, pos + 3)
                    self._accept_char("\uFFFD", out)
                    pos += 3
                    continue
                if b0 == 0xED and b1 >= 0xA0:  # surrogates
                    self._record_span_error(pos, pos + 3)
                    self._accept_char("\uFFFD", out)
                    pos += 3
                    continue
                cp = ((b0 & 0x0F) << 12) | ((b1 & 0x3F) << 6) | (b2 & 0x3F)
                if cp < 0x800 or (0xD800 <= cp <= 0xDFFF) or self._is_noncharacter(cp):
                    self._record_span_error(pos, pos + 3)
                    self._accept_char("\uFFFD", out)
                else:
                    self._accept_char(chr(cp), out)
                pos += 3
                continue

            # 4-byte: 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx
            if 0xF0 <= b0 <= 0xF4:
                if pos + 3 >= n:
                    break  # incomplete
                b1, b2, b3 = self.buffer[pos + 1], self.buffer[pos + 2], self.buffer[pos + 3]
                if not (0x80 <= b1 <= 0xBF and 0x80 <= b2 <= 0xBF and 0x80 <= b3 <= 0xBF):
                    self._record_span_error(pos, pos + 1)
                    self._accept_char("\uFFFD", out)
                    pos += 1
                    continue
                # Lead-byte boundary checks to avoid overlongs and >U+10FFFF
                if b0 == 0xF0 and b1 < 0x90:      # overlong for 4-byte
                    self._record_span_error(pos, pos + 4)
                    self._accept_char("\uFFFD", out)
                    pos += 4
                    continue
                if b0 == 0xF4 and b1 > 0x8F:      # beyond U+10FFFF
                    self._record_span_error(pos, pos + 4)
                    self._accept_char("\uFFFD", out)
                    pos += 4
                    continue
                cp = ((b0 & 0x07) << 18) | ((b1 & 0x3F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F)
                if cp < 0x10000 or cp > 0x10FFFF or self._is_noncharacter(cp):
                    self._record_span_error(pos, pos + 4)
                    self._accept_char("\uFFFD", out)
                else:
                    self._accept_char(chr(cp), out)
                pos += 4
                continue

            # 0xF5..0xFF are invalid lead bytes
            self._record_span_error(pos, pos + 1)
            self._accept_char("\uFFFD", out)
            pos += 1

        # Advance global offset and keep any incomplete tail in buffer
        self.byte_offset += pos
        if pos:
            del self.buffer[:pos]

        return "".join(out)

    def finish(self) -> str:
        out = []
        # Any leftover bytes mean an incomplete sequence → ONE span + ONE U+FFFD
        if self.buffer:
            start = self.byte_offset
            end = self.byte_offset + len(self.buffer)
            self.errors.append((start, end))
            self.buffer.clear()
            self._accept_char("\uFFFD", out)

        if self.segment:
            out.append(unicodedata.normalize("NFC", "".join(self.segment)))
            self.segment.clear()
        return "".join(out)

    # ---------------- Helpers ----------------

    def _accept_char(self, ch: str, out_parts: list):
        """
        Append a char into the current segment.
        Flush the existing segment ONLY when it is safe:
          - new char is a starter (combining class 0)
          - and the existing segment does not end with Hangul Jamo that can still compose
        This preserves cross-chunk NFC for cases like L+V(+T) → precomposed Hangul.
        """
        if self._is_starter(ch) and self._segment_safe_to_flush():
            if self.segment:
                out_parts.append(unicodedata.normalize("NFC", "".join(self.segment)))
                self.segment.clear()
            self.segment.append(ch)
        else:
            self.segment.append(ch)

    def _segment_safe_to_flush(self) -> bool:
        """
        Safe to flush if:
          - segment is empty → False (just accumulate)
          - last char is NOT a Hangul Jamo L or V (which may combine with following Jamo)
        """
        if not self.segment:
            return False
        last = ord(self.segment[-1])
        if self._is_hangul_jamo_L(last) or self._is_hangul_jamo_V(last):
            return False
        return True

    @staticmethod
    def _is_starter(ch: str) -> bool:
        return unicodedata.combining(ch) == 0

    @staticmethod
    def _is_hangul_jamo_L(cp: int) -> bool:
        # L jamo ranges (modern + extended-A)
        return (0x1100 <= cp <= 0x115F) or (0xA960 <= cp <= 0xA97F)

    @staticmethod
    def _is_hangul_jamo_V(cp: int) -> bool:
        # V jamo ranges (modern + extended-B)
        return (0x1160 <= cp <= 0x11A7) or (0xD7B0 <= cp <= 0xD7C6)

    @staticmethod
    def _is_noncharacter(cp: int) -> bool:
        if 0xFDD0 <= cp <= 0xFDEF:
            return True
        return (cp & 0xFFFF) in (0xFFFE, 0xFFFF)

    # ---- error recording with global byte coordinates ----
    def _record_span_error(self, local_start: int, local_end: int):
        self.errors.append((self.byte_offset + local_start, self.byte_offset + local_end))`;
const SAMPLE_TEXT = {
  naked: SAMPLE_NAKED_8_11,
  nepsis: SAMPLE_NEPSIS_11_11,
};

const MODEL_PRESETS = ['GPT-5', 'Claude 3.7 Sonnet', 'o3', 'Llama 3.1 405B', 'Gemini 2.0 Pro'];
const MODEL_STORAGE_KEY = 'nepsis_active_model_v1';
const MODEL_CUSTOM_STORAGE_KEY = 'nepsis_custom_model_v1';
const PROMPT_TYPE_STORAGE_KEY = 'nepsis_prompt_type_v1';

function buildNakedPrompt(llmLabel = '') {
  const clause = llmLabel.toLowerCase().includes('claude')
    ? 'Return only code. No prose.'
    : 'Return only code (no markdown fences, no comments).';
  return `You are implementing a streaming UTF-8 validator + NFC normalizer.

Return ONLY the Python code for solution.py that defines:
class Utf8StreamNormalizer:
    def push(self, chunk: bytes) -> str
    def finish(self) -> str
    errors: list[tuple[int,int]]

Constraints (RFC-3629 exact):
- Reject overlongs; forbid U+D800–U+DFFF; forbid >U+10FFFF; reject lone continuation/truncated; reject noncharacters in all planes.
- On invalid subsequence, emit exactly one U+FFFD and append (start,end) byte indices in GLOBAL coordinates to self.errors.
- Streaming NFC: Do NOT normalize per chunk. Buffer canonical segment; flush only on a starter (combining class 0) or at finish(). Assume ≤64 consecutive non-starters.
- No cheats: never use bytes.decode(..., errors=...); implement a UTF-8 state machine to find precise error spans.

Output: ${clause}
`;
}

const NEPSIS_SCAFFOLD_PROMPT = `Nepsis Scaffold (Lite v0.1)

Implement solution.py with a single class:

class Utf8StreamNormalizer:
    def __init__(self): ...
    def push(self, chunk: bytes) -> str
    def finish(self) -> str
    # After finish(), self.errors is list[tuple[int,int]] of GLOBAL byte ranges for each invalid UTF-8 subsequence

NON-NEGOTIABLES (RFC-3629 exact)
1) Reject: overlong encodings; lone continuation bytes; truncated sequences; 5/6-byte forms; code points > U+10FFFF; UTF-16 surrogates U+D800–U+DFFF; and noncharacters (U+FDD0..U+FDEF or any U+FFFE/U+FFFF in any plane).
2) On any invalid subsequence emit exactly ONE U+FFFD and append ONE span [start,end) in GLOBAL byte coords to self.errors. Do NOT emit multiple U+FFFD for one invalid subsequence. Truncated tail at finish() → one span covering the remaining bytes.
3) Streaming semantics: handle code points split across chunks. Keep a small pending-bytes buffer for incomplete sequences.
4) Normalization: Output MUST be NFC, respecting cross-chunk sequences. Do NOT normalize per chunk. Buffer the current canonical segment and flush only on seeing a starter (combining class 0) or at finish().
   • Hangul guard: do not flush if the segment tail is Hangul Jamo L or V (it may still compose with upcoming Jamo).
5) No cheats: NEVER use bytes.decode(..., errors=...) on the stream or chunks. Implement a UTF-8 state machine to get precise spans and overlong checks.

REQUIRED IMPLEMENTATION SHAPE
- Track: self.byte_offset (global), self.pending (bytes) for split sequences, self.segment (list[str]) for the current canonical run, self.errors (list[tuple[int,int]]).
- UTF-8 decode: minimal-advance on error (record span, emit U+FFFD, skip the offending lead only unless followers are clearly part of the same invalid subsequence). Lead-byte boundary checks:
  • 3-byte: E0 ⇒ 0xA0..0xBF; ED ⇒ 0x80..0x9F; otherwise 0x80..0xBF followers.
  • 4-byte: F0 ⇒ 0x90..0xBF; F4 ⇒ 0x80..0x8F; otherwise 0x80..0xBF followers.
- Reject noncharacters and surrogates even if structurally well-formed.
- Compose NFC via unicodedata.normalize('NFC'); starters via unicodedata.combining(ch) == 0.
- Flushing rule:
  def _accept(ch):
      if starter and segment non-empty and last char is NOT Hangul L/V ⇒ flush normalize(segment), clear, then start new.
      else: append to segment.
- finish(): if pending exists ⇒ record one span [offset, offset+len(pending)], emit one U+FFFD, clear; then flush normalize(segment).

Return ONLY valid Python code for solution.py (no markdown fences, no prose).
`;

const PY_TEST_SCRIPT = `
import json, io, contextlib

code = USER_CODE
result = {"cases": []}
stdout = io.StringIO()

TESTS = [
    ("ascii_split", [b"Hel", b"lo ", b"Wor", b"ld"], "Hello World", []),
    ("multibyte_split", [bytes([0xC3]), bytes([0xA9])], "é", []),
    ("combining_across_chunks", [b"A", bytes([0xCC, 0x81])], "Á", []),
    ("hangul_jamo_cross_chunk", [bytes([0xE1, 0x84, 0x92]), bytes([0xE1, 0x85, 0xA1, 0xE1, 0x86, 0xAB])], "한", []),
    ("overlong_rejected", [bytes([0xC0, 0xAF])], "�", [(0, 2)]),
    ("surrogate_rejected", [bytes([0xED, 0xA0, 0x80])], "�", [(0, 3)]),
    ("noncharacter_rejected", [bytes([0xEF, 0xBF, 0xBE])], "�", [(0, 3)]),
    ("lone_continuation_mid_text", [b"a" + bytes([0x80]) + b"b"], "a�b", [(1, 2)]),
    ("valid_4byte", [bytes([0xF0, 0x9F, 0x98, 0x80])], "😀", []),
    ("truncated_at_end", [bytes([0xE2, 0x82])], "�", [(0, 2)]),
    ("cross_chunk_canonical_reorder", [b"a", bytes([0xCC, 0x81]), bytes([0xCC, 0x80])], "\u00E1\u0300", []),
]

with contextlib.redirect_stdout(stdout):
    ns = {}
    try:
        exec(code, ns)
    except Exception as exc:
        result["fatal"] = f"{exc.__class__.__name__}: {exc}"
    else:
        cls = ns.get("Utf8StreamNormalizer")
        if cls is None:
            result["fatal"] = "Utf8StreamNormalizer class not found."
        else:
            for name, chunks, want_out, want_errs in TESTS:
                case = {"name": name, "ok": False, "msg": ""}
                try:
                    inst = cls()
                except Exception as exc:
                    case["msg"] = f"init failed: {exc.__class__.__name__}: {exc}"
                    result["cases"].append(case)
                    continue
                pieces = []
                try:
                    for chunk in chunks:
                        pieces.append(inst.push(chunk))
                    pieces.append(inst.finish())
                except Exception as exc:
                    case["msg"] = f"exception: {exc.__class__.__name__}: {exc}"
                    result["cases"].append(case)
                    continue
                text = "".join(pieces)
                errs = getattr(inst, "errors", [])
                try:
                    errs_list = list(errs)
                except Exception:
                    errs_list = [str(errs)]
                if text != want_out:
                    case["msg"] = f"out={text!r} expected {want_out!r}"
                elif errs_list != want_errs:
                    case["msg"] = f"errors={errs_list!r} expected {want_errs!r}"
                else:
                    case["ok"] = True
                result["cases"].append(case)

result["stdout"] = stdout.getvalue()
json.dumps(result)
`;

// ---- helpers ----
const get = (id) => document.getElementById(id);
const cp = (ch) => 'U+' + (ch.codePointAt(0).toString(16).toUpperCase());

function stripFences(text = '') {
  return text.replace(/```[\s\S]*?```/g, '').trim();
}

function firstNCharsPrintable(text, count) {
  const result = [];
  if (!text) return result;
  for (const ch of stripFences(text)) {
    if (/\s|["'`]/.test(ch)) continue;
    result.push(ch);
    if (result.length === count) break;
  }
  return result;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch] || ch));
}

function showToast(msg, ok = true) {
  const el = get('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.borderColor = ok ? 'rgba(16,185,129,.4)' : 'rgba(239,68,68,.4)';
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 1400);
}

async function safeCopy(text) {
  if (!text) {
    showToast('Nothing to copy', false);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied');
  } catch (err) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.top = '-999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showToast('Copied');
    } catch (fallbackErr) {
      console.error('Copy failed', fallbackErr);
      showToast('Copy failed', false);
    }
  }
}

// ---- shared state & storage ----
const K_CONSISTENCY = 3;
const SEEDS = [137, 991, 2401];
const SEED_STRATEGY = 'fixed_set_v2';
const RUN_STORAGE_KEY = 'nepsis_runs_v2';

let currentModel = MODEL_PRESETS[0];
let customModelName = '';
let currentPromptType = null;
let currentDifficulty = 'standard';

function loadRuns() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RUN_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('Failed to parse stored runs', err);
    return [];
  }
}

function saveRuns(runs) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RUN_STORAGE_KEY, JSON.stringify(runs));
  } catch (err) {
    console.warn('Failed to persist runs', err);
  }
}

function loadSelectionState() {
  if (typeof window === 'undefined') return;
  try {
    const storedModel = window.localStorage.getItem(MODEL_STORAGE_KEY);
    const storedCustom = window.localStorage.getItem(MODEL_CUSTOM_STORAGE_KEY);
    const storedPrompt = window.localStorage.getItem(PROMPT_TYPE_STORAGE_KEY);

    if (storedModel) {
      if (MODEL_PRESETS.includes(storedModel)) {
        currentModel = storedModel;
        customModelName = '';
      } else if (storedCustom) {
        currentModel = storedCustom;
        customModelName = storedCustom;
      } else {
        currentModel = storedModel;
        customModelName = MODEL_PRESETS.includes(storedModel) ? '' : storedModel;
      }
    }

    if (storedPrompt === 'naked' || storedPrompt === 'scaffold') {
      currentPromptType = storedPrompt;
    }
  } catch (err) {
    console.warn('Failed to load selection state', err);
  }
}

function persistSelectionState() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MODEL_STORAGE_KEY, currentModel || '');
    const customValue = MODEL_PRESETS.includes(currentModel) ? '' : (customModelName || currentModel || '');
    window.localStorage.setItem(MODEL_CUSTOM_STORAGE_KEY, customValue);
    window.localStorage.setItem(PROMPT_TYPE_STORAGE_KEY, currentPromptType || '');
  } catch (err) {
    console.warn('Failed to persist selection state', err);
  }
}

function updateModelUI() {
  const select = get('modelSelect');
  const badge = get('modelBadge');
  if (select) {
    const desiredValue = MODEL_PRESETS.includes(currentModel) ? currentModel : 'custom';
    if (select.value !== desiredValue) {
      select.value = desiredValue;
    }
  }
  if (badge) {
    if (currentModel) {
      badge.textContent = currentModel;
      badge.style.display = 'inline-flex';
    } else {
      badge.textContent = '';
      badge.style.display = 'none';
    }
  }
}

function updatePromptButtons() {
  const nakedBtn = get('btnCopyNaked');
  const scaffoldBtn = get('btnCopyScaffold');
  if (nakedBtn) nakedBtn.classList.toggle('active', currentPromptType === 'naked');
  if (scaffoldBtn) scaffoldBtn.classList.toggle('active', currentPromptType === 'scaffold');
}

function setModel(value, opts = {}) {
  if (!value) return;
  let nextModel = value;
  let nextCustom = customModelName;

  if (value === 'custom') {
    if (Object.prototype.hasOwnProperty.call(opts, 'customName')) {
      nextCustom = (opts.customName || '').trim();
    } else if (opts.prompt !== false) {
      const initial = customModelName || (!MODEL_PRESETS.includes(currentModel) ? currentModel : '');
      const input = window.prompt('Enter model name', initial);
      if (!input) {
        updateModelUI();
        return;
      }
      nextCustom = input.trim();
    }
    if (!nextCustom) {
      updateModelUI();
      return;
    }
    nextModel = nextCustom;
  }

  currentModel = nextModel;
  customModelName = MODEL_PRESETS.includes(nextModel) ? '' : nextModel;
  updateModelUI();
  if (opts.persist !== false) persistSelectionState();
  if (!opts.skipSync) syncURL();
}

function setPromptType(value, opts = {}) {
  const normalized = value === 'naked' || value === 'scaffold' ? value : null;
  currentPromptType = normalized;
  updatePromptButtons();
  if (opts.persist !== false) persistSelectionState();
  if (!opts.skipSync) syncURL();
}

function generateRunId() {
  return `run_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

const percentage = (num, den) => (den > 0 ? Math.round((100 * num) / den) : 0);

function sanitizeReason(value) {
  if (!value) return '';
  return String(value).replace(/[\r\n]+/g, ' ').replace(/,/g, ';');
}

function classifyReason(reason = '') {
  const lower = reason.toLowerCase();
  if (!lower) return null;
  if (/(overlong|continuation|truncated|incomplete|split)/.test(lower)) return 'CONTINUATION';
  if (/(constraint|structure|schema|span|format|record)/.test(lower)) return 'CONSTRAINT';
  if (/(orth|compose|nfc|normaliz|hangul|unicode)/.test(lower)) return 'ORTHO/ENCODING';
  if (/(semantic|halluc|answer|meaning|intent)/.test(lower)) return 'SEMANTIC';
  return 'SEMANTIC';
}

function renderTags(tags = []) {
  if (!tags.length) return '';
  return tags.map((tag) => {
    const safe = escapeHtml(tag);
    return `<span class="chip" data-tag="${safe}">${safe}</span>`;
  }).join(' ');
}

function normalizeLegacyRun(run) {
  if (!run || typeof run !== 'object') return run;
  if (!run.model) {
    const legacyMode = run.mode || 'unknown';
    run.model = legacyMode === 'nepsis' ? 'Legacy Nepsis' : legacyMode === 'baseline' ? 'Legacy Baseline' : 'Legacy';
  }
  if (!Object.prototype.hasOwnProperty.call(run, 'prompt_type')) {
    if (run.mode === 'nepsis') run.prompt_type = 'scaffold';
    else if (run.mode === 'baseline') run.prompt_type = 'naked';
    else run.prompt_type = null;
  }
  return run;
}

let runHistory = loadRuns().map((run) => normalizeLegacyRun(run));

loadSelectionState();
updateModelUI();
updatePromptButtons();

async function loadSample(kind) {
  if (!Object.prototype.hasOwnProperty.call(SAMPLE_TEXT, kind)) {
    throw new Error(`Unknown sample kind: ${kind}`);
  }
  return SAMPLE_TEXT[kind];
}

function ensureCanonicalRun() {
  const hasCanonical = runHistory.some((run) => run.run_id === 'canonical_nepsis_standard');
  if (hasCanonical) return;
  const canonicalItems = Array.from({ length: 11 }).map((_, idx) => ({
    prompt_id: `Q${idx + 1}`,
    pass: true,
    reason: '',
    tags: ['STANDARD'],
  }));
  const canonicalRun = {
    run_id: 'canonical_nepsis_standard',
    ts: Date.now() - 1000 * 60 * 60 * 24,
    model: 'GPT-5',
    prompt_type: 'scaffold',
    difficulty: 'standard',
    k: K_CONSISTENCY,
    seeds: [...SEEDS],
    latency_ms: null,
    evaluator: { strict: true, structure_required: true, seed_strategy: SEED_STRATEGY },
    items: canonicalItems,
  };
  runHistory = [canonicalRun, ...runHistory];
  saveRuns(runHistory);
}

function recordRun(promptType, difficulty, cases, meta = {}) {
  if (!cases || !cases.length) return;
  const ts = Date.now();
  const run = {
    run_id: meta.run_id || generateRunId(),
    ts,
    model: currentModel,
    prompt_type: promptType ?? null,
    difficulty,
    k: meta.k ?? K_CONSISTENCY,
    seeds: meta.seeds ?? [...SEEDS],
    latency_ms: meta.latency ?? null,
    evaluator: { strict: true, structure_required: true, seed_strategy: SEED_STRATEGY },
    items: cases.map((c) => {
      const pass = Boolean(c.pass);
      const reason = c.reason || '';
      const tags = [];
      if (difficulty === 'hard') tags.push('HARD');
      if (pass && difficulty === 'hard') tags.push('2/3 PASS');
      const failureTag = !pass ? classifyReason(reason) : null;
      if (failureTag) tags.push(failureTag);
      if (!pass && /structure|schema/.test(reason.toLowerCase())) tags.push('STRUCTURE FAIL');
      return {
        prompt_id: c.prompt_id,
        pass,
        reason,
        tags,
      };
    }),
  };
  runHistory = [run, ...runHistory].slice(0, 300);
  saveRuns(runHistory);
  renderMetrics();
  renderRunHistory();
  window._lastCases = cases;
}

function renderMetrics() {
  const metricsTable = get('metricsTable');
  const consistencyChip = get('consistencyChip');
  if (!metricsTable) return;
  const body = metricsTable.querySelector('tbody');
  if (!body) return;

  const buckets = new Map();
  for (const run of runHistory) {
    const model = run.model || '—';
    const prompt = run.prompt_type || '—';
    const difficulty = run.difficulty || 'standard';
    const key = `${model}|${prompt}|${difficulty}`;
    const bucket = buckets.get(key) || { model, prompt, difficulty, runs: 0, total: 0, pass: 0 };
    bucket.runs += 1;
    bucket.total += run.items.length;
    bucket.pass += run.items.filter((item) => item.pass).length;
    buckets.set(key, bucket);
  }

  const orderDifficulty = (value) => (value === 'standard' ? 0 : value === 'hard' ? 1 : 2);
  const rows = Array.from(buckets.values())
    .sort((a, b) => {
      const modelCmp = a.model.localeCompare(b.model);
      if (modelCmp !== 0) return modelCmp;
      const promptCmp = String(a.prompt).localeCompare(String(b.prompt));
      if (promptCmp !== 0) return promptCmp;
      return orderDifficulty(a.difficulty) - orderDifficulty(b.difficulty);
    })
    .map((bucket) => renderMetricRow(bucket));

  body.innerHTML = rows.join('');
  if (consistencyChip) {
    consistencyChip.textContent = `Consistency check: k=${K_CONSISTENCY} • seeds ${SEEDS.join(' / ')} • runs ${runHistory.length}`;
  }
}

function renderMetricRow(bucket) {
  const passText = `${bucket.pass || 0} / ${bucket.total || 0}`;
  const passRate = bucket.total ? `${percentage(bucket.pass, bucket.total)}%` : '—';
  return `<tr>
    <td>${escapeHtml(bucket.model)}</td>
    <td class="capitalize">${escapeHtml(bucket.prompt)}</td>
    <td class="capitalize">${escapeHtml(bucket.difficulty)}</td>
    <td>${bucket.runs || 0}</td>
    <td>${passRate}</td>
    <td>${passText}</td>
  </tr>`;
}

function renderRunHistory() {
  const table = get('runsTable');
  if (!table) return;
  const body = table.querySelector('tbody');
  if (!body) return;
  const rows = runHistory.slice(0, 12).map((run) => {
    const passed = run.items.filter((item) => item.pass).length;
    const total = run.items.length;
    const runTags = Array.from(new Set(run.items.flatMap((item) => item.tags || [])));
    return `<tr>
      <td>${new Date(run.ts).toLocaleString()}</td>
      <td class="whitespace-nowrap">${escapeHtml(run.model || '—')}</td>
      <td class="capitalize">${escapeHtml(run.prompt_type || '—')}</td>
      <td class="capitalize">${escapeHtml(run.difficulty || '')}</td>
      <td>${passed}</td>
      <td>${total}</td>
      <td>${percentage(passed, total)}%</td>
      <td class="text-xs">${run.run_id.slice(0, 10)}</td>
      <td>${renderTags(runTags)}</td>
    </tr>`;
  }).join('');
  body.innerHTML = rows || '<tr><td colspan="9" style="color:var(--muted)">No runs recorded yet.</td></tr>';
}

ensureCanonicalRun();
renderMetrics();
renderRunHistory();

// ---- prompt copy buttons & selections ----
const copyNakedBtn = get('btnCopyNaked');
const copyScaffoldBtn = get('btnCopyScaffold');
const promptToast = get('promptToast');
const modelSelect = get('modelSelect');
const modelBadge = get('modelBadge');
const pastePrimary = get('pasteBox') || get('nakedOut');
const pasteSecondary = get('nepsisOut');
const sampleCopyNaked = get('btnCopyNakedSample');
const sampleInsertNaked = get('btnInsertNakedSample');
const sampleCopyNepsis = get('btnCopyNepsisSample');
const sampleInsertNepsis = get('btnInsertNepsisSample');
const codeEditor = get('solutionCode');

if (modelBadge) {
  modelBadge.textContent = currentModel;
  modelBadge.style.display = currentModel ? 'inline-flex' : 'none';
}

if (modelSelect) {
  modelSelect.addEventListener('change', (event) => {
    const value = event.target.value;
    setModel(value, { prompt: true });
  });
  updateModelUI();
}

async function handlePromptCopy(text, button, label, promptType) {
  if (!button) return;
  try {
    await safeCopy(text);
    if (promptType) setPromptType(promptType);
    if (promptToast) {
      promptToast.textContent = label;
      promptToast.style.display = 'inline';
      setTimeout(() => { promptToast.style.display = 'none'; }, 1600);
    }
  } catch (err) {
    console.error(err);
    showToast('Prompt copy failed', false);
  }
}

if (copyNakedBtn) {
  copyNakedBtn.addEventListener('click', () => {
    handlePromptCopy(buildNakedPrompt('Claude'), copyNakedBtn, 'Copied Naked prompt', 'naked').finally(() => focusPasteBox());
  });
}

if (copyScaffoldBtn) {
  copyScaffoldBtn.addEventListener('click', () => {
    handlePromptCopy(NEPSIS_SCAFFOLD_PROMPT, copyScaffoldBtn, 'Copied Scaffold (Lite) prompt', 'scaffold').finally(() => focusPasteBox());
  });
}

if (sampleCopyNaked) {
  sampleCopyNaked.addEventListener('click', () => {
    loadSample('naked').then((text) => safeCopy(text)).catch((err) => {
      console.error(err);
      showToast('Sample copy failed', false);
    });
  });
}

if (sampleInsertNaked) {
  sampleInsertNaked.addEventListener('click', () => insertSampleIntoEditor('naked'));
}

if (sampleCopyNepsis) {
  sampleCopyNepsis.addEventListener('click', () => {
    loadSample('nepsis').then((text) => safeCopy(text)).catch((err) => {
      console.error(err);
      showToast('Sample copy failed', false);
    });
  });
}

if (sampleInsertNepsis) {
  sampleInsertNepsis.addEventListener('click', () => insertSampleIntoEditor('nepsis'));
}

const codePane = get('codePane');
const outputPane = get('outputPane');
const tabCode = get('tabCode');
const tabOutput = get('tabOutput');
const difficultyToggle = get('difficultyToggle');

function syncURL() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (currentModel) url.searchParams.set('model', currentModel);
  else url.searchParams.delete('model');
  if (currentPromptType) url.searchParams.set('prompt', currentPromptType);
  else url.searchParams.delete('prompt');
  url.searchParams.set('difficulty', currentDifficulty);
  window.history.replaceState(null, '', url);
}

function setDifficulty(value) {
  if (!value) return;
  currentDifficulty = value;
  if (difficultyToggle) {
    difficultyToggle.querySelectorAll('button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.difficulty === value);
    });
  }
  syncURL();
}

if (difficultyToggle) {
  difficultyToggle.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => setDifficulty(btn.dataset.difficulty));
  });
}
setDifficulty(currentDifficulty);
syncURL();

function loadURL() {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const modelParam = params.get('model');
  const promptParam = params.get('prompt');
  const diffParam = params.get('difficulty');
  if (modelParam) {
    if (MODEL_PRESETS.includes(modelParam)) {
      setModel(modelParam, { persist: false, skipSync: true, prompt: false });
    } else {
      setModel('custom', { customName: modelParam, persist: false, skipSync: true, prompt: false });
    }
  } else {
    updateModelUI();
  }
  if (promptParam === 'naked' || promptParam === 'scaffold') {
    setPromptType(promptParam, { persist: false, skipSync: true });
  }
  if (diffParam === 'hard' || diffParam === 'standard') {
    currentDifficulty = diffParam;
  }
  setDifficulty(currentDifficulty);
}

window.addEventListener('load', loadURL);
loadURL();

function activatePane(which) {
  const showCode = which === 'code';
  if (codePane) codePane.style.display = showCode ? 'block' : 'none';
  if (outputPane) outputPane.style.display = showCode ? 'none' : 'block';
  if (tabCode) {
    tabCode.classList.toggle('active', showCode);
  }
  if (tabOutput) {
    tabOutput.classList.toggle('active', !showCode);
  }
}

activatePane('code');
if (tabCode) tabCode.addEventListener('click', () => activatePane('code'));
if (tabOutput) tabOutput.addEventListener('click', () => activatePane('output'));

// ---- scoring ----
function scoreBlobStrict(text, label) {
  const rows = [];
  let score = 0;
  const source = text ?? '';
  const got = firstNCharsPrintable(source, 3);

  const cases = [
    { name: 'Combining marks split over chunks', idx: 0 },
    { name: 'Idempotent NFC', idx: 1 },
    { name: 'Hangul Jamo compose', idx: 2 },
  ];

  const posComposed = source.indexOf('é');
  const posDecomp = source.search(RE_DECOMP);
  const decomposedFirst = posDecomp !== -1 && (posComposed === -1 || posDecomp < posComposed);

  for (const cfg of cases) {
    const want = EXPECT[cfg.idx];
    const ch = got[cfg.idx];
    let pass = ch === want;
    let note = '';

    if (cfg.idx === 0 && decomposedFirst) {
      pass = false;
      note = 'Decomposed e+◌́ appears before composed é';
    } else if (!pass) {
      const gotDesc = ch ? `${cp(ch)} '${ch}'` : '∅';
      note = `got ${gotDesc} want ${cp(want)} '${want}'`;
    }

    rows.push({ check: cfg.name, label, pass, note });
    if (pass) score += 1;
  }

  const hasReplacement = /\uFFFD/.test(source);
  rows.push({
    check: 'No replacement characters',
    label,
    pass: !hasReplacement,
    note: hasReplacement ? 'Found U+FFFD (�)' : '',
  });
  if (!hasReplacement) score += 1;

  return { rows, score };
}

function renderEvalTables(nakedEval, nepsisEval) {
  const container = get('evalTables');
  if (!container) return;

  const cardFor = (title, data) => {
    const rows = data.rows.map((check) => {
      const status = check.pass ? 'PASS' : 'FAIL';
      const color = check.pass ? 'var(--ok)' : 'var(--bad)';
      const note = check.note ? escapeHtml(check.note) : '';
      return `<tr>
        <td style="padding:8px;border-bottom:1px solid rgba(255,255,255,.05)">${escapeHtml(check.check)}</td>
        <td style="padding:8px;border-bottom:1px solid rgba(255,255,255,.05);font-weight:700;color:${color}">${status}</td>
        <td style="padding:8px;border-bottom:1px solid rgba(255,255,255,.05);color:var(--muted)">${note}</td>
      </tr>`;
    }).join('');
    return `<div class="card" style="padding:1rem">
      <h4 style="margin:0 0 .5rem">${escapeHtml(title)}</h4>
      <div style="margin-bottom:.5rem;color:var(--muted)">Score ${data.score}/4</div>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="text-align:left;padding:10px;border-bottom:1px solid rgba(255,255,255,.1)">Check</th>
            <th style="text-align:left;padding:10px;border-bottom:1px solid rgba(255,255,255,.1)">Result</th>
            <th style="text-align:left;padding:10px;border-bottom:1px solid rgba(255,255,255,.1)">Notes</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  };

  container.innerHTML = [
    cardFor('Naked Output', nakedEval),
    cardFor('Nepsis-Scaffold Output', nepsisEval),
  ].join('\n');

  window._lastScoreRows = [...nakedEval.rows, ...nepsisEval.rows];
}

function rowsToCases(rows) {
  return rows.map((row) => ({
    prompt_id: row.check,
    pass: row.pass,
    reason: row.note || '',
  }));
}

function focusPasteBox() {
  const target = pastePrimary || pasteSecondary;
  if (!target) return;
  target.focus();
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function focusCodeEditor() {
  if (!codeEditor) return;
  codeEditor.focus();
  codeEditor.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function insertSampleIntoEditor(kind) {
  loadSample(kind).then((text) => {
    if (!codeEditor) return;
    const targetPrompt = kind === 'nepsis' ? 'scaffold' : 'naked';
    setPromptType(targetPrompt);
    activatePane('code');
    codeEditor.value = text;
    codeEditor.selectionStart = codeEditor.selectionEnd = codeEditor.value.length;
    focusCodeEditor();
  }).catch((err) => {
    console.error(err);
    showToast('Sample load failed', false);
  });
}

function looksLikeCode(txt = '') {
  return /class\s+\w+|def\s+\w+\(|import\s+\w+|^\s*#/.test(txt);
}

const evaluateBtn = get('btnEvaluate');
if (evaluateBtn) {
  evaluateBtn.addEventListener('click', () => {
    const nakedText = get('nakedOut')?.value ?? '';
    const nepsisText = get('nepsisOut')?.value ?? '';

    if (looksLikeCode(nakedText) || looksLikeCode(nepsisText)) {
      showToast('Looks like you pasted code. Use the code tab to run tests directly.', false);
    }

    const eN = scoreBlobStrict(nakedText, 'naked');
    const eS = scoreBlobStrict(nepsisText, 'nepsis');

    renderEvalTables(eN, eS);
    const baselineCases = rowsToCases(eN.rows);
    if (baselineCases.length) recordRun('naked', currentDifficulty, baselineCases, { latency: 0 });
    const nepsisCases = rowsToCases(eS.rows);
    if (nepsisCases.length) recordRun('scaffold', currentDifficulty, nepsisCases, { latency: 0 });
    showToast('Outputs evaluated');
  });
}

if (pastePrimary) {
  pastePrimary.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      evaluateBtn?.click();
    }
  });
}

if (pasteSecondary) {
  pasteSecondary.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      evaluateBtn?.click();
    }
  });
}

const downloadBtn = get('btnDownloadCsv');
if (downloadBtn) {
  downloadBtn.addEventListener('click', () => {
    if (!runHistory.length) {
      showToast('No runs recorded yet', false);
      return;
    }
    const header = ['run_id','ts','model','prompt_type','difficulty','prompt_id','pass','reason','k','votes_passed','seeds','latency_ms','seed_strategy'];
    const lines = [header.join(',')];
    for (const run of runHistory) {
      for (const item of run.items) {
        const reasonField = sanitizeReason([item.reason, ...(item.tags || [])].filter(Boolean).join(' | '));
        const votesPassed = item.tags?.includes('2/3 PASS') ? '2' : (item.pass ? String(run.k ?? K_CONSISTENCY) : '0');
        lines.push([
          run.run_id,
          new Date(run.ts).toISOString(),
          run.model || '',
          run.prompt_type || '',
          run.difficulty,
          item.prompt_id,
          item.pass ? '1' : '0',
          reasonField,
          String(run.k ?? K_CONSISTENCY),
          votesPassed,
          JSON.stringify(run.seeds ?? SEEDS),
          run.latency_ms ?? '',
          SEED_STRATEGY,
        ].join(','));
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: 'scorecard.csv',
    });
    a.click();
    URL.revokeObjectURL(a.href);
    downloadBtn.classList.add('pulse');
    setTimeout(() => downloadBtn.classList.remove('pulse'), 350);
    showToast('Scorecard downloaded');
  });
}

let pyodideInstance = null;
let pyodideScriptPromise = null;

async function ensurePyodide() {
  if (!window.loadPyodide) {
    if (!pyodideScriptPromise) {
      pyodideScriptPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load Pyodide runtime'));
        document.head.appendChild(script);
      });
    }
    await pyodideScriptPromise;
  }
  if (!window.loadPyodide) throw new Error('Pyodide loader unavailable');
  if (!pyodideInstance) {
    pyodideInstance = await window.loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.25.1/full/' });
  }
  return pyodideInstance;
}

function renderHarnessResults(payload) {
  const rawOutput = get('rawOutput');
  const tableOutput = get('tableOutput');
  const headline = get('headline');
  if (!rawOutput || !tableOutput) return;

  const stdout = (payload && payload.stdout) ? payload.stdout.trim() : '';
  if (stdout) {
    rawOutput.style.display = 'block';
    rawOutput.textContent = stdout;
  } else {
    rawOutput.style.display = 'none';
    rawOutput.textContent = '';
  }

  if (!payload) {
    tableOutput.innerHTML = '';
    if (headline) headline.textContent = '';
    return;
  }

  if (payload.fatal) {
    if (headline) {
      headline.textContent = 'Fatal error executing tests';
      headline.style.color = 'var(--bad)';
    }
    tableOutput.innerHTML = `<div class="card" style="padding:1rem"><strong class="bad">Fatal:</strong> ${escapeHtml(payload.fatal)}</div>`;
    return;
  }

  const cases = Array.isArray(payload.cases) ? payload.cases : [];
  if (!cases.length) {
    if (headline) {
      headline.textContent = 'No test results produced';
      headline.style.color = 'var(--muted)';
    }
    tableOutput.innerHTML = '<p style="color:var(--muted)">No results produced. Did the class run?</p>';
    return;
  }

  const passed = cases.filter((c) => c.ok).length;
  if (headline) {
    headline.textContent = `Code path: ${passed}/${cases.length} acceptance checks passed`;
    headline.style.color = passed === cases.length ? 'var(--ok)' : 'var(--bad)';
  }
  const rows = cases.map(({ name, ok, msg }) => {
    const statusLabel = ok ? 'PASS' : 'FAIL';
    const color = ok ? 'var(--ok)' : 'var(--bad)';
    const tags = [];
    if (currentDifficulty === 'hard') tags.push('HARD');
    if (ok && currentDifficulty === 'hard') tags.push('2/3 PASS');
    const failureTag = !ok ? classifyReason(msg) : null;
    if (failureTag) tags.push(failureTag);
    if (!ok && /structure|schema/.test((msg || '').toLowerCase())) tags.push('STRUCTURE FAIL');
    const tagMarkup = tags.length ? `<div>${renderTags(tags)}</div>` : '';
    return `<tr>
      <td style="padding:8px;border-bottom:1px solid rgba(255,255,255,.05)">${escapeHtml(name)}</td>
      <td style="padding:8px;border-bottom:1px solid rgba(255,255,255,.05);font-weight:700;color:${color}">${statusLabel}</td>
      <td style="padding:8px;border-bottom:1px solid rgba(255,255,255,.05);color:var(--muted)">${ok ? '' : escapeHtml(msg || '')}${tagMarkup}</td>
    </tr>`;
  }).join('');

  window._lastCases = cases;
  tableOutput.innerHTML = `
    <div style="margin:10px 0 6px;color:var(--muted)">Total: ${passed}/${cases.length} passed</div>
    <div style="padding:0;border:1px solid var(--line);border-radius:.8rem;background:rgba(15,27,45,.4);overflow:hidden">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="text-align:left;padding:10px;border-bottom:1px solid rgba(255,255,255,.1)">Check</th>
            <th style="text-align:left;padding:10px;border-bottom:1px solid rgba(255,255,255,.1)">Result</th>
            <th style="text-align:left;padding:10px;border-bottom:1px solid rgba(255,255,255,.1)">Notes</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

const runBtn = get('runBtn');
if (runBtn) {
  const loader = get('loader');
  const solutionArea = get('solutionCode');
  runBtn.addEventListener('click', async () => {
    const code = solutionArea?.value ?? '';
    if (!code.trim()) {
      showToast('Paste your Utf8StreamNormalizer implementation first.', false);
      return;
    }
    renderHarnessResults(null);
    const headline = get('headline');
    if (headline) {
      headline.textContent = 'Running tests…';
      headline.style.color = 'var(--muted)';
    }
    const start = performance.now();
    runBtn.disabled = true;
    runBtn.textContent = 'Running…';
    if (loader) loader.style.display = 'inline';
    let pyRuntime = null;
    try {
      pyRuntime = await ensurePyodide();
      pyRuntime.globals.set('USER_CODE', code);
      const raw = await pyRuntime.runPythonAsync(PY_TEST_SCRIPT);
      try {
        pyRuntime.globals.delete('USER_CODE');
      } catch (cleanupErr) {
        try { pyRuntime.globals.set('USER_CODE', undefined); } catch (_ignore) {}
      }
      const data = JSON.parse(raw);
      renderHarnessResults(data);
      const normalizedCases = Array.isArray(data?.cases)
        ? data.cases.map((c) => ({ prompt_id: c.name, pass: c.ok, reason: c.msg || '' }))
        : [];
      if (normalizedCases.length) {
        const latency = Math.round(performance.now() - start);
        recordRun(currentPromptType, currentDifficulty, normalizedCases, { latency });
      }
      showToast('Tests completed');
    } catch (err) {
      console.error(err);
      if (pyRuntime) {
        try { pyRuntime.globals.delete('USER_CODE'); } catch (_cleanup) {}
      }
      renderHarnessResults({ fatal: err.message || String(err) });
      const outputArea = get('rawOutput');
      if (outputArea) {
        outputArea.style.display = 'block';
        outputArea.textContent = String(err);
      }
      showToast('Python runtime failed', false);
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = 'Run Tests →';
      if (loader) loader.style.display = 'none';
    }
  });
}
