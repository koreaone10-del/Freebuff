// ============================================================================
// CHIBANI AI — الحساب المحلي وربط الخدمات.
// الحساب: هوية على هذا المتصفح فقط (بريد أو هاتف + رمز سري مُشتقّ بـ PBKDF2).
// الربط: رموز يملكها المستخدم، تُخزَّن محلياً وتُمرَّر عند الطلب إلى المزوّد.
// لا يوجد أي مفتاح أو سرّ مكتوب في هذا الملف.
// ============================================================================
(function () {
  "use strict";

  const CB = (window.CB = window.CB || {});
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const LS_ACCT = "chibani_account_v1";
  const LS_SESS = "chibani_session_v1";
  const LS_CONN = "chibani_conn_v1";

  const enc = new TextEncoder();

  function b64(bytes) {
    let s = "";
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return btoa(s);
  }
  function unb64(str) {
    const raw = atob(str);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function randomSalt() {
    const b = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
    return b64(b);
  }

  async function derive(pass, saltB64) {
    if (window.crypto && window.crypto.subtle && window.isSecureContext !== false) {
      try {
        const key = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"]);
        const bits = await crypto.subtle.deriveBits(
          { name: "PBKDF2", salt: unb64(saltB64), iterations: 150000, hash: "SHA-256" },
          key,
          256
        );
        return "pbkdf2$" + b64(bits);
      } catch (_) { /* يسقط إلى البديل */ }
    }
    // بديل لسياق غير آمن (http): بصمة بسيطة، مع تنبيه صريح للمستخدم
    let h1 = 0x811c9dc5, h2 = 0x1000193;
    const s = pass + "|" + saltB64;
    for (let i = 0; i < s.length; i++) {
      h1 = ((h1 ^ s.charCodeAt(i)) * 16777619) >>> 0;
      h2 = ((h2 + s.charCodeAt(i) * (i + 7)) ^ (h2 << 5)) >>> 0;
    }
    return "weak$" + h1.toString(36) + h2.toString(36);
  }

  function readJSON(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key) || "null");
      return v == null ? fallback : v;
    } catch (_) { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { CB.toast("تعذّر الحفظ في هذا المتصفح"); }
  }

  function normalizePhone(p) {
    return String(p || "").replace(/[\s\-().]/g, "");
  }
  function normalizeEmail(e) {
    return String(e || "").trim().toLowerCase();
  }
  function validEmail(e) {
    return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(e);
  }
  function validPhone(p) {
    return /^\+?\d{8,15}$/.test(p);
  }
  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "؟";
    return (parts[0].charAt(0) + (parts[1] ? parts[1].charAt(0) : "")).toUpperCase();
  }

  /* ------------------------------- الحساب -------------------------------- */
  const Account = {
    current() {
      const acct = readJSON(LS_ACCT, null);
      const sess = readJSON(LS_SESS, null);
      if (!acct || !sess) return null;
      if (!sess.until || sess.until < Date.now()) return null;
      return acct;
    },
    renderChip() {
      const acct = Account.current();
      const name = $("#acctName"), sub = $("#acctSub"), av = $("#acctAv");
      if (!name || !sub || !av) return;
      if (acct) {
        name.textContent = acct.name || "حسابي";
        sub.textContent = acct.email || acct.phone || "حساب محلي";
        av.textContent = initials(acct.name);
      } else {
        name.textContent = "زائر";
        sub.textContent = "سجّل ببريدك أو رقمك — مجاناً";
        av.textContent = "👤";
      }
      if (CB.chat) CB.chat.rerender();
    },
    open() {
      const acct = Account.current();
      const guest = $("#acctGuest"), prof = $("#acctProfile");
      if (acct) {
        guest.classList.add("hidden");
        prof.classList.remove("hidden");
        $("#acctBigName").textContent = acct.name || "حسابي";
        $("#acctBigEmail").textContent = acct.email || acct.phone || "";
        $("#acctBigAv").textContent = initials(acct.name);
        const since = new Date(acct.createdAt || Date.now());
        $("#acctBigSince").textContent = "عضو منذ " + since.toLocaleDateString("ar", { year: "numeric", month: "long", day: "numeric" });
        const sessions = (CB.state && CB.state.sessions) || [];
        const msgs = sessions.reduce((n, s) => n + (s.messages ? s.messages.length : 0), 0);
        const days = Math.max(1, Math.round((Date.now() - (acct.createdAt || Date.now())) / 86400000));
        $("#acctStats").innerHTML =
          '<div class="stat"><b>' + sessions.length + "</b><span>محادثة</span></div>" +
          '<div class="stat"><b>' + msgs + "</b><span>رسالة</span></div>" +
          '<div class="stat"><b>' + days + "</b><span>يوم معنا</span></div>";
      } else {
        guest.classList.remove("hidden");
        prof.classList.add("hidden");
        setTab("register");
        const err = $("#acctErr");
        if (err) { err.textContent = ""; err.classList.remove("ok"); }
        ["acctNameIn", "acctEmail", "acctPhone", "acctPass", "acctPass2"].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.value = "";
        });
      }
      CB.openOverlay("accountOverlay");
    }
  };

  let tab = "register";

  function setTab(t) {
    tab = t;
    $$("#acctTabs .sm").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
    const nameLbl = $("#acctNameLbl"), nameIn = $("#acctNameIn"), pass2 = $("#acctPass2Wrap"), submit = $("#acctSubmit");
    if (nameLbl) nameLbl.classList.toggle("hidden", t === "login");
    if (nameIn) nameIn.classList.toggle("hidden", t === "login");
    if (pass2) pass2.classList.toggle("hidden", t === "login");
    if (submit) submit.textContent = t === "login" ? "دخول" : "إنشاء الحساب";
    const err = $("#acctErr");
    if (err) { err.textContent = ""; err.classList.remove("ok"); }
  }

  function showErr(msg, ok) {
    const el = $("#acctErr");
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle("ok", !!ok);
  }

  async function submit() {
    const name = ($("#acctNameIn") || {}).value || "";
    const email = normalizeEmail(($("#acctEmail") || {}).value || "");
    const phone = normalizePhone(($("#acctPhone") || {}).value || "");
    const pass = ($("#acctPass") || {}).value || "";
    const pass2 = ($("#acctPass2") || {}).value || "";
    const submitBtn = $("#acctSubmit");
    if (submitBtn) submitBtn.disabled = true;

    try {
      if (!email && !phone) { showErr("أدخل بريداً إلكترونياً أو رقم هاتف واحداً على الأقل."); return; }
      if (email && !validEmail(email)) { showErr("صيغة البريد الإلكتروني غير صحيحة."); return; }
      if (phone && !validPhone(phone)) { showErr("رقم الهاتف يجب أن يتكون من 8 إلى 15 رقماً، مع + إن أردت."); return; }
      if (pass.length < 6) { showErr("الرمز السري يجب أن يكون 6 أحرف على الأقل."); return; }
      if (tab === "register" && pass !== pass2) { showErr("الرمز السري وتأكيده غير متطابقين."); return; }

      const stored = readJSON(LS_ACCT, null);

      if (tab === "register") {
        if (stored && ((email && normalizeEmail(stored.email) === email) || (phone && normalizePhone(stored.phone) === phone))) {
          showErr("يوجد حساب بهذه البيانات على هذا المتصفح — استخدم تبويب «دخول»، أو احذف بيانات المتصفح لبدء حساب جديد.");
          return;
        }
        const salt = randomSalt();
        const hash = await derive(pass, salt);
        const acct = {
          id: "u_" + Date.now().toString(36),
          name: name.trim() || (email ? email.split("@")[0] : phone),
          email: email,
          phone: phone,
          salt: salt,
          hash: hash,
          createdAt: Date.now()
        };
        writeJSON(LS_ACCT, acct);
        writeJSON(LS_SESS, { id: acct.id, until: Date.now() + 30 * 86400000 });
        showErr("تم إنشاء الحساب بنجاح ✓", true);
      } else {
        if (!stored) { showErr("لا يوجد حساب محفوظ على هذا المتصفح — أنشئ حساباً جديداً أولاً."); return; }
        const match = (!!email && normalizeEmail(stored.email) === email) || (!!phone && normalizePhone(stored.phone) === phone);
        if (!match) { showErr("بيانات الدخول لا تطابق الحساب المحفوظ."); return; }
        const hash = await derive(pass, stored.salt);
        if (hash !== stored.hash) { showErr("الرمز السري غير صحيح."); return; }
        writeJSON(LS_SESS, { id: stored.id, until: Date.now() + 30 * 86400000 });
        showErr("مرحباً بعودتك ✓", true);
      }

      if (stored && stored.hash && stored.hash.startsWith("weak$")) {
        CB.toast("تنبيه: هذا السياق غير مشفّر (http) فالتخزين أضعف من المعتاد.", 5000);
      }
      Account.renderChip();
      setTimeout(() => { Account.open(); CB.toast("تم تسجيل الدخول — حسابك محلي على هذا المتصفح"); }, 350);
    } catch (e) {
      showErr("تعذّر إكمال العملية: " + (e.message || "خطأ غير معروف"));
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function logout() {
    try { localStorage.removeItem(LS_SESS); } catch (_) {}
    Account.renderChip();
    Account.open();
    CB.toast("تم تسجيل الخروج — بيانات حسابك باقية على هذا المتصفح");
  }

  /* ------------------------------ الموصلات -------------------------------- */
  const SERVICES = {
    github: {
      label: "GitHub",
      verify: { path: "/user" },
      extras: [
        { name: "repos", path: "/user/repos", query: { sort: "updated", per_page: "6", affiliation: "owner" } }
      ],
      render(tok, me, extra) {
        const repos = (extra && extra.repos) || [];
        return '<span>مرحباً <b>' + CB.esc(me.login || me.name || "") + "</b></span>" +
          (me.public_repos != null ? '<span>· مستودعات عامة: ' + me.public_repos + "</span>" : "") +
          '<span>· <a class="tag" href="https://github.com/' + encodeURIComponent(me.login || "") + '" target="_blank" rel="noopener">فتح الحساب ↗</a></span>' +
          (repos.length ? repos.map((r) => '<a class="tag" href="' + CB.esc(r.html_url) + '" target="_blank" rel="noopener">📦 ' + CB.esc(r.name) + "</a>").join("") : '<span>· لا مستودعات حديثة</span>');
      }
    },
    render: {
      label: "Render",
      verify: { path: "/services", query: { limit: "10" } },
      extras: [],
      render(tok, data) {
        const list = Array.isArray(data) ? data : (data && data.services) || [];
        if (!list.length) return "<span>الحساب مربوط، ولا توجد خدمات ظاهرة بعد.</span>";
        return '<span>الخدمات: ' + list.length + "</span>" + list.map((item) => {
          const s = item.service || item;
          const name = s.name || "خدمة";
          const state = (s.suspended && s.suspended !== "not_suspended") ? "موقوفة" : "نشطة";
          return '<a class="tag" href="https://dashboard.render.com/web/' + encodeURIComponent(s.id || "") + '" target="_blank" rel="noopener">🚀 ' + CB.esc(name) + " · " + state + "</a>";
        }).join("");
      }
    },
    facebook: {
      label: "Facebook",
      verify: { path: "/me", query: { fields: "id,name" } },
      extras: [{ name: "pages", path: "/me/accounts", query: { fields: "id,name,category" } }],
      render(tok, me, extra) {
        const pages = (extra && extra.pages && extra.pages.data) || [];
        return '<span>مرحباً <b>' + CB.esc(me.name || "") + "</b></span>" +
          (pages.length ? pages.map((p) => '<a class="tag" href="https://facebook.com/' + encodeURIComponent(p.id) + '" target="_blank" rel="noopener">📘 ' + CB.esc(p.name) + "</a>").join("") : "<span>· لا صفحات ظاهرة لهذا الرمز</span>");
      }
    }
  };

  const Conn = {
    data() { return readJSON(LS_CONN, {}); },
    token(svc) { return (Conn.data()[svc] || {}).token || ""; },
    set(svc, token) {
      const d = Conn.data();
      d[svc] = { token: token, at: Date.now() };
      writeJSON(LS_CONN, d);
    },
    drop(svc) {
      const d = Conn.data();
      delete d[svc];
      writeJSON(LS_CONN, d);
    },
    async call(svc, path, method, query) {
      const token = Conn.token(svc);
      if (!token) throw new Error("اربط الخدمة أولاً");
      const j = await CB.api("/api/connect", {
        method: "POST",
        headers: { "content-type": "application/json", "x-cb-token": token },
        body: JSON.stringify({ service: svc, path: path, method: method || "GET", query: query || {} })
      });
      if (!j || !j.ok) {
        const msg = (j && j.error) || "رفض المزوّد الطلب";
        throw new Error(String(msg).slice(0, 220));
      }
      return j.data;
    }
  };

  function setState(svc, ok, text) {
    const el = document.getElementById("connState" + svc.charAt(0).toUpperCase() + svc.slice(1));
    if (!el) return;
    el.classList.toggle("ok", !!ok);
    el.classList.toggle("bad", !ok && !!text && text !== "غير مربوط");
    el.textContent = text || (ok ? "مربوط ✓" : "غير مربوط");
  }

  function setOut(svc, html) {
    const el = document.getElementById("connOut" + svc.charAt(0).toUpperCase() + svc.slice(1));
    if (el) el.innerHTML = html;
  }

  async function connectSvc(svc) {
    const input = document.getElementById("connTok" + svc.charAt(0).toUpperCase() + svc.slice(1));
    const token = input ? input.value.trim() : "";
    if (!token) { CB.toast("ألصق رمز الوصول أولاً"); return; }
    setState(svc, false, "جارٍ التحقق…");
    setOut(svc, "<span>أتحقق من الرمز…</span>");
    Conn.set(svc, token);
    try {
      const def = SERVICES[svc];
      const me = await Conn.call(svc, def.verify.path, "GET", def.verify.query);
      let extra = null;
      if (def.extras.length) {
        const results = await Promise.all(def.extras.map((e) => Conn.call(svc, e.path, "GET", e.query).catch(() => null)));
        extra = {};
        def.extras.forEach((e, i) => { extra[e.name] = results[i]; });
      }
      setState(svc, true, "مربوط ✓");
      setOut(svc, def.render(token, me, extra));
      if (input) input.value = "";
      CB.toast("تم ربط " + def.label);
    } catch (e) {
      Conn.drop(svc);
      setState(svc, false, "فشل التحقق");
      setOut(svc, '<span class="err">' + CB.esc(e.message || "تعذّر الاتصال") + "</span>");
    }
  }

  function dropSvc(svc) {
    Conn.drop(svc);
    setState(svc, false, "غير مربوط");
    setOut(svc, "<span>تم قطع الربط وحُذف الرمز من هذا المتصفح.</span>");
    const input = document.getElementById("connTok" + svc.charAt(0).toUpperCase() + svc.slice(1));
    if (input) input.value = "";
    CB.toast("تم قطع الربط");
  }

  async function refreshSvc(svc) {
    if (!Conn.token(svc)) return;
    try {
      const def = SERVICES[svc];
      const me = await Conn.call(svc, def.verify.path, "GET", def.verify.query);
      let extra = null;
      if (def.extras.length) {
        const results = await Promise.all(def.extras.map((e) => Conn.call(svc, e.path, "GET", e.query).catch(() => null)));
        extra = {};
        def.extras.forEach((e, i) => { extra[e.name] = results[i]; });
      }
      setState(svc, true, "مربوط ✓");
      setOut(svc, def.render(Conn.token(svc), me, extra));
    } catch (_) {
      setState(svc, false, "انتهت الصلاحية");
      setOut(svc, '<span class="err">الرمز لم يعد صالحاً — ألصق رمزاً جديداً.</span>');
    }
  }

  /* -------------------------------- الإقلاع -------------------------------- */
  let inited = false;
  function init() {
    if (inited) return;
    inited = true;
    const tabs = $("#acctTabs");
    if (tabs) tabs.addEventListener("click", (e) => {
      const b = e.target.closest(".sm");
      if (b) setTab(b.dataset.tab);
    });
    const submitBtn = $("#acctSubmit");
    if (submitBtn) submitBtn.addEventListener("click", submit);
    const cancel = $("#acctCancel");
    if (cancel) cancel.addEventListener("click", () => CB.closeOverlay("accountOverlay"));
    const done = $("#acctDone");
    if (done) done.addEventListener("click", () => CB.closeOverlay("accountOverlay"));
    const logoutBtn = $("#acctLogout");
    if (logoutBtn) logoutBtn.addEventListener("click", logout);
    const form = $("#acctForm");
    if (form) form.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });

    const list = $("#connList");
    if (list) list.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const svc = b.dataset.svc;
      if (b.dataset.act === "save") connectSvc(svc);
      else dropSvc(svc);
    });
    const closeBtn = $("#connClose");
    if (closeBtn) closeBtn.addEventListener("click", () => CB.closeOverlay("connectOverlay"));

    Object.keys(SERVICES).forEach((svc) => {
      if (Conn.token(svc)) setState(svc, true, "مربوط ✓");
    });
    Account.renderChip();
  }

  CB.account = {
    init: init,
    open: () => Account.open(),
    current: () => Account.current(),
    renderChip: () => Account.renderChip(),
    logout: logout
  };
  CB.connect = {
    init: init,
    open: () => {
      Object.keys(SERVICES).forEach((svc) => { if (Conn.token(svc)) refreshSvc(svc); });
      CB.openOverlay("connectOverlay");
    },
    call: (svc, path, method, query) => Conn.call(svc, path, method, query),
    token: (svc) => Conn.token(svc)
  };
})();
