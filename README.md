# Subtitle Handoff Check

**Status: experimental prototype; technical preflight only.** This is a dependency-free, directly-openable browser app for reviewing local SRT/VTT files. It is not a delivery certification, translation certification, or audio/video comparison tool. Commercial workflow customization is not yet available to purchase; there is no checkout.

## Open locally — no installation

1. Keep the complete folder together, including `index.html`, `styles.css`, `app.js`, `qc.js`, `site.webmanifest`, and `assets/`.
2. On Windows, open this file in a current browser:

   ```text
   Subtitle Handoff Check\index.html
   ```

   The equivalent WSL path is:

   ```text
   ./Subtitle Handoff Check/index.html
   ```

3. Choose one or more `.srt` or `.vtt` files. Selection replaces the current batch. UTF-8 text is recommended: the browser's `File.text()` API decodes UTF-8; this app does not offer a legacy-encoding selector.
4. Optionally enter expected filenames, required terms, and forbidden terms, one item per line. Blank lines are ignored and surrounding whitespace is trimmed. Expected filename comparison is case-insensitive; extensions and other characters still matter. An empty expected-file list turns off that checklist.
5. Review the five thresholds, then select **Check files**. Defaults: 20 characters/second, 42 characters/line, 2 lines/cue, 600 ms minimum and 7000 ms maximum duration. All values must be finite and nonnegative; line length and line count must be positive safe whole numbers. Maximum duration must be at least minimum duration.
6. Review the summary and issue table. The table displays **at most the first 200 matching issues**, in report order, to keep the browser responsive. Its label shows the true matching and total counts; severity and issue-code filters update both the counts and displayed rows. JSON and CSV exports contain **all issues**, including undisplayed rows, not just the filtered subset.
7. **Reset workspace** clears app-state file contents, checklist, report and thresholds back to defaults. It does not delete files or reports already saved on your device. Closing the tab discards the workspace; there is no saved session or browser-storage feature.

The engine is loaded by a classic local `<script>` before the UI script. There are no modules, `fetch()` calls, or server requirements, so `file://` use does not depend on cross-origin access. If `qc.js` is missing, the interface still opens and reports an explicit engine-unavailable error when you attempt a check. No analysis runs automatically at startup.

## Fictional demo and sample files

Select **Run fictional demo** to load and check two in-memory fixtures, the sample checklist, and the default profile. This replaces the selected batch and checklist. The fixture text is authored fiction, not client material. The same text is supplied as:

- `samples/harbor.en.srt`
- `samples/harbor.fr.vtt`
- `samples/manifest.json`

The Spanish file `harbor.es.srt` is deliberately absent. The English file deliberately contains overlapping cues, the forbidden string `DRAFT ONLY`, a long line and a fast-reading cue. Both provided files include the required literal substring `Luma`.

For a manual sample run, select the two subtitle files from `samples/` and paste the arrays in `samples/manifest.json` into the corresponding newline fields. The JSON is a reference fixture, not an importable subtitle file. The embedded demo needs no file or network fetching.

## Scope and interpretation

- Required/forbidden terms are **literal, case-insensitive substrings per file**, not regexes or linguistic checks. A substring may occur within a longer word. The checker does not judge grammar, meaning, spelling variants, inflection or whether a name is used correctly.
- Timing/readability checks are heuristic technical signals. The defaults are editable working thresholds, not universal requirements or any platform's approved delivery profile.
- A result with no findings is not approval. Always compare the delivery specification, review the subtitles in context, and perform human linguistic and audio/video review when needed.
- Basic SRT/VTT processing is not a guarantee that every extension, styling construct or malformed variant can be interpreted correctly. Findings should be reviewed, not automatically treated as final judgments.
- No file uploads, external dependencies, analytics, tracking, accounts, CDN assets or network calls are implemented. The app reads user-selected files in the browser. Browser extensions, browser behavior and the device itself are outside this privacy promise.
- Reports do not contain the full source subtitle text, but can contain filenames, entered checklist terms and issue messages. Handle downloaded reports as potentially sensitive.

## Guardrails

The entire selection is rejected if it exceeds 100 files, 5 MiB per file, or 20 MiB total, contains an unsupported extension or duplicate exact filename, or any file fails to read. No selected files are silently skipped. The engine can separately flag filenames that differ only in letter case. A failed check or changed checklist/profile invalidates the old report, disabling exports until a successful new check.

All untrusted UI content is rendered with `textContent` and DOM creation, not HTML interpolation. CSV cells are quoted and escaped; leading spreadsheet formula triggers (`=`, `+`, `-`, `@`), including after whitespace, and initial tab/newline controls are prefixed with an apostrophe. CSV is a flat issues report; JSON additionally includes the profile, checklist, file cue counts, summary, timestamp and scope disclaimer. The app initiates a local browser download; browser settings decide the destination or may block it.

## Tests — no package manager needed

From PowerShell with an existing Node installation:

```powershell
Set-Location "$HOME\Desktop\Business Lab\Subtitle Handoff Check"
node --check app.js
node --check qc.js
node --test tests/qc.test.cjs
```

Or from WSL:

