// ============================================================
// نبراس AI — منطق الواجهة كاملاً (بدون أي مفتاح API)
// ============================================================
"use strict";

/* ---------- أدوات ---------- */
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const fmtSize = (b) => b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(1) + " KB" : (b / 1048576).toFixed(2) + " MB";
const estTokens = (t) => Math.round(String(t || "").length / 3.1);
const sleepms = (ms) => new Promise(r => setTimeout(r, ms));
const maxChars = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n) : s; };

marked.setOptions({
  breaks: true,
  gfm: true,
  highlight: (code, lang) => {
    try {
      if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
      return hljs.highlightAuto(code).value;
    } catch (_) { return code; }
  }
});

function renderMD(src) {
  const html = DOMPurify.sanitize(marked.parse(src || ""), { ADD_ATTR: ["target"] });
  return html.replace(/<a /g, '<a target="_blank" rel="noopener" ');
}

function toast(msg, ms = 2600) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/* ---------- تخزين الجلسات ---------- */
const DB = {
  db: null,
  open() {
    return new Promise((res) => {
      const r = indexedDB.open("nibras_ai", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("sessions", { keyPath: "id" });
      r.onsuccess = () => { DB.db = r.result; res(); };
      r.onerror = () => res();
    });
  },
  put(s) {
    if (!DB.db) return Promise.resolve();
    return new Promise((res) => {
      const tx = DB.db.transaction("sessions", "readwrite");
      try { tx.objectStore("sessions").put(JSON.parse(JSON.stringify(s))); } catch (e) {}
      tx.oncomplete = res; tx.onerror = res;
    });
  },
  del(id) {
    if (!DB.db) return Promise.resolve();
    return new Promise((res) => {
      const tx = DB.db.transaction("sessions", "readwrite");
      tx.objectStore("sessions").delete(id);
      tx.oncomplete = res; tx.onerror = res;
    });
  },
  all() {
    if (!DB.db) return Promise.resolve([]);
    return new Promise((res) => {
      const tx = DB.db.transaction("sessions", "readonly");
      const q = tx.objectStore("sessions").getAll();
      q.onsuccess = () => { res(q.result || []); };
      q.onerror = () => res([]);
    });
  }
};

/* ---------- الحالة ---------- */
let sessions = [];
let activeId = null;
let attachments = [];
let currentMode = "chat";
let streamingCtrl = null;
let busy = false;
let models = [{ id: "auto", name: "تلقائي" }];
let health = [];
let settings = { systemPrompt: "", persona: "", accent: "violet", model: "auto" };

const PERSONAS = {
  "": "",
  code: "أنت مهندس برمجيات خبير. أعطِ كوداً نظيفاً مع تعليقات وأشرح المعمارية والبدائل، بالعربية مع المصطلحات التقنية.",
  analy: "أنت محلّل خبير جداً. قسّم التحليل إلى: نظرة عامة، تفاصيل جوهرية، نقاط قوة/ضعف، تقييم رقمي، وخلاصة عملية.",
  write: "أنت كاتب محترف. اكتب نصوصاً راقية أسلوبها واضح تناسب الجمهور المستهدف، مع خيارات صياغة إن كان الأثر محدداً.",
  tutor: "أنت مدرّس صبور وواضح. اشرح خطوة خطوة بأمثلة بسيطة وتحقق من الفهم بأسئلة قصيرة في النهاية.",
  biz: "أنت مستشار أعمال. ركّز على الجدوى والتكلفة والجمهور المستهدف والخطوات التنفيذية المرقّمة."
};

const DEFAULT_SYSTEM = "أنت «نبراس» — مساعد ذكاء اصطناعي فائق، عملي ودقيق. تُجيب بالعربية الفصحى الواضحة (مع المصطلحات التقنية إن وجدت)، وتنظّم الردود بعناوين ونقاط وصناديق كود عند الحاجة. إن لم تكن متأكداً من معلومة فصرّح بذلك بوضوح بدلاً من اختراعها.";

/* ---------- تهيئة ---------- */
(async function init() {
  await DB.open();
  try { Object.assign(settings, JSON.parse(localStorage.getItem("nibras_settings") || "{}")); } catch (_) {}
  applyAccent(settings.accent);
  loadModels().then(ms => { models = ms; fillModelSelect(); });
  sessions = await DB.all();
  sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (sessions.length) activeId = sessions[0].id; else newSession();
  renderSessions(); renderChat();
  refreshHealth();
  setInterval(refreshHealth, 25000);
  bindUI();
})();

async function loadModels() {
  try {
    const r = await fetch("/api/models");
    const j = await r.json();
    return j.models || models;
  } catch (_) { return models; }
}

function fillModelSelect() {
  const sel = $("#modelSel");
  sel.innerHTML = "";
  for (const m of models) {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = m.name;
    sel.appendChild(o);
  }
  sel.value = settings.model || "auto";
  sel.onchange = () => { settings.model = sel.value; saveSettings(); };
}

/* ---------- الصحة ---------- */
async function refreshHealth() {
  try {
    const j = await (await fetch("/api/health")).json();
    health = j.providers || [];
    const ready = health.filter(h => h.status === "ready").length;
    const el = $("#healthLabel");
    if (!el) return;
    el.classList.toggle("cool", ready === 0);
    el.querySelector("b").textContent = ready ? "المزوّدون جاهزون" : "انتظار حصة";
    renderProviderList();
  } catch (_) {}
}

function renderProviderList() {
  const box = $("#provList");
  if (!box) return;
  box.innerHTML = health.map(h => `
    <div class="prov-line">
      <div style="display:flex;align-items:center">
        <i class="${h.status}"></i>
        <span>${esc(h.label)}</span>
      </div>
      <span class="free">${h.status === "ready" ? "متاح الآن ✓" : "في انتظار الحصة · " + h.coolFor + "ث"}</span>
    </div>`).join("");
}

/* ---------- الجلسات ---------- */
function newSession() {
  const s = {
    id: uid(),
    title: "محادثة جديدة",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    compactedSummary: "",
    settings: {}
  };
  sessions.unshift(s);
  activeId = s.id;
  DB.put(s);
  renderSessions(); renderChat();
  toggleSidebar(false);
  return s;
}
function getS() { return sessions.find(s => s.id === activeId); }
function touch(s) { s.updatedAt = Date.now(); DB.put(s); debounceRenderSessions(); }

let sessTO = null;
function debounceRenderSessions() {
  clearTimeout(sessTO);
  sessTO = setTimeout(renderSessions, 400);
}

function renderSessions() {
  const box = $("#sessList");
  if (!box) return;
  const filter = ($("#sessSearch")?.value || "").trim();
  box.innerHTML = "";
  const list = sessions.filter(s => !filter || (s.title || "").includes(filter) || (s.messages || []).some(m => (m.content || "").includes(filter)));
  for (const s of list) {
    const d = document.createElement("div");
    d.className = "sess" + (s.id === activeId ? " active" : "");
    d.innerHTML = `<span class="t">${esc(maxChars(s.title, 48))}</span><button class="x" title="حذف">✕</button>`;
    d.querySelector(".t").onclick = () => { activeId = s.id; renderSessions(); renderChat(); toggleSidebar(false); };
    d.querySelector(".x").onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("حذف هذه المحادثة نهائياً؟")) return;
      await DB.del(s.id);
      sessions = sessions.filter(x => x.id !== s.id);
      if (activeId === s.id) activeId = sessions[0] ? sessions[0].id : null;
      if (!activeId) newSession(); else { renderSessions(); renderChat(); }
    };
    box.appendChild(d);
  }
  if (!list.length) box.innerHTML = `<div style="text-align:center;color:var(--muted);font-size:12px;padding:18px">لا نتائج</div>`;
}

/* ---------- عرض الدردشة ---------- */
function renderChat() {
  const s = getS();
  const col = $("#chatCol");
  col.innerHTML = "";
  if (!s) return;
  if (!s.messages.length) col.appendChild(welcomeBlock());
  for (let i = 0; i < s.messages.length; i++) {
    col.appendChild(messageNode(s.messages[i], i, i === s.messages.length - 1));
  }
  updateCtxBar();
  scrollBottom();
}

function welcomeBlock() {
  const w = document.createElement("div");
  w.className = "welcome";
  w.innerHTML = `
    <div class="hero-logo">✦</div>
    <h2>أهلاً بك — أنا نبراس ✦</h2>
    <p>ذكاء اصطناعي فخم ومجاني <b>بدون أي مفتاح API</b> وبدون حساب: دردشة عميقة مع تفكير مرئي، بحث عميق بمصادر حقيقية، تحليل مواقع، قراءة ملفات (PDF / Word / Excel / ZIP / صور / فيديو / صوت)، توليد صور، و<b>إنتاج فيديو كامل</b> بالصور والتعليق الصوتي والموسيقى.</p>
    <div class="chips">
      <button class="chip" data-q="اكتب لي خطة عمل لمشروع متجر إلكتروني في 8 خطوات مع توزيع الميزانية.">🧭 خطة مشروع متجر</button>
      <button class="chip" data-q="اشرح الفرق بين SQL وNoSQL بمثال عملي متى نستخدم كلًا منهما.">🗄️ مقارنة تقنية</button>
      <button class="chip" data-q="صمّم لي خطة تعلم بايثون خلال 30 يوماً بمشاريع صغيرة يومية.">🎓 خطة تعلم 30 يوم</button>
      <button class="chip" data-q="راجع مفاهيم البرمجة الكائنية بإيجاز وأعطني 5 أسئلة تقييم مع الإجابات.">⚡ مراجعة سريعة</button>
      <button class="chip" data-q="ما هي أحدث الاتجاهات في الذكاء الاصطناعي اليوم؟ استخدم البحث العميق.">🔎 بحث اتجاهات AI</button>
      <button class="chip" data-q="اقترح هوية بصرية فاخرة لموقع عربي: الألوان والخطوط وتوزيع الأقسام.">🎨 هوية فخمة</button>
      <button class="chip" data-video="1">🎬 اصنع فيديو قصيراً</button>
    </div>
    <div class="feat">
      <span>🧠 جلسات غير محدودة مع ضغط سياق تلقائي</span>
      <span>📁 يقرأ PDF / Word / Excel / ZIP / صور / فيديو / صوت</span>
      <span>🎬 استوديو فيديو: سيناريو وصور وتعليق صوتي ومونتاج</span>
      <span>🔒 خصوصية — بياناتك في متصفحك فقط</span>
    </div>
  `;
  w.querySelectorAll(".chip").forEach(c => c.onclick = () => {
    if (c.dataset.video) {
      setMode("video");
      vdOpen("");
      return;
    }
    $("#input").value = c.dataset.q;
    autoGrow();
    $("#input").focus();
  });
  return w;
}

