const SUPABASE_URL = 'https://xrktmedrvqaygpmchvd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_secret_VsProf2nYv1le2gBUsuyyQ_PTtGh2Sc';
window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const authService = (() => {
  const toSyntheticEmail = (fullName) => {
    const slug = String(fullName).trim().toLowerCase()
      .replace(/\s+/g, '.').replace(/[^a-z0-9.]/g, '')
      .replace(/\.+/g, '.').replace(/^\.|\.$/g, '');
    if (!slug) throw new Error('Nama lengkap tidak valid.');
    return `${slug}@livora.invalid`;
  };

  return {
    current: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      return session?.user?.id || null;
    },
    async register({ fullName, nickname, password }) {
      const email = toSyntheticEmail(fullName);
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name: fullName.trim(), nickname: nickname.trim() } }
      });
      if (error) {
        if (/already registered|already exists|duplicate/i.test(error.message))
          throw new Error('Nama lengkap ini sudah terdaftar.');
        throw new Error(error.message);
      }
      return data.user.id;
    },
    async login(fullName, password) {
      const email = toSyntheticEmail(fullName);
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error('Nama lengkap atau password tidak cocok.');
      return data.user.id;
    },
    async resetPassword(fullName, newPassword) {
      const { error } = await supabase.rpc('reset_password', {
        full_name_input: fullName,
        new_password_input: newPassword
      });
      if (error) throw new Error(error.message);
    },
    async logout() {
      await supabase.auth.signOut();
      location.href = '#/masuk';
      location.reload(); // reload untuk membersihkan state
    }
  };
})();

/* ============================================================
   2. DATABASE SERVICE
   ============================================================ */
const db = (() => {
  const uid = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Sesi habis. Silakan login ulang.');
    return session.user.id;
  };
  return {
    async list(table) {
      const u = await uid();
      const { data, error } = await supabase.from(table).select('*').eq('user_id', u);
      if (error) throw error; return data;
    },
    async insert(table, row) {
      const u = await uid();
      const { data, error } = await supabase.from(table).insert({ ...row, user_id: u }).select().single();
      if (error) throw error; return data;
    },
    async update(table, id, updates) {
      const { data, error } = await supabase.from(table).update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id).select().single();
      if (error) throw error; return data;
    },
    async remove(table, id) {
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw error;
    },
    async getProfile() {
      const u = await uid();
      const { data, error } = await supabase.from('profiles').select('*').eq('id', u).single();
      if (error) throw error; return data;
    },
    async updateProfile(updates) {
      const u = await uid();
      const { error } = await supabase.from('profiles').update(updates).eq('id', u);
      if (error) throw error;
    }
  };
})();

/* ============================================================
   3. STATE GLOBAL & UTILS
   ============================================================ */
let CURRENT_PROFILE = { nickname: '', fullName: '', photo: null };
let CURRENT_SETTINGS = { theme: 'dark', dateFormat: 'long', notify: false, sideClosed: false };

const $ = (s, r = document) => r.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const today = () => dayKey(new Date());
const rupiah = n => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n));

function el(tag, cls, text, kids = [], attrs = {}) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  kids.forEach(k => e.append(k));
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  return e;
}
const icon = name => { const i = document.createElement('i'); i.dataset.lucide = name; return i; };
const chip = (text, cls = '') => el('span', 'chip ' + cls, text);
const empty = text => el('div', 'empty', text);

