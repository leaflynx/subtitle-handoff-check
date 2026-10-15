'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const enginePath = path.join(__dirname, '..', 'qc.js');
const analyze = input => require(enginePath).analyzeBatch(input);
const srt = (text = 'Hello world', start = '00:00:01,000', end = '00:00:03,000', id = 1) => `${id}\n${start} --> ${end}\n${text}`;
const vtt = (text = 'Hello world', timing = '00:01.000 --> 00:03.000') => `WEBVTT\n\n${timing}\n${text}`;
const run = (text = srt(), name = 'a.srt', extra = {}) => analyze({files: [{name, text}], ...extra});
const has = (result, code) => result.issues.some(issue => issue.code === code);
const codes = result => result.issues.map(issue => issue.code);

test('CommonJS exports analyzeBatch', () => assert.equal(typeof require(enginePath).analyzeBatch, 'function'));
test('browser global works without CommonJS or DOM', () => {
  const context = {window: {}};
  vm.runInNewContext(fs.readFileSync(enginePath, 'utf8'), context);
  assert.equal(typeof context.window.SubtitleQC.analyzeBatch, 'function');
  assert.equal(context.window.SubtitleQC.analyzeBatch({files: []}).summary.fileCount, 0);
});
test('clean SRT returns the complete stable result shape', () => assert.deepEqual(run(), {
  summary: {fileCount: 1, cueCount: 1, errorCount: 0, warningCount: 0},
  issues: [], files: [{name: 'a.srt', cueCount: 1}]
}));
test('empty batch is valid', () => assert.deepEqual(analyze({files: []}).summary, {fileCount: 0, cueCount: 0, errorCount: 0, warningCount: 0}));
test('BOM, CRLF and uppercase extensions work', () => assert.equal(run('\uFEFF' + srt().replaceAll('\n', '\r\n'), 'CAPTIONS.SRT').issues.length, 0));
test('VTT supports short and long timestamps, cue IDs and settings', () => {
  const result = run('WEBVTT\n\nintro\n00:01.000 --> 00:03.000 align:start position:10%\nHello\n\n00:00:04.000 --> 00:00:06.000\nWorld', 'a.vtt');
  assert.equal(result.summary.cueCount, 2); assert.deepEqual(result.issues, []);
});
test('VTT skips NOTE, STYLE and REGION metadata blocks', () => {
  const result = run('WEBVTT title\nLanguage: en\n\nNOTE comment\nnot a cue --> ignored\n\nSTYLE\n::cue { color: red; }\n\nREGION\nid:region1\n\n00:01.000 --> 00:03.000\nHello', 'a.vtt');
  assert.equal(result.summary.cueCount, 1); assert.deepEqual(result.issues, []);
});
test('VTT NOTE with a tab is a comment', () => assert.deepEqual(run('WEBVTT\n\nNOTE\tcomment\nanything\n\n00:01.000 --> 00:03.000\nHello', 'a.vtt').issues, []));
test('missing VTT header is an error', () => assert.ok(has(run('00:01.000 --> 00:03.000\nHello', 'a.vtt'), 'MALFORMED_HEADER')));
test('VTT header cannot silently swallow a cue without separator', () => assert.ok(has(run('WEBVTT\n00:01.000 --> 00:03.000\nHello', 'a.vtt'), 'MALFORMED_HEADER')));
test('empty and whitespace-only files are errors', () => {
  for (const text of ['', ' \r\n\t', '\uFEFF']) assert.ok(has(run(text), 'EMPTY_FILE'));
});
test('unsupported extension is an error even if content looks valid', () => assert.ok(has(run(srt(), 'a.txt'), 'UNSUPPORTED_FORMAT')));
test('metadata-only VTT has no cues and is an error', () => assert.ok(has(run('WEBVTT\n\nNOTE only a note', 'a.vtt'), 'NO_CUES')));
test('mixed valid and malformed blocks cannot silently pass', () => {
  const result = run(srt() + '\n\nthis is broken\n\n' + srt('Second', '00:00:04,000', '00:00:06,000', 3));
  assert.equal(result.summary.cueCount, 2); assert.ok(has(result, 'MALFORMED_BLOCK'));
  assert.equal(result.issues.find(i => i.code === 'MALFORMED_BLOCK').cue, 2);
});
test('missing blank between cues is not accepted as subtitle text', () => assert.ok(has(run(srt() + '\n' + srt('Second', '00:00:04,000', '00:00:06,000', 2)), 'MALFORMED_BLOCK')));
test('SRT requires a positive integer cue index', () => {
  for (const id of ['x', '0', '-1']) assert.ok(has(run(srt('Hello', undefined, undefined, id)), 'MALFORMED_BLOCK'));
});
test('invalid timestamp components and fraction widths are rejected', () => {
  for (const start of ['00:60:00,000', '00:00:60,000', '00:00:01,00', '0:00:01,000', '-01:00:01,000', '00:00:01.000', 'NaN', '999999999999999999:00:00,000']) {
    assert.ok(has(run(srt('Hello', start)), 'INVALID_TIMESTAMP'), start);
  }
});
test('VTT requires dots, valid ranges and two-digit seconds', () => {
  for (const start of ['00:01,000', '60:00.000', '00:60.000', '00:1.000']) assert.ok(has(run(vtt('Hello', `${start} --> 00:03.000`), 'a.vtt'), 'INVALID_TIMESTAMP'));
});
test('equal and reversed timestamps are errors', () => {
  for (const end of ['00:00:01,000', '00:00:00,999']) assert.ok(has(run(srt('Hello', '00:00:01,000', end)), 'INVALID_TIME_RANGE'));
});
test('empty cue and markup-only cue are errors', () => {
  assert.ok(has(run('1\n00:00:01,000 --> 00:00:03,000'), 'EMPTY_CUE'));
  assert.ok(has(run(srt('<i> </i>')), 'EMPTY_CUE'));
});
test('overlaps are found even after a nested cue', () => {
  const result = run(srt('First', '00:00:00,000', '00:00:06,000') + '\n\n' + srt('Second', '00:00:01,000', '00:00:02,000', 2) + '\n\n' + srt('Third', '00:00:03,000', '00:00:04,000', 3));
  assert.deepEqual(result.issues.filter(i => i.code === 'OVERLAP').map(i => i.cue), [2, 3]);
});
test('touching timestamps are not overlaps', () => assert.ok(!has(run(srt() + '\n\n' + srt('Next', '00:00:03,000', '00:00:05,000', 2)), 'OVERLAP')));
test('out-of-order cues are reported and overlaps still detected', () => {
  const result = run(srt('Later', '00:00:04,000', '00:00:06,000') + '\n\n' + srt('Earlier', '00:00:03,000', '00:00:05,000', 2));
  assert.ok(has(result, 'OUT_OF_ORDER')); assert.ok(has(result, 'OVERLAP'));
});
test('reading speed, short duration, line length and count warn', () => {
  const result = run(srt('x'.repeat(43) + '\nsecond\nthird', '00:00:01,000', '00:00:01,500'));
  for (const code of ['HIGH_CPS', 'SHORT_DURATION', 'LONG_LINE', 'TOO_MANY_LINES']) assert.ok(has(result, code), code);
});
test('long duration warns', () => assert.ok(has(run(srt('Hello', '00:00:01,000', '00:00:09,000')), 'LONG_DURATION')));
test('exact threshold boundaries do not warn', () => assert.deepEqual(run(srt('abcd', '00:00:01,000', '00:00:02,000'), 'a.srt', {profile: {maxCps: 4, maxLineLength: 4, maxLines: 1, minDurationMs: 1000, maxDurationMs: 1000}}).issues, []));
test('common display markup/entities are removed before text checks', () => {
  const result = run(srt('<i>A</i><b>B</b><u>C</u><font color="red">D</font>{\\an8}&amp;'), 'a.srt', {profile: {maxLineLength: 5, maxCps: 3}, manifest: {requiredTerms: ['ABCD&']}});
  assert.deepEqual(result.issues, []);
});
test('VTT voice/class/timestamp tags and br line breaks are handled', () => {
  const result = run(vtt('<v Roger><c.green>Hello</c></v><00:02.000><br>world'), 'a.vtt', {profile: {maxLines: 1}, manifest: {requiredTerms: ['hello\nworld']}});
  assert.ok(has(result, 'TOO_MANY_LINES')); assert.ok(!has(result, 'MISSING_REQUIRED_TERM'));
});
test('Unicode length counts code points instead of UTF-16 halves', () => assert.deepEqual(run(srt('😀😀'), 'a.srt', {profile: {maxLineLength: 2, maxCps: 1}}).issues, []));
test('required terms are per-file case-insensitive literal substrings', () => {
  const result = analyze({files: [{name: 'a.srt', text: srt('Use A+B and CATalog')}, {name: 'b.srt', text: srt('Nothing')}], manifest: {requiredTerms: ['a+b', 'cat']}});
  const missing = result.issues.filter(i => i.code === 'MISSING_REQUIRED_TERM');
  assert.equal(missing.length, 2); assert.ok(missing.every(i => i.file === 'b.srt' && i.cue === null));
});
test('forbidden terms are case-insensitive literal substrings, not regex', () => {
  const result = run(srt('Bad [x] term'), 'a.srt', {manifest: {forbiddenTerms: ['BAD', '[x]', '.*']}});
  assert.equal(result.issues.filter(i => i.code === 'FORBIDDEN_TERM').length, 2);
});
test('empty expected list disables missing/unexpected filename checks', () => assert.ok(!codes(run(srt(), 'a.srt', {manifest: {expectedFiles: []}})).some(c => ['MISSING_FILE', 'UNEXPECTED_FILE'].includes(c))));
test('expected filenames use case-insensitive exact names', () => {
  const result = run(srt(), 'A.SRT', {manifest: {expectedFiles: ['a.srt', 'b.srt']}});
  assert.equal(result.issues.filter(i => i.code === 'MISSING_FILE').length, 1);
  assert.equal(result.issues.find(i => i.code === 'MISSING_FILE').file, 'b.srt');
  assert.ok(!has(result, 'UNEXPECTED_FILE'));
});
test('unexpected filenames are reported when expected list is nonempty', () => assert.ok(has(run(srt(), 'other.srt', {manifest: {expectedFiles: ['a.srt']}}), 'UNEXPECTED_FILE')));
test('duplicate filenames are case-insensitive and file-level errors', () => {
  const result = analyze({files: [{name: 'A.srt', text: srt()}, {name: 'a.SRT', text: srt('Other')}]});
  const issue = result.issues.find(i => i.code === 'DUPLICATE_FILENAME');
  assert.equal(issue.severity, 'error'); assert.equal(issue.cue, null);
});
test('identical content is detected after BOM/newline normalization', () => {
  const result = analyze({files: [{name: 'a.srt', text: srt()}, {name: 'b.srt', text: '\uFEFF' + srt().replaceAll('\n', '\r\n')}]});
  assert.ok(has(result, 'IDENTICAL_CONTENT')); assert.equal(result.issues.find(i => i.code === 'IDENTICAL_CONTENT').cue, null);
});
test('summary counts exactly match returned issues and files', () => {
  const result = analyze({files: [{name: 'a.srt', text: srt('X'.repeat(50), '00:00:01,000', '00:00:01,100')}, {name: 'bad.srt', text: 'bad'}]});
  assert.equal(result.summary.errorCount, result.issues.filter(i => i.severity === 'error').length);
  assert.equal(result.summary.warningCount, result.issues.filter(i => i.severity === 'warning').length);
  assert.equal(result.summary.cueCount, result.files.reduce((sum, f) => sum + f.cueCount, 0));
  for (const issue of result.issues) {
    assert.match(issue.code, /^[A-Z][A-Z0-9_]*$/);
    assert.equal(typeof issue.file, 'string'); assert.equal(typeof issue.message, 'string');
    assert.ok(issue.cue === null || Number.isInteger(issue.cue));
  }
});
test('rejects invalid input and file types', () => {
  for (const input of [undefined, null, [], {}, {files: 'x'}, {files: [null]}, {files: [{name: '', text: ''}]}, {files: [{name: 'x.srt', text: 3}]}]) assert.throws(() => analyze(input), TypeError);
});
test('manifest and its arrays must have correct types', () => {
  for (const manifest of [null, [], 'x', {expectedFiles: 'a.srt'}, {requiredTerms: [2]}, {forbiddenTerms: ['']}, {requiredTerms: ['  ']}]) assert.throws(() => analyze({files: [], manifest}), TypeError);
});
test('profile must be an object with finite nonnegative numeric thresholds', () => {
  for (const profile of [null, [], 'x', {maxCps: '20'}, {maxLines: NaN}, {maxDurationMs: Infinity}, {maxCps: -1}, {maxLines: 1.5}, {minDurationMs: 100, maxDurationMs: 50}]) assert.throws(() => analyze({files: [], profile}));
});
test('zero thresholds are accepted and effective', () => {
  const result = run(srt(), 'a.srt', {profile: {maxCps: 0, maxLineLength: 0, maxLines: 0, minDurationMs: 0, maxDurationMs: 0}});
  for (const code of ['HIGH_CPS', 'LONG_LINE', 'TOO_MANY_LINES', 'LONG_DURATION']) assert.ok(has(result, code));
});
test('no mutation and deterministic repeat calls', () => {
  const input = {files: [{name: 'a.srt', text: srt('X'.repeat(50))}], manifest: {expectedFiles: ['a.srt'], requiredTerms: ['Hello'], forbiddenTerms: ['no']}, profile: {maxCps: 5}};
  const original = JSON.stringify(input);
  Object.freeze(input.files[0]); Object.freeze(input.files); Object.freeze(input.manifest.expectedFiles); Object.freeze(input.manifest.requiredTerms); Object.freeze(input.manifest.forbiddenTerms); Object.freeze(input.manifest); Object.freeze(input.profile); Object.freeze(input);
  assert.deepEqual(analyze(input), analyze(input)); assert.equal(JSON.stringify(input), original);
});
test('malicious subtitle strings never execute HTML or JavaScript', () => {
  const context = {window: {}, invoked: false};
  vm.runInNewContext(fs.readFileSync(enginePath, 'utf8'), context);
  const payload = '<img src=x onerror="invoked=true"><script>invoked=true</script>Hello';
  const result = context.window.SubtitleQC.analyzeBatch({files: [{name: '<script>.srt', text: srt(payload)}], manifest: {requiredTerms: ['<img onerror=evil>']}});
  assert.equal(context.invoked, false); assert.equal(result.summary.cueCount, 1);
});
test('prototype-looking filenames and literal terms are ordinary data', () => {
  const result = analyze({files: [{name: '__proto__.srt', text: srt('constructor __proto__')}], manifest: {expectedFiles: ['__proto__.srt'], requiredTerms: ['__proto__'], forbiddenTerms: ['[a-z]+']}});
  assert.deepEqual(result.issues, []);
});
const FILE_BYTES = 5 * 1024 * 1024;
const BATCH_BYTES = 20 * 1024 * 1024;
// An invalid first line keeps boundary tests out of expensive cue text checks.
const paddedMalformed = (bytes, suffix = '') => {
  const prefix = 'invalid\n';
  return prefix + 'x'.repeat(bytes - Buffer.byteLength(prefix + suffix, 'utf8')) + suffix;
};
const fileByteError = error => error.name === 'RangeError' && /5 MiB.*5,242,880 UTF-8 bytes.*per-file/.test(error.message);
const batchByteError = error => error.name === 'RangeError' && /20 MiB.*20,971,520 UTF-8 bytes.*batch/.test(error.message);