function persistedFile(f) {
  return {
    name: f.name, note: f.note, icon: f.icon,
    size: f.size, text: maxChars(f.text, 30000),
    thumb: (!f.videoInfo && f.thumb) ? f.thumb : undefined
  };
}

function messageNode(m, idx, isLast) {
  const node = document.createElement("div");
  node.className = "msg " + (m.role === "user" ? "user" : "ai");
  node.dataset.mid = m.id;

  const av = document.createElement("div");
  av.className = "avatar";
  av.textContent = m.role === "user" ? "👤" : "✦";

  const body = document.createElement("div");
  body.className = "body";

  const who = document.createElement("div");
  who.className = "who";
  who.innerHTML = (m.role === "user" ? "أنت" : "نبراس")
    + (m.provider ? ` <span class="prov">${esc(m.provider)}</span>` : "")
    + (m.error ? ` <span class="prov" style="color:var(--danger)">خطأ</span>` : "");
  body.appendChild(who);

  if (m.files && m.files.length) {
    const strip = document.createElement("div");
    strip.className = "filestrip";
    for (const f of m.files) {
      const it = document.createElement("div");
      it.className = "fitem";
      it.innerHTML = `<div class="ic">${f.thumb ? `<img src="${esc(f.thumb)}" alt=""/>` : esc(f.icon || "📄")}</div>
        <div class="meta"><b>${esc(f.name)}</b><span>${esc(f.note || "")}</span></div>`;
      if (f.thumb) it.onclick = () => openLightbox(f.thumb);
      if (f.text) it.onclick = () => openFileViewer(f);
      strip.appendChild(it);
    }
    body.appendChild(strip);
  }

  if (m.role !== "user" && m.reasoning) {
    const r = document.createElement("details");
    r.className = "reason";
    r.innerHTML = `<summary>🧠 عرض التفكير الداخلي</summary><div class="rc">${esc(m.reasoning)}</div>`;
    body.appendChild(r);
  }

  const bub = document.createElement("div");
  bub.className = "bubble";
  if (m.role === "user") {
    bub.textContent = m.content || "";
    bub.dir = "auto";
  } else if (m.video) {
    const vw = document.createElement("div");
    vw.className = "genvid";
    vw.innerHTML = `<video src="${esc(m.video)}" controls playsinline></video>
      <div class="gvmeta"><b>${esc(m.videoTitle || "فيديو")}</b><span>${esc(m.caption || "")}${m.caption ? " · " : ""}مؤقت: يبقى حتى إعادة تحميل الصفحة</span></div>`;
    bub.appendChild(vw);
  } else if (m.image) {
    const gi = document.createElement("div");
    gi.className = "genimg" + (m.loaded ? " loaded" : "");
    gi.innerHTML = `<img src="${esc(m.image)}" alt="صورة مولدة" style="max-height:440px"/>` +
      (m.loaded ? "" : `<div class="shimmer"><div><div class="spin"></div><div>${esc(m.caption || "جارٍ توليد الصورة...")}</div></div></div>`);
    const img = gi.querySelector("img");
    img.onload = () => { m.loaded = true; gi.classList.add("loaded"); saveSoon(); };
    img.onerror = () => { gi.classList.add("loaded"); img.style.display = "none"; gi.insertAdjacentHTML("beforeend", `<div style="color:var(--muted);padding:12px;text-align:center">فشل التوليد — جرّب «إعادة التوليد» (الحصص المجانية متساوية النوبات)</div>`); };
    img.onclick = () => openLightbox(m.image);
    bub.appendChild(gi);
  } else {
    bub.innerHTML = renderMD(m.content || "") || `<div class="typing"><i></i><i></i><i></i></div>`;
    bub.dir = "auto";
    wireCodeCopy(bub);
    wireImgLightbox(bub);
  }
  body.appendChild(bub);

  const tools = document.createElement("div");
  tools.className = "msg-tools";
  tools.innerHTML = m.role === "user"
    ? `<button class="mini-btn" data-a="edit">✎ تعديل</button>`
    : `<button class="mini-btn" data-a="copy">⧉ نسخ</button>`
      + (isLast ? ` <button class="mini-btn" data-a="regen">↻ إعادة التوليد</button>` : "")
      + (m.image ? ` <button class="mini-btn" data-a="reimg">🎨 إعادة التوليد</button> <button class="mini-btn" data-a="dlimg">⬇ تنزيل</button>` : "");
  tools.onclick = async (e) => {
    const a = e.target.dataset && e.target.dataset.a;
    if (!a) return;
    if (a === "copy") {
      await navigator.clipboard.writeText(m.role === "user" ? (m.content || "") : (m.image || m.content || ""));
      toast("تم النسخ ✓");
    }
    if (a === "edit") { $("#input").value = m.content || ""; autoGrow(); $("#input").focus(); }
    if (a === "regen") regenerate(idx);
    if (a === "reimg") regenImage(m);
    if (a === "dlimg") {
      const a2 = document.createElement("a");
      a2.href = m.image;
      a2.download = "nibras-image-" + uid() + ".png";
      a2.target = "_blank";
      a2.rel = "noopener";
      a2.click();
    }
  };
  body.appendChild(tools);

  node.appendChild(av);
  node.appendChild(body);
  return node;
}

function wireCodeCopy(bub) {
  bub.querySelectorAll("pre").forEach(pre => {
    if (pre.closest(".codewrap")) return;
    const wrap = document.createElement("div");
    wrap.className = "codewrap";
    const head = document.createElement("div");
    head.className = "codehead";
    head.innerHTML = `<span>${esc((pre.querySelector("code")?.className || "").match(/language-([\w-]+)/)?.[1] || "كود")}</span>`;
    const btn = document.createElement("button");
    btn.className = "cp";
    btn.textContent = "نسخ";
    btn.onclick = () => {
      navigator.clipboard.writeText(pre.querySelector("code")?.textContent || "");
      btn.textContent = "تم ✓";
      setTimeout(() => btn.textContent = "نسخ", 1400);
    };
    head.appendChild(btn);
    pre.replaceWith(wrap);
    wrap.appendChild(head);
    wrap.appendChild(pre);
  });
}

function wireImgLightbox(scope) {
  scope.querySelectorAll("img").forEach(img => {
    if (img.closest(".fitem")) return;
    img.style.cursor = "zoom-in";
    img.onclick = () => openLightbox(img.src);
  });
}
function openLightbox(src) {
  $("#lightboxImg").src = src;
  $("#lightbox").classList.add("open");
}

function openFileViewer(f) {
  if (!f) return;
  $("#vTitle").textContent = f.name || "معاينة";
  $("#vBody").innerHTML = f.text
    ? `<pre>${esc(maxChars(f.text, 120000))}</pre>`
    : f.thumb ? `<img class="vimg" src="${esc(f.thumb)}"/>` : "";
  $("#viewer").classList.add("open");
}

/* ---------- شريط السياق ---------- */
function updateCtxBar() {
  const s = getS();
  if (!s) return;
  const msgs = s.messages || [];
  const tk = estTokens(msgs.reduce((n, m) => n + (m.content || "").length + (m.reasoning || "").length * 0.3, 0) + (s.compactedSummary || "").length);
  $("#ctxInfo").innerHTML = msgs.length
    ? `<span>≈ ${tk.toLocaleString("ar-EG")} توكن</span><span>${msgs.length} رسالة</span>` +
      (s.compactedSummary ? `<span class="warn${tk > 8000 ? " hot" : ""}" title="ضُغط السياق القديم تلقائياً ليبقى الصندوق خفيفاً">🧊 سياق مضغوط</span>` : "")
    : "";
}

let saveTO = null;
function saveSoon() { clearTimeout(saveTO); saveTO = setTimeout(() => { const s = getS(); if (s) touch(s); }, 800); }
function scrollBottom() { const c = $("#chat"); if (c) c.scrollTop = c.scrollHeight + 600; }
function autoGrow() {
  const i = $("#input");
  if (!i) return;
  i.style.height = "auto";
  i.style.height = Math.min(i.scrollHeight, 210) + "px";
}

/* ---------- بناء سياق الرسائل (من الرسائل السابقة فقط) ---------- */
function buildMessages(sysOverride, opts = {}) {
  const s = getS();
  const sys = (sysOverride || s.settings.systemPrompt || settings.systemPrompt)
    ? `${sysOverride || s.settings.systemPrompt || settings.systemPrompt}\n${PERSONAS[settings.persona] || ""}\n${DEFAULT_SYSTEM}`
    : DEFAULT_SYSTEM + "\n" + (PERSONAS[settings.persona] || "");
  const out = [{ role: "system", content: sys }];
  if (s.compactedSummary) out.push({ role: "system", content: "ملخّص السياق القديم لهذه الجلسة (اعتبره خلفية معروفة):\n" + s.compactedSummary });
  const exclude = opts.excludeLast || 0;
  const hist = s.messages.slice(0, s.messages.length - exclude);
  const budget = opts.budgetChars || 42000;
  let used = 0;
  const recent = [];
  for (let i = hist.length - 1; i >= 0 && used < budget; i--) {
    const m = hist[i];
    const L = (m.content || "").length + (m.reasoning || "").length * 0.25;
    if (used + L > budget) break;
    used += L;
    recent.unshift(m.image && m.role !== "user"
      ? { role: "assistant", content: `[صورة مولدة: ${m.prompt || ""}]` }
      : { role: m.role, content: maxChars(m.content, 12000) });
  }
  out.push(...recent);
  return out;
}

