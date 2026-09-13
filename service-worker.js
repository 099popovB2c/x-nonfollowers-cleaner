const TIMED_ALARM = "XNFC_TIMED_UNFOLLOW";
const DAILY_CEILING = 200;

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function stopTimedMode(reason, extra = {}) {
  await chrome.alarms.clear(TIMED_ALARM);
  await chrome.storage.local.set({
    timedUnfollowActive: false,
    timedUnfollowStoppedAt: Date.now(),
    timedUnfollowStopReason: reason,
    ...extra
  });
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

async function restoreTimedAlarm() {
  const stored = await chrome.storage.local.get([
    "timedUnfollowActive",
    "timedUnfollowIntervalMinutes",
    "timedUnfollowRemaining"
  ]);

  if (!stored.timedUnfollowActive) return;

  const remaining = Number(stored.timedUnfollowRemaining || 0);
  if (remaining <= 0) {
    await stopTimedMode("completed");
    return;
  }

  const existing = await chrome.alarms.get(TIMED_ALARM);
  if (existing) return;

  const interval = Math.max(
    1,
    Math.min(1440, Number(stored.timedUnfollowIntervalMinutes) || 5)
  );

  await chrome.alarms.create(TIMED_ALARM, {
    delayInMinutes: interval,
    periodInMinutes: interval
  });
}

chrome.runtime.onInstalled.addListener(() => {
  restoreTimedAlarm().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  restoreTimedAlarm().catch(() => {});
});

// Also check whenever the service worker itself starts.
restoreTimedAlarm().catch(() => {});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== TIMED_ALARM) return;

  const stored = await chrome.storage.local.get([
    "timedUnfollowActive",
    "timedUnfollowTargetTabId",
    "timedUnfollowRemaining",
    "timedUnfollowCompleted",
    "timedUnfollowIntervalMinutes"
  ]);

  if (!stored.timedUnfollowActive) {
    await chrome.alarms.clear(TIMED_ALARM);
    return;
  }

  const dailyCount = await getDailyCount();
  if (dailyCount >= DAILY_CEILING) {
    await stopTimedMode("daily-ceiling-reached", {
      timedUnfollowLastError: "Daily 200 safety ceiling reached."
    });
    return;
  }

  const remaining = Number(stored.timedUnfollowRemaining || 0);
  if (remaining <= 0) {
    await stopTimedMode("completed");
    return;
  }

  const tabId = Number(stored.timedUnfollowTargetTabId);
  if (!Number.isInteger(tabId)) {
    await stopTimedMode("target-tab-missing", {
      timedUnfollowLastError: "Target X tab is missing."
    });
    return;
  }

  let result;
  try {
    result = await chrome.tabs.sendMessage(tabId, { type: "XNFC_TIMED_TICK" });
  } catch (error) {
    await stopTimedMode("target-tab-unavailable", {
      timedUnfollowLastError:
        "The target X Following tab is closed, reloaded without the extension, or unavailable."
    });
    return;
  }

  if (!result?.ok) {
    await stopTimedMode(result?.reason || "timed-unfollow-failed", {
      timedUnfollowLastError:
        result?.reason === "no-loaded-nonfollower"
          ? "No loaded non-follower was available. Scroll the Following page to load more accounts, then start Timed Mode again."
          : `Timed unfollow stopped: ${result?.reason || "unknown error"}.`
    });
    return;
  }

  const nextRemaining = Math.max(0, remaining - 1);
  const nextCompleted = Number(stored.timedUnfollowCompleted || 0) + 1;

  await chrome.storage.local.set({
    timedUnfollowRemaining: nextRemaining,
    timedUnfollowCompleted: nextCompleted,
    timedUnfollowLastRunAt: Date.now(),
    timedUnfollowLastUsername: result.username || null,
    timedUnfollowLastError: null
  });

  if (nextRemaining <= 0) {
    await stopTimedMode("completed");
  }
});
