# ItemBloom — GitHub Pages test deployment

Test mirror of ItemBloom v1.0.0-beta.10-rc. Cloudflare deployment is unchanged.

## Publish
1. Open your public GitHub repository `undeclared-works/ItemBloom`.
2. Upload the **contents** of this ZIP into the root of the `main` branch (not the ZIP itself and not a containing folder). Commit the changes.
3. In Settings → Pages, choose **Deploy from a branch**, **main**, **/(root)** and Save.
4. Visit https://undeclared-works.github.io/ItemBloom/ when deployment completes.

## Testing
Use Edge and Chrome to reload the site 10 times on multiple laptops, including on a separate internet connection. Check the browser Console and Network tab for errors.

## Important
- This GitHub Pages mirror has its own browser origin and PWA cache. Site-specific local storage and folder permissions do not automatically transfer from Cloudflare Pages. Back up/export assessments before testing.
- GitHub Pages is static; `/api/classify` (the Cloudflare Pages Function proxy) is not available here. Use the app's Copy AI Prompt / JSON import workflow for the test. Never upload API secrets or learner data to the repository.
- Cloudflare `_headers` settings are not supported by GitHub Pages; the original file is excluded from this package.
- Do not expect a new GitHub origin to eliminate browser, ISP, or network failures automatically.