/* ---------- ضغط السياق التلقائي (جلسات طويلة جداً) ---------- */
async function maybeCompact() {
  const s = getS();
  if (!s || s.compacting) return;
  const total = s.messages.reduce((n, m) => n + (m.content || "").length + (m.reasoning || "").length * 0.3, 0);
  if (total < 52000) return;
  s.compacting = true;
  try {
    const older = s.messages.slice(0, Math.max(0, s.messages.length - 10));
    const txt = older.map(m => (m.role === "user" ? "المستخدم: " : "المساعد: ") + maxChars(m.content, 1400) + (m.reasoning ? " [خلاصة تفكير: " + maxChars(m.reasoning, 400) + "]" : "")).join("\n").slice(0, 44000);
    const ans = await apiComplete({
      messages: [
        { role: "system", content: "لخّص الحوار التالي في نقاط استرجاع كثيفة (حقائق، قرارات، أسماء، مسارات ملفات، نتائج) بالعربية. 300 كلمة حد أقصى. ابدأ مباشرة بدون مقدمات." },
        { role: "user", content: txt }
      ], model: "auto", stream: false, max_tokens: 900
    }, { plain: true });
    if (ans && (ans.content || "").length > 60) {
      s.compactedSummary = (s.compactedSummary ? s.compactedSummary + "\n" : "") + ans.content;
      s.messages = s.messages.slice(Math.max(0, s.messages.length - 10));
      touch(s);
      toast("🧊 ضُغط السياق القديم تلقائياً — نبراس يبقي الخلاصة ويواصل الجلسة الطويلة");
      renderChat();
    }
  } catch (_) {}
  s.compacting = false;
}

/* استدعاء موحّد للنموذج */
async function apiComplete(payload, opts = {}) {
  const r = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || "تعذر الوصول للنموذج");
  }
  return r.json();
}

/* ---------- المرفقات ---------- */
function renderAtts() {
  const box = $("#attList");
  box.innerHTML = "";
  attachments.forEach((a, i) => {
    const d = document.createElement("div");
    d.className = "att";
    d.innerHTML = `
      <div class="thumb">${a.thumb ? `<img src="${esc(a.thumb)}" alt=""/>` : esc(a.icon || "📄")}</div>
      <div class="ame"><b>${esc(a.name)}</b><span>${esc(a.note || fmtSize(a.size))}</span></div>
      <button class="rm" title="إزالة">✕</button>`;
    d.querySelector(".thumb").onclick = () => openFileViewer(a);
    d.querySelector(".ame").onclick = () => openFileViewer(a);
    d.querySelector(".rm").onclick = () => { attachments.splice(i, 1); renderAtts(); };
    box.appendChild(d);
  });
}

const CODE_EXT = /\.(js|ts|jsx|tsx|py|java|kt|swift|c|cpp|h|hpp|cs|go|rs|rb|php|sh|bat|ps1|sql|html|css|scss|less|vue|svelte|dart|lua|json|ya?ml|toml|ini|env|md|txt|log|csv|xml|svg)$/i;

function classify(f) {
  if (f.type.startsWith("image/")) return "image";
  if (f.type.startsWith("video/")) return "video";
  if (f.type.startsWith("audio/")) return "audio";
  if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) return "pdf";
  if (/docx?$/i.test(f.name) || f.type.includes("wordprocessing")) return "docx";
  if (/xlsx?|csv$/i.test(f.name) || f.type.includes("spreadsheet")) return "xlsx";
  if (f.type === "application/zip" || /\.(zip|rar|7z|tar|gz)$/i.test(f.name)) return "zip";
  if (CODE_EXT.test(f.name) || f.type.startsWith("text/")) return "text";
  return "text";
}

async function addFiles(files) {
  for (const f of files) {
    if (f.size > 55 * 1048576) { toast("حجم " + f.name + " أكبر من 55MB — تخطيتُه"); continue; }
    const kind = classify(f);
    try { await processFile(f, kind); }
    catch (e) { toast("تعذّر معالجة " + f.name + ": " + e); }
  }
  renderAtts();
}

async function processFile(f, kind) {
  if (kind === "image") {
    const dataurl = await downscaleImage(f, 1280, 0.86);
    attachments.push({ kind: "image", name: f.name, mime: f.type, size: f.size, dataurl, thumb: dataurl, icon: "🖼️", note: "صورة — تُحلَّل بالرؤية" });
    return;
  }
  if (kind === "video") {
    const info = await videoFrames(f);
    attachments.push({
      kind: "video", name: f.name, mime: f.type, size: f.size,
      thumb: info.poster, icon: "🎬", note: "فيديو " + Math.round(info.duration) + "ث — " + info.frames.length + " لقطات للتحليل", text: info.text, videoInfo: info
    });
    return;
  }
  if (kind === "audio") {
    const att = { kind: "audio", name: f.name, mime: f.type, size: f.size, thumb: null, icon: "🎵", note: "جارٍ التفريغ النصي (Whisper)..." };
    attachments.push(att);
    renderAtts();
    const dr = await fileToDataURL(f);
    att._audioData = dr;
    try {
      const r = await fetch("/api/audio", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dataurl: dr }) });
      const j = await r.json();
      if (j.text) { att.text = j.text; att.note = "تم التفريغ النصي ✓ — " + j.text.length + " حرف"; }
      else att.note = "التفريغ غير متاح الآن — جرّب لاحقاً";
    } catch (_) { att.note = "فشل التفريغ — جرب مرة أخرى"; }
    renderAtts();
    return;
  }
  if (kind === "pdf") {
    const text = await pdfText(f);
    attachments.push({ kind: "pdf", name: f.name, size: f.size, text, icon: "📕", note: fmtSize(f.size) + " — " + text.length.toLocaleString("ar-EG") + " حرف" });
    return;
  }
  if (kind === "docx") {
    const buf = await f.arrayBuffer();
    const r = await mammoth.extractRawText({ arrayBuffer: buf });
    attachments.push({ kind: "docx", name: f.name, size: f.size, text: r.value, icon: "📘", note: "Word — " + r.value.length.toLocaleString("ar-EG") + " حرف" });
    return;
  }
  if (kind === "xlsx") {
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf);
    let text = "";
    for (const ws of wb.SheetNames) {
      text += "=== ورقة: " + ws + " ===\n" + maxChars(XLSX.utils.sheet_to_csv(wb.Sheets[ws]), 20000) + "\n";
    }
    attachments.push({ kind: "xlsx", name: f.name, size: f.size, text: maxChars(text, 60000), icon: "📗", note: "جدول Excel" });
    return;
  }
  if (kind === "zip") {
    if (/\.(rar|7z)$/i.test(f.name)) {
      attachments.push({ kind: "zip", name: f.name, size: f.size, text: "", icon: "🗜️", note: "RAR/7Z غير مقروء داخلياً — أعد إرفاقه بصيغة ZIP" });
      return;
    }
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      const entries = fflate.unzipSync(buf);
      const names = Object.keys(entries).filter(n => !n.endsWith("/"));
      let text = "ملف مضغوط: " + f.name + " — " + names.length + " ملفاً داخلياً\n\n";
      let budget = 52000;
      let read = 0;
      for (const n of names) {
        const data = entries[n];
        if (!CODE_EXT.test(n) || data.length > 400000 || budget <= 0) { text += "— (لم يُقرأ: " + n + ")\n"; continue; }
        try {
          const t = new TextDecoder().decode(data).slice(0, 7000);
          text += "===== " + n + " =====\n" + t + "\n\n";
          budget -= t.length;
          read++;
        } catch (_) { text += "— (ثنائي: " + n + ")\n"; }
      }
      attachments.push({ kind: "zip", name: f.name, size: f.size, text: maxChars(text, 60000), icon: "🗜️", note: names.length + " عنصر — قُرئ " + read + " من ملفات الكود" });
      return;
    } catch (e) {
      attachments.push({ kind: "zip", name: f.name, size: f.size, text: "", icon: "🗜️", note: "تعذّر فك الضغط" });
      return;
    }
  }
  const t = await f.text();
  attachments.push({
    kind: "text", name: f.name, mime: f.type, size: f.size,
    text: maxChars(t, 60000),
    icon: CODE_EXT.test(f.name) ? "🧩" : "📄",
    note: fmtSize(f.size)
  });
}

function downscaleImage(fileOrUrl, maxDim, q) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      res(cv.toDataURL("image/jpeg", q));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => rej(new Error("صورة غير قابلة للقراءة"));
    img.src = URL.createObjectURL(fileOrUrl);
  });
}

