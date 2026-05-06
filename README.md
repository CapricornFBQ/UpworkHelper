# Upwork Opportunity Scorer

Local Chrome MV3 extension for manually capturing Upwork pages into opportunity sessions and scoring them with OpenAI.

## Current scope

- User-triggered DOM capture only.
- Capture is limited to `https://www.upwork.com/*` in the current version.
- No automatic refresh, crawling, bulk scanning, or proposal submission.
- One opportunity can contain multiple page snapshots.
- OpenAI API key is stored in Chrome local extension storage and only used by the background service worker.
- Captured page text and analysis history stay in local Chrome extension storage.

## Planning

- Long-term implementation plan: `docs/LONG_TERM_PLAN.md`

## Validation

- Core business handler regression: `node scripts/validate_v0_9.mjs`
- Unpacked extension smoke: `node scripts/smoke_unpacked_extension.mjs`

The smoke script uses the first available Chromium-family browser and can be forced with `CHROME_PATH=/path/to/browser`.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select this folder: `/Users/fanbingqi/Downloads/1_Project/29_upworkHelper`.
5. Open extension options and set your OpenAI API key.

## Workflow

1. Open an Upwork job or related client page.
2. Click the extension icon.
3. Choose `New opportunity` or an existing opportunity.
4. Click `Capture current page`.
5. Optionally save `My Profile` and `Portfolio Cases` in Options.
6. Open the side panel, click `Extract fields`, review/correct extracted fields, then click `Score`.
7. Create or link a `Client history` record when the same client should share history across opportunities.
8. Use `Selector Assist` from the side panel only when you manually need a stable page field selector.
9. Click `Generate proposal` to create an editable local draft, review unsupported claims, then copy the text manually.
10. Record proposal sent, viewed, replied, interview, hired, or lost events in the local `Outcome` panel.
11. Open `Analytics` from Options to review local historical rates and low-sample calibration signals.

If an Upwork job key can be recognized from the current URL, repeated captures of the same job are automatically appended to the same opportunity.

## Default models

- Extraction: `gpt-5-mini`
- Scoring: `gpt-5.2`
- Proposal: `gpt-5.2`
- API: OpenAI Responses API

Use `gpt-5-mini` for both fields if you want a cheaper first pass.

## Safety boundary

The extension is intentionally manual:

- It does not run in the background on Upwork pages.
- It does not poll or monitor page changes.
- It does not open pages automatically.
- It does not click, message, or submit proposals.
- It does not call Upwork private APIs.
