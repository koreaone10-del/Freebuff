(() => {
  const $ = (id) => document.getElementById(id);
  const tokenKey = 'freebuff_alphacode_session';
  let token = sessionStorage.getItem(tokenKey) || '';
  let currentJob = null;
  let poller = null;
  let selectedMode = 'chat';
  let selectedFiles = [];
  const conversation = $('conversation');
  const labels = { overview: 'مساحة الوكيل الذكي', agent: 'تنفيذ مهمة جديدة', sessions: 'المهام والجلسات', skills: 'مكتبة المهارات', mcp: 'الاتصالات الخارجية MCP', swarm: 'تنسيق الوكلاء المتعددين' };
  const authHeaders = () => ({ 'content-type': 'application/json', 'x-alphacode-session': token });
  async function api(path, options = {}) {
    const res = await fetch('/api/alphacode' + path, { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/auth') showAuth();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }
  function showAuth() { $('authModal').classList.add('show'); $('authPassword').focus(); }
  function hideAuth() { $('authModal').classList.remove('show'); }
  function toast(message, bad = false) { let el = document.createElement('div'); el.textContent = message; el.style.cssText = `position:fixed;bottom:22px;left:22px;z-index:20;background:${bad?'#522433':'#172c35'};border:1px solid ${bad?'#ff758866':'#6ee7f566'};color:#eef;padding:12px 16px;border-radius:10px;font:12px inherit;max-width:85vw`; document.body.append(el); setTimeout(() => el.remove(), 4200); }
  function view(name) { document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`)); document.querySelectorAll('.nav').forEach(b => b.classList.toggle('active', b.dataset.view === name)); $('pageTitle').textContent = labels[name] || labels.overview; if (name === 'sessions') loadJobs(); if (name === 'skills') loadSkills(); if (name === 'mcp') loadMcp(); }
  document.querySelectorAll('.nav').forEach(b => b.addEventListener('click', () => view(b.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => view(b.dataset.go)));
  $('homeBtn').addEventListener('click', () => location.href = '/');
  $('mobileMenu')?.addEventListener('click', () => document.querySelector('.rail')?.classList.toggle('mobile-open'));
  document.querySelectorAll('.nav').forEach(b => b.addEventListener('click', () => document.querySelector('.rail')?.classList.remove('mobile-open')));
  document.querySelectorAll('.mode').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('.mode').forEach(x => x.classList.toggle('active', x === b)); selectedMode = b.dataset.mode; }));
  document.querySelectorAll('[data-prompt]').forEach(b => b.addEventListener('click', () => { $('taskInput').value = b.dataset.prompt; $('taskCount').textContent = `${$('taskInput').value.length} / 8000`; $('taskInput').focus(); }));
  $('attachBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', () => { selectedFiles = [...$('fileInput').files].slice(0,5); $('attachmentNames').textContent = selectedFiles.length ? selectedFiles.map(f => f.name).join(' · ') : 'حتى 5 ملفات · 3MB لكل ملف'; });
  async function status() {
    try {
      const res = await fetch('/api/alphacode/status'); const s = await res.json();
      $('engineStat').textContent = s.installed ? 'ONLINE' : 'NOT INSTALLED'; $('runtimeLabel').textContent = s.installed ? 'AlphaCode ' + (s.version || 'ready') : 'Binary missing'; $('sideStatus').textContent = s.installed ? 'المحرك جاهز' : 'المحرك غير مثبت'; $('sideDot').style.background = s.installed ? '#5ce0ac' : '#ff7588';
      if (!s.enabled) { $('sideStatus').textContent = 'كلمة المرور غير مهيأة'; $('sideDot').style.background = '#ff7588'; }
      if (s.installed) $('versionPill').textContent = `MIT · Rust · ${s.version || 'v1.1.0'}`;
      if (!s.enabled) { $('authError').textContent = 'يجب إعداد ALPHACODE_STUDIO_PASSWORD في Render.'; showAuth(); }
      else if (!token) showAuth();
    } catch { $('engineStat').textContent = 'OFFLINE'; $('sideStatus').textContent = 'تعذر الاتصال بالمحرك'; }
  }
  $('authForm').addEventListener('submit', async e => { e.preventDefault(); $('authError').textContent = ''; try { const data = await api('/auth', { method: 'POST', body: JSON.stringify({ password: $('authPassword').value }) }); token = data.token; sessionStorage.setItem(tokenKey, token); $('authPassword').value = ''; hideAuth(); toast('تم تسجيل الدخول إلى مساحة AlphaCode'); loadJobs(); } catch (err) { $('authError').textContent = err.message; } });
  $('taskInput').addEventListener('input', () => $('taskCount').textContent = `${$('taskInput').value.length} / 8000`);
  $('runBtn').addEventListener('click', async () => {
    const task = $('taskInput').value.trim(); if (task.length < 5) return toast('اكتب وصفاً أوضح للمهمة.', true);
    $('runBtn').disabled = true; $('runBtn').textContent = 'جارٍ الإرسال…';
    try {
      const files = [];
      for (const file of selectedFiles) {
        if (file.size > 3 * 1024 * 1024) throw new Error(`الملف ${file.name} أكبر من 3MB.`);
        files.push({ name: file.name, data: await fileToBase64(file) });
      }
      const modeInstruction = { chat: 'أجب عن سؤال المستخدم بدقة، واستعمل أدوات AlphaCode المناسبة عند الحاجة.', code: 'تعامل مع الطلب كمهمة برمجية: افحص البنية، خطط، نفّذ التغييرات المطلوبة، شغّل الاختبارات المناسبة، ثم لخّص الملفات والتغييرات.', analysis: 'نفّذ تحليلاً منظماً: افحص المدخلات، استخرج النتائج والأسباب، اذكر القيود والافتراضات، وقدّم توصيات قابلة للتحقق.', research: 'نفّذ بحثاً باستخدام أدوات الويب المتاحة في AlphaCode. فضّل المصادر الأولية والحديثة، قارنها، وأرفق روابط المصادر وتاريخها.' };
      const fullTask = `${modeInstruction[selectedMode]}\n\nطلب المستخدم:\n${task}`;
      addMessage('user', task + (files.length ? `\n📎 ${files.map(f=>f.name).join('، ')}` : ''));
      const data = await api('/jobs', { method: 'POST', body: JSON.stringify({ task: fullTask, repository: $('repoInput').value.trim(), attachments: files }) });
      currentJob = data.job.id; $('activeRun').hidden = false; $('jobTitle').textContent = task.slice(0, 100); $('jobLog').textContent = 'تم إنشاء المهمة…'; addMessage('agent', 'بدأت المهمة. سأعرض سجل التنفيذ والنتيجة هنا.');
      selectedFiles = []; $('fileInput').value = ''; $('attachmentNames').textContent = 'حتى 5 ملفات · 3MB لكل ملف'; $('taskInput').value = ''; $('taskCount').textContent = '0 / 8000';
      view('agent'); pollJob(); if (poller) clearInterval(poller); poller = setInterval(pollJob, 2500); toast('بدأت المهمة.');
    }
    catch (err) { toast(err.message, true); }
    finally { $('runBtn').disabled = false; $('runBtn').innerHTML = 'تشغيل الوكيل <b>↗</b>'; }
  });
  async function pollJob() {
    if (!currentJob) return;
    try { const { job } = await api(`/jobs/${currentJob}`); $('jobState').textContent = `${job.status.toUpperCase()} · ${job.stage}`; $('jobLog').textContent = job.log || 'بانتظار خرج المحرك…'; $('jobLog').scrollTop = $('jobLog').scrollHeight; if (['completed','failed','cancelled','timeout'].includes(job.status)) { addMessage('agent', `انتهت المهمة: ${job.status}.\n\n${(job.log || '').slice(-5000)}`);  clearInterval(poller); poller = null; loadJobs(); toast(`انتهت المهمة: ${job.status}`); } }
    catch (err) { if (poller) clearInterval(poller); poller = null; toast(err.message, true); }
  }
  $('cancelBtn').addEventListener('click', async () => { if (!currentJob) return; try { await api(`/jobs/${currentJob}/cancel`, { method: 'POST', body: '{}' }); toast('تم إرسال طلب إيقاف المهمة.'); } catch (err) { toast(err.message, true); } });
  async function loadJobs() {
    try { const { jobs } = await api('/jobs'); const host = $('jobsList'); if (!jobs.length) { host.className = 'empty'; host.textContent = 'لا توجد مهام بعد. ابدأ مهمة من الوكيل الذكي.'; return; } host.className = ''; host.innerHTML = jobs.map(j => `<div class="job-row"><span>${esc(j.task.slice(0,100))}</span><span>${esc(j.status)}</span><span>${new Date(j.updatedAt).toLocaleString('ar-DZ')}</span></div>`).join(''); }
    catch (e) { $('jobsList').textContent = e.message; }
  }
  async function loadSkills() {
    try { const { skills } = await api('/skills'); const host = $('skillsList'); host.className = ''; host.innerHTML = skills.length ? skills.map(s => `<div class="skill-item"><b>${esc(s.name)}</b><small>${esc(s.description)} · ${esc(s.file)}</small></div>`).join('') : '<div class="empty">لا توجد مهارات مضافة بعد.</div>'; }
    catch (e) { $('skillsList').textContent = e.message; }
  }
  $('saveSkill').addEventListener('click', async () => { try { await api('/skills', { method: 'POST', body: JSON.stringify({ name: $('skillName').value, description: $('skillDesc').value, instructions: $('skillBody').value }) }); toast('تم حفظ المهارة. ستظهر للمحرك في المهام التالية.'); $('skillName').value = $('skillDesc').value = $('skillBody').value = ''; loadSkills(); } catch (e) { toast(e.message, true); } });
  $('refreshSkills').addEventListener('click', loadSkills);
  async function loadMcp() { try { const d = await api('/mcp'); $('mcpState').textContent = d.configured ? `${d.configured} خادم MCP: ${d.servers.join('، ')}` : (d.note || 'لا توجد خوادم MCP مثبتة في بيئة التشغيل.'); } catch (e) { $('mcpState').textContent = e.message; } }
  $('refreshMcp').addEventListener('click', loadMcp); $('refreshJobs').addEventListener('click', loadJobs);
  function addMessage(role, text) { if (!conversation) return; const empty = conversation.querySelector('.welcome-message'); if (empty) empty.remove(); const node = document.createElement('div'); node.className = `message ${role}`; const label = document.createElement('b'); label.textContent = role === 'user' ? 'أنت' : 'AlphaCode'; const body = document.createElement('pre'); body.textContent = text; node.append(label, body); conversation.append(node); conversation.scrollTop = conversation.scrollHeight; }
  function fileToBase64(file) { return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = reject; r.readAsDataURL(file); }); }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  status();
})();