```sh
cd '/path/to/Subtitle Handoff Check'
node --check app.js
node --check qc.js
node --test tests/qc.test.cjs
```

The Node tests exercise the standalone analysis engine, not a simulated browser UI. No `npm install` or build step is required.

### Browser acceptance checks

1. Open `index.html` directly with a `file://` URL. The initial status is ready; no analysis should run. In browser developer tools, verify that the page references only local resources and makes no upload, analytics or external network request.
2. Run the fictional demo. Verify two files and five cues, and findings including `MISSING_FILE`, `OVERLAP`, `FORBIDDEN_TERM`, and `HIGH_CPS`. Verify `LONG_LINE` is also surfaced with the default profile.
3. Select severity **Errors**, then code **OVERLAP**. Confirm only the matching finding is displayed, but downloaded JSON/CSV still include all issues. Clear the filters.
4. Download both report formats, open JSON in a text editor, and inspect CSV in a text editor before using any spreadsheet. Confirm the JSON profile/checklist and file counts agree with the UI. Source subtitle bodies should not be embedded in the report.
5. Change a checklist or threshold. Confirm the old report is hidden and exports are disabled. Enter an empty, negative, or nonnumeric/nonfinite threshold; confirm an explicit validation error and field focus. Set minimum duration above maximum; confirm rejection.
6. Reset; attempt a check with no files. Confirm the empty-selection error. Then choose actual sample files and check them to exercise local file reading, not just embedded demo text.
7. Try an unsupported file with a valid subtitle, an oversized file, a batch larger than 20 MiB, or more than 100 files. Confirm the whole selection is rejected with a reason, rather than a partial report. If the browser reports a read failure, no files from that batch should remain loaded.
8. With the keyboard, follow the skip link, file input, checklist, profile controls, action buttons, filters and download buttons. Confirm visible focus and announced status messages. At a narrow viewport, controls should stack with no page-wide horizontal overflow; the findings table has its own labeled scroll region. Enable reduced-motion preferences to remove smooth scrolling and transitions.
9. To test missing-engine behavior without changing files, set `window.SubtitleQC = undefined` in browser developer tools, then run the demo. Confirm the explicit `qc.js` error and no report. Reload to restore the engine.

### Large-report render-limit check

Generate a fictional stress file with Node's standard library only (the output path is required; existing files are not overwritten):

```sh
node tests/render-limit-fixture.cjs /path/to/stress-10000.srt
```

The generator creates 10,000 numbered, blank-separated SRT cues (838,892 UTF-8 bytes), each at `00:00:01,000 --> 00:00:01,100` with a 43-character `x` line, then `y` and `z`. Open `index.html`, reset the workspace, select this file through the file picker, and choose **Check files** using the default profile and empty checklist. Expect 49,999 findings (9,999 errors and 40,000 warnings), but only 200 table-body rows and a label explicitly stating the matching/total counts and full exports.

Select **Errors**: expect 9,999 matching issues and 200 rows. Code **OVERLAP** also matches 9,999; code **HIGH_CPS** with Errors matches zero and shows the empty state. With all severities, **HIGH_CPS** matches 10,000 and still shows only 200 rows. Export JSON and CSV while filters are active: JSON must contain all 49,999 issues; CSV must contain 49,999 data records plus its header. Clear filters, reset (results hidden, no rows, exports disabled), and run the small fictional demo to check that all its findings remain visible. Inspect both desktop and narrow layouts; only the table should scroll horizontally.

Observed in local headless Chromium 145 with this selected-file fixture: check-button click to completed-status update fell from 4,838 ms with 49,999 rows to 112.2 ms with 200 rows; total page element count fell from 450,186 to 1,995. The bounded run's engine took 45.4 ms; two animation frames after completion measured 116.3 ms from the click. These are single-run observations, not a benchmark or performance guarantee. Actual JSON/CSV export blobs retained all 49,999 findings; every parsed CSV data field matched JSON. Desktop (1280 px) and mobile (390 px) checks found no page-wide horizontal overflow.

## Files and packaging

- `index.html`, `styles.css`, `app.js`: accessible local workspace UI and report exports.
- `qc.js`: standalone analysis engine; `tests/qc.test.cjs`: Node engine regression tests.
- `assets/mark.svg`: original subtitle-frame/check mark.
- `assets/favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`: local packaged icon derivatives, referenced by the HTML/manifest.
- `site.webmanifest`: local app metadata and icon references. It is not a service worker and does not imply installability from `file://`; installation depends on browser context and policy.
- `samples/`: fictional subtitle/checklist fixtures.

The app does not register a service worker. Direct local opening is the supported no-server workflow. Keep `qc.js` and the UI together when moving or packaging this prototype.

## Feedback and workflow requests

Use this repository's Workflow request issue template to describe a recurring handoff problem or discuss a possible custom configuration. Public issues must contain invented examples only: no customer files, confidential specifications, payment details or personal information. An enquiry is not a purchase, accepted contract, delivery promise or certification. There is no checkout and no currently purchasable service. Development and responses may be AI-assisted; no human review is implied unless explicitly stated.

The free browser demonstration is technical project documentation, not a storefront or a commercial hosted service. Download the release ZIP to run the tool offline.
