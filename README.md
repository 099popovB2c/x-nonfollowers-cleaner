# X Non-Followers Cleaner

A local Chrome extension for reviewing and cleaning the accounts you follow on X/Twitter.

## v1.5.2

- Reworked unfollow flows for X's virtualized/SPA lists.
- Batch and timed modes now queue usernames and **re-query the live `UserCell` before every unfollow** instead of keeping stale DOM nodes.
- Waits for X's real confirmation UI and then verifies the Following state actually changed before counting success.
- Stale/unloaded rows are skipped instead of immediately breaking an entire batch.
- Consolidated the normal and Unfollow Everyone page logic into one runtime to avoid competing observers.
- Stops the extension's own injected badges/buttons from repeatedly retriggering scans.
- Keeps the local conservative `200/day` ceiling. This is not an official X safe limit.

## Features

- Scan currently loaded accounts on your **Following** page.
- Mark accounts that appear not to show X's **Follows you** relationship label.
- One-at-a-time unfollow review.
- Limited non-follower batch mode: 1–100 loaded accounts.
- Timed non-follower mode.
- **Unfollow Everyone** mode for currently loaded Following rows, including accounts that follow you back.
- Timed Unfollow Everyone mode.
- Local daily successful-unfollow counter.
- No X password, cookie or token collection.
- No external API or backend.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the project folder.
5. Open `https://x.com/<your-username>/following`.
6. Scroll so X loads the account rows you want to review.
7. Open the extension and scan the visible accounts.

## Detection note

Non-follower classification remains a **review aid**. It checks the currently rendered X account row for localized versions of the **Follows you** relationship label. X can change wording or DOM structure at any time, so review highlighted accounts before destructive actions.

Built-in relationship phrases cover English, Turkish, French, Spanish, German, Italian, Portuguese and Dutch. A custom phrase can also be stored locally.

## Reliability behavior

v1.5.2 uses X's current page structures such as `UserCell`, native Following/Unfollow controls and the confirmation sheet. It does not keep old row elements across multiple actions; each username is looked up again in the live page immediately before use.

The selected X Following tab must stay open for timed modes. Only rows that X currently has loaded can be processed.

## Privacy

All processing and counters stay in the browser. The extension does not transmit usernames, passwords, cookies, authentication tokens or unfollow history to a developer server.

## Important

The `200/day` counter is only a local precaution chosen by this project. It is **not** an official or guaranteed-safe X limit. X may restrict aggressive or automated following/unfollowing regardless of the number.

This extension automates actions on X's website rather than using the official API. X may change its website or enforcement rules at any time.

## License

MIT
