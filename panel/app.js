// X Feed panel — the UI that runs in Orca's sidebar.
const orca = window.__orca_panel__; // injected by Orca

// State
let currentView = "trending";
let tweets = [];
let autoRefreshTimer = null;

// DOM
const app = document.getElementById("app");
const tabs = document.querySelectorAll(".tab");
const searchBtn = document.getElementById("btn-search");
const profileBtn = document.getElementById("btn-profile");
const btnRefresh = document.getElementById("btn-refresh");
const btnSettings = document.getElementById("btn-settings");
const searchBar = document.getElementById("search-bar");
const profileBar = document.getElementById("profile-bar");
const searchInput = document.getElementById("search-input");
const profileInput = document.getElementById("profile-input");
const feedHeader = document.getElementById("feed-header");
const feedTitle = document.querySelector(".feed-title");
const feed = document.getElementById("feed");
const tweetCount = document.getElementById("tweet-count");
const errorEl = document.getElementById("error");
const errorText = document.getElementById("error-text");
const profileBanner = document.getElementById("profile-banner");

// Init
init();

async function init() {
  // Read saved settings to know which view to start with
  const settings = await orca.settings.get(["mode"]) || {};
  currentView = settings.mode || "trending";
  switchView(currentView);

  // Fetch initial data
  await refresh();
  startAutoRefresh();

  // Listen for auto-refresh setting changes
  orca.settings.onUpdate(async (newSettings) => {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
    startAutoRefresh(newSettings);
  });
}

function startAutoRefresh(settings = {}) {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  const interval = (settings?.autoRefresh ?? 0) * 1000;
  if (interval > 0) {
    autoRefreshTimer = setInterval(refresh, interval);
  }
}

function switchView(view) {
  currentView = view;
  tabs.forEach((t) => {
    t.classList.toggle("active", t.dataset.view === view);
    t.setAttribute("aria-selected", t.dataset.view === view ? "true" : "false");
  });

  // Show/hide bars
  searchBar.hidden = view !== "search";
  profileBar.hidden = view !== "profile";

  // Clear profile banner
  profileBanner.hidden = true;

  // Update title
  const titles = { trending: "Trending", search: "Search", profile: "Profile" };
  feedTitle.textContent = titles[view] || "Trending";

  // Clear feed
  tweets = [];
  renderFeed();
}

async function refresh() {
  showLoading();
  hideError();

  try {
    const params = currentView === "search"
      ? { query: searchInput?.value?.trim() || "" }
      : currentView === "profile"
      ? { username: profileInput?.value?.trim() || "" }
      : {};

    const result = await orca.panels.call("x-feed", `fetch${capitalize(currentView)}`, params);

    if (result?.error) {
      showError(result.error);
      tweets = [];
    } else if (currentView === "profile" && result?.user) {
      tweets = result.tweets || [];
      showProfile(result.user);
    } else {
      tweets = result?.tweets || [];
    }

    renderFeed();
  } catch (err) {
    showError(`Failed to fetch: ${err.message}`);
    tweets = [];
    renderFeed();
  }
}

function renderFeed() {
  feed.innerHTML = "";

  if (tweets.length === 0) {
    feed.innerHTML = `
      <div class="empty">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-4"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h4"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
        </div>
        <p>No tweets found</p>
      </div>`;
    tweetCount.textContent = "0 tweets";
    return;
  }

  tweetCount.textContent = `${tweets.length} tweet${tweets.length !== 1 ? "s" : ""}`;

  for (const tweet of tweets) {
    feed.appendChild(createTweetCard(tweet));
  }
}

