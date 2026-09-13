(() => {
  const button = document.getElementById("everyoneStart");
  const input = document.getElementById("everyoneCount");
  const status = document.getElementById("status");
  if (!button || !input || !status) return;

  function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  async function dailyCount() {
    const stored = await chrome.storage.local.get(["dailyUnfollowDate", "dailyUnfollowCount"]);
    return stored.dailyUnfollowDate === todayKey() ? Number(stored.dailyUnfollowCount || 0) : 0;
  }

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  button.addEventListener("click", async () => {
    const today = await dailyCount();
    const remainingToday = Math.max(0, 200 - today);
    if (remainingToday <= 0) {
      status.textContent = "Daily 200 safety ceiling reached. Unfollow Everyone was not started.";
      return;
    }

    const requested = Math.max(1, Math.min(200, Number(input.value) || 50));
    input.value = String(requested);
    const effective = Math.min(requested, remainingToday);

    const typed = window.prompt(
      `WARNING: This mode also unfollows people who follow you back.\n\n` +
      `Up to ${effective} currently loaded account(s) will be processed.\n` +
      `Today: ${today}/200.\n\n` +
      `Type UNFOLLOW ALL to continue.`
    );

    if (typed !== "UNFOLLOW ALL") {
      status.textContent = "Unfollow Everyone cancelled.";
      return;
    }

    const tab = await activeTab();
    if (!tab?.id || !/^https:\/\/(x|twitter)\.com\//.test(tab.url || "")) {
      status.textContent = "Open your X Following page first.";
      return;
    }

    button.disabled = true;
    status.textContent = `Unfollow Everyone running: up to ${effective} account(s)…`;

    try {
      const result = await chrome.tabs.sendMessage(tab.id, {
        type: "XNFC_UNFOLLOW_EVERYONE",
        limit: effective
      });

      if (!result?.ok) {
        status.textContent = `Unfollow Everyone stopped: ${result?.reason || "unknown error"}.`;
        return;
      }

      status.textContent =
        `Unfollow Everyone completed: ${result.removed} unfollowed` +
        (result.stoppedReason ? ` • stopped: ${result.stoppedReason}` : "") +
        `.`;
    } catch (error) {
      status.textContent = error?.message || String(error);
    } finally {
      button.disabled = false;
    }
  });
})();