async function videoFrames(file) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url; video.muted = true; video.playsInline = true; video.preload = "auto";
  await new Promise((res, rej) => {
    video.onloadedmetadata = res;
    video.onerror = () => rej(new Error("فديو غير مقروء"));
    setTimeout(() => rej(new Error("انتها المهلة")), 12000);
  });
  const dur = video.duration || 10;
  const positions = dur > 20 ? [0.08, 0.3, 0.5, 0.7, 0.92] : dur > 6 ? [0.15, 0.5, 0.85] : [0.35];
  const frames = [];
  let poster = null;
  const w = Math.min(900, video.videoWidth || 800);
  const h = Math.round(w * ((video.videoHeight || 450) / Math.max(1, video.videoWidth || 800)));
  for (const p of positions) {
    await seek(video, dur * p);
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(video, 0, 0, w, h);
    const d = cv.toDataURL("image/jpeg", 0.8);
    frames.push(d);
    if (!poster) poster = d;
  }
  const text = "فيديو: " + file.name + "\nالطول: " + Math.round(dur) + " ثانية — الأبعاد: " + video.videoWidth + "×" + video.videoHeight + "\nاستُخرجت " + frames.length + " لقطات لتحليلها بصرياً.";
  URL.revokeObjectURL(url);
  return { poster, frames, duration: dur, text, defaultQuestion: "هذه لقطات من فيديو واحد. صف مجريات الفيديو بالتفصيل، وتحليل نوعي للأسلوب أو الشرح." };
}

function seek(video, t) {
  return new Promise((res) => {
    let done = false;
    const finish = () => { if (!done) { done = true; video.onseeked = null; res(); } };
    video.onseeked = finish;
    video.currentTime = Math.min(t, Math.max(0, (video.duration || 1) - 0.05));
    setTimeout(finish, 2500);
  });
}

function fileToDataURL(f) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(f);
  });
}

async function pdfText(file) {
  const url = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs";
  const pdfjsLib = await import(/* webpackIgnore: true */ url);
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs";
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages = Math.min(doc.numPages, 40);
  let text = "(PDF: " + doc.numPages + " صفحة)\n";
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const c = await page.getTextContent();
    text += c.items.map(x => x.str).join(" ") + "\n";
  }
  return maxChars(text, 50000);
}

/* ---------- الإرسال الرئيسي ---------- */
async function send() {
  if (busy) return;
  const inp = $("#input");
  const text = inp.value.trim();
  const atts = attachments.slice();
  if (currentMode === "video") { vdOpen(text); return; }
  if (!text && !atts.length) return;

  inp.value = ""; autoGrow();
  busy = true; setBusyUI(true);
  attachments = []; renderAtts();

  const s = getS();
  const userMsg = {
    id: uid(), role: "user",
    content: text || "(مرفق بدون نص)",
    files: atts.map(persistedFile),
    time: Date.now()
  };
  s.messages.push(userMsg);
  touch(s);
  $("#chatCol").querySelector(".welcome")?.remove();
  appendNewUserNode(s, userMsg);

  try {
    if (currentMode === "img") await genImage(text);
    else if (currentMode === "research") await flowResearch(text, atts);
    else if (currentMode === "site" && looksLikeUrl(text)) await flowSite(text);
    else if (currentMode === "site" && !looksLikeUrl(text)) {
      toast("وضع تحليل الموقع يحتاج رابطاً — ننتقل للدردشة العادية");
      await flowChat(text, atts);
    }
    else await flowChat(text, atts);
  } catch (e) {
    const ai = lastAiMsg(s);
    if (ai) { ai.error = true; ai.content = (ai.content || "") + "\n\n⚠️ " + (e.message || e); ai._live = false; refreshMsg(ai); }
  }
  maybeCompact();
  busy = false; setBusyUI(false);
  saveSoon();
  autoTitle(s, text);
  updateCtxBar();
}

function looksLikeUrl(t) { return /^https?:\/\/[^\s]+$/.test(String(t).trim()); }
function lastAiMsg(s) { for (let i = s.messages.length - 1; i >= 0; i--) if (s.messages[i].role !== "user") return s.messages[i]; return null; }

function appendNewUserNode(s, m) {
  $("#chatCol").appendChild(messageNode(m, s.messages.length - 1, false));
  scrollBottom();
}

function refreshMsg(m) {
  const node = document.querySelector(`.msg[data-mid="${m.id}"]`);
  if (!node) return;
  const s = getS();
  const idx = s.messages.findIndex(x => x.id === m.id);
  node.replaceWith(messageNode(m, idx, idx === s.messages.length - 1));
  scrollBottom();
}

function autoTitle(s, firstText) {
  if (firstText && s.title === "محادثة جديدة" && s.messages.length <= 2) {
    s.title = maxChars(firstText.replace(/\s+/g, " "), 40);
    touch(s); debounceRenderSessions();
  }
}

/* ---------- بثّ داخل رسالة موجودة ---------- */
async function streamInto(ai, msgs) {
  ai._live = true;
  let node = document.querySelector(`.msg[data-mid="${ai.id}"]`);
  if (!node) { // أول ظهور
    $("#chatCol").appendChild(messageNode(ai, getS().messages.length - 1, true));
    node = document.querySelector(`.msg[data-mid="${ai.id}"]`);
  }
  let bub = node?.querySelector(".bubble");
  let lastPaint = 0;

  const paint = () => {
    if (!bub) return;
    bub.innerHTML = renderMD(ai.content || "") || `<div class="typing"><i></i><i></i><i></i></div>`;
    bub.dir = "auto";
    wireCodeCopy(bub); wireImgLightbox(bub);
    scrollBottom();
  };
  if (bub) bub.innerHTML = `<div class="typing"><i></i><i></i><i></i></div>`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const acc = { content: "", reasoning: "", provider: "", error: "", aborted: false };
    const payload = {
      messages: msgs,
      model: settings.model || "auto",
      stream: true,
      temperature: 0.75
    };
    let done = false;
    try {
      streamingCtrl = new AbortController();
      const r = await fetch("/api/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(payload), signal: streamingCtrl.signal
      });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({}));
        acc.error = j.error || ("HTTP " + r.status);
      } else {
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (!done) {
          const { done: d, value } = await reader.read();
          if (d) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() || "";
          for (const part of parts) {
            const line = part.replace(/^data:\s*/, "").trim();
            if (!line) continue;
            let f; try { f = JSON.parse(line); } catch (_) { continue; }
            if (f.type === "delta") { acc.content += f.text; acc.error = ""; }
            else if (f.type === "reason") acc.reasoning += f.text;
            else if (f.type === "meta") acc.provider = (f.provider || "") + (f.model ? " · " + f.model : "");
            else if (f.type === "error") acc.error += (acc.error ? "\n" : "") + f.text;
            else if (f.type === "done") done = true;
          }
          const now = Date.now();
          if (now - lastPaint > 130) {
            lastPaint = now;
            if (acc.content) paint();
            if (acc.reasoning) updateReasonNode(node, acc.reasoning);
          }
        }
      }
    } catch (e) {
      if (String(e).includes("abort")) { acc.aborted = true; }
      else acc.error = String(e);
    }

    if (!acc.content && acc.error && attempt === 0 && !acc.aborted) {
      if (bub) bub.innerHTML = `<div class="typing"><i></i><i></i><i></i></div>`;
      await sleepms(1400);
      continue; // محاولة ثانية بمزوّد آخر
    }

    if (acc.content) ai.content = acc.content;
    if (acc.reasoning) ai.reasoning = acc.reasoning;
    if (acc.provider) ai.provider = acc.provider;
    if (acc.aborted) ai.content += "\n\n⏹ أُوقفت بواسطتك — يمكنك إعادة التوليد أو إكمال الكتابة";
    else if (acc.error && !ai.content) { ai.error = true; ai.content = "⚠️ " + acc.error; }
    ai._live = false;
    refreshMsg(ai);
    return;
  }
}

function updateReasonNode(node, reasoning) {
  if (!node || !reasoning) return;
  let r = node.querySelector("details.reason");
  if (!r) {
    r = document.createElement("details");
    r.className = "reason";
    r.innerHTML = `<summary>🧠 عرض التفكير الداخلي</summary><div class="rc"></div>`;
    node.querySelector(".body").insertBefore(r, node.querySelector(".bubble"));
  }
  r.querySelector(".rc").textContent = reasoning;
}

/* ---------- المسار 1: دردشة + رؤية ---------- */
async function flowChat(text, atts) {
  const s = getS();
  const ai = { id: uid(), role: "assistant", content: "", reasoning: "", provider: "", time: Date.now() };
  s.messages.push(ai);

  const msgs = buildMessages(null, { excludeLast: 1 }); // نستبعد رسالة المستخدم الأخيرة؛ سنضيفها يدوياً مع نص المرفقات

  const images = [];
  const frameSets = [];
  const texts = [];
  for (const a of atts) {
    if (a.kind === "image" && a.dataurl) images.push(a);
    else if (a.kind === "video" && a.videoInfo) frameSets.push(a);
    else if (a.text) texts.push("===== " + a.name + " =====\n" + maxChars(a.text, 16000));
  }

  const visImgs = images.map(i => i.dataurl);
  for (const v of frameSets) visImgs.push(...(v.videoInfo.frames || []).slice(0, 4));

  if (visImgs.length) {
    $("#chatCol").appendChild(messageNode(ai, s.messages.length - 1, true));
    const node = document.querySelector(`.msg[data-mid="${ai.id}"]`);
    const bub = node.querySelector(".bubble");
    bub.innerHTML = `<div class="typing"><i></i><i></i><i></i></div><div style="font-size:12px;color:var(--muted);margin-top:6px">🔍 تحليل الصورة/الفيديو بالرؤية الأولى...</div>`;
    scrollBottom();
    try {
      const vr = await fetch("/api/vision", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          images: visImgs,
          question: (text || "صف هذه الصور بالتفصيل المفيد وأجب بالعربية.")
        })
      });
      const vj = await vr.json().catch(() => ({}));
      if (vj.content) {
        ai.provider = "";
        const visText = vj.content;
        msgs.push({ role: "user", content: text + "\n\n[نتيجة تحليل الرؤية للصور المرفقة:\n" + maxChars(visText, 6000) + "]\nاستند إلى هذا التحليل وأجب على سؤالي، وأشر إلى ما تراه بالفعل." });
      } else {
        toast("تحليل الرؤية مشغول — سنتعامل بدون الرؤية");
        if (texts.length) msgs.push({ role: "user", content: text + "\n\n--- مرفقات ---\n" + texts.join("\n\n") });
        else msgs.push({ role: "user", content: text || "أجب على ما تكفيه تجربة." });
      }
    } catch (_) {
      if (texts.length) msgs.push({ role: "user", content: text + "\n\n--- مرفقات ---\n" + texts.join("\n\n") });
      else msgs.push({ role: "user", content: text || "أجب على ما تكفيه." });
    }
    await streamInto(ai, msgs);
    return;
  }

  // مرفقات نصية فقط
  if (texts.length) {
    msgs.push({
      role: "user",
      content: (text || "حلّل المرفقات وتعمّق فيها ثم أخبرني بما تكتشفه وأهم ما يجب أفعله.") +
        "\n\n--- مرفقات ---\n" + texts.join("\n\n")
    });
  } else {
    msgs.push({ role: "user", content: text });
  }
  await streamInto(ai, msgs);
}