function createTweetCard(tweet) {
  const card = document.createElement("div");
  card.className = "tweet";

  const avatar = tweet.user?.avatar || "";
  const avatarHtml = avatar
    ? `<div class="tweet-avatar" style="background-image:url('${avatar}')" title="${escapeHtml(tweet.user.name || "")}"></div>`
    : `<div class="tweet-avatar placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>`;

  // Process text: highlight mentions, hashtags, links
  let text = escapeHtml(tweet.text || "");
  text = text.replace(/(#\w+)/g, '<span class="hashtag">$1</span>');
  text = text.replace(/(@\w+)/g, '<span class="mention">$1</span>');

  // Trend badge
  const isTrend = tweet.isTrend || false;
  const trendBadge = isTrend
    ? `<span class="trend-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> TREND</span>`
    : "";

  // Images
  let imagesHtml = "";
  if (tweet.images?.length > 0) {
    const cols = Math.min(tweet.images.length, 4);
    const imgClass = `cols-${cols}`;
    imagesHtml = `<div class="tweet-images ${imgClass}">${tweet.images.slice(0, 4).map((url) => `<img src="${url}" loading="lazy" alt="" />`).join("")}</div>`;
  }

  // Actions
  const actionsHtml = !isTrend
    ? `<div class="tweet-actions">
        ${tweet.replies ? `<button class="tweet-action" title="Replies: ${tweet.replies}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>${formatNum(tweet.replies)}</button>` : ""}
        ${tweet.reposts ? `<button class="tweet-action" title="Reposts: ${tweet.reposts}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>${formatNum(tweet.reposts)}</button>` : ""}
        ${tweet.likes ? `<button class="tweet-action" title="Likes: ${tweet.likes}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>${formatNum(tweet.likes)}</button>` : ""}
        ${tweet.views ? `<button class="tweet-action" title="Views: ${tweet.views}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>${formatNum(tweet.views)}</button>` : ""}
      </div>`
    : "";

  // Time
  const timeStr = tweet.createdAt ? formatTime(tweet.createdAt) : "";

  card.innerHTML = `
    <div class="tweet-header">
      ${avatarHtml}
      <div class="tweet-body">
        <div class="tweet-meta">
          <span class="tweet-name">${escapeHtml(tweet.user?.name || "")}</span>
          <span class="tweet-handle">${escapeHtml(tweet.user?.handle || "")}</span>
          ${timeStr ? `<span class="tweet-dot">·</span><span class="tweet-time">${timeStr}</span>` : ""}
          ${trendBadge}
        </div>
        <div class="tweet-text">${text}</div>
        ${imagesHtml}
        ${actionsHtml}
      </div>
    </div>`;

  // Click to open in X
  card.addEventListener("click", () => {
    if (tweet.link) {
      orca.host.openExternal(tweet.link);
    } else {
      orca.host.openExternal(`https://x.com/${tweet.user?.handle?.replace("@", "") || "user"}`);
    }
  });

  return card;
}

function showProfile(user) {
  if (!user) {
    profileBanner.hidden = true;
    return;
  }

  profileBanner.hidden = false;

  // Avatar
  const avatar = document.getElementById("profile-avatar");
  if (user.avatar) {
    avatar.style.backgroundImage = `url('${user.avatar}')`;
  } else {
    avatar.style.backgroundImage = "";
    avatar.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    avatar.style.color = "var(--quiet)";
  }

  // Name & handle
  document.getElementById("profile-name").textContent = user.name || "";
  document.getElementById("profile-handle").textContent = user.handle || "";

  // Description
  const desc = document.getElementById("profile-desc");
  desc.textContent = user.description || "";

  // Stats
  const stats = document.getElementById("profile-stats");
  const parts = [];
  if (user.followers) parts.push(`<span><strong>${typeof user.followers === "number" ? formatNum(user.followers) : user.followers}</strong> followers</span>`);
  if (user.following) parts.push(`<span><strong>${typeof user.following === "number" ? formatNum(user.following) : user.following}</strong> following</span>`);
  stats.innerHTML = parts.join("");

  // Verified badge
  const verified = document.getElementById("profile-verified");
  verified.hidden = !user.verified;
}

