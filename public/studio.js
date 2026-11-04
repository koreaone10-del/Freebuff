// ============================================================================
// CHIBANI AI — استوديو الفيديو:
// خطة المشاهد (/api/video/plan) → صور مولّدة (/api/image) → تعليق عربي (/api/tts)
// → موسيقى مولّدة بـ Web Audio → تسجيل Canvas + MediaRecorder داخل المتصفح.
// الصيغة: MP4 (H.264/AAC) إن دعمها المتصفح، وإلا WebM (VP9/VP8) — بدون أي محوّل.
// ============================================================================
(function () {
  "use strict";

  const CB = (window.CB = window.CB || {});
  const $ = (s) => document.querySelector(s);
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad2 = (n) => String(n).padStart(2, "0");
  const clock = (s) => Math.floor(s / 60) + ":" + pad2(Math.round(s) % 60);

  const STYLE_PROMPT = {
    cinematic: "cinematic film still, dramatic volumetric lighting, shallow depth of field, 35mm, highly detailed",
    documentary: "documentary photography, natural light, candid composition, realistic textures",
    anime: "anime key visual, vibrant colors, detailed painted background, studio quality",
    "3d": "3d render, soft studio lighting, clean geometry, subsurface scattering, octane"
  };

  const DIMS = { "16:9": [1280, 720], "9:16": [720, 1280], "1:1": [960, 960] };

  const S = {
    topic: "",
    n: 6,
    aspect: "16:9",
    style: "cinematic",
    narration: true,
    music: true,
    running: false,
    canceled: false,
    plan: null,
    images: [],
    audios: [],
    durations: [],
    marks: [],
    url: "",
    blob: null
  };

  /* --------------------------- عناصر الواجهة ---------------------------- */
  function pct(v, step) {
    const bar = $("#vdBar"), out = $("#vdPct"), st = $("#vdStep");
    const p = clamp(Math.round(v * 100), 0, 100);
    if (bar) bar.style.width = p + "%";
    if (out) out.textContent = p + "%";
    if (st && step != null) st.textContent = step;
  }

  function phaseList() {
    const box = $("#vdLines");
    if (!box) return null;
    box.innerHTML = "";
    const rows = [
      { id: "plan", t: "تخطيط المشاهد والسيناريو" },
      { id: "img", t: "توليد صور المشاهد" },
      { id: "voice", t: "تسجيل التعليق الصوتي" },
      { id: "music", t: "تركيب الموسيقى" },
      { id: "rec", t: "المونتاج والتسجيل" }
    ];
    rows.forEach((r, i) => {
      const el = document.createElement("div");
      el.className = "sline";
      el.dataset.phase = r.id;
      el.innerHTML = '<span class="si">' + (i + 1) + "</span><span>" + esc(r.t) + "</span>";
      box.appendChild(el);
    });
    return {
      set(id, state, text) {
        const row = box.querySelector('[data-phase="' + id + '"]');
        if (!row) return;
        row.classList.toggle("act", state === "act");
        row.classList.toggle("done", state === "done");
        if (state === "done") row.querySelector(".si").textContent = "✓";
        if (text) row.lastElementChild.textContent = text;
      }
    };
  }

  function fmtInfo() {
    const el = $("#vdFmt");
    if (!el) return;
    const mime = pickMime();
    const label = mime.includes("mp4") ? "MP4 (H.264 + AAC)" : mime.includes("webm") ? "WebM (VP9/VP8 + Opus)" : "غير مدعومة";
    el.innerHTML = "صيغة الإخراج: <b>" + label + "</b> — تُسجَّل داخل متصفحك مباشرة دون أي محوّل خارجي." +
      (mime.includes("webm") ? ' <span style="color:var(--gold)">متصفحك لا يملك مُرمِّز MP4، لذا سيُخرج WebM بجودة عالية.</span>' : "");
  }

  /* ------------------------------ اختيار الصيغة --------------------------- */
  function pickMime() {
    const list = [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4;codecs=avc1.4D401F,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm"
    ];
    for (const m of list) {
      try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m; } catch (_) {}
    }
    return "video/webm";
  }

  /* ------------------------------ تحميل الصور ---------------------------- */
  function loadImage(url, timeout) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      let done = false;
      const t = setTimeout(() => {
        if (done) return;
        done = true;
        reject(new Error("انتهت مهلة الصورة"));
      }, timeout || 90000);
      img.onload = () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(img);
      };
      img.onerror = () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        reject(new Error("فشل تحميل الصورة"));
      };
      img.src = url;
    });
  }

  async function sceneImage(prompt, w, h, seed) {
    const q = new URLSearchParams({ prompt: prompt, width: String(w), height: String(h), seed: String(seed) });
    const url = "/api/image?" + q.toString();
    try {
      return { img: await loadImage(url), url: url };
    } catch (_) {
      // محاولة ثانية ببذرة أخرى
      const q2 = new URLSearchParams({ prompt: prompt + ", beautiful composition", width: String(w), height: String(h), seed: String(seed + 77) });
      const url2 = "/api/image?" + q2.toString();
      try { return { img: await loadImage(url2, 70000), url: url2 }; } catch (_2) { return { img: null, url: "" }; }
    }
  }

  function placeholder(w, h, i, caption) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    const hue = (i * 57) % 360;
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "hsl(" + hue + ",55%,22%)");
    grad.addColorStop(1, "hsl(" + ((hue + 60) % 360) + ",45%,10%)");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(255,255,255,.08)";
    for (let k = 0; k < 40; k++) {
      g.beginPath();
      g.arc(Math.random() * w, Math.random() * h, Math.random() * (w / 26) + 6, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "rgba(255,255,255,.85)";
    g.font = "700 " + Math.round(w * 0.035) + "px Cairo, Tahoma, sans-serif";
    g.textAlign = "center";
    g.direction = "rtl";
    g.fillText("مشهد " + (i + 1), w / 2, h / 2);
    const img = new Image();
    img.src = c.toDataURL("image/png");
    return img;
  }

  /* ------------------------------- النطق --------------------------------- */
  async function fetchTTS(text, signal) {
    const url = "/api/tts?text=" + encodeURIComponent(text) + "&lang=ar";
    const res = await fetch(url, { signal: signal });
    if (!res.ok) throw new Error("نطق غير متاح");
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 1200) throw new Error("ملف صوتي قصير جداً");
    return buf;
  }

  /* ------------------------------ الموسيقى -------------------------------- */
  function scheduleMusic(ac, dest, start, total, mood) {
    const roots = {
      calm: [196, 246.94, 293.66],
      epic: [110, 164.81, 220],
      uplifting: [261.63, 329.63, 392],
      mysterious: [174.61, 207.65, 261.63]
    };
    const notes = roots[mood] || roots.calm;
    const out = ac.createGain();
    out.gain.value = 0.0001;
    out.connect(dest);
    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    filter.Q.value = 0.7;
    filter.connect(out);
    const oscs = [];
    notes.forEach((f, i) => {
      const osc = ac.createOscillator();
      osc.type = i === 0 ? "sine" : "triangle";
      osc.frequency.value = f;
      osc.detune.value = (i - 1) * 5;
      const g = ac.createGain();
      g.gain.value = i === 0 ? 0.16 : 0.075;
      osc.connect(g).connect(filter);
      osc.start(start);
      osc.stop(start + total + 0.5);
      oscs.push(osc);
    });
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ac.createGain();
    lg.gain.value = 220;
    lfo.connect(lg).connect(filter.frequency);
    lfo.start(start);
    lfo.stop(start + total + 0.5);

    const peak = 0.32;
    out.gain.setValueAtTime(0.0001, start);
    out.gain.exponentialRampToValueAtTime(peak, start + Math.min(3, total / 4));
    out.gain.setValueAtTime(peak, start + Math.max(2.5, total - 2.5));
    out.gain.exponentialRampToValueAtTime(0.0001, start + total);
    return { nodes: oscs.concat([lfo]) };
  }

  /* ------------------------------ الرسم ---------------------------------- */
  function wrapText(ctx, text, maxWidth) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? cur + " " + w : w;
      if (ctx.measureText(test).width > maxWidth && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
    return lines.slice(0, 3);
  }

  function drawCover(ctx, img, W, H, zoom, pan) {
    ctx.fillStyle = "#05050b";
    ctx.fillRect(0, 0, W, H);
    if (!img || !img.width) return;
    const scale = Math.max(W / img.width, H / img.height) * zoom;
    const dw = img.width * scale, dh = img.height * scale;
    const dx = (W - dw) / 2 + Math.sin(pan * Math.PI) * (W * 0.012);
    const dy = (H - dh) / 2 - (pan - 0.5) * (H * 0.018);
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function drawFrame(ctx, W, H, t, sceneIdx, local, caption, title, subtitle, isFirst) {
    const sc = S.plan.scenes[sceneIdx] || {};
    const img = S.images[sceneIdx];
    const zoom = 1.04 + 0.08 * easeInOut(clamp(local, 0, 1));
    drawCover(ctx, img, W, H, zoom, clamp(local, 0, 1));

    // تظليل سفلي لقراءة النص
    const g = ctx.createLinearGradient(0, H * 0.52, 0, H);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,.86)");
    ctx.fillStyle = g;
    ctx.fillRect(0, H * 0.52, W, H * 0.48);

    const fs = Math.round(W * 0.032);
    const pad = Math.round(H * 0.075);
    ctx.direction = "rtl";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = "700 " + fs + "px Cairo, Tahoma, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,.94)";
    ctx.shadowColor = "rgba(0,0,0,.75)";
    ctx.shadowBlur = 10;
    const lines = wrapText(ctx, caption || sc.caption || "", W * 0.82);
    lines.forEach((line, i) => {
      ctx.fillText(line, W / 2, H - pad - (lines.length - 1 - i) * (fs * 1.45));
    });

    if (isFirst && title) {
      const alpha = clamp((3.4 - t) / 0.9, 0, 1);
      ctx.globalAlpha = alpha;
      const tg = ctx.createLinearGradient(0, 0, 0, H);
      tg.addColorStop(0, "rgba(0,0,0,.62)");
      tg.addColorStop(0.65, "rgba(0,0,0,.18)");
      tg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = tg;
      ctx.fillRect(0, 0, W, H * 0.55);
      ctx.fillStyle = "#fff";
      ctx.font = "900 " + Math.round(W * 0.055) + "px Cairo, Tahoma, sans-serif";
      const tl = wrapText(ctx, title, W * 0.86).slice(0, 2);
      tl.forEach((line, i) => ctx.fillText(line, W / 2, H * 0.26 + i * W * 0.068));
      if (subtitle) {
        ctx.font = "600 " + Math.round(W * 0.022) + "px Cairo, Tahoma, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,.82)";
        ctx.fillText(wrapText(ctx, subtitle, W * 0.82)[0] || "", W / 2, H * 0.26 + tl.length * W * 0.068 + W * 0.03);
      }
      ctx.globalAlpha = 1;
    }
    ctx.shadowBlur = 0;
  }

  /* ------------------------------ التسجيل -------------------------------- */
  async function record(ac, dest, canvas, total, anchor, onProgress) {
    const stream = canvas.captureStream(30);
    if (dest) dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
    const mime = pickMime();
    const rec = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: 5_000_000,
      audioBitsPerSecond: 128_000
    });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res) => { rec.onstop = () => res(new Blob(chunks, { type: mime })); });

    const ctx = canvas.getContext("2d");
    const acStart = anchor;
    const perfStart = performance.now();
    const W = canvas.width, H = canvas.height;

    rec.start(300);

    await new Promise((resolve) => {
      const tick = () => {
        if (S.canceled) { resolve(); return; }
        const t = ac ? Math.max(0, ac.currentTime - acStart) : Math.max(0, (performance.now() - perfStart) / 1000);
        if (t >= total) { resolve(); return; }
        let idx = 0, acc = 0;
        for (let i = 0; i < S.durations.length; i++) {
          if (t < acc + S.durations[i]) { idx = i; break; }
          acc += S.durations[i];
          idx = Math.min(i + 1, S.durations.length - 1);
        }
        const local = clamp((t - acc) / Math.max(0.001, S.durations[idx] || 1), 0, 1);
        drawFrame(ctx, W, H, t, idx, local, S.plan.scenes[idx] && S.plan.scenes[idx].caption, S.plan.title, S.plan.subtitle, idx === 0);
        onProgress(0.78 + 0.21 * clamp(t / total, 0, 1));
        requestAnimationFrame(tick);
      };
      tick();
    });

    try { rec.stop(); } catch (_) {}
    const blob = await stopped;
    stream.getTracks().forEach((tr) => tr.stop());
    return { blob: blob, mime: mime };
  }

  /* --------------------------- خط الإنتاج الكامل -------------------------- */
  async function produce() {
    if (S.running) return;
    const topic = ($("#vdTopic") ? $("#vdTopic").value.trim() : "") || S.topic;
    if (!topic) { CB.toast("اكتب موضوع الفيديو أولاً"); return; }

    S.topic = topic;
    S.canceled = false;
    S.running = true;
    S.plan = null;
    S.images = [];
    S.audios = [];
    S.durations = [];
    S.marks = [];
    let acRef = null;
    if (S.url) { URL.revokeObjectURL(S.url); S.url = ""; S.blob = null; }

    const start = $("#vdStart");
    if (start) { start.disabled = true; start.textContent = "⏳ جارٍ الإنتاج..."; }
    const stage = $("#vdStage");
    if (stage) stage.classList.add("on");
    const preview = $("#vdPreview");
    if (preview) preview.classList.add("on");
    const result = $("#vdResult");
    if (result) result.innerHTML = "";
    const phases = phaseList();
    pct(0.01, "بدء الإنتاج…");

    S.n = Number(S.n) || 6;
    const [W, H] = DIMS[S.aspect] || DIMS["16:9"];
    const styleText = STYLE_PROMPT[S.style] || STYLE_PROMPT.cinematic;

    try {
      /* 1) الخطة */
      if (phases) phases.set("plan", "act");
      pct(0.03, "أكتب السيناريو وأوزّع المشاهد…");
      const plan = await CB.api("/api/video/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: topic, scenes: S.n, style: styleText })
      });
      if (S.canceled) throw new Error("أُلغي الإنتاج");
      S.plan = plan;
      if (!plan.scenes || !plan.scenes.length) throw new Error("تعذّر بناء خطة المشاهد");
      S.n = plan.scenes.length;
      if (phases) phases.set("plan", "done", "السيناريو جاهز: " + (plan.title || "بدون عنوان"));
      pct(0.08, "الخطة جاهزة — أبدأ توليد الصور…");

      /* 2) الصور */
      if (phases) phases.set("img", "act");
      const images = [];
      for (let i = 0; i < S.n; i++) {
        if (S.canceled) throw new Error("أُلغي الإنتاج");
        const sc = S.plan.scenes[i];
        const prompt = (sc.image || "cinematic scene") + ", " + styleText + ", no text, no watermark";
        pct(0.08 + 0.47 * (i / S.n), "أرسم المشهد " + (i + 1) + " من " + S.n + "… (" + Math.round((i / S.n) * 100) + "%)");
        const got = await sceneImage(prompt, W, H, 1000 + i * 37 + Math.floor(Math.random() * 90));
        if (S.canceled) throw new Error("أُلغي الإنتاج");
        images.push(got.img || placeholder(W, H, i, sc.caption));
        S.images = images;
        pct(0.08 + 0.47 * ((i + 1) / S.n), "اكتملت صورة المشهد " + (i + 1) + " من " + S.n + " — " + Math.round(((i + 1) / S.n) * 100) + "% من الصور");
      }
      S.images = images;
      if (phases) phases.set("img", "done", "الصور جاهزة (" + images.length + ")");
      pct(0.56, "الصور جاهزة — أجهّز الصوت…");

      /* 3) التعليق الصوتي */
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      acRef = ac;
      const dest = ac.createMediaStreamDestination();
      await ac.resume().catch(() => {});
      const narrate = $("#vdNarration") ? $("#vdNarration").checked : S.narration;
      const withMusic = $("#vdMusic") ? $("#vdMusic").checked : S.music;

      if (narrate) {
        if (phases) phases.set("voice", "act");
        for (let i = 0; i < S.n; i++) {
          if (S.canceled) throw new Error("أُلغي الإنتاج");
          pct(0.56 + 0.16 * (i / S.n), "أنطق تعليق المشهد " + (i + 1) + "…");
          const txt = (S.plan.scenes[i].narration || S.plan.scenes[i].caption || "").trim();
          if (!txt) { S.audios.push(null); continue; }
          try {
            const buf = await fetchTTS(txt);
            const decoded = await ac.decodeAudioData(buf.slice(0));
            S.audios.push(decoded);
          } catch (_) {
            S.audios.push(null);
          }
        }
        if (phases) phases.set("voice", "done", "التعليق جاهز (" + S.audios.filter(Boolean).length + "/" + S.n + ")");
      } else if (phases) {
        phases.set("voice", "done", "التعليق الصوتي مغلق");
      }

      /* 4) المدد الزمنية + الموسيقى */
      S.durations = [];
      for (let i = 0; i < S.n; i++) {
        const a = S.audios[i];
        const speech = a && isFinite(a.duration) ? a.duration : 0;
        S.durations.push(clamp(Math.max(3.2, speech + 0.9), 3.2, 13));
      }
      const total = S.durations.reduce((x, y) => x + y, 0);

      // مرساة زمنية واحدة للصوت والصورة معاً — تمنع أي إزاحة بين التعليق والمشاهد
      const anchor = ac.currentTime + 0.6;
      if (withMusic) {
        if (phases) phases.set("music", "act");
        pct(0.73, "أركّب موسيقى الخلفية…");
        scheduleMusic(ac, dest, anchor, total, S.plan.mood || "calm");
        if (phases) phases.set("music", "done", "الموسيقى جاهزة");
      } else if (phases) {
        phases.set("music", "done", "الموسيقى مغلقة");
      }
      let cursorAudio = 0;
      for (let i = 0; i < S.n; i++) {
        const buf = S.audios[i];
        if (buf) {
          const src = ac.createBufferSource();
          src.buffer = buf;
          const g = ac.createGain();
          g.gain.value = 1;
          src.connect(g).connect(dest);
          src.start(anchor + cursorAudio);
        }
        cursorAudio += S.durations[i];
      }

      /* 5) التسجيل */
      if (phases) phases.set("rec", "act");
      pct(0.78, "أسجّل الفيديو بالزمن الحقيقي (" + Math.round(total) + " ثانية) — أبقِ التبويب مفتوحاً…");
      const canvas = $("#vdPreview") || document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      canvas.classList.add("on");

      // ارسم أول إطار قبل بدء التسجيل
      drawFrame(canvas.getContext("2d"), W, H, 0, 0, 0, S.plan.scenes[0].caption, S.plan.title, S.plan.subtitle, true);

      const out = await record(ac, dest, canvas, total, anchor, (v) => {
        pct(v, "تسجيل المشاهد… " + Math.round((v - 0.78) / 0.21 * 100) + "%");
      });
      if (S.canceled) throw new Error("أُلغي الإنتاج");

      /* 6) تصحيح المدة + العرض */
      let blob = out.blob;
      let note = "";
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const fixed = out.mime.includes("mp4")
          ? (window.VD_MP4 && window.VD_MP4.fixDuration ? window.VD_MP4.fixDuration(bytes, total) : null)
          : (window.VD_WEBM && window.VD_WEBM.fixDuration ? window.VD_WEBM.fixDuration(bytes, total) : null);
        if (fixed && fixed.bytes && fixed.changed) {
          blob = new Blob([fixed.bytes], { type: out.mime.split(";")[0] });
          note = "صُحّحت مدة الملف لتظهر صحيحة في المشغّلات (" + (fixed.duration ? fixed.duration.toFixed(1) : total.toFixed(1)) + "ث).";
        }
        if (!out.mime.includes("mp4") && window.VD_WEBM && window.VD_WEBM.inspect) {
          const info = window.VD_WEBM.inspect(bytes);
          if (info && info.clusters) {
            note += (note ? " " : "") + "فهرس WebM: " + info.clusters + " كتلة، " + info.blocks + " إطاراً — التنقل بين المشاهد فوري.";
          }
        }
      } catch (_) {}

      S.blob = blob;
      S.url = URL.createObjectURL(blob);

      let cursor = 0;
      S.marks = S.durations.map((d, i) => {
        const m = { start: cursor, dur: d, skip: false };
        cursor += d;
        return m;
      });

      pct(1, "تم الإنتاج بنجاح ✓");
      if (phases) phases.set("rec", "done", "اكتمل التسجيل");

      const ext = out.mime.includes("mp4") ? "mp4" : "webm";
      showResult(blob, out.mime, total, ext, note);
      deliverToChat(out.mime, total, ext);

    } catch (e) {
      const canceled = String(e.message || "").includes("أُلغي");
      pct(0, canceled ? "أُلغي الإنتاج" : "تعذّر الإنتاج");
      if (!canceled && result) {
        result.innerHTML = '<div class="vd-fail">⚠️ ' + esc(e.message || "خطأ غير متوقع") + "</div>";
      }
      if (canceled) CB.toast("أُلغي إنتاج الفيديو");
    } finally {
      S.running = false;
      if (acRef) { const a = acRef; acRef = null; setTimeout(() => { try { a.close(); } catch (_) {} }, 1500); }
      if (start) { start.disabled = false; start.textContent = "✨ ابدأ الإنتاج"; }
    }
  }

  function showResult(blob, mime, total, ext, note) {
    const result = $("#vdResult");
    if (!result) return;
    const marks = S.marks.map((m, i) =>
      '<button class="vd-mark" data-t="' + m.start.toFixed(2) + '"><span class="vd-mark-dot"></span>المشهد ' + (i + 1) + ' <span class="vd-mark-time">' + clock(m.start) + "</span></button>"
    ).join("");
    result.innerHTML = '<div class="vd-final">' +
      '<video src="' + S.url + '" controls playsinline preload="metadata"></video>' +
      '<div class="vd-final-bar">' +
      '<div class="vfb-meta"><b>' + esc(S.plan.title || "فيديو CHIBANI") + '</b><span>' + esc(S.plan.subtitle || "") + " · " + clock(total) + " · " + ext.toUpperCase() + "</span></div>" +
      '<a class="vfb-act" download="chibani-' + Date.now() + "." + ext + '" href="' + S.url + '">⬇ تحميل</a>' +
      '<button class="vfb-act" data-vd="chat">💬 أرسل إلى المحادثة</button>' +
      '<button class="vfb-act" data-vd="again">↻ إنتاج جديد</button>' +
      "</div>" +
      (marks ? '<div class="vd-final-bar"><span class="vd-mark-label">فهرس المشاهد — انقر للانتقال داخل الفيديو</span>' + marks + "</div>" : "") +
      '<div class="vfb-note' + (note ? "" : " warn") + '">' + esc(note || "الملف جاهز في ذاكرتك فقط — نزّله قبل إغلاق التبويب.") + "</div>" +
      "</div>";

    const v = result.querySelector("video");
    const list = Array.from(result.querySelectorAll(".vd-mark"));
    if (v) {
      v.addEventListener("timeupdate", () => {
        const t = v.currentTime;
        list.forEach((b, i) => {
          const start = Number(b.dataset.t) || 0;
          const end = i + 1 < list.length ? Number(list[i + 1].dataset.t) : Infinity;
          b.classList.toggle("on", t >= start && t < end);
        });
      });
    }
    list.forEach((b) => b.addEventListener("click", () => {
      if (!v) return;
      v.currentTime = Number(b.dataset.t) || 0;
      v.play().catch(() => {});
    }));
    result.querySelectorAll("[data-vd]").forEach((b) => {
      b.addEventListener("click", () => {
        if (b.dataset.vd === "chat") deliverToChat(mime, total, ext);
        else { result.innerHTML = ""; pct(0, "جاهز لفكرة جديدة"); if ($("#vdStage")) $("#vdStage").classList.remove("on"); }
      });
    });
  }

  let deliveredUrl = "";
  function deliverToChat(mime, total, ext) {
    if (!S.url || deliveredUrl === S.url) { CB.toast("الفيديو موجود في المحادثة بالفعل"); return; }
    if (!CB.chat) return;
    deliveredUrl = S.url;
    const marks = S.marks.map((m) => ({ start: m.start, dur: m.dur }));
    CB.chat.deliver("🎬 **" + (S.plan.title || "فيديو CHIBANI") + "**\n\n" + (S.plan.subtitle || "") +
      "\n\nالمدة " + clock(total) + " · " + ext.toUpperCase() + " · " + marks.length + " مشاهد — استخدم فهرس المشاهد تحت الفيديو للتنقل السريع.",
      { video: { url: S.url, title: S.plan.title || "فيديو CHIBANI", meta: clock(total) + " · " + ext.toUpperCase(), marks: marks } });
    CB.toast("أُرسل الفيديو إلى المحادثة");
  }

  /* ------------------------------- الواجهة -------------------------------- */
  function bindSeg(sel, key, cast, dataKey) {
    const host = $(sel);
    if (!host) return;
    host.addEventListener("click", (e) => {
      const b = e.target.closest(".sm");
      if (!b) return;
      host.querySelectorAll(".sm").forEach((x) => x.classList.toggle("on", x === b));
      const raw = b.dataset[dataKey || key];
      if (raw == null) return;
      S[key] = cast ? cast(raw) : raw;
    });
  }

  function open(topic) {
    const ov = $("#videoOverlay");
    if (!ov) return;
    if (topic) {
      const ta = $("#vdTopic");
      if (ta) ta.value = topic;
    }
    pct(0, "");
    const stage = $("#vdStage");
    if (stage) stage.classList.remove("on");
    const result = $("#vdResult");
    if (result) result.innerHTML = "";
    if ($("#vdLines")) $("#vdLines").innerHTML = "";
    fmtInfo();
    ov.classList.add("open");
    setTimeout(() => { const t = $("#vdTopic"); if (t) t.focus(); }, 120);
  }

  function close() {
    const ov = $("#videoOverlay");
    if (ov) ov.classList.remove("open");
    if (S.running) cancel();
  }

  function cancel() {
    S.canceled = true;
  }

  function init() {
    bindSeg("#vdScenes", "n", (v) => Number(v), "n");
    bindSeg("#vdAspect", "aspect", null, "v");
    bindSeg("#vdStyle", "style", null, "s");
    const start = $("#vdStart");
    if (start) start.addEventListener("click", produce);
    const closeBtn = $("#vdClose");
    if (closeBtn) closeBtn.addEventListener("click", close);
    const nEl = $("#vdNarration");
    if (nEl) nEl.addEventListener("change", () => { S.narration = nEl.checked; });
    const mEl = $("#vdMusic");
    if (mEl) mEl.addEventListener("change", () => { S.music = mEl.checked; });
    fmtInfo();
  }

  CB.studio = {
    init: init,
    open: open,
    close: close,
    cancel: cancel,
    produce: produce,
    state: S
  };
})();
