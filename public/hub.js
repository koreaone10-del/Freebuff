// ============================================================================
// CHIBANI AI — مركز الأدوات: أدوات الذكاء الاصطناعي، طيران مباشر فوق الجزائر،
// مستودعات مفتوحة المصدر، ووكيل متعلّم من مناهج pwn.college.
// كل الطلبات تمرّ إلى /api/* على خادمك؛ لا مفاتيح ولا حسابات.
// ============================================================================
(function () {
  "use strict";

  const CB = (window.CB = window.CB || {});
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const LS = "chibani_hub_v1";

  const st = {
    tab: "tools",
    flights: null,
    flightFilter: "all",
    flightQuery: "",
    flightsTimer: null,
    repos: null,
    repoCat: "all",
    repoQuery: "",
    dojos: null,
    dojoTrack: "all",
    activeDojo: null,
    dojoDetail: null
  };

  function prefs() {
    try { return JSON.parse(localStorage.getItem(LS) || "{}"); } catch (_) { return {}; }
  }
  function savePrefs(p) {
    try { localStorage.setItem(LS, JSON.stringify(Object.assign(prefs(), p))); } catch (_) {}
  }
  function dojoDone(slug) {
    const p = prefs().dojos || {};
    return p[slug] || [];
  }
  function setDojoDone(slug, list) {
    const p = prefs().dojos || {};
    p[slug] = list;
    savePrefs({ dojos: p });
  }

  function toast(m) {
    if (CB.toast) CB.toast(m);
  }
  function close() {
    const ov = $("#hubOverlay");
    if (ov) ov.classList.remove("open");
    stopFlightsPoll();
  }
  function open(tab) {
    const ov = $("#hubOverlay");
    if (ov) ov.classList.add("open");
    if (tab) setTab(tab);
    else setTab(st.tab);
  }

  function setTab(tab) {
    st.tab = tab;
    $$("#hubOverlay .hub-tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    $$("#hubOverlay .hub-pane").forEach((p) => p.classList.toggle("on", p.dataset.pane === tab));
    if (tab === "flights") {
      loadFlights();
      startFlightsPoll();
      setTimeout(() => flightMap && flightMap.invalidateSize(), 180);
    } else stopFlightsPoll();
    if (tab === "repos" && !st.repos) loadRepos();
    if (tab === "dojos" && !st.dojos) loadDojos();
    const body = $("#hubOverlay .hub-body");
    if (body) body.scrollTop = 0;
  }

  /* ------------------------------- HTML ---------------------------------- */
  function buildHTML() {
    return '' +
      '<div class="hub-shell">' +
      '<div class="hub-top">' +
      '<div class="hub-brand"><i>✦</i><span>مركز CHIBANI<small>أدوات AI · طيران الجزائر · مستودعات · dojos</small></span></div>' +
      '<div class="hub-tabs">' +
      '<button class="hub-tab" data-tab="tools">🧠 أدوات الذكاء الاصطناعي</button>' +
      '<button class="hub-tab" data-tab="flights">🛩️ مسار الطائرات</button>' +
      '<button class="hub-tab" data-tab="repos">📦 مستودعات مفتوحة</button>' +
      '<button class="hub-tab" data-tab="dojos">🎯 وكيل pwn.college</button>' +
      '</div>' +
      '<button class="hub-x" id="hubClose" title="إغلاق">✕</button>' +
      '</div>' +
      '<div class="hub-body">' +

      /* ---------- tools ---------- */
      '<div class="hub-pane on" data-pane="tools">' +
      '<div class="hub-hero"><h2>كل أدوات الذكاء الاصطناعي في شاشة واحدة</h2>' +
      '<p>ابدأ من أي أداة: تُفتح في المحادثة جاهزة، وتعمل كلها بنماذج مجانية بلا مفاتيح. والأدوات الفورية (JSON، Base64، عدّ، روابط) تُنفَّذ في متصفحك لحظياً.</p></div>' +
      '<div class="hub-grid" id="hubTools"></div>' +
      '<div class="hub-panel"><h3>⚡ أدوات فورية — بلا نموذج ولا انتظار</h3>' +
      '<textarea id="hubToolIn" rows="4" placeholder="ألصق نصاً أو JSON أو رابطاً هنا..."></textarea>' +
      '<div class="hub-row" style="margin-top:10px">' +
      '<button class="hub-mini" data-local="json">🎛️ تنسيق JSON</button>' +
      '<button class="hub-mini" data-local="b64">🔐 Base64 ترميز</button>' +
      '<button class="hub-mini" data-local="unb64">🔓 Base64 فك</button>' +
      '<button class="hub-mini" data-local="url">🔗 URL ترميز</button>' +
      '<button class="hub-mini" data-local="unurl">🔗 URL فك</button>' +
      '<button class="hub-mini" data-local="links">📑 الروابط</button>' +
      '<button class="hub-mini" data-local="count">🔢 إحصاء</button>' +
      '<button class="hub-mini" data-local="md">📝 Markdown</button>' +
      '<button class="hub-mini pri" data-local="copy">⧉ نسخ الناتج</button>' +
      '</div><div class="hub-out" id="hubToolOut" hidden></div></div>' +
      '</div>' +

      /* ---------- flights ---------- */
      '<div class="hub-pane" data-pane="flights">' +
      '<div class="hub-hero"><h2>مسار الطائرات الداخلة والخارجة من الجزائر</h2>' +
      '<p>خريطة جغرافية مباشرة مبنية على Leaflet وOpenStreetMap، مع مواقع ADS-B من الشبكات المفتوحة adsb.lol وAirplanes.live وOpenSky. تُحدَّث العلامات كل 20 ثانية عندما تتوفر بيانات. تصنيف الدخول والخروج تقديري من المسار، وليس مساراً رسمياً من برج المراقبة.</p></div>' +
      '<div class="hub-row" style="margin-bottom:8px">' +
      '<button class="hub-mini pri" id="flRefresh">↻ تحديث الآن</button>' +
      '<button class="hub-mini on" data-fl-filter="all">الكل</button>' +
      '<button class="hub-mini" data-fl-filter="in">داخلة</button>' +
      '<button class="hub-mini" data-fl-filter="out">خارجة</button>' +
      '<button class="hub-mini" data-fl-filter="over">عبور</button>' +
      '<input type="text" id="flSearch" placeholder="ابحث برقم الرحلة أو النوع..." style="max-width:220px" />' +
      '<span class="hub-spacer"></span><span id="flSource" style="color:var(--hub-mut);font-size:11px"></span>' +
      '</div>' +
      '<div class="fl-stats" id="flStats"></div>' +
      '<div class="fl-wrap"><div><div class="fl-map-head"><b>الخريطة الحيّة — الجزائر وشمال إفريقيا</b><span id="flMapStamp">في انتظار بيانات ADS-B…</span></div><div class="fl-map" id="flMap"></div></div><div class="fl-table-wrap"><table><thead><tr>' +
      '<th>الرحلة</th><th>النوع</th><th>الحالة</th><th>الارتفاع</th><th>السرعة</th><th>إلى الجزائر العاصمة</th>' +
      '</tr></thead><tbody id="flRows"><tr><td colspan="6" class="hub-empty">جارٍ قراءة الأجواء…</td></tr></tbody></table></div></div>' +
      '</div>' +

      /* ---------- repos ---------- */
      '<div class="hub-pane" data-pane="repos">' +
      '<div class="hub-hero"><h2>مستودعات مفتوحة المصدر تخدم هذا الموقع</h2>' +
      '<p>قائمة منسّقة (نماذج، صور، فيديو، أمن، OSINT، طيران) مع نجوم حقيقية من GitHub، وبحث حيّ في كل المستودعات بلا مفتاح.</p></div>' +
      '<div class="hub-row" style="margin-bottom:12px">' +
      '<input type="text" id="repoSearch" placeholder="ابحث في GitHub... مثال: flight tracker" style="max-width:320px" />' +
      '<button class="hub-mini pri" id="repoGo">بحث</button><span class="hub-spacer"></span>' +
      '</div>' +
      '<div class="hub-row" id="repoCats" style="margin-bottom:14px">' +
      '<button class="hub-mini on" data-cat="all">الكل</button>' +
      '<button class="hub-mini" data-cat="ai">نماذج AI</button>' +
      '<button class="hub-mini" data-cat="image">صور</button>' +
      '<button class="hub-mini" data-cat="video">فيديو</button>' +
      '<button class="hub-mini" data-cat="audio">صوت</button>' +
      '<button class="hub-mini" data-cat="security">أمن واستغلال</button>' +
      '<button class="hub-mini" data-cat="osint">OSINT</button>' +
      '<button class="hub-mini" data-cat="flights">طيران</button>' +
      '<button class="hub-mini" data-cat="tools">أدوات</button>' +
      '</div>' +
      '<div class="hub-grid" id="repoGrid"><div class="hub-empty">جارٍ التحميل…</div></div>' +
      '</div>' +

      /* ---------- dojos ---------- */
      '<div class="hub-pane" data-pane="dojos">' +
      '<div class="hub-hero"><h2>الوكيل المتعلّم من مناهج pwn.college</h2>' +
      '<p>يقرأ الوكيل فهرس الـ dojos ومراحلها مباشرة من pwn.college، ثم يبني لك خطة تعلّم مرتّبة، يشرح كل مرحلة، ويتابع تقدّمك على هذا الجهاز. ابدأ بـ <b>Computing 101</b> أو <b>Linux Luminarium</b> إن كنت جديداً.</p></div>' +
      '<div class="hub-row" id="dojoTracks" style="margin-bottom:12px">' +
      '<button class="hub-mini on" data-track="all">الكل</button>' +
      '<button class="hub-mini" data-track="start">البداية</button>' +
      '<button class="hub-mini" data-track="core">المنهج الأساسي</button>' +
      '<button class="hub-mini" data-track="community">مجتمع</button>' +
      '<button class="hub-mini" data-track="courses">مقرّرات</button>' +
      '</div>' +
      '<div class="dj-layout"><div><div class="hub-grid" id="dojoGrid"><div class="hub-empty">جارٍ تحميل الـ dojos…</div></div></div>' +
      '<div class="hub-panel dj-side" id="dojoSide"><h3>اختر dojo</h3>' +
      '<p style="color:var(--hub-mut);font-size:11.5px;line-height:1.8;margin:0">ستظهر هنا المراحل، وزر بناء الخطة، ومتابعة الإنجاز.</p></div></div>' +
      '</div>' +

      '</div></div>';
  }

  const TOOLS = [
    { ic: "🎨", t: "توليد صورة مجاناً", d: "AI Horde بنماذج مفتوحة المصدر على GPU متطوعين — بلا مفتاح مستخدم.", b: "صور", act: () => { close(); CB.chat.setMode("img"); focusInput("صورة سينمائية لمدينة جزائرية عائمة فوق السحاب عند الغروب، تفاصيل عالية"); } },
    { ic: "🎬", t: "إنتاج فيديو كامل", d: "سيناريو ومشاهد وصور وتعليق صوتي وموسيقى، ثم تسجيل MP4.", b: "فيديو", act: () => { close(); if (CB.studio) CB.studio.open(""); } },
    { ic: "🔎", t: "بحث عميق بمصادر", d: "يبحث في الويب، يقرأ الصفحات، ويجيب باستشهادات مرقّمة.", b: "بحث", act: () => { close(); CB.chat.setMode("research"); focusInput("ما آخر ما وصل إليه الذكاء الاصطناعي المفتوح المصدر في 2026؟"); } },
    { ic: "🌐", t: "تحليل موقع", d: "يقرأ صفحة كاملة ويحلّل الهدف والبنية والتقنية والتحسينات.", b: "ويب", act: () => { close(); CB.chat.setMode("site"); focusInput("https://"); } },
    { ic: "🛰️", t: "تحقيق OSINT", d: "بحث مفتوح: ويب، صور، وتحليل نص — كل النتائج بمصادرها.", b: "OSINT", act: () => { close(); CB.chat.setMode("osint"); focusInput(""); } },
    { ic: "🧠", t: "شرح كود", d: "ألصق كوداً وسيشرحه سطراً بسطر ويقترح تحسينات وأخطاء محتملة.", b: "برمجة", act: () => ask("اشرح الكود التالي سطراً بسطر، ثم اذكر الأخطاء المحتملة وكيف تختبره:\n\n", "أنت مهندس برمجيات خبير. اشرح بدقة، وأشر إلى المخاطر، وقدّم نسخة محسّنة عند الحاجة.") },
    { ic: "📝", t: "تلخيص نص طويل", d: "خلاصة مركّزة + نقاط عمل من أي نص أو تقرير.", b: "كتابة", act: () => ask("لخّص النص التالي في 7 نقاط، ثم اذكر أهم ثلاث مهام عملية:\n\n", "أنت محرّر تنفيذي. لخّص بلا حشو، واحفظ الأرقام والأسماء كما هي.") },
    { ic: "🌍", t: "ترجمة احترافية", d: "ترجمة دقيقة تحفظ المعنى والمصطلحات التقنية.", b: "لغة", act: () => ask("ترجم النص التالي ترجمة احترافية، واذكر اللغة الأصلية والهدف:\n\n", "أنت مترجم محترف. حافظ على المعنى والمصطلحات، ولا تترجم أسماء الشيفرة.") },
    { ic: "🖼️", t: "تحسين وصف صورة", d: "يحوّل فكرتك إلى برومبت بصري مفصّل جاهز للتوليد.", b: "صور", act: () => ask("حوّل الفكرة التالية إلى برومبت صورة احترافي بالإنجليزية (كاميرا، إضاءة، أسلوب، تفاصيل):\n\n", "أنت مخرج فني. اكتب برومبتاً واحداً قوياً بالإنجليزية ثم سطر شرح بالعربية.") },
    { ic: "🛠️", t: "محرّر حي وأدوات", d: "منسّق JSON وBase64 وURL وعدّ الكلمات واستخراج الروابط.", b: "أدوات", act: () => { close(); CB.chat.setMode("handle"); } },
    { ic: "🎓", t: "خطة تعلّم شخصية", d: "خطة مرتّبة بالأيام من مستواك الحالي إلى هدفك.", b: "تعلّم", act: () => ask("ابنِ لي خطة تعلّم من 14 يوماً لهدف: ", "أنت مدرّب تقني. اجعل الخطة يومية بجدول، مع تمرين عملي ومصدر واحد لكل يوم.") }
  ];

  function focusInput(text) {
    setTimeout(() => {
      const inp = $("#input");
      if (!inp) return;
      if (text) {
        inp.value = text;
        inp.dispatchEvent(new Event("input"));
      }
      inp.focus();
      try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (_) {}
    }, 220);
  }

  function ask(prompt, system) {
    close();
    setTimeout(() => {
      const inp = $("#input");
      if (inp) {
        inp.value = prompt;
        inp.dispatchEvent(new Event("input"));
        inp.focus();
      }
      toast("أكمل الطلب ثم اضغط Enter — الوكيل جاهز");
    }, 200);
    if (system && CB.settings) { /* التوجيه يُرسل مع الطلب من المحادثة */ }
  }

  function renderTools() {
    const host = $("#hubTools");
    if (!host) return;
    host.innerHTML = TOOLS.map((t, i) =>
      '<button class="hub-card" data-tool="' + i + '"><span class="badge">' + esc(t.b) + '</span>' +
      '<span class="ic">' + t.ic + '</span><b>' + esc(t.t) + '</b><span>' + esc(t.d) + '</span></button>'
    ).join("");
    $$("[data-tool]", host).forEach((b) => b.addEventListener("click", () => {
      const t = TOOLS[Number(b.dataset.tool)];
      if (t) t.act();
    }));
  }

  /* --------------------------- أدوات فورية ------------------------------- */
  function localTool(kind) {
    const inp = $("#hubToolIn");
    const out = $("#hubToolOut");
    const text = inp ? inp.value : "";
    const show = (v) => {
      if (!out) return;
      out.hidden = false;
      out.textContent = v;
    };
    try {
      if (kind === "json") show(JSON.stringify(JSON.parse(text), null, 2));
      else if (kind === "b64") show(btoa(unescape(encodeURIComponent(text))));
      else if (kind === "unb64") show(decodeURIComponent(escape(atob(text.trim()))));
      else if (kind === "url") show(encodeURIComponent(text));
      else if (kind === "unurl") show(decodeURIComponent(text));
      else if (kind === "links") show((text.match(/https?:\/\/[^\s<>"')]+/g) || []).join("\n") || "لا روابط");
      else if (kind === "count") {
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        show("الكلمات: " + words + "\nالأحرف: " + text.length + "\nبلا مسافات: " + text.replace(/\s/g, "").length + "\nالأسطر: " + text.split("\n").length);
      } else if (kind === "md") show(text.replace(/^(.*)$/gm, (l) => (l.trim() ? "- " + l : "")));
      else if (kind === "copy") {
        if (CB.copyText && out) CB.copyText(out.textContent || "");
      }
    } catch (e) {
      show("⚠️ " + (e.message || "مدخل غير صالح"));
    }
  }

  /* ----------------------------- الطيران --------------------------------- */
  function startFlightsPoll() {
    stopFlightsPoll();
    st.flightsTimer = setInterval(() => {
      if (st.tab === "flights" && document.visibilityState !== "hidden") loadFlights(true);
    }, 20000);
  }
  function stopFlightsPoll() {
    if (st.flightsTimer) { clearInterval(st.flightsTimer); st.flightsTimer = null; }
  }

  async function loadFlights(silent) {
    const rows = $("#flRows");
    if (rows && !silent && !st.flights) rows.innerHTML = '<tr><td colspan="6" class="hub-empty"><span class="spin-dot"></span> جارٍ قراءة الأجواء فوق الجزائر…</td></tr>';
    try {
      const r = await fetch("/api/flights", { headers: { accept: "application/json" } });
      const j = await r.json();
      st.flights = j;
      renderFlights();
    } catch (e) {
      if (rows) rows.innerHTML = '<tr><td colspan="6" class="hub-empty">⚠️ تعذّر جلب بيانات الطيران الآن — أعد المحاولة بعد لحظات.</td></tr>';
    }
  }

  function fltStatusLabel(s) {
    return s === "in" ? "داخلة" : s === "out" ? "خارجة" : s === "over" ? "عبور" : "غير معروف";
  }

  function renderFlights() {
    const j = st.flights;
    if (!j) return;
    const src = $("#flSource");
    if (src) src.textContent = (j.source || "") + " · " + new Date(j.updated || Date.now()).toLocaleTimeString("ar-DZ");
    const c = j.counts || {};
    const stats = $("#flStats");
    if (stats) {
      stats.innerHTML =
        '<div class="fl-stat"><b>' + (c.total || 0) + '</b><span>طائرة داخل الأجواء</span></div>' +
        '<div class="fl-stat in"><b>' + (c.in || 0) + '</b><span>متجهة نحو الداخل</span></div>' +
        '<div class="fl-stat out"><b>' + (c.out || 0) + '</b><span>خارجة من الأجواء</span></div>' +
        '<div class="fl-stat over"><b>' + (c.over || 0) + '</b><span>عبور</span></div>';
    }
    drawMap(j);
    const list = filterFlights(j.aircraft || []);
    const body = $("#flRows");
    if (!body) return;
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="6" class="hub-empty">' + (j.aircraft && j.aircraft.length ? "لا طائرة تطابق البحث" : "لا بيانات الآن — قد يكون المصدر المفتوح محدوداً مؤقتاً.") + '</td></tr>';
      return;
    }
    body.innerHTML = list.slice(0, 80).map((a, i) =>
      '<tr data-ix="' + i + '"><td class="mono"><b>' + esc(a.callsign || a.hex) + '</b>' + (a.reg ? '<br><span style="color:var(--hub-mut);font-size:10px">' + esc(a.reg) + '</span>' : '') + '</td>' +
      '<td>' + esc(a.model || "—") + '</td>' +
      '<td><span class="pill ' + a.status + '">' + fltStatusLabel(a.status) + '</span></td>' +
      '<td class="mono">' + (a.alt == null ? "—" : (a.alt >= 1000 ? (a.alt / 1000).toFixed(1) + "k" : a.alt) ) + ' ft</td>' +
      '<td class="mono">' + (a.speed == null ? "—" : a.speed) + ' كم/س</td>' +
      '<td class="mono">' + (a.toCapital == null ? "—" : a.toCapital) + ' كم</td></tr>'
    ).join("");
    $$("tr[data-ix]", body).forEach((tr) => tr.addEventListener("click", () => {
      const a = list[Number(tr.dataset.ix)];
      if (a) askFlight(a);
    }));
  }

  function filterFlights(list) {
    const q = (st.flightQuery || "").toLowerCase();
    return list.filter((a) => {
      if (st.flightFilter !== "all" && a.status !== st.flightFilter) return false;
      if (!q) return true;
      return String(a.callsign || "").toLowerCase().includes(q) || String(a.model || "").toLowerCase().includes(q) || String(a.hex || "").toLowerCase().includes(q);
    });
  }

  // خريطة جغرافية حقيقية: Leaflet + بلاطات OpenStreetMap + علامات ADS-B حيّة.
  let flightMap = null;
  let flightLayer = null;
  const flightMarkers = new Map();

  function initFlightMap(host) {
    if (!host || !window.L) {
      if (host) host.innerHTML = '<div class="map-fallback">تعذّر تحميل مكتبة الخريطة. تحقق من اتصال الإنترنت ثم أعد المحاولة.</div>';
      return false;
    }
    if (!flightMap) {
      flightMap = L.map(host, { zoomControl: true, preferCanvas: true, worldCopyJump: true }).setView([28.2, 2.6], 4);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        minZoom: 3,
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
        crossOrigin: true
      }).addTo(flightMap);
      flightMap.fitBounds([[18.9, -8.75], [37.2, 12.05]], { padding: [12, 12] });
      flightLayer = L.layerGroup().addTo(flightMap);
      L.marker([36.7538, 3.0588], {
        icon: L.divIcon({ className: "airport-pin", html: '<span>✈</span>', iconSize: [26, 26], iconAnchor: [13, 13] })
      }).bindPopup("الجزائر العاصمة").addTo(flightMap);
    }
    setTimeout(() => flightMap && flightMap.invalidateSize(), 120);
    return true;
  }

  function planeIcon(a) {
    const color = a.status === "in" ? "#55e6a5" : a.status === "out" ? "#ff8585" : "#78dff5";
    const angle = Number.isFinite(Number(a.track)) ? Number(a.track) : 0;
    return L.divIcon({
      className: "aircraft-div-icon",
      html: '<span class="aircraft-glyph" style="--plane-color:' + color + ';--plane-angle:' + angle + 'deg">✈</span>',
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
  }

  function flightPopup(a) {
    const alt = a.alt == null ? "غير متاح" : Number(a.alt).toLocaleString("ar-DZ") + " قدم";
    const speed = a.speed == null ? "غير متاحة" : Number(a.speed).toLocaleString("ar-DZ") + " كم/س";
    return '<div class="flight-popup" dir="rtl"><b>' + esc(a.callsign || a.hex || "طائرة") + '</b>' +
      '<div>النوع: ' + esc(a.model || "غير معروف") + '</div>' +
      '<div>التسجيل: ' + esc(a.reg || "غير متاح") + '</div>' +
      '<div>الارتفاع: ' + alt + '</div><div>السرعة: ' + speed + '</div>' +
      '<div>الاتجاه: ' + (a.track == null ? "غير متاح" : Number(a.track) + "°") + '</div>' +
      '<div>المصدر: ADS-B · ' + esc(fltStatusLabel(a.status)) + '</div></div>';
  }

  function drawMap(j) {
    const host = $("#flMap");
    if (!initFlightMap(host)) return;
    const live = new Map((j.aircraft || []).filter(a => Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lon))).map(a => [String(a.hex || a.callsign), a]));
    for (const [id, marker] of flightMarkers) {
      if (!live.has(id)) {
        flightLayer.removeLayer(marker);
        flightMarkers.delete(id);
      }
    }
    for (const [id, a] of live) {
      let marker = flightMarkers.get(id);
      const latlng = [Number(a.lat), Number(a.lon)];
      if (!marker) {
        marker = L.marker(latlng, { icon: planeIcon(a), keyboard: true, title: a.callsign || a.hex || "Aircraft" });
        marker.bindPopup(flightPopup(a));
        marker.addTo(flightLayer);
        flightMarkers.set(id, marker);
      } else {
        marker.setLatLng(latlng);
        marker.setIcon(planeIcon(a));
        marker.setPopupContent(flightPopup(a));
      }
    }
    const stamp = $("#flMapStamp");
    if (stamp) stamp.textContent = "آخر تحديث: " + new Date(j.updated || Date.now()).toLocaleTimeString("ar-DZ") + " · " + live.size + " طائرة";
  }

  function askFlight(a) {
    close();
    setTimeout(() => {
      const inp = $("#input");
      const p = "رحلة " + (a.callsign || a.hex) + " (" + (a.model || "نوع غير معروف") + ") فوق الجزائر: " +
        "الارتفاع " + (a.alt == null ? "غير معروف" : a.alt + " قدم") + "، السرعة " + (a.speed == null ? "غير معروفة" : a.speed + " كم/س") +
        "، الاتجاه " + (a.track == null ? "غير معروف" : a.track + "°") +
        "، الحالة: " + fltStatusLabel(a.status) + ". اشرح ما تعنيه هذه المعطيات، وما المحتمل أن تكون وجهتها، وما لا يمكن الجزم به من ADS-B وحده.";
      if (inp) { inp.value = p; inp.dispatchEvent(new Event("input")); inp.focus(); }
    }, 200);
  }

  /* ---------------------------- المستودعات -------------------------------- */
  async function loadRepos(q) {
    const grid = $("#repoGrid");
    if (grid) grid.innerHTML = '<div class="hub-empty"><span class="spin-dot"></span> جارٍ التحميل…</div>';
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    else params.set("cat", st.repoCat);
    try {
      const r = await fetch("/api/repos?" + params.toString(), { headers: { accept: "application/json" } });
      const j = await r.json();
      st.repos = j;
      renderRepos();
    } catch (e) {
      if (grid) grid.innerHTML = '<div class="hub-empty">⚠️ تعذّر جلب المستودعات الآن.</div>';
    }
  }

  function fmtStars(n) {
    if (n == null) return "";
    return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k ★" : n + " ★";
  }

  function renderRepos() {
    const grid = $("#repoGrid");
    if (!grid) return;
    const j = st.repos;
    const list = (j && j.repos) || [];
    if (!list.length) {
      grid.innerHTML = '<div class="hub-empty">لا نتائج — جرّب كلمة أخرى.</div>';
      return;
    }
    grid.innerHTML = list.map((r) => {
      const tags = [r.lang].concat(r.topics || []).filter(Boolean).slice(0, 4);
      return '<div class="hub-card repo-card" data-url="' + esc(r.url) + '">' +
        '<div class="top"><span class="ic" style="margin:0;font-size:15px">📦</span><b>' + esc(r.name) + '</b><span class="stars">' + fmtStars(r.stars) + '</span></div>' +
        '<p>' + esc(r.why || r.desc || "مستودع مفتوح المصدر") + '</p>' +
        '<div class="tags">' + tags.map((t) => '<span>' + esc(t) + '</span>').join("") + '</div></div>';
    }).join("");
    $$(".repo-card", grid).forEach((c) => c.addEventListener("click", () => window.open(c.dataset.url, "_blank", "noopener")));
  }

  /* ------------------------------ dojos ---------------------------------- */
  async function loadDojos() {
    const grid = $("#dojoGrid");
    if (grid) grid.innerHTML = '<div class="hub-empty"><span class="spin-dot"></span> جارٍ قراءة فهرس pwn.college…</div>';
    try {
      const r = await fetch("/api/dojos", { headers: { accept: "application/json" } });
      const j = await r.json();
      st.dojos = j.dojos || [];
      renderDojos();
    } catch (e) {
      if (grid) grid.innerHTML = '<div class="hub-empty">⚠️ تعذّر قراءة الفهرس — جرّب بعد قليل.</div>';
    }
  }

  function trackLabel(t) {
    return t === "start" ? "البداية" : t === "core" ? "المنهج الأساسي" : t === "community" ? "مجتمع" : t === "courses" ? "مقرّرات" : "dojo";
  }

  function renderDojos() {
    const grid = $("#dojoGrid");
    if (!grid) return;
    const list = (st.dojos || []).filter((d) => st.dojoTrack === "all" || d.track === st.dojoTrack);
    if (!list.length) {
      grid.innerHTML = '<div class="hub-empty">لا dojos في هذا التصنيف.</div>';
      return;
    }
    grid.innerHTML = list.slice(0, 60).map((d) =>
      '<button class="hub-card dj-card" data-slug="' + esc(d.slug) + '">' +
      '<span class="tr">' + esc(trackLabel(d.track)) + '</span>' +
      '<b style="margin-top:6px">' + esc(d.name) + '</b><span>' + esc(d.desc || "dojo تعليمي على pwn.college") + '</span></button>'
    ).join("");
    $$("[data-slug]", grid).forEach((b) => b.addEventListener("click", () => openDojo(b.dataset.slug)));
  }

  async function openDojo(slug) {
    const side = $("#dojoSide");
    if (!side) return;
    side.innerHTML = '<h3><span class="spin-dot"></span> أقرأ المراحل…</h3>';
    let d = null;
    try {
      const r = await fetch("/api/dojos?slug=" + encodeURIComponent(slug), { headers: { accept: "application/json" } });
      const j = await r.json();
      d = j.dojo;
    } catch (_) {}
    if (!d) {
      side.innerHTML = '<h3>تعذّر التحميل</h3><p style="color:var(--hub-mut);font-size:11.5px">أعد المحاولة بعد لحظات.</p>';
      return;
    }
    st.dojoDetail = d;
    const done = dojoDone(slug);
    side.innerHTML = '<h3>' + esc(d.name) + '</h3>' +
      '<p style="color:var(--hub-mut);font-size:11.5px;line-height:1.8;margin:0 0 8px">' + d.modules.length + ' مرحلة · علّم ما أنجزته ليحفظه الوكيل على جهازك.</p>' +
      '<div class="dj-mods">' + d.modules.map((m, i) =>
        '<label class="dj-mod' + (done.includes(m) ? " done" : "") + '"><input type="checkbox" data-mod="' + esc(m) + '"' + (done.includes(m) ? " checked" : "") + ' /><span>' + (i + 1) + ". " + esc(m) + '</span></label>'
      ).join("") + '</div>' +
      '<div class="hub-row">' +
      '<button class="hub-mini pri" id="djPlan">🎓 ابنِ لي خطة تعلّم</button>' +
      '<button class="hub-mini" id="djAsk">💬 اسأل الوكيل عن هذه المرحلة</button>' +
      '<a class="hub-mini" href="' + esc(d.url) + '" target="_blank" rel="noopener" style="text-decoration:none;display:inline-block">↗ pwn.college</a>' +
      '</div>';
    $$("[data-mod]", side).forEach((cb) => cb.addEventListener("change", () => {
      const cur = dojoDone(slug);
      const name = cb.dataset.mod;
      const next = cb.checked ? Array.from(new Set(cur.concat([name]))) : cur.filter((x) => x !== name);
      setDojoDone(slug, next);
      cb.closest(".dj-mod").classList.toggle("done", cb.checked);
      toast("تم حفظ التقدّم: " + next.length + "/" + d.modules.length);
    }));
    const plan = $("#djPlan");
    if (plan) plan.addEventListener("click", () => dojoPlan(d));
    const askBtn = $("#djAsk");
    if (askBtn) askBtn.addEventListener("click", () => dojoQuestion(d));
  }

  function dojoSystem(d) {
    return "أنت «الوكيل المتعلّم» في CHIBANI، مدرّب أمن سيبراني مبنيّ على منهج pwn.college (dojo: " + d.name + ").\n" +
      "مراحل هذا الـ dojo بالترتيب: " + d.modules.join(" / ") + ".\n" +
      "قواعدك: اشرح بالعربية الفصحى، ابدأ بلماذا هذه المرحلة ثم خطوات عملية قابلة للتنفيذ داخل بيئة pwn.college، " +
      "اذكر أن التدريب مسموح فقط داخل بيئاتك المصرّح بها (dojo/CTF)، ولا تقدّم تعليمات لاختراق أنظمة لا تملك إذناً بها. " +
      "اختم بسؤال تحقّق قصير ومصدر واحد من المنهج.";
  }

  function dojoPlan(d) {
    close();
    setTimeout(() => {
      if (!CB.chat || !CB.chat.runChat) { toast("المحادثة غير جاهزة بعد"); return; }
      CB.chat.setMode("chat");
      CB.chat.runChat(
        "ابنِ لي خطة تعلّم كاملة لـ dojo «" + d.name + "» (" + d.modules.length + " مرحلة) على مدى 14 يوماً: " +
        "جدول يومي، ما أتوقعه في كل مرحلة، تمرين عملي لكل يوم، وكيف أعرف أنني أتقنتها قبل الانتقال.",
        { selfContained: true, system: dojoSystem(d), temperature: 0.55 }
      );
    }, 200);
  }

  function dojoQuestion(d) {
    close();
    setTimeout(() => {
      if (!CB.chat || !CB.chat.runChat) { toast("المحادثة غير جاهزة بعد"); return; }
      CB.chat.setMode("chat");
      CB.chat.runChat(
        "اشرح لي أول ثلاث مراحل من «" + d.name + "» (" + d.modules.slice(0, 3).join(" ثم ") + ") بأمثلة عملية، وما المهارة التي أخرج بها من كل مرحلة.",
        { selfContained: true, system: dojoSystem(d), temperature: 0.6 }
      );
    }, 200);
  }

  /* ------------------------------ التركيب -------------------------------- */
  function build() {
    if ($("#hubOverlay")) return;
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.id = "hubOverlay";
    ov.innerHTML = buildHTML();
    document.body.appendChild(ov);

    const closeBtn = $("#hubClose", ov);
    if (closeBtn) closeBtn.addEventListener("click", close);
    ov.addEventListener("mousedown", (e) => { if (e.target === ov) close(); });

    $$(".hub-tab", ov).forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

    renderTools();
    $$("[data-local]", ov).forEach((b) => b.addEventListener("click", () => localTool(b.dataset.local)));

    const flRefresh = $("#flRefresh", ov);
    if (flRefresh) flRefresh.addEventListener("click", () => loadFlights());
    $$("[data-fl-filter]", ov).forEach((b) => b.addEventListener("click", () => {
      st.flightFilter = b.dataset.flFilter;
      $$("[data-fl-filter]", ov).forEach((x) => x.classList.toggle("on", x === b));
      renderFlights();
    }));
    const flSearch = $("#flSearch", ov);
    if (flSearch) flSearch.addEventListener("input", () => { st.flightQuery = flSearch.value.trim(); renderFlights(); });

    $$("[data-cat]", ov).forEach((b) => b.addEventListener("click", () => {
      st.repoCat = b.dataset.cat;
      $$("[data-cat]", ov).forEach((x) => x.classList.toggle("on", x === b));
      const s = $("#repoSearch");
      if (s) s.value = "";
      loadRepos("");
    }));
    const repoGo = $("#repoGo", ov);
    const repoSearch = $("#repoSearch", ov);
    const doSearch = () => { const q = (repoSearch.value || "").trim(); if (q) loadRepos(q); else loadRepos(""); };
    if (repoGo) repoGo.addEventListener("click", doSearch);
    if (repoSearch) repoSearch.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });

    $$("[data-track]", ov).forEach((b) => b.addEventListener("click", () => {
      st.dojoTrack = b.dataset.track;
      $$("[data-track]", ov).forEach((x) => x.classList.toggle("on", x === b));
      renderDojos();
    }));

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && $("#hubOverlay") && $("#hubOverlay").classList.contains("open")) close();
    });
  }

  function bindButtons() {
    const b1 = $("#btnHub"), b2 = $("#btnHub2");
    if (b1) b1.addEventListener("click", () => open("tools"));
    if (b2) b2.addEventListener("click", () => { open("tools"); });
  }

  function init() {
    build();
    bindButtons();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  CB.hub = { open, close, setTab };
})();
