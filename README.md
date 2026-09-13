# X Non-Followers Cleaner

A small, open-source Chrome extension for X/Twitter.

It scans account cards that are currently loaded on your **Following** page and provides **one-at-a-time**, **limited batch (1–100)**, **Timed Mode**, and a separate **Unfollow Everyone** workflow.

## Important

The extension runs locally in the browser and does not ask for your X password, collect cookies/tokens, call private X APIs, or send account data to an external server.

X does not publish a guaranteed safe daily unfollow number. The extension uses a local **200/day safety ceiling** as a conservative user-set precaution. This is **not** an official or guaranteed-safe X limit.

## Install locally

1. Download or clone this repository.
2. Open Chrome.
3. Go to `chrome://extensions`.
4. Turn on **Developer mode**.
5. Click **Load unpacked**.
6. Select this project folder.
7. Open `https://x.com/<your-username>/following`.
8. Scroll so X loads account rows.
9. Open the extension.

## Modes

### Non-followers scan

The extension checks currently loaded user cards for the relationship label commonly shown as **Follows you**. Built-in phrases include English, Turkish, French, Spanish, German, Italian, Portuguese and Dutch. Extra localized phrases can be added from the popup.

### Limited batch

Choose `1–100` currently loaded accounts that do not appear to follow you back. The extension processes them one by one and verifies X's confirmation UI before moving on.

### Timed Mode

Choose an interval and a total count. Example:

- interval: `5 minutes`
- total: `20 accounts`
- behavior: one loaded non-follower is processed every 5 minutes until the requested count is completed, the daily safety ceiling is reached, an error occurs, or Stop is pressed.

Timed Mode uses Chrome's `alarms` API and a Manifest V3 service worker. The selected X Following tab must remain open and have account rows loaded.

### Unfollow Everyone

This is a separate destructive mode that intentionally ignores the **Follows you** relationship and can unfollow people who follow you back.

Safety behavior:

- Requires typing `UNFOLLOW ALL` before starting.
- Processes only currently loaded Following rows.
- Uses only rows that expose X's real Following/Unfollow control.
- Verifies X's confirmation UI before moving to the next account.
- Stops on the first unverified/failed confirmation.
- Shares the same local 200/day safety ceiling with all other modes.
- The user can choose the maximum count for the run, up to the remaining daily allowance.

## Privacy

All processing happens in the X/Twitter tab. No analytics, tracking, remote server or external API is used.

## Chrome permissions

- `storage`: saves settings and the local daily counter.
- `activeTab`: communicates with the active X tab.
- `alarms`: schedules Timed Mode intervals.
- Host access for `x.com` and `twitter.com`: required for the content scripts.

## Development

Manifest V3, no build step, no third-party dependencies.

Files:

- `manifest.json`
- `content.js`
- `everyone-content.js`
- `styles.css`
- `popup.html`
- `popup.js`
- `everyone-popup.js`
- `popup.css`
- `service-worker.js`

## Safety notes

- X may change its page structure at any time.
- Results should be reviewed before destructive actions.
- Bulk/aggressive automated following or unfollowing may trigger account restrictions regardless of the numeric count.
- Chrome alarms can be delayed by browser scheduling or device sleep.

## Version history

### v1.5.0

- Added separate **Unfollow Everyone** button.
- Can include accounts that follow you back.
- Requires `UNFOLLOW ALL` typed confirmation.
- Shares the 200/day local safety counter.
- Kept the destructive mode isolated in `everyone-content.js` and `everyone-popup.js`.

### v1.4.0

- Added Timed Mode.
- Added Chrome `alarms` scheduling and Manifest V3 service worker.

### v1.3.1

- Added local daily safety counter and warnings.

### v1.3.0

- Increased limited non-follower batch range to 1–100.

### v1.2.1

- Improved X confirmation detection and stop-on-failure behavior.

## Contributing

Issues and pull requests are welcome. If X changes its DOM structure, include browser version, X interface language, page URL type and a description of what no longer works.

## License

MIT