function toast(msg) {
  let t = $('#toast');
  if (!t) { t = el('div', 'toast', null, [], { id: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.id);
  toast.id = setTimeout(() => t.classList.remove('show'), 2800);
}

function resizeImage(file, max = 256) {
  return new Promise((ok, fail) => {
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return fail(new Error('Gunakan gambar PNG, JPG, atau WebP.'));
    if (file.size > 5 * 1024 * 1024) return fail(new Error('Ukuran gambar maksimal 5 MB.'));
    const img = new Image();
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * r);
      c.height = Math.round(img.height * r);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      ok(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => fail(new Error('Gambar tidak dapat dibaca.'));
    img.src = URL.createObjectURL(file);
  });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function fmtDate(s) {
  if (!s) return '';
  const k = String(s).length > 10 ? dayKey(new Date(s)) : String(s), [y, m, d] = k.split('-');
  const f = CURRENT_SETTINGS.dateFormat || 'long';
  return f === 'iso' ? `${y}-${m}-${d}` : f === 'dmy' ? `${d}/${m}/${y}` : `${+d} ${MONTHS[+m - 1]} ${y}`;
}

const COLORS = ['#4f7cff', '#a06bff', '#2dd4bf', '#8791a7'];
const colorOf = s => COLORS[[...String(s || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 4];
const applyTheme = t => {
  document.documentElement.dataset.theme = t;
  const m = document.querySelector('meta[name=theme-color]');
  if (m) m.content = t === 'dark' ? '#0a0e18' : '#f3f5fa';
};

const pages = {};
let cleanup = null;

/* ============================================================
   4. SHELL & ROUTER
   ============================================================ */
function shell(page, title, sub, actions = []) {
  applyTheme(CURRENT_SETTINGS.theme || 'dark');
  document.querySelectorAll('[data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === page));
  $('#moreBtn').classList.toggle('active', !['beranda', 'tugas', 'jadwal', 'kebiasaan'].includes(page));
  document.body.classList.toggle('side-closed', !!CURRENT_SETTINGS.sideClosed);
  $('#pageTitle').textContent = title;
  $('#pageSub').textContent = sub;
  $('#topExtra').replaceChildren(...actions);
  $('#today').textContent = new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
  const av = $('#avatar');
  av.replaceChildren();
  if (CURRENT_PROFILE.photo) av.append(el('img', '', null, [], { src: CURRENT_PROFILE.photo, alt: '' }));
  else av.textContent = (CURRENT_PROFILE.nickname || '?')[0].toUpperCase();
  document.title = `${title} — Livora`;
  const content = $('#content');
  content.replaceChildren();
  lucide.createIcons();
  return content;
}

async function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  document.querySelectorAll('.modal').forEach(m => m.remove());
  
  const logged = !!(await authService.current());
  let name = location.hash.replace(/^#\/?/, '') || 'beranda';
  $('#auth').hidden = logged;
  $('#appShell').hidden = !logged;
  $('#sheet').hidden = true;
  
  if (!logged) {
    if (name !== 'masuk') history.replaceState(null, '', '#/masuk');
    document.title = 'Masuk — Livora';
    return;
  }
  
  if (logged && (!CURRENT_PROFILE.nickname)) {
    try {
      const p = await db.getProfile();
      CURRENT_PROFILE = { fullName: p.full_name, nickname: p.nickname, photo: p.photo };
      CURRENT_SETTINGS = p.settings || CURRENT_SETTINGS;
    } catch(e) { console.error('Gagal load profil', e); }
  }

  if (!pages[name]) {
    name = 'beranda';
    history.replaceState(null, '', '#/beranda');
  }
  cleanup = await pages[name]() || null;
  window.scrollTo(0, 0);
}

/* ============================================================
   5. MODAL & FORM BUILDER
   ============================================================ */
function modal(node) {
  const ov = el('div', 'modal', null, [node]);
  const close = () => { ov.remove(); document.removeEventListener('keydown', esc); };
  const esc = e => { if (e.key === 'Escape') close(); };
  ov.onclick = e => { if (e.target === ov) close(); };
  document.addEventListener('keydown', esc);
  document.body.append(ov);
  lucide.createIcons();
  return close;
}

function confirmBox(text, onYes, yesLabel = 'Hapus') {
  const no = el('button', 'btn ghost small', 'Batal'), yes = el('button', 'btn danger small', yesLabel);
  const close = modal(el('div', 'modal-card', null, [el('h2', null, 'Konfirmasi'), el('p', 'muted-sm', text), el('div', 'form-actions', null, [no, yes])]));
  no.onclick = close;
  yes.onclick = async () => { close(); await onYes(); };
}

function openForm(c, item, onSave) {
  const form = el('form', 'modal-card', null, [el('h2', null, `${item ? 'Ubah' : 'Tambah'} ${c.label}`)]);
  const inp = {};
  c.fields.forEach(f => {
    const i = f.type === 'textarea' ? el('textarea')
      : f.type === 'select' ? el('select', null, null, f.options.map(([v, l]) => el('option', null, l, [], { value: v })))
      : el('input', null, null, [], { type: f.type || 'text', ...(f.attrs || {}) });
    i.value = item ? (item[f.key] ?? '') : (typeof f.def === 'function' ? f.def() : (f.def ?? ''));
    i.id = 'f-' + f.key;
    inp[f.key] = i;
    form.append(el('div', 'field', null, [el('label', null, f.label + (f.required ? ' *' : ''), [], { for: i.id }), i]));
  });
  const err = el('p', 'err', null, [], { role: 'alert' });
  const cancel = el('button', 'btn ghost small', 'Batal', [], { type: 'button' });
  const submitBtn = el('button', 'btn small', 'Simpan', [], { type: 'submit' });
  form.append(err, el('div', 'form-actions', null, [cancel, submitBtn]));
  
  const close = modal(form);
  cancel.onclick = close;
  form.onsubmit = async e => {
    e.preventDefault();
    const v = {};
    for (const f of c.fields) {
      let x = inp[f.key].value.trim();
      if (f.required && !x) { err.textContent = `${f.label} wajib diisi.`; return; }
      if (f.type === 'number') x = x === '' ? '' : Number(x);
      v[f.key] = x;
    }
    const m = c.validate && c.validate(v);
    if (m) { err.textContent = m; return; }
    
    submitBtn.disabled = true;
    submitBtn.textContent = 'Menyimpan...';
    try {
      await onSave(v);
      close();
    } catch(ex) {
      err.textContent = ex.message;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Simpan';
    }
  };
  inp[c.fields[0].key].focus();
}

/* ============================================================
   6. CRUD ENGINE (ASYNC)
   ============================================================ */
async function crudPage(c) {
  const add = el('button', 'btn small', null, [icon('plus'), `Tambah ${c.label}`]);
  const content = shell(c.page, c.title, c.sub, [add]);
  const st = { q: '', sort: c.sorts[0][0] };
  (c.filters || []).forEach(f => { st[f.key] = f.def || 'all'; });
  
  let localData = [];
  const bar = el('div', 'toolbar'), top = el('div'), box = el('div', c.cls || 'list');
  
  const refreshData = async () => {
    box.innerHTML = '<div class="empty">Memuat data...</div>';
    try {
      localData = await db.list(c.name);
      render();
    } catch(e) { toast(e.message); box.innerHTML = ''; }
  };

  const save = async (action) => {
    try {
      await action();
      await refreshData();
    } catch (e) {
      toast(e.message);
    }
  };

  const patch = (it, p) => save(() => db.update(c.name, it.id, p));
  const edit = it => openForm(c, it, async (v0) => {
    const v = c.transform ? c.transform(v0, it) : v0;
    if (it) await db.update(c.name, it.id, v);
    else await db.insert(c.name, v);
  });
  const del = it => confirmBox(`Hapus "${it.title || it.name || it.description || c.label}"?`, () => save(() => db.remove(c.name, it.id)));
  
  const ib = (ic, label, fn) => { const b = el('button', 'icon-btn', null, [icon(ic)], { 'aria-label': label, title: label }); b.onclick = fn; return b; };
  const menu = it => el('div', 'item-menu', null, [ib('pencil', 'Ubah', () => edit(it)), ib('trash-2', 'Hapus', () => del(it))]);
  add.onclick = () => edit(null);

  if (c.search) {
    const q = el('input', null, null, [], { type: 'search', placeholder: 'Cari…', 'aria-label': 'Cari' });
    q.oninput = () => { st.q = q.value.toLowerCase(); render(); };
    bar.append(q);
  }
  const sel = (key, opts, label) => {
    const s = el('select', null, null, opts.map(([v, l]) => el('option', null, l, [], { value: v })), { 'aria-label': label });
    s.value = st[key]; s.onchange = () => { st[key] = s.value; render(); }; bar.append(s);
  };
  (c.filters || []).forEach(f => sel(f.key, f.options, f.label));
  sel('sort', c.sorts.map(([v, l]) => [v, 'Urut: ' + l]), 'Urutkan');
  content.append(top, bar, box);

  function render() {
    const shown = localData.filter(x => 
      (!st.q || c.search(x).toLowerCase().includes(st.q)) && 
      (c.filters || []).every(f => st[f.key] === 'all' || f.test(x, st[f.key]))
    ).sort(c.sorts.find(s => s[0] === st.sort)[2]);
    
    top.replaceChildren(...(c.summary ? [c.summary(localData, shown, () => {})] : []));
    box.replaceChildren(...(shown.length ? shown.map(x => c.item(x, { menu, patch })) : [empty(localData.length ? 'Tidak ada hasil yang cocok.' : c.empty)]));
    lucide.createIcons();
  }
  await refreshData();
}

/* ============================================================
   7. PAGES DEFINITIONS
   ============================================================ */
pages.tugas = async () => {
  const PRI = { rendah: 1, sedang: 2, tinggi: 3 };
  await crudPage({
    page: 'tugas', name: 'tasks', label: 'tugas', title: 'Tugas', sub: 'Atur apa yang perlu diselesaikan.',
    empty: 'Belum ada tugas. Tekan "Tambah tugas" untuk mulai.',
    fields: [
      { key: 'title', label: 'Judul', required: true },
      { key: 'description', label: 'Deskripsi', type: 'textarea' },
      { key: 'priority', label: 'Prioritas', type: 'select', def: 'sedang', options: [['rendah', 'Rendah'], ['sedang', 'Sedang'], ['tinggi', 'Tinggi']] },
      { key: 'category', label: 'Kategori' },
      { key: 'due', label: 'Tenggat', type: 'date' }
    ],
    search: t => `${t.title} ${t.description || ''} ${t.category || ''}`,
    filters: [
      { key: 'status', label: 'Status', options: [['all', 'Semua status'], ['aktif', 'Belum selesai'], ['selesai', 'Selesai']], test: (t, v) => v === 'selesai' ? t.done : !t.done },
      { key: 'pri', label: 'Prioritas', options: [['all', 'Semua prioritas'], ['tinggi', 'Tinggi'], ['sedang', 'Sedang'], ['rendah', 'Rendah']], test: (t, v) => t.priority === v }
    ],
    sorts: [['due', 'Tenggat', (a, b) => (a.due || '9').localeCompare(b.due || '9')], ['pri', 'Prioritas', (a, b) => PRI[b.priority] - PRI[a.priority]]],
    item: (t, { menu, patch }) => {
      const cb = el('input', null, null, [], { type: 'checkbox', 'aria-label': 'Tandai selesai' });
      cb.checked = !!t.done;
      cb.onchange = () => patch(t, { done: cb.checked, done_on: cb.checked ? today() : null });
      const sub = [t.category, t.due && `Tenggat ${fmtDate(t.due)}`].filter(Boolean).join(' · ') || t.description || '';
      return el('div', 'item' + (t.done ? ' done' : ''), null, [
        cb, el('div', 'row-main', null, [el('div', 'row-title', t.title), el('div', 'row-sub', sub)]),
        chip(t.priority, 'p-' + t.priority), menu(t)
      ]);
    }
  });
};

pages.jadwal = async () => {
  const inRange = (d, r) => {
    const n = new Date(), t = dayKey(n);
    if (r === 'day') return d === t;
    if (r === 'week') { const m = addDays(n, -((n.getDay() + 6) % 7)); return d >= dayKey(m) && d <= dayKey(addDays(m, 6)); }
    return d.slice(0, 7) === t.slice(0, 7);
  };
  let calDay = null, cal = new Date(); cal = new Date(cal.getFullYear(), cal.getMonth(), 1);
  await crudPage({
    page: 'jadwal', name: 'schedule', label: 'kegiatan', title: 'Jadwal', sub: 'Kalender dan daftar kegiatan harian, mingguan, bulanan.',
    empty: 'Belum ada kegiatan. Tekan "Tambah kegiatan" untuk mengatur jadwal.',
    fields: [
      { key: 'title', label: 'Judul kegiatan', required: true },
      { key: 'date', label: 'Tanggal', type: 'date', required: true, def: today },
      { key: 'start_time', label: 'Waktu mulai', type: 'time', required: true, def: '09:00' },
      { key: 'end_time', label: 'Waktu selesai', type: 'time', required: true, def: '10:00' },
      { key: 'category', label: 'Kategori' },
      { key: 'description', label: 'Deskripsi', type: 'textarea' }
    ],
    validate: v => v.end_time <= v.start_time ? 'Waktu selesai harus setelah waktu mulai.' : '',
    search: e => `${e.title} ${e.category || ''} ${e.description || ''}`,
    filters: [{ key: 'range', label: 'Rentang', def: 'week', test: (e, v) => calDay ? e.date === calDay : (v === 'any' || inRange(e.date, v)), options: [['day', 'Hari ini'], ['week', 'Minggu ini'], ['month', 'Bulan ini'], ['any', 'Semua']] }],
    sorts: [['time', 'Waktu', (a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time)]],
    summary: (all, shown, render) => {
      const y = cal.getFullYear(), m = cal.getMonth(), off = (new Date(y, m, 1).getDay() + 6) % 7, t = today();
      const nav = (ic, label, d) => { const b = el('button', 'icon-btn', null, [icon(ic)], { 'aria-label': label, type: 'button' }); b.onclick = () => { cal = new Date(y, m + d, 1); render(); }; return b; };
      const head = el('div', 'card-head', null, [nav('chevron-left', 'Bulan sebelumnya', -1), el('h2', null, new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(cal), [], { style: 'justify-content:center' }), nav('chevron-right', 'Bulan berikutnya', 1)]);
      const cells = [...['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map(d => el('div', 'cal-h', d)), ...Array(off).fill(0).map(() => el('div')), ...Array.from({ length: new Date(y, m + 1, 0).getDate() }, (_, i) => {
        const k = dayKey(new Date(y, m, i + 1)), ev = all.filter(e => e.date === k);
        const c = el('button', 'cal-d' + (k === t ? ' today' : '') + (k === calDay ? ' sel' : ''), null, [el('span', null, String(i + 1)), el('div', 'cal-dots', null, ev.slice(0, 3).map(e => el('i', null, null, [], { style: `background:${colorOf(e.category || e.title)}` })))], { type: 'button', 'aria-label': `${i + 1}, ${ev.length} kegiatan` });
        c.onclick = () => { calDay = calDay === k ? null : k; render(); }; return c;
      })];
      const kids = [head, el('div', 'cal', null, cells)];
      if (calDay) { const x = el('button', 'btn ghost small', 'Tampilkan semua', [], { type: 'button' }); x.onclick = () => { calDay = null; render(); }; kids.push(el('div', 'form-actions', null, [el('span', 'muted-sm', `Menampilkan kegiatan ${fmtDate(calDay)}`), x])); }
      return el('div', 'card', null, kids, { style: 'margin-bottom:16px' });
    },
    item: (e, { menu }) => el('div', 'item', null, [el('span', 'dot', null, [], { style: `background:${colorOf(e.category || e.title)}` }), el('div', 'row-main', null, [el('div', 'row-title', e.title), el('div', 'row-sub', `${fmtDate(e.date)} · ${e.start_time.slice(0,5)}–${e.end_time.slice(0,5)}${e.category ? ' · ' + e.category : ''}`)]), menu(e)])
  });
};

pages.kebiasaan = async () => {
  await crudPage({
    page: 'kebiasaan', name: 'habits', label: 'kebiasaan', title: 'Kebiasaan', sub: 'Bangun konsistensi lewat checklist harian.',
    empty: 'Belum ada kebiasaan. Tekan "Tambah kebiasaan" untuk mulai melacak.',
    fields: [
      { key: 'name', label: 'Nama kebiasaan', required: true },
      { key: 'description', label: 'Deskripsi', type: 'textarea' },
      { key: 'target_per_week', label: 'Target (hari per minggu)', type: 'number', def: 7, required: true, attrs: { min: 1, max: 7 } }
    ],
    validate: v => v.target_per_week < 1 || v.target_per_week > 7 ? 'Target harus 1 sampai 7 hari.' : '',
    search: h => `${h.name} ${h.description || ''}`,
    sorts: [['name', 'Nama', (a, b) => a.name.localeCompare(b.name)], ['new', 'Terbaru', (a, b) => (b.created_at || '').localeCompare(a.created_at || '')]],
    item: (h, { menu, patch }) => {
      const n = new Date(), t = dayKey(n), log = h.log || {}, mon = addDays(n, -((n.getDay() + 6) % 7)), tg = h.target_per_week || 7;
      const wk = [0, 1, 2, 3, 4, 5, 6].filter(i => log[dayKey(addDays(mon, i))]).length;
      const mo = Object.keys(log).filter(k => log[k] && k.startsWith(t.slice(0, 7))).length;
      let s = 0, d = new Date(n); if (!log[t]) d = addDays(d, -1);
      while (log[dayKey(d)]) { s++; d = addDays(d, -1); }
      const y0 = n.getFullYear(), m0 = n.getMonth(), off = (new Date(y0, m0, 1).getDay() + 6) % 7;
      const dots = el('div', 'mcal', null, [...Array(off).fill(0).map(() => el('span')), ...Array.from({ length: new Date(y0, m0 + 1, 0).getDate() }, (_, k) => {
        const key = dayKey(new Date(y0, m0, k + 1));
        const b = el('button', 'd' + (log[key] ? ' on' : ''), String(k + 1), [], { type: 'button', title: key, 'aria-label': `Tandai ${key}` });
        if (key > t) b.disabled = true; else b.onclick = () => patch(h, { log: { ...log, [key]: !log[key] } });
        return b;
      })]);
      const b = el('button', 'btn small' + (log[t] ? '' : ' ghost'), null, [icon('check'), log[t] ? 'Selesai hari ini' : 'Tandai hari ini']);
      b.onclick = () => patch(h, { log: { ...log, [t]: !log[t] } });
      return el('div', 'item', null, [el('div', 'row-main', null, [el('div', 'row-title', h.name), el('div', 'row-sub', `Streak ${s} hari · Minggu ini ${wk}/${tg} (${Math.min(100, Math.round(wk / tg * 100))}%) · Bulan ini ${mo}/${n.getDate()} hari (${Math.round(mo / n.getDate() * 100)}%)`), dots]), b, menu(h)]);
    }
  });
};

pages.tujuan = async () => {
  const pct = ms => Math.round(ms.filter(m => m.done).length / ms.length * 100);
  await crudPage({
    page: 'tujuan', name: 'goals', label: 'tujuan', title: 'Tujuan', sub: 'Pantau target pribadi, milestone, dan progresnya.',
    empty: 'Belum ada tujuan. Tekan "Tambah tujuan" untuk menetapkan target.',
    fields: [
      { key: 'title', label: 'Nama tujuan', required: true },
      { key: 'description', label: 'Deskripsi', type: 'textarea' },
      { key: 'category', label: 'Kategori' },
      { key: 'start_date', label: 'Tanggal mulai', type: 'date', def: today },
      { key: 'target_date', label: 'Target selesai', type: 'date' },
      { key: 'msText', label: 'Milestone (satu per baris)', type: 'textarea' },
      { key: 'progress', label: 'Progres (%) — otomatis jika ada milestone', type: 'number', def: 0, attrs: { min: 0, max: 100 } },
      { key: 'status', label: 'Status', type: 'select', def: 'aktif', options: [['aktif', 'Aktif'], ['selesai', 'Selesai'], ['ditunda', 'Ditunda']] }
    ],
    validate: v => (v.target_date && v.start_date && v.target_date < v.start_date) ? 'Target selesai tidak boleh sebelum tanggal mulai.' : (v.progress !== '' && (v.progress < 0 || v.progress > 100)) ? 'Progres harus 0 sampai 100.' : '',
    transform: (v, it) => {
      const prev = (it && it.milestones) || [], lines = (v.msText || '').split('\n').map(s => s.trim()).filter(Boolean);
      const milestones = lines.map(t => ({ t, done: prev.some(p => p.t === t && p.done) }));
      const out = { ...v, milestones, msText: lines.join('\n') };
      if (milestones.length) { out.progress = pct(milestones); if (out.progress >= 100) out.status = 'selesai'; }
      delete out.msText; // Jangan simpan msText ke DB, hanya milestones
      return out;
    },
    search: g => `${g.title} ${g.description || ''} ${g.category || ''}`,
    filters: [{ key: 'status', label: 'Status', options: [['all', 'Semua status'], ['aktif', 'Aktif'], ['selesai', 'Selesai'], ['ditunda', 'Ditunda']], test: (g, v) => g.status === v }],
    sorts: [['target_date', 'Target selesai', (a, b) => (a.target_date || '9').localeCompare(b.target_date || '9')], ['progress', 'Progres', (a, b) => (b.progress || 0) - (a.progress || 0)]],
    item: (g, { menu, patch }) => {
      const ms = g.milestones || [], p = ms.length ? pct(ms) : (Number(g.progress) || 0), extra = [];
      const pctEl = el('span', 'muted-sm', `${p}%`);
      if (ms.length) {
        ms.forEach((m, i) => {
          const cb = el('input', null, null, [], { type: 'checkbox', 'aria-label': m.t }); cb.checked = m.done;
          cb.onchange = () => { const nx = ms.map((x, j) => j === i ? { ...x, done: cb.checked } : x), np = pct(nx); patch(g, { milestones: nx, progress: np, status: np >= 100 ? 'selesai' : g.status === 'selesai' ? 'aktif' : g.status }); };
          extra.push(el('label', 'check', null, [cb, m.t]));
        });
      } else {
        const range = el('input', null, null, [], { type: 'range', min: 0, max: 100, step: 5, value: p, 'aria-label': 'Progres' });
        range.oninput = () => { pctEl.textContent = range.value + '%'; };
        range.onchange = () => patch(g, { progress: Number(range.value), status: Number(range.value) >= 100 ? 'selesai' : g.status === 'selesai' ? 'aktif' : g.status });
        extra.push(range);
      }
      const sub = [g.category, g.target_date && `Target ${fmtDate(g.target_date)}`].filter(Boolean).join(' · ') || g.description || '';
      return el('div', 'item block', null, [el('div', 'item', null, [el('div', 'row-main', null, [el('div', 'row-title', g.title), el('div', 'row-sub', sub)]), chip(g.status, 's-' + g.status), menu(g)]), el('div', 'flow', null, [el('div', 'track', null, [el('div', 'fill', null, [], { style: `width:${p}%` })]), pctEl]), ...extra]);
    }
  });
};

pages.catatan = async () => {
  await crudPage({
    page: 'catatan', name: 'notes', label: 'catatan', title: 'Catatan', sub: 'Tulis dan simpan ide pribadimu.', cls: 'cards',
    empty: 'Belum ada catatan. Tekan "Tambah catatan" untuk menulis.',
    fields: [{ key: 'title', label: 'Judul' }, { key: 'content', label: 'Isi catatan', type: 'textarea', required: true }, { key: 'tags', label: 'Tag (pisahkan dengan koma)' }],
    search: n => `${n.title || ''} ${n.content} ${n.tags || ''}`,
    sorts: [['upd', 'Pembaruan terakhir', (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updated_at || '').localeCompare(a.updated_at || '')]],
    item: (n, { menu, patch }) => {
      const pin = el('button', 'icon-btn', null, [icon(n.pinned ? 'pin-off' : 'pin')], { 'aria-label': n.pinned ? 'Lepas pin' : 'Pin catatan', title: n.pinned ? 'Lepas pin' : 'Pin' });
      pin.onclick = () => patch(n, { pinned: !n.pinned });
      const tags = (n.tags || '').split(',').map(t => t.trim()).filter(Boolean).map(t => chip(t));
      const d = n.updated_at ? new Date(n.updated_at) : null;
      return el('div', 'item block', null, [
        el('div', 'item', null, [el('div', 'row-main', null, [el('div', 'row-title', n.title || 'Tanpa judul')]), pin]),
        el('p', 'note-body', n.content), el('div', 'item', null, tags), el('div', 'item', null, [el('small', 'muted-sm', d ? fmtDate(n.updated_at) : ''), menu(n)])
      ]);
    }
  });
};

pages.keuangan = async () => {
  const monthKey = off => dayKey(new Date(new Date().getFullYear(), new Date().getMonth() + off, 1)).slice(0, 7);
  function cashChart(shown) {
    const oneMonth = new Set(shown.map(x => x.date.slice(0, 7))).size <= 1, g = {};
    shown.forEach(x => { const k = oneMonth ? x.date.slice(8) : x.date.slice(0, 7); (g[k] = g[k] || { i: 0, e: 0 })[x.type === 'income' ? 'i' : 'e'] += x.amount; });
    const keys = Object.keys(g).sort(), mx = Math.max(1, ...keys.map(k => Math.max(g[k].i, g[k].e)));
    const cols = keys.map(k => el('div', 'cash-col', null, [el('div', 'cash-bars', null, [el('i', 'up', null, [], { style: `height:${g[k].i / mx * 100}%`, title: 'Pemasukan ' + rupiah(g[k].i) }), el('i', 'down', null, [], { style: `height:${g[k].e / mx * 100}%`, title: 'Pengeluaran ' + rupiah(g[k].e) })]), el('small', null, oneMonth ? k : k.slice(5) + '/' + k.slice(2, 4))]));
    return el('div', 'card flows', null, [el('h2', null, 'Arus kas periode ini'), cols.length ? el('div', 'cash', null, cols) : empty('Belum ada transaksi pada periode ini.'), el('div', 'legend', null, [el('span', 'up', '● Pemasukan'), el('span', 'down', '● Pengeluaran')])]);
  }
  await crudPage({
    page: 'keuangan', name: 'finance', label: 'transaksi', title: 'Keuangan', sub: 'Catat pemasukan dan pengeluaran.',
    empty: 'Belum ada transaksi. Tekan "Tambah transaksi" untuk mencatat.',
    fields: [{ key: 'type', label: 'Jenis', type: 'select', def: 'expense', options: [['expense', 'Pengeluaran'], ['income', 'Pemasukan']] }, { key: 'amount', label: 'Nilai (Rp)', type: 'number', required: true, attrs: { min: 1, step: 1 } }, { key: 'category', label: 'Kategori' }, { key: 'date', label: 'Tanggal', type: 'date', required: true, def: today }, { key: 'description', label: 'Deskripsi' }],
    validate: v => !(v.amount > 0) ? 'Nilai transaksi harus lebih dari 0.' : '',
    search: t => `${t.description || ''} ${t.category || ''}`,
    filters: [{ key: 'period', label: 'Periode', def: 'now', options: [['now', 'Bulan ini'], ['last', 'Bulan lalu'], ['all', 'Semua']], test: (t, v) => t.date.startsWith(v === 'now' ? monthKey(0) : monthKey(-1)) }],
    sorts: [['date', 'Terbaru', (a, b) => b.date.localeCompare(a.date)], ['amt', 'Nilai terbesar', (a, b) => b.amount - a.amount]],
    summary: (all, shown) => {
      const sum = t => shown.filter(x => x.type === t).reduce((s, x) => s + x.amount, 0);
      const inc = sum('income'), exp = sum('expense'), mx = Math.max(inc, exp, 1);
      const bal = all.reduce((s, x) => s + (x.type === 'income' ? x.amount : -x.amount), 0);
      const card = (l, v, c) => el('div', 'card', null, [el('div', 'stat-label', l), el('div', 'stat-value ' + c, rupiah(v))]);
      return el('div', null, null, [el('div', 'grid stats3', null, [card('Saldo (semua transaksi)', bal, ''), card('Pemasukan', inc, 'up'), card('Pengeluaran', exp, 'down')]), cashChart(shown)]);
    },
    item: (t, { menu }) => el('div', 'item', null, [el('div', 'row-main', null, [el('div', 'row-title', t.description || t.category || (t.type === 'income' ? 'Pemasukan' : 'Pengeluaran')), el('div', 'row-sub', `${fmtDate(t.date)}${t.category ? ' · ' + t.category : ''}`)]), el('strong', 'amt ' + (t.type === 'income' ? 'up' : 'down'), `${t.type === 'income' ? '+' : '-'}${rupiah(t.amount)}`), menu(t)])
  });
};

pages.profil = async () => {
  const content = shell('profil', 'Profil', 'Kelola identitas dan fotomu.');
  let photo = CURRENT_PROFILE.photo || null;
  const preview = el('div', 'big-avatar');
  const drawAvatar = () => {
    preview.replaceChildren();
    if (photo) preview.append(el('img', '', null, [], { src: photo, alt: 'Foto profil' }));
    else preview.textContent = ((nick.value || CURRENT_PROFILE.nickname || '?')[0] || '?').toUpperCase();
  };
  const nick = el('input', null, null, [], { id: 'nick', maxlength: 20, value: CURRENT_PROFILE.nickname || '' });
  const full = el('input', null, null, [], { id: 'full', value: CURRENT_PROFILE.fullName || '', disabled: '' });
  const file = el('input', null, null, [], { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: '' });
  const pick = el('button', 'btn ghost small', 'Ganti foto', [], { type: 'button' });
  const drop = el('button', 'btn ghost small', 'Hapus foto', [], { type: 'button' });
  const err = el('p', 'err', null, [], { role: 'alert' });
  const save = el('button', 'btn small', 'Simpan perubahan'), cancel = el('button', 'btn ghost small', 'Batal');
  
  pick.onclick = () => file.click();
  file.onchange = async () => {
    err.textContent = '';
    try { photo = await resizeImage(file.files[0]); drawAvatar(); } catch (e) { err.textContent = e.message; }
    file.value = '';
  };
  drop.onclick = () => { photo = null; drawAvatar(); };
  nick.oninput = () => { if (!photo) drawAvatar(); };
  cancel.onclick = () => route();
  save.onclick = async () => {
    const n = nick.value.trim();
    if (n.length < 2) return void (err.textContent = 'Nama panggilan minimal 2 karakter.');
    save.disabled = true; save.textContent = 'Menyimpan...';
    try {
      await db.updateProfile({ nickname: n, photo });
      CURRENT_PROFILE.nickname = n; CURRENT_PROFILE.photo = photo;
      toast('Profil disimpan.'); setTimeout(() => route(), 600);
    } catch(e) {
      err.textContent = e.message; save.disabled = false; save.textContent = 'Simpan perubahan';
    }
  };
  const field = (label, input, hint) => el('div', 'field', null, [el('label', null, label, [], { for: input.id }), input, ...(hint ? [el('small', 'muted-sm', hint)] : [])]);
  
  drawAvatar();
  content.append(el('div', 'card sect', null, [preview, el('div', 'form-actions', null, [pick, drop]), file, field('Nama panggilan', nick, 'Dipakai untuk sapaan di Beranda.'), field('Nama lengkap', full, 'Identitas akun, tidak dapat diubah.'), err, el('div', 'form-actions', null, [cancel, save])]));
};

pages.pengaturan = async () => {
  const content = shell('pengaturan', 'Pengaturan', 'Tampilan, data lokal, dan akun.');
  const theme = el('select', null, null, [el('option', null, 'Gelap', [], { value: 'dark' }), el('option', null, 'Terang', [], { value: 'light' })], { id: 'theme', 'aria-label': 'Tema' });
  theme.value = CURRENT_SETTINGS.theme || 'dark';
  theme.onchange = async () => {
    CURRENT_SETTINGS.theme = theme.value; applyTheme(theme.value);
    await db.updateProfile({ settings: CURRENT_SETTINGS });
  };

  const dfmt = el('select', null, null, [['long', '17 Okt 2026'], ['dmy', '17/10/2026'], ['iso', '2026-10-17']].map(([v, l]) => el('option', null, l, [], { value: v })), { id: 'dfmt', 'aria-label': 'Format tanggal' });
  dfmt.value = CURRENT_SETTINGS.dateFormat || 'long';
  dfmt.onchange = async () => {
    CURRENT_SETTINGS.dateFormat = dfmt.value;
    await db.updateProfile({ settings: CURRENT_SETTINGS });
    toast('Format tanggal diperbarui.');
  };
  
  const notif = el('input', null, null, [], { type: 'checkbox', id: 'notif' });
  notif.checked = !!CURRENT_SETTINGS.notify && 'Notification' in window && Notification.permission === 'granted';
  notif.onchange = async () => {
    if (notif.checked) {
      if (!('Notification' in window)) { notif.checked = false; return toast('Browser ini tidak mendukung notifikasi.'); }
      if ((await Notification.requestPermission()) !== 'granted') { notif.checked = false; return toast('Izin notifikasi ditolak di browser.'); }
    }
    CURRENT_SETTINGS.notify = notif.checked;
    await db.updateProfile({ settings: CURRENT_SETTINGS });
    toast(notif.checked ? 'Pengingat jadwal aktif.' : 'Pengingat dimatikan.');
  };

  const exp = el('button', 'btn ghost small', null, [icon('download'), 'Ekspor data']);
  exp.onclick = async () => {
    try {
      exp.disabled = true; exp.textContent = 'Mengekspor...';
      const tables = ['tasks', 'schedule', 'habits', 'notes', 'finance', 'goals', 'focus'];
      const result = { app: 'livora', version: 1, exportedAt: new Date().toISOString(), data: {} };
      for (const t of tables) result.data[t] = await db.list(t);
      
      const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
      const a = el('a', null, null, [], { href: URL.createObjectURL(blob), download: `livora-cadangan-${today()}.json` });
      a.click(); URL.revokeObjectURL(a.href);
      exp.disabled = false; exp.replaceChildren(icon('download'), 'Ekspor data');
    } catch(e) { toast('Gagal ekspor: ' + e.message); exp.disabled = false; }
  };

  const file = el('input', null, null, [], { type: 'file', accept: 'application/json', hidden: '' });
  const imp = el('button', 'btn ghost small', null, [icon('upload'), 'Impor data']);
  imp.onclick = () => file.click();
  file.onchange = async () => {
    try {
      const data = JSON.parse(await file.files[0].text());
      if (!data || data.app !== 'livora' || typeof data.data !== 'object') throw new Error('Berkas bukan cadangan Livora.');
      
      confirmBox('Impor akan menimpa data yang ada dengan isi berkas ini. Lanjutkan?', async () => {
        imp.disabled = true; imp.textContent = 'Mengimpor...';
        try {
          // Hapus data lama
          const tables = ['tasks', 'schedule', 'habits', 'notes', 'finance', 'goals', 'focus'];
          for (const t of tables) {
            const uid = (await supabase.auth.getSession()).data.session.user.id;
            await supabase.from(t).delete().eq('user_id', uid);
          }
          // Masukkan data baru
          for (const [t, rows] of Object.entries(data.data)) {
            if (tables.includes(t) && Array.isArray(rows) && rows.length > 0) {
              const uid = (await supabase.auth.getSession()).data.session.user.id;
              await supabase.from(t).insert(rows.map(r => ({ ...r, user_id: uid })));
            }
          }
          toast('Data berhasil diimpor.');
          setTimeout(() => route(), 700);
        } catch(e) { toast('Gagal impor: ' + e.message); imp.disabled = false; imp.replaceChildren(icon('upload'), 'Impor data'); }
      }, 'Impor');
    } catch (e) { toast('Berkas tidak valid atau bukan JSON.'); }
    file.value = '';
  };

  const wipe = el('button', 'btn danger small', null, [icon('trash-2'), 'Hapus semua data']);
  wipe.onclick = () => confirmBox('Semua data di akunmu akan dihapus permanen dari server. Ekspor dulu jika perlu.', async () => {
    wipe.disabled = true; wipe.textContent = 'Menghapus...';
    try {
      const tables = ['tasks', 'schedule', 'habits', 'notes', 'finance', 'goals', 'focus'];
      const uid = (await supabase.auth.getSession()).data.session.user.id;
      for (const t of tables) await supabase.from(t).delete().eq('user_id', uid);
      toast('Data berhasil dihapus.'); setTimeout(() => location.href = '#/beranda', 700);
    } catch(e) { toast('Gagal menghapus: ' + e.message); wipe.disabled = false; wipe.replaceChildren(icon('trash-2'), 'Hapus semua data'); }
  }, 'Hapus semua');

  const out = el('button', 'btn ghost small', null, [icon('log-out'), 'Keluar']);
  out.onclick = () => authService.logout();

  const pav = el('div', 'big-avatar', null, CURRENT_PROFILE.photo ? [el('img', '', null, [], { src: CURRENT_PROFILE.photo, alt: '' })] : [], { style: 'width:64px;height:64px;font-size:26px' });
  if (!CURRENT_PROFILE.photo) pav.textContent = (CURRENT_PROFILE.nickname || '?')[0].toUpperCase();
  
  const sect = (title, ...kids) => el('div', 'card sect', null, [el('h2', null, title), ...kids]);
  content.append(
    sect('Profil', el('div', 'item', null, [pav, el('div', 'row-main', null, [el('div', 'row-title', CURRENT_PROFILE.nickname || ''), el('div', 'row-sub', CURRENT_PROFILE.fullName || '')]), el('a', 'btn ghost small', 'Ubah foto & nama panggilan', [], { href: '#/profil' })])),
    sect('Tampilan', el('div', 'field', null, [el('label', null, 'Tema', [], { for: 'theme' }), theme]), el('div', 'field', null, [el('label', null, 'Format tanggal', [], { for: 'dfmt' }), dfmt])),
    sect('Notifikasi', el('label', 'check', null, [notif, 'Ingatkan 10 menit sebelum kegiatan (hanya saat tab Livora terbuka)'])),
    sect('Data (Cloud)', el('p', 'muted-sm', 'Data tersimpan di server Supabase. Ekspor/Impor berguna untuk backup manual.'), el('div', 'form-actions', null, [exp, imp, wipe]), file),
    sect('Akun', el('p', 'muted-sm', 'Keluar tidak menghapus data. Masuk lagi kapan saja dari perangkat mana pun.'), el('div', 'form-actions', null, [out]))
  );
  lucide.createIcons();
};

pages.beranda = async () => {
  const content = shell('beranda', 'Beranda', 'Sedikit kemajuan setiap hari, lama-lama jadi besar.');
  content.append(document.getElementById('tpl-beranda').content.cloneNode(true));
  
  content.querySelector('#scheduleList').innerHTML = '<div class="empty">Memuat data...</div>';
  content.querySelector('#stats').innerHTML = '';
  content.querySelector('#chartBars').innerHTML = '';
  content.querySelector('#habitList').innerHTML = '<div class="empty">Memuat data...</div>';
  content.querySelector('#noteList').innerHTML = '<div class="empty">Memuat data...</div>';

  const $ = s => content.querySelector(s);
  const DATA = ['tasks', 'schedule', 'habits', 'notes', 'finance', 'focus'];
  const DAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
  const MODES = { pomodoro: 25, short: 5, long: 15 };
  
  let stateData = { tasks: [], schedule: [], habits: [], notes: [], finance: [], focus: [] };
  
  const loadAll = async () => {
    try {
      const [tasks, schedule, habits, notes, finance, focus] = await Promise.all(DATA.map(t => db.list(t)));
      stateData = { tasks, schedule, habits, notes, finance, focus };
      renderAll();
    } catch(e) { toast('Gagal memuat data beranda.'); }
  };

  function renderHeader() {
    const h = new Date().getHours();
    const part = h < 11 ? 'pagi' : h < 15 ? 'siang' : h < 18 ? 'sore' : 'malam';
    $('#pageTitle').textContent = `Selamat ${part}, ${CURRENT_PROFILE.nickname || 'Teman'}`;
  }

  function stat(ico, label, value, delta, sign) {
    const d = el('div', 'delta' + (sign > 0 ? ' up' : sign < 0 ? ' down' : ''), null, [...(sign ? [icon(sign > 0 ? 'arrow-up-right' : 'arrow-down-right')] : []), el('span', null, delta)]);
    return el('article', 'card stat', null, [el('div', 'stat-ico', null, [icon(ico)]), el('div', null, null, [el('div', 'stat-label', label), el('div', 'stat-value', value), d])]);
  }
  const vsYesterday = (n, unit = '') => n === 0 ? 'Sama seperti kemarin' : `${n > 0 ? '+' : ''}${n}${unit} dari kemarin`;

  function renderStats(now) {
    const t = dayKey(now), y = dayKey(addDays(now, -1));
    const tasks = stateData.tasks, done = tasks.filter(x => x.done);
    const dTask = done.filter(x => x.done_on === t).length - done.filter(x => x.done_on === y).length;

    const focusOn = d => stateData.focus.filter(f => f.date === d).reduce((s, f) => s + f.minutes, 0);
    const dFocus = focusOn(t) - focusOn(y);

    const habits = stateData.habits;
    const doneOn = d => habits.filter(h => h.log && h.log[d]).length;
    const dHabit = doneOn(t) - doneOn(y);

    const net = key => stateData.finance.filter(x => x.date.startsWith(key)).reduce((s, x) => s + (x.type === 'income' ? x.amount : -x.amount), 0);
    const cur = net(t.slice(0, 7)), prev = net(dayKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7));
    const pct = prev > 0 ? Math.round((cur - prev) / prev * 100) : null;

    $('#stats').replaceChildren(
      stat('square-check-big', 'Tugas selesai', `${done.length}/${tasks.length}`, tasks.length ? vsYesterday(dTask) : 'Belum ada tugas', tasks.length ? Math.sign(dTask) : 0),
      stat('clock', 'Waktu fokus', fmtDur(focusOn(t)), dFocus ? `${dFocus > 0 ? '+' : '-'}${fmtDur(Math.abs(dFocus))} dari kemarin` : 'Sama seperti kemarin', Math.sign(dFocus)),
      stat('target', 'Kebiasaan hari ini', `${doneOn(t)}/${habits.length}`, habits.length ? vsYesterday(dHabit) : 'Belum ada kebiasaan', habits.length ? Math.sign(dHabit) : 0),
      stat('wallet', 'Tabungan bulan ini', rupiah(cur), pct === null ? 'Belum ada pembanding bulan lalu' : `${pct > 0 ? '+' : ''}${pct}% dari bulan lalu`, pct === null ? 0 : Math.sign(pct))
    );
  }

  function renderSchedule(now) {
    const box = $('#scheduleList'), t = dayKey(now);
    const events = stateData.schedule.filter(e => e.date === t).sort((a, b) => a.start_time.localeCompare(b.start_time));
    if (!events.length) return box.replaceChildren(empty('Belum ada kegiatan hari ini.', '#/jadwal', 'Atur jadwal'));
    box.replaceChildren(...events.map((e, i) => el('a', 'row', null, [
      el('span', 'time', e.start_time.slice(0,5)),
      Object.assign(el('span', 'dot'), { style: `background:${COLORS[i % COLORS.length]}` }),
      el('div', 'row-main', null, [el('div', 'row-title', e.title), el('div', 'row-sub', `${e.category || 'Kegiatan'} · ${fmtDur(toMin(e.end_time) - toMin(e.start_time))}`)]),
      icon('chevron-right')
    ])).map(a => Object.assign(a, { href: '#/jadwal' })));
  }

  function renderChart(now) {
    const monday = addDays(now, -((now.getDay() + 6) % 7));
    const hours = DAYS.map((_, i) => { const k = dayKey(addDays(monday, i)); return stateData.focus.filter(f => f.date === k).reduce((s, f) => s + f.minutes, 0) / 60; });
    const top = Math.max(4, Math.ceil(Math.max(...hours) / 4) * 4);
    $('#chartY').replaceChildren(...[4, 3, 2, 1, 0].map(n => el('span', null, `${top * n / 4}j`)));
    $('#chartBars').replaceChildren(...hours.map((h, i) => Object.assign(el('div', 'bar'), { style: `height:${h / top * 100}%`, title: `${DAYS[i]}: ${fmtDur(Math.round(h * 60))}` })));
    $('#chartDays').replaceChildren(...DAYS.map(d => el('span', null, d)));
  }

  function streakOf(h, now) {
    let d = new Date(now), s = 0;
    if (!(h.log && h.log[dayKey(d)])) d = addDays(d, -1);
    while (h.log && h.log[dayKey(d)]) { s++; d = addDays(d, -1); }
    return s;
  }
  function renderHabits(now) {
    const box = $('#habitList'), monday = addDays(now, -((now.getDay() + 6) % 7));
    const habits = stateData.habits.slice(0, 4);
    if (!habits.length) return box.replaceChildren(empty('Belum ada kebiasaan yang dilacak.', '#/kebiasaan', 'Buat kebiasaan'));
    box.replaceChildren(...habits.map(h => {
      const target = h.target_per_week || 7;
      const count = DAYS.filter((_, i) => h.log && h.log[dayKey(addDays(monday, i))]).length;
      const p = Math.min(100, Math.round(count / target * 100));
      const ring = el('div', 'ring', null, [el('span', null, `${p}%`)]); ring.style.setProperty('--p', p);
      return Object.assign(el('a', 'row', null, [ring, el('div', 'row-main', null, [el('div', 'row-title', h.name), el('div', 'row-sub', `${count}/${target} hari · Streak ${streakOf(h, now)}`)]), icon('chevron-right')]), { href: '#/kebiasaan' });
    }));
  }

  function renderNotes(now) {
    const box = $('#noteList');
    const notes = stateData.notes.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 2);
    if (!notes.length) return box.replaceChildren(empty('Belum ada catatan. Tekan + untuk menulis.'));
    box.replaceChildren(...notes.map(n => {
      const d = new Date(n.updated_at);
      const when = dayKey(d) === dayKey(now) ? 'Hari ini' : new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' }).format(d);
      return el('div', 'note', null, [el('p', null, n.content), el('small', null, `${when}, ${pad(d.getHours())}:${pad(d.getMinutes())}`)]);
    }));
  }

  function renderBanner() {
    const isEmpty = DATA.every(n => !stateData[n].length);
    $('#banner').hidden = !isEmpty;
    $('#bannerText').textContent = 'Datamu masih kosong. Ingin melihat tampilan penuh dengan data contoh?';
    $('#bannerBtn').textContent = 'Isi data contoh';
    $('#bannerBtn').onclick = async () => {
      $('#bannerBtn').disabled = true;
      $('#bannerBtn').textContent = 'Mengisi...';
      await seedDemo();
      await loadAll();
    };
  }

  async function seedDemo() {
    const now = new Date(), t = dayKey(now), y = dayKey(addDays(now, -1));
    const push = async (name, items) => {
      for (const item of items) await db.insert(name, item);
    };
    await push('tasks', Array.from({ length: 12 }, (_, i) => ({ title: `Tugas contoh ${i + 1}`, done: i < 8, done_on: i < 4 ? t : i < 6 ? y : dayKey(addDays(now, -3)) })));
    await push('focus', [240, 390, 200, 300, 250, 170, 280].map((m, i) => ({ date: dayKey(addDays(addDays(now, -((now.getDay() + 6) % 7)), i)), minutes: m })));
    await push('schedule', [['09:00', '11:00', 'Belajar desain UI', 'Kelas online'], ['11:30', '13:30', 'Mengerjakan Livora', 'Desain & pengembangan'], ['13:00', '14:00', 'Istirahat', 'Makan siang'], ['16:00', '16:30', 'Tinjau tujuan', 'Rencana minggu depan']].map(([start, end, title, category]) => ({ date: t, start_time: start + ':00', end_time: end + ':00', title, category })));
    await push('habits', [['Olahraga', 5, 4], ['Baca buku', 5, 3], ['Meditasi', 7, 7], ['Makan sehat', 5, 4]].map(([name, target_per_week, days]) => { const log = {}; for (let i = 0; i < days; i++) log[dayKey(addDays(now, -i))] = true; return { name, target_per_week, log }; }));
    await push('finance', [{ type: 'income', amount: 3000000, date: t, description: 'Contoh pemasukan' }, { type: 'expense', amount: 2550000, date: t, description: 'Contoh pengeluaran' }, { type: 'income', amount: 2000000, date: dayKey(new Date(now.getFullYear(), now.getMonth() - 1, 10)), description: 'Contoh bulan lalu' }, { type: 'expense', amount: 1650000, date: dayKey(new Date(now.getFullYear(), now.getMonth() - 1, 12)), description: 'Contoh bulan lalu' }]);
    await push('notes', [{ title: '', content: 'Jangan lupa kirim laporan ke klien sebelum jam 5 sore.' }]);
  }

  function renderAll() {
    const now = new Date();
    renderHeader(); renderBanner(); renderStats(now); renderSchedule(now); renderChart(now); renderHabits(now); renderNotes(now);
    lucide.createIcons();
  }

  /* ===== Sesi Fokus ===== */
  let mode = 'pomodoro', remaining = MODES.pomodoro * 60, timerId = null, endAt = 0;
  const drawTime = () => { $('#timeDisplay').textContent = `${pad(Math.floor(remaining / 60))}:${pad(remaining % 60)}`; };
  function setButton(running) { $('#timerBtn').replaceChildren(icon(running ? 'pause' : 'play'), el('span', null, running ? 'Jeda' : 'Mulai')); lucide.createIcons(); }
  async function tick() {
    remaining = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    drawTime();
    if (remaining > 0) return;
    clearInterval(timerId); timerId = null;
    if (mode === 'pomodoro') {
      try {
        await db.insert('focus', { date: dayKey(new Date()), minutes: MODES.pomodoro });
        toast('Sesi fokus selesai. +25 menit tercatat.');
        await loadAll();
      } catch (e) { toast('Gagal menyimpan sesi fokus.'); }
    } else toast('Waktu istirahat selesai.');
    remaining = MODES[mode] * 60; drawTime(); setButton(false);
  }
  function toggleTimer() {
    if (timerId) { clearInterval(timerId); timerId = null; setButton(false); return; }
    endAt = Date.now() + remaining * 1000; timerId = setInterval(tick, 250); setButton(true);
  }
  function changeMode(value) {
    clearInterval(timerId); timerId = null; mode = value; remaining = MODES[mode] * 60; drawTime(); setButton(false);
  }

  $('#timerBtn').onclick = toggleTimer;
  content.querySelectorAll('input[name="mode"]').forEach(r => r.onchange = () => changeMode(r.value));

  $('#noteToggle').onclick = () => { const f = $('#noteForm'); f.hidden = !f.hidden; if (!f.hidden) $('#noteInput').focus(); };
  $('#noteSave').onclick = async () => {
    const c = $('#noteInput').value.trim();
    if (!c) return toast('Tulis isi catatan dulu.');
    const btn = $('#noteSave'); btn.disabled = true; btn.textContent = 'Menyimpan...';
    try {
      await db.insert('notes', { title: '', content: c, pinned: false });
      $('#noteInput').value = ''; $('#noteForm').hidden = true;
      toast('Catatan disimpan.'); await loadAll();
    } catch(e) { toast('Gagal menyimpan.'); }
    btn.disabled = false; btn.textContent = 'Simpan catatan';
  };

  await loadAll();
  return () => clearInterval(timerId);
};

/* ============================================================
   8. INISIALISASI AUTH & ROUTER
   ============================================================ */
function initShell() {
  $('#menuBtn').onclick = async () => {
    const closed = document.body.classList.toggle('side-closed');
    CURRENT_SETTINGS.sideClosed = closed;
    await db.updateProfile({ settings: CURRENT_SETTINGS });
  };
  $('#logoutBtn').onclick = () => authService.logout();
  const sheet = $('#sheet');
  $('#moreBtn').onclick = () => { sheet.hidden = false; };
  $('#sheetLogout').onclick = () => authService.logout();
  sheet.onclick = e => { if (e.target === sheet || e.target.closest('a')) sheet.hidden = true; };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') sheet.hidden = true; });
  $('#themeBtn').onclick = async () => {
    const n = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    CURRENT_SETTINGS.theme = n; applyTheme(n);
    await db.updateProfile({ settings: CURRENT_SETTINGS });
  };
}

function startReminders() {
  const sent = new Set();
  setInterval(async () => {
    if (!(await authService.current())) return;
    if (!CURRENT_SETTINGS.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
    const now = new Date(), t = dayKey(now), mins = now.getHours() * 60 + now.getMinutes();
    try {
      const schedule = await db.list('schedule');
      schedule.filter(e => e.date === t).forEach(e => {
        const [h, m] = e.start_time.split(':').map(Number), diff = h * 60 + m - mins;
        if (diff >= 0 && diff <= 10 && !sent.has(e.id)) {
          sent.add(e.id);
          new Notification('Livora: ' + e.title, { body: `Mulai ${e.start_time.slice(0,5)}${diff ? ` (${diff} menit lagi)` : ''}` });
        }
      });
    } catch(e) {}
  }, 30000);
}

function initAuth() {
  const loginForm = $('#loginForm'), registerForm = $('#registerForm'), resetForm = $('#resetForm');
  function showTab(login) {
    loginForm.hidden = !login; registerForm.hidden = login; resetForm.hidden = true;
    $('#tabLogin').classList.toggle('on', login); $('#tabRegister').classList.toggle('on', !login);
  }
  $('#tabLogin').onclick = () => showTab(true);
  $('#tabRegister').onclick = () => showTab(false);

  document.querySelectorAll('.eye').forEach(b => b.onclick = () => {
    const i = b.parentElement.querySelector('input'), show = i.type === 'password';
    i.type = show ? 'text' : 'password';
    b.replaceChildren(icon(show ? 'eye-off' : 'eye'));
    b.setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password');
    lucide.createIcons();
  });

  function strength(pw) {
    let s = 0; if (pw.length >= 8) s++; if (pw.length >= 12) s++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw)) s++; if (/[^A-Za-z0-9]/.test(pw)) s++;
    return s;
  }
  $('#rPass').oninput = e => {
    const s = strength(e.target.value), bar = $('#meterBar');
    bar.style.width = (e.target.value ? Math.max(1, s) * 25 : 0) + '%';
    bar.style.background = s <= 1 ? 'var(--bad)' : s <= 2 ? '#f5b942' : 'var(--good)';
    $('#meterText').textContent = e.target.value ? ['Lemah', 'Lemah', 'Cukup', 'Kuat', 'Sangat kuat'][s] : 'Minimal 8 karakter';
  };

  async function run(form, errBox, fn) {
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; errBox.textContent = '';
    try {
      await fn();
      ['#lPass', '#rPass', '#rPass2'].forEach(s => { const el = $(s); if(el) el.value = ''; });
      location.hash = '#/beranda';
      location.reload(); // reload untuk memuat state dengan bersih
    } catch (e) { errBox.textContent = e.message; btn.disabled = false; }
  }
  
  loginForm.onsubmit = e => {
    e.preventDefault();
    const name = $('#lName').value, pw = $('#lPass').value;
    if (!name.trim() || !pw) return void ($('#lErr').textContent = 'Isi nama lengkap dan password.');
    run(loginForm, $('#lErr'), () => authService.login(name, pw));
  };
  registerForm.onsubmit = e => {
    e.preventDefault();
    const fullName = $('#rName').value.trim(), nickname = $('#rNick').value.trim(), password = $('#rPass').value, err = $('#rErr');
    if (fullName.length < 3) return void (err.textContent = 'Nama lengkap minimal 3 karakter.');
    if (nickname.length < 2) return void (err.textContent = 'Nama panggilan minimal 2 karakter.');
    if (password.length < 8) return void (err.textContent = 'Password minimal 8 karakter.');
    if (password !== $('#rPass2').value) return void (err.textContent = 'Konfirmasi password tidak sama.');
    run(registerForm, err, () => authService.register({ fullName, nickname, password }));
  };

  $('#forgotBtn').onclick = () => {
    loginForm.hidden = true; registerForm.hidden = true; resetForm.hidden = false;
    $('#tabLogin').classList.remove('on'); $('#tabRegister').classList.remove('on');
    $('#fName').value = $('#lName').value;
    $('#fErr').textContent = ''; $('#fName').focus();
  };
  $('#backLogin').onclick = () => showTab(true);
  
  resetForm.onsubmit = async e => {
    e.preventDefault();
    const name = $('#fName').value.trim(), pw = $('#fPass').value, err = $('#fErr');
    if (name.length < 3) return void (err.textContent = 'Isi nama lengkap akunmu.');
    if (pw.length < 8) return void (err.textContent = 'Password baru minimal 8 karakter.');
    if (pw !== $('#fPass2').value) return void (err.textContent = 'Konfirmasi password tidak sama.');
    const btn = resetForm.querySelector('button[type=submit]');
    btn.disabled = true; err.textContent = '';
    try {
      await authService.resetPassword(name, pw);
      ['#fPass', '#fPass2', '#lPass'].forEach(s => { const el = $(s); if(el) el.value = ''; });
      $('#lName').value = name; showTab(true); $('#lPass').focus();
      toast('Password diperbarui. Silakan masuk dengan password baru.');
    } catch (x) { err.textContent = x.message; }
    btn.disabled = false;
  };
  lucide.createIcons();
}

/* Start App */
initShell();
startReminders();
initAuth();
window.addEventListener("hashchange", route);
route();