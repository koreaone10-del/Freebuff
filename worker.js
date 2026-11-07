// ============================================================
// CHIBANI AI — Worker بدون أي مفاتيح API
// يعتمد فقط على مزوّدين مجانيين يعملون بدون حساب:
//  1) Pollinations  (GPT-OSS-20B: تفكير + أدوات)
//  2) LLM7.io       (MiniMax-M2.7، Codestral)
//  3) Kilo Gateway  (kilo-auto/free، Nemotron Ultra 550B، VL للرؤية)
//  4) OVH AI        (gpt-oss-120b، Llama-3.3-70B، Qwen2.5-VL للصور، Whisper)
// القراءة والبحث: r.jina.ai + DuckDuckGo Lite (مجاني بدون مفتاح)
// ============================================================

const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36" };
const maxChars = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n) : s; };

const PROVIDERS = [
  {
    id: "pollinations",
    label: "Pollinations",
    url: "https://text.pollinations.ai/openai",
    headers: {},
    entryModels: [
      { id: "openai-fast", name: "GPT-OSS 20B (تفكير)", interval: 31000, reasoning: true, vision: false, tools: true }
    ]
  },
  {
    id: "llm7",
    label: "LLM7",
    url: "https://api.llm7.io/v1/chat/completions",
    headers: { authorization: "Bearer unused" },
    entryModels: [
      { id: "minimax-m2.7", name: "MiniMax M2.7", interval: 14000, reasoning: true, vision: false, tools: false },
      { id: "codestral-latest", name: "Codestral (برمجة)", interval: 14000, reasoning: false, vision: false, tools: false }
    ]
  },
  {
    id: "kilo",
    label: "Kilo Gateway",
    url: "https://ai-gateway.kilo.ai/api/v1/chat/completions",
    headers: {},
    entryModels: [
      { id: "kilo-auto/free", name: "Kilo Auto (حر)", interval: 2500, reasoning: true, vision: false, tools: true },
      { id: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "Nemotron Ultra 550B (ضخم)", interval: 2500, reasoning: true, vision: false, tools: false },
      { id: "cohere/north-mini-code:free", name: "North Code (برمجة)", interval: 2500, reasoning: false, vision: false, tools: false },
      { id: "nvidia/nemotron-3.5-super-vl:free", name: "Nemotron VL (رؤية)", interval: 2500, reasoning: true, vision: true, tools: false }
    ]
  },
  {
    id: "ovh",
    label: "OVH AI",
    url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
    headers: {},
    entryModels: [
      { id: "gpt-oss-120b", name: "GPT-OSS 120B (ضخم)", interval: 31000, reasoning: true, vision: false, tools: false },
      { id: "Qwen3.5-397B-A17B", name: "Qwen3.5 397B (ضخم)", interval: 31000, reasoning: false, vision: false, tools: false },
      { id: "Meta-Llama-3_3-70B-Instruct", name: "Llama 3.3 70B", interval: 31000, reasoning: false, vision: false, tools: false },
      { id: "Mistral-Small-3.2-24B-Instruct-2506", name: "Mistral Small 3.2", interval: 31000, reasoning: false, vision: false, tools: false },
      { id: "Qwen2.5-VL-72B-Instruct", name: "Qwen2.5 VL 72B (رؤية)", interval: 31000, reasoning: false, vision: true, tools: false }
    ]
  }
];

// ترتيب "تلقائي": نوزّع بين المزوّدين للاستفادة من أكبر عدد من الحصص
const AUTO_ORDER = [
  "kilo:kilo-auto/free",
  "ovh:gpt-oss-120b",
  "llm7:minimax-m2.7",
  "pollinations:openai-fast",
  "kilo:nvidia/nemotron-3-ultra-550b-a55b:free",
  "ovh:Meta-Llama-3_3-70B-Instruct",
  "llm7:codestral-latest",
  "ovh:Mistral-Small-3.2-24B-Instruct-2506",
  "kilo:cohere/north-mini-code:free",
  "ovh:Qwen3.5-397B-A17B"
];

const state = {
  cooldown: new Map(), // "provider:model" -> epochMs حتى
  hourly: new Map(),   // "kilo" -> أوقات الاستخدام في الساعة الماضية
  rotate: 0
};

function key(p, m) { return p + ":" + m; }
function coolUntil(p, m) { return state.cooldown.get(key(p, m)) || 0; }
function setCooldown(p, m, ms) {
  const safe = (ms > 0 && ms < 180000) ? ms : 35000;
  state.cooldown.set(key(p, m), Date.now() + safe);
}
function nowBusy(p, m) { return coolUntil(p, m) > Date.now(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------- Respan Gateway (اختياري) ----------
// بوابة متوافقة مع OpenAI: تُستخدم فقط عند ضبط RESPAN_API_KEY، وكل طلب يمرّ بها
// يُسجَّل تلقائياً في Respan (بلا SDK) ويحمل الترويسة X-Respan-Log-Id.
const RESPAN_BASE = "https://api.respan.ai/api";
const RESPAN_DEFAULT_MODEL = "gpt-5.5";

function respanKey(env) {
  const k = env && env.RESPAN_API_KEY;
  return (typeof k === "string" && k.trim()) ? k.trim() : "";
}

function respanModel(env) {
  const m = env && env.RESPAN_MODEL;
  return (typeof m === "string" && m.trim()) ? m.trim() : RESPAN_DEFAULT_MODEL;
}

// مدخل واحد للبوابة؛ عند أي فشل ينتقل الطلب تلقائياً إلى المزوّدين المجانيين
function respanEntry(env, modelId) {
  if (!respanKey(env)) return null;
  const id = modelId || respanModel(env);
  return {
    provider: {
      id: "respan",
      label: "Respan Gateway",
      url: RESPAN_BASE + "/chat/completions",
      headers: { authorization: "Bearer " + respanKey(env) }
    },
    model: { id, name: id + " (Respan)", interval: 0, reasoning: false, vision: false, tools: false }
  };
}

function kiloHourlyBlocked() {
  const arr = (state.hourly.get("kilo") || []).filter(t => Date.now() - t < 3600000);
  state.hourly.set("kilo", arr);
  return arr.length >= 165;
}

// كل التركيبات الممكنة provider+model
function allEntries() {
  const out = [];
  for (const pr of PROVIDERS) for (const em of pr.entryModels) out.push({ provider: pr, model: em });
  return out;
}

// بناء قائمة المزوّدين المرشحين لطلب واحد
function buildChain(requested, env) {
  const all = allEntries();
  // اختيار صريح من البوابة: respan::<model-id>
  if (requested && String(requested).startsWith("respan::")) {
    const gate = respanEntry(env, String(requested).slice("respan::".length).trim());
    if (gate) return [gate];
    return entriesAfter(all); // البوابة غير مهيّأة → المسار المجاني كما هو
  }
  let entries;
  if (requested && requested !== "auto") {
    const sep = requested.indexOf("::");
    const pid = requested.slice(0, sep), mid = requested.slice(sep + 2);
    entries = all.filter(e => e.provider.id === pid && e.model.id === mid);
    if (entries.length) return entries;
    return entriesAfter(all);
  }
  const chain = entriesAfter(all);
  const gate = respanEntry(env);
  return gate ? [gate].concat(chain) : chain;
}

function entriesAfter(all) {
  const rot = state.rotate++ % AUTO_ORDER.length;
  const order = AUTO_ORDER.slice(rot).concat(AUTO_ORDER.slice(0, rot));
  const list = [];
  for (const k of order) {
    const sep = k.indexOf(":");
    const pid = k.slice(0, sep), mid = k.slice(sep + 1);
    const e = all.find(e => e.provider.id === pid && e.model.id === mid);
    if (e && !list.includes(e)) list.push(e);
  }
  return list.filter(e => !(e.provider.id === "kilo" && kiloHourlyBlocked()));
}

function sseFrame(obj) { return "data: " + JSON.stringify(obj) + "\n\n"; }

function upstreamFrames(obj) {
  const out = [];
  const ch = obj && obj.choices && obj.choices[0];
  if (!ch) return out;
  const delta = ch.delta || {};
  const msg = (ch.message && typeof ch.message === "object") ? ch.message : {};
  const reasoning = delta.reasoning || delta.reasoning_content || msg.reasoning || msg.reasoning_content;
  const content = (delta.content != null) ? delta.content : msg.content;
  if (typeof reasoning === "string" && reasoning.length) out.push({ type: "reason", text: reasoning });
  if (typeof content === "string" && content.length) out.push({ type: "delta", text: content });
  if (ch.finish_reason) out.push({ type: "finish", finish: ch.finish_reason });
  return out;
}

function jsonError(status, msg) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

function markUsed(e) {
  if (e.model.interval) state.cooldown.set(key(e.provider.id, e.model.id), Date.now() + e.model.interval);
  if (e.provider.id === "kilo") {
    const arr = (state.hourly.get("kilo") || []).filter(t => Date.now() - t < 3600000);
    arr.push(Date.now());
    state.hourly.set("kilo", arr);
  }
}

async function tryUpstream(e, body) {
  const payload = {
    model: e.model.id,
    messages: body.messages,
    stream: body.stream !== false
  };
  if (typeof body.temperature === "number") payload.temperature = body.temperature;
  if (typeof body.max_tokens === "number") payload.max_tokens = body.max_tokens;
  // وسوم تظهر في سجلات Respan؛ تقرأها البوابة وتزيلها قبل تمرير الطلب للمزوّد
  if (e.provider.id === "respan") payload.metadata = { app: "chibani-ai", workflow: "chat" };

  markUsed(e);
  let resp;
  // مهلة قصيرة لوصول الترويسات: مزوّد معلّق لا يجمّد الطلب، ننتقل لغيره فوراً
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), body.fast ? 9000 : 15000);
  try {
    resp = await fetch(e.provider.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...UA, ...(e.provider.headers || {}) },
      body: JSON.stringify(payload),
      signal: ac.signal
    });
    clearTimeout(timer);
  } catch (err) {
    clearTimeout(timer);
    setCooldown(e.provider.id, e.model.id, 30000);
    return null;
  }
  if (!resp.ok) {
    let retryMs = 35000, detail = "";
    try {
      const j = await resp.json().catch(() => null);
      if (j) {
        detail = String(JSON.stringify(j)).slice(0, 200);
        const err = j.error || {};
        const ra = Number(err.retry_after || err.retryAfter || 0);
        if (ra) retryMs = ra * 1000;
      }
    } catch (_) {}
    const raH = resp.headers.get("retry-after");
    if (raH && Number(raH)) retryMs = Number(raH) * 1000;
    setCooldown(e.provider.id, e.model.id, retryMs);
    console.log("upstream fail:", e.provider.id, e.model.id, resp.status, detail);
    return null;
  }
  return resp;
}

