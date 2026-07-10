/* AI 環節診斷室：前端共用邏輯（無打包工具，原生 JS） */
(function () {
  "use strict";

  // GH Pages 上跨域打後端；其餘（本機同源、fde 網域）走同源
  var API_BASE = location.hostname.endsWith("github.io")
    ? "https://fde.cattravelworld.com"
    : "";

  var TOKEN_KEY = "fde_token";
  var state = { cfg: null, me: null };

  function token() { return localStorage.getItem(TOKEN_KEY) || ""; }
  function setToken(t) {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  }

  async function api(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    if (token()) opts.headers["Authorization"] = "Bearer " + token();
    if (opts.body && typeof opts.body !== "string") {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(opts.body);
    }
    var resp = await fetch(API_BASE + path, opts);
    var data = null;
    try { data = await resp.json(); } catch (e) { /* 非 JSON 回應 */ }
    if (!resp.ok) {
      var msg = (data && data.error) ? data.error : ("HTTP " + resp.status);
      var err = new Error(msg);
      err.status = resp.status;
      throw err;
    }
    return data;
  }

  function el(id) { return document.getElementById(id); }

  function showBanner(text) {
    var b = el("banner");
    if (b) { b.textContent = text; b.style.display = "block"; }
  }

  var noticeTimer = null;
  function notice(text) {
    var n = el("notice");
    if (!n) return;
    n.textContent = text;
    n.classList.add("show");
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () { n.classList.remove("show"); }, 3200);
  }

  // ---------- Google 登入 ----------

  function initGis() {
    if (!state.cfg || !state.cfg.google_client_id) return;
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      if (window.google && google.accounts && google.accounts.id) {
        clearInterval(timer);
        google.accounts.id.initialize({
          client_id: state.cfg.google_client_id,
          callback: onGoogleCredential,
        });
        var slot = el("gsi-btn");
        if (slot) {
          google.accounts.id.renderButton(slot, { theme: "outline", size: "medium", text: "signin_with" });
        }
      } else if (tries > 40) {
        clearInterval(timer);
      }
    }, 250);
  }

  async function onGoogleCredential(resp) {
    try {
      var data = await api("/api/auth/google", { method: "POST", body: { credential: resp.credential } });
      setToken(data.token);
      state.me = data.me;
      notice("登入成功，歡迎 " + (data.me.name || data.me.email));
      renderAuthArea();
      document.dispatchEvent(new CustomEvent("fde:login"));
    } catch (e) {
      notice("登入失敗：" + e.message);
    }
  }

  async function logout() {
    try { await api("/api/auth/logout", { method: "POST" }); } catch (e) { /* 忽略 */ }
    setToken("");
    state.me = null;
    location.href = "index.html";
  }

  function renderAuthArea() {
    var area = el("auth-area");
    if (!area) return;
    if (state.me) {
      var pic = state.me.picture
        ? '<img src="' + state.me.picture + '" alt="">'
        : '<img src="assets/xia-avatar.svg" alt="">';
      area.innerHTML =
        '<span class="user-chip">' + pic +
        "<span>" + escapeHtml(state.me.name || state.me.email) + "</span>" +
        '<button id="btn-logout" type="button">登出</button></span>';
      el("btn-logout").addEventListener("click", logout);
    } else {
      area.innerHTML = '<div id="gsi-btn"></div>';
      initGis();
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtTime(t) {
    if (!t) return "-";
    var d = new Date(t * 1000);
    return (d.getMonth() + 1) + "/" + d.getDate() + " " +
      String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function assetUrl(path) {
    // 後端相對路徑（/covers/...、/avatar/...）在 GH Pages 上要打回後端網域
    return path && path.charAt(0) === "/" ? API_BASE + path : path;
  }

  function applyAvatar() {
    if (!state.cfg || !state.cfg.xia_avatar) return;
    var src = assetUrl(state.cfg.xia_avatar);
    document.querySelectorAll(".brand img, #hero-avatar").forEach(function (img) { img.src = src; });
  }

  function renderAdminLink() {
    if (!state.me || !state.me.is_admin) return;
    if (document.body.getAttribute("data-page") === "admin") return;  // admin 頁已有靜態連結
    if (document.getElementById("nav-admin")) return;
    var nav = document.querySelector(".nav");
    var area = el("auth-area");
    if (!nav || !area) return;
    var a = document.createElement("a");
    a.id = "nav-admin";
    a.href = API_BASE + "/admin";
    a.textContent = "管理後台";
    nav.insertBefore(a, area);
  }

  // ---------- 頁面邏輯 ----------

  // 只有從作者本機（localhost）開作品牆，地端工具才顯示「啟動」；公開站退化成純展示徽章
  var IS_LOCALHOST = ["localhost", "127.0.0.1", "::1"].indexOf(location.hostname) >= 0;

  async function launchLocal(id, btn) {
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "啟動中…";
    try {
      await api("/api/works/" + id + "/launch", { method: "POST" });
      notice("已在本機啟動這個工具。");
    } catch (e) {
      notice("啟動失敗：" + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  async function loadWorks() {
    var grid = el("works-grid");
    if (!grid) return;
    try {
      var data = await api("/api/works");
      if (!data.works.length) {
        grid.outerHTML = '<div class="empty-hint">作品整理中，稍後再來看看。</div>';
        return;
      }
      grid.innerHTML = data.works.map(function (w) {
        var tags = (w.tags || []).map(function (t) { return '<span class="tag">' + escapeHtml(t) + "</span>"; }).join("");
        var cover = w.cover
          ? '<img class="work-cover" src="' + escapeHtml(assetUrl(w.cover)) + '" alt="" loading="lazy">'
          : "";
        var action;
        if (w.kind === "local") {
          action = '<span class="badge-local">本地桌面工具</span>' + (IS_LOCALHOST
            ? '<button class="work-launch" type="button" data-id="' + escapeHtml(w.id) + '">啟動工具 →</button>'
            : '<span class="work-local-hint">限作者本機啟動</span>');
        } else {
          var badge = w.tailscale_only
            ? '<span class="badge-ts">僅限' + escapeHtml(w.company || "特定公司") + '專屬帳號（Tailscale）連入</span>'
            : "";
          action = badge +
            '<a href="' + escapeHtml(w.url) + '" target="_blank" rel="noopener">前往作品 →</a>';
        }
        return (
          '<div class="work-card">' + cover +
          "<h3>" + escapeHtml(w.title) + "</h3>" +
          "<p>" + escapeHtml(w.desc || "") + "</p>" +
          '<div class="tag-row">' + tags + "</div>" + action +
          "</div>"
        );
      }).join("");
      grid.querySelectorAll(".work-launch").forEach(function (btn) {
        btn.addEventListener("click", function () { launchLocal(btn.dataset.id, btn); });
      });
    } catch (e) {
      grid.outerHTML = '<div class="empty-hint">作品清單暫時載入不了（後端服務離線）。</div>';
    }
  }

  function initIndex() {
    loadWorks();
    var cta = el("btn-chat-cta");
    if (cta) {
      cta.addEventListener("click", function () {
        document.dispatchEvent(new CustomEvent("fde:open-chat"));
      });
    }
  }

  function requireLoginView(containerId) {
    var c = el(containerId);
    if (c) {
      c.innerHTML =
        '<div class="require-login card"><p>這個頁面需要先登入，請點右上角「使用 Google 帳戶登入」。</p></div>';
    }
  }

  async function initAccount() {
    if (!state.me) { requireLoginView("account-main"); return; }
    el("acc-email").value = state.me.email;
    el("acc-name").value = state.me.name;
    el("acc-key").placeholder = state.me.has_key
      ? "已設定（尾碼 " + state.me.key_tail + "），輸入新值可更換"
      : "尚未設定，貼上你的 nvapi- 開頭金鑰";

    el("btn-save-profile").addEventListener("click", async function () {
      var msg = el("profile-msg");
      try {
        var data = await api("/api/me", { method: "PATCH", body: { name: el("acc-name").value } });
        state.me = data.me;
        msg.textContent = "已儲存。";
        msg.className = "form-msg ok";
      } catch (e) {
        msg.textContent = e.message;
        msg.className = "form-msg err";
      }
    });

    el("btn-save-key").addEventListener("click", async function () {
      var msg = el("key-msg");
      var val = el("acc-key").value.trim();
      try {
        var data = await api("/api/me", { method: "PATCH", body: { nvidia_api_key: val } });
        state.me = data.me;
        el("acc-key").value = "";
        el("acc-key").placeholder = data.me.has_key
          ? "已設定（尾碼 " + data.me.key_tail + "），輸入新值可更換"
          : "尚未設定，貼上你的 nvapi- 開頭金鑰";
        msg.textContent = data.me.has_key ? "金鑰已儲存。" : "金鑰已清除。";
        msg.className = "form-msg ok";
      } catch (e) {
        msg.textContent = e.message;
        msg.className = "form-msg err";
      }
    });
  }

  // 收件夾：需求單列表＋討論串（輪詢更新約 5 秒，PLAN §0.4）

  var inboxTimer = null;

  function kindLabel(k) { return k === "note" ? "站內留言" : "需求單"; }

  async function initInbox() {
    if (!state.me) { requireLoginView("inbox-main"); return; }
    showInboxList();
  }

  async function showInboxList() {
    clearInterval(inboxTimer);
    var list = el("ticket-list");
    try {
      var data = await api("/api/inbox");
      if (!data.tickets.length) {
        list.innerHTML =
          '<div class="empty-hint">還沒有需求單。與夏以甯完成需求確認後，討論串會出現在這裡。</div>';
        return;
      }
      list.innerHTML = data.tickets.map(function (t) {
        return '<div class="card ticket-card" data-tid="' + escapeHtml(t.id) + '">' +
          '<div class="ticket-head"><span class="tag">' + kindLabel(t.kind) + "</span>" +
          '<span class="ticket-time">' + fmtTime(t.updated) + "</span></div>" +
          "<p>" + escapeHtml(t.preview || "（尚無內容）") + "</p>" +
          '<div class="ticket-count">' + t.message_count + " 則留言</div></div>";
      }).join("");
      list.querySelectorAll(".ticket-card").forEach(function (c) {
        c.addEventListener("click", function () { showTicketDetail(c.dataset.tid); });
      });
    } catch (e) {
      list.innerHTML = '<div class="empty-hint">收件夾載入失敗：' + escapeHtml(e.message) + "</div>";
    }
  }

  function renderThread(t) {
    if (!t.messages.length) {
      return '<div class="empty-hint">還沒有留言，顧問看到後會在這裡回覆。</div>';
    }
    return t.messages.map(function (m) {
      var who = m.from === "admin" ? (m.name || "管理者") + "（顧問）" : (m.name || "我");
      return '<div class="ticket-meta">' + escapeHtml(who) + "　" + fmtTime(m.ts) + "</div>" +
        '<div class="ticket-msg ' + (m.from === "admin" ? "t-admin" : "t-member") + '">' +
        escapeHtml(m.content) + "</div>";
    }).join("");
  }

  async function showTicketDetail(tid) {
    clearInterval(inboxTimer);
    var list = el("ticket-list");
    list.innerHTML =
      '<button class="btn btn-ghost btn-small" id="btn-inbox-back" type="button">← 回收件夾</button>' +
      '<div class="card" style="margin-top:12px"><h2 id="ticket-kind">需求單</h2>' +
      '<div class="ticket-summary" id="ticket-summary"></div></div>' +
      '<div class="card"><h2>討論串（每 5 秒自動更新）</h2><div id="ticket-thread"></div>' +
      '<div class="reply-row"><textarea id="reply-input" rows="3" placeholder="輸入留言，與顧問討論"></textarea></div>' +
      '<button class="btn btn-primary btn-small" id="btn-reply" type="button">送出留言</button>' +
      '<div class="form-msg" id="reply-msg"></div></div>';
    el("btn-inbox-back").addEventListener("click", showInboxList);

    async function refresh() {
      try {
        var d = await api("/api/tickets/" + tid);
        el("ticket-kind").textContent = kindLabel(d.ticket.kind);
        el("ticket-summary").textContent = d.ticket.summary || "";
        el("ticket-thread").innerHTML = renderThread(d.ticket);
      } catch (e) { /* 輪詢失敗，下一輪再試 */ }
    }
    await refresh();
    inboxTimer = setInterval(refresh, 5000);

    el("btn-reply").addEventListener("click", async function () {
      var input = el("reply-input");
      var msgEl = el("reply-msg");
      var content = input.value.trim();
      if (!content) return;
      try {
        await api("/api/tickets/" + tid + "/messages", { method: "POST", body: { content: content } });
        input.value = "";
        msgEl.textContent = "已送出。";
        msgEl.className = "form-msg ok";
        refresh();
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = "form-msg err";
      }
    });
  }

  // ---------- 啟動 ----------

  async function boot() {
    var page = document.body.getAttribute("data-page");
    try {
      state.cfg = await api("/api/config");
    } catch (e) {
      showBanner("後端服務離線中：登入、對話與作品清單暫時無法使用");
    }
    if (token()) {
      try {
        var data = await api("/api/me");
        state.me = data.me;
      } catch (e) {
        if (e.status === 401) setToken("");
      }
    }
    renderAuthArea();
    applyAvatar();
    renderAdminLink();
    if (page === "index") initIndex();
    if (page === "account") initAccount();
    if (page === "inbox") initInbox();
    document.addEventListener("fde:login", function () {
      if (page === "account") location.reload();
      if (page === "inbox") location.reload();
    });
    document.dispatchEvent(new CustomEvent("fde:ready"));
  }

  // 供 chat.js 使用的共用接縫
  window.FDE = {
    api: api,
    apiBase: API_BASE,
    token: token,
    state: state,
    notice: notice,
    escapeHtml: escapeHtml,
    assetUrl: assetUrl,
  };

  window.addEventListener("DOMContentLoaded", boot);
})();
