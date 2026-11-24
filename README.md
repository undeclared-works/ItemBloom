# ItemBloom — GitHub Pages

ItemBloom is a local-first PWA for Table of Specifications and Item Analysis. The beta.11 file-integrity development branch is not a production release until regression tests pass.

## Deployment
GitHub Pages serves `main` at https://undeclared-works.github.io/ItemBloom/. Publish only a reviewed release. Back up local assessments before updating.

## Local use
Assessment files, learner data and recovery drafts remain on the device. Browser-origin settings and folder permissions may require reconnecting when changing hosting domains. Never commit learner data, assessment files or API secrets.

GitHub Pages serves static files only. Use Copy AI Prompt / JSON import, a personal Gemini key for private testing, or a separately hosted secure HTTPS proxy. No server proxy is supplied by this repository.

## Beta 11
Review the file-integrity requirements and regression tests before merging. Existing assessment files should be preserved; no bulk migration is performed.