function showLoading() {
  feed.innerHTML = `
    <div class="empty">
      <div class="empty-icon spinning">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-4"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h4"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
      </div>
      <p>Loading tweets...</p>
    </div>`;
}

function showError(msg) {
  errorText.textContent = msg;
  errorEl.hidden = false;
}

function hideError() {
  errorEl.hidden = true;
}

// Settings dialog
btnSettings.addEventListener("click", () => {
  openSettingsDialog();
});

async function openSettingsDialog() {
  const existing = document.querySelector("#settings-dialog");
  if (existing) {
    existing.showModal();
    return;
  }

  const dialog = document.createElement("dialog");
  dialog.id = "settings-dialog";

  dialog.innerHTML = `
    <h2>X Feed Settings</h2>
    <div class="dialog-field">
      <label for="setting-mode">Default view</label>
      <select id="setting-mode">
        <option value="trending">Trending</option>
        <option value="search">Search</option>
        <option value="profile">Profile</option>
      </select>
    </div>
    <div class="dialog-field">
      <label for="setting-api">API URL</label>
      <input id="setting-api" type="text" placeholder="https://api.vxtwitter.com" />
      <small>Free API that proxies X/Twitter content. No token needed.</small>
    </div>
    <div class="dialog-field">
      <label for="setting-token">Bearer Token (optional)</label>
      <input id="setting-token" type="password" placeholder="xpt_..." />
      <small>For authenticated access (timed tweets, private lists).</small>
    </div>
    <div class="dialog-field">
      <label for="setting-refresh">Auto-refresh (seconds)</label>
      <input id="setting-refresh" type="number" min="0" max="300" />
      <small>0 = off. Refreshes feed automatically at this interval.</small>
    </div>
    <div class="dialog-actions">
      <button class="btn-ghost" id="cancel-settings">Cancel</button>
      <button class="btn-primary" id="save-settings">Save</button>
    </div>`;

  document.body.appendChild(dialog);

  // Pre-fill current values
  const settings = await orca.settings.get(["mode", "apiBase", "bearerToken", "autoRefresh"]) || {};
  dialog.querySelector("#setting-mode").value = settings.mode || "trending";
  dialog.querySelector("#setting-api").value = settings.apiBase || "https://api.vxtwitter.com";
  dialog.querySelector("#setting-token").value = settings.bearerToken || "";
  dialog.querySelector("#setting-refresh").value = settings.autoRefresh ?? 0;

  // Cancel
  dialog.querySelector("#cancel-settings").addEventListener("click", () => dialog.close());

  // Save
  dialog.querySelector("#save-settings").addEventListener("click", async () => {
    await orca.settings.set({
      mode: dialog.querySelector("#setting-mode").value,
      apiBase: dialog.querySelector("#setting-api").value.trim(),
      bearerToken: dialog.querySelector("#setting-token").value.trim(),
      autoRefresh: parseInt(dialog.querySelector("#setting-refresh").value) || 0
    });
    currentView = dialog.querySelector("#setting-mode").value;
    switchView(currentView);
    await refresh();
    dialog.close();
  });

  dialog.showModal();

  // Remove when closed
  dialog.addEventListener("close", () => dialog.remove());
}

// Event listeners
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    switchView(tab.dataset.view);
    refresh();
  });
});

searchBtn?.addEventListener("click", () => {
  refresh();
});
profileBtn?.addEventListener("click", () => {
  refresh();
});

btnRefresh?.addEventListener("click", () => {
  refresh();
});

// Enter key triggers search
searchInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") refresh();
});
profileInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") refresh();
});

// ---- Helpers ----

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatNum(n) {
  if (!n || n === 0) return "0";
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

function formatTime(createdAt) {
  if (!createdAt) return "";
  try {
    const date = new Date(createdAt);
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);

    if (diffSec < 60) return `${diffSec}s`;
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
    if (diffSec < 172800) return "1d";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return createdAt;
  }
}