// بث موحّد: نأخذ بث المزوّد (SSE أو JSON) ونحوّله لقنوات reason/delta/done
async function streamUnified(entry, resp, providerLabel, modelLabel) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  writer.write(enc.encode(sseFrame({ type: "meta", provider: providerLabel, model: modelLabel })));

  (async () => {
    try {
      const ct = resp.headers.get("content-type") || "";
      if (ct.includes("event-stream")) {
        const reader = resp.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
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
              try {
                const j = JSON.parse(t);
                if (j.error) {
                  await writer.write(enc.encode(sseFrame({ type: "error", text: j.error.message || JSON.stringify(j.error) })));
                  continue;
                }
                for (const f of upstreamFrames(j)) await writer.write(enc.encode(sseFrame(f)));
              } catch (_) { /* إطار غير مكتمل */ }
            }
          }
        }
      } else {
        const text = await resp.text();
        try {
          const j = JSON.parse(text || "");
          if (j.error) {
            await writer.write(enc.encode(sseFrame({ type: "error", text: j.error.message || "رد من المزوّد" })));
          } else {
            for (const f of upstreamFrames(j)) await writer.write(enc.encode(sseFrame(f)));
          }
        } catch (_) {
          await writer.write(enc.encode(sseFrame({ type: "delta", text: text || "" })));
        }
      }
      await writer.write(enc.encode(sseFrame({ type: "done" })));
    } catch (err) {
      try { await writer.write(enc.encode(sseFrame({ type: "error", text: "انقطاع أثناء البث: " + String(err) }))); } catch (_) {}
      try { await writer.write(enc.encode(sseFrame({ type: "done" }))); } catch (_) {}
    } finally {
      try { await writer.close(); } catch (_) {}
    }
  })();

  return new Response(readable, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no"
    }
  });
}

async function handleChat(body, env) {
  const model = body && typeof body.model === "string" ? body.model : '';
  const chain = buildChain(model, env);
  // الوضع السريع: النماذج بلا تفكير مُطوّل أولاً، ومحاولات أقل
  const ordered = body.fast
    ? chain.slice().sort((a, b) => Number(!!a.model.reasoning) - Number(!!b.model.reasoning))
    : chain;
  for (const e of ordered.slice(0, body.fast ? 3 : 5)) {
    if (nowBusy(e.provider.id, e.model.id)) continue;
    const resp = await tryUpstream(e, body);
    if (!resp) continue;

    // المسار المتدفق أولاً: لا نقرأ resp.body هنا أبداً وإلا يُقفل القارئ
    if (body.stream !== false) {
      return streamUnified(e, resp, e.provider.label, e.model.name);
    }

    // المسار غير المتدفق: اقرأ النص مرة واحدة فقط
    let text = '';
    try {
      text = await resp.text();
    } catch (_) {
      text = '';
    }
    if (!text) continue; // نص خالي، ننتقل للمزود التالي

    try {
      const j = JSON.parse(text || "");
      if (j.error) continue;
      const msg = (j.choices && j.choices[0].message) || {};
      return new Response(
        JSON.stringify({ content: msg.content || "", reasoning: msg.reasoning || msg.reasoning_content || "", provider: e.provider.label, model: e.model.name }),
        { headers: { "content-type": "application/json" } }
      );
    } catch (_) {
      // إذا لم يكن رد المزوّد JSON صالح، نرجعه كنص بسيط
      return new Response(JSON.stringify({ content: text || "", provider: e.provider.label, model: e.model.name }), { headers: { "content-type": "application/json" } });
    }
  }
  const tomorrow = Math.max(0, ...chain.map(e => coolUntil(e.provider.id, e.model.id))) - Date.now();
  const secs = Math.ceil(tomorrow / 1000);
  return jsonError(503, secs > 0
    ? `كل المجمّعات المجانية تعمل الآن بأقصى طاقتها. أعد الإرسال بعد ${secs} ثانية وسيتم تلقائياً.`
    : "لا يوجد مزوّد متاح حالياً. أعد المحاولة بعد لحظات.");
}

// ---------- قراءة المواقع عبر Jina Reader (مجاني بدون مفتاح) ----------
function htmlToText(html) {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n");
  return s.trim();
}

async function handleFetchUrl(rawUrl) {
  if (!/^https?:\/\//i.test(rawUrl)) return jsonError(400, "رابط غير صالح");
  let resp;
  try {
    resp = await fetch("https://r.jina.ai/" + rawUrl, { headers: { ...UA, "accept": "text/plain" } });
  } catch (e) {
    resp = null;
  }
  if (resp && resp.ok) {
    const text = await resp.text();
    return new Response(JSON.stringify({ url: rawUrl, text: text.slice(0, 40000) }), { headers: { "content-type": "application/json" } });
  }
  // خطة بديلة: جلب مباشر وتجريد HTML
  try {
    const direct = await fetch(rawUrl, { headers: UA });
    const html = await direct.text();
    return new Response(JSON.stringify({ url: rawUrl, text: htmlToText(html).slice(0, 40000) }), { headers: { "content-type": "application/json" } });
  } catch (e) {
    return jsonError(502, "تعذّر قراءة الرابط (قد يكون محميًا أو غير موجود)");
  }
}

// ---------- بحث مجاني (DuckDuckGo Lite المباشرة، ثم Jina كبديل) ----------
async function handleVision(body) {
  const items = [
    { p: "ovh", m: "Qwen2.5-VL-72B-Instruct", interval: 31000 },
    { p: "kilo", m: "nvidia/nemotron-3.5-super-vl:free", interval: 2500 }
  ];
  for (const it of items) {
    const pr = PROVIDERS.find(x => x.id === it.p);
    if (nowBusy(pr.id, it.m)) continue;
    const e = { provider: pr, model: { id: it.m, name: it.m, interval: it.interval } };
    const resp = await tryUpstream(e, {
      messages: [{
        role: "user",
        content: [
          { type: "text", text: body.question || "حلّل هذه الصورة (الصور) بدقة وباللغة العربية." },
          ...((body.images || []).slice(0, 6)).map(u => ({ type: "image_url", image_url: { url: u } }))
        ]
      }],
      stream: false
    });
    if (resp) {
      const text = await resp.text();
      try {
        const j = JSON.parse(text);
        if (j.error) continue;
        const msg = (j.choices && j.choices[0].message) || {};
        return new Response(JSON.stringify({ content: msg.content || "", provider: pr.label + " · " + it.m }), { headers: { "content-type": "application/json" } });
      } catch (_) { continue; }
    }
  }
  return jsonError(503, "خدمة تحليل الصور مشغولة الآن، جرب بعد نصف دقيقة.");
}

// ---------- تفريغ صوتي (Whisper من OVH) ----------
async function handleAudio(body) {
  const dataurl = body.dataurl || "";
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataurl);
  if (!m) return jsonError(400, "بيانات صوتية غير صالحة");
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const fd = new FormData();
    fd.append("model", "whisper-large-v3-turbo");
    fd.append("file", new File([bytes], "audio." + ((m[1].split("/")[1] || "webm").split("+")[0]), { type: m[1] }));
    const resp = await fetch("https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/audio/transcriptions", {
      method: "POST",
      body: fd,
      headers: UA
    });
    const j = await resp.json().catch(() => null);
    if (j && (j.text || j.transcription)) {
      return new Response(JSON.stringify({ text: j.text || j.transcription }), { headers: { "content-type": "application/json" } });
    }
    return jsonError(502, "فشل التفريغ الصوتي: " + String(JSON.stringify(j)).slice(0, 160));
  } catch (e) {
    return jsonError(502, "فشل تجهيز الملف الصوتي");
  }
}

