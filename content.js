(() => {
  if (window.__xNonFollowersCleanerLoaded) return;
  window.__xNonFollowersCleanerLoaded = true;

  const DEFAULT_FOLLOWS_YOU_PHRASES = [
    "follows you",
    "seni takip ediyor",
    "vous suit",
    "te sigue",
    "folgt dir",
    "ti segue",
    "segue você",
    "volgt jou"
  ];

  const state = {
    scanned: 0,
    followersBack: 0,
    nonFollowers: 0,
    lastCandidates: [],
    batchRunning: false
  };

  const COMMON_PATHS = new Set([
    "home","explore","notifications","messages","i","settings","compose",
    "search","tos","privacy","login","signup"
  ]);

  function normalize(s) {
    return (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  async function getPhrases() {
    const stored = await chrome.storage.local.get(["customFollowPhrases"]);
    const custom = Array.isArray(stored.customFollowPhrases)
      ? stored.customFollowPhrases.map(normalize).filter(Boolean)
      : [];
    return [...new Set([...DEFAULT_FOLLOWS_YOU_PHRASES, ...custom])];
  }

  function getUserCells() {
    return [...document.querySelectorAll('[data-testid="UserCell"]')];
  }

  function extractUsername(cell) {
    const links = [...cell.querySelectorAll('a[href^="/"]')];
    for (const a of links) {
      const href = (a.getAttribute("href") || "").split("?")[0].replace(/^\/+|\/+$/g, "");
      if (!href || href.includes("/") || COMMON_PATHS.has(href.toLowerCase())) continue;
      if (/^[A-Za-z0-9_]{1,15}$/.test(href)) return href;
    }
    return null;
  }

  function findNativeFollowingButton(cell) {
    const explicit = cell.querySelector(
      '[data-testid$="-unfollow"], [data-testid="unfollow"]'
    );
    if (explicit) return explicit;

    const candidates = [...cell.querySelectorAll('button, [role="button"]')];
    const labels = [
      "following","takip ediliyor","abonné","siguiendo","folge ich",
      "segui","seguindo","volgend"
    ];
    return candidates.find(el => {
      const text = normalize(
        el.innerText || el.getAttribute("aria-label") || el.getAttribute("title")
      );
      return labels.some(label => text.includes(label));
    }) || null;
  }

  async function classifyCell(cell, phrases) {
    const text = normalize(cell.innerText);
    const username = extractUsername(cell);
    if (!username) return null;

    const followsBack = phrases.some(p => text.includes(p));
    return { cell, username, followsBack };
  }

  function removeInjected(cell) {
    cell.querySelectorAll(".xnfc-badge, .xnfc-action").forEach(el => el.remove());
    cell.classList.remove("xnfc-nonfollower", "xnfc-followerback");
  }

  function addFollowerBadge(item) {
    item.cell.classList.add("xnfc-followerback");
    const badge = document.createElement("span");
    badge.className = "xnfc-badge xnfc-badge-good";
    badge.textContent = "✓ Follows you";
    item.cell.appendChild(badge);
  }

  const CONFIRM_UNFOLLOW_WORDS = [
    "unfollow","takibi bırak","takibi birak","ne plus suivre","dejar de seguir",
    "entfolgen","smetti di seguire","deixar de seguir"
  ];

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  async function recordSuccessfulUnfollow() {
    const key = todayKey();
    const stored = await chrome.storage.local.get(["dailyUnfollowDate", "dailyUnfollowCount"]);
    const current = stored.dailyUnfollowDate === key
      ? Number(stored.dailyUnfollowCount || 0)
      : 0;

    await chrome.storage.local.set({
      dailyUnfollowDate: key,
      dailyUnfollowCount: current + 1
    });
  }

  async function getDailyUnfollowCount() {
    const key = todayKey();
    const stored = await chrome.storage.local.get(["dailyUnfollowDate", "dailyUnfollowCount"]);
    if (stored.dailyUnfollowDate !== key) {
      await chrome.storage.local.set({
        dailyUnfollowDate: key,
        dailyUnfollowCount: 0
      });
      return 0;
    }
    return Number(stored.dailyUnfollowCount || 0);
  }

  function findConfirmUnfollowButton() {
    const byTestId = document.querySelector(
      '[data-testid="confirmationSheetConfirm"], button[data-testid="confirmationSheetConfirm"]'
    );
    if (byTestId) return byTestId;

    const container =
      document.querySelector('[role="alertdialog"]') ||
      document.querySelector('[data-testid="sheetDialog"]') ||
      document.querySelector('[data-testid="modal"]') ||
      document.querySelector('[role="dialog"]');

    if (!container) return null;

    const buttons = [...container.querySelectorAll('button, [role="button"]')];

    const semantic = buttons.find(b =>
      b.getAttribute("data-testid") === "confirmationSheetConfirm"
    );
    if (semantic) return semantic;

    const byText = buttons.find(b => {
      const t = normalize(
        b.innerText ||
        b.textContent ||
        b.getAttribute("aria-label") ||
        b.getAttribute("title")
      );
      return CONFIRM_UNFOLLOW_WORDS.some(w => t.includes(w));
    });
    if (byText) return byText;

    if (
      container.matches('[role="alertdialog"], [data-testid="sheetDialog"], [data-testid="modal"]')
      && buttons.length >= 1
    ) {
      return buttons[0];
    }

    return null;
  }

  async function waitForConfirmButton(timeoutMs = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const confirm = findConfirmUnfollowButton();
      if (confirm && !confirm.disabled) return confirm;
      await sleep(80);
    }
    return null;
  }

  async function waitForConfirmationToClose(timeoutMs = 3000) {
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

  async function unfollowItem(item) {
    if (!item?.cell?.isConnected) {
      return { ok: false, username: item?.username, reason: "row-not-loaded" };
    }

    const nativeButton = findNativeFollowingButton(item.cell);
    if (!nativeButton) {
      return { ok: false, username: item.username, reason: "following-button-not-found" };
    }

    nativeButton.click();
    const confirm = await waitForConfirmButton();

    if (!confirm) {
      return { ok: false, username: item.username, reason: "confirmation-not-found" };
    }

    confirm.click();

    const closed = await waitForConfirmationToClose();
    if (!closed) {
      return { ok: false, username: item.username, reason: "confirmation-did-not-close" };
    }

    await recordSuccessfulUnfollow();

    item.cell.classList.remove("xnfc-nonfollower");
    item.cell.style.opacity = "0.55";

    const injectedButton = item.cell.querySelector(".xnfc-action");
    if (injectedButton) {
      injectedButton.disabled = true;
      injectedButton.textContent = "Unfollow confirmed";
    }

    return { ok: true, username: item.username };
  }

  function addNonFollowerUI(item) {
    item.cell.classList.add("xnfc-nonfollower");

    const badge = document.createElement("span");
    badge.className = "xnfc-badge xnfc-badge-warn";
    badge.textContent = "Not following back";
    item.cell.appendChild(badge);

    const btn = document.createElement("button");
    btn.className = "xnfc-action";
    btn.type = "button";
    btn.textContent = `Unfollow @${item.username}`;
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (state.batchRunning) {
        alert("A limited batch unfollow is already running.");
        return;
      }

      const ok = window.confirm(`Unfollow @${item.username}?`);
      if (!ok) return;

      const result = await unfollowItem(item);
      if (!result.ok) {
        alert("The unfollow could not be completed. X may have changed its page layout.");
      }
    });

    item.cell.appendChild(btn);
  }

  async function limitedBatchUnfollow(requestedLimit) {
    const limit = Math.max(1, Math.min(100, Number(requestedLimit) || 10));

    if (state.batchRunning) {
      return { ok: false, reason: "already-running", requested: limit };
    }

    state.batchRunning = true;

    try {
      const phrases = await getPhrases();
      const cells = getUserCells();
      const items = [];

      for (const cell of cells) {
        const item = await classifyCell(cell, phrases);
        if (item && !item.followsBack) items.push(item);
      }

      const queue = items.slice(0, limit);
      const results = [];

      let stoppedReason = null;

      for (const item of queue) {
        const result = await unfollowItem(item);
        results.push(result);

        if (!result.ok) {
          stoppedReason = result.reason || "unfollow-failed";
          break;
        }

        await sleep(1100);
      }

      const removed = results.filter(r => r.ok).length;
      const skipped = results.filter(r => !r.ok).length;

      await scan();

      return {
        ok: true,
        requested: limit,
        queued: queue.length,
        removed,
        skipped,
        stoppedReason,
        results,
        ...state
      };
    } finally {
      state.batchRunning = false;
    }
  }

  async function timedSingleUnfollow() {
    if (state.batchRunning) {
      return { ok: false, reason: "another-operation-running" };
    }

    const dailyCount = await getDailyUnfollowCount();
    if (dailyCount >= 200) {
      return { ok: false, reason: "daily-ceiling-reached" };
    }

    state.batchRunning = true;

    try {
      const phrases = await getPhrases();
      const cells = getUserCells();

      for (const cell of cells) {
        const item = await classifyCell(cell, phrases);
        if (!item || item.followsBack) continue;

        if (!findNativeFollowingButton(cell)) continue;

        const result = await unfollowItem(item);
        if (result.ok) {
          await scan();
          return {
            ok: true,
            username: result.username,
            dailyCount: await getDailyUnfollowCount()
          };
        }

        return result;
      }

      return { ok: false, reason: "no-loaded-nonfollower" };
    } finally {
      state.batchRunning = false;
    }
  }

  async function scan() {
    const phrases = await getPhrases();
    const cells = getUserCells();
    const items = [];

    for (const cell of cells) {
      removeInjected(cell);
      const item = await classifyCell(cell, phrases);
      if (!item) continue;
      items.push(item);
      if (item.followsBack) addFollowerBadge(item);
      else addNonFollowerUI(item);
    }

    state.scanned = items.length;
    state.followersBack = items.filter(x => x.followsBack).length;
    state.nonFollowers = items.filter(x => !x.followsBack).length;
    state.lastCandidates = items.filter(x => !x.followsBack).map(x => x.username);

    return { ...state, url: location.href };
  }

  function goToNextCandidate() {
    const candidate = document.querySelector(".xnfc-nonfollower");
    if (!candidate) return false;
    candidate.scrollIntoView({ behavior: "smooth", block: "center" });
    candidate.animate(
      [{ outlineOffset: "1px" }, { outlineOffset: "7px" }, { outlineOffset: "1px" }],
      { duration: 900, iterations: 2 }
    );
    return true;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === "XNFC_SCAN") {
      scan().then(sendResponse);
      return true;
    }
    if (msg.type === "XNFC_NEXT") {
      sendResponse({ ok: goToNextCandidate() });
      return;
    }
    if (msg.type === "XNFC_BATCH_UNFOLLOW") {
      limitedBatchUnfollow(msg.limit).then(sendResponse);
      return true;
    }
    if (msg.type === "XNFC_TIMED_TICK") {
      timedSingleUnfollow().then(sendResponse);
      return true;
    }
    if (msg.type === "XNFC_STATUS") {
      sendResponse({ ...state, url: location.href });
    }
  });

  let observerTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(observerTimer);
    observerTimer = setTimeout(() => {
      if (state.batchRunning) return;
      const onFollowingPage = /\/following(?:\?|$)/.test(location.pathname + location.search);
      if (onFollowingPage && document.querySelector('[data-testid="UserCell"]')) scan();
    }, 800);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
