// ============================================================
// ============================================================================
// CHIBANI AI — منصة عالمية ضخمة لجميع مديح الابتكار والذكاء الاصطناعي
// خط الأنابيب المتكامل: دردشة + بحث + تحليل مواقع + ملفات + صور + فيديو + أدوات مخصصة
// لا مفتاح API في المتصفح، المزوّدون مجرّد حسابات/استدعاءات خادم تحويهم البنية.
// ============================================================================
"use strict";

/* ---------- أدوات ---------- */
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t).replace(/[&<>"'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
      const r = indexedDB.open("chibani_ai", 1);
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

/* ===========================================================================
   الخبراء (chingarious — إجابات دقيقة في كل مجال من مجالات المعرفة،
   إجابة متنوّعة مع التفكير العميق والبرمجة والدقة المطلوبة).
   =========================================================================== */
const PERSONAS = {
  "": "أنت «ذكاء اصطناعي عالمي» — مساعد فائق الدقة، يتفكّر خطوة خطوة ثم يعطيك الإجابة الصحيحة المطلوبة في المجال المعني، مع تنظيم الردوق بعناوين ونقاط واضحة، وقبول المعلومات الجديدة بثقة مع الشك الدقيق عند الحاجة.",
  code: "أنت «خبير البرمجة» — أجب بكمية كود فعّالة ونظيفة مع شرح المعمارية والبدائل، وتحليل الأخطاء ونصائح التحسين، بالعربية والإنجليزية كما يُفهم كل منهما، بالطبع مع الإشارة إلى حدود الموثوقية.",
  analy: "أنت «محلّل بيانات وفكر عميق» — قسّم أي مشكلة إلى: نظرة عامة، تفاصيل جوهرية، نقاط قوة/ضعف، تقييم رقمي، وخلاصة عملية، واذكر ما لم يُغطَّ بوضوح.",
  write: "أنت «كاتب عربي فاخر» — اكتب نصوصاً راقية أسلوبها واضح تناسب الجمهور المستهدف، باختيارات صياغة واضحة، مع خيارات بديلة عند الطلب، وبنية قوية للفقرة والفقرة.",
  tutor: "أنت «مدرّس خطوة خطوة» — اشرح بمثيلات بسيطة، وتحقق من الفهم بأسئلة قصيرة، وكرر الشرح بطريقة مختلفة حتى يثبت الفهم، وامنح مصادر للقراءة الإضافية عند الحاجة.",
  biz: "أنت «مستشار أعمال وتنفيذ» — ركّز على الجدوى والتكلفة والجمهور المستهدف والخطوات التنفيذية المرقّمة، مع مقاييس النجاح وتتبع التقدم."
};

const DEFAULT_SYSTEM = "أنت «نبراس» — مساعد ذكاء اصطناعي فائق، عملي ودقيق. تُجيب بالعربية الفصحى الواضحة (مع المصطلحات التقنية إن وجدت)، وتنظّم الردود بعناوين ونقاط وصناديق كود عند الحاجة. إن لم تكن متأكداً من معلومة فصرّح بذلك بوضوح بدلاً من اختراعها.";

/* ---------- تهيئة ---------- */
(async function init() {
  await DB.open();
  try { Object.assign(settings, JSON.parse(localStorage.getItem("chibani_settings") || "{}")); } catch (_) {}
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
  sel.value = settings.model || "auto";  sel.onchange = () => { settings.model = sel.value; saveSettings(); };

/* ---------- الخبراء (4 تخصصات) ---------- */
const SKILLS = {
  programming: {
    id: "برمجة", label: "برمجة", brief: "أجيب بكمية كود فعّالة و Clean، وأشرح المعمارية، أتحلّل الأخطاء، وأوصي بالتحسين.",
    system: "أنت خبير برمجة عالمي. أجب بكمية كود فعّالة ونظيفة، وشرح المعمارية والبدائل، تحليل الأخطاء، ونصائح التحسين، بالعربية والإنجليزية مع الإشارة إلى حدود الموثوقية."
  },
  analysis: {
    id: "تحليل", label: "تحليل", brief: "أقسّم المشكلة، أربط القطع، وأقيمها رقمياً.",
    system: "أنت محلّل بيانات وفكر عميق. قسّم أي مشكلة إلى: نظرة عامة، تفاصيل جوهرية، نقاط قوة/ضعف، تقييم رقمي، وخلاصة عملية، واذكر ما لم يُغطَّ بوضوح."
  },
  teaching: {
    id: "تعليم", label: "تعليم", brief: "أشرح بخطوات، أثبّت الفهم بأسئلة، أكرر لغايات مختلفة.",
    system: "أنت مدرّس خطوة خطوة. اشرح بالتشبيهات البسيطة، وتحقق من الفهم بأسئلة قصيرة، وكرر الشرح بطريقة مختلفة حتى يثبت الفهم، وامنح مصادر للقراءة الإضافية."
  },
  business: {
    id: "أعمال", label: "أعمال", brief: "ارسم خارطة طريق، وآخذ الجدوى والتكلفة والجمهور في الاعتبار، وأتبع الخطوات والمقاييس.",
    system: "أنت مستشار أعمال وتنفيذ. ركّز على الجدوى والتكلفة والجمهور المستهدف والخطوات التنفيذية المرقّمة، مع مقاييس النجاح وتتبع التقدم."
  }
};

function applySkills(s, id) {
  const expert = SKILLS[id];
  if (!expert) return;
  const sys = (s.settings.systemPrompt || "").trim();
  s.settings.systemPrompt = `${expert.system}\n\n${sys ? sys + "\n\n" : ""}`;  s.settings.wasExpert = id;
}

function aks() {
  return Object.values(SKILLS).map(s => ({ id: s.id, label: s.label, brief: s.brief }));
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

// ------------------------------------------------- 
// الصحة ----------
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
}