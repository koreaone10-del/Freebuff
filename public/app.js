// ============================================================================
// CHIBANI AI — النواة: دردشة، بحث، تحليل مواقع، صور، أدوات، جلسات، إعدادات.
// كل شيء يعمل في المتصفح بلا مفاتيح: الطلبات تمرّ إلى /api/* على خادمك فقط.
// ============================================================================
(function () {
  "use strict";

  const CB = (window.CB = window.CB || {});
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtSize = (b) => (b < 1024 ? b + " بايت" : b < 1048576 ? (b / 1024).toFixed(1) + " ك.ب" : (b / 1048576).toFixed(2) + " م.ب");
  const estTokens = (t) => Math.round(String(t || "").length / 3.1);
  const maxChars = (s, n) => { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) : s; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function toast(msg, ms) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms || 2900);
  }

  /* ---------------------------- تخزين الجلسات ---------------------------- */
  const LS_SESSIONS = "chibani_sessions_v1";
  const Store = {
    db: null,
    async open() {
      return new Promise((res) => {
        try {
          const r = indexedDB.open("chibani_ai", 2);
          r.onupgradeneeded = () => {
            const d = r.result;
            if (!d.objectStoreNames.contains("sessions")) d.createObjectStore("sessions", { keyPath: "id" });
          };
          r.onsuccess = () => { Store.db = r.result; res(true); };
          r.onerror = () => res(false);
          r.onblocked = () => res(false);
        } catch (_) { res(false); }
      });
    },
    localAll() {
      try { return JSON.parse(localStorage.getItem(LS_SESSIONS) || "[]"); } catch (_) { return []; }
    },
    localSet(arr) {
      try { localStorage.setItem(LS_SESSIONS, JSON.stringify(arr)); } catch (_) {}
    },
    async all() {
      if (!Store.db) return Store.localAll();
      return new Promise((res) => {
        try {
          const tx = Store.db.transaction("sessions", "readonly");
          const q = tx.objectStore("sessions").getAll();
          q.onsuccess = () => res(q.result || []);
          q.onerror = () => res(Store.localAll());
        } catch (_) { res(Store.localAll()); }
      });
    },
    async put(s) {
      const clean = JSON.parse(JSON.stringify(s));
      if (!Store.db) {
        const arr = Store.localAll().filter((x) => x.id !== clean.id);
        arr.push(clean);
        Store.localSet(arr);
        return;
      }
      await new Promise((res) => {
        try {
          const tx = Store.db.transaction("sessions", "readwrite");
          tx.objectStore("sessions").put(clean);
          tx.oncomplete = res;
          tx.onerror = res;
        } catch (_) { res(); }
      });
    },
    async del(id) {
      if (!Store.db) { Store.localSet(Store.localAll().filter((x) => x.id !== id)); return; }
      await new Promise((res) => {
        try {
          const tx = Store.db.transaction("sessions", "readwrite");
          tx.objectStore("sessions").delete(id);
          tx.oncomplete = res;
          tx.onerror = res;
        } catch (_) { res(); }
      });
    },
    async clear() {
      Store.localSet([]);
      if (!Store.db) return;
      await new Promise((res) => {
        try {
          const tx = Store.db.transaction("sessions", "readwrite");
          tx.objectStore("sessions").clear();
          tx.oncomplete = res;
          tx.onerror = res;
        } catch (_) { res(); }
      });
    }
  };

  /* ------------------------------- الحالة -------------------------------- */
  const S = {
    sessions: [],
    activeId: null,
    attachments: [],
    mode: "chat",
    busy: false,
    models: [{ id: "auto", name: "تلقائي (توزيع ذكي)" }],
    health: [],
    ctrl: null
  };

  const DEFAULT_SETTINGS = { systemPrompt: "", persona: "", accent: "violet", model: "auto", skill: "", fast: true };
  let settings = Object.assign({}, DEFAULT_SETTINGS);

  /* ------------------------------ المعرفة -------------------------------- */
  const SKILLS = {
    programming: {
      icon: "👨‍💻", label: "برمجة",
      brief: "أكواد نظيفة، شرح المعمارية، وتتبّع الأخطاء خطوة بخطوة.",
      system: "أنت خبير هندسة برمجيات عالمي. أجب بكود عملي نظيف قابل للتشغيل، واشرح المعمارية والبدائل والحدود، وبيّن الأخطاء المحتملة وطريقة اختبارها، واذكر ما لا يمكن الجزم به."
    },
    analysis: {
      icon: "📊", label: "تحليل",
      brief: "تفكيك المشكلة، مقارنة الخيارات، وخلاصة قابلة للتنفيذ.",
      system: "أنت محلّل بيانات ومفكّر نقدي. قسّم الإجابة إلى: نظرة عامة، الوقائع والأرقام، تحليل السبب، نقاط القوة والضعف، تقييم مرقّم، ثم خلاصة عملية. صرّح بما ينقص من معطيات بدل تخمينه."
    },
    teaching: {
      icon: "🎓", label: "تعليم",
      brief: "شرح مبسّط بأمثلة، وأسئلة تثبّت الفهم.",
      system: "أنت مدرّس صبور متقن. ابدأ بتعريف بسيط، ثم مثال محلول، ثم تعميق تدريجي، واختم بسؤالين قصيرين للتحقق من الفهم ومصدر واحد للقراءة الإضافية. تجنّب الحشو."
    },
    business: {
      icon: "💼", label: "أعمال",
      brief: "جدوى، تكلفة، خطة تنفيذ، ومؤشرات قياس.",
      system: "أنت مستشار أعمال تنفيذي. أعطِ: السوق والجمهور، عرض القيمة، نموذج الإيراد والتكلفة التقديرية، خطة تنفيذ مرقّمة بجدول زمني، المخاطر وسبل تخفيفها، ومؤشرات قياس نجاح رقمية."
    }
  };

  const PERSONAS = {
    "": "",
    code: "تفضيل إضافي: أمثلة الكود بلغة صحيحة قابلة للنسخ، وشرح مختصر بعدها.",
    analy: "تفضيل إضافي: استخدم بنية تحليلية واضحة وأرقاماً ومقارنات حيث أمكن.",
    write: "تفضيل إضافي: اكتب نصاً عربياً فصيحاً بأسلوب واضح وجذّاب يناسب الجمهور المطلوب.",
    tutor: "تفضيل إضافي: اشرح بأمثلة يومية بسيطة، وتحقق من الفهم بأسئلة قصيرة.",
    biz: "تفضيل إضافي: ركّز على الجدوى والتكلفة وخطوات التنفيذ القابلة للقياس."
  };

  const DEFAULT_SYSTEM = "أنت «CHIBANI»، مساعد ذكاء اصطناعي دقيق وعملي. أجب بالعربية الفصحى الواضحة، ونظّم الرد بعناوين ونقاط عند الحاجة، وضع الشيفرة في صناديق كود. إن لم تكن متأكداً من معلومة فصرّح بذلك بوضوح ولا تختلقها، واذكر المصادر عند الاعتماد على بحث.";

  /* --------------------------- أدوات مساعدة ----------------------------- */
  const mdReady = () => typeof window.marked !== "undefined" && typeof window.DOMPurify !== "undefined";

  try {
    if (window.marked && window.marked.setOptions) window.marked.setOptions({ breaks: true, gfm: true });
  } catch (_) {}

  function renderMD(src) {
    const text = String(src == null ? "" : src);
    if (!mdReady()) return esc(text).replace(/\n/g, "<br>");
    try {
      const html = window.marked.parse(text);
      return window.DOMPurify.sanitize(html, { ADD_ATTR: ["target"] }).replace(/<a /g, '<a target="_blank" rel="noopener" ');
    } catch (_) {
      return esc(text).replace(/\n/g, "<br>");
    }
  }

  async function api(path, opts) {
    const res = await fetch(path, opts);
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "خطأ " + res.status);
      return j;
    }
    if (!res.ok) throw new Error("خطأ " + res.status);
    return res;
  }

  /* ------------------------------ الجلسات ------------------------------- */
  function activeSession() {
    return S.sessions.find((s) => s.id === S.activeId) || null;
  }

  function newSession() {
    const s = { id: uid(), title: "", createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    S.sessions.unshift(s);
    S.activeId = s.id;
    // جلسة جديدة = أدوات جديدة: لا تُورَّث أداة الجلسة السابقة ولا مرفقاتها
    resetTools();
    renderSessions();
    renderChat();
    Store.put(s);
    if ($("#input")) $("#input").focus();
    return s;
  }

  function saveSession(s) {
    if (!s) return;
    s.updatedAt = Date.now();
    Store.put(s);
  }

  function userInitial() {
    const a = CB.account && CB.account.current ? CB.account.current() : null;
    const name = (a && a.name) || "أ";
    return name.trim().charAt(0) || "أ";
  }

  function welcomeHTML() {
    const chips = [
      { t: "اشرح الذكاء الاصطناعي التوليدي في خمسة أسطر", i: "💡" },
      { t: "خطة إطلاق منتج جديد في 30 يوماً", i: "🚀" },
      { t: "لخّص هذا الرابط وأهم ثلاث فرص فيه: https://example.com", i: "🌐" },
      { t: "صورة لمدينة عائمة فوق السحاب عند الغروب", i: "🎨" }
    ];
    return '<div class="welcome">' +
      '<div class="hero-logo">✦</div>' +
      '<h2>CHIBANI AI</h2>' +
      '<p>منصّة واحدة لكل ما تحتاجه: محادثة بتفكير عميق، بحث موثّق بالمصادر، تحليل المواقع والملفات، وتوليد الصور والفيديو والصوت — مجاناً بالكامل، بلا مفاتيح ولا تسجيل إجباري.</p>' +
      '<div class="skills" id="skills">' +
      Object.keys(SKILLS).map((id) => {
        const sk = SKILLS[id];
        return '<button class="skill" data-skill="' + id + '" type="button"><b>' + sk.icon + " " + esc(sk.label) + "</b><span>" + esc(sk.brief) + "</span></button>";
      }).join("") +
      "</div>" +
      '<div class="chips">' +
      chips.map((c) => '<button class="chip" data-prompt="' + esc(c.t) + '" type="button">' + c.i + " " + esc(maxChars(c.t, 46)) + "</button>").join("") +
      "</div>" +
      '<div class="feat"><span>🔒 بياناتك في متصفحك</span><span>⚡ بلا مفاتيح</span><span>🌍 أربع شبكات مجانية</span><span>🎬 إنتاج فيديو كامل</span></div>' +
      "</div>";
  }

  function bindWelcome() {
    const host = $("#skills");
    if (host) {
      $$(".skill", host).forEach((b) => {
        b.classList.toggle("on", b.dataset.skill === settings.skill);
        b.addEventListener("click", () => applySkills(b.dataset.skill));
      });
    }
    $$(".chip[data-prompt]").forEach((b) => {
      b.addEventListener("click", () => {
        const input = $("#input");
        input.value = b.dataset.prompt;
        autoGrow();
        updateCtx();
        input.focus();
      });
    });
  }

  function applySkills(id) {
    if (!id || !SKILLS[id]) return;
    settings.skill = settings.skill === id ? "" : id;
    saveSettings();
    $$(".skill").forEach((b) => b.classList.toggle("on", b.dataset.skill === settings.skill));
    updateCtx();
    const sk = SKILLS[settings.skill];
    toast(sk ? "تم تفعيل مجال «" + sk.label + "» — سيُطبَّق على الردود القادمة" : "تم إلغاء تفعيل المجال");
    if ($("#input")) $("#input").focus();
  }

  function skillSystem() {
    const sk = SKILLS[settings.skill];
    return sk ? sk.system : "";
  }

  function systemPrompt() {
    return [skillSystem(), PERSONAS[settings.persona] || "", settings.systemPrompt || "", DEFAULT_SYSTEM]
      .filter(Boolean).join("\n\n");
  }

  /* ---------------------------- عرض الرسائل ----------------------------- */
  function fileStrip(files) {
    if (!files || !files.length) return "";
    return '<div class="filestrip">' + files.map((f) => {
      const icon = f.kind === "image" ? "🖼️" : f.kind === "audio" ? "🎧" : f.kind === "pdf" ? "📕" : f.kind === "doc" ? "📄" : f.kind === "sheet" ? "📊" : f.kind === "zip" ? "🗜️" : "📎";
      return '<div class="fitem"><div class="ic">' + icon + '</div><div class="meta"><b>' + esc(f.name) + "</b><span>" + fmtSize(f.size || 0) + "</span></div></div>";
    }).join("") + "</div>";
  }

  function videoBox(v) {
    if (!v) return "";
    if (v.lost) {
      return '<div class="genvid"><div class="gvmeta"><b>' + esc(v.title || "فيديو مولّد") + "</b><span>الفيديو كان في الذاكرة فقط وانتهى بإغلاق التبويب — أعد إنتاجه من زر «فيديو».</span></div></div>";
    }
    return '<div class="genvid"><video src="' + esc(v.url) + '" controls playsinline preload="metadata"></video>' +
      '<div class="gvmeta"><b>' + esc(v.title || "فيديو مولّد") + "</b><span>" + esc(v.meta || "") + "</span></div>" +
      (v.marks && v.marks.length ? '<div class="vd-final-bar"><span class="vd-mark-label">فهرس المشاهد — انقر للانتقال</span>' + v.marks.map((m, i) =>
        '<button class="vd-mark" data-t="' + m.start.toFixed(2) + '"><span class="vd-mark-dot"></span>المشهد ' + (i + 1) + ' <span class="vd-mark-time">' + clock(m.start) + "</span></button>").join("") + "</div>" : "") +
      "</div>";
  }

  function clock(sec) {
    const s = Math.max(0, Math.round(sec));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  function imageBox(m) {
    return '<div class="genimg" data-prompt="' + esc(m.prompt || "") + '">' +
      '<a href="' + esc(m.img) + '" target="_blank" rel="noopener" title="تكبير"><img src="' + esc(m.img) + '" alt="' + esc(m.prompt || "صورة مولّدة") + '" loading="lazy" /></a>' +
      '<div class="imgbar"><a href="' + esc(m.img) + '" download="chibani.png">⬇ تحميل</a>' +
      '<button type="button" data-img-more="1">🔄 نسخة أخرى</button></div></div>';
  }

  function createMsg(m) {
    const wrap = document.createElement("div");
    wrap.className = "msg " + (m.role === "user" ? "user" : "ai");
    wrap.dataset.mid = m.id;
    const who = m.role === "user"
      ? '<span>أنت</span>'
      : '<span>CHIBANI AI</span>' + (m.provider ? '<span class="prov">' + esc(m.provider) + "</span>" : "") + (m.skill && SKILLS[m.skill] ? '<span class="tag-skill">' + SKILLS[m.skill].icon + " " + esc(SKILLS[m.skill].label) + "</span>" : "");
    wrap.innerHTML = '<div class="avatar">' + (m.role === "user" ? esc(userInitial()) : "✦") + '</div>' +
      '<div class="body"><div class="who">' + who + '</div><div class="bubble"></div><div class="msg-tools"></div></div>';
    const bubble = wrap.querySelector(".bubble");
    fillBubble(bubble, m);
    const tools = wrap.querySelector(".msg-tools");
    if (m.role === "ai" && (m.text || m.img || m.video)) {
      const cp = document.createElement("button");
      cp.className = "mini-btn";
      cp.textContent = "⧉ نسخ";
      cp.addEventListener("click", () => copyText(m.text || m.prompt || ""));
      tools.appendChild(cp);
      if (m.text) {
        const view = document.createElement("button");
        view.className = "mini-btn";
        view.textContent = "⤢ عرض كامل";
        view.addEventListener("click", () => openViewer("رد CHIBANI AI", renderMD(m.text)));
        tools.appendChild(view);
        const sp = document.createElement("button");
        sp.className = "mini-btn";
        sp.textContent = "🔊 استمع";
        sp.addEventListener("click", () => speak(m.text));
        tools.appendChild(sp);
      }
    }
    return { wrap, bubble };
  }

  function fillBubble(bubble, m) {
    if (m.role === "user") {
      bubble.innerHTML = fileStrip(m.files) + '<div style="white-space:pre-wrap">' + esc(m.text) + "</div>";
      return;
    }
    bubble.innerHTML = (m.reasoning ? '<details class="reason"><summary>🧠 التفكير الداخلي</summary><div class="rc">' + esc(m.reasoning) + "</div></details>" : "") +
      (m.video ? videoBox(m.video) : "") +
      (m.img ? imageBox(m) : "") +
      (m.text ? '<div class="ans">' + renderMD(m.text) + "</div>" : "");
    decorate(bubble);
    if (m.video && m.video.marks && m.video.marks.length) {
      setSideIndex(bubble.querySelector("video"), m.video.marks);
    }
  }

  function decorate(root) {
    $$("pre code", root).forEach((code) => {
      if (window.hljs && !code.dataset.hl) {
        code.dataset.hl = "1";
        try { window.hljs.highlightElement(code); } catch (_) {}
      }
    });
    $$("pre", root).forEach((pre) => {
      if (pre.parentElement && pre.parentElement.classList.contains("codewrap")) return;
      const wrap = document.createElement("div");
      wrap.className = "codewrap";
      const head = document.createElement("div");
      head.className = "codehead";
      const code = pre.querySelector("code");
      const cls = (code && code.className) || "";
      const lang = (cls.match(/language-([\w+#-]+)/) || [])[1] || "code";
      head.innerHTML = "<span>" + esc(lang) + "</span>";
      const btn = document.createElement("button");
      btn.className = "cp";
      btn.textContent = "نسخ";
      btn.addEventListener("click", () => copyText(pre.innerText));
      head.appendChild(btn);
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(head);
      wrap.appendChild(pre);
    });
    $$(".genimg img", root).forEach((img) => {
      img.addEventListener("click", (e) => {
        e.preventDefault();
        const lb = $("#lightbox"), li = $("#lightboxImg");
        if (lb && li) { li.src = img.src; lb.classList.add("open"); }
      });
    });
    $$("[data-img-more]", root).forEach((btn) => {
      btn.addEventListener("click", () => {
        const box = btn.closest(".genimg");
        const prompt = (box && box.dataset.prompt) || "";
        if (prompt) runImage(prompt, { seed: Math.floor(Math.random() * 1e6) });
      });
    });
    $$(".genimg .imgbar a[download]", root).forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const href = a.getAttribute("href");
        fetch(href).then((r) => r.blob()).then((b) => {
          const url = URL.createObjectURL(b);
          const a2 = document.createElement("a");
          a2.href = url;
          a2.download = "chibani-" + Date.now() + ".png";
          a2.click();
          setTimeout(() => URL.revokeObjectURL(url), 4000);
        }).catch(() => window.open(href, "_blank", "noopener"));
      });
    });
    $$(".genvid video", root).forEach((v) => {
      const box = v.closest(".genvid");
      if (!box) return;
      $$(".vd-mark", box).forEach((b) => {
        b.addEventListener("click", () => { v.currentTime = Number(b.dataset.t) || 0; v.play().catch(() => {}); });
      });
      const list = $$(".vd-mark", box);
      v.addEventListener("timeupdate", () => {
        const t = v.currentTime;
        list.forEach((b, i) => {
          const start = Number(b.dataset.t) || 0;
          const end = i + 1 < list.length ? Number(list[i + 1].dataset.t) : Infinity;
          b.classList.toggle("on", t >= start && t < end);
        });
        $$("#sideIndex .si-item").forEach((b, i) => {
          const start = Number(b.dataset.t) || 0;
          const end = i + 1 < list.length ? Number(list[i + 1].dataset.t) : Infinity;
          b.classList.toggle("on", t >= start && t < end);
        });
      });
    });
  }

  function setSideIndex(video, marks) {
    const host = $("#sideIndex");
    if (!host) return;
    if (!marks || !marks.length || !video) {
      host.classList.remove("on");
      host.innerHTML = "";
      return;
    }
    host.classList.add("on");
    host.innerHTML = '<div class="si-head">🎞️ فهرس المشاهد <span>' + marks.length + " مشاهد</span></div>" +
      marks.map((m, i) => '<button class="si-item" data-t="' + Number(m.start || 0).toFixed(2) + '"><b>' + (i + 1) + "</b>" + clock(m.start) + "</button>").join("");
    $$(".si-item", host).forEach((b) => b.addEventListener("click", () => {
      video.currentTime = Number(b.dataset.t) || 0;
      video.play().catch(() => {});
      closeSide();
    }));
  }

  function scrollBot(force) {
    const chat = $("#chat");
    if (!chat) return;
    const near = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 260;
    if (force || near) chat.scrollTop = chat.scrollHeight;
  }

  function renderChat() {
    const col = $("#chatCol");
    if (!col) return;
    const s = activeSession();
    col.innerHTML = "";
    if (!s || !s.messages.length) {
      col.innerHTML = welcomeHTML();
      bindWelcome();
      return;
    }
    s.messages.forEach((m) => col.appendChild(createMsg(m).wrap));
    scrollBot(true);
  }

  function renderSessions() {
    const box = $("#sessList");
    if (!box) return;
    const q = (($("#sessSearch") || {}).value || "").trim().toLowerCase();
    const list = S.sessions
      .slice()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .filter((s) => !q || (s.title || "").toLowerCase().includes(q) || s.messages.some((m) => (m.text || "").toLowerCase().includes(q)));
    box.innerHTML = "";
    if (!list.length) {
      box.innerHTML = '<div style="color:var(--muted);font-size:11.5px;text-align:center;padding:18px 8px">لا توجد محادثة مطابقة</div>';
      return;
    }
    list.forEach((s) => {
      const row = document.createElement("div");
      row.className = "sess" + (s.id === S.activeId ? " active" : "");
      row.innerHTML = '<span class="t">' + esc(s.title || "محادثة جديدة") + '</span><button class="x" title="حذف">✕</button>';
      row.addEventListener("click", () => {
        S.activeId = s.id;
        renderChat();
        renderSessions();
        closeSide();
      });
      row.querySelector(".x").addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm("حذف هذه المحادثة نهائياً؟")) return;
        await Store.del(s.id);
        S.sessions = S.sessions.filter((x) => x.id !== s.id);
        if (S.activeId === s.id) {
          S.activeId = null;
          if (S.sessions.length) S.activeId = S.sessions[0].id;
          renderChat();
        }
        renderSessions();
      });
      box.appendChild(row);
    });
  }

  function addMessage(m, opts) {
    const s = activeSession() || newSession();
    m.id = m.id || uid();
    m.at = m.at || Date.now();
    s.messages.push(m);
    s.updatedAt = Date.now();
    if (!s.title && m.role === "user" && m.text) s.title = maxChars(m.text.replace(/\s+/g, " ").trim(), 44);
    const col = $("#chatCol");
    if (col.querySelector(".welcome")) col.innerHTML = "";
    const node = createMsg(m);
    col.appendChild(node.wrap);
    scrollBot(true);
    if (!opts || !opts.skipSave) saveSession(s);
    renderSessions();
    return node;
  }

  function deliver(text, extra) {
    return addMessage(Object.assign({ role: "ai", text: text }, extra || {}));
  }

  function copyText(t) {
    const txt = String(t || "");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(() => toast("تم النسخ"), () => toast("تعذّر النسخ"));
    } else {
      const ta = document.createElement("textarea");
      ta.value = txt;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); toast("تم النسخ"); } catch (_) { toast("تعذّر النسخ"); }
      ta.remove();
    }
  }

  /* ----------------------------- بناء السياق ----------------------------- */
  function historyMessages(excludeId) {
    const s = activeSession();
    if (!s) return [];
    const list = s.messages
      .filter((m) => m.role === "user" || (m.role === "ai" && m.text))
      .filter((m) => m.id !== excludeId);
    const out = [];
    let budget = 18000; // ميزانية أحرف آمنة للسياق حتى لا يتجاوز النموذج حدّه
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      const text = maxChars(m.text || "", 6000);
      if (text.length > budget) break;
      budget -= text.length;
      out.unshift({ role: m.role === "user" ? "user" : "assistant", content: text });
      if (out.length >= 12) break;
    }
    return out;
  }

  function speak(text) {
    const clean = String(text || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[#*_>`~\[\]()|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) { toast("لا يوجد نص صالح للنطق"); return; }
    const url = "/api/tts?text=" + encodeURIComponent(maxChars(clean, 700)) + "&lang=ar";
    const audio = new Audio(url);
    audio.play().catch(() => toast("تعذّر تشغيل النطق — الخدمة المجانية مزدحمة، أعد المحاولة", 3200));
  }

  /* ------------------------------ البثّ ---------------------------------- */
  async function streamChat(payload, node, msg, ansEl) {
    // الوضع السريع افتراضياً: نماذج خفيفة + سقف رموز أقل، ويمكن تعطيله من الإعدادات
    payload.fast = settings.fast !== false;
    if (payload.fast && payload.max_tokens) payload.max_tokens = Math.min(payload.max_tokens, 1400);
    S.ctrl = new AbortController();
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: S.ctrl.signal
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || "خطأ " + res.status);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let paintAt = 0;
    const paint = (force) => {
      if (!force && Date.now() - paintAt < 80) return;
      paintAt = Date.now();
      ansEl.innerHTML = renderMD(msg.text);
      if (msg.reasoning) {
        let det = node.bubble.querySelector(".reason .rc");
        if (!det) {
          node.bubble.insertAdjacentHTML("afterbegin", '<details class="reason" open><summary>🧠 التفكير الداخلي</summary><div class="rc"></div></details>');
          det = node.bubble.querySelector(".reason .rc");
        }
        if (det) det.textContent = msg.reasoning;
      }
      scrollBot(false);
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() || "";
      for (const part of parts) {
        for (const line of part.split("\n")) {
          const t = line.replace(/^data:\s*/, "").trim();
          if (!t || t === "[DONE]") continue;
          let ev;
          try { ev = JSON.parse(t); } catch (_) { continue; }
          if (ev.type === "meta") {
            msg.provider = [ev.provider, ev.model].filter(Boolean).join(" · ");
            const prov = node.wrap.querySelector(".who .prov");
            if (prov) prov.textContent = msg.provider;
            else node.wrap.querySelector(".who").insertAdjacentHTML("beforeend", '<span class="prov">' + esc(msg.provider) + "</span>");
          } else if (ev.type === "reason") {
            msg.reasoning = (msg.reasoning || "") + ev.text;
            paint(false);
          } else if (ev.type === "delta") {
            msg.text += ev.text;
            paint(false);
          } else if (ev.type === "error") {
            msg.text += (msg.text ? "\n\n" : "") + "⚠️ " + ev.text;
          }
        }
      }
    }
    paint(true);
    if (!msg.text.trim() && !msg.reasoning) msg.text = "لم يصل نص من المزوّد. أعد المحاولة بعد لحظات.";
    ansEl.innerHTML = renderMD(msg.text);
    decorate(node.bubble);
    return msg;
  }

  async function runChat(content, opts) {
    const o = opts || {};
    const msg = { id: uid(), role: "ai", text: "", reasoning: "", provider: "", skill: settings.skill, at: Date.now() };
    const node = addMessage(msg, { skipSave: true });
    const ans = document.createElement("div");
    ans.className = "ans";
    ans.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    node.bubble.appendChild(ans);
    const messages = o.selfContained
      ? [{ role: "system", content: o.system || systemPrompt() }, { role: "user", content: content }]
      : [{ role: "system", content: o.system || systemPrompt() }].concat(historyMessages(msg.id), [{ role: "user", content: content }]);
    try {
      await streamChat({
        model: settings.model,
        messages: messages,
        stream: true,
        temperature: typeof o.temperature === "number" ? o.temperature : 0.7,
        max_tokens: o.maxTokens || 2600
      }, node, msg, ans);
    } catch (e) {
      if (e.name === "AbortError") {
        msg.text = msg.text || "أُوقف التوليد.";
        ans.innerHTML = renderMD(msg.text) + '<div style="color:var(--muted);font-size:11px;margin-top:6px">أُوقف البثّ.</div>';
      } else {
        msg.text = "⚠️ " + (e.message || "تعذّر الاتصال بالمزوّد") + "\n\nجرّب مرة أخرى، أو اختر نموذجاً آخر من القائمة أعلى الصفحة.";
        ans.innerHTML = renderMD(msg.text);
      }
    } finally {
      S.ctrl = null;
      saveSession(activeSession());
      renderSessions();
    }
    return msg;
  }

  /* ------------------------------- الأوضاع ------------------------------- */
  function stepsCard(labels) {
    const box = document.createElement("div");
    box.className = "step-card";
    box.innerHTML = labels.map((l, i) => '<div class="sline" data-i="' + i + '"><span class="si">' + (i + 1) + "</span><span>" + esc(l) + "</span></div>").join("");
    return {
      el: box,
      mark(i, done) {
        const row = box.querySelector('[data-i="' + i + '"]');
        if (!row) return;
        row.classList.toggle("act", !done);
        row.classList.toggle("done", !!done);
        if (done) row.querySelector(".si").textContent = "✓";
      }
    };
  }

  async function runResearch(query) {
    const msg = { id: uid(), role: "ai", text: "", provider: "", at: Date.now() };
    const node = addMessage(msg, { skipSave: true });
    const steps = stepsCard(["صياغة الاستعلام", "البحث في الويب", "قراءة أفضل المصادر", "صياغة الإجابة مع الاستشهادات"]);
    node.bubble.appendChild(steps.el);
    const ans = document.createElement("div");
    ans.className = "ans";
    node.bubble.appendChild(ans);
    steps.mark(0, true);

    let results = [];
    try {
      steps.mark(1);
      const j = await api("/api/search?q=" + encodeURIComponent(query));
      results = (j.results || []).slice(0, 6);
      steps.mark(1, true);
    } catch (_) {}

    if (!results.length) {
      steps.el.innerHTML = '<div class="sline">⚠️ لم ينجح البحث الخارجي الآن — سأجيب من معرفتي وأصرّح بذلك.</div>';
      ans.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
      try {
        await streamChat({
          model: settings.model,
          stream: true,
          messages: [
            { role: "system", content: systemPrompt() + "\n\nملاحظة: تعذّر البحث في الويب الآن. أجب من معرفتك واذكر بوضوح أن الإجابة غير موثّقة بمصادر حيّة." },
            { role: "user", content: query }
          ]
        }, node, msg, ans);
      } catch (e) { msg.text = "⚠️ " + e.message; ans.innerHTML = renderMD(msg.text); }
      saveSession(activeSession());
      return;
    }

    steps.mark(2);
    const picks = results.slice(0, 3);
    const pages = await Promise.all(picks.map((r) =>
      api("/api/fetchurl?url=" + encodeURIComponent(r.url)).then((p) => p.text || "").catch(() => "")
    ));
    steps.mark(2, true);

    const corpus = picks.map((r, i) =>
      "[" + (i + 1) + "] " + r.title + "\n" + r.url + "\n" + maxChars(pages[i] || r.snippet || "(لم تُقرأ الصفحة)", 4200)
    ).join("\n\n---\n\n");

    steps.mark(3);
    ans.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    try {
      await streamChat({
        model: settings.model,
        stream: true,
        temperature: 0.45,
        max_tokens: 3000,
        messages: [
          { role: "system", content: systemPrompt() + "\n\nأنت باحث دقيق. اعتمد على المصادر المرفقة فقط في الوقائع، واستشهد برقم المصدر بين قوسين مثل [1]. إن لم تجد المعلومة في المصادر فقل ذلك صراحة. نظّم الإجابة بعناوين، واختم بـ «ما لم تُغطّه المصادر»." },
          { role: "user", content: "سؤال البحث: " + query + "\n\nالمصادر:\n" + corpus }
        ]
      }, node, msg, ans);
    } catch (e) {
      msg.text = "⚠️ " + e.message;
      ans.innerHTML = renderMD(msg.text);
    }
    steps.mark(3, true);

    const src = document.createElement("div");
    src.className = "sources";
    src.innerHTML = results.map((r, i) =>
      '<a href="' + esc(r.url) + '" target="_blank" rel="noopener"><span class="n">[' + (i + 1) + "]</span><span>" + esc(maxChars(r.title, 90)) + "</span></a>"
    ).join("");
    node.bubble.appendChild(src);
    saveSession(activeSession());
  }

  async function runSite(text) {
    const url = (String(text).match(/https?:\/\/[^\s<>"']+/) || [])[0];
    if (!url) {
      deliver("أرسل رابط الموقع كاملاً (يبدأ بـ https://) وسأقرأه وأحلّله: الهدف، الجمهور، البنية، التقنية، ونقاط التحسين.");
      return;
    }
    const msg = { id: uid(), role: "ai", text: "", provider: "", at: Date.now() };
    const node = addMessage(msg, { skipSave: true });
    const steps = stepsCard(["قراءة صفحة الموقع", "تحليل البنية والمحتوى", "صياغة التقرير"]);
    node.bubble.appendChild(steps.el);
    const ans = document.createElement("div");
    ans.className = "ans";
    node.bubble.appendChild(ans);
    steps.mark(0);
    let page;
    try {
      page = await api("/api/fetchurl?url=" + encodeURIComponent(url));
      steps.mark(0, true);
    } catch (e) {
      steps.el.innerHTML = '<div class="sline">⚠️ ' + esc(e.message) + "</div>";
      saveSession(activeSession());
      return;
    }
    steps.mark(1, true);
    steps.mark(2);
    ans.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    try {
      await streamChat({
        model: settings.model,
        stream: true,
        temperature: 0.5,
        max_tokens: 2800,
        messages: [
          { role: "system", content: systemPrompt() + "\n\nأنت محلّل مواقع ومنتجات. حلّل النص المستخرج من الصفحة وأعطِ: 1) ما هو الموقع ولمن. 2) محتواه الأساسي. 3) البنية والتقنية إن ظهرت آثارها. 4) نقاط القوة. 5) نقاط الضعف والفرص. 6) ثلاث توصيات عملية مرتّبة بالأثر. لا تخترع معلومات غير موجودة في النص." },
          { role: "user", content: "الرابط: " + url + "\n\nالنص المستخرج:\n" + maxChars(page.text || "", 12000) }
        ]
      }, node, msg, ans);
    } catch (e) {
      msg.text = "⚠️ " + e.message;
      ans.innerHTML = renderMD(msg.text);
    }
    steps.mark(2, true);
    saveSession(activeSession());
  }

  /* --------------------------- محرّك الصور ----------------------------- */
  // AI Horde شبكة مفتوحة من وحدات GPU التطوعية؛ طلب مجهول بلا مفتاح مستخدم، مع انتظار حسب الطابور.
  const IMG_ENGINES = { auto: "AI Horde — تلقائي", horde: "AI Horde" };
  const ENGINE_KEY = "cb.imgsrc";

  function imageEngine() {
    try {
      const v = localStorage.getItem(ENGINE_KEY);
      if (v && IMG_ENGINES[v]) return v;
    } catch (_) {}
    return "auto";
  }

  function setImageEngine(v) {
    if (!IMG_ENGINES[v]) return;
    try { localStorage.setItem(ENGINE_KEY, v); } catch (_) {}
    $$("#imgEngine [data-engine]").forEach((b) => b.classList.toggle("on", b.dataset.engine === v));
  }

  function imageURL(prompt, opt) {
    const o = opt || {};
    const q = new URLSearchParams({
      prompt: prompt,
      width: String(o.w || 1024),
      height: String(o.h || 1024),
      seed: String(o.seed == null ? Math.floor(Math.random() * 1e6) : o.seed),
      provider: imageEngine()
    });
    return "/api/image?" + q.toString();
  }

  function runImage(prompt, opt) {
    const p = String(prompt || "").trim();
    if (!p) { toast("اكتب وصف الصورة أولاً"); return; }
    const url = imageURL(p, opt);
    const box = document.createElement("div");
    box.className = "genimg";
    box.dataset.prompt = p;
    box.innerHTML = '<div class="shimmer"><div><div class="spin"></div><div class="gprog">إرسال الطلب إلى شبكة AI Horde…</div></div></div>';
    const img = new Image();
    img.alt = p;
    img.loading = "lazy";
    const timer = setInterval(() => {
      const g = box.querySelector(".gprog");
      if (g) g.textContent = "انتظار عامل GPU متطوّع على AI Horde…";
    }, 7000);
    img.onload = () => {
      clearInterval(timer);
      box.classList.add("loaded");
      box.innerHTML = '<a href="' + esc(url) + '" target="_blank" rel="noopener" title="تكبير"><img src="' + esc(url) + '" alt="' + esc(p) + '" /></a>' +
        '<div class="imgbar"><a href="' + esc(url) + '" download="chibani.png">⬇ تحميل</a><button type="button" data-img-more="1">🔄 نسخة أخرى</button></div>';
      decorate(box);
    };
    img.onerror = () => {
      clearInterval(timer);
      box.innerHTML = '<div class="errbox">تعذّر توليد الصورة الآن — شبكة AI Horde تعتمد على عمّال GPU متطوعين وقد يكون الطابور مزدحماً أو لا يوجد عامل مناسب.<br>أعد المحاولة لاحقاً أو جرّب وصفاً ومقاساً أبسط.</div><div class="imgbar"><button type="button" data-retry="1">↻ إعادة المحاولة</button></div>';
      const r = box.querySelector("[data-retry]");
      if (r) r.addEventListener("click", () => { const node = box.closest(".msg"); if (node) node.remove(); runImage(p, { seed: Math.floor(Math.random() * 1e6) }); });
    };
    img.src = url;

    const msg = { id: uid(), role: "ai", text: "", prompt: p, img: "", at: Date.now(), skill: settings.skill };
    const node = addMessage(msg, { skipSave: true });
    node.bubble.innerHTML = "";
    node.bubble.appendChild(box);
    const when = setInterval(() => {
      if (box.classList.contains("loaded")) {
        clearInterval(when);
        msg.img = url;
        msg.text = "صورة مولّدة بالذكاء الاصطناعي — " + p;
        decorate(node.bubble);
        saveSession(activeSession());
      }
    }, 350);
    setTimeout(() => clearInterval(when), 120000);
  }

  function runTools() {
    const wrap = document.createElement("div");
    wrap.className = "msg ai";
    wrap.className = "msg ai toolsmsg";
    wrap.innerHTML = '<div class="avatar">🛠️</div><div class="body"><div class="who"><span>أدوات CHIBANI الحيّة</span></div><div class="bubble"><div class="tools">' +
      '<textarea class="toolText" placeholder="ألصق نصاً أو JSON أو رابطاً هنا..."></textarea>' +
      '<div class="tools-grid">' +
      '<button class="tool-btn" data-tool="json">🎛️ تنسيق JSON</button>' +
      '<button class="tool-btn" data-tool="b64">🔐 Base64 ترميز</button>' +
      '<button class="tool-btn" data-tool="unb64">🔓 Base64 فك</button>' +
      '<button class="tool-btn" data-tool="url">🔗 URL ترميز</button>' +
      '<button class="tool-btn" data-tool="unurl">🔗 URL فك</button>' +
      '<button class="tool-btn" data-tool="links">📑 استخراج الروابط</button>' +
      '<button class="tool-btn" data-tool="count">🔢 عدّ الكلمات</button>' +
      '<button class="tool-btn" data-tool="md">📝 إلى Markdown</button>' +
      "</div>" +
      '<div class="row"><input class="toolUrl" placeholder="https://... اقرأ صفحة كاملة كنص" dir="ltr" /><button class="tool-btn" data-tool="fetch">📥 اقرأ</button></div>' +
      '<div class="row"><button class="tool-btn" data-tool="translate">🌍 ترجمة النص عبر النموذج</button></div>' +
      "</div></div></div>";
    const col = $("#chatCol");
    if (col.querySelector(".welcome")) col.innerHTML = "";
    $$(".msg.toolsmsg", col).forEach((n) => n.remove());
    col.appendChild(wrap);
    scrollBot(true);

    const ta = wrap.querySelector(".toolText");
    const out = (title, content) => {
      const html = renderMD("**" + title + "**\n\n```\n" + content + "\n```");
      openViewer(title, html);
      deliver("**" + title + "**\n\n```\n" + maxChars(content, 5000) + "\n```");
    };
    wrap.querySelectorAll("[data-tool]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const tool = btn.dataset.tool;
        const text = ta.value;
        try {
          if (tool === "json") out("JSON منسّق", JSON.stringify(JSON.parse(text), null, 2));
          else if (tool === "b64") out("Base64", btoa(unescape(encodeURIComponent(text))));
          else if (tool === "unb64") out("Base64 مفكوك", decodeURIComponent(escape(atob(text.trim()))));
          else if (tool === "url") out("URL مرمّز", encodeURIComponent(text));
          else if (tool === "unurl") out("URL مفكوك", decodeURIComponent(text));
          else if (tool === "links") out("الروابط", (text.match(/https?:\/\/[^\s<>"')]+/g) || []).join("\n") || "لا توجد روابط");
          else if (tool === "count") {
            const words = text.trim() ? text.trim().split(/\s+/).length : 0;
            out("إحصاء النص", "الكلمات: " + words + "\nالأحرف (مع المسافات): " + text.length + "\nالأحرف (بلا مسافات): " + text.replace(/\s/g, "").length + "\nالأسطر: " + text.split("\n").length);
          } else if (tool === "md") out("Markdown", text.replace(/^(.*)$/gm, (l) => (l.trim() ? "- " + l : "")));
          else if (tool === "fetch") {
            const u = wrap.querySelector(".toolUrl").value.trim();
            if (!u) { toast("ألصق رابطاً صالحاً"); return; }
            const page = await api("/api/fetchurl?url=" + encodeURIComponent(u));
            out("نص الصفحة — " + u, maxChars(page.text || "", 20000));
          } else if (tool === "translate") {
            if (!text.trim()) { toast("ألصق نصاً للترجمة"); return; }
            runChat("ترجم النص التالي ترجمة دقيقة محافظة على المعنى، واذكر اللغة الأصلية والهدف:\n\n" + maxChars(text, 6000), { temperature: 0.2 });
          }
        } catch (e) {
          toast(e.message || "تعذّرت العملية");
        }
      });
    });
  }

  /* ------------------------------ المرفقات ------------------------------- */
  const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonc|xml|yaml|yml|ini|conf|log|html?|css|js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|php|sql|sh|bash|zsh|c|h|cpp|hpp|cs|swift|lua|toml|env)$/i;

  async function extractPdf(file) {
    if (!window.pdfjsLib) throw new Error("مكتبة PDF غير محمّلة");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
    const buf = await file.arrayBuffer();
    const doc = await window.pdfjsLib.getDocument({ data: buf }).promise;
    const pages = Math.min(doc.numPages, 40);
    let out = "";
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      out += content.items.map((it) => it.str).join(" ") + "\n\n";
      if (out.length > 24000) break;
    }
    return "صفحات: " + doc.numPages + "\n\n" + maxChars(out, 24000);
  }

  async function readAsDataURL(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(new Error("تعذّر قراءة الملف"));
      fr.readAsDataURL(file);
    });
  }

  async function readAsText(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result || ""));
      fr.onerror = () => rej(new Error("تعذّر قراءة الملف"));
      fr.readAsText(file);
    });
  }

  async function addFiles(files) {
    for (const file of files) {
      if (S.attachments.length >= 6) { toast("الحد الأقصى 6 مرفقات في الرسالة"); break; }
      if (file.size > 24 * 1024 * 1024) { toast("«" + file.name + "» أكبر من 24 م.ب"); continue; }
      const item = { id: uid(), name: file.name, size: file.size, type: file.type, kind: "file", text: "", data: "" };
      const name = file.name.toLowerCase();
      try {
        if (/^image\//.test(file.type)) {
          if (file.size > 5 * 1024 * 1024) { toast("الصورة كبيرة — الحد 5 م.ب"); continue; }
          item.kind = "image";
          item.data = await readAsDataURL(file);
        } else if (/^audio\//.test(file.type)) {
          item.kind = "audio";
          item.data = await readAsDataURL(file);
        } else if (/^video\//.test(file.type)) {
          item.kind = "video";
          toast("تحليل الفيديو بالكامل غير مدعوم بعد — أرفق لقطة أو صف المحتوى");
          continue;
        } else if (/\.pdf$/i.test(name)) {
          item.kind = "pdf";
          item.text = await extractPdf(file);
        } else if (/\.(docx|doc)$/i.test(name)) {
          item.kind = "doc";
          if (!window.mammoth) throw new Error("مكتبة Word غير محمّلة");
          const buf = await file.arrayBuffer();
          const r = await window.mammoth.extractRawText({ arrayBuffer: buf });
          item.text = maxChars(r.value || "", 24000);
        } else if (/\.(xlsx|xls|csv)$/i.test(name)) {
          item.kind = "sheet";
          if (window.XLSX) {
            const buf = await file.arrayBuffer();
            const wb = window.XLSX.read(buf, { type: "array" });
            const parts = wb.SheetNames.slice(0, 4).map((n) => {
              const csv = window.XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false });
              return "# " + n + "\n" + csv;
            });
            item.text = maxChars(parts.join("\n\n"), 24000);
          } else {
            item.text = await readAsText(file);
          }
        } else if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) {
          item.kind = "zip";
          if (window.fflate && /\.zip$/i.test(name)) {
            const buf = new Uint8Array(await file.arrayBuffer());
            const list = window.fflate.unzipSync(buf);
            const names = Object.keys(list).slice(0, 120);
            item.text = "ملفات الأرشيف (" + Object.keys(list).length + "):\n" + names.join("\n");
          } else {
            item.text = "أرشيف: " + file.name + " — أرفق أحد ملفاته الداخلية لتحليله.";
          }
        } else if (TEXT_EXT.test(name) || /^text\//.test(file.type) || !file.type) {
          item.text = maxChars(await readAsText(file), 24000);
        } else {
          item.text = "ملف ثنائي (" + (file.type || "نوع غير معروف") + ") — لا يمكن قراءة محتواه كنص.";
        }
        S.attachments.push(item);
      } catch (e) {
        toast("تعذّر تجهيز «" + file.name + "»: " + e.message);
      }
    }
    renderAtt();
  }

  function renderAtt() {
    const box = $("#attList");
    if (!box) return;
    box.innerHTML = "";
    S.attachments.forEach((a) => {
      const el = document.createElement("div");
      el.className = "att";
      const icon = a.kind === "image" ? (a.data ? '<img src="' + a.data + '" alt="" />' : "🖼️") : a.kind === "audio" ? "🎧" : a.kind === "pdf" ? "📕" : a.kind === "doc" ? "📄" : a.kind === "sheet" ? "📊" : a.kind === "zip" ? "🗜️" : "📎";
      el.innerHTML = '<div class="thumb">' + icon + '</div><div class="ame"><b>' + esc(a.name) + "</b><span>" + fmtSize(a.size) + "</span></div><button class=\"rm\" title=\"إزالة\">✕</button>";
      el.querySelector(".rm").addEventListener("click", () => {
        S.attachments = S.attachments.filter((x) => x.id !== a.id);
        renderAtt();
      });
      box.appendChild(el);
    });
    updateCtx();
  }

  function updateCtx() {
    const box = $("#ctxInfo");
    if (!box) return;
    const text = ($("#input") || {}).value || "";
    const parts = [];
    if (settings.skill && SKILLS[settings.skill]) parts.push('<span class="on-skill">🎯 ' + esc(SKILLS[settings.skill].label) + "</span>");
    if (S.attachments.length) parts.push("📎 " + S.attachments.length + " مرفق");
    parts.push('الرموز <span dir="ltr">≈' + estTokens(text) + "</span>");
    box.innerHTML = parts.join(" · ");
  }

  async function enrich(text, files) {
    let content = text;
    const images = files.filter((f) => f.kind === "image" && f.data);
    if (images.length) {
      toast("أقرأ الصور المرفقة…", 4000);
      try {
        const j = await api("/api/vision", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question: "صف هذه الصورة (الصور) بالعربية بدقة: العناصر، النص الظاهر، الأسلوب، وأي تفاصيل مهمة. كن مختصراً ومحدداً.",
            images: images.map((i) => i.data)
          })
        });
        content += "\n\n[وصف الصور المرفقة من النموذج البصري]\n" + (j.content || "");
      } catch (e) {
        content += "\n\n[تعذّر تحليل الصور: " + e.message + "]";
      }
    }
    const audio = files.filter((f) => f.kind === "audio" && f.data);
    for (const a of audio) {
      toast("أفرّغ الملف الصوتي…", 4000);
      try {
        const j = await api("/api/audio", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ dataurl: a.data })
        });
        content += "\n\n[تفريغ صوتي — " + a.name + "]\n" + (j.text || "");
      } catch (e) {
        content += "\n\n[تعذّر تفريغ الصوت: " + e.message + "]";
      }
    }
    const docs = files.filter((f) => f.kind !== "image" && f.kind !== "audio" && f.text);
    for (const d of docs) {
      content += "\n\n[محتوى الملف: " + d.name + "]\n" + maxChars(d.text, 16000);
    }
    return content.trim() || "(مرفقات بلا نص قابل للقراءة)";
  }

  /* -------------------------------- الإرسال ------------------------------ */
  async function send() {
    if (S.busy) return;
    const input = $("#input");
    const text = input.value.trim();
    const files = S.attachments.slice();
    if (!text && !files.length) return;
    if (S.mode === "video") {
      const topic = text || (files.length ? "فيديو عن " + files.map((f) => f.name).join(", ") : "");
      if (!topic) { toast("اكتب موضوع الفيديو أولاً"); return; }
      input.value = "";
      autoGrow();
      updateCtx();
      if (CB.studio) CB.studio.open(topic);
      else toast("استوديو الفيديو غير محمّل");
      return;
    }
    if (S.mode === "handle" && !text) { runTools(); return; }

    const userMsg = {
      role: "user",
      text: text || "مرفقات: " + files.map((f) => f.name).join("، "),
      files: files.map((f) => ({ name: f.name, size: f.size, type: f.type, kind: f.kind }))
    };
    addMessage(userMsg);
    input.value = "";
    autoGrow();
    S.attachments = [];
    renderAtt();
    if (S.mode === "handle") { runTools(); return; }
    setBusy(true);
    try {
      if (S.mode === "img") {
        runImage(text || "صورة تعبيرية عن " + files.map((f) => f.name).join(" "));
        return;
      }
      const content = await enrich(text, files);
      if (S.mode === "research") { if (text) await runResearch(text); else await runChat(content); return; }
      if (S.mode === "site") { await runSite(text || content); return; }
      if (S.mode === "osint") { await runOSINT(text || content); return; }
      await runChat(content);
    } catch (e) {
      deliver("⚠️ " + (e.message || "حدث خطأ غير متوقع"));
    } finally {
      setBusy(false);
    }
  }

  function setBusy(v) {
    S.busy = v;
    const sendBtn = $("#btnSend"), stopBtn = $("#btnStop");
    if (sendBtn) sendBtn.disabled = v;
    if (stopBtn) stopBtn.style.display = v ? "grid" : "none";
  }

  function stopStream() {
    if (S.ctrl) { try { S.ctrl.abort(); } catch (_) {} S.ctrl = null; }
    if (CB.studio) CB.studio.cancel();
    setBusy(false);
    toast("تم الإيقاف");
  }

  /* ---------------------------- أدوات الواجهة ---------------------------- */
  function autoGrow() {
    const el = $("#input");
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(210, el.scrollHeight) + "px";
  }

  function closeSide() {
    const sb = $("#sidebar"), bd = $("#backdrop");
    if (sb) sb.classList.remove("open");
    if (bd) bd.classList.remove("open");
  }

  function setupMobile() {
    const btn = $("#btnSide"), bd = $("#backdrop"), sb = $("#sidebar");
    if (btn) btn.addEventListener("click", () => {
      const open = sb.classList.toggle("open");
      if (bd) bd.classList.toggle("open", open);
    });
    if (bd) bd.addEventListener("click", closeSide);
  }

  function openOverlay(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add("open");
  }

  function closeOverlay(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove("open");
  }

  function openViewer(title, html) {
    const v = $("#viewer");
    if (!v) return;
    $("#vTitle").textContent = title || "عرض";
    $("#vBody").innerHTML = html || "";
    v.classList.add("open");
    v.dataset.raw = html || "";
  }

  /* ------------------------------- النماذج ------------------------------- */
  async function loadModels() {
    try {
      const j = await api("/api/models");
      if (j.models && j.models.length) S.models = j.models;
    } catch (_) {}
    fillModelSelect();
  }

  function fillModelSelect() {
    const sel = $("#modelSel");
    if (!sel) return;
    sel.innerHTML = "";
    S.models.forEach((m) => {
      const o = document.createElement("option");
      o.value = m.id;
      o.textContent = m.name;
      sel.appendChild(o);
    });
    if (!S.models.some((m) => m.id === settings.model)) settings.model = "auto";
    sel.value = settings.model;
    sel.addEventListener("change", () => {
      settings.model = sel.value;
      saveSettings();
      toast("النموذج: " + sel.options[sel.selectedIndex].textContent, 1800);
    });
  }

  async function refreshHealth(silent) {
    try {
      const j = await api("/api/health");
      S.health = j.providers || [];
      const ready = S.health.filter((h) => h.status === "ready").length;
      const label = $("#healthLabel");
      if (label) {
        label.classList.toggle("cool", ready === 0);
        const b = label.querySelector("b");
        if (b) b.textContent = ready ? ready + " جاهز" : "انتظار";
        label.title = ready ? ready + " من " + S.health.length + " نموذجاً متاحاً الآن" : "كل النماذج في فترة تهدئة — أعد المحاولة بعد قليل";
      }
      renderProviders();
    } catch (_) {
      if (!silent) {
        const label = $("#healthLabel");
        if (label) { label.classList.add("cool"); const b = label.querySelector("b"); if (b) b.textContent = "غير متصل"; }
      }
    }
  }

  function renderProviders() {
    const box = $("#provList");
    if (!box) return;
    if (!S.health.length) { box.innerHTML = '<div class="prov-line"><span>جارٍ فحص المزوّدين…</span></div>'; return; }
    box.innerHTML = S.health.map((h) =>
      '<div class="prov-line"><div style="display:flex;align-items:center"><i class="' + (h.status === "ready" ? "ready" : "cooling") + '"></i><span>' + esc(h.label) + "</span></div>" +
      '<span class="free">' + (h.status === "ready" ? "متاح ✓" : "تهدئة · " + h.coolFor + "ث") + "</span></div>"
    ).join("");
  }

  /* ------------------------------ الإعدادات ------------------------------ */
  const LS_SETTINGS = "chibani_settings_v1";

  function loadSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_SETTINGS) || "{}");
      settings = Object.assign({}, DEFAULT_SETTINGS, raw);
      if (!SKILLS[settings.skill]) settings.skill = "";
    } catch (_) { settings = Object.assign({}, DEFAULT_SETTINGS); }
    applyAccent(settings.accent);
  }

  function saveSettings() {
    try { localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); } catch (_) {}
  }

  function applyAccent(a) {
    document.documentElement.setAttribute("data-accent", a || "violet");
  }

  function openSettings() {
    const ta = $("#setSystem");
    if (ta) ta.value = settings.systemPrompt || "";
    $$("#personaSeg .sm").forEach((b) => b.classList.toggle("on", (b.dataset.p || "") === (settings.persona || "")));
    $$("#speedSeg .sm").forEach((b) => b.classList.toggle("on", (b.dataset.fast === "0") !== (settings.fast !== false)));
    $$("#accentSeg .sm").forEach((b) => b.classList.toggle("on", (b.dataset.a || "") === (settings.accent || "violet")));
    renderProviders();
    refreshHealth(true);
    openOverlay("settingsOverlay");
  }

  /* ---------------------------- تصدير واستيراد --------------------------- */
  function exportData() {
    const payload = {
      app: "chibani-ai",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: settings,
      sessions: S.sessions
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "chibani-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast("تم تنزيل نسخة من محادثاتك وإعداداتك");
  }

  function importData() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".json,application/json";
    inp.addEventListener("change", async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      try {
        const j = JSON.parse(await f.text());
        if (!Array.isArray(j.sessions)) throw new Error("ملف غير صالح");
        for (const s of j.sessions) {
          if (!s || !s.id || !Array.isArray(s.messages)) continue;
          await Store.put(s);
          if (!S.sessions.some((x) => x.id === s.id)) S.sessions.push(s);
        }
        if (j.settings) { settings = Object.assign(settings, j.settings); saveSettings(); applyAccent(settings.accent); }
        renderSessions();
        renderChat();
        toast("تم استيراد " + j.sessions.length + " محادثة");
      } catch (e) {
        toast("تعذّر الاستيراد: " + e.message);
      }
    });
    inp.click();
  }

  async function clearAll() {
    if (!confirm("سيتم حذف كل المحادثات والإعدادات من هذا المتصفح. المتابعة؟")) return;
    await Store.clear();
    S.sessions = [];
    S.activeId = null;
    settings = Object.assign({}, DEFAULT_SETTINGS);
    localStorage.removeItem(LS_SETTINGS);
    applyAccent("violet");
    fillModelSelect();
    closeOverlay("settingsOverlay");
    newSession();
    toast("تم تصفير كل البيانات المحلية");
  }

  /* ------------------------------ الأحداث -------------------------------- */
  function bindUI() {
    const input = $("#input");
    if (input) {
      input.addEventListener("input", () => { autoGrow(); updateCtx(); });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          send();
        }
      });
      input.addEventListener("paste", (e) => {
        const items = Array.from((e.clipboardData && e.clipboardData.items) || []);
        const imgs = items.filter((it) => it.kind === "file" && /^image\//.test(it.type));
        if (imgs.length) {
          e.preventDefault();
          addFiles(imgs.map((it) => it.getAsFile()).filter(Boolean));
        }
      });
    }

    const sendBtn = $("#btnSend");
    if (sendBtn) sendBtn.addEventListener("click", send);
    const stopBtn = $("#btnStop");
    if (stopBtn) stopBtn.addEventListener("click", stopStream);

    const attach = $("#btnAttach"), fileInput = $("#fileInput");
    if (attach && fileInput) {
      attach.addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", () => {
        addFiles(Array.from(fileInput.files || []));
        fileInput.value = "";
      });
    }

    const mic = $("#btnMic");
    if (mic) mic.addEventListener("click", startDictation);

    const modebar = $("#modebar");
    if (modebar) {
      modebar.addEventListener("click", (e) => {
        const btn = e.target.closest(".mode-chip");
        if (!btn) return;
        if (btn.dataset.mode === "hub") {
          if (CB.hub) CB.hub.open("tools");
          else toast("مركز الأدوات غير محمّل بعد");
          return;
        }
        setMode(btn.dataset.mode);
      });
    }

    const engineBar = $("#imgEngine");
    if (engineBar) {
      setImageEngine(imageEngine());
      engineBar.addEventListener("click", (e) => {
        const b = e.target.closest("[data-engine]");
        if (!b) return;
        setImageEngine(b.dataset.engine);
        toast("محرّك الصور: " + IMG_ENGINES[b.dataset.engine]);
      });
    }

    const newBtn = $("#btnNew");
    if (newBtn) newBtn.addEventListener("click", () => { newSession(); closeSide(); });

    const sessSearch = $("#sessSearch");
    if (sessSearch) sessSearch.addEventListener("input", renderSessions);

    const bExport = $("#btnExport");
    if (bExport) bExport.addEventListener("click", exportData);
    const bImport = $("#btnImport");
    if (bImport) bImport.addEventListener("click", importData);
    const bSettings = $("#btnSettings");
    if (bSettings) bSettings.addEventListener("click", openSettings);
    const bConnect = $("#btnConnect");
    if (bConnect) bConnect.addEventListener("click", () => {
      if (CB.connect) CB.connect.open();
      else toast("وحدة الربط غير محمّلة");
    });
    const bAccount = $("#btnAccount");
    if (bAccount) bAccount.addEventListener("click", () => {
      if (CB.account) CB.account.open();
      else toast("وحدة الحساب غير محمّلة");
    });

    const health = $("#healthLabel");
    if (health) health.addEventListener("click", openSettings);

    const setSave = $("#btnSaveSettings");
    if (setSave) setSave.addEventListener("click", () => {
      const ta = $("#setSystem");
      settings.systemPrompt = ta ? ta.value.trim() : "";
      saveSettings();
      closeOverlay("settingsOverlay");
      toast("تم حفظ الإعدادات");
      updateCtx();
    });
    const clearBtn = $("#btnClearAll");
    if (clearBtn) clearBtn.addEventListener("click", clearAll);

    $$("#speedSeg .sm").forEach((b) => b.addEventListener("click", () => {
      settings.fast = b.dataset.fast !== "0";
      $$("#speedSeg .sm").forEach((x) => x.classList.toggle("on", x === b));
      saveSettings();
      toast(settings.fast ? "⚡ وضع الرد السريع مفعّل" : "🧠 وضع الرد العميق مفعّل");
    }));

    $$("#personaSeg .sm").forEach((b) => b.addEventListener("click", () => {
      settings.persona = b.dataset.p || "";
      $$("#personaSeg .sm").forEach((x) => x.classList.toggle("on", x === b));
      saveSettings();
      toast("الشخصية: " + b.textContent.trim(), 1800);
    }));
    $$("#accentSeg .sm").forEach((b) => b.addEventListener("click", () => {
      settings.accent = b.dataset.a || "violet";
      $$("#accentSeg .sm").forEach((x) => x.classList.toggle("on", x === b));
      applyAccent(settings.accent);
      saveSettings();
    }));

    $$(".overlay").forEach((ov) => {
      ov.addEventListener("mousedown", (e) => { if (e.target === ov) ov.classList.remove("open"); });
    });

    const vClose = $("#btnViewerClose");
    if (vClose) vClose.addEventListener("click", () => closeOverlay("viewer"));
    const vCopy = $("#btnViewerCopy");
    if (vCopy) vCopy.addEventListener("click", () => copyText($("#vBody").innerText));

    const lb = $("#lightbox");
    if (lb) lb.addEventListener("click", () => lb.classList.remove("open"));

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeOverlay("settingsOverlay");
        closeOverlay("viewer");
        closeOverlay("lightbox");
        closeOverlay("accountOverlay");
        closeOverlay("connectOverlay");
        closeOverlay("videoOverlay");
        closeSide();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const s = $("#sessSearch");
        if (s) s.focus();
      }
    });

    updateCtx();
  }

  function setMode(mode) {
    if (!mode) return;
    S.mode = mode;
    $$(".mode-chip").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
    const input = $("#input");
    const hints = {
      chat: "اكتب رسالتك هنا... (Enter للإرسال، Shift+Enter لسطر جديد)",
      research: "اكتب سؤالاً للبحث العميق مع المصادر…",
      site: "ألصق رابط موقع لتحليله…",
      img: "اوصف الصورة التي تريدها بالتفصيل…",
      osint: "أدخل مصطلح بحث (وجه، شخص، رحلة طيران) للبحث في المصادر المفتوحة…",
      video: "اكتب موضوع الفيديو ثم اضغط إرسال لفتح الاستوديو…",
      handle: "ألصق نصاً أو رابطاً لاستخدام الأدوات…"
    };
    const shortHints = {
      chat: "اكتب رسالتك…",
      research: "سؤال للبحث العميق…",
      site: "ألصق رابط موقع…",
      img: "اوصف الصورة…",
      video: "موضوع الفيديو…",
      handle: "ألصق نصاً أو رابطاً…",
      osint: "بحث مصادر مفتوحة…"
    };
    const narrow = window.matchMedia && window.matchMedia("(max-width: 560px)").matches;
    if (input) input.placeholder = (narrow ? shortHints[mode] : hints[mode]) || hints.chat;
    if (mode === "handle") runTools();
    if (mode === "video" && CB.studio) CB.studio.open(input ? input.value.trim() : "");
  }

  async function runOSINT(q) {
    const query = String(q || "").trim();
    if (!query) { toast("أدخل مصطلح بحث فعّال في صندوق الرسالة"); return; }
    setBusy(true);
    const msg = { id: uid(), role: "ai", text: "", provider: "مصادر مفتوحة", at: Date.now() };
    const node = addMessage(msg, { skipSave: true });
    node.bubble.innerHTML = '<div class="typing"><i></i><i></i><i></i></div><div style="color:var(--muted);font-size:11.5px;margin-top:8px">أبحث في المصادر المفتوحة…</div>';
    try {
      const j = await api("/api/hunt?q=" + encodeURIComponent(query) + "&method=web");
      const hits = ((j.hits && j.hits[0] && j.hits[0].hits) || []).filter((h) => h && h.url);
      if (!hits.length) {
        msg.text = "لم أجد نتائج مفتوحة عن «" + query + "». جرّب صياغة أخرى أو استخدم وضع البحث العميق.";
        node.bubble.innerHTML = "";
        fillBubble(node.bubble, msg);
      } else {
        const list = hits.slice(0, 10);
        msg.text = "**نتائج المصادر المفتوحة عن «" + query + "»**\n\n" + list.map((h, i) =>
          (i + 1) + ". [" + maxChars(h.title || h.url, 90) + "](" + h.url + ")" + (h.snippet ? " — " + maxChars(h.snippet, 180) : "")
        ).join("\n");
        node.bubble.innerHTML = "<div class=\"ans\"><b>نتائج المصادر المفتوحة عن «" + esc(query) + "»</b>" +
          '<div class="sources" style="margin-top:10px">' + list.map((h, i) =>
            '<a href="' + esc(h.url) + '" target="_blank" rel="noopener"><span class="n">[' + (i + 1) + "]</span><span>" + esc(maxChars(h.title || h.url, 100)) + "</span></a>"
          ).join("") + "</div></div>";
      }
    } catch (e) {
      msg.text = "⚠️ تعذّر البحث في المصادر المفتوحة: " + (e.message || "خطأ غير معروف");
      node.bubble.innerHTML = "";
      fillBubble(node.bubble, msg);
    } finally {
      saveSession(activeSession());
      setBusy(false);
    }
  }

  // عند انتهاء الجلسة (بدء جلسة جديدة) تعود الأدوات إلى حالتها الافتراضية
  function resetTools() {
    setMode("chat");
    if (S.attachments.length) {
      S.attachments = [];
      renderAtt();
    }
  }

  function startDictation() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast("الإدخال الصوتي غير مدعوم في هذا المتصفح — استخدم Chrome أو Edge"); return; }
    const mic = $("#btnMic");
    try {
      const rec = new SR();
      rec.lang = "ar-SA";
      rec.interimResults = true;
      rec.continuous = false;
      let base = $("#input").value;
      mic.classList.add("on");
      rec.onresult = (ev) => {
        let txt = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) txt += ev.results[i][0].transcript;
        $("#input").value = (base ? base + " " : "") + txt;
        autoGrow();
        updateCtx();
      };
      rec.onerror = () => toast("تعذّر التقاط الصوت — تحقق من إذن الميكروفون");
      rec.onend = () => mic.classList.remove("on");
      rec.start();
    } catch (_) {
      mic.classList.remove("on");
      toast("تعذّر بدء الإدخال الصوتي");
    }
  }

  /* -------------------------------- الإقلاع ------------------------------ */
  async function boot() {
    loadSettings();
    await Store.open();
    S.sessions = await Store.all();
    S.sessions.forEach((s) => {
      (s.messages || []).forEach((m) => {
        if (m.video && m.video.url) m.video = { title: m.video.title, meta: m.video.meta, marks: m.video.marks || [], lost: true };
      });
    });
    S.sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    S.activeId = S.sessions.length ? S.sessions[0].id : null;
    if (!S.activeId) {
      const s = { id: uid(), title: "", createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
      S.sessions.push(s);
      S.activeId = s.id;
    }
    bindUI();
    setupMobile();
    renderSessions();
    renderChat();
    loadModels();
    refreshHealth(true);
    setInterval(() => refreshHealth(true), 25000);
    if (CB.account) CB.account.init();
    if (CB.connect) CB.connect.init();
    if (CB.studio) CB.studio.init();
    if (CB.account) CB.account.renderChip();
    setMode("chat");
    setTimeout(() => { if ($("#input")) $("#input").focus(); }, 350);
  }

  /* ------------------------------ الواجهة العامة ------------------------- */
  CB.$ = $;
  CB.$$ = $$;
  CB.esc = esc;
  CB.toast = toast;
  CB.api = api;
  CB.renderMD = renderMD;
  CB.settings = () => settings;
  CB.saveSettings = saveSettings;
  CB.openOverlay = openOverlay;
  CB.closeOverlay = closeOverlay;
  CB.openViewer = openViewer;
  CB.copyText = copyText;
  CB.skills = () => SKILLS;
  CB.applySkills = applySkills;
  CB.chat = {
    add: addMessage,
    deliver: deliver,
    userInitial: userInitial,
    scroll: scrollBot,
    save: () => saveSession(activeSession()),
    history: historyMessages,
    rerender: () => { renderChat(); renderSessions(); },
    runChat: runChat,
    mode: () => S.mode,
    setMode: setMode,
    attachments: () => S.attachments
  };
  CB.store = Store;
  CB.state = S;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
