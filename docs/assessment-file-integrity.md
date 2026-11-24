# ItemBloom beta.11 — assessment file integrity requirements

Status: approved development scope; release pending verification.

| ID | Requirement / acceptance criterion |
| --- | --- |
| FR-FILE-001 | Save writes to the originally opened file; Save As and Copy create independently identified documents. Show filename and unsaved status. Close must offer Save, Discard or Cancel. Rename and Move preserve assessment contents except file naming and timestamps. |
| FR-FILE-002 | Open restores the saved grade, competency IDs, counts and numbering; defaults apply to new assessments only. Missing or invalid critical fields must be rejected without modifying the original. No automatic regeneration when opening or viewing saved files. |
| FR-FILE-003 | Metadata edits preserve placements. Content/structural changes keep original counts until a teacher confirms retained counts or explicitly authorizes replacement. Never preview or export a placement matrix that is invalid or awaiting review. |
| FR-FILE-004 | Use unique assessment IDs for independent copies; never bind a recovered draft to an existing file solely because IDs match. Detect duplicate IDs; exclude ambiguous files and provide a recovery/import path. |
| FR-FILE-005 | Require explicit confirmation before replacing existing counts via AI or numerical recalculation. Reject delayed AI responses if their assessment snapshot no longer matches. |
| NFR-DATA-001 | Validate identity, file location, and content baseline before overwrite. Keep original backup, perform exclusive coordinated writes where available, and verify written contents. Invalid/unrecognized destination files must not be overwritten. |
| NFR-DATA-002 | Keep separate browser recovery records for editing sessions; local-only processing. Never remove other sessions' recovery data on successful save, discard, or saved-file deletion. No automatic overwrite of durable files. |
| NFR-QA-001 | Do not deploy beta.11 until executable regression tests and manual browser/file-system tests pass. |

## Required release checks
- Round-trip Grade 1–12; alternate Grade 7/8/9 files; check exact rows, Bloom counts and item numbering.
- New defaults do not modify previously saved assessments; missing grade/count/malformed matrices fail safely.
- Subject correction, grade cancellation, competency wording, number changes and structure changes preserve the old matrix until authorized review/recalculation.
- Save, Save As, Copy, Rename, Move, filename conflicts, duplicate IDs, invalid destinations, interrupted writes, folder permission loss, and external changes.
- Separate sessions and cross-tab recovery; close Save/Discard/Cancel; no silent overwrite of a recovered draft.
- Stale AI response, read-only mode, exports, older supported assessment files, and unchanged Item Analysis functionality.
- Real Edge/Chrome folder permissions, offline reopening and safe PWA upgrade with local assessments and preferences unchanged.

Automated tests use synthetic assessment data and simulated local file handles. Real browser/OS transactions require manual confirmation. A browser cannot guarantee atomic transactions against unrelated OS processes; conflict detection, backups and read-back verification reduce risk. Browser downloads cannot be verified by the app, so recovery is retained.

Deployment: GitHub Pages; hosting-neutral app branding; no assessment data or API keys in the repository. Keep the existing production branch unchanged until the release gate is satisfied.
