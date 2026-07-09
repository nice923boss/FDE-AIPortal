/* 夏以甯對話窗：右下角頭像常駐每頁，經後端代理串流（原生 JS）。
   關閉對話窗 = 標記本場結束；再點頭像 = 開新對話（PLAN §4 工程機制）。 */
(function () {
  "use strict";

  var F = window.FDE;
  if (!F) return;

  var conv = null;        // 本場對話 {id}
  var streaming = false;
  var ui = {};

  function avatarSrc() {
    return F.state.cfg && F.state.cfg.xia_avatar
      ? F.assetUrl(F.state.cfg.xia_avatar)
      : "assets/xia-avatar.svg";
  }

  function authHeaders(extra) {
    var h = extra || {};
    var t = F.token();
    if (t) h["Authorization"] = "Bearer " + t;
    return h;
  }

  // ---------- DOM ----------

  function buildDom() {
    var fab = document.createElement("button");
    fab.id = "xia-fab";
    fab.type = "button";
    fab.setAttribute("aria-label", "與夏以甯對話");
    fab.innerHTML = '<img src="' + F.escapeHtml(avatarSrc()) + '" alt="夏以甯">';
    fab.addEventListener("click", openPanel);

    var panel = document.createElement("div");
    panel.id = "xia-panel";
    panel.style.display = "none";
    panel.innerHTML =
      '<div class="xia-head">' +
      '<img src="' + F.escapeHtml(avatarSrc()) + '" alt="">' +
      '<div class="t"><b>夏以甯</b><span>AI 需求引導顧問</span></div>' +
      '<button id="xia-close" type="button" aria-label="關閉並結束本場對話">✕</button></div>' +
      '<div class="xia-body" id="xia-body"></div>' +
      '<div class="xia-ticket-bar" id="xia-ticket-bar" style="display:none">' +
      '<button id="xia-ticket-btn" type="button">確認送出需求單</button></div>' +
      '<div class="xia-foot">' +
      '<textarea id="xia-input" rows="2" placeholder="輸入訊息，Enter 送出"></textarea>' +
      '<button id="xia-send" type="button">送出</button></div>';

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    ui.fab = fab;
    ui.panel = panel;
    ui.body = panel.querySelector("#xia-body");
    ui.input = panel.querySelector("#xia-input");
    ui.send = panel.querySelector("#xia-send");
    ui.ticketBar = panel.querySelector("#xia-ticket-bar");
    ui.ticketBtn = panel.querySelector("#xia-ticket-btn");

    panel.querySelector("#xia-close").addEventListener("click", closePanel);
    ui.ticketBtn.addEventListener("click", submitTicket);
    ui.send.addEventListener("click", sendMessage);
    ui.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
  }

  function scrollBottom() { ui.body.scrollTop = ui.body.scrollHeight; }

  function appendBubble(role, text) {
    var d = document.createElement("div");
    d.className = "xia-msg " + role;
    d.textContent = text;
    ui.body.appendChild(d);
    scrollBottom();
    return d;
  }

  function appendSystem(text) {
    var d = document.createElement("div");
    d.className = "xia-msg system";
    d.textContent = text;
    ui.body.appendChild(d);
    scrollBottom();
  }

  var thinkEl = null;
  function showThinking() {
    if (thinkEl) return;
    thinkEl = document.createElement("div");
    thinkEl.className = "xia-think";
    thinkEl.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span> 夏以甯思考中';
    ui.body.appendChild(thinkEl);
    scrollBottom();
  }
  function hideThinking() {
    if (thinkEl) { thinkEl.remove(); thinkEl = null; }
  }

  function setComposer(enabled) {
    ui.input.disabled = !enabled;
    ui.send.disabled = !enabled;
  }

  function renderGate(text, btnLabel, btnHref) {
    ui.body.innerHTML = "";
    var g = document.createElement("div");
    g.className = "xia-gate";
    g.innerHTML = '<img src="' + F.escapeHtml(avatarSrc()) + '" alt="">' +
      "<p>" + F.escapeHtml(text) + "</p>" +
      (btnLabel ? '<a class="btn btn-primary btn-small" href="' + F.escapeHtml(btnHref) + '">' + F.escapeHtml(btnLabel) + "</a>" : "");
    ui.body.appendChild(g);
    setComposer(false);
  }

  // ---------- 需求單送出（PLAN §4：按鈕觸發，不靠關鍵字判讀送出） ----------

  function showTicketBar() {
    ui.ticketBtn.disabled = false;
    ui.ticketBar.style.display = "";
  }
  function hideTicketBar() { ui.ticketBar.style.display = "none"; }

  async function submitTicket() {
    if (!conv) return;
    ui.ticketBtn.disabled = true;
    try {
      await F.api("/api/tickets", { method: "POST", body: { conversation_id: conv.id } });
      hideTicketBar();
      appendSystem("需求單已送出！顧問黃政文會在「我的收件夾」的討論串與你聯繫。");
    } catch (e) {
      if (e.status === 409) {
        hideTicketBar();
        appendSystem(e.message);
      } else {
        ui.ticketBtn.disabled = false;
        appendSystem("送出失敗：" + e.message);
      }
    }
  }

  // ---------- 對話生命週期 ----------

  function openPanel() {
    ui.fab.style.display = "none";
    ui.panel.style.display = "flex";
    var me = F.state.me;
    if (!F.state.cfg) {
      renderGate("後端服務離線中，暫時無法與夏以甯對話，稍後再試。");
    } else if (!me) {
      renderGate("請先用右上角「使用 Google 帳戶登入」，登入後就能與夏以甯開始盤點。");
    } else if (!me.can_chat) {
      renderGate("目前無法使用，請聯絡管理者。");
    } else if (!me.has_key) {
      renderGate("與夏以甯對話需要你自己的 NVIDIA API Key（免費申請），設定一次即可。",
        "前往帳號設定", "account.html");
    } else if (!conv) {
      startConversation();
    }
  }

  async function startConversation() {
    ui.body.innerHTML = "";
    hideTicketBar();
    setComposer(false);
    showThinking();
    try {
      var d = await F.api("/api/chat/start", { method: "POST" });
      hideThinking();
      conv = d.conversation;
      conv.messages.forEach(function (m) { appendBubble(m.role, m.content); });
      setComposer(true);
      ui.input.focus();
    } catch (e) {
      hideThinking();
      renderGate(e.message);
    }
  }

  function closeConversation(useKeepalive) {
    if (!conv || !conv.id) return;
    var cid = conv.id;
    conv = null;
    try {
      fetch(F.apiBase + "/api/chat/close", {
        method: "POST",
        keepalive: !!useKeepalive,
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ conversation_id: cid }),
      });
    } catch (e) { /* 結束標記失敗不影響使用 */ }
  }

  function closePanel() {
    closeConversation(false);
    ui.panel.style.display = "none";
    ui.fab.style.display = "";
    ui.body.innerHTML = "";
    hideTicketBar();
    setComposer(true);
  }

  // ---------- 送出與串流 ----------

  async function sendMessage() {
    if (streaming || !conv) return;
    var text = ui.input.value.trim();
    if (!text) return;
    ui.input.value = "";
    appendBubble("user", text);
    streaming = true;
    setComposer(false);
    showThinking();
    try {
      var resp = await fetch(F.apiBase + "/api/chat/send", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ conversation_id: conv.id, message: text }),
      });
      if (!resp.ok) {
        var data = null;
        try { data = await resp.json(); } catch (e2) { /* 非 JSON */ }
        throw new Error(data && data.error ? data.error : "HTTP " + resp.status);
      }
      var bubble = null;
      var reader = resp.body.getReader();
      var dec = new TextDecoder();
      var buf = "";
      while (true) {
        var r = await reader.read();
        if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        var idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          var line = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (line.lastIndexOf("data:", 0) !== 0) continue;
          var ev;
          try { ev = JSON.parse(line.slice(5)); } catch (e3) { continue; }
          if (ev.t === "c") {
            hideThinking();
            if (!bubble) bubble = appendBubble("assistant", "");
            bubble.textContent += ev.v;
            scrollBottom();
          } else if (ev.t === "err") {
            hideThinking();
            appendSystem(ev.v);
          }
          // "r"（思考增量）維持思考中動畫；"done" 由迴圈自然結束
        }
      }
      // 彙整完成 → 顯示確認送出按鈕（送出本身仍由按鈕觸發）
      if (bubble && bubble.textContent.indexOf("需求彙整完成") >= 0) showTicketBar();
    } catch (e) {
      appendSystem("送出失敗：" + e.message);
    } finally {
      hideThinking();
      streaming = false;
      if (conv) { setComposer(true); ui.input.focus(); }
    }
  }

  // ---------- 啟動 ----------

  document.addEventListener("fde:ready", function () {
    buildDom();
  });
  document.addEventListener("fde:open-chat", function () {
    if (ui.fab) openPanel();
  });
  document.addEventListener("fde:login", function () {
    // 面板開著且尚未成場（先前卡在請先登入），登入後直接重跑閘門
    if (ui.panel && ui.panel.style.display !== "none" && !conv) openPanel();
  });
  window.addEventListener("pagehide", function () {
    closeConversation(true);  // 跳頁視同關閉：keepalive 送出結束標記
  });
})();
