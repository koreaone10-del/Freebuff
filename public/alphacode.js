(() => {
  const $ = (id) => document.getElementById(id);
  const tokenKey = 'freebuff_alphacode_session';
  let token = sessionStorage.getItem(tokenKey) || '';
  let currentJob = null;
  let poller = null;
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
  async function status() {
    try {
      const res = await fetch('/api/alphacode/status'); const s = await res.json();
      $('engineStat').textContent = s.installed ? 'ONLINE' : 'NOT INSTALLED'; $('runtimeLabel').textContent = s.installed ? 'AlphaCode ' + (s.version || 'ready') : 'Binary missing'; $('sideStatus').textContent = s.installed ? 'المحرك جاهز' : 'المحرك غير مثبت'; $('sideDot').style.background = s.installed ? '#5ce0ac' : '#ff7588';
      if (!s.enabled) { $('sideStatus').textContent = 'كلمة المرور غير مهيأة'; $('sideDot').style.background = '#ff7588'; }
      if (s.installed) $('versionPill').textContent = `MIT · Rust · ${s.version || 'v1.1.3'}`;
      if (!s.enabled) { $('authError').textContent = 'يجب إعداد ALPHACODE_STUDIO_PASSWORD في Render.'; showAuth(); }
      else if (!token) showAuth();
    } catch { $('engineStat').textContent = 'OFFLINE'; $('sideStatus').textContent = 'تعذر الاتصال بالمحرك'; }
  }
  $('authForm').addEventListener('submit', async e => { e.preventDefault(); $('authError').textContent = ''; try { const data = await api('/auth', { method: 'POST', body: JSON.stringify({ password: $('authPassword').value }) }); token = data.token; sessionStorage.setItem(tokenKey, token); $('authPassword').value = ''; hideAuth(); toast('تم تسجيل الدخول إلى مساحة AlphaCode'); loadJobs(); } catch (err) { $('authError').textContent = err.message; } });
  $('taskInput').addEventListener('input', () => $('taskCount').textContent = `${$('taskInput').value.length} / 8000`);
  $('runBtn').addEventListener('click', async () => {
    const task = $('taskInput').value.trim(); if (task.length < 5) return toast('اكتب وصفاً أوضح للمهمة.', true);
    $('runBtn').disabled = true; $('runBtn').textContent = 'جارٍ الإرسال…';
    try { const data = await api('/jobs', { method: 'POST', body: JSON.stringify({ task, repository: $('repoInput').value.trim() }) }); currentJob = data.job.id; $('activeRun').hidden = false; $('jobTitle').textContent = task.slice(0, 100); $('jobLog').textContent = 'تم إنشاء المهمة…'; view('agent'); pollJob(); if (poller) clearInterval(poller); poller = setInterval(pollJob, 2500); toast('بدأت المهمة. لا تغلق الصفحة إذا كنت تريد متابعة السجل مباشرة.'); }
    catch (err) { toast(err.message, true); }
    finally { $('runBtn').disabled = false; $('runBtn').innerHTML = 'تشغيل الوكيل <b>↗</b>'; }
  });
  async function pollJob() {
    if (!currentJob) return;
    try { const { job } = await api(`/jobs/${currentJob}`); $('jobState').textContent = `${job.status.toUpperCase()} · ${job.stage}`; $('jobLog').textContent = job.log || 'بانتظار خرج المحرك…'; $('jobLog').scrollTop = $('jobLog').scrollHeight; if (['completed','failed','cancelled','timeout'].includes(job.status)) { clearInterval(poller); poller = null; loadJobs(); toast(`انتهت المهمة: ${job.status}`); } }
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
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  status();
})();
