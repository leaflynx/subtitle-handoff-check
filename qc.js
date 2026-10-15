/* Subtitle Handoff Check v0.1 — deterministic, dependency-free, offline QC.
 *
 * API: analyzeBatch({ files: [{name, text}], manifest?, profile? }).
 * Invalid API types throw TypeError; invalid numeric ranges / size limits throw
 * RangeError. Content defects are returned as issues, never evaluated as HTML.
 * Unknown manifest/profile keys are ignored; omitted known fields use defaults.
 *
 * Strict format scope:
 * - SRT needs a positive numeric index and HH:MM:SS,mmm timing (2+ hour digits).
 * - VTT needs WEBVTT plus a blank separator before cues; identifiers, NOTE,
 *   STYLE and REGION blocks are supported. VTT uses MM:SS.mmm or HH:MM:SS.mmm.
 *   Settings after end timestamps are accepted as opaque text, not validated.
 *   NOTE/STYLE/REGION bodies and header metadata are not CSS/schema validated.
 * - Cues must be separated by blank lines. Literal '-->' inside cue text is
 *   rejected to prevent merged/malformed timing blocks from silently passing.
 * - cue is the 1-based non-metadata block position, NOT an SRT number / VTT ID.
 *   Only cues with valid positive time ranges count; empty text still counts.
 * - Filenames match case-insensitively, otherwise exactly (no path rewriting).
 * - Identical content means equality after BOM and newline normalization only.
 * - Terms use case-insensitive LITERAL SUBSTRINGS of display text, PER FILE;
 *   no regex, whole-word, stemming, locale folding or Unicode normalization.
 *   Cue texts are joined with a newline; invalid cue blocks are excluded.
 * - Display checks strip tags, ASS override blocks, decode common/numeric
 *   entities, and treat <br> as a line break. This is NOT an HTML sanitizer:
 *   callers must render all user data / issue messages with textContent.
 *   CPS counts Unicode code points including spaces, excluding line breaks;
 *   line limits count code points, not rendered glyph widths or graphemes.
 * - Safety caps: 200 files; 5 MiB UTF-8 bytes/file; 20 MiB UTF-8 bytes/batch
 *   (before BOM/newline normalization); 20,000 blocks/file; 200,000 issues/batch;
 *   1,000 entries/manifest list and 1,000 UTF-16 units/name or term.
 */
