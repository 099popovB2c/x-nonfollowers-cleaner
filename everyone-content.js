(() => {
  if (window.__xnfcEveryoneLoaded) return;
  window.__xnfcEveryoneLoaded = true;

  const DAILY_CEILING = 200;

  const normalize = value =>
    (value || "").replace(/\s+/g, " ").trim().toLowerCase();

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  async function getDailyCount() {
    const key = todayKey();
    const stored = await chrome.storage.local.get([
      "dailyUnfollowDate",
      "dailyUnfollowCount"
    ]);

    if (stored.dailyUnfollowDate !== key) {
      await chrome.storage.local.set({
        dailyUnfollowDate: key,
        dailyUnfollowCount: 0
      });
      return 0;
    }

    return Number(stored.dailyUnfollowCount || 0);
  }

  async function incrementDailyCount() {
    const count = await getDailyCount();
    await chrome.storage.local.set({
      dailyUnfollowDate: todayKey(),
      dailyUnfollowCount: count + 1
    });
  }

  function getUserCells() {
    return [...document.querySelectorAll('[data-testid="UserCell"]')];
  }

  function extractUsername(cell) {
    const links = [...cell.querySelectorAll('a[href^="/"]')];

    for (const link of links) {
      const path = (link.getAttribute("href") || "")
        .split("?")[0]
        .replace(/^\/+|\/+$/g, "");

      if (/^[A-Za-z0-9_]{1,15}$/.test(path)) {
        return path;
      }
    }

    return null;
  }

  function findFollowingButton(cell) {
    const explicit = cell.querySelector(
      '[data-testid$="-unfollow"], [data-testid="unfollow"]'
    );
    if (explicit) return explicit;

    const labels = [
      "following",
      "takip ediliyor",
      "abonné",
      "siguiendo",
      "folge ich",
      "segui",
      "seguindo",
      "volgend"
    ];

    return [...cell.querySelectorAll('button, [role="button"]')].find(button => {
      const text = normalize(
        button.innerText ||
        button.textContent ||
        button.getAttribute("aria-label") ||
        button.getAttribute("title")
      );
      return labels.some(label => text.includes(label));
    }) || null;
  }

  function findConfirmButton() {
    const exact = document.querySelector(
      '[data-testid="confirmationSheetConfirm"]'
    );
    if (exact) return exact;

    const container =
      document.querySelector('[role="alertdialog"]') ||
      document.querySelector('[data-testid="sheetDialog"]') ||
      document.querySelector('[data-testid="modal"]') ||
      document.querySelector('[role="dialog"]');

    if (!container) return null;

    const words = [
      "unfollow",
      "takibi bırak",
      "takibi birak",
      "ne plus suivre",
      "dejar de seguir",
      "entfolgen",
      "smetti di seguire",
      "deixar de seguir"
    ];

    const buttons = [...container.querySelectorAll('button, [role="button"]')];

    return buttons.find(button => {
      const text = normalize(
        button.innerText ||
        button.textContent ||
        button.getAttribute("aria-label") ||
        button.getAttribute("title")
      );
      return words.some(word => text.includes(word));
    }) || null;
  }

  async function waitForConfirm(timeoutMs = 5000) {
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      const button = findConfirmButton();
      if (button && !button.disabled) return button;
      await sleep(80);
    }

    return null;
  }

  async function waitForDialogClose(timeoutMs = 3000) {
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      const stillOpen =
        document.querySelector('[data-testid="confirmationSheetConfirm"]') ||
        document.querySelector('[role="alertdialog"]') ||
        document.querySelector('[data-testid="sheetDialog"]');

      if (!stillOpen) return true;
      await sleep(80);
    }

    return false;
  }

  async function unfollowOne(cell, username) {
    const followingButton = findFollowingButton(cell);
    if (!followingButton) {
      return { ok: false, username, reason: "following-button-not-found" };
    }

    followingButton.click();

    const confirmButton = await waitForConfirm();
    if (!confirmButton) {
      return { ok: false, username, reason: "confirmation-not-found" };
    }

    confirmButton.click();

    if (!(await waitForDialogClose())) {
      return { ok: false, username, reason: "confirmation-did-not-close" };
    }

    await incrementDailyCount();
    cell.style.opacity = "0.55";

    return { ok: true, username };
  }

  async function run(limitRequested) {
    const daily = await getDailyCount();
    const remainingToday = Math.max(0, DAILY_CEILING - daily);

    if (remainingToday <= 0) {
      return {
        ok: false,
        reason: "daily-ceiling-reached",
        removed: 0,
        dailyCount: daily
      };
    }

    const limit = Math.max(
      1,
      Math.min(remainingToday, Number(limitRequested) || remainingToday)
    );

    const queue = [];

    for (const cell of getUserCells()) {
      const username = extractUsername(cell);
      if (!username) continue;
      if (!findFollowingButton(cell)) continue;

      queue.push({ cell, username });

      if (queue.length >= limit) break;
    }

    const results = [];
    let stoppedReason = null;

    for (const item of queue) {
      if ((await getDailyCount()) >= DAILY_CEILING) {
        stoppedReason = "daily-ceiling-reached";
        break;
      }

      const result = await unfollowOne(item.cell, item.username);
      results.push(result);

      if (!result.ok) {
        stoppedReason = result.reason;
        break;
      }

      await sleep(1100);
    }

    return {
      ok: true,
      requested: limit,
      queued: queue.length,
      removed: results.filter(result => result.ok).length,
      skipped: results.filter(result => !result.ok).length,
      stoppedReason,
      dailyCount: await getDailyCount(),
      results
    };
  }

  let running = false;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message?.type) return;

    if (
      message.type !== "XNFC_UNFOLLOW_EVERYONE" &&
      message.type !== "XNFC_EVERYONE_TIMED_TICK"
    ) {
      return;
    }

    if (running) {
      sendResponse({ ok: false, reason: "already-running" });
      return;
    }

    running = true;

    const requestedLimit =
      message.type === "XNFC_EVERYONE_TIMED_TICK"
        ? 1
        : message.limit;

    run(requestedLimit)
      .then(result => {
        if (
          message.type === "XNFC_EVERYONE_TIMED_TICK" &&
          result?.ok &&
          result.removed < 1
        ) {
          sendResponse({
            ok: false,
            reason: result.stoppedReason || "no-loaded-following-account",
            ...result
          });
          return;
        }

        sendResponse(result);
      })
      .catch(error => {
        sendResponse({
          ok: false,
          reason: "unexpected-error",
          error: String(error)
        });
      })
      .finally(() => {
        running = false;
      });

    return true;
  });
})();

