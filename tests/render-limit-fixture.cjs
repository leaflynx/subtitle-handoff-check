#!/usr/bin/env node
'use strict';

// Deliberately pathological, fictional input for the real browser file picker.
// No dependencies or default output path; never overwrite an existing file.
const fs = require('node:fs');
const path = require('node:path');

if (process.argv.length !== 3 || !process.argv[2].trim()) {
  console.error('Usage: node tests/render-limit-fixture.cjs <output.srt>');
  process.exitCode = 1;
} else {
  const output = path.resolve(process.argv[2]);
  const text = Array.from({ length: 10000 }, (_, index) =>
    `${index + 1}\n00:00:01,000 --> 00:00:01,100\n${'x'.repeat(43)}\ny\nz`
  ).join('\n\n');
  try {
    fs.writeFileSync(output, text, { encoding: 'utf8', flag: 'wx' });
    console.log(`Wrote 10,000 cues (${Buffer.byteLength(text)} bytes) to ${output}`);
    console.log('With default thresholds and an empty checklist: 49,999 findings (9,999 errors; 40,000 warnings).');
  } catch (error) {
    console.error(`Could not write fixture: ${error.message}`);
    process.exitCode = 1;
  }
}
