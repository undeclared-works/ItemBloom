# Beta.11 — Windows release acceptance checklist

**Use a disposable folder and synthetic or copied assessments only.** Never test overwrite, delete or recovery using the only copy of a real assessment. Do not upload assessment or learner data to GitHub.

## Test build
Download the development branch ZIP, extract it, and open a terminal in the extracted folder. If Python 3 is available, run:

```powershell
py -m http.server 8765 --bind 127.0.0.1
```

Open http://localhost:8765/ in Edge or Chrome. If Python is unavailable, use a local static server you already trust. Double-clicking index.html is not an equivalent test of the PWA.

This temporary localhost origin has separate browser preferences, storage and folder access from the deployed GitHub Pages site. The supplied test folder should contain copied beta.10 assessment files (including Grade 7, 8 and 9) and a disposable unrelated JSON file.

| # | Test | Expected result | Pass |
|---|---|---|---|
| 1 | Connect a test folder, open Grade 7, 8, 9 repeatedly; inspect Draft & AI and preview. | Grades, row order, counts and item numbers match originals; viewing creates no changes. | [ ] |
| 2 | Edit section or signatory; Save (Ctrl+S), return Home and reopen. | Same filename/ID, only intended fields changed; backup created. | [ ] |
| 3 | Change subject spelling; navigate to Draft & AI. | Old counts remain; preview/save blocked until retained counts are confirmed. | [ ] |
| 4 | Change grade, cancel confirmation; add/remove competency and cancel recalculation. | Grade and old counts remain unchanged respectively. | [ ] |
| 5 | Save As with a new name, then rename and move that copy. | Original unchanged; copy has a different ID; rename and move preserve counts and ID. | [ ] |
| 6 | Save As to an existing unrelated JSON filename (matching .ibassessment.json). | Overwrite disabled; original file contents intact. | [ ] |
| 7 | Close after an edit; try Cancel, Discard, Save and reopen. | Cancel stays in editor; discard restores saved file; save writes intended changes. | [ ] |
| 8 | Open same saved assessment in two tabs. Edit both; save tab A, then tab B. | B detects conflict; A's saved file remains intact; B's recovery copy retained. | [ ] |
| 9 | Edit a copy; revoke folder access or temporarily remove the test folder, then Save. | Error reported, no silent overwrite; recovery retained. Reconnect or Save As works. | [ ] |
| 10 | Create an unsaved edit; close/reopen browser and recover it. | Recovery offered as an independent copy; original saved file unchanged. | [ ] |
| 11 | Load the app online once; disconnect internet; reopen and save a test edit. | PWA opens offline; file and placements remain correct. | [ ] |
| 12 | Open Item Analysis and import a synthetic ZipGrade/EvalBee CSV. | Existing import, workspace and analysis functions behave as before. | [ ] |

Record browser/version, OS, build commit, result, and screenshots of any errors. Do not merge PR #1 until all release-blocking checks pass. Automated browser-origin filesystem tests are separate from manual Windows folder access tests.
