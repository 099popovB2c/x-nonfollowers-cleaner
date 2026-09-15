(() => {
  if (window.__xnfcRuntime152Loaded) return;
  window.__xnfcRuntime152Loaded = true;

  const DAILY_CEILING = 200;
  const DEFAULT_FOLLOWS_YOU_PHRASES = [
    "follows you", "seni takip ediyor", "vous suit", "te sigue",
    "folgt dir", "ti segue", "segue você", "volgt jou"
  ];
  const FOLLOWING_LABELS = [
    "following", "takip ediliyor", "abonné", "abonnée", "siguiendo",
    "folge ich", "segui", "seguindo", "volgend"
  ];
  const CONFIRM_WORDS = [
    "unfollow", "takibi bırak", "takibi birak", "ne plus suivre",
    "dejar de seguir", "entfolgen", "smetti di seguire",
    "deixar de seguir", "ontvolgen"
  ];
  const COMMON_PATHS = new Set([
    "home","explore","notifications","messages","i","settings","compose",
    "search","tos","privacy","login","signup","jobs","communities"
  ]);

  const state = {
    scanned: 0,
    followersBack: 0,
    nonFollowers: 0,
    lastCandidates: [],
    running: false
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalize = value =>
    String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();

  function isFollowingPage() {
    return /\/following\/?$/.test(location.pathname);
  }

  function visible(el) {
    return !!(el && el.isConnected && el.getClientRects().length);
  }

  function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  async function getDailyCount() {
    const key = todayKey();
    const stored = await chrome.storage.local.get(["dailyUnfollowDate", "dailyUnfollowCount"]);
    if (stored.dailyUnfollowDate !== key) {
      await chrome.storage.local.set({ dailyUnfollowDate: key, dailyUnfollowCount: 0 });
      return 0;
    }
    return Number(stored.dailyUnfollowCount || 0);
  }

  async function incrementDailyCount() {
    const count = await getDailyCount();
    await chrome.storage.local.set({ dailyUnfollowDate: todayKey(), dailyUnfollowCount: count + 1 });
  }

  async function getPhrases() {
    const stored = await chrome.storage.local.get(["customFollowPhrases"]);
    const custom = Array.isArray(stored.customFollowPhrases)
      ? stored.customFollowPhrases.map(normalize).filter(Boolean)
      : [];
    return [...new Set([...DEFAULT_FOLLOWS_YOU_PHRASES, ...custom])];
  }

  function getUserCells() {
    return [...document.querySelectorAll('[data-testid="UserCell"]')].filter(visible);
  }

  function extractUsername(cell) {
    const links = [...cell.querySelectorAll('a[href^="/"]')];
    for (const link of links) {
      const path = (link.getAttribute("href") || "").split(/[?#]/)[0].replace(/^\/+|\/+$/g, "");
      if (!path || path.includes("/") || COMMON_PATHS.has(path.toLocaleLowerCase())) continue;
      if (/^[A-Za-z0-9_]{1,15}$/.test(path)) return path;
    }
    return null;
  }

  function findCellByUsername(username) {
    const target = normalize(username).replace(/^@/, "");
    return getUserCells().find(cell => normalize(extractUsername(cell)) === target) || null;
  }

  function findFollowingButton(cell) {
    if (!cell) return null;
    const explicit = [...cell.querySelectorAll('[data-testid$="-unfollow"], [data-testid="unfollow"]')].find(visible);
    if (explicit) return explicit;
    const buttons = [...cell.querySelectorAll('button, [role="button"]')].filter(visible);
    return buttons.find(button => {
      const text = normalize(button.innerText || button.textContent || button.getAttribute("aria-label") || button.getAttribute("title"));
      return FOLLOWING_LABELS.some(label => text === label || text.includes(label));
    }) || null;
  }

  function classifyCell(cell, phrases) {
    const username = extractUsername(cell);
    if (!username) return null;
    const text = normalize(cell.innerText || cell.textContent || "");
    const followsBack = phrases.some(phrase => text.includes(phrase));
    return { cell, username, followsBack };
  }

  function clearInjected(cell) {
    cell.querySelectorAll(".xnfc-badge, .xnfc-action").forEach(el => el.remove());
    cell.classList.remove("xnfc-nonfollower", "xnfc-followerback");
    delete cell.dataset.xnfcKind;
  }

  function syncCellUi(item) {
    const desired = item.followsBack ? "follower" : "nonfollower";
    const current = item.cell.dataset.xnfcKind;
    if (current === desired) {
      if (desired === "follower" && item.cell.querySelector(".xnfc-badge-good")) return;
      if (desired === "nonfollower" && item.cell.querySelector(".xnfc-action")) return;
    }
    clearInjected(item.cell);
    item.cell.dataset.xnfcKind = desired;
    if (item.followsBack) {
      item.cell.classList.add("xnfc-followerback");
      const badge = document.createElement("span");
      badge.className = "xnfc-badge xnfc-badge-good";
      badge.textContent = "✓ Follows you";
      item.cell.appendChild(badge);
      return;
    }
    item.cell.classList.add("xnfc-nonfollower");
    const badge = document.createElement("span");
    badge.className = "xnfc-badge xnfc-badge-warn";
    badge.textContent = "Not following back";
    item.cell.appendChild(badge);
    const button = document.createElement("button");
    button.className = "xnfc-action";
    button.type = "button";
    button.textContent = `Unfollow @${item.username}`;
    button.addEventListener("click", async event => {
      event.preventDefault(); event.stopPropagation();
      if (state.running) { alert("Another unfollow operation is already running."); return; }
      if (!confirm(`Unfollow @${item.username}?`)) return;
      state.running = true;
      try {
        const result = await unfollowUsername(item.username);
        if (!result.ok) alert(`Unfollow failed: ${result.reason || "unknown error"}`);
        await scan();
      } finally { state.running = false; }
    });
    item.cell.appendChild(button);
  }

  function findConfirmButton() {
    const exact = [...document.querySelectorAll('[data-testid="confirmationSheetConfirm"]')].find(visible);
    if (exact) return exact;
    const dialogs = [...document.querySelectorAll('[role="alertdialog"], [data-testid="sheetDialog"], [data-testid="modal"], [role="dialog"]')].filter(visible);
    for (const dialog of dialogs) {
      const buttons = [...dialog.querySelectorAll('button, [role="button"]')].filter(visible);
      const match = buttons.find(button => {
        const text = normalize(button.innerText || button.textContent || button.getAttribute("aria-label") || button.getAttribute("title"));
        return CONFIRM_WORDS.some(word => text === word || text.includes(word));
      });
      if (match) return match;
    }
    return null;
  }

  async function waitFor(getter, timeoutMs, intervalMs = 80) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = getter();
      if (value) return value;
      await sleep(intervalMs);
    }
    return null;
  }

  async function waitForDialogClose(timeoutMs = 4500) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const open = [...document.querySelectorAll('[data-testid="confirmationSheetConfirm"], [role="alertdialog"], [data-testid="sheetDialog"]')].some(visible);
      if (!open) return true;
      await sleep(90);
    }
    return false;
  }

  async function waitForFollowingStateChange(username, timeoutMs = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const cell = findCellByUsername(username);
      if (!cell || !findFollowingButton(cell)) return true;
      await sleep(120);
    }
    return false;
  }

  async function unfollowUsername(username) {
    const daily = await getDailyCount();
    if (daily >= DAILY_CEILING) return { ok: false, username, reason: "daily-ceiling-reached" };
    const cell = findCellByUsername(username);
    if (!cell) return { ok: false, username, reason: "row-not-loaded" };
    cell.scrollIntoView({ behavior: "auto", block: "center" });
    await sleep(220);
    const button = findFollowingButton(cell);
    if (!button) return { ok: false, username, reason: "following-button-not-found" };
    button.click();
    const confirmButton = await waitFor(findConfirmButton, 5500);
    if (!confirmButton) return { ok: false, username, reason: "confirmation-not-found" };
    confirmButton.click();
    if (!(await waitForDialogClose())) return { ok: false, username, reason: "confirmation-did-not-close" };
    if (!(await waitForFollowingStateChange(username))) return { ok: false, username, reason: "following-state-did-not-change" };
    await incrementDailyCount();
    return { ok: true, username };
  }

  async function scan() {
    if (!isFollowingPage()) {
      state.scanned = 0; state.followersBack = 0; state.nonFollowers = 0; state.lastCandidates = [];
      return { ...state, url: location.href, reason: "open-following-page" };
    }
    const phrases = await getPhrases();
    const items = getUserCells().map(cell => classifyCell(cell, phrases)).filter(Boolean);
    for (const item of items) syncCellUi(item);
    state.scanned = items.length;
    state.followersBack = items.filter(item => item.followsBack).length;
    state.nonFollowers = items.filter(item => !item.followsBack).length;
    state.lastCandidates = items.filter(item => !item.followsBack).map(item => item.username);
    return { ...state, url: location.href, dailyCount: await getDailyCount() };
  }

  async function runNonFollowerBatch(requestedLimit) {
    if (state.running) return { ok: false, reason: "already-running" };
    const daily = await getDailyCount();
    const available = Math.max(0, DAILY_CEILING - daily);
    if (!available) return { ok: false, reason: "daily-ceiling-reached", dailyCount: daily };
    const limit = Math.min(available, Math.max(1, Math.min(100, Number(requestedLimit) || 10)));
    state.running = true;
    try {
      const phrases = await getPhrases();
      const usernames = getUserCells().map(cell => classifyCell(cell, phrases)).filter(item => item && !item.followsBack && findFollowingButton(item.cell)).map(item => item.username).slice(0, limit);
      const results = []; let removed = 0; let skipped = 0; let stoppedReason = null;
      for (const username of usernames) {
        if ((await getDailyCount()) >= DAILY_CEILING) { stoppedReason = "daily-ceiling-reached"; break; }
        const result = await unfollowUsername(username); results.push(result);
        if (result.ok) { removed += 1; await sleep(900 + Math.floor(Math.random() * 500)); continue; }
        if (result.reason === "row-not-loaded" || result.reason === "following-button-not-found") { skipped += 1; continue; }
        stoppedReason = result.reason || "unfollow-failed"; break;
      }
      await scan();
      return { ok: true, requested: limit, queued: usernames.length, removed, skipped, stoppedReason, dailyCount: await getDailyCount(), results, ...state };
    } finally { state.running = false; }
  }

  async function timedNonFollower() {
    if (state.running) return { ok: false, reason: "another-operation-running" };
    const daily = await getDailyCount();
    if (daily >= DAILY_CEILING) return { ok: false, reason: "daily-ceiling-reached" };
    state.running = true;
    try {
      const phrases = await getPhrases();
      const item = getUserCells().map(cell => classifyCell(cell, phrases)).find(candidate => candidate && !candidate.followsBack && findFollowingButton(candidate.cell));
      if (!item) return { ok: false, reason: "no-loaded-nonfollower" };
      const result = await unfollowUsername(item.username);
      if (result.ok) await scan();
      return { ...result, dailyCount: await getDailyCount() };
    } finally { state.running = false; }
  }

  async function runEveryone(requestedLimit) {
    if (state.running) return { ok: false, reason: "already-running" };
    const daily = await getDailyCount();
    const remainingToday = Math.max(0, DAILY_CEILING - daily);
    if (!remainingToday) return { ok: false, reason: "daily-ceiling-reached", removed: 0, dailyCount: daily };
    const limit = Math.min(remainingToday, Math.max(1, Math.min(200, Number(requestedLimit) || remainingToday)));
    state.running = true;
    try {
      const usernames = getUserCells().filter(cell => findFollowingButton(cell)).map(extractUsername).filter(Boolean).slice(0, limit);
      const results = []; let removed = 0; let skipped = 0; let stoppedReason = null;
      for (const username of usernames) {
        if ((await getDailyCount()) >= DAILY_CEILING) { stoppedReason = "daily-ceiling-reached"; break; }
        const result = await unfollowUsername(username); results.push(result);
        if (result.ok) { removed += 1; await sleep(900 + Math.floor(Math.random() * 500)); continue; }
        if (result.reason === "row-not-loaded" || result.reason === "following-button-not-found") { skipped += 1; continue; }
        stoppedReason = result.reason || "unfollow-failed"; break;
      }
      await scan();
      return { ok: true, requested: limit, queued: usernames.length, removed, skipped, stoppedReason, dailyCount: await getDailyCount(), results };
    } finally { state.running = false; }
  }

  function goToNextCandidate() {
    const candidate = [...document.querySelectorAll(".xnfc-nonfollower")].find(visible);
    if (!candidate) return false;
    candidate.scrollIntoView({ behavior: "smooth", block: "center" });
    return true;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message?.type) return;
    if (message.type === "XNFC_SCAN") { scan().then(sendResponse); return true; }
    if (message.type === "XNFC_NEXT") { sendResponse({ ok: goToNextCandidate() }); return; }
    if (message.type === "XNFC_BATCH_UNFOLLOW") { runNonFollowerBatch(message.limit).then(sendResponse); return true; }
    if (message.type === "XNFC_TIMED_TICK") { timedNonFollower().then(sendResponse); return true; }
    if (message.type === "XNFC_STATUS") { getDailyCount().then(dailyCount => sendResponse({ ...state, url: location.href, dailyCount })); return true; }
    if (message.type === "XNFC_UNFOLLOW_EVERYONE") { runEveryone(message.limit).then(sendResponse); return true; }
    if (message.type === "XNFC_EVERYONE_TIMED_TICK") {
      runEveryone(1).then(result => {
        if (result?.ok && result.removed < 1) { sendResponse({ ...result, ok: false, reason: result.stoppedReason || "no-loaded-following-account" }); return; }
        sendResponse(result);
      });
      return true;
    }
  });

  let observerTimer = null;
  new MutationObserver(mutations => {
    if (!isFollowingPage() || state.running) return;
    const hasExternalChange = mutations.some(mutation => [...mutation.addedNodes].some(node => node.nodeType === Node.ELEMENT_NODE && !node.classList?.contains("xnfc-badge") && !node.classList?.contains("xnfc-action")));
    if (!hasExternalChange) return;
    clearTimeout(observerTimer);
    observerTimer = setTimeout(() => scan().catch(() => {}), 500);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
