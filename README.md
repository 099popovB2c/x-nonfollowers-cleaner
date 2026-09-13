# X Non-Followers Cleaner

A small, open-source Chrome extension for X/Twitter.

It scans account cards that are currently loaded on your **Following** page, marks accounts that do not appear to show the **“Follows you”** relationship label, and provides **one-at-a-time**, **limited batch (1–100)**, and **Timed Mode** unfollow workflows.

## Important

This project does **not** include unlimited mass-unfollow automation. Timed Mode can run scheduled single unfollows in the background while the selected X Following tab remains open.

Version 1.2 keeps the explicitly user-started limited batch mode capped at 100 currently loaded non-followers per run. After the single batch confirmation, the extension clicks each account's native unfollow control and the X confirmation dialog automatically, one by one. Review the detected accounts before starting a batch and use conservative limits.

The extension:

- does not ask for your X password;
- does not collect cookies or tokens;
- does not call unofficial/private X APIs;
- does not send your account data to a server;
- runs locally in your browser;
- performs no unlimited mass-unfollow loop;
- caps each manually confirmed batch at 100 accounts.

## Install locally

1. Download or clone this repository.
2. Open Chrome.
3. Go to `chrome://extensions`.
4. Turn on **Developer mode**.
5. Click **Load unpacked**.
6. Select this project folder.
7. Open `https://x.com/<your-username>/following`.
8. Scroll so X loads account rows.
9. Open the extension and click **Scan visible accounts**.
10. Review highlighted accounts manually.
11. Either click an injected **Unfollow @username** button for one account, or choose **1–100** in the popup and start a limited batch.

## How detection works

X renders account rows in the page. The extension checks the visible text in each loaded user card for the relationship label commonly shown as **“Follows you”**.

Built-in phrases currently include English, Turkish, French, Spanish, German, Italian, Portuguese and Dutch. You can add another localized phrase from the extension popup.

Because X can change its interface at any time, treat the result as a review aid rather than an authoritative account audit.

## Privacy

All processing happens in the active X/Twitter tab. No analytics, tracking, remote server or external API is used.

## Chrome permissions

- `storage`: saves optional custom language phrases locally.
- `activeTab`: communicates with the active X tab.
- `alarms`: schedules Timed Mode intervals.
- Host access for `x.com` and `twitter.com`: required for the content script.

## Development

This is a Manifest V3 extension with no build step and no third-party dependencies.

Files:

- `manifest.json`
- `content.js`
- `styles.css`
- `popup.html`
- `popup.js`
- `popup.css`
- `service-worker.js`
- `everyone-content.js`
- `everyone-popup.js`

## Contributing

Issues and pull requests are welcome. If X changes its DOM structure, please include:

- browser version;
- X interface language;
- page URL type;
- a description of what no longer works.

Do not submit features for automated bulk following/unfollowing.

## License

MIT

## Batch speed

The limited batch waits approximately 1.1 seconds after each successful unfollow before moving to the next loaded account.

## v1.2.1 confirmation fix

- Uses X's `data-testid="confirmationSheetConfirm"` as the primary confirmation selector.
- Supports `alertdialog`, sheet-dialog, modal and normal-dialog fallbacks.
- Waits until the confirmation UI closes before continuing.
- Stops the whole batch immediately if a confirmation cannot be verified.

## v1.3.0 batch limit

- Batch input now accepts any value from 1 to 100.
- Default remains 10.
- Values below 1 are clamped to 1.
- Values above 100 are clamped to 100.
- The extension still verifies each X confirmation before continuing to the next account.

## v1.3.1 daily safety counter

- Tracks successful unfollows locally per calendar day.
- Shows a `Today: X / 200` safety counter in the popup.
- Warns when approaching 150 and again at 200.
- Shows the projected total before each batch begins.
- `200/day` is a conservative user-configured ceiling used by this extension. It is **not** an official or guaranteed-safe X unfollow limit.
- X may restrict aggressive, bulk or automated following/unfollowing regardless of the numeric count.


## v1.4.0 Timed Mode

Timed Mode lets the user choose an interval and a total number of accounts.

Example:

- interval: `5 minutes`
- total: `20 accounts`
- behavior: one loaded non-follower is unfollowed every 5 minutes until 20 are processed, the daily safety ceiling is reached, an error occurs, or the user presses Stop.

Timed Mode uses Chrome's `alarms` API and a Manifest V3 service worker, so the popup does not need to remain open. The selected X **Following** tab must remain open and have account rows loaded.

Timed Mode automatically stops when:

- the requested count is completed;
- the local daily counter reaches 200;
- the target X tab becomes unavailable;
- no loaded non-follower is available;
- X's confirmation flow cannot be verified.

The extension also removes an overly broad `*-follow` selector from earlier versions so a row that has already been unfollowed cannot accidentally be treated as an unfollow control.

Chrome alarms can be delayed by browser scheduling or device sleep, so the selected interval is a target cadence rather than a real-time guarantee.


## v1.5.0 Unfollow Everyone

A separate **Unfollow Everyone** mode can unfollow currently loaded accounts regardless of whether they follow you back.

Safety behavior:

- Requires typing `UNFOLLOW ALL` before the destructive run begins.
- Uses only rows that still expose X's real Following/Unfollow control.
- Verifies X's confirmation UI before moving to the next account.
- Stops on the first unverified/failed confirmation.
- Shares the same local 200/day safety ceiling with all other modes.
- The run limit can be chosen by the user, but the effective count is capped by the remaining daily safety allowance.

This mode intentionally ignores the `Follows you` relationship label.


## v1.5.1 Timed Unfollow Everyone

The **Unfollow Everyone** section now has its own interval-based mode.

Example:

- every: `5 minutes`
- total: `20 accounts`
- behavior: one currently loaded Following account is unfollowed every 5 minutes, including accounts that follow you back.

Safety behavior:

- Requires typing `UNFOLLOW ALL` before starting.
- Uses the existing Chrome alarms scheduler.
- Shares the same 200/day local safety ceiling with every other mode.
- Stops if the target Following tab becomes unavailable.
- Stops when no loaded Following account is available.
- Stops if X's confirmation cannot be verified.
- Can be stopped manually from the popup.
- Starting this mode replaces any other active timed mode because both use the same scheduler.
