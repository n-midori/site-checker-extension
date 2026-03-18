(() => {
  // 再注入ガード: 旧インスタンスのマーカーとリスナーをクリーンアップ
  if (window.__sc_markers_cleanup) {
    window.__sc_markers_cleanup();
  }

  // ── Supabase 設定 ────────────────────────────────────────
  const SUPABASE_URL = "https://mmqfyzuaqbsibpojuedc.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1tcWZ5enVhcWJzaWJwb2p1ZWRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NTUyNTEsImV4cCI6MjA4OTEzMTI1MX0.Tgm6qqP4rq0bTRgnOw8O2rGSPftKPTZOupXC_6tKvcU";

  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  };
  const jsonHeaders = {
    ...headers,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  const STATUSES = ["未対応", "対応中", "確認待ち", "対応なし", "完了"];
  const STATUS_COLOR = {
    "未対応":  { bg: "#FEF2F2", text: "#DC2626", border: "#FECACA" },
    "対応中":  { bg: "#FFF7ED", text: "#D97706", border: "#FED7AA" },
    "確認待ち":{ bg: "#EFF6FF", text: "#2563EB", border: "#BFDBFE" },
    "対応なし":{ bg: "#F5F3FF", text: "#7C3AED", border: "#DDD6FE" },
    "完了":    { bg: "#F0FDF4", text: "#16A34A", border: "#BBF7D0" },
  };

  const ADMIN_URL = "https://site-checker-one.vercel.app";

  let existingMarkers = [];
  let activePopup = null;
  let cachedMembers = null;
  // 現在のページのissue一覧を保持（サイドパネル用に公開）
  window.__sitecheck_issues = [];

  // ── メンバー一覧を取得（キャッシュ） ──────────────────────
  async function fetchMembers() {
    if (cachedMembers) return cachedMembers;
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/members?select=id,name,role&order=id`,
        { headers }
      );
      if (res.ok) {
        cachedMembers = await res.json();
        return cachedMembers;
      }
    } catch (e) { /* ignore */ }
    return [];
  }

  // ── URLパラメータからsc_情報を読み取る ──────────────────
  function checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const scId = params.get("sc_id");
    const scX = params.get("sc_x");
    const scY = params.get("sc_y");

    if (scId && scX && scY) {
      const x = parseFloat(scX);
      const y = parseFloat(scY);
      const pageW = document.documentElement.scrollWidth;
      const pageH = document.documentElement.scrollHeight;
      const absX = (x / 100) * pageW;
      const absY = (y / 100) * pageH;

      window.scrollTo({
        left: absX - window.innerWidth / 2,
        top: absY - window.innerHeight / 2,
        behavior: "smooth",
      });

      setTimeout(() => {
        const el = document.createElement("div");
        el.className = "sc-highlight-marker";
        el.style.left = absX + "px";
        el.style.top = absY + "px";
        el.innerHTML = `
          <div class="sc-highlight-pulse"></div>
          <div class="sc-highlight-dot">${scId}</div>
        `;
        document.body.appendChild(el);
        setTimeout(() => {
          const pulse = el.querySelector(".sc-highlight-pulse");
          if (pulse) pulse.style.animation = "none";
        }, 5000);
      }, 600);

      const cleanUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, "", cleanUrl);
    }
  }

  // ── 選択中プロジェクトIDを取得 ──────────────────────────
  async function getSelectedProjectId() {
    return new Promise((resolve) => {
      chrome.storage.local.get("selectedProjectId", (result) => {
        resolve(result.selectedProjectId || null);
      });
    });
  }

  async function getSelectedProjectCode() {
    return new Promise((resolve) => {
      chrome.storage.local.get("selectedProjectCode", (result) => {
        resolve(result.selectedProjectCode || null);
      });
    });
  }

  // ── Supabaseから該当URLの修正依頼を取得 ──────────────────
  async function fetchIssuesForUrl() {
    const currentUrl = window.location.origin + window.location.pathname;
    const projectId = await getSelectedProjectId();
    let query = `url=eq.${encodeURIComponent(currentUrl)}&select=id,title,detail,status,assignee,reporter,priority,x,y,screenshot_url&order=y.asc`;
    if (projectId) query += `&project_id=eq.${projectId}`;
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/issues?${query}`,
        { headers }
      );
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      try {
        const fullUrl = window.location.href.split("?")[0];
        let query2 = `url=eq.${encodeURIComponent(fullUrl)}&select=id,title,detail,status,assignee,reporter,priority,x,y,screenshot_url&order=y.asc`;
        if (projectId) query2 += `&project_id=eq.${projectId}`;
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/issues?${query2}`,
          { headers }
        );
        if (!res.ok) return [];
        return await res.json();
      } catch { return []; }
    }
  }

  // ── 既存の修正依頼マーカーを表示 ──────────────────────────
  function renderIssueMarkers(issues) {
    existingMarkers.forEach(el => el.remove());
    existingMarkers = [];
    window.__sitecheck_issues = issues;

    const pageW = document.documentElement.scrollWidth;
    const pageH = document.documentElement.scrollHeight;

    issues.forEach(issue => {
      const absX = (issue.x / 100) * pageW;
      const absY = (issue.y / 100) * pageH;
      const sc = STATUS_COLOR[issue.status] || STATUS_COLOR["未対応"];
      const isDone = issue.status === "完了" || issue.status === "対応なし";

      const el = document.createElement("div");
      el.className = "sc-issue-marker";
      el.style.left = absX + "px";
      el.style.top = absY + "px";
      el.style.opacity = isDone ? "0.4" : "1";
      el.dataset.issueId = issue.id;
      el.innerHTML = `<div class="sc-issue-dot" style="background:${sc.text};border-color:${sc.border}">${issue.id}</div>`;

      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showIssuePopup(issue, absX, absY, el);
      });

      document.body.appendChild(el);
      existingMarkers.push(el);
    });

    // サイドパネルに更新を通知
    window.dispatchEvent(new CustomEvent("sitecheck:issues-updated"));
  }

  // ── Supabaseでissueを更新 ────────────────────────────────
  async function updateIssueField(id, field, value) {
    const today = new Date().toISOString().slice(0, 10);
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/issues?id=eq.${id}`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ [field]: value, updated_at: today }),
      });
    } catch (e) {
      console.error("Update failed:", e);
    }
  }

  // ── 修正依頼ポップアップ表示（拡充版） ────────────────────
  async function showIssuePopup(issue, absX, absY, markerEl) {
    closePopup();

    const members = await fetchMembers();
    const projectCode = await getSelectedProjectCode();
    const sc = STATUS_COLOR[issue.status] || STATUS_COLOR["未対応"];

    activePopup = document.createElement("div");
    activePopup.className = "sc-issue-popup";

    // ステータス options
    const statusOpts = STATUSES.map(s =>
      `<option value="${s}" ${issue.status === s ? "selected" : ""}>${s}</option>`
    ).join("");

    // 担当者 options
    const assigneeOpts = `<option value="">未割当</option>` +
      members.map(m =>
        `<option value="${m.name}" ${issue.assignee === m.name ? "selected" : ""}>${m.name}</option>`
      ).join("");

    const adminHref = projectCode ? `${ADMIN_URL}/projects/${projectCode}?issue=${issue.id}` : `${ADMIN_URL}?issue=${issue.id}`;

    activePopup.innerHTML = `
      <div class="sc-popup-body">
        ${issue.screenshot_url ? `<img class="sc-popup-screenshot" src="${issue.screenshot_url}" alt="screenshot" />` : ''}
        <div class="sc-popup-header">
          <span class="sc-popup-id">#${issue.id}</span>
          <span class="sc-popup-priority-badge sc-priority-${issue.priority}">${issue.priority}</span>
          <button class="sc-popup-close">✕</button>
        </div>
        <div class="sc-popup-title">${issue.title}</div>
        ${issue.detail ? `<div class="sc-popup-detail">${issue.detail.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>` : ''}
        <div class="sc-popup-fields">
          <div class="sc-popup-field">
            <label class="sc-popup-label">ステータス</label>
            <select class="sc-popup-select" id="sc-popup-status">
              ${statusOpts}
            </select>
          </div>
          <div class="sc-popup-field">
            <label class="sc-popup-label">担当者</label>
            <select class="sc-popup-select" id="sc-popup-assignee">
              ${assigneeOpts}
            </select>
          </div>
        </div>
      </div>
      <div class="sc-popup-footer">
        <a href="${adminHref}" target="_blank" rel="noopener noreferrer" class="sc-popup-link">
          管理画面で開く →
        </a>
      </div>
    `;

    // 位置計算: マーカーのBoundingClientRectからviewport座標を取得
    let mcx, mcy;
    if (markerEl) {
      const rect = markerEl.getBoundingClientRect();
      mcx = rect.left + rect.width / 2;
      mcy = rect.top + rect.height / 2;
    } else {
      mcx = absX - window.scrollX;
      mcy = absY - window.scrollY;
    }

    const popW = 280;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // 左右: マーカーがviewport中央より右→左に開く、左→右に開く
    if (mcx > vw / 2) {
      activePopup.style.right = (vw - mcx + 16) + "px";
    } else {
      activePopup.style.left = (mcx + 16) + "px";
    }
    // 上下: マーカーがviewport中央より下→上に開く、上→下に開く
    if (mcy > vh / 2) {
      activePopup.style.bottom = (vh - mcy + 16) + "px";
    } else {
      activePopup.style.top = (mcy + 16) + "px";
    }

    document.body.appendChild(activePopup);

    // ── イベント ──
    activePopup.querySelector(".sc-popup-close").addEventListener("click", (e) => {
      e.stopPropagation();
      closePopup();
    });

    activePopup.querySelector("#sc-popup-status").addEventListener("change", async (e) => {
      const newStatus = e.target.value;
      await updateIssueField(issue.id, "status", newStatus);
      issue.status = newStatus;
      // マーカー色を更新
      const markerEl = existingMarkers.find(m => m.dataset.issueId == issue.id);
      if (markerEl) {
        const newSc = STATUS_COLOR[newStatus] || STATUS_COLOR["未対応"];
        const isDone = newStatus === "完了" || newStatus === "対応なし";
        markerEl.style.opacity = isDone ? "0.4" : "1";
        const dot = markerEl.querySelector(".sc-issue-dot");
        if (dot) {
          dot.style.background = newSc.text;
          dot.style.borderColor = newSc.border;
        }
      }
      window.dispatchEvent(new CustomEvent("sitecheck:issues-updated"));
    });

    activePopup.querySelector("#sc-popup-assignee").addEventListener("change", async (e) => {
      const newAssignee = e.target.value;
      await updateIssueField(issue.id, "assignee", newAssignee);
      issue.assignee = newAssignee;
      window.dispatchEvent(new CustomEvent("sitecheck:issues-updated"));
    });

    setTimeout(() => {
      document.addEventListener("click", onOutsideClick);
    }, 10);
  }

  function onOutsideClick(e) {
    if (activePopup && !activePopup.contains(e.target) && !e.target.closest(".sc-issue-marker")) {
      closePopup();
    }
  }

  function closePopup() {
    if (activePopup) {
      activePopup.remove();
      activePopup = null;
    }
    document.removeEventListener("click", onOutsideClick);
  }

  // content.js のオーバーレイ枠外クリックからポップアップを閉じる
  const onClosePopup = () => closePopup();
  window.addEventListener("sitecheck:close-popup", onClosePopup);

  // ── マーカーへスクロール（サイドパネルから呼び出し用） ────
  window.__sitecheck_scrollToIssue = function (issueId) {
    const markerEl = existingMarkers.find(m => m.dataset.issueId == issueId);
    if (!markerEl) return;

    const x = parseFloat(markerEl.style.left);
    const y = parseFloat(markerEl.style.top);
    window.scrollTo({
      left: x - window.innerWidth / 2,
      top: y - window.innerHeight / 2,
      behavior: "smooth",
    });

    // ハイライトアニメーション
    markerEl.classList.add("sc-issue-marker-highlight");
    setTimeout(() => markerEl.classList.remove("sc-issue-marker-highlight"), 2000);

    // ポップアップも表示
    const issue = window.__sitecheck_issues.find(i => i.id == issueId);
    if (issue) {
      setTimeout(() => showIssuePopup(issue, x, y, markerEl), 400);
    }
  };

  // ── 初期化 ────────────────────────────────────────────────
  async function init() {
    checkUrlParams();
    fetchMembers(); // プリフェッチ
    const issues = await fetchIssuesForUrl();
    if (issues.length > 0) {
      renderIssueMarkers(issues);
    }
  }

  // content.js から送信後のリフレッシュイベント
  const onRefresh = async () => {
    const issues = await fetchIssuesForUrl();
    renderIssueMarkers(issues);
  };
  window.addEventListener("sitecheck:refresh", onRefresh);

  // クリーンアップ関数を登録（再注入時に旧インスタンスを安全に破棄）
  window.__sc_markers_cleanup = () => {
    existingMarkers.forEach(el => el.remove());
    existingMarkers = [];
    closePopup();
    window.removeEventListener("sitecheck:close-popup", onClosePopup);
    window.removeEventListener("sitecheck:refresh", onRefresh);
    document.querySelectorAll(".sc-highlight-marker").forEach(el => el.remove());
  };

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(init, 100);
  } else {
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 100));
  }
})();
