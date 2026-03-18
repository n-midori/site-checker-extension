// ── 状態管理（chrome.storage.localで永続化） ────────────────
const activeTabIds = new Set();
let installed = false;

// 拡張機能インストール/更新時にactiveTabIdsをクリア（旧content scriptは無効化されているため）
chrome.runtime.onInstalled.addListener(() => {
  installed = true;
  activeTabIds.clear();
  chrome.storage.local.set({ activeTabIds: [] });
});

// 起動時に保存済みの状態を復元（install/update時はスキップ）
chrome.storage.local.get("activeTabIds", (result) => {
  if (!installed && result.activeTabIds) {
    result.activeTabIds.forEach(id => activeTabIds.add(id));
  }
});

function persistState() {
  chrome.storage.local.set({ activeTabIds: [...activeTabIds] });
}

// ── ツールバーアイコンのクリック ─────────────────────────────
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || tab.url.startsWith("chrome://")) return;

  if (activeTabIds.has(tab.id)) {
    activeTabIds.delete(tab.id);
    persistState();
    chrome.action.setBadgeText({ text: "", tabId: tab.id });
    chrome.tabs.sendMessage(tab.id, { type: "DEACTIVATE" }).catch(() => {});
    return;
  }

  activeTabIds.add(tab.id);
  persistState();
  chrome.action.setBadgeText({ text: "ON", tabId: tab.id });
  chrome.action.setBadgeBackgroundColor({ color: "#2563EB", tabId: tab.id });

  await injectContentScript(tab.id);
});

// ── content script を注入 ────────────────────────────────────
async function injectContentScript(tabId) {
  try {
    // markers.js も注入（拡張機能更新後は manifest content_scripts が再注入されないため）
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["markers.js"],
    });
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["markers.css"],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content.css"],
    });
  } catch (e) {
    console.error("Script injection failed:", e);
  }
}

// ── ページ遷移後に再注入 ────────────────────────────────────
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && activeTabIds.has(tabId)) {
    if (!tab.url || tab.url.startsWith("chrome://")) return;
    // バッジを再設定
    chrome.action.setBadgeText({ text: "ON", tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#2563EB", tabId });
    // content script を再注入
    await injectContentScript(tabId);
  }
});

// ── content script からのメッセージ ──────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "CAPTURE_SCREENSHOT" && sender.tab?.id) {
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" })
      .then((dataUrl) => sendResponse({ screenshot: dataUrl }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.type === "DEACTIVATE_SELF" && sender.tab?.id) {
    activeTabIds.delete(sender.tab.id);
    persistState();
    chrome.action.setBadgeText({ text: "", tabId: sender.tab.id });
  }
});

// タブが閉じられたら状態をクリア
chrome.tabs.onRemoved.addListener((tabId) => {
  activeTabIds.delete(tabId);
  persistState();
});