/* ---------- المسار 2: بحث عميق بمصادر ---------- */
async function flowResearch(question, atts) {
  const s = getS();
  const q = question || "لخّص أهم ما في المرفقات وبحث عن معلومات موفّعة عنها.";
  const ai = { id: uid(), role: "assistant", content: "", reasoning: "", provider: "", research: true, time: Date.now() };
  s.messages.push(ai);

  const card = document.createElement("div");
  card.className = "step-card";
  const addLine = (label, state) => {
    const d = document.createElement("div");
    d.className = "sline " + state;
    d.innerHTML = `<div class="si">${state === "done" ? "✓" : ""}</div><div>${esc(label)}</div>`;
    card.appendChild(d);
    return d;
  };

  addLine("بدأ تحليل الطلب وجمع الدليل الإنترنتي للسؤال...", "act");
  $("#chatCol").appendChild(messageNode(ai, s.messages.length - 1, true));
  const node = document.querySelector(`.msg[data-mid="${ai.id}"] b`) ? null : document.querySelector(`.msg[data-mid="${ai.id}"]`);
  const bub = node.querySelector(".bubble");
  bub.innerHTML = "";
  bub.appendChild(card);
  scrollBottom();

  // 1) الخطة
  let queries = [q + " شرح", q + " تفاصيل", q + " خلاصة"];
  let plan = "";
  try {
    const planRaw = await apiComplete({
      messages: [
        { role: "system", content: 'أنت مُخطّط بحث. أعِد JSON فقط: {"queries":[4-6 استعلامات بحث مفيدة بالعربية والإنجليزية],"plan":"جملة وصف"} دون أي كلام خارج JSON.' },
        { role: "user", content: q }
      ],
      model: "kilo::kilo-auto/free", stream: false, max_tokens: 600
    });
    const j = JSON.parse(maxChars((planRaw.content || "").replace(/```(json)?/g, ""), 2000).match(/\{[\s\S]*\}/)?.[0] || "{}");
    if (Array.isArray(j.queries) && j.queries.length) queries = j.queries.slice(0, 6).map(String);
    plan = j.plan || "";
  } catch (_) {}

  const first = card.querySelector(".sline");
  first.innerHTML = `<div class="si">✓</div><div><b>الخطة:</b> ${esc_plan(plan || q)}</div>`;
  first.className = "sline done";

  // 2) البحث
  const l2 = addLine("جمع مصادر موثوقة من الويب...", "act");
  const sources = [];
  const seen = new Set();
  for (let k = 0; k < queries.length; k++) {
    try {
      const r = await fetch("/api/search?q=" + encodeURIComponent(queries[k]));
      const j = await r.json();
      for (const it of (j.results || [])) {
        if (seen.has(it.url)) continue;
        if (/^(\/|https:\/\/duckduckgo\.com\/l\/)/.test(it.url)) continue;
        seen.add(it.url); sources.push(it);
      }
    } catch (_) {}
  }
  l2.innerHTML = `<div class="si">✓</div><div>جُمِع ${sources.length} مصدراً فريداً</div>`;
  l2.className = "sline done";

  // 3) قراءة المصادر وتلخيصها
  const top = sources.slice(0, 6);
  const notes = [];
  for (const src of top) {
    const ln = addLine("📄 قراءة: " + maxChars((src.title || src.url).replace(/^\d+\./, "").trim(), 56), "act");
    try {
      const fj = await (await fetch("/api/fetchurl?url=" + encodeURIComponent(src.url))).json();
      if (fj.text && fj.text.length > 250) {
        try {
          const sm = await apiComplete({
            messages: [
              { role: "system", content: "لخّص هذه الصفحة في 6-8 نقاط كثيفة المعلومات بالعربية مرتبطة بالسؤال. أدرج أرقام وتواريخ إن وجدت." },
              { role: "user", content: "السؤال: " + q + "\n\nالمصدر: " + src.url + "\n\nالمحتوى:\n" + maxChars(fj.text, 14000) }
            ],
            model: "auto", stream: false, max_tokens: 700
          });
          if (sm.content && sm.content.length > 40) notes.push({ url: src.url, title: (src.title || src.url), summary: sm.content });
        } catch (_) {}
        ln.innerHTML = `<div class="si">✓</div><div>📄 قُرئ: ${esc(maxChars((src.title || src.url).replace(/^\d+\./, "").trim(), 56))}</div>`;
        ln.className = "sline done";
      } else {
        ln.innerHTML = `<div class="si">·</div><div style="opacity:.5">تخطي: ${esc(maxChars(src.title || src.url, 56))}</div>`;
        ln.className = "sline";
      }
    } catch (_) {
      ln.innerHTML = `<div class="si">·</div><div style="opacity:.5">فشل: ${esc(maxChars(src.title || src.url, 56))}</div>`;
      ln.className = "sline";
    }
  }

  if (!notes.length) {
    ai.error = true;
    ai.content = "⚠️ تعذّر جمع معلومات كافية الآن (حدود خدمات البحث المجانية). جرّب ثانية بعد دقيقة أو غيّر الصياغة.";
    ai._live = false;
    refreshMsg(ai);
    return;
  }

  // 4) التقرير النهائي ببثّ حي مع عزو المصادر
  const l4 = addLine("🎓 صناعة التقرير النهائي مع العزو الدقيق للمصادر...", "act");
  l4.className = "sline act";
  const mats = notes.map((n, i) => "【" + (i + 1) + "】 " + (n.title || "") + " (" + n.url + ")\n" + n.summary).join("\n\n");
  const s2 = getS();
  const msgs = buildMessages(null, { excludeLast: 1, budgetChars: 42000 });
  msgs.push({
    role: "user",
    content: "استند حصراً إلى المواد المرجعية التالية (نتائج بحث ويب حقيقي تم الآن) وقيمها: أجب بتقرير احترافي بالعربية بعناوين ونقاط، وعزِّ كل معلومة برقمها 【n】. في الخاتمة أضف «ما لم يُغطَّ» إن وجد.\n\n" +
      maxChars(mats, 70000) + "\n\n===\nالسؤال/المهمة: " + q
  });
  l4.innerHTML = `<div class="si">✓</div><div>كتابة التقرير النهائي الآن...</div>`;
  await streamInto(ai, msgs);

  if (notes.length) {
    ai.content += "\n\n---\n\n### 📚 المصادر المُستخدمة\n" + notes.map((n, i) => `**【${i + 1}】** [${esc(maxChars((n.title || n.url).replace(/^\d+\./, "").trim(), 70))}](${n.url})`).join("\n\n");
    ai.research = false;
    refreshMsg(ai);
  }
  touch(s);
}

function esc_plan(t) { return esc(maxChars(t, 90)); }

/* ---------- المسار 3: تحليل موقع ---------- */
async function flowSite(url) {
  const s = getS();
  const ai = { id: uid(), role: "assistant", content: "", reasoning: "", provider: "", time: Date.now() };
  s.messages.push(ai);
  $("#chatCol").appendChild(messageNode(ai, s.messages.length - 1, true));
  const node = document.querySelector(`.msg[data-mid="${ai.id}"]`);
  const bub = node.querySelector(".bubble");
  bub.innerHTML = `<div class="step-card"><div class="sline act"><div class="si"></div><div>⏳ أقرأ الموقع كاملاً عبر قارئ ويب مجاني...</div></div></div>`;
  scrollBottom();

  let page = "";
  try {
    const r = await fetch("/api/fetchurl?url=" + encodeURIComponent(url));
    const j = await r.json();
    page = j.text || "";
  } catch (_) {}
  if (page.length < 150) {
    ai.error = true;
    ai.content = "⚠️ تعذّرت قراءة الموقع (قد يكون محمياً أو يمنع الزوّر أنظمة). جرّب رابطاً آخر أو انتظر قليلاً ثم أعد المحاولة.";
    ai._live = false;
    refreshMsg(ai);
    return;
  }
  await streamInto(ai, [{
    role: "system",
    content: DEFAULT_SYSTEM + "\nأنت الآن محلّل مواقع محترف."
  }, {
    role: "user",
    content: "حلّل هذا الموقع تحليلاً متعمقاً: " + url + "\n\nالمحتوى:\n" + maxChars(page, 34000) + "\n\nالمطلوب تقرير: نظرة عامة، الفكرة والهدف، الجمهور، الهيكل، نقاط القوة، الثغرات/الملاحظات، تجربة الاستخدام، و3-5 اقتراحات للتحسين، وخلاصة قصيرة. بالعربية."
  }]);
}

/* ---------- المسار 4: توليد الصور (مجاني بلا مفتاح) ---------- */
async function genImage(prompt) {
  if (!prompt) { toast("اكتب وصف الصورة أولًا"); return; }
  const s = getS();
  const enriched = prompt + " — فن فاخر، تركيب متقن، إضاءة سينمائية، تفاصيل دقيقة";
  const seed = Math.floor(Math.random() * 1e9);
  const img = "https://image.pollinations.ai/prompt/" + encodeURIComponent(enriched) + "?width=1024&height=1024&seed=" + seed + "&nologo=true&model=flux";
  const m1 = { id: uid(), role: "user", content: "🎨 " + prompt, time: Date.now() };
  const m2 = { id: uid(), role: "assistant", image: img, caption: "جارٍ توليد الصورة مجاناً (قد يصل إلى الدقيقة)...", seed, prompt: enriched, time: Date.now() };
  s.messages.push(m1, m2);
  touch(s);
  $("#chatCol").querySelector(".welcome")?.remove();
  appendNewUserNode(s, m1);
  const node = messageNode(m2, s.messages.length - 1, true);
  $("#chatCol").appendChild(node);
  scrollBottom();
}

function regenImage(m) {
  m.seed = Math.floor(Math.random() * 1e9);
  m.image = "https://image.pollinations.ai/prompt/" + encodeURIComponent(m.prompt) + "?width=1024&height=1024&seed=" + m.seed + "&nologo=true&model=flux";
  delete m.loaded;
  refreshMsg(m);
  touch(getS());
}

/* ---------- إعادة التوليد ---------- */
function regenerate(idx) {
  const s = getS();
  if (busy) return;
  const m = s.messages[idx];
  if (!m || m.role !== "assistant") return;
  let cut = idx;
  while (cut > 0 && s.messages[cut - 1].role === "assistant" && !s.messages[cut - 1].image) cut--;
  const userMsg = s.messages[cut - 1];
  if (!userMsg || userMsg.role !== "user") return;
  s.messages = s.messages.slice(0, cut);
  renderChat();
  busy = true; setBusyUI(true);
  (async () => {
    const ai = { id: uid(), role: "assistant", content: "", reasoning: "", provider: "", time: Date.now() };
    s.messages.push(ai);
    $("#chatCol").appendChild(messageNode(ai, s.messages.length - 1, true));
    const msgs = buildMessages(null, { excludeLast: 1 });
    const texts = (userMsg.files || []).filter(f => f.text).map(f => "===== " + f.name + " =====\n" + maxChars(f.text, 14000)).join("\n\n");
    msgs.push({ role: "user", content: texts ? userMsg.content + "\n\n--- مرفقات ---\n" + texts : userMsg.content });
    await streamInto(ai, msgs);
    busy = false; setBusyUI(false); saveSoon(); updateCtxBar(); maybeCompact();
  })();
}

/* ---------- UI الحالية ---------- */
function setBusyUI(v) {
  $("#btnSend").style.display = v ? "none" : "";
  $("#btnStop").style.display = v ? "" : "none";
  $("#input").placeholder = v ? "يعمل نبراس الآن..." : placeholderForMode();
}

/* ---------- إدخال صوتي (مجاني في المتصفح) ---------- */
let recog = null;
function toggleMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast("متصفحك لا يدعم الإدخال الصوتي — استخدم Chrome أو Edge"); return; }
  if (recog) { recog.stop(); return; }
  recog = new SR();
  recog.lang = "ar-SA";
  recog.continuous = true;
  recog.interimResults = true;
  const inp = $("#input");
  recog.onresult = (e) => {
    let t = "";
    for (const r of e.results) t += r[0].transcript;
    inp.value = t;
    autoGrow();
  };
  recog.onend = () => { recog = null; $("#btnMic").classList.remove("on"); };
  recog.onerror = () => { recog = null; $("#btnMic").classList.remove("on"); };
  recog.start();
  $("#btnMic").classList.add("on");
  toast("🎙️ أُستمع إليك... تحدّث بالعربية");
}

/* ---------- ربط الواجهة ---------- */
function placeholderForMode() {
  return {
    chat: "اكتب رسالتك هنا... (Enter للإرسال، Shift+Enter لسطر جديد)",
    research: "اسأل أي سؤال يريد بحثاً عميقاً مع مصادر حقيقية...",
    site: "الصق رابط الموقع لتحليله — مثل: https://example.com",
    img: "صف الصورة التي سأرسمها لك بالكلام...",
    video: "اكتب موضوع الفيديو ثم اضغط Enter لفتح استوديو الإنتاج..."
  }[currentMode];
}

function bindUI() {
  const inp = $("#input");
  inp.addEventListener("input", autoGrow);
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $("#btnSend").onclick = send;
  $("#btnStop").onclick = () => streamingCtrl && streamingCtrl.abort();
  $("#btnMic").onclick = toggleMic;
  $("#btnAttach").onclick = () => $("#fileInput").click();
  $("#fileInput").onchange = (e) => { addFiles([...e.target.files]); e.target.value = ""; };
  $("#btnNew").onclick = () => { if (!busy) newSession(); else toast("انتظر انتهاء العمل الحالي أولًا"); };
  $("#btnSide").onclick = () => toggleSidebar();
  $("#backdrop").onclick = () => toggleSidebar(false);
  $("#sessSearch").addEventListener("input", () => renderSessions());

  $("#modebar").addEventListener("click", (e) => {
    const b = e.target.closest(".mode-chip");
    if (!b) return;
    setMode(b.dataset.mode);
    if (b.dataset.mode === "video") vdOpen(inp.value.trim());
  });

  // استوديو الفيديو
  $("#vdStart").onclick = vdRun;
  $("#vdClose").onclick = () => {
    if (VD.running) { toast("⏳ الإنتاج جارٍ — انتظر انتهاء التسجيل أولاً"); return; }
    $("#videoOverlay").classList.remove("open");
  };
  $("#vdNarration").onchange = (e) => { VD.narration = e.target.checked; };
  $("#vdMusic").onchange = (e) => { VD.music = e.target.checked; };
  const pick = (sel, key, attr, cast) => {
    $(sel).addEventListener("click", (e) => {
      const b = e.target.closest(".sm");
      if (!b || VD.running) return;
      document.querySelectorAll(sel + " .sm").forEach(x => x.classList.toggle("on", x === b));
      VD[key] = cast ? cast(b.dataset[attr]) : b.dataset[attr];
    });
  };
  pick("#vdScenes", "scenes", "n", Number);
  pick("#vdAspect", "aspect", "v");
  pick("#vdStyle", "style", "s");
  $("#videoOverlay").addEventListener("click", (e) => {
    if (e.target.id === "videoOverlay" && !VD.running) e.target.classList.remove("open");
  });

  document.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.items || [])].filter(i => i.kind === "file").map(i => i.getAsFile()).filter(Boolean);
    if (files.length) { addFiles(files); toast("تم لصق المرفق ✓"); }
  });

  const dz = $("#chat");
  ["dragover", "dragenter"].forEach(ev => document.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("dropzone"); }));
  ["dragleave", "drop"].forEach(ev => document.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === "dragleave" && e.relatedTarget) return;
    dz.classList.remove("dropzone");
  }));
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) addFiles(files);
  });

  $("#btnViewerClose").onclick = () => $("#viewer").classList.remove("open");
  $("#btnViewerCopy").onclick = () => { navigator.clipboard.writeText($("#vBody").textContent || ""); toast("تم نسخ محتوى العارض ✓"); };
  $("#lightbox").onclick = () => $("#lightbox").classList.remove("open");
  $("#healthLabel").onclick = openSettings;

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { $("#viewer").classList.remove("open"); $("#lightbox").classList.remove("open"); $("#settingsOverlay").classList.remove("open"); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if (!busy) newSession(); }
  });

  $("#btnSettings").onclick = openSettings;
  $("#btnSaveSettings").onclick = () => {
    settings.systemPrompt = $("#setSystem").value.trim();
    saveSettings();
    $("#settingsOverlay").classList.remove("open");
    toast("حُفظت الإعدادات ✓");
  };
  $("#btnClearAll").onclick = async () => {
    if (!confirm("مسح جميع المحادثات والإعدادات نهائياً؟")) return;
    for (const s of sessions) await DB.del(s.id);
    sessions = [];
    settings = { systemPrompt: "", persona: "", accent: "violet", model: "auto" };
    localStorage.removeItem("nibras_settings");
    newSession();
    $("#settingsOverlay").classList.remove("open");
    toast("تم التصفير الكامل 🧹");
  };
  $("#btnExport").onclick = () => {
    const blob = new Blob([JSON.stringify({ sessions, settings }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "nibras-backup.json";
    a.click();
  };
  $("#btnImport").onclick = () => {
    const i = document.createElement("input");
    i.type = "file"; i.accept = "application/json";
    i.onchange = async () => {
      try {
        const j = JSON.parse(await i.files[0].text());
        if (Array.isArray(j.sessions)) {
          for (const s of j.sessions) if (s && s.id && !sessions.some(x => x.id === s.id)) { sessions.push(s); await DB.put(s); }
        }
        if (j.settings && typeof j.settings === "object") { Object.assign(settings, j.settings); saveSettings(); applyAccent(settings.accent); $("#modelSel").value = settings.model; }
        sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        activeId = sessions[0]?.id || null;
        if (!activeId) newSession(); else { renderSessions(); renderChat(); }
        toast("تم الاستيراد ✓");
      } catch (e) { toast("ملف غير صالح ✕"); }
    };
    i.click();
  };

  $("#personaSeg").addEventListener("click", (e) => {
    const b = e.target.closest(".sm"); if (!b) return;
    settings.persona = b.dataset.p;
    document.querySelectorAll("#personaSeg .sm").forEach(x => x.classList.toggle("on", x === b));
    saveSettings();
    toast("تم تبديل الشخصية: " + b.textContent.trim());
  });
  $("#accentSeg").addEventListener("click", (e) => {
    const b = e.target.closest(".sm"); if (!b) return;
    settings.accent = b.dataset.a;
    document.querySelectorAll("#accentSeg .sm").forEach(x => x.classList.toggle("on", x === b));
    applyAccent(b.dataset.a); saveSettings();
  });

  $("#settingsOverlay").addEventListener("click", (e) => { if (e.target.id === "settingsOverlay") e.target.classList.remove("open"); });
}

function toggleSidebar(force) {
  const sb = $("#sidebar"), bd = $("#backdrop");
  const open = force != null ? force : !sb.classList.contains("open");
  sb.classList.toggle("open", open);
  bd.classList.toggle("open", open && window.innerWidth <= 900);
}

function openSettings() {
  $("#setSystem").value = settings.systemPrompt || "";
  document.querySelectorAll("#personaSeg .sm").forEach(x => x.classList.toggle("on", (x.dataset.p || "") === (settings.persona || "")));
  document.querySelectorAll("#accentSeg .sm").forEach(x => x.classList.toggle("on", x.dataset.a === settings.accent));
  refreshHealth();
  $("#settingsOverlay").classList.add("open");
}

function applyAccent(a) {
  if (a && a !== "violet") document.documentElement.setAttribute("data-accent", a);
  else document.documentElement.removeAttribute("data-accent");
}
function saveSettings() { localStorage.setItem("nibras_settings", JSON.stringify(settings)); }

function setMode(m) {
  currentMode = m;
  document.querySelectorAll(".mode-chip").forEach(x => x.classList.toggle("on", x.dataset.mode === m));
  const inp = $("#input");
  if (inp) inp.placeholder = placeholderForMode();
}

/* ============================================================
   🎬 استوديو الفيديو — إنتاج فيديو كامل مجاناً وبلا أي مفتاح
   خط الأنابيب: فكرة → سيناريو ومشاهد (نموذج مجاني) → صور Flux
   → تعليق صوتي عربي + موسيقى مولّدة → مونتاج على Canvas → تصدير فيديو.
   ============================================================ */
const VD = {
  aspect: "16:9",
  style: "cinematic",
  scenes: 6,
  narration: true,
  music: true,
  running: false,
  blob: null
};
const VD_SIZE = { "16:9": [1280, 720], "9:16": [720, 1280], "1:1": [960, 960] };
const VD_STYLE_PROMPT = {
  cinematic: "cinematic film still, dramatic volumetric light, shallow depth of field, 35mm, ultra detailed, no text, no watermark",
  documentary: "documentary photograph, natural light, authentic, editorial, ultra detailed, no text, no watermark",
  anime: "anime key visual, painterly, vibrant, studio quality, no text, no watermark",
  "3d": "3d render, octane, soft studio lighting, ultra detailed, no text, no watermark"
};
const VD_STYLE_LABEL = { cinematic: "سينمائي واقعي", documentary: "وثائقي", anime: "أنمي", "3d": "ثلاثي الأبعاد" };

function vdOpen(prompt) {
  if (VD.running) { toast("⏳ الإنتاج جارٍ الآن"); return; }
  $("#vdTopic").value = prompt || $("#vdTopic").value || "";
  $("#vdResult").innerHTML = "";
  $("#vdLines").innerHTML = "";
  vdBar(0);
  $("#videoOverlay").classList.add("open");
  setTimeout(() => $("#vdTopic").focus(), 120);
}

function vdLine(text, state) {
  const d = document.createElement("div");
  d.className = "sline " + (state || "");
  d.innerHTML = `<div class="si">${state === "done" ? "✓" : ""}</div><div>${esc(text)}</div>`;
  $("#vdLines").appendChild(d);
  return d;
}
function vdBar(p) {
  const el = $("#vdBar");
  if (el) el.style.width = Math.max(0, Math.min(1, p)) * 100 + "%";
}

async function vdPlan(topic, n) {
  const r = await fetch("/api/video/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ topic, scenes: n, style: VD_STYLE_LABEL[VD.style] || "سينمائي واقعي" })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.scenes || !j.scenes.length) throw new Error(j.error || "تعذّر بناء خطة الفيديو، جرّب مرة أخرى");
  return j;
}

function vdImage(prompt, seed, W, H) {
  const url = "https://image.pollinations.ai/prompt/" + encodeURIComponent(prompt) +
    "?width=" + W + "&height=" + H + "&seed=" + seed + "&nologo=true&model=flux";
  return new Promise((resolve) => {
    let tries = 0;
    const go = () => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => resolve(im);
      im.onerror = () => { if (++tries < 3) setTimeout(go, 1600); else resolve(null); };
      im.src = url + (tries ? "&r=" + tries : "");
    };
    go();
  });
}

async function vdTTS(text) {
  try {
    const r = await fetch("/api/tts?lang=ar&text=" + encodeURIComponent(maxChars(text || "", 700)));
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    return ab.byteLength > 2400 ? ab : null;
  } catch (_) { return null; }
}

async function vdFonts() {
  try {
    if (!document.fonts) return;
    await Promise.all([
      document.fonts.load("900 40px Cairo"),
      document.fonts.load("800 40px Cairo"),
      document.fonts.load("700 40px Cairo")
    ]);
    await document.fonts.ready;
  } catch (_) {}
}

function vdWrap(ctx, text, maxW) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

function vdDrawScene(ctx, img, prog, idx, W, H) {
  if (!img) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#141026");
    g.addColorStop(1, "#2a1c3d");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    return;
  }
  const zoom = 1.06 + 0.12 * Math.min(1, prog);
  const sw = img.width / zoom, sh = img.height / zoom;
  const cx = [0.5, 0.44, 0.56, 0.5][idx % 4];
  const cy = [0.5, 0.56, 0.44, 0.52][idx % 4];
  const sx = Math.max(0, Math.min(img.width - sw, img.width * cx - sw / 2));
  const sy = Math.max(0, Math.min(img.height - sh, img.height * cy - sh / 2));
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
}

function vdScrim(ctx, W, H) {
  const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
  g.addColorStop(0, "rgba(3,3,10,0)");
  g.addColorStop(1, "rgba(3,3,10,.88)");
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.45, W, H * 0.55);
}

function vdCard(ctx, plan, W, H, alpha, isTitle) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "rgba(4,4,12,.88)");
  g.addColorStop(.55, "rgba(4,4,12,.6)");
  g.addColorStop(1, "rgba(4,4,12,.92)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.direction = "rtl";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tfs = Math.round(W / 13);
  ctx.font = "900 " + tfs + 'px Cairo, "Segoe UI", sans-serif';
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(124,92,255,.6)";
  ctx.shadowBlur = tfs * 0.55;
  const lines = vdWrap(ctx, isTitle ? plan.title : "شكراً للمشاهدة", W * 0.84);
  let y = H / 2 - (lines.length - 1) * tfs * 0.62 - (isTitle ? tfs * 0.6 : 0);
  for (const l of lines) { ctx.fillText(l, W / 2, y); y += tfs * 1.22; }
  ctx.shadowBlur = 0;

  ctx.font = "700 " + Math.round(W / 34) + "px Cairo, sans-serif";
  ctx.fillStyle = "#e0c068";
  ctx.fillText(isTitle ? plan.subtitle : plan.title, W / 2, y + tfs * 0.3);

  ctx.font = "700 " + Math.round(W / 48) + "px Cairo, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,.5)";
  ctx.fillText("✦ نبراس AI — فيديو مولّد مجاناً بلا مفاتيح", W / 2, H - Math.round(H * 0.085));
  ctx.restore();
}

function vdPaint(ctx, st) {
  const { plan, images, starts, durs, total, el, W, H } = st;
  ctx.save();
  ctx.fillStyle = "#05050b";
  ctx.fillRect(0, 0, W, H);

  let i = 0;
  while (i + 1 < starts.length && el >= starts[i + 1]) i++;
  const local = Math.max(0, el - starts[i]);
  const prog = Math.min(1, local / Math.max(0.1, durs[i]));
  const fade = Math.min(0.9, durs[i] * 0.22);

  if (i > 0 && local < fade && images[i - 1]) {
    vdDrawScene(ctx, images[i - 1], 1, i - 1, W, H);
    ctx.globalAlpha = local / fade;
    vdDrawScene(ctx, images[i], prog, i, W, H);
    ctx.globalAlpha = 1;
  } else {
    vdDrawScene(ctx, images[i], prog, i, W, H);
  }

  vdScrim(ctx, W, H);

  // نص المشهد (كابشن)
  const capA = Math.min(1, Math.max(0, Math.min((local - 0.35) / 0.5, (durs[i] - local - 0.15) / 0.4)));
  const cap = plan.scenes[i] && plan.scenes[i].caption;
  if (cap && capA > 0.01) {
    ctx.globalAlpha = capA;
    ctx.direction = "rtl";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const fs = Math.round(W / 22);
    ctx.font = "800 " + fs + 'px Cairo, "Segoe UI", sans-serif';
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0,0,0,.9)";
    ctx.shadowBlur = fs * 0.55;
    const lines = vdWrap(ctx, cap, W * 0.8);
    let y = H - Math.round(H * 0.12) - (lines.length - 1) * fs * 1.3;
    for (const l of lines) { ctx.fillText(l, W / 2, y); y += fs * 1.3; }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  // العلامة والعداد
  ctx.direction = "ltr";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(255,255,255,.7)";
  ctx.font = "700 " + Math.round(W / 54) + "px Cairo, sans-serif";
  ctx.fillText("✦ NIBRAS AI", W * 0.035, H * 0.04);
  ctx.textAlign = "right";
  ctx.fillText((i + 1) + " / " + plan.scenes.length, W * 0.965, H * 0.04);

  // شريط التقدم
  const bh = Math.max(4, Math.round(H * 0.009));
  ctx.fillStyle = "rgba(255,255,255,.16)";
  ctx.fillRect(0, H - bh, W, bh);
  const g2 = ctx.createLinearGradient(0, 0, W, 0);
  g2.addColorStop(0, "#7c5cff");
  g2.addColorStop(.6, "#b24bf3");
  g2.addColorStop(1, "#e0c068");
  ctx.fillStyle = g2;
  ctx.fillRect(0, H - bh, W * Math.min(1, el / total), bh);

  // بطاقتا البداية والنهاية
  const tA = el < 2.9 ? Math.max(0, Math.min(1, (2.9 - el) / 0.7, el / 0.45)) : 0;
  if (tA > 0.01) vdCard(ctx, plan, W, H, tA, true);
  const eA = el > total - 3.1 ? Math.max(0, Math.min(1, (el - (total - 3.1)) / 0.7)) : 0;
  if (eA > 0.01) vdCard(ctx, plan, W, H, eA, false);

  ctx.restore();
}

function vdMusic(ac, dest, mood) {
  const scales = { calm: [0, 4, 7, 11], epic: [0, 3, 5, 7, 10], uplifting: [0, 4, 7, 9], mysterious: [0, 3, 7, 10] };
  const scale = scales[mood] || scales.calm;
  const root = mood === "epic" ? 65.41 : 55;
  const bus = ac.createGain();
  bus.gain.value = 0.09;
  bus.connect(dest);
  const nodes = [];
  [0, 1].forEach((_, i) => {
    const o = ac.createOscillator();
    o.type = i ? "triangle" : "sine";
    o.frequency.value = root * (i ? 1.5 : 1);
    const g = ac.createGain();
    g.gain.value = i ? 0.3 : 0.55;
    o.connect(g);
    g.connect(bus);
    o.start();
    nodes.push(o);
  });
  let step = 0;
  const timer = setInterval(() => {
    const semi = scale[step++ % scale.length];
    const f = root * 4 * Math.pow(2, semi / 12);
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    const g = ac.createGain();
    const t = ac.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.7);
    g.gain.exponentialRampToValueAtTime(0.0006, t + 3.4);
    o.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + 3.6);
  }, 2600);
  return () => {
    clearInterval(timer);
    nodes.forEach(o => { try { o.stop(); } catch (_) {} });
    try { bus.disconnect(); } catch (_) {}
  };
}

function vdPickMime() {
  const list = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  for (const m of list) {
    try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m; } catch (_) {}
  }
  return "";
}

async function vdRecord({ plan, images, narrations, W, H }) {
  const cv = $("#vdPreview");
  cv.width = W;
  cv.height = H;
  cv.classList.add("on");
  const ctx = cv.getContext("2d");
  await vdFonts();

  const stream = cv.captureStream(30);
  const AC = window.AudioContext || window.webkitAudioContext;
  let ac = null, master = null, padStop = null;
  try {
    ac = new AC();
    master = ac.createGain();
    master.gain.value = 1;
    const dest = ac.createMediaStreamDestination();
    master.connect(dest);
    master.connect(ac.destination);
    if (VD.music) padStop = vdMusic(ac, master, plan.mood);
    stream.addTrack(dest.stream.getAudioTracks()[0]);
  } catch (_) { ac = null; }

  const decoded = [];
  for (const ab of narrations) {
    if (!ac || !VD.narration || !ab) { decoded.push(null); continue; }
    try { decoded.push(await ac.decodeAudioData(ab.slice(0))); } catch (_) { decoded.push(null); }
  }

  const durs = plan.scenes.map((s, i) => decoded[i] ? Math.max(3.0, decoded[i].duration + 1.2) : 4.6);
  const starts = [];
  let acc = 0;
  for (const d of durs) { starts.push(acc); acc += d; }
  const total = acc;

  const mime = vdPickMime();
  if (!window.MediaRecorder) throw new Error("متصفحك لا يدعم تسجيل الفيديو — استخدم Chrome أو Edge");
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 4500000 } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((res) => { rec.onstop = res; rec.onerror = res; });

  rec.start(200);
  if (ac) {
    const at = ac.currentTime + 0.3;
    decoded.forEach((b, i) => {
      if (!b) return;
      const src = ac.createBufferSource();
      src.buffer = b;
      const g = ac.createGain();
      g.gain.value = 1;
      src.connect(g);
      g.connect(master);
      src.start(at + starts[i]);
    });
  }

  const t0 = performance.now() + 300;
  await new Promise((res) => {
    const loop = () => {
      const raw = (performance.now() - t0) / 1000;
      const e = Math.max(0, Math.min(raw, total));
      vdPaint(ctx, { plan, images, starts, durs, total, el: e, W, H });
      vdBar(0.78 + 0.2 * (e / total));
      if (raw >= total) { res(); return; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

  try { rec.stop(); } catch (_) {}
  await stopped;
  try { stream.getTracks().forEach(t => t.stop()); } catch (_) {}
  if (padStop) padStop();
  try { if (ac) await ac.close(); } catch (_) {}

  return { blob: new Blob(chunks, { type: mime || "video/webm" }), duration: total, mime: mime || "video/webm" };
}

function vdShowResult(plan, res) {
  const url = URL.createObjectURL(res.blob);
  VD.blob = res.blob;
  const ext = /mp4/.test(res.mime) ? "mp4" : "webm";
  VD.lastUrl = url;
  $("#vdResult").innerHTML = `
    <div class="vd-final">
      <video src="${url}" controls playsinline></video>
      <div class="vd-final-bar">
        <div class="vfb-meta"><b>${esc(plan.title)}</b><span>${Math.round(res.duration)} ثانية · ${fmtSize(res.blob.size)} · ${ext.toUpperCase()}</span></div>
        <button class="mini-btn" id="vdDl">⬇ تنزيل</button>
        <button class="mini-btn" id="vdToChat">💬 أضِف للمحادثة</button>
      </div>
    </div>`;
  $("#vdDl").onclick = () => {
    const a = document.createElement("a");
    a.href = url;
    a.download = "nibras-" + String(plan.title || "video").replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 40) + "." + ext;
    a.click();
  };
  $("#vdToChat").onclick = () => {
    vdPushChat(plan, url);
    $("#videoOverlay").classList.remove("open");
    toast("أُضيف الفيديو إلى المحادثة ✓");
  };
}

function vdPushChat(plan, url) {
  const s = getS() || newSession();
  const m1 = { id: uid(), role: "user", content: "🎬 أنشئ فيديو: " + plan.title, time: Date.now() };
  const m2 = { id: uid(), role: "assistant", content: "", video: url, videoTitle: plan.title, caption: plan.subtitle, time: Date.now() };
  s.messages.push(m1, m2);
  touch(s);
  renderChat();
  scrollBottom();
}

async function vdRun() {
  if (VD.running) return;
  const topic = ($("#vdTopic").value || "").trim();
  if (!topic) { toast("اكتب موضوع الفيديو أولًا"); return; }
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    toast("متصفحك لا يدعم تسجيل الفيديو — جرّب Chrome أو Edge الحديث");
    return;
  }
  VD.running = true;
  const btn = $("#vdStart");
  btn.disabled = true;
  btn.textContent = "⏳ جارٍ الإنتاج...";
  $("#vdResult").innerHTML = "";
  $("#vdLines").innerHTML = "";
  vdBar(0);

  try {
    const [W, H] = VD_SIZE[VD.aspect] || VD_SIZE["16:9"];

    const l1 = vdLine("📝 كتابة السيناريو وخطة المشاهد...", "act");
    const plan = await vdPlan(topic, VD.scenes);
    l1.className = "sline done";
    l1.innerHTML = `<div class="si">✓</div><div>«${esc(plan.title)}» — ${plan.scenes.length} مشاهد · ${esc(plan.provider || "")}</div>`;
    vdBar(0.08);

    const l2 = vdLine("🎨 رسم المشاهد بصرياً بصور مجانية...", "act");
    const images = [];
    for (let i = 0; i < plan.scenes.length; i++) {
      const seed = Math.floor(Math.random() * 1e9);
      const prompt = plan.scenes[i].image + ", " + (VD_STYLE_PROMPT[VD.style] || VD_STYLE_PROMPT.cinematic);
      images.push(await vdImage(prompt, seed, W, H));
      l2.innerHTML = `<div class="si">✓</div><div>رُسم ${i + 1} من ${plan.scenes.length} مشاهد</div>`;
      vdBar(0.08 + 0.55 * ((i + 1) / plan.scenes.length));
    }
    l2.className = "sline done";

    const narrations = [];
    if (VD.narration) {
      const l3 = vdLine("🎙️ تسجيل التعليق الصوتي العربي...", "act");
      for (let i = 0; i < plan.scenes.length; i++) {
        narrations.push(await vdTTS(plan.scenes[i].narration));
        vdBar(0.63 + 0.13 * ((i + 1) / plan.scenes.length));
      }
      const ok = narrations.filter(Boolean).length;
      l3.className = "sline done";
      l3.innerHTML = `<div class="si">✓</div><div>${ok ? "التعليق الصوتي جاهز (" + ok + " مقطع)" : "خدمة النطق مشغولة — سيكون الفيديو بموسيقى فقط"}</div>`;
    }

    const l4 = vdLine("🎬 المونتاج والتسجيل — أبقِ التبويب مفتوحاً", "act");
    const res = await vdRecord({ plan, images, narrations, W, H });
    l4.className = "sline done";
    l4.innerHTML = `<div class="si">✓</div><div>تم التسجيل: ${Math.round(res.duration)} ثانية · ${fmtSize(res.blob.size)}</div>`;
    vdBar(1);
    vdShowResult(plan, res);
  } catch (e) {
    const el = vdLine("❌ " + (e && e.message ? e.message : String(e)), "done");
    el.style.color = "var(--danger)";
  } finally {
    VD.running = false;
    btn.disabled = false;
    btn.textContent = "✨ ابدأ الإنتاج";
  }
}
