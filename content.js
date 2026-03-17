(() => {
  // 二重注入ガード
  if (window.__sitecheck_active) return;
  window.__sitecheck_active = true;

  // ── Supabase 設定 ────────────────────────────────────────
  const SUPABASE_URL = "https://mmqfyzuaqbsibpojuedc.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1tcWZ5enVhcWJzaWJwb2p1ZWRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NTUyNTEsImV4cCI6MjA4OTEzMTI1MX0.Tgm6qqP4rq0bTRgnOw8O2rGSPftKPTZOupXC_6tKvcU";

  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  // ── 状態 ─────────────────────────────────────────────────
  let toolbar = null;
  let marker = null;
  let selectionRect = null;
  let form = null;
  let sidePanel = null;
  let sidePanelOpen = false;
  let clickData = null;
  let isActive = true;

  // プロジェクト関連
  let selectedProjectId = null;
  let selectedProjectCode = null;
  let projectsList = [];
  // プロジェクト全体の件数
  let projectTotalCount = 0;
  let projectOpenCount = 0;

  // ドラッグ関連
  let dragStart = null;
  let isDragging = false;
  const DRAG_THRESHOLD = 5;

  const STATUS_COLOR = {
    "未対応":  { bg: "#FEF2F2", text: "#DC2626", border: "#FECACA" },
    "対応中":  { bg: "#FFF7ED", text: "#D97706", border: "#FED7AA" },
    "確認待ち":{ bg: "#EFF6FF", text: "#2563EB", border: "#BFDBFE" },
    "対応なし":{ bg: "#F5F3FF", text: "#7C3AED", border: "#DDD6FE" },
    "完了":    { bg: "#F0FDF4", text: "#16A34A", border: "#BBF7D0" },
  };

  // インタラクティブ要素のセレクタ
  const INTERACTIVE_SELECTOR = 'a, button, input, select, textarea, [role="button"], [role="link"], [onclick], label, details, summary, [tabindex]';

  // ── プロジェクト一覧取得 ─────────────────────────────────
  async function fetchProjects() {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/projects?select=id,code,name&order=id`,
        { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
      );
      if (res.ok) {
        projectsList = await res.json();
        updateProjectSelector();
      }
    } catch (e) { /* ignore */ }
  }

  async function fetchProjectCounts() {
    if (!selectedProjectId) { projectTotalCount = 0; projectOpenCount = 0; updateToolbarCounts(); return; }
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/issues?project_id=eq.${selectedProjectId}&select=id,status`,
        { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
      );
      if (res.ok) {
        const all = await res.json();
        projectTotalCount = all.length;
        projectOpenCount = all.filter(i => i.status !== "完了" && i.status !== "対応なし").length;
      }
    } catch (e) { /* ignore */ }
    updateToolbarCounts();
  }

  function updateToolbarCounts() {
    const el = document.getElementById("sc-toolbar-counts");
    if (el) el.textContent = `プロジェクト全体：未完了${projectOpenCount}件 / 全${projectTotalCount}件`;
  }

  function updateProjectSelector() {
    const sel = document.getElementById("sc-project-select");
    if (!sel) return;
    sel.innerHTML = '<option value="">プロジェクトを選択</option>' +
      projectsList.map(p => `<option value="${p.id}" data-code="${p.code}" ${p.id === selectedProjectId ? 'selected' : ''}>${p.name}</option>`).join("");
  }

  // ── ツールバー作成 ─────────────────────────────────────────
  function createToolbar() {
    toolbar = document.createElement("div");
    toolbar.id = "sc-toolbar";
    toolbar.innerHTML = `
      <div class="sc-toolbar-left">
        <span id="sc-toolbar-icon">✓</span>
        <span>SiteCheck — クリックまたはドラッグで指摘箇所を選択</span>
      </div>
      <div class="sc-toolbar-right">
        <span class="sc-toolbar-label">修正依頼一覧</span>
        <span class="sc-toolbar-counts" id="sc-toolbar-counts">プロジェクト全体：未完了0件 / 全0件</span>
        <button class="sc-toolbar-close" id="sc-toolbar-close">✕</button>
      </div>
    `;
    document.body.appendChild(toolbar);

    document.getElementById("sc-toolbar-close").addEventListener("click", deactivate);

    document.body.style.paddingTop = "44px";
  }

  // ── UI要素の判定 ──────────────────────────────────────────
  function isExtensionUI(el) {
    return el.closest("#sc-toolbar") || el.closest("#sc-form") ||
           el.closest("#sc-side-panel") || el.closest(".sc-issue-popup") ||
           el.closest(".sc-issue-marker");
  }

  // ── マウスイベント（クリック＋ドラッグ対応） ──────────────
  function onMouseDown(e) {
    if (e.button !== 0) return; // 左クリックのみ
    if (isExtensionUI(e.target)) return;

    // フォーム表示中→外クリックで閉じる
    if (form) {
      cancelForm();
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // ポップアップ表示中→閉じる
    if (document.querySelector(".sc-issue-popup")) {
      window.dispatchEvent(new CustomEvent("sitecheck:close-popup"));
      return;
    }

    // テキスト選択を無効化（ドラッグ中のスクリーンショットに映り込まないように）
    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";

    // ドラッグ開始の準備
    dragStart = { clientX: e.clientX, clientY: e.clientY, target: e.target };
    isDragging = false;
  }

  function onMouseMove(e) {
    if (!dragStart) return;

    const dx = e.clientX - dragStart.clientX;
    const dy = e.clientY - dragStart.clientY;

    if (!isDragging && (Math.abs(dx) >= DRAG_THRESHOLD || Math.abs(dy) >= DRAG_THRESHOLD)) {
      isDragging = true;
    }

    if (isDragging) {
      drawSelectionRect(dragStart.clientX, dragStart.clientY, e.clientX, e.clientY);
    }
  }

  function onMouseUp(e) {
    if (!dragStart) return;

    const startTarget = dragStart.target;

    if (isDragging) {
      // ドラッグ完了→範囲選択で修正依頼作成
      e.preventDefault();
      e.stopPropagation();

      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      const pageW = document.documentElement.scrollWidth;
      const pageH = document.documentElement.scrollHeight;

      const x1 = Math.min(dragStart.clientX, e.clientX);
      const y1 = Math.min(dragStart.clientY, e.clientY);
      const x2 = Math.max(dragStart.clientX, e.clientX);
      const y2 = Math.max(dragStart.clientY, e.clientY);
      const centerX = (x1 + x2) / 2;
      const centerY = (y1 + y2) / 2;
      const absX = centerX + scrollX;
      const absY = centerY + scrollY;

      removeSelectionRect();

      captureAndShowForm({
        clientX: centerX, clientY: centerY,
        absX, absY,
        percentX: Math.round((absX / pageW) * 100),
        percentY: Math.round((absY / pageH) * 100),
        cropRect: { x1, y1, x2, y2 },
        rectViewport: { x1, y1, x2, y2 },
      });
    } else {
      // クリック（移動距離が閾値未満）
      removeSelectionRect();

      // インタラクティブ要素のクリック→そのまま通す
      if (startTarget.closest(INTERACTIVE_SELECTOR)) {
        dragStart = null;
        isDragging = false;
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      const pageW = document.documentElement.scrollWidth;
      const pageH = document.documentElement.scrollHeight;
      const absX = e.clientX + scrollX;
      const absY = e.clientY + scrollY;

      captureAndShowForm({
        clientX: e.clientX, clientY: e.clientY,
        absX, absY,
        percentX: Math.round((absX / pageW) * 100),
        percentY: Math.round((absY / pageH) * 100),
        cropRect: null,
        rectViewport: null,
      });
    }

    dragStart = null;
    isDragging = false;

    // テキスト選択を元に戻す
    document.body.style.userSelect = "";
    document.body.style.webkitUserSelect = "";
  }

  // ── 選択矩形表示 ─────────────────────────────────────────
  function drawSelectionRect(x1, y1, x2, y2) {
    if (!selectionRect) {
      selectionRect = document.createElement("div");
      selectionRect.id = "sc-selection-rect";
      document.body.appendChild(selectionRect);
    }
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);
    selectionRect.style.left = left + "px";
    selectionRect.style.top = top + "px";
    selectionRect.style.width = w + "px";
    selectionRect.style.height = h + "px";
  }

  function removeSelectionRect() {
    if (selectionRect) { selectionRect.remove(); selectionRect = null; }
  }

  // ── スクリーンショット取得＋トリミング ─────────────────────
  function captureAndShowForm(data) {
    // マーカー表示
    if (data.rectViewport) {
      showRectMarker(data.rectViewport);
    } else {
      showMarker(data.absX, data.absY);
    }

    // テキスト選択状態をクリア（スクリーンショットに映り込まないように）
    window.getSelection().removeAllRanges();

    chrome.runtime.sendMessage({ type: "CAPTURE_SCREENSHOT" }, (res) => {
      if (chrome.runtime.lastError || res?.error) {
        clickData = { ...data, croppedScreenshot: null };
      } else {
        const dpr = window.devicePixelRatio || 1;
        let cx, cy, cw, ch;

        if (data.cropRect) {
          cx = data.cropRect.x1 * dpr;
          cy = data.cropRect.y1 * dpr;
          cw = (data.cropRect.x2 - data.cropRect.x1) * dpr;
          ch = (data.cropRect.y2 - data.cropRect.y1) * dpr;
        } else {
          const cropW = 400 * dpr;
          const cropH = 300 * dpr;
          cx = data.clientX * dpr - cropW / 2;
          cy = data.clientY * dpr - cropH / 2;
          cw = cropW;
          ch = cropH;
        }

        const img = new Image();
        img.onload = () => {
          cx = Math.max(0, Math.min(cx, img.width - 1));
          cy = Math.max(0, Math.min(cy, img.height - 1));
          cw = Math.min(cw, img.width - cx);
          ch = Math.min(ch, img.height - cy);

          const canvas = document.createElement("canvas");
          canvas.width = cw;
          canvas.height = ch;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);

          clickData = { ...data, croppedScreenshot: canvas.toDataURL("image/png") };
          updateFormPreview();
        };
        img.onerror = () => {
          clickData = { ...data, croppedScreenshot: null };
        };
        img.src = res.screenshot;
        clickData = { ...data, croppedScreenshot: null };
      }

      showForm();
    });
  }

  function updateFormPreview() {
    const previewEl = document.getElementById("sc-form-preview-img");
    const placeholderEl = document.getElementById("sc-form-preview-placeholder");
    if (previewEl && clickData?.croppedScreenshot) {
      previewEl.src = clickData.croppedScreenshot;
      previewEl.style.display = "block";
      if (placeholderEl) placeholderEl.style.display = "none";
    }
  }

  // ── マーカー表示（ポイント：絶対座標） ────────────────────
  function showMarker(absX, absY) {
    removeMarker();
    marker = document.createElement("div");
    marker.id = "sc-marker";
    marker.style.left = absX + "px";
    marker.style.top = absY + "px";
    marker.innerHTML = `<div class="sc-marker-pulse"></div><div class="sc-marker-dot">!</div>`;
    document.body.appendChild(marker);
  }

  // ── マーカー表示（矩形） ─────────────────────────────────
  function showRectMarker(rect) {
    removeMarker();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    marker = document.createElement("div");
    marker.id = "sc-rect-marker";
    marker.style.left = (rect.x1 + scrollX) + "px";
    marker.style.top = (rect.y1 + scrollY) + "px";
    marker.style.width = (rect.x2 - rect.x1) + "px";
    marker.style.height = (rect.y2 - rect.y1) + "px";
    document.body.appendChild(marker);
  }

  function removeMarker() {
    if (marker) { marker.remove(); marker = null; }
    removeSelectionRect();
  }

  // ── フォーム表示（画面中央固定） ──────────────────────────
  function showForm() {
    removeForm();

    form = document.createElement("div");
    form.id = "sc-form";

    const hasScreenshot = clickData?.croppedScreenshot;
    const savedReporter = localStorage.getItem("sitecheck_reporter") || "";

    const members = window.__sitecheck_members || [];
    const assigneeOpts = members.map(m => `<option value="${m.name}">${m.name}</option>`).join("");

    form.innerHTML = `
      <div class="sc-form-header">
        <span class="sc-form-title">修正依頼を作成</span>
        <span class="sc-coord-badge" style="margin-left:auto;margin-right:8px">X:${clickData.percentX}% Y:${clickData.percentY}%</span>
        <button class="sc-form-close" id="sc-form-close">✕</button>
      </div>
      <div class="sc-screenshot-preview">
        <img id="sc-form-preview-img" src="${hasScreenshot || ''}" alt="screenshot"
             style="display:${hasScreenshot ? 'block' : 'none'}" />
        <span id="sc-form-preview-placeholder"
              style="display:${hasScreenshot ? 'none' : 'flex'};align-items:center;justify-content:center;width:100%;height:100%;color:#475569;font-size:12px">
          キャプチャ中…
        </span>
        <div class="sc-coord-badge">X:${clickData.percentX}% Y:${clickData.percentY}%</div>
      </div>
      <div class="sc-form-body">
        <label class="sc-label">タイトル <span class="sc-required">*</span></label>
        <input type="text" id="sc-input-title" class="sc-input" placeholder="例：ボタンの色が仕様と異なる" />

        <label class="sc-label">詳細説明</label>
        <textarea id="sc-input-detail" class="sc-textarea" placeholder="具体的な修正内容を記入"></textarea>

        <div class="sc-form-row">
          <div class="sc-form-col">
            <label class="sc-label">優先度</label>
            <select id="sc-input-priority" class="sc-select">
              <option value="中" selected>中</option>
              <option value="高">高</option>
              <option value="低">低</option>
            </select>
          </div>
          <div class="sc-form-col">
            <label class="sc-label">担当者</label>
            <select id="sc-input-assignee" class="sc-select">
              <option value="">未割当</option>
              ${assigneeOpts}
            </select>
          </div>
        </div>

        <label class="sc-label">起票者</label>
        <input type="text" id="sc-input-reporter" class="sc-input" placeholder="名前" value="${savedReporter.replace(/"/g, '&quot;')}" />

        <div class="sc-form-actions">
          <button id="sc-btn-cancel" class="sc-btn sc-btn-cancel">キャンセル</button>
          <button id="sc-btn-submit" class="sc-btn sc-btn-submit">送信</button>
        </div>
      </div>
    `;

    document.body.appendChild(form);

    document.getElementById("sc-form-close").addEventListener("click", cancelForm);
    document.getElementById("sc-btn-cancel").addEventListener("click", cancelForm);
    document.getElementById("sc-btn-submit").addEventListener("click", submitForm);
    document.getElementById("sc-input-title").focus();

    if (members.length === 0) {
      fetchMembersForForm();
    }
  }

  async function fetchMembersForForm() {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/members?select=id,name,role&order=id`,
        { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
      );
      if (!res.ok) return;
      const members = await res.json();
      window.__sitecheck_members = members;
      const sel = document.getElementById("sc-input-assignee");
      if (!sel) return;
      members.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.name;
        opt.textContent = m.name;
        sel.appendChild(opt);
      });
    } catch (e) { /* ignore */ }
  }

  function removeForm() {
    if (form) { form.remove(); form = null; }
  }

  function cancelForm() {
    removeForm();
    removeMarker();
    clickData = null;
  }

  // ── スクリーンショットアップロード ────────────────────────
  async function uploadScreenshot(dataUrl) {
    if (!dataUrl) return null;
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const filename = `screenshot_${Date.now()}.png`;
      const uploadRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/screenshots/${filename}`,
        {
          method: "POST",
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            "Content-Type": "image/png",
          },
          body: blob,
        }
      );
      if (uploadRes.ok) {
        return `${SUPABASE_URL}/storage/v1/object/public/screenshots/${filename}`;
      }
    } catch (e) {
      console.warn("Screenshot upload failed:", e);
    }
    return null;
  }

  // ── エラーメッセージ表示 ────────────────────────────────────
  function showFormError(message) {
    let errEl = document.getElementById("sc-form-error");
    if (!errEl) {
      errEl = document.createElement("div");
      errEl.id = "sc-form-error";
      errEl.style.cssText = "padding:8px 12px;margin:0 16px 8px;background:#FEF2F2;border:1px solid #FECACA;border-radius:6px;color:#DC2626;font-size:11px;line-height:1.5;word-break:break-all;max-height:80px;overflow-y:auto;";
      const body = document.querySelector("#sc-form .sc-form-body");
      if (body) body.prepend(errEl);
    }
    errEl.textContent = message;
  }

  // ── Supabase送信 ──────────────────────────────────────────
  async function submitForm() {
    if (!selectedProjectId) {
      showFormError("プロジェクトを選択してください。サイドバーのドロップダウンからプロジェクトを選択してください。");
      return;
    }
    const title = document.getElementById("sc-input-title")?.value?.trim();
    if (!title) {
      document.getElementById("sc-input-title").style.borderColor = "#DC2626";
      return;
    }

    const detail = document.getElementById("sc-input-detail")?.value?.trim() || "";
    const priority = document.getElementById("sc-input-priority")?.value || "中";
    const assignee = document.getElementById("sc-input-assignee")?.value || "";
    const reporter = document.getElementById("sc-input-reporter")?.value?.trim() || "Chrome拡張";

    if (reporter && reporter !== "Chrome拡張") {
      localStorage.setItem("sitecheck_reporter", reporter);
    }

    const submitBtn = document.getElementById("sc-btn-submit");
    submitBtn.textContent = "送信中…";
    submitBtn.disabled = true;

    const prevErr = document.getElementById("sc-form-error");
    if (prevErr) prevErr.remove();

    try {
      let screenshotUrl = null;
      if (clickData?.croppedScreenshot) {
        screenshotUrl = await uploadScreenshot(clickData.croppedScreenshot);
      }

      const today = new Date().toISOString().slice(0, 10);
      const pageTitle = document.title || "";
      const issueBody = {
        url: window.location.href.split("?")[0],
        title,
        detail,
        priority,
        status: "未対応",
        assignee,
        reporter,
        page: pageTitle,
        x: clickData?.percentX ?? 50,
        y: clickData?.percentY ?? 50,
        created_at: today,
        updated_at: today,
        project_id: selectedProjectId,
      };
      if (screenshotUrl) {
        issueBody.screenshot_url = screenshotUrl;
      }

      const res = await fetch(`${SUPABASE_URL}/rest/v1/issues`, {
        method: "POST",
        headers,
        body: JSON.stringify(issueBody),
      });

      const resText = await res.text();

      if (!res.ok) {
        if (resText.includes("screenshot_url") || resText.includes("column")) {
          delete issueBody.screenshot_url;
          const res2 = await fetch(`${SUPABASE_URL}/rest/v1/issues`, {
            method: "POST",
            headers,
            body: JSON.stringify(issueBody),
          });
          const resText2 = await res2.text();
          if (!res2.ok) throw new Error(`HTTP ${res2.status}: ${resText2}`);
          showSuccess();
          return;
        }
        throw new Error(`HTTP ${res.status}: ${resText}`);
      }

      showSuccess();
    } catch (err) {
      console.error("[SiteCheck] Submit failed:", err);
      let errMsg = err.message || String(err);
      if (errMsg.includes("Failed to fetch")) {
        errMsg = "ネットワークエラー: Supabaseに接続できません。";
      } else if (errMsg.includes("403")) {
        errMsg = "権限エラー (403): SupabaseのRLS設定を確認してください。";
      } else if (errMsg.includes("401")) {
        errMsg = "認証エラー (401): ANON_KEYが無効です。";
      }
      showFormError(errMsg);
      submitBtn.textContent = "再試行";
      submitBtn.disabled = false;
    }
  }

  // ── 送信成功表示 ──────────────────────────────────────────
  function showSuccess() {
    removeForm();
    removeMarker();

    const toast = document.createElement("div");
    toast.id = "sc-toast";
    toast.textContent = "✓ 修正依頼を送信しました";
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add("sc-toast-show"), 10);
    setTimeout(() => {
      toast.classList.remove("sc-toast-show");
      setTimeout(() => toast.remove(), 300);
    }, 2500);

    clickData = null;
    window.dispatchEvent(new CustomEvent("sitecheck:refresh"));
  }

  // ── サイドパネル（サイドバー） ────────────────────────────
  function openSidePanel() {
    if (sidePanel) return;
    sidePanelOpen = true;
    // サイドバー状態を保存
    chrome.storage.local.set({ sidebarOpen: true });

    const issues = window.__sitecheck_issues || [];

    sidePanel = document.createElement("div");
    sidePanel.id = "sc-side-panel";
    const projectOpts = projectsList.map(p =>
      `<option value="${p.id}" data-code="${p.code}" ${p.id === selectedProjectId ? 'selected' : ''}>${p.name}</option>`
    ).join("");

    // ページ別件数テキスト生成
    const pageStatsText = buildPageStatsText(issues);

    sidePanel.innerHTML = `
      <div class="sc-panel-project-row">
        <select class="sc-panel-filter" id="sc-project-select" style="flex:1;font-weight:600">
          <option value="">プロジェクトを選択</option>
          ${projectOpts}
        </select>
      </div>
      <div class="sc-panel-page-stats" id="sc-panel-page-stats">${pageStatsText}</div>
      <div class="sc-panel-filters">
        <select class="sc-panel-filter" id="sc-panel-filter-status">
          <option value="">すべてのステータス</option>
          <option value="未対応">未対応</option>
          <option value="対応中">対応中</option>
          <option value="確認待ち">確認待ち</option>
          <option value="対応なし">対応なし</option>
          <option value="完了">完了</option>
        </select>
        <select class="sc-panel-filter" id="sc-panel-filter-assignee">
          <option value="">すべての担当者</option>
        </select>
      </div>
      <div class="sc-panel-list" id="sc-panel-list">
        <div class="sc-panel-loading">読み込み中…</div>
      </div>
    `;
    document.body.appendChild(sidePanel);

    document.body.style.marginRight = "280px";

    requestAnimationFrame(() => sidePanel.classList.add("sc-panel-open"));

    document.getElementById("sc-panel-filter-status").addEventListener("change", renderPanelList);
    document.getElementById("sc-panel-filter-assignee").addEventListener("change", renderPanelList);
    document.getElementById("sc-project-select").addEventListener("change", (e) => {
      const val = e.target.value;
      const opt = e.target.selectedOptions[0];
      if (val) {
        selectedProjectId = parseInt(val, 10);
        selectedProjectCode = opt?.dataset?.code || null;
      } else {
        selectedProjectId = null;
        selectedProjectCode = null;
      }
      chrome.storage.local.set({ selectedProjectId, selectedProjectCode });
      fetchProjectCounts();
      // issueリフレッシュ
      window.dispatchEvent(new CustomEvent("sitecheck:refresh"));
    });

    populateAssigneeFilter();
    renderPanelList();

    window.addEventListener("sitecheck:issues-updated", onIssuesUpdated);
  }

  function buildPageStatsText(issues) {
    if (!issues || issues.length === 0) return `<span style="color:#888;font-size:11px">現在のページ：0件</span>`;
    const counts = {};
    issues.forEach(i => { counts[i.status] = (counts[i.status] || 0) + 1; });
    const parts = Object.entries(counts).map(([status, count]) => `${status} ${count}`).join("　");
    return `<span style="color:#555;font-size:11px">現在のページ：${parts} / 合計 ${issues.length}件</span>`;
  }

  function onIssuesUpdated() {
    renderPanelList();
    updatePanelHeader();
    fetchProjectCounts();
  }

  function updatePanelHeader() {
    const issues = window.__sitecheck_issues || [];

    // ページ別件数を更新
    const pageStatsEl = document.getElementById("sc-panel-page-stats");
    if (pageStatsEl) pageStatsEl.innerHTML = buildPageStatsText(issues);
  }

  function closeSidePanel() {
    if (!sidePanel) return;
    sidePanelOpen = false;
    // サイドバー状態を保存
    chrome.storage.local.set({ sidebarOpen: false });
    sidePanel.classList.remove("sc-panel-open");
    document.body.style.marginRight = "";

    setTimeout(() => {
      if (sidePanel) { sidePanel.remove(); sidePanel = null; }
    }, 300);
    window.removeEventListener("sitecheck:issues-updated", onIssuesUpdated);
  }

  function populateAssigneeFilter() {
    const sel = document.getElementById("sc-panel-filter-assignee");
    if (!sel) return;
    const issues = window.__sitecheck_issues || [];
    const assignees = [...new Set(issues.map(i => i.assignee).filter(Boolean))];
    assignees.forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
  }

  function renderPanelList() {
    const listEl = document.getElementById("sc-panel-list");
    if (!listEl) return;

    const issues = window.__sitecheck_issues || [];
    const filterStatus = document.getElementById("sc-panel-filter-status")?.value || "";
    const filterAssignee = document.getElementById("sc-panel-filter-assignee")?.value || "";

    let filtered = issues;
    if (filterStatus) filtered = filtered.filter(i => i.status === filterStatus);
    if (filterAssignee) filtered = filtered.filter(i => i.assignee === filterAssignee);

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="sc-panel-empty">条件に一致する修正依頼がありません</div>`;
      return;
    }

    const ADMIN_URL = "https://site-checker-one.vercel.app";

    listEl.innerHTML = filtered.map(issue => {
      const sc = STATUS_COLOR[issue.status] || STATUS_COLOR["未対応"];
      const isDone = issue.status === "完了" || issue.status === "対応なし";
      const adminLink = selectedProjectCode
        ? `${ADMIN_URL}/projects/${selectedProjectCode}?issue=${issue.id}`
        : `${ADMIN_URL}?issue=${issue.id}`;
      return `
        <div class="sc-panel-item ${isDone ? 'sc-panel-item-done' : ''}" data-issue-id="${issue.id}">
          <div class="sc-panel-item-header">
            <span class="sc-panel-item-id">#${issue.id}</span>
            <span class="sc-panel-item-status" style="background:${sc.bg};color:${sc.text};border:1px solid ${sc.border}">${issue.status}</span>
          </div>
          <div class="sc-panel-item-title">${issue.title}</div>
          ${issue.detail ? `<div class="sc-panel-item-detail">${issue.detail.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>` : ''}
          <div class="sc-panel-item-meta">
            <span class="sc-panel-item-priority">${issue.priority}</span>
            <span>👤 ${issue.assignee || '未割当'}</span>
            ${issue.reporter ? `<span class="sc-panel-item-reporter">✎ ${issue.reporter}</span>` : ''}
          </div>
          <a href="${adminLink}" target="_blank" rel="noopener noreferrer" class="sc-panel-item-admin-link" onclick="event.stopPropagation()">管理画面で開く →</a>
        </div>
      `;
    }).join("");

    listEl.querySelectorAll(".sc-panel-item").forEach(el => {
      el.addEventListener("click", () => {
        const id = el.dataset.issueId;
        if (window.__sitecheck_scrollToIssue) {
          window.__sitecheck_scrollToIssue(id);
        }
      });
    });
  }

  // ── 無効化 ────────────────────────────────────────────────
  function deactivate() {
    isActive = false;
    removeForm();
    removeMarker();
    closeSidePanel();
    document.removeEventListener("mousedown", onMouseDown, true);
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("mouseup", onMouseUp, true);
    if (toolbar) { toolbar.remove(); toolbar = null; }
    document.body.style.paddingTop = "";
    document.body.style.marginRight = "";
    window.__sitecheck_active = false;
    chrome.runtime.sendMessage({ type: "DEACTIVATE_SELF" });
  }

  // ── background からのメッセージ ───────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "DEACTIVATE") deactivate();
  });

  // ── 起動 ──────────────────────────────────────────────────
  createToolbar();
  document.addEventListener("mousedown", onMouseDown, true);
  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("mouseup", onMouseUp, true);

  // プロジェクト選択状態を復元してからサイドバーを自動表示
  chrome.storage.local.get(["selectedProjectId", "selectedProjectCode"], (result) => {
    if (result.selectedProjectId) {
      selectedProjectId = result.selectedProjectId;
      selectedProjectCode = result.selectedProjectCode || null;
    }
    fetchProjects();
    fetchProjectCounts();
    const waitForIssuesAndOpenSidebar = () => {
      if (window.__sitecheck_issues !== undefined) {
        openSidePanel();
      } else {
        setTimeout(waitForIssuesAndOpenSidebar, 200);
      }
    };
    setTimeout(waitForIssuesAndOpenSidebar, 500);
  });
})();
