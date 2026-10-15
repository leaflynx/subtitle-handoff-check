/* Subtitle Handoff Check: local UI only; the analysis engine lives in qc.js. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const MAX_FILES = 100;
  const MAX_DISPLAYED_ISSUES = 200;
  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
  const form = $('check-form');
  const status = $('status');
  const profileFields = [
    { id: 'max-cps', key: 'maxCps', label: 'Maximum characters per second' },
    { id: 'max-line-length', key: 'maxLineLength', label: 'Maximum line length', integer: true },
    { id: 'max-lines', key: 'maxLines', label: 'Maximum lines per cue', integer: true },
    { id: 'min-duration', key: 'minDurationMs', label: 'Minimum cue duration' },
    { id: 'max-duration', key: 'maxDurationMs', label: 'Maximum cue duration' }
  ];
  const defaults = { maxCps: 20, maxLineLength: 42, maxLines: 2, minDurationMs: 600, maxDurationMs: 7000 };
  const sampleFiles = [
    {
      name: 'harbor.en.srt',
      text: '1\n00:00:01,000 --> 00:00:03,000\nWelcome to Luma Harbor.\n\n2\n00:00:02,500 --> 00:00:04,000\nDRAFT ONLY: the paper moon rises.\n\n3\n00:00:04,500 --> 00:00:05,300\nThe tiny lantern committee has misplaced every map of the imaginary bay.\n'
    },
    {
      name: 'harbor.fr.vtt',
      text: 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nBienvenue au port de Luma.\n\n00:00:04.500 --> 00:00:07.000\nLa lune de papier se lève.\n'
    }
  ];
  const sampleManifest = {
    expectedFiles: ['harbor.en.srt', 'harbor.fr.vtt', 'harbor.es.srt'],
    requiredTerms: ['Luma'],
    forbiddenTerms: ['DRAFT ONLY']
  };
  let selectedFiles = [];
  let report = null;
  let busy = false;
  let operation = 0;

  function setStatus(message, error = false, focus = false) {
    status.textContent = message;
    status.classList.toggle('is-error', error);
    if (focus) status.focus();
  }

  function setBusy(value) {
    busy = value;
    ['files-controls', 'manifest-controls', 'profile-controls', 'check-button'].forEach(id => {
      $(id).disabled = value;
    });
    form.setAttribute('aria-busy', String(value));
  }

  function invalidateReport() {
    report = null;
    $('results').hidden = true;
    $('json-download').disabled = true;
    $('csv-download').disabled = true;
    $('issues-body').replaceChildren();
  }

  function prettySize(bytes) {
    return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  }

  function renderFiles() {
    $('file-list').replaceChildren();
    selectedFiles.forEach(file => {
      const row = document.createElement('li');
      const name = document.createElement('span');
      const size = document.createElement('span');
      name.textContent = file.name;
      size.textContent = prettySize(file.size);
      row.append(name, size);
      $('file-list').append(row);
    });
    const count = selectedFiles.length;
    $('selection-label').textContent = count ? `${count} file${count === 1 ? '' : 's'} ready` : 'No files selected';
    $('selection-size').textContent = count ? prettySize(selectedFiles.reduce((sum, file) => sum + file.size, 0)) : '';
  }

  function validateFiles(files) {
    if (!files.length) throw new Error('Choose at least one .srt or .vtt subtitle file.');
    if (files.length > MAX_FILES) throw new Error(`This batch contains ${files.length} files. The limit is 100. No files were loaded.`);
    let total = 0;
    const names = new Set();
    for (const file of files) {
      if (!/\.(srt|vtt)$/i.test(file.name)) throw new Error(`“${file.name}” is not an .srt or .vtt file. The entire batch was rejected.`);
      if (names.has(file.name)) throw new Error(`Duplicate filename “${file.name}”. Give each file a unique name before checking. The entire batch was rejected.`);
      names.add(file.name);
      if (!Number.isFinite(file.size) || file.size < 0) throw new Error(`The size of “${file.name}” could not be read. No files were loaded.`);
      if (file.size > MAX_FILE_BYTES) throw new Error(`“${file.name}” exceeds the 5 MiB per-file limit. The entire batch was rejected.`);
      total += file.size;
    }
    if (total > MAX_TOTAL_BYTES) throw new Error('This batch exceeds the 20 MiB total limit. The entire batch was rejected.');
  }

  async function readSelection() {
    const token = ++operation;
    const files = Array.from($('subtitle-files').files || []);
    selectedFiles = [];
    invalidateReport();
    renderFiles();
    if (!files.length) {
      setStatus('No files selected. Choose subtitle files or run the fictional demo.');
      return;
    }
    try {
      validateFiles(files);
      setBusy(true);
      setStatus(`Reading ${files.length} file${files.length === 1 ? '' : 's'} locally…`);
      const reads = await Promise.allSettled(files.map(async file => {
        // File.text() reads bytes locally; no URL or network operation is used.
        const text = await file.text();
        if (typeof text !== 'string') throw new Error('Text was not readable.');
        return { name: file.name, text, size: file.size };
      }));
      if (token !== operation) return;
      const failedNames = reads.flatMap((read, index) => read.status === 'rejected' ? [files[index].name] : []);
      if (failedNames.length) throw new Error(`Could not read ${failedNames.map(name => `“${name}”`).join(', ')}. No files were loaded. Check access to the files, then select the batch again.`);
      selectedFiles = reads.map(read => read.value);
      renderFiles();
      setStatus(`${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} loaded locally. Review the checklist, then choose Check files.`);
    } catch (error) {
      if (token !== operation) return;
      selectedFiles = [];
      $('subtitle-files').value = '';
      renderFiles();
      setStatus(error.message || 'The selected files could not be read. No files were loaded.', true, true);
    } finally {
      if (token === operation) setBusy(false);
    }
  }

  function lines(id) {
    return $(id).value.split(/\r\n|\n|\r/).map(value => value.trim()).filter(Boolean);
  }

  function readConfig() {
    const profile = {};
    for (const field of profileFields) {
      const input = $(field.id);
      const raw = input.value.trim();
      const value = Number(raw);
      let message = '';
      if (!raw) message = `${field.label} is required; enter a finite number, not an empty value.`;
      else if (!Number.isFinite(value)) message = `${field.label} must be a finite number.`;
      else if (value < 0) message = `${field.label} cannot be negative.`;
      else if (field.integer && (!Number.isSafeInteger(value) || value < 1)) message = `${field.label} must be a positive whole number within the safe integer range.`;
      if (message) {
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        throw new Error(message);
      }
      input.removeAttribute('aria-invalid');
      profile[field.key] = value;
    }
    if (profile.minDurationMs > profile.maxDurationMs) {
      $('max-duration').setAttribute('aria-invalid', 'true');
      $('max-duration').focus();
      throw new Error('Maximum cue duration must be greater than or equal to minimum cue duration.');
    }
    return {
      profile,
      manifest: {
        expectedFiles: lines('expected-files'),
        requiredTerms: lines('required-terms'),
        forbiddenTerms: lines('forbidden-terms')
      }
    };
  }

  function assertResult(result) {
    const isCount = value => Number.isSafeInteger(value) && value >= 0;
    if (!result || !result.summary || !['fileCount', 'cueCount', 'errorCount', 'warningCount'].every(key => isCount(result.summary[key])) || !Array.isArray(result.issues) || !Array.isArray(result.files)) {
      throw new Error('The local analysis engine returned an invalid report. No result was published.');
    }
    if (!result.issues.every(issue => issue && ['error', 'warning'].includes(issue.severity) && typeof issue.code === 'string' && typeof issue.file === 'string' && typeof issue.message === 'string' && (issue.cue == null || typeof issue.cue === 'string' || Number.isFinite(issue.cue))) || !result.files.every(file => file && typeof file.name === 'string' && isCount(file.cueCount))) {
      throw new Error('The local analysis engine returned malformed issue or file data. No result was published.');
    }
  }

  async function runCheck() {
    if (busy) return;
    invalidateReport();
    let config;
    try {
      config = readConfig();
      validateFiles(selectedFiles);
      if (!window.SubtitleQC || typeof window.SubtitleQC.analyzeBatch !== 'function') {
        throw new Error('Analysis engine unavailable: qc.js did not load or does not expose window.SubtitleQC.analyzeBatch. Keep qc.js beside index.html, then reopen or reload the page. No files were checked.');
      }
    } catch (error) {
      setStatus(error.message || 'Check the selected files and settings.', true);
      // Leave keyboard focus on a profile field if it is the source of the error.
      if (!form.querySelector('[aria-invalid="true"]')) status.focus();
      return;
    }
    const token = ++operation;
    setBusy(true);
    setStatus('Checking the selected files locally…');
    // Yield once so the browser can announce the busy state before analysis.
    await new Promise(resolve => setTimeout(resolve, 30));
    if (token !== operation) return;
    try {
      const result = await window.SubtitleQC.analyzeBatch({
        files: selectedFiles.map(({ name, text }) => ({ name, text })),
        manifest: config.manifest,
        profile: config.profile
      });
      if (token !== operation) return;
      assertResult(result);
      report = {
        tool: 'Subtitle Handoff Check',
        prototype: true,
        generatedAt: new Date().toISOString(),
        scope: 'Technical preflight only; not audio comparison, translation certification or universal delivery compliance.',
        termMatching: 'Literal case-insensitive substrings per file, not linguistic certification.',
        profile: config.profile,
        manifest: config.manifest,
        summary: result.summary,
        issues: result.issues,
        files: result.files
      };
      renderReport();
      setStatus(`Check complete: ${result.summary.fileCount} files, ${result.summary.cueCount} cues, ${result.summary.errorCount} errors and ${result.summary.warningCount} warnings. Review findings before delivery.`);
      $('results-title').focus();
    } catch (error) {
      invalidateReport();
      setStatus(`Check failed. ${error.message || 'The local engine could not complete the batch.'} No result was published.`, true, true);
    } finally {
      if (token === operation) setBusy(false);
    }
  }

  function renderReport() {
    const summary = report.summary;
    [['file-count', 'fileCount'], ['cue-count', 'cueCount'], ['error-count', 'errorCount'], ['warning-count', 'warningCount']].forEach(([id, key]) => { $(id).textContent = String(summary[key]); });
    $('severity-filter').value = 'all';
    const codeFilter = $('code-filter');
    codeFilter.replaceChildren();
    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = 'All codes';
    codeFilter.append(all);
    [...new Set(report.issues.map(issue => issue.code))].sort().forEach(code => {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = code;
      codeFilter.append(option);
    });
    $('results').hidden = false;
    $('json-download').disabled = false;
    $('csv-download').disabled = false;
    renderIssues();
  }

  function renderIssues() {
    if (!report) return;
    const severity = $('severity-filter').value;
    const code = $('code-filter').value;
    // Count every match, but allocate/render only the bounded table preview.
    // The original report stays intact for summaries, filters and exports.
    let matchingCount = 0;
    const displayedIssues = [];
    for (const issue of report.issues) {
      if ((severity === 'all' || issue.severity === severity) && (code === 'all' || issue.code === code)) {
        matchingCount++;
        if (displayedIssues.length < MAX_DISPLAYED_ISSUES) displayedIssues.push(issue);
      }
    }
    const body = $('issues-body');
    body.replaceChildren();
    const fragment = document.createDocumentFragment();
    displayedIssues.forEach(issue => {
      const row = document.createElement('tr');
      const severityCell = document.createElement('td');
      const badge = document.createElement('span');
      badge.classList.add('severity', issue.severity);
      badge.textContent = issue.severity;
      severityCell.append(badge);
      const codeCell = document.createElement('td');
      const codeText = document.createElement('code');
      codeText.textContent = issue.code;
      codeCell.append(codeText);
      const fileCell = document.createElement('td');
      const fileName = document.createElement('span');
      fileName.textContent = issue.file || 'Batch';
      const cue = document.createElement('span');
      cue.className = 'cue-label';
      cue.textContent = issue.cue == null ? 'File / batch level' : `Cue ${issue.cue}`;
      fileCell.append(fileName, cue);
      const messageCell = document.createElement('td');
      messageCell.textContent = issue.message;
      row.append(severityCell, codeCell, fileCell, messageCell);
      fragment.append(row);
    });
    body.append(fragment);
    const count = value => value.toLocaleString('en-US');
    const prefix = matchingCount > MAX_DISPLAYED_ISSUES ? 'Showing first' : 'Showing';
    $('visible-count').textContent = `${prefix} ${count(displayedIssues.length)} of ${count(matchingCount)} matching issues (${count(report.issues.length)} total). Exports include all issues.`;
    $('empty-results').hidden = matchingCount > 0;
    $('empty-results').textContent = report.issues.length ? 'No issues match these filters.' : 'No findings under these settings. This is not a delivery or translation certification.';
    document.querySelector('.table-wrap').hidden = matchingCount === 0;
  }

  function csvCell(value) {
    let text = value == null ? '' : String(value);
    // Quoting alone does not stop spreadsheet formula execution. Prefix unsafe
    // untrusted cells, including formulas concealed behind leading whitespace.
    if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function download(format) {
    if (!report) return;
    try {
      const content = format === 'json'
        ? `${JSON.stringify(report, null, 2)}\n`
        : '\uFEFF' + [
          ['severity', 'code', 'file', 'cue', 'message'],
          ...report.issues.map(issue => [issue.severity, issue.code, issue.file, issue.cue, issue.message])
        ].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
      const blob = new Blob([content], { type: format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `subtitle-handoff-report.${format}`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setStatus(`${format.toUpperCase()} report download requested. It includes all ${report.issues.length} issues, regardless of the table filters. Source subtitle text is not included. Your browser controls where the download is saved.`);
    } catch (error) {
      setStatus(`The report download could not be created. ${error.message || 'Try again in a browser that supports local file downloads.'}`, true, true);
    }
  }

  function clearInvalid() {
    profileFields.forEach(field => $(field.id).removeAttribute('aria-invalid'));
  }

  $('subtitle-files').addEventListener('change', readSelection);
  ['manifest-controls', 'profile-controls'].forEach(id => {
    $(id).addEventListener('input', () => {
      clearInvalid();
      invalidateReport();
      setStatus('Settings changed. Choose Check files to generate an updated report.');
    });
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    runCheck();
  });
  $('demo-button').addEventListener('click', () => {
    if (busy) return;
    operation++;
    invalidateReport();
    clearInvalid();
    $('subtitle-files').value = '';
    selectedFiles = sampleFiles.map(file => ({ ...file, size: new Blob([file.text]).size }));
    $('expected-files').value = sampleManifest.expectedFiles.join('\n');
    $('required-terms').value = sampleManifest.requiredTerms.join('\n');
    $('forbidden-terms').value = sampleManifest.forbiddenTerms.join('\n');
    profileFields.forEach(field => { $(field.id).value = String(defaults[field.key]); });
    renderFiles();
    runCheck();
  });
  $('reset-button').addEventListener('click', () => {
    operation++;
    setBusy(false);
    form.reset();
    selectedFiles = [];
    clearInvalid();
    invalidateReport();
    renderFiles();
    $('severity-filter').value = 'all';
    $('code-filter').replaceChildren();
    const option = document.createElement('option');
    option.value = 'all';
    option.textContent = 'All codes';
    $('code-filter').append(option);
    setStatus('Workspace reset. File contents and report data have been cleared from app state. Downloaded reports are not deleted.');
    $('subtitle-files').focus();
  });
  $('severity-filter').addEventListener('change', renderIssues);
  $('code-filter').addEventListener('change', renderIssues);
  $('json-download').addEventListener('click', () => download('json'));
  $('csv-download').addEventListener('click', () => download('csv'));
})();