test('valid 2,000,032-byte SRT analyzes above the former character cap without mutation', () => {
  const text = srt('x'.repeat(2_000_000));
  assert.equal(Buffer.byteLength(text, 'utf8'), 2_000_032);
  const file = Object.freeze({name: 'large.srt', text});
  const files = Object.freeze([file]);
  const input = Object.freeze({files});
  const result = analyze(input);
  assert.equal(result.summary.cueCount, 1);
  assert.equal(result.summary.errorCount, 0);
  assert.equal(input.files, files);
  assert.equal(input.files[0], file);
  assert.equal(file.text, text);
});
test('six valid 1,800,032-byte SRTs analyze as a 10,800,192-byte batch', () => {
  const text = srt('x'.repeat(1_800_000));
  assert.equal(Buffer.byteLength(text, 'utf8'), 1_800_032);
  const files = Array.from({length: 6}, (_, i) => ({name: `${i}.srt`, text}));
  assert.equal(files.reduce((sum, file) => sum + Buffer.byteLength(file.text, 'utf8'), 0), 10_800_192);
  const result = analyze({files});
  assert.equal(result.summary.fileCount, 6);
  assert.equal(result.summary.cueCount, 6);
  assert.equal(result.summary.errorCount, 0);
});
test('per-file byte cap accepts exactly 5 MiB and rejects one byte over', () => {
  const text = paddedMalformed(FILE_BYTES);
  assert.equal(Buffer.byteLength(text, 'utf8'), FILE_BYTES);
  assert.ok(has(run(text), 'MALFORMED_BLOCK'));
  assert.throws(() => run(text + 'x'), fileByteError);
});
test('UTF-8 byte cap counts two/three-byte characters, surrogate pairs and lone surrogates', () => {
  for (const suffix of ['é', '漢', '😀', '\ud800', '\udc00', '\ud800A', '\ud800\ud800\udc00']) {
    const text = paddedMalformed(FILE_BYTES, suffix);
    assert.equal(Buffer.byteLength(text, 'utf8'), FILE_BYTES);
    assert.ok(text.length < FILE_BYTES);
    assert.ok(has(run(text), 'MALFORMED_BLOCK'));
    assert.throws(() => run(text + 'x'), fileByteError);
  }
  // Far below the UTF-16 character cap but above the UTF-8 byte cap.
  const text = 'invalid\n' + '漢'.repeat(1_800_000);
  assert.ok(text.length < 2_000_000);
  assert.ok(Buffer.byteLength(text, 'utf8') > FILE_BYTES);
  assert.throws(() => run(text), fileByteError);
});
test('batch byte cap accepts exactly 20 MiB and rejects one byte over before parsing', () => {
  const text = paddedMalformed(FILE_BYTES, '😀');
  const files = Array.from({length: 4}, (_, i) => Object.freeze({name: `${i}.srt`, text}));
  assert.equal(files.reduce((sum, file) => sum + Buffer.byteLength(file.text, 'utf8'), 0), BATCH_BYTES);
  const input = Object.freeze({files: Object.freeze(files)});
  const result = analyze(input);
  assert.equal(result.summary.fileCount, 4);
  assert.equal(result.summary.cueCount, 0);
  assert.ok(has(result, 'MALFORMED_BLOCK'));
  // A new, individually tiny file must exceed the aggregate cap, not the file cap.
  const overFiles = Object.freeze([...files, Object.freeze({name: 'over.srt', text: 'x'})]);
  assert.throws(() => analyze(Object.freeze({files: overFiles})), batchByteError);
  assert.equal(input.files, files);
  assert.ok(files.every(file => file.text === text));
});
test('browser byte limits work without TextEncoder, Buffer or CommonJS', () => {
  const context = {window: {}};
  vm.createContext(context);
  assert.equal(vm.runInContext('typeof TextEncoder', context), 'undefined');
  assert.equal(vm.runInContext('typeof Buffer', context), 'undefined');
  vm.runInContext(fs.readFileSync(enginePath, 'utf8'), context);
  const browserAnalyze = context.window.SubtitleQC.analyzeBatch;
  const text = paddedMalformed(FILE_BYTES, 'é漢😀\ud800\udc00\udc00');
  assert.equal(Buffer.byteLength(text, 'utf8'), FILE_BYTES);
  assert.equal(browserAnalyze({files: [{name: 'a.srt', text}]}).summary.fileCount, 1);
  assert.throws(() => browserAnalyze({files: [{name: 'a.srt', text: text + 'x'}]}), fileByteError);
});
test('bounded inputs reject excessive byte content and file counts', () => {
  assert.throws(() => run('x'.repeat(FILE_BYTES + 1)), fileByteError);
  assert.throws(() => analyze({files: Array.from({length: 201}, (_, i) => ({name: `${i}.srt`, text: ''}))}), RangeError);
});
test('large malformed block is rejected without executing patterns', () => {
  const result = run('1\n' + 'a'.repeat(100_000) + ' --> nonsense\n<script>alert(1)</script>');
  assert.ok(has(result, 'INVALID_TIMESTAMP'));
});
test('a normal final newline is not an extra display line', () => {
  assert.deepEqual(run(srt('Hello') + '\n', 'a.srt', {profile: {maxLines: 1}}).issues, []);
  assert.deepEqual(run(vtt('Hello') + '\n', 'a.vtt', {profile: {maxLines: 1}}).issues, []);
});
test('STYLE and REGION cannot silently swallow malformed merged cues', () => {
  for (const kind of ['STYLE', 'REGION']) {
    const result = run(vtt() + `\n\n${kind}\n00:04.000 --> 00:06.000\nSecond`, 'a.vtt');
    assert.ok(has(result, 'MALFORMED_BLOCK'), kind);
  }
});
test('mixed valid/invalid VTT blocks are errors with useful valid counts', () => {
  const result = run(vtt() + '\n\nbad-id\nbroken timing\ntext', 'a.vtt');
  assert.equal(result.summary.cueCount, 1); assert.ok(has(result, 'MALFORMED_BLOCK'));
});
test('all profile thresholds reject nonfinite, negative and nonnumeric values', () => {
  for (const key of ['maxCps', 'maxLineLength', 'maxLines', 'minDurationMs', 'maxDurationMs']) {
    for (const value of [Infinity, -Infinity, NaN, -0.01, '1', null, undefined]) {
      assert.throws(() => analyze({files: [], profile: {[key]: value}}), error => error instanceof TypeError || error instanceof RangeError);
    }
  }
});
test('sparse file and manifest arrays are rejected', () => {
  assert.throws(() => analyze({files: new Array(1)}), TypeError);
  assert.throws(() => analyze({files: [], manifest: {requiredTerms: new Array(1)}}), TypeError);
});
test('numeric entities decode safely without interpreting decoded markup', () => {
  const result = run(srt('&#65;&#x42; &lt;i&gt; &#x110000;'), 'a.srt', {manifest: {requiredTerms: ['AB <i>', '&#x110000;']}});
  assert.deepEqual(result.issues, []);
});
test('duplicate manifest entries are deduplicated case-insensitively', () => {
  const result = run(srt(), 'a.srt', {manifest: {expectedFiles: ['b.srt', 'B.SRT'], requiredTerms: ['xyz', 'XYZ']}});
  assert.equal(result.issues.filter(i => i.code === 'MISSING_FILE').length, 1);
  assert.equal(result.issues.filter(i => i.code === 'MISSING_REQUIRED_TERM').length, 1);
});