(function expose(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (typeof window === 'object' && window) window.SubtitleQC = api;
  else if (root && typeof module === 'undefined') root.SubtitleQC = api;
})(typeof globalThis === 'object' ? globalThis : this, function factory() {
  'use strict';
  const DEFAULTS = Object.freeze({maxCps: 20, maxLineLength: 42, maxLines: 2, minDurationMs: 600, maxDurationMs: 7000});
  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  const MAX_BATCH_BYTES = 20 * 1024 * 1024;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const objectLike = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const normalize = text => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

  function utf8ByteLength(text) {
    // Count without allocating an encoded copy or requiring TextEncoder/Buffer.
    // Lone surrogates encode as U+FFFD (3 bytes); valid pairs use 4 bytes.
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
      const unit = text.charCodeAt(i);
      if (unit < 0x80) bytes++;
      else if (unit < 0x800) bytes += 2;
      else if (unit >= 0xd800 && unit <= 0xdbff && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    }
    return bytes;
  }

  function stringValue(value, label) {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a nonempty string.`);
    if (value.length > 1000) throw new RangeError(`${label} exceeds 1,000 characters.`);
    return value;
  }

  function options(input) {
    if (!objectLike(input) || !Array.isArray(input.files)) throw new TypeError('files must be an array.');
    if (input.files.length > 200) throw new RangeError('Maximum 200 files per batch.');
    let totalBytes = 0;
    const files = [];
    // Indexed iteration deliberately validates sparse arrays instead of skipping holes.
    for (let i = 0; i < input.files.length; i++) {
      const file = input.files[i];
      if (!objectLike(file)) throw new TypeError(`files[${i}] must be an object.`);
      const name = stringValue(file.name, `files[${i}].name`);
      if (typeof file.text !== 'string') throw new TypeError(`files[${i}].text must be a string.`);
      // UTF-8 uses at least one byte per UTF-16 unit: reject huge strings before scanning.
      if (file.text.length > MAX_FILE_BYTES) throw new RangeError(`files[${i}].text exceeds the 5 MiB (5,242,880 UTF-8 bytes) per-file limit.`);
      const bytes = utf8ByteLength(file.text);
      if (bytes > MAX_FILE_BYTES) throw new RangeError(`files[${i}].text exceeds the 5 MiB (5,242,880 UTF-8 bytes) per-file limit.`);
      totalBytes += bytes;
      if (totalBytes > MAX_BATCH_BYTES) throw new RangeError('Subtitle content exceeds the 20 MiB (20,971,520 UTF-8 bytes) batch limit.');
      files.push({name, text: file.text});
    }
    const rawManifest = own(input, 'manifest') ? input.manifest : {};
    if (!objectLike(rawManifest)) throw new TypeError('manifest must be an object.');
    const manifest = {};
    for (const key of ['expectedFiles', 'requiredTerms', 'forbiddenTerms']) {
      const values = own(rawManifest, key) ? rawManifest[key] : [];
      if (!Array.isArray(values)) throw new TypeError(`manifest.${key} must be an array.`);
      if (values.length > 1000) throw new RangeError(`manifest.${key} exceeds 1,000 entries.`);
      const unique = new Map();
      for (let i = 0; i < values.length; i++) {
        const value = stringValue(values[i], `manifest.${key}[${i}]`);
        if (!unique.has(value.toLowerCase())) unique.set(value.toLowerCase(), value);
      }
      manifest[key] = Array.from(unique.values());
    }
    const rawProfile = own(input, 'profile') ? input.profile : {};
    if (!objectLike(rawProfile)) throw new TypeError('profile must be an object.');
    const profile = {};
    for (const key of Object.keys(DEFAULTS)) {
      const value = own(rawProfile, key) ? rawProfile[key] : DEFAULTS[key];
      if (typeof value !== 'number') throw new TypeError(`profile.${key} must be a number.`);
      if (!Number.isFinite(value) || value < 0) throw new RangeError(`profile.${key} must be finite and nonnegative.`);
      if ((key === 'maxLines' || key === 'maxLineLength') && !Number.isSafeInteger(value)) throw new RangeError(`profile.${key} must be a safe integer.`);
      profile[key] = value;
    }
    if (profile.minDurationMs > profile.maxDurationMs) throw new RangeError('minDurationMs cannot exceed maxDurationMs.');
    return {files, manifest, profile};
  }

  function timestamp(value, format) {
    // Bounded digit counts also prevent imprecise/overflowing hour arithmetic.
    const match = format === 'srt'
      ? /^(\d{2,9}):(\d{2}):(\d{2}),(\d{3})$/.exec(value)
      : /^(?:(\d{2,9}):)?(\d{2}):(\d{2})\.(\d{3})$/.exec(value);
    if (!match) return null;
    const hours = Number(match[1] || 0), minutes = Number(match[2]), seconds = Number(match[3]);
    if (minutes > 59 || seconds > 59) return null;
    const ms = ((hours * 60 + minutes) * 60 + seconds) * 1000 + Number(match[4]);
    return Number.isSafeInteger(ms) ? ms : null;
  }

  function displayText(text) {
    // A single forward scan avoids pathological repeated '<' regex backtracking.
    const parts = [];
    let cursor = 0;
    while (cursor < text.length) {
      const open = text.indexOf('<', cursor);
      if (open < 0) { parts.push(text.slice(cursor)); break; }
      parts.push(text.slice(cursor, open));
      const close = text.indexOf('>', open + 1);
      if (close < 0) { parts.push(text.slice(open)); break; }
      const body = text.slice(open + 1, close);
      if (/^br\s*\/?$/i.test(body)) parts.push('\n');
      else if (!/^\/?[a-z]/i.test(body) && !/^(?:\d{2,9}:)?\d{2}:\d{2}\.\d{3}$/.test(body)) parts.push(text.slice(open, close + 1));
      cursor = close + 1;
    }
    const entities = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '\u200e', rlm: '\u200f'};
    return parts.join('').replace(/\{\\[^{}]*\}/g, '').replace(/&(#(?:x[0-9a-f]{1,6}|[0-9]{1,7})|[a-z]{2,8});/gi, (original, entity) => {
      const key = entity.toLowerCase();
      if (key[0] !== '#') return own(entities, key) ? entities[key] : original;
      const number = key[1] === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : original;
    });
  }

  function parse(text, format, add) {
    const blocks = text.split(/\n[ \t]*\n/).map(block => block.replace(/\n+$/, '')).filter(block => block.trim());
    if (blocks.length > 20000) throw new RangeError('Maximum 20,000 subtitle blocks per file.');
    if (format === 'vtt') {
      const header = blocks[0] || '';
      if (!/^WEBVTT(?:[ \t][^\n]*)?(?:\n|$)/.test(header) || header.includes('-->')) {
        add('error', 'MALFORMED_HEADER', null, 'VTT requires a WEBVTT header and a blank line before cues.');
        // Keep parsing non-header blocks so recoverable cue counts remain useful.
        if (/^WEBVTT(?:[ \t\n]|$)/.test(header)) blocks.shift();
      } else blocks.shift();
    }
    const cues = [];
    let ordinal = 0;
    for (const block of blocks) {
      const lines = block.split('\n');
      if (format === 'vtt' && /^NOTE(?:[ \t].*)?$/.test(lines[0])) continue;
      if (format === 'vtt' && /^(?:STYLE|REGION)$/.test(lines[0])) {
        if (block.includes('-->')) add('error', 'MALFORMED_BLOCK', null, 'STYLE/REGION metadata cannot contain a cue timing arrow; check blank separators.');
        continue;
      }
      const cue = ++ordinal;
      let timingIndex;
      if (format === 'srt') {
        if (!/^[0-9]+$/.test(lines[0]) || !Number.isSafeInteger(Number(lines[0])) || Number(lines[0]) < 1) {
          add('error', 'MALFORMED_BLOCK', cue, 'SRT cue must begin with a positive integer index.'); continue;
        }
        timingIndex = 1;
      } else timingIndex = lines[0].includes('-->') ? 0 : 1;
      const timing = lines[timingIndex] || '';
      const match = /^(\S+)[ \t]+-->[ \t]+(\S+)(?:[ \t]+(.+))?$/.exec(timing.trim());
      if (!match || (format === 'srt' && match[3]) || (match[3] && match[3].includes('-->'))) {
        add('error', 'MALFORMED_BLOCK', cue, 'Cue needs one timing line with start --> end timestamps.'); continue;
      }
      const start = timestamp(match[1], format), end = timestamp(match[2], format);
      if (start === null || end === null) {
        add('error', 'INVALID_TIMESTAMP', cue, `Invalid ${format.toUpperCase()} timestamp syntax or component range.`); continue;
      }
      if (end <= start) {
        add('error', 'INVALID_TIME_RANGE', cue, 'End timestamp must be strictly later than start.'); continue;
      }
      const payload = lines.slice(timingIndex + 1).join('\n');
      if (payload.includes('-->')) {
        add('error', 'MALFORMED_BLOCK', cue, 'Unexpected timing arrow in cue text; check blank cue separators.'); continue;
      }
      const cleanText = displayText(payload);
      if (!cleanText.trim()) add('error', 'EMPTY_CUE', cue, 'Cue has no visible text.');
      cues.push({cue, start, end, text: cleanText});
    }
    if (!cues.length) add('error', 'NO_CUES', null, 'No cues with valid positive time ranges were found.');
    return cues;
  }

  function inspect(cues, profile, add) {
    let previousStart = -1;
    for (const cue of cues) {
      if (cue.start < previousStart) add('error', 'OUT_OF_ORDER', cue.cue, 'Cue starts before the previous cue.');
      previousStart = cue.start;
      const duration = cue.end - cue.start;
      if (duration < profile.minDurationMs) add('warning', 'SHORT_DURATION', cue.cue, `Duration ${duration} ms is below ${profile.minDurationMs} ms.`);
      if (duration > profile.maxDurationMs) add('warning', 'LONG_DURATION', cue.cue, `Duration ${duration} ms exceeds ${profile.maxDurationMs} ms.`);
      const lines = cue.text.split('\n');
      if (lines.length > profile.maxLines) add('warning', 'TOO_MANY_LINES', cue.cue, `${lines.length} display lines exceed ${profile.maxLines}.`);
      let characters = 0, longest = 0;
      for (const line of lines) {
        let length = 0;
        for (const character of line) { void character; length++; }
        characters += length; longest = Math.max(longest, length);
      }
      if (longest > profile.maxLineLength) add('warning', 'LONG_LINE', cue.cue, `Longest display line is ${longest} characters; limit ${profile.maxLineLength}.`);
      const cps = characters * 1000 / duration;
      if (cps > profile.maxCps) add('warning', 'HIGH_CPS', cue.cue, `Reading speed ${cps.toFixed(2)} characters/second exceeds ${profile.maxCps}.`);
    }
    // Chronological sweep finds nested overlaps without quadratic pair expansion.
    const ordered = cues.slice().sort((a, b) => a.start - b.start || a.cue - b.cue);
    let farthestEnd = -1;
    for (const cue of ordered) {
      if (cue.start < farthestEnd) add('error', 'OVERLAP', cue.cue, 'Cue overlaps another cue in this file.');
      farthestEnd = Math.max(farthestEnd, cue.end);
    }
  }

  function analyzeBatch(input) {
    const {files, manifest, profile} = options(input);
    const issues = [], results = [];
    const expected = new Set(manifest.expectedFiles.map(name => name.toLowerCase()));
    const names = new Map(), contents = new Map();
    const addIssue = (severity, code, file, cue, message) => {
      if (issues.length >= 200000) throw new RangeError('Maximum 200,000 issues per batch; narrow the input.');
      issues.push({severity, code, file, cue, message});
    };
    for (const file of files) {
      const add = (severity, code, cue, message) => addIssue(severity, code, file.name, cue, message);
      const key = file.name.toLowerCase(), text = normalize(file.text);
      if (names.has(key)) add('error', 'DUPLICATE_FILENAME', null, `Filename duplicates ${names.get(key)} (case-insensitive).`);
      else names.set(key, file.name);
      if (contents.has(text)) add('warning', 'IDENTICAL_CONTENT', null, `Content is identical to ${contents.get(text)} after BOM/newline normalization.`);
      else contents.set(text, file.name);
      if (expected.size && !expected.has(key)) add('error', 'UNEXPECTED_FILE', null, 'Filename is not in the expected file list.');
      const format = /\.srt$/i.test(file.name) ? 'srt' : /\.vtt$/i.test(file.name) ? 'vtt' : null;
      let cues = [];
      if (!text.trim()) add('error', 'EMPTY_FILE', null, 'File is empty or contains only whitespace.');
      if (!format) add('error', 'UNSUPPORTED_FORMAT', null, 'Only .srt and .vtt subtitle files are supported.');
      if (format && text.trim()) {
        cues = parse(text, format, add);
        inspect(cues, profile, add);
      }
      const searchable = cues.map(cue => cue.text).join('\n').toLowerCase();
      for (const term of manifest.requiredTerms) {
        if (!searchable.includes(term.toLowerCase())) add('error', 'MISSING_REQUIRED_TERM', null, `Required literal term not found: ${term}`);
      }
      for (const term of manifest.forbiddenTerms) {
        if (searchable.includes(term.toLowerCase())) add('error', 'FORBIDDEN_TERM', null, `Forbidden literal term found: ${term}`);
      }
      results.push({name: file.name, cueCount: cues.length});
    }
    for (const expectedName of manifest.expectedFiles) {
      if (!names.has(expectedName.toLowerCase())) addIssue('error', 'MISSING_FILE', expectedName, null, 'Expected file is missing from this batch.');
    }
    let errorCount = 0, warningCount = 0;
    for (const issue of issues) issue.severity === 'error' ? errorCount++ : warningCount++;
    return {
      summary: {fileCount: files.length, cueCount: results.reduce((total, file) => total + file.cueCount, 0), errorCount, warningCount},
      issues, files: results
    };
  }
  return Object.freeze({analyzeBatch});
});
