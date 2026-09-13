const $ = id => document.getElementById(id);

function render(data) {
  $("scanned").textContent = data?.scanned ?? 0;
  $("followers").textContent = data?.followersBack ?? 0;
  $("nonfollowers").textContent = data?.nonFollowers ?? 0;
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function renderDailyCounter() {
  const key = todayKey();
  const stored = await chrome.storage.local.get(["dailyUnfollowDate", "dailyUnfollowCount"]);
  const count = stored.dailyUnfollowDate === key
    ? Number(stored.dailyUnfollowCount || 0)
    : 0;

  if (stored.dailyUnfollowDate !== key) {
    await chrome.storage.local.set({
      dailyUnfollowDate: key,
      dailyUnfollowCount: 0
    });
  }

  const shown = Math.max(0, count);
  $("dailyCount").textContent = `${shown} / 200`;
  $("dailyMeter").style.width = `${Math.min(100, (shown / 200) * 100)}%`;

  const box = $("dailySafety");
  box.classList.remove("safety-near", "safety-limit");

  if (shown >= 200) {
    box.classList.add("safety-limit");
    $("dailyWarning").textContent =
      "Suggested 200/day ceiling reached. Stop for today. This is a local safety recommendation, not an official X limit.";
  } else if (shown >= 150) {
    box.classList.add("safety-near");
    $("dailyWarning").textContent =
      `Approaching the suggested ceiling: ${200 - shown} remaining before 200. Consider stopping early.`;
  } else {
    $("dailyWarning").textContent =
      "Suggested personal ceiling: 200 unfollows/day. This is not an official X safe limit.";
  }

  return shown;
}

const TIMED_ALARM = "XNFC_TIMED_UNFOLLOW";

function formatRemainingTime(ms) {
  if (ms <= 0) return "due now";
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

async function renderTimedStatus() {
  const stored = await chrome.storage.local.get([
    "timedUnfollowActive",
    "timedUnfollowIntervalMinutes",
    "timedUnfollowRemaining",
    "timedUnfollowCompleted",
    "timedUnfollowLastUsername",
    "timedUnfollowLastError",
    "timedUnfollowStopReason"
  ]);

  const active = Boolean(stored.timedUnfollowActive);
  $("timedStart").disabled = active;
  $("timedStop").disabled = !active;
  $("timedMinutes").disabled = active;
  $("timedTotal").disabled = active;

  if (active) {
    const alarm = await chrome.alarms.get(TIMED_ALARM);
    const next = alarm?.scheduledTime
      ? formatRemainingTime(alarm.scheduledTime - Date.now())
      : "being restored";

    $("timedStatus").textContent =
      `Running: every ${stored.timedUnfollowIntervalMinutes} min • ` +
      `${stored.timedUnfollowRemaining} remaining • next in ${next}` +
      (stored.timedUnfollowLastUsername
        ? ` • last: @${stored.timedUnfollowLastUsername}`
        : "");
    return;
  }

  if (stored.timedUnfollowLastError) {
    $("timedStatus").textContent = `Stopped: ${stored.timedUnfollowLastError}`;
    return;
  }

  if (stored.timedUnfollowStopReason === "completed") {
    $("timedStatus").textContent =
      `Completed. ${stored.timedUnfollowCompleted || 0} account(s) processed.`;
    return;
  }

  $("timedStatus").textContent = "Stopped.";
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function message(type, extra = {}) {
  const tab = await activeTab();
  if (!tab?.id || !/^https:\/\/(x|twitter)\.com\//.test(tab.url || "")) {
    throw new Error("Open x.com or twitter.com first.");
  }
  return chrome.tabs.sendMessage(tab.id, { type, ...extra });
}

$("scan").addEventListener("click", async () => {
  $("status").textContent = "Scanning visible account cards…";
  try {
    const data = await message("XNFC_SCAN");
    render(data);
    $("status").textContent =
      `Found ${data.nonFollowers} visible account(s) that do not appear to follow you back.`;
  } catch (e) {
    $("status").textContent = e.message || String(e);
  }
});

$("next").addEventListener("click", async () => {
  try {
    const result = await message("XNFC_NEXT");
    $("status").textContent = result?.ok
      ? "Moved to the next highlighted account."
      : "No highlighted account is currently loaded.";
  } catch (e) {
    $("status").textContent = e.message || String(e);
  }
});

$("batch").addEventListener("click", async () => {
  const count = Math.max(1, Math.min(100, Number($("batchCount").value) || 10));
  $("batchCount").value = String(count);

  const today = await renderDailyCounter();
  const projected = today + count;

  let safetyText =
    `Unfollow up to ${count} currently loaded account(s) that do not appear to follow you back?\n\n` +
    `Today: ${today}/200. Projected maximum after this run: ${projected}/200.\n\n` +
    `The 200/day figure is a local precaution, not an official X safe limit.`;

  if (projected > 200) {
    safetyText +=
      `\n\nWARNING: This run could exceed the suggested 200/day ceiling. Consider reducing the batch or stopping for today.`;
  }

  const ok = window.confirm(safetyText);
  if (!ok) return;

  $("batch").disabled = true;
  $("scan").disabled = true;
  $("status").textContent = `Running limited batch: up to ${count} account(s)…`;

  try {
    const result = await message("XNFC_BATCH_UNFOLLOW", { limit: count });

    if (!result?.ok) {
      $("status").textContent = result?.reason === "already-running"
        ? "A batch is already running."
        : "The batch could not be started.";
      return;
    }

    render(result);
    await renderDailyCounter();
    $("status").textContent =
      `Completed: ${result.removed} unfollowed, ${result.skipped} skipped, ${result.queued} queued.`;
  } catch (e) {
    $("status").textContent = e.message || String(e);
  } finally {
    $("batch").disabled = false;
    $("scan").disabled = false;
  }
});

$("timedStart").addEventListener("click", async () => {
  const minutes = Math.max(
    1,
    Math.min(1440, Number($("timedMinutes").value) || 5)
  );
  const total = Math.max(
    1,
    Math.min(200, Number($("timedTotal").value) || 20)
  );

  $("timedMinutes").value = String(minutes);
  $("timedTotal").value = String(total);

  const tab = await activeTab();
  if (!tab?.id || !/^https:\/\/(x|twitter)\.com\/.+\/following(?:\?|$)/.test(tab.url || "")) {
    $("timedStatus").textContent =
      "Open your X profile Following page in this tab before starting Timed Mode.";
    return;
  }

  const today = await renderDailyCounter();
  if (today >= 200) {
    $("timedStatus").textContent =
      "Daily 200 safety ceiling already reached. Timed Mode was not started.";
    return;
  }

  const possibleToday = Math.min(total, 200 - today);
  const ok = window.confirm(
    `Start Timed Mode?\n\n` +
    `1 unfollow every ${minutes} minute(s)\n` +
    `Requested total: ${total}\n` +
    `Maximum possible before today's 200 safety ceiling: ${possibleToday}\n\n` +
    `First unfollow will run after ${minutes} minute(s). Keep this X Following tab open.\n\n` +
    `The 200/day figure is a local precaution, not an official X safe limit.`
  );
  if (!ok) return;

  await chrome.alarms.clear(TIMED_ALARM);
  await chrome.storage.local.set({
    timedUnfollowActive: true,
    timedUnfollowTargetTabId: tab.id,
    timedUnfollowIntervalMinutes: minutes,
    timedUnfollowRemaining: total,
    timedUnfollowCompleted: 0,
    timedUnfollowStartedAt: Date.now(),
    timedUnfollowStoppedAt: null,
    timedUnfollowStopReason: null,
    timedUnfollowLastRunAt: null,
    timedUnfollowLastUsername: null,
    timedUnfollowLastError: null
  });

  await chrome.alarms.create(TIMED_ALARM, {
    delayInMinutes: minutes,
    periodInMinutes: minutes
  });

  await renderTimedStatus();
});

$("timedStop").addEventListener("click", async () => {
  await chrome.alarms.clear(TIMED_ALARM);
  await chrome.storage.local.set({
    timedUnfollowActive: false,
    timedUnfollowStoppedAt: Date.now(),
    timedUnfollowStopReason: "user-stopped"
  });
  await renderTimedStatus();
});

$("save").addEventListener("click", async () => {
  const values = $("phrases").value.split("\n").map(x => x.trim()).filter(Boolean);
  await chrome.storage.local.set({ customFollowPhrases: values });
  $("status").textContent = "Language phrases saved.";
});

(async () => {
  await renderDailyCounter();
  await renderTimedStatus();
  setInterval(() => {
    renderTimedStatus().catch(() => {});
    renderDailyCounter().catch(() => {});
  }, 1000);
  const stored = await chrome.storage.local.get(["customFollowPhrases"]);
  $("phrases").value = (stored.customFollowPhrases || []).join("\n");
  try {
    render(await message("XNFC_STATUS"));
  } catch {}
})();