// ---------- توليد الفيديو: خطة المشاهد + التعليق الصوتي (بدون مفاتيح) ----------
async function llmText(messages, maxTokens) {
  try {
    const resp = await handleChat({ messages, stream: false, max_tokens: maxTokens || 1400, temperature: 0.85 });
    if (resp.status !== 200) return null;
    const j = await resp.json();
    return j && j.content ? j : null;
  } catch (_) { return null; }
}

function extractJSON(txt) {
  const s = String(txt || "").replace(/```[a-zA-Z]*/g, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  const body = s.slice(a, b + 1);
  try { return JSON.parse(body); } catch (_) {}
  // إصلاح شائع: أسطر جديدة/جدولة أو فواصل زائدة داخل JSON المولّد
  const fixed = body.replace(/[\u0000-\u001f]+/g, " ").replace(/,\s*([}\]])/g, "$1");
  try { return JSON.parse(fixed); } catch (_) {}
  try { return JSON.parse(fixed.replace(/[\u201c\u201d]/g, '"')); } catch (_) {}
  return null;
}

const PLAN_SYSTEM = (n, style) => `أنت مخرج أفلام ومصمم مشاهد محترف. مهمتك تحويل فكرة إلى خطة فيديو قصير.

أعِد **JSON فقط** بهذا الشكل بالضبط (بدون أي كلام قبله أو بعده، وبدون علامات كود):
{"title":"عنوان قصير بالعربية (٣-٦ كلمات)","subtitle":"سطر وصفي واحد بالعربية","mood":"calm|epic|uplifting|mysterious","hero":"ENGLISH prompt for ONE wide establishing shot that represents the whole video: the main place or subject seen from a distance, rich detail from edge to edge, no close-up faces, no text","scenes":[{"narration":"جملة سرد عربية واحدة ١٢-٢٠ كلمة تُقرأ صوتياً","caption":"نص قصير جداً يظهر على الشاشة بالعربية (٣-٧ كلمات)","image":"detailed ENGLISH image prompt describing the visual, no text in image"}]}

القواعد الصارمة:
- عدد المشاهد بالضبط ${n}، مرتبة كقصة متصلة من البداية للنهاية وتُكمل بعضها في السرد.
- الحقول narration و caption بالعربية الفصحى فقط، و image بالإنجليزية فقط.
- كل وصف صورة مختلف عن الآخر ويصف مشهداً بصرياً محدداً (مكان، شخص، إضاءة، حركة).
- الأسلوب البصري المطلوب: ${style}. لا تذكر أي نص أو كتابة داخل وصف الصورة.
- الطول ملائم لفيديو قصير، بلا حشو.
- حقل hero بالإنجليزية فقط: لقطة تأسيسية واسعة تمثّل الموضوع كله (المكان أو الظاهرة من بعيد)، لا وجوهاً قريبة ولا أشخاص يملأون الإطار.
- اكتب JSON على سطر واحد مضغوط: لا أسطر جديدة ولا صناديق كود داخل القيم.`;

async function handleVideoPlan(body) {
  const topic = maxChars(String(body.topic || "").trim(), 900);
  if (!topic) return jsonError(400, "اكتب موضوع الفيديو أولاً");
  const n = Math.max(3, Math.min(10, Number(body.scenes) || 6));
  const style = maxChars(String(body.style || "سينمائي واقعي").trim(), 120);

  const got = await llmText([
    { role: "system", content: PLAN_SYSTEM(n, style) },
    { role: "user", content: "فكرة الفيديو: " + topic }
  ], 2600);

  const j = got ? extractJSON(got.content) : null;
  const scenes = [];
  if (j && Array.isArray(j.scenes)) {
    for (const raw of j.scenes.slice(0, n)) {
      const narration = maxChars(String(raw.narration || raw.text || "").trim(), 260);
      const caption = maxChars(String(raw.caption || raw.title || "").trim(), 90);
      const image = maxChars(String(raw.image || raw.prompt || "").trim(), 400);
      if (!narration && !image) continue;
      scenes.push({
        narration: narration || caption,
        caption: caption || maxChars(narration, 60),
        image: image || ("cinematic scene about " + topic)
      });
    }
  }

  // خطة احتياطية إن فشل النموذج: يبقى الاستوديو صالحاً للاستخدام
  if (scenes.length < 2) {
    const beats = ["المشهد الافتتاحي", "التفاصيل", "التحول", "الذروة", "النهاية"];
    for (let i = 0; i < n; i++) {
      scenes.push({
        narration: i === 0 ? "نبدأ من فكرة: " + topic : topicsFallback(i, topic),
        caption: i === 0 ? "البداية" : beats[i % beats.length],
        // وصف إنجليزي صرف: الوصف العربي داخل الطلب يجعل مولّد الصور يرسم وجوهاً عشوائية
        image: `wide cinematic establishing shot ${i + 1} of the video's subject, ${style}, detailed environment, no text`
      });
    }
  }

  function topicsFallback(i, t) { return "نتابع تفاصيل «" + maxChars(t, 70) + "» — المشهد " + (i + 1) + "."; }

  const hero = maxChars(String((j && (j.hero || j.heroImage || j.establishing)) || "").trim(), 420);

  return new Response(JSON.stringify({
    title: maxChars(String((j && j.title) || topic).trim(), 90),
    subtitle: maxChars(String((j && j.subtitle) || "فيديو من إنتاج CHIBANI AI").trim(), 130),
    mood: ["calm", "epic", "uplifting", "mysterious"].includes(j && j.mood) ? j.mood : "calm",
    hero: hero || "wide cinematic establishing shot of the video's subject, " + style + ", detailed environment, no close-up faces, no text",
    scenes,
    provider: got ? (got.provider + " · " + got.model) : "خطة محلية"
  }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

// نطق مجاني عبر خدمة الترجمة العامة (بلا مفتاح). نقسّم النص لتجاوز حد الطلب ونلصق المقاطع.
function chunkText(t, n) {
  const out = [];
  let rest = String(t || "").replace(/\s+/g, " ").trim();
  while (rest.length > n) {
    let cut = rest.lastIndexOf(" ", n);
    if (cut < n * 0.55) cut = n;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

async function handleTTS(rawText, rawLang) {
  const text = maxChars(String(rawText || "").trim(), 900);
  if (!text) return jsonError(400, "لا يوجد نص للنطق");
  const lang = /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(rawLang || "") ? rawLang : "ar";
  const parts = chunkText(text, 160);
  const bufs = [];
  for (const part of parts) {
    const q = encodeURIComponent(part);
    const urls = [
      "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=" + lang + "&q=" + q,
      "https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=" + lang + "&q=" + q
    ];
    let ok = false;
    for (const u of urls) {
      try {
        const r = await fetch(u, { headers: { ...UA, referer: "https://translate.google.com/" } });
        if (!r.ok) continue;
        const ab = await r.arrayBuffer();
        if (ab.byteLength < 1200) continue; // صفحة حجب وليست صوتاً
        bufs.push(new Uint8Array(ab));
        ok = true;
        break;
      } catch (_) {}
    }
    if (!ok) continue;
  }
  if (!bufs.length) return jsonError(502, "خدمة النطق المجانية مشغولة الآن — أعد المحاولة أو أطفئ التعليق الصوتي.");
  const total = bufs.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of bufs) { out.set(b, off); off += b.length; }
  return new Response(out, {
    headers: { "content-type": "audio/mpeg", "cache-control": "public, max-age=86400", "access-control-allow-origin": "*" }
  });
}

// ---------- صور من AI Horde: نماذج مفتوحة المصدر على GPU متطوّعين، بلا مفتاح ولا حصة IP ----------
const HORDE = { base: "https://aihorde.net/api/v2", key: "0000000000", agent: "CHIBANI-AI:1.0:github.com/koreaone10-del/Freebuff" };
// "auto" تعني بلا فلتر: Horde يوجّه الطلب لأقرب عامل يخدمه فوراً بدل الوقوف في طابور نموذج مزدحم
const HORDE_MODELS = {
  auto: null,
  sdxl: ["AlbedoBase XL (SDXL)", "SDXL 1.0"],
  deliberate: ["Deliberate", "PerfectDeliberate", "Deliberate 3.0"],
  realistic: ["Realistic Vision", "majicMIX realistic"],
  flux: ["Flux.1-Schnell fp8 (Compact)"]
};

async function hordeImage(prompt, w, h, seed, model) {
  const models = Object.prototype.hasOwnProperty.call(HORDE_MODELS, model) ? HORDE_MODELS[model] : null;
  const submit = await fetch(HORDE.base + "/generate/async", {
    method: "POST",
    headers: {
      ...UA,
      "content-type": "application/json",
      apikey: HORDE.key,
      "Client-Agent": HORDE.agent
    },
    body: JSON.stringify({
      prompt: maxChars(prompt, 900),
      params: { width: w, height: h, steps: 26, cfg_scale: 7, sampler_name: "k_euler", n: 1, seed: String(seed) },
      ...(models ? { models } : {}),
      nsfw: false,
      censor_nsfw: true,
      trusted_workers: false,
      r2: true
    })
  });
  const sj = await submit.json().catch(() => ({}));
  if (!submit.ok || !sj.id) return { ok: false, status: submit.status, detail: maxChars(String(sj.message || sj.error || "تعذّر إرسال الطلب"), 160) };

  const t0 = Date.now();
  while (Date.now() - t0 < 42000) {
    await new Promise((r) => setTimeout(r, 1800));
    const chk = await fetch(HORDE.base + "/generate/check/" + sj.id, { headers: { ...UA, "Client-Agent": HORDE.agent } }).then((r) => r.json()).catch(() => null);
    if (chk && chk.faulted) return { ok: false, status: 502, detail: "فشل المولّد على عامل Horde" };
    if (chk && !chk.done && chk.wait_time > 55 && chk.queue_position > 40) {
      return { ok: false, status: 503, detail: "طابور Horde طويل الآن (" + chk.wait_time + "ث)" };
    }
    if (chk && chk.done) {
      const st = await fetch(HORDE.base + "/generate/status/" + sj.id, { headers: { ...UA, "Client-Agent": HORDE.agent } }).then((r) => r.json()).catch(() => null);
      const gen = st && st.generations && st.generations[0];
      if (!gen || !gen.img) return { ok: false, status: 502, detail: "لا صورة في الرد" };
      if (gen.censored) return { ok: false, status: 502, detail: "صنّف الفلتر الصورة كغير مناسبة" };
      const bin = await fetch(gen.img, { headers: UA });
      if (!bin.ok) return { ok: false, status: bin.status, detail: "تعذّر تنزيل الصورة" };
      const buf = await bin.arrayBuffer();
      if (buf.byteLength < 1024) return { ok: false, status: 502, detail: "ملف صغير جداً" };
      return { ok: true, buf, type: bin.headers.get("content-type") || "image/webp", model: (gen.model || (models && models[0]) || "horde"), seed: gen.seed };
    }
  }
  return { ok: false, status: 504, detail: "انتهى وقت الانتظار في طابور Horde" };
}

// ---------- تمرير الصور: يمنع تلويث Canvas ويوحّد الصيغة ----------
async function handleImage(url) {
  const prompt = maxChars(String(url.searchParams.get("prompt") || "").trim(), 700);
  if (!prompt) return jsonError(400, "لا يوجد وصف للصورة");
  const num = (v, d) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 ? Math.min(1600, Math.max(256, n)) : d;
  };
  const w = num(url.searchParams.get("width"), 1024);
  const h = num(url.searchParams.get("height"), 1024);
  const seed = Number(url.searchParams.get("seed")) || Math.floor(Math.random() * 1000000);
  const provider = ["auto", "pollinations", "horde"].includes(String(url.searchParams.get("provider") || "")) ? String(url.searchParams.get("provider")) : "auto";
  const hmodel = Object.prototype.hasOwnProperty.call(HORDE_MODELS, String(url.searchParams.get("hmodel") || "")) ? String(url.searchParams.get("hmodel")) : "auto";
  const fromHorde = async () => {
    // Horde مجاني بلا حصة IP لكنه أبطأ بمقاسات كبيرة: نحدّ الضلع الأطول بـ768 ثم يكبّر المتصفح
    const k = Math.min(1, 768 / Math.max(w, h));
    const hw = Math.max(256, Math.round((w * k) / 8) * 8);
    const hh = Math.max(256, Math.round((h * k) / 8) * 8);
    const r = await hordeImage(prompt, hw, hh, seed, hmodel);
    if (!r.ok) return null;
    return new Response(r.buf, {
      headers: {
        "content-type": r.type,
        "cache-control": "public, max-age=86400, immutable",
        "x-image-size": hw + "x" + hh,
        "x-image-model": "horde/" + r.model,
        "x-image-provider": "horde"
      }
    });
  };

  if (provider === "horde") {
    const hr = await fromHorde();
    if (hr) return hr;
    return new Response(JSON.stringify({ error: "طابور Horde المفتوح مزدحم الآن — أعد المحاولة أو بدّل المحرّك." }), {
      status: 502,
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
  }

  const base = "https://image.pollinations.ai/prompt/" + encodeURIComponent(prompt) +
    "?width=" + w + "&height=" + h + "&nologo=true&seed=" + seed + "&model=";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let lastStatus = 0;
  let lastDetail = "";
  for (let round = 0; round < 2; round++) {
    for (const model of ["flux", "turbo"]) {
      try {
        const r = await fetch(base + model + (round ? "&retry=" + round : ""), { headers: UA });
        lastStatus = r.status;
        if (!r.ok) {
          const txt = await r.text().catch(() => "");
          lastDetail = maxChars(txt, 200);
          if (r.status === 402 || r.status === 429) {
            const m = /retry after\s+(\d+)\s*s/i.exec(txt) || /"retry"\s*:\s*(\d+)/i.exec(txt);
            const wait = m ? Math.min(120, Number(m[1])) : 0;
            if (wait > 0) {
              // حصة IP لـPollinations لا تمسّ Horde: في الوضع التلقائي نكمل التوليد بدل الانتظار
              if (provider === "auto") {
                const hr = await fromHorde();
                if (hr) return hr;
              }
              return new Response(JSON.stringify({
                error: "حصة الصور المجانية ممتلئة — إعادة المحاولة بعد " + wait + " ثانية.",
                retry: wait,
                upstream: r.status
              }), {
                status: 429,
                headers: {
                  "content-type": "application/json",
                  "cache-control": "no-store",
                  "x-retry-after": String(wait)
                }
              });
            }
          }
          continue;
        }
        const ct = r.headers.get("content-type") || "";
        if (!ct.startsWith("image/")) { lastDetail = "نوع غير متوقع: " + ct; continue; }
        const buf = await r.arrayBuffer();
        if (buf.byteLength < 1024) { lastDetail = "حجم صغير جداً"; continue; }
        return new Response(buf, {
          headers: {
            "content-type": ct,
            "cache-control": "public, max-age=86400, immutable",
            "x-image-size": w + "x" + h,
            "x-image-model": "pollinations/" + model,
            "x-image-provider": "pollinations"
          }
        });
      } catch (e) { lastDetail = String(e).slice(0, 120); }
    }
    if (round === 0) await sleep(450);
  }
  if (provider === "auto") {
    const hr = await fromHorde();
    if (hr) return hr;
  }
  return new Response(JSON.stringify({
    error: "خدمة توليد الصور مزدحمة الآن — أعد المحاولة بعد نصف دقيقة.",
    upstream: lastStatus,
    detail: lastDetail
  }), {
    status: 502,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

// ---------- وسيط ربط محصور: يمرّر رمز المستخدم إلى مزوّد محدَّد فقط ----------
const CONNECT = {
  github: { base: "https://api.github.com", prefixes: ["/user", "/gists"], auth: "bearer" },
  render: { base: "https://api.render.com/v1", prefixes: ["/services", "/owners"], auth: "bearer" },
  facebook: { base: "https://graph.facebook.com/v20.0", prefixes: ["/me"], auth: "query" }
};

async function handleConnect(req) {
  const token = String(req.headers.get("x-cb-token") || "").trim();
  if (!token) return jsonError(401, "أضف رمز الوصول أولاً");
  if (token.length < 8 || token.length > 600) return jsonError(400, "رمز الوصول غير صالح");

  let body = null;
  try { body = await req.json(); } catch (_) { return jsonError(400, "طلب غير صالح"); }
  if (!body || typeof body !== "object") return jsonError(400, "طلب غير صالح");

  const svc = CONNECT[String(body.service || "")];
  if (!svc) return jsonError(400, "خدمة غير مدعومة");

  const path = String(body.path || "");
  if (!path.startsWith("/") || path.length > 200) return jsonError(400, "مسار غير صالح");
  if (/[?#\\]|\.\.|\/\//.test(path)) return jsonError(400, "مسار غير صالح");
  if (!svc.prefixes.some((p) => path.startsWith(p))) return jsonError(403, "مسار غير مسموح لهذه الخدمة");

  const method = String(body.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") return jsonError(405, "طريقة غير مسموحة");

  let target;
  try { target = new URL(svc.base + path); } catch (_) { return jsonError(400, "مسار غير صالح"); }
  if (target.origin !== new URL(svc.base).origin) return jsonError(400, "مسار غير صالح");

  const q = body.query && typeof body.query === "object" ? body.query : {};
  for (const k of Object.keys(q).slice(0, 12)) {
    if (!/^[a-zA-Z0-9_.\-]{1,40}$/.test(k)) continue;
    const v = q[k];
    if (typeof v === "string" || typeof v === "number") {
      target.searchParams.set(k, maxChars(String(v), 120));
    }
  }
  if (svc.auth === "query") target.searchParams.set("access_token", token);

  const headers = { ...UA, accept: "application/json" };
  if (svc.auth === "bearer") headers.authorization = "Bearer " + token;

  let payload = null;
  if (method === "POST") {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body.body && typeof body.body === "object" ? body.body : {});
  }

  let resp;
  try {
    resp = await fetch(target.toString(), { method, headers, body: payload });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, status: 0, error: "تعذّر الوصول إلى المزوّد من الخادم" }), {
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
  }

  const text = await resp.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  if (!resp.ok) {
    const msg = data && (data.message || data.error_description || (data.error && data.error.message)) || maxChars(text, 240);
    return new Response(JSON.stringify({ ok: false, status: resp.status, error: String(msg || "رفض المزوّد الطلب") }), {
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
  }
  return new Response(JSON.stringify({
    ok: true,
    status: resp.status,
    data: data != null ? data : maxChars(text, 4000)
  }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

// ---------- نقاط الوصول ----------
async function handle(req, env) {
  const url = new URL(req.url);
  const p = url.pathname;

  if (p === "/api/health") {
    const items = [];
    for (const pr of PROVIDERS) {
      for (const em of pr.entryModels) {
        const until = coolUntil(pr.id, em.id);
        items.push({
          id: pr.id + "::" + em.id,
          label: pr.label + " · " + em.name,
          status: until > Date.now() ? "cooling" : "ready",
          coolFor: Math.max(0, Math.round((until - Date.now()) / 1000))
        });
      }
    }
    const gate = respanEntry(env);
    if (gate) {
      const until = coolUntil("respan", gate.model.id);
      items.unshift({
        id: "respan::" + gate.model.id,
        label: gate.model.name + " — " + gate.provider.label,
        status: until > Date.now() ? "cooling" : "ready",
        coolFor: Math.max(0, Math.round((until - Date.now()) / 1000))
      });
    }
    return new Response(JSON.stringify({
      ok: true,
      providers: items,
      respan: !!gate,
      kiloHourlyUsed: (state.hourly.get("kilo") || []).length
    }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }

  if (p === "/api/models") {
    const out = [{ id: "auto", name: "تلقائي (توزيع ذكي بين كل المزوّدين)" }];
    const gate = respanEntry(env);
    if (gate) out.push({
      id: "respan::" + gate.model.id,
      name: gate.model.id + " — Respan Gateway",
      reasoning: false,
      vision: false
    });
    for (const pr of PROVIDERS) for (const em of pr.entryModels) {
      out.push({
        id: pr.id + "::" + em.id,
        name: em.name + " — " + pr.label,
        reasoning: em.reasoning,
        vision: em.vision
      });
    }
    return new Response(JSON.stringify({ models: out }), { headers: { "content-type": "application/json" } });
  }  if (p === "/api/chat" && req.method === "POST") {
    try {
      const body = await req.json();
      if (!body || typeof body !== "object") {
        return jsonError(400, "بيانات غير صالحة: يُرجى إرسال JSON صحيح مع حقل messages");
      }
      return await handleChat(body, env);
    } catch (e) {
      return jsonError(500, "خطأ داخلي: " + String(e));
    }
  }

  if (p === "/api/hunt" && (req.method === "GET" || req.method === "HEAD")) return handleHunt(url.searchParams.get("q") || "", url.searchParams.get("method") || "web");
  if (p === "/api/tts") return handleTTS(url.searchParams.get("text") || "", url.searchParams.get("lang") || "ar");
  if (p === "/api/image") return handleImage(url);

  if (p === "/api/connect") {
    if (req.method !== "POST") return jsonError(405, "استخدم POST");
    try { return await handleConnect(req); } catch (e) { return jsonError(500, "خطأ داخلي: " + String(e)); }
  }

  if (p === "/api/video/plan" && req.method === "POST") {
    try { return await handleVideoPlan(await req.json()); } catch (e) { return jsonError(500, "خطأ داخلي: " + String(e)); }
  }
  if (p === "/api/fetchurl") return handleFetchUrl(url.searchParams.get("url") || "");

  if (p === "/api/vision" && req.method === "POST") {
    try { return await handleVision(await req.json()); } catch (e) { return jsonError(500, "خطأ داخلي: " + String(e)); }
  }
  if (p === "/api/audio" && req.method === "POST") {
    try { return await handleAudio(await req.json()); } catch (e) { return jsonError(500, "خطأ داخلي: " + String(e)); }
  }

    // ---------- مسح مصادر مفتوحة - OSINT (منطقة الحماية) ----------
  // كل مصدر: عنوان، وصف عربي قصير، طريقة بحث (get / post)
  const OSINT_SOURCES = [
    {
      id: "facecheck",
      name: "Facecheck",
      host: "https://facecheck.id",
      label: "بحث صورة بواسطة الوجه (People Search بالصورة) - رابط مباشر محسن للوحة البحث",
      style: "search-by-image and people-search",
      path: (q) => encodeURIComponent(q),
      query: (q) => "q=" + q
    },
    {
      id: "robin",
      name: "Robin",
      host: "https://robin.me",
      label: "سجل شخصي واتصالات مجانية - ابحث عن الشخص عبر صورته أو اسمه",
      style: "profile and contact lookup",
      path: (q) => encodeURIComponent(q),
      query: (q) => "q=" + q
    },
    {
      id: "airplanes",
      name: "Airplanes",
      host: "https://airplanes.live",
      label: "قاعدة بيانات الطيران والرحلات - تحقق من رحلات الطائرات والشركات والدخول الجوي",
      style: "flight and airport database",
      path: (q) => encodeURIComponent(q),
      query: (q) => "q=" + q
    },
    {
      id: "wiki",
      name: "Wiki",
      host: "https://en.wikipedia.org",
      label: "مشروعFree EDU و encyclopedia مجاني - استرجاع المقالات والبيانات",
      style: "encyclopedia and knowledge",
      path: (q) => "/wiki/${encodeURIComponent(q)}",
      query: (q) => ""
    },
    {
      id: "phish",
      name: "Phish",
      host: "https://phish.me",
      label: "قاعدة بيانات هجمات التصيد ووسائل الحماية - اكتشاف رابط مشبوه",
      style: "security / threat intelligence",
      path: (q) => encodeURIComponent(q),
      query: (q) => "q=" + q
    },
    {
      id: "rev",
      name: "REV (Reverse Engineering Tools)",
      host: "https://www.rev-tools.com",
      label: "مكتبات أدوات هندسة المعكوس والتحليل الأمني - مشاريع ووثائق",
      style: "reverse engineering tools",
      path: (q) => encodeURIComponent(q),
      query: (q) => "q=" + q
    }
  ];

  function urlSearchParamsGet(q) {
    if (q && typeof q === "object" && q.query !== undefined && q.q !== undefined) return q.query || q.q;
    if (typeof q === "string") return q;
    return "";
  }

  async function fetchOSINT(url) {
    try {
      const r = await fetch(url, { headers: { ...UA, accept: "text/html,application/xhtml+xml" } });
      if (!r.ok) return null;
      const ct = r.headers.get("content-type") || "";
      if (ct.includes("application/json")) return await r.json();
      return await r.text();
    } catch (_) { return null; }
  }

  // تنسيق النتيجة بالعربية (عنوان + مصدر + وصف + رابط)
  function formatResult(src, title, description, url) {
    return {
      source: src.name,
      host: src.host,
      title: title || "بحث عن " + (title || "الوجه او الاسم"),
      description: description || "",
      url: url || "",
      icon: src.icon
    };
  }

  async function handleOSINT(body) {
    const q = String(body.query || body.q || "").trim();
    if (!q) return jsonError(400, "أدخل مصطلح البحث");

    const out = { query: q, sources: [], raw: [] };

    for (const src of OSINT_SOURCES) {
      let url;
      try {
        const u = new URL(src.host);
        u.pathname = src.path ? src.path(q) : "";
        u.search = src.query ? ("" + u.search + "&" + src.query(q)) : u.search;
        url = u.toString();
      } catch (_) { continue; }

      let data;
      try {
        data = await fetchOSINT(url);
      } catch (_) { data = null; }

      if (data && typeof data === "object" && Array.isArray(data.results)) {
        for (const r of data.results.slice(0, 12)) {
          const title = r.title || r.name || r.url || null;
          const desc = r.description || r.summary || r.keyword || "";
          const u = r.url || r.link || url;
          out.raw.push({ source: src.name, title: title, description: desc, url: u });
        }
      } else if (data && typeof data === "object" && data.url) {
        out.raw.push({ source: src.name, title: data.title || "ملف تعريفي", description: data.url, url: data.url });
      } else if (data && typeof data === "string" && data.length > 200) {
        out.raw.push({ source: src.name, title: "نتائج لـ " + src.name, description: maxChars(data, 200), url: url });
      } else {
        out.raw.push({ source: src.name, title: "محاولة بحث في " + src.name, description: "لا يوجد بيانات منظمة في الرد", url: url });
      }
    }

    // الترتيب: نتائج بالعنوان/الوصف أولاً ثم القوائم
    out.sources = out.raw.filter(x => x.title && x.title.length).map((x, i) => ({
      id: i,
      source: x.source,
      title: x.title,
      description: x.description,
      url: x.url
    }));

    out.summary = {
      query: q,
      totalHits: out.sources.length,
      sources: [...new Set(out.sources.map(s => s.source))]
    };

    return new Response(JSON.stringify(out, null, 2), {
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
  }

  if (p === "/api/search") return await handleSearch(url);
  if (p === "/api/flights") return await handleFlights();
  if (p === "/api/repos") return await handleRepos(url);
  if (p === "/api/dojos") return await handleDojos(url);

  if (p === "/api/hunt" && req.method === "POST") {
    try { return await handleOSINT(await req.json()); } catch (e) { return jsonError(500, "خطأ داخلي: " + String(e)); }
  }

  // أصول ثابتة
  if (env && env.ASSETS) return env.ASSETS.fetch(req);
  return new Response("Not found", { status: 404 });
}

export default { fetch: handle };

// بحث الويب الذي يستخدمه وضع «البحث العميق» في الواجهة
async function handleSearch(url) {
  const q = String(url.searchParams.get("q") || "").trim();
  if (!q) return jsonError(400, "أدخل كلمة بحث");
  let hits = [];
  try { hits = (await huntSearchWeb(q)).hits || []; } catch (_) { hits = []; }
  return new Response(JSON.stringify({
    ok: true,
    query: q,
    results: hits.map((h) => ({ title: h.title, url: h.url, snippet: h.snippet }))
  }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

// ============================================================
// طيران مباشر فوق الجزائر — ADS-B مفتوح بلا مفاتيح
// المصدران: OpenSky (صندوق إحداثيات واحد يغطي الجزائر) ثم adsb.lol كبديل
// ============================================================
const DZ = { minLat: 18.9, maxLat: 37.2, minLon: -8.75, maxLon: 12.05, clat: 28.03, clon: 2.6, cap: { lat: 36.7538, lon: 3.0588 } };
let flightsCache = { at: 0, data: null };

function toRad(d) { return (Number(d) * Math.PI) / 180; }
function bearingTo(lat, lon, lat2, lon2) {
  const y = Math.sin(toRad(lon2 - lon)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function angleDiff(a, b) {
  const d = Math.abs(((Number(a) - Number(b)) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}
function kmBetween(a, b, c, d) {
  const R = 6371, dLat = toRad(c - a), dLon = toRad(d - b);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(s))));
}

function flightStatus(a) {
  if (a.track == null) return "unknown";
  const brg = bearingTo(a.lat, a.lon, DZ.clat, DZ.clon);
  const diff = angleDiff(brg, a.track);
  if (diff <= 55) return "in";
  if (diff >= 125) return "out";
  return "over";
}

async function openskyFlights() {
  const u = "https://opensky-network.org/api/states/all?lamin=" + DZ.minLat + "&lomin=" + DZ.minLon +
    "&lamax=" + DZ.maxLat + "&lomax=" + DZ.maxLon;
  const r = await fetch(u, { headers: UA });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  const states = (j && Array.isArray(j.states)) ? j.states : null;
  if (!states) return null;
  return states.map((s) => ({
    hex: s[0],
    callsign: String(s[1] || "").trim(),
    country: s[2] || "",
    lon: s[5],
    lat: s[6],
    alt: s[7] != null ? Math.round(s[7]) : (s[13] != null ? Math.round(s[13]) : null),
    ground: !!s[8],
    speed: s[9] != null ? Math.round(s[9] * 3.6) : null,
    track: s[10] != null ? Math.round(s[10]) : null,
    vrate: s[11] != null ? Math.round(s[11] * 196.85) : null,
    model: "", reg: ""
  })).filter((a) => a.lat != null && a.lon != null);
}

async function adsbPoint(lat, lon, radius) {
  const r = await fetch("https://api.adsb.lol/v2/point/" + lat + "/" + lon + "/" + radius, { headers: UA });
  if (!r.ok) return [];
  const j = await r.json().catch(() => null);
  return ((j && j.ac) || []).map((a) => ({
    hex: a.hex,
    callsign: String(a.flight || "").trim(),
    country: "",
    lat: a.lat,
    lon: a.lon,
    alt: a.alt_baro === "ground" ? 0 : (typeof a.alt_baro === "number" ? Math.round(a.alt_baro) : null),
    ground: a.alt_baro === "ground",
    speed: typeof a.gs === "number" ? Math.round(a.gs * 1.852) : null,
    track: typeof a.track === "number" ? Math.round(a.track) : null,
    vrate: typeof a.baro_rate === "number" ? Math.round(a.baro_rate) : null,
    model: a.t || "",
    reg: a.r || ""
  })).filter((a) => a.lat != null && a.lon != null);
}

async function adsbFlights() {
  const pts = [[36.75, 3.06], [35.62, -0.62], [36.28, 7.95], [32.49, 3.67], [31.67, 6.14], [27.2, 2.47], [22.8, 5.53]];
  const seen = new Map();
  const chunks = await Promise.all(pts.map((p) => adsbPoint(p[0], p[1], 250).catch(() => [])));
  for (const list of chunks) for (const a of list) {
    if (a.lat < DZ.minLat || a.lat > DZ.maxLat || a.lon < DZ.minLon || a.lon > DZ.maxLon) continue;
    seen.set(a.hex, a);
  }
  const out = Array.from(seen.values());
  return out.length ? out : null;
}

function flightRow(a) {
  const st = flightStatus(a);
  return {
    hex: a.hex,
    callsign: a.callsign || a.hex,
    reg: a.reg || "",
    model: a.model || "",
    country: a.country || "",
    lat: Math.round(a.lat * 1000) / 1000,
    lon: Math.round(a.lon * 1000) / 1000,
    alt: a.alt,
    speed: a.speed,
    track: a.track,
    vrate: a.vrate,
    ground: !!a.ground,
    status: st,
    toCapital: kmBetween(a.lat, a.lon, DZ.cap.lat, DZ.cap.lon)
  };
}

async function handleFlights() {
  if (flightsCache.data && Date.now() - flightsCache.at < 15000) {
    return new Response(JSON.stringify(flightsCache.data), {
      headers: { "content-type": "application/json", "cache-control": "no-store", "x-cache": "hit" }
    });
  }
  let rows = [], source = "";
  // adsb.lol أولاً: أسرع بكثير من OpenSky من شبكة السحابة، ثم OpenSky كبديل
  try { rows = (await adsbFlights()) || []; if (rows.length) source = "adsb.lol"; } catch (_) { rows = []; }
  if (!rows.length) {
    try { rows = (await openskyFlights()) || []; if (rows.length) source = "OpenSky Network"; } catch (_) { rows = []; }
  }
  // استبعاد المركبات الأرضية (برج المراقبة، سيارات المطار) — ليست رحلات جوية
  const aircraft = rows.filter((a) => !a.ground).map(flightRow)
    .sort((a, b) => (a.toCapital || 0) - (b.toCapital || 0)).slice(0, 120);
  const data = {
    ok: aircraft.length > 0,
    source: source || "لا مصدر متاح الآن",
    updated: new Date().toISOString(),
    bbox: { minLat: DZ.minLat, maxLat: DZ.maxLat, minLon: DZ.minLon, maxLon: DZ.maxLon },
    counts: {
      total: aircraft.length,
      in: aircraft.filter((a) => a.status === "in").length,
      out: aircraft.filter((a) => a.status === "out").length,
      over: aircraft.filter((a) => a.status === "over").length
    },
    aircraft
  };
  if (aircraft.length) flightsCache = { at: Date.now(), data };
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

// ============================================================
// مستودعات مفتوحة المصدر: قائمة منسّقة + بحث حيّ في GitHub بلا مفتاح
// ============================================================
const REPO_CURATED = [
  { repo: "ollama/ollama", cat: "ai", why: "تشغيل نماذج مفتوحة محلياً بأمر واحد" },
  { repo: "huggingface/transformers", cat: "ai", why: "المكتبة المرجعية للنماذج المفتوحة" },
  { repo: "ggml-org/llama.cpp", cat: "ai", why: "استدلال سريع على المعالج بلا GPU" },
  { repo: "open-webui/open-webui", cat: "ai", why: "واجهة دردشة كاملة فوق Ollama" },
  { repo: "langchain-ai/langchain", cat: "ai", why: "بناء وكلاء وسلاسل أدوات" },
  { repo: "comfyanonymous/ComfyUI", cat: "image", why: "توليد صور بنماذج مفتوحة عبر رسم بياني" },
  { repo: "AUTOMATIC1111/stable-diffusion-webui", cat: "image", why: "واجهة SD الكلاسيكية" },
  { repo: "invoke-ai/InvokeAI", cat: "image", why: "استوديو صور احترافي مفتوح" },
  { repo: "openai/whisper", cat: "audio", why: "تفريغ صوتي متعدد اللغات" },
  { repo: "coqui-ai/TTS", cat: "audio", why: "توليد كلام بنماذج مفتوحة" },
  { repo: "remotion-dev/remotion", cat: "video", why: "إنتاج فيديو بالكود (React)" },
  { repo: "FFmpeg/FFmpeg", cat: "video", why: "المحرّك العالمي للصوت والصورة" },
  { repo: "shaka-project/shaka-player", cat: "video", why: "مشغّل بث تكيّفي" },
  { repo: "openskynetwork/opensky-api", cat: "flights", why: "بيانات الطيران المفتوحة (مصدر هذه الصفحة)" },
  { repo: "wiedehopf/tar1090", cat: "flights", why: "خريطة ADS-B حيّة على خادمك" },
  { repo: "flightaware/dump1090", cat: "flights", why: "استقبال ADS-B بمستقبل رخيص" },
  { repo: "pwncollege/dojo", cat: "security", why: "منصّة pwn.college نفسها، مفتوحة بالكامل" },
  { repo: "Gallopsled/pwntools", cat: "security", why: "أدوات استغلال ثنائيات" },
  { repo: "radareorg/radare2", cat: "security", why: "هندسة عكسية" },
  { repo: "NationalSecurityAgency/ghidra", cat: "security", why: "مفكّك ومحلّل ثنائيات" },
  { repo: "lockfale/OSINT-Framework", cat: "osint", why: "شجرة أدوات OSINT" },
  { repo: "jivoi/awesome-osint", cat: "osint", why: "قائمة OSINT الأشهر" },
  { repo: "sherlock-project/sherlock", cat: "osint", why: "تتبّع اسم مستخدم عبر المواقع" },
  { repo: "soxoj/maigret", cat: "osint", why: "ملف شخصي من اسم مستخدم" },
  { repo: "kkuchta/css-only-chat", cat: "tools", why: "تجربة أنيقة: دردشة بلا JS" },
  { repo: "public-apis/public-apis", cat: "tools", why: "واجهات برمجية مجانية" },
  { repo: "EbookFoundation/free-programming-books", cat: "tools", why: "كتب برمجة مجانية" },
  { repo: "httpie/cli", cat: "tools", why: "عميل HTTP ودود" }
];
let repoCache = { at: 0, key: "", data: null };
const GH_HEADERS = { ...UA, accept: "application/vnd.github+json" };

async function ghRepo(full) {
  const r = await fetch("https://api.github.com/repos/" + full, { headers: GH_HEADERS });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j || !j.full_name) return null;
  return {
    name: j.full_name,
    url: j.html_url,
    stars: j.stargazers_count,
    lang: j.language || "",
    desc: j.description || "",
    topics: (j.topics || []).slice(0, 4),
    updated: j.pushed_at
  };
}

async function handleRepos(url) {
  const q = String(url.searchParams.get("q") || "").trim();
  const cat = String(url.searchParams.get("cat") || "all").toLowerCase();
  const cacheKey = q + "|" + cat;
  if (repoCache.data && repoCache.key === cacheKey && Date.now() - repoCache.at < 600000) {
    return new Response(JSON.stringify(repoCache.data), { headers: { "content-type": "application/json", "cache-control": "no-store", "x-cache": "hit" } });
  }
  let repos = [];
  if (q) {
    const r = await fetch("https://api.github.com/search/repositories?q=" + encodeURIComponent(q) + "&sort=stars&order=desc&per_page=18", { headers: GH_HEADERS });
    const j = await r.json().catch(() => null);
    repos = ((j && j.items) || []).map((x) => ({
      name: x.full_name, url: x.html_url, stars: x.stargazers_count,
      lang: x.language || "", desc: x.description || "", topics: (x.topics || []).slice(0, 4),
      updated: x.pushed_at, why: ""
    }));
  } else {
    const picks = REPO_CURATED.filter((r) => cat === "all" || r.cat === cat).slice(0, 14);
    const got = await Promise.all(picks.map((p) => ghRepo(p.repo).catch(() => null)));
    repos = picks.map((p, i) => got[i] ? Object.assign({ cat: p.cat, why: p.why }, got[i]) : { name: p.repo, url: "https://github.com/" + p.repo, stars: null, lang: "", desc: p.why, why: p.why, cat: p.cat, topics: [] });
  }
  const data = { ok: true, query: q, cat, repos, credit: "GitHub API — بلا مفتاح (حد ≈60 طلباً/ساعة لكل IP)" };
  if (repos.length) repoCache = { at: Date.now(), key: cacheKey, data };
  return new Response(JSON.stringify(data), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

// ============================================================
// dojos من pwn.college: قراءة حيّة للفهرس وللمراحل + بديل محلي
// ============================================================
const DOJO_FALLBACK = [
  { slug: "linux-luminarium", name: "Linux Luminarium", track: "core", desc: "أساسيات لينكس وسطر الأوامر" },
  { slug: "computing-101", name: "Computing 101", track: "core", desc: "كيف يعمل الحاسوب من الأسفل" },
  { slug: "intro-to-cybersecurity", name: "Intro to Cybersecurity", track: "core", desc: "مدخل الأمن السيبراني" },
  { slug: "program-misuse", name: "Program Misuse", track: "core", desc: "سوء استخدام البرامج" },
  { slug: "how-2-linux", name: "How 2 Linux", track: "core", desc: "لينكس عملياً" },
  { slug: "sandbox", name: "Sandbox", track: "core", desc: "بيئة التجارب" },
  { slug: "web-security", name: "Web Security", track: "core", desc: "أمن الويب" },
  { slug: "cryptography", name: "Cryptography", track: "core", desc: "التشفير" },
  { slug: "system-exploitation", name: "System Exploitation", track: "core", desc: "استغلال الأنظمة" },
  { slug: "reverse-engineering", name: "Reverse Engineering", track: "core", desc: "الهندسة العكسية" }
];
let dojoCache = { at: 0, list: null, details: new Map() };

function stripTags(s) {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/&mdash;/g, "—").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

async function dojoList() {
  if (dojoCache.list && Date.now() - dojoCache.at < 21600000) return dojoCache.list;
  let list = [];
  try {
    const r = await fetch("https://pwn.college/dojos", { headers: UA, redirect: "follow" });
    if (r.ok) {
      const html = await r.text();
      // حدود الأقسام (h2) ثم كل روابط الـ dojos بترتيب الصفحة
      const heads = [];
      const h2re = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
      let hm;
      while ((hm = h2re.exec(html))) heads.push({ at: hm.index, text: stripTags(hm[1]).toLowerCase() });
      const trackAt = (idx) => {
        let t = "core";
        for (const h of heads) {
          if (h.at >= idx) break;
          if (/getting started/.test(h.text)) t = "start";
          else if (/core material/.test(h.text)) t = "core";
          else if (/community material/.test(h.text)) t = "community";
          else if (/course/.test(h.text)) t = "courses";
        }
        return t;
      };
      const re = /<a[^>]+href="\/dojo\/([a-z0-9._~-]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = re.exec(html))) {
        const slug = m[1];
        const inner = m[2];
        const name = stripTags((inner.match(/<h4[^>]*>([\s\S]*?)<\/h4>/) || [])[1] || "");
        const stats = stripTags((inner.match(/<p[^>]*>([\s\S]*?)<\/p>/) || [])[1] || "");
        if (!slug || !name) continue;
        if (list.some((d) => d.slug === slug)) continue;
        list.push({ slug, name, track: trackAt(m.index), desc: maxChars(stats, 160), url: "https://pwn.college/dojo/" + slug });
      }
    }
  } catch (_) {}
  if (list.length < 6) list = DOJO_FALLBACK.slice();
  dojoCache = { at: Date.now(), list, details: dojoCache.details };
  return list;
}

async function dojoDetail(slug) {
  const clean = String(slug || "").toLowerCase().replace(/[^a-z0-9._~-]/g, "");
  if (!clean) return null;
  const cached = dojoCache.details.get(clean);
  if (cached && Date.now() - cached.at < 21600000) return cached.data;
  const r = await fetch("https://pwn.college/dojo/" + clean, { headers: UA, redirect: "follow" });
  if (!r.ok) return null;
  const html = await r.text();
  const name = stripTags((html.match(/<h1[^>]*>([\s\S]{0,120}?)<\/h1>/) || [])[1] || clean);
  const modules = [];
  const re = /<h4[^>]*class="card-title"[^>]*>([\s\S]{0,160}?)<\/h4>/gi;
  let m;
  while ((m = re.exec(html))) {
    const t = stripTags(m[1]);
    if (t && !modules.includes(t)) modules.push(t);
  }
  const data = { slug: clean, name, modules: modules.slice(0, 24), url: "https://pwn.college/dojo/" + clean };
  dojoCache.details.set(clean, { at: Date.now(), data });
  return data;
}

async function handleDojos(url) {
  const slug = url.searchParams.get("slug");
  if (slug) {
    const d = await dojoDetail(slug);
    if (!d) return jsonError(404, "لم يُعثر على هذا الـ dojo");
    return new Response(JSON.stringify({ ok: true, dojo: d }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  const list = await dojoList();
  return new Response(JSON.stringify({ ok: true, dojos: list, source: "pwn.college/dojos", count: list.length }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}


function extractLinks(html) {
  const links = [];
  const re = /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) links.push(m[1]);
  return links;
}

function nodesToText(nodes) {
  return (nodes || []).map(n => {
    const t = typeof n === "string" ? n : (n && n.textContent ? n.textContent : "");
    return t.replace(/\s+/g, " ").trim();
  }).filter(Boolean).join(" ");
}

async function jinaRead(rawUrl) {
  try {
    const res = await fetch("https://r.jina.ai/https://" + rawUrl, { headers: { "X-Return-Format": "text" }, redirect: "follow" });
    return await res.text();
  } catch (_) { return ""; }
}

// --- أوضاع وأدوات البحث (OSINT) — معرّفة على مستوى الوحدة ليراها كل المعالجات ---
const OSINT_METHODS = {
  web: "بحث ويب",
  images: "بحث صور",
  reversetext: "تحليل نص / استخراج"
};

const OSINT_HUNT_SOURCES = [
  { id: "duckduckgo", name: "DuckDuckGo Lite", host: "https://lite.duckduckgo.com", label: "بحث ويب مجاني بدون مفتاح" },
  { id: "jina", name: "r.jina.ai", host: "https://r.jina.ai", label: "قراءة صفحات الويب كنص" },
  { id: "wikipedia", name: "Wikipedia", host: "https://en.wikipedia.org", label: "موسوعة حرة" },
  { id: "google-images", name: "Google Images", host: "https://images.google.com", label: "بحث الصور بالرابط" }
];

// --- DOMParser (linkedom): استخدامه في worker/server دون المتصفح ---
let _DOMParserImpl = null;
try {
  const { DOMParser: LDDOMParser } = require('linkedom');
  _DOMParserImpl = LDDOMParser;
} catch (_) {
  // Fallback خفيف إذا تعذّر تثبيت linkedom
  class DOMParserVirtual {
    parseFromString(html) {
      return {
        querySelectorAll: () => {
          const anchors = [];
          const re = /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([^<]*)<\/a>/gi;
          let m;
          while ((m = re.exec(html))) {
            const hit = m; // التقط النتيجة في ثابت قبل التكرار التالي
            anchors.push({ getAttribute: () => hit[1], textContent: hit[2] });
          }
          return anchors;
        }
      };
    }
  }
  _DOMParserImpl = DOMParserVirtual;
}
try { globalThis.DOMParser = _DOMParserImpl; } catch (_) { /* بيئات تمنع الكتابة على globalThis */ }

// بحث DuckDuckGo Lite المباشر (مجاني بدون مفتاح) — يعيد HTML أو نصاً فارغاً
async function searchDuckDuckGoLite(q) {
  const query = String(q || "").trim();
  if (!query) return "";
  const attempts = [
    () => fetch("https://lite.duckduckgo.com/lite/", {
      method: "POST",
      headers: { ...UA, "content-type": "application/x-www-form-urlencoded", accept: "text/html,application/xhtml+xml" },
      body: new URLSearchParams({ q: query, kl: "wt-wt" }).toString(),
      redirect: "follow"
    }),
    () => fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), {
      headers: { ...UA, accept: "text/html,application/xhtml+xml" },
      redirect: "follow"
    })
  ];
  for (const run of attempts) {
    try {
      const r = await run();
      if (!r.ok) continue;
      const html = await r.text();
      if (html && html.length > 200) return html;
    } catch (_) { /* جرّب المحاولة التالية */ }
  }
  return "";
}

async function huntSearchWeb(q) {
  const results = [];
  const seen = new Set();
  const push = (title, url, snippet) => {
    url = String(url || "").trim();
    if (!/^https?:\/\//.test(url)) return;
    if (/duckduckgo\.com\/(y\.js|duckduckgo-help-pages)|ad_domain=|ad_provider=/i.test(url)) return;
    if (/bing\.com|microsoft\.com|msn\.com/i.test(url)) return;
    if (/^https?:\/\/(www\.)?(duckduckgo\.com|google\.[a-z.]+)\/?$/i.test(url)) return;
    const norm = url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    if (seen.has(norm)) return;
    seen.add(norm);
    results.push({ title: maxChars(title || "", 160), url, snippet: maxChars(snippet || "", 280) });
  };

  // 1) فهارسان مفتوحان بلا مفتاح يعملان من أي شبكة: Hacker News وStack Exchange
  const open = await Promise.all([
    fetch("https://hn.algolia.com/api/v1/search?hitsPerPage=6&query=" + encodeURIComponent(q), { headers: UA })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&site=stackoverflow&pagesize=5&q=" + encodeURIComponent(q), { headers: UA })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null)
  ]);
  for (const h of (open[0] && open[0].hits) || []) {
    const title = h.title || h.story_title;
    if (title) push(title, h.url || "https://news.ycombinator.com/item?id=" + h.objectID, h.author ? "Hacker News · " + h.author : "");
  }
  for (const it of (open[1] && open[1].items) || []) {
    push(stripTags(it.title || ""), it.link, "Stack Overflow · " + (it.score || 0) + " نقطة");
  }

  // 2) DuckDuckGo Lite مباشرة (يعمل من Node وبعض شبكات الحافة)
  if (results.length < 4) {
    const html = await searchDuckDuckGoLite(q);
    if (html) {
      try {
        const doc = new DOMParser().parseFromString(html, "text/html");
        for (const a of doc.querySelectorAll("a[href]")) {
          const url = a.getAttribute("href") || "";
          if (/^(https?:)?\/\//.test(url) && !url.startsWith("//schemas")) {
            const text = (a.textContent || "").replace(/\s+/g, " ").trim();
            if (text) push(text, url, "");
          }
        }
      } catch (_) {}
    }
  }

  // 3) ويكيبيديا: مصدر مضمون، لكن فقط عندما يطابق العنوان أو المقتطف كلمة من الاستعلام
  if (results.length < 6) {
    try {
      const wr = await fetch("https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=6&srsearch=" + encodeURIComponent(q), { headers: UA });
      const wj = await wr.json();
      const toks = q.toLowerCase().split(/[^a-z0-9\u0600-\u06ff.]+/).filter((t) => t.length > 2);
      for (const s of ((wj && wj.query && wj.query.search) || [])) {
        const hay = (String(s.title || "") + " " + stripTags(s.snippet || "")).toLowerCase();
        if (toks.length && !toks.some((t) => hay.includes(t))) continue;
        push(s.title, "https://en.wikipedia.org/wiki/" + encodeURIComponent(String(s.title || "").replace(/ /g, "_")), stripTags(s.snippet || ""));
      }
    } catch (_) {}
  }

  return { hits: results.slice(0, 12), method: "DuckDuckGo Lite + Hacker News + Stack Overflow + ويكيبيديا" };
}

async function huntSearchImages(q) {
  const results = [];
  try {
    const res = await fetch("https://api.pixabay.com/", { method: "GET" });
  } catch (_) {}
  if (results.length === 0) {
    results.push({ title: "است gob البحث عن صور مطابقة (libre بدون مفتاح)", url: "https://images.google.com/?hl=ar", snippet: "طلب الصورة من الخادم؛ المطابقة تُعالج على الخادم." });
  }
  return { hits: results.slice(0, 8), method: "بحث الصور (بدون مفتاح عام)" };
}

async function huntReverseText(text, maxCharsN) {
  const ctx = text.slice(0, 1200);
  const out = { findings: [], method: "التعلّم من النص المرفق" };
  const lines = ctx.split(/\n+/).filter(l => l.trim().length > 6);
  for (const ln of lines.slice(0, 24)) {
    const t = ln.replace(/^[-\s]{4,}/, "").trim();
    if (!t) continue;
    out.findings.push({ field: "segment", value: maxChars(t, maxCharsN || 200) });
  }
  if (!out.findings.length) out.findings.push({ field: "note", value: "لم يُعالج النص المرفق سوى هذا القطع القصير." });
  return out;
}

async function handleHunt(q, method) {
  let methodL = String(method || "web").toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(OSINT_METHODS, methodL)) methodL = "web";
  const query = String(q || "").trim();
  if (!query) return jsonError(400, "أدخل كلمة للبحث أو نصاً للتحليل");

  try {
    const h = [];
    if (methodL === "web") {
      h.push(await huntSearchWeb(query));
    } else if (methodL === "images") {
      h.push(await huntSearchImages(query));
    } else if (methodL === "reverseText") {
      h.push(await huntReverseText(query, 240));
    }
    return new Response(JSON.stringify({
      ok: true,
      query,
      method: methodL,
      methodLabel: OSINT_METHODS[methodL],
      sources: OSINT_HUNT_SOURCES,
      hits: h
    }), {
      headers: { "content-type": "application/json", "cache-control": "no-store", "x-image-engine": "osint-hunt" }
    });
  } catch (e) {
    try { console.error("[hunt] " + methodL + " failed:", e && e.stack ? e.stack : e); } catch (_) {}
    return jsonError(502, "تعذر إكمال البحث: " + String(e && e.message ? e.message : e));
  }
}

// ---------- استبدال /api/search بعنوان hunt الجديد (المسبوق بـ OSINT) --
