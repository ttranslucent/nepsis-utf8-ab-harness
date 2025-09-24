import unicodedata

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
        result.append(chr(cp))