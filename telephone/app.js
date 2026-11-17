// «À faire» on the phone: the same daily tasks as the bar at the top of Autofill TLS and Autofill BLS.
// It reads and writes the team row (__equipe__ → data.tasks) of each extension's table in Supabase,
// so a task written here shows in the extensions within seconds, and the other way round.
// Task formats and automatic-task keys are the same as taches.js in the extensions: keep them in step.
// The «Clients» tab (clients.js) adds and edits client files the same way.
(() => {
  const TEAM = '__equipe__';
  const APPS = {
    tls: { table: 'clients_tls', bucket: 'fichiers-tls', fields: 'dossier,passeport,mobile,famille,etape,rdvDate,rdvHeure,tlsCree,manque,archive,pret,prix,paye,ajout' },
    bls: { table: 'clients', bucket: 'fichiers', fields: 'dossier,passeport,mobile,famille,reserve,lettre,pret,prix,paye,ajout' },
  };
  const DAY = 864e5;
  const $ = s => document.querySelector(s);
  const el = (tag, props = {}, ...kids) => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids.filter(k => k != null && k !== false));
    return e;
  };
  const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const plus = n => ymd(new Date(Date.now() + n * DAY));
  const frShort = iso => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '');
  const dayDiff = iso => Math.round((new Date(iso + 'T12:00:00') - new Date(new Date().toDateString() + ' 12:00')) / DAY);
  const daysLeft = iso => Math.ceil((new Date(iso + 'T12:00:00') - Date.now()) / DAY);
  const who = email => (email || '').split('@')[0];
  const name = c => `${c.prenom || ''} ${c.nom || ''}`.trim() || '(sans nom)';
  const label = c => `${c.num != null && c.num !== '' ? 'N°' + c.num + ' ' : ''}${name(c)}`;

  function toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = bad ? 'show bad' : 'show';
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (t.className = ''), 2600);
  }

  const cfg = globalThis.AA_CONFIG || {};
  const sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } });
  let me = '', app = 'tls', view = 'taches';
  try {
    app = localStorage.getItem('app') === 'bls' ? 'bls' : 'tls';
    view = ['clients', 'bilan'].includes(localStorage.getItem('view')) ? localStorage.getItem('view') : 'taches';
  } catch { /* private mode */ }
  const state = { tls: { tasks: [], clients: [], loaded: false }, bls: { tasks: [], clients: [], loaded: false } };
  const open = { later: false, done: false };

  // ---- Automatic tasks: same rules and keys as the extensions ----
  function tlsExpiry(created) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(created || '')) return '';
    const [y, m, d] = created.split('-').map(Number);
    const last = new Date(Date.UTC(y, m - 1 + 3 + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m - 1 + 3, Math.min(d, last))).toISOString().slice(0, 10);
  }
  const at = h => (h ? ' à ' + h : '');
  const AUTO = {
    tls(clients, today) {
      const out = [];
      for (const c of clients) {
        if (c.archive) continue;
        if (c.etape === 'rdv' && c.rdvDate) {
          const d = dayDiff(c.rdvDate);
          if (d === 0) out.push({ key: `rdv0:${c.id}:${c.rdvDate}`, icon: '🗓', rank: 1, time: c.rdvHeure, client: c, text: `RDV TLS aujourd'hui${at(c.rdvHeure)}` });
          if (d === 1) out.push({ key: `rdv1:${c.id}:${c.rdvDate}`, icon: '🗓', rank: 4, time: c.rdvHeure, client: c, text: `RDV TLS demain${at(c.rdvHeure)} : préparer le dossier` });
        }
        const e = tlsExpiry(c.tlsCree);
        if (e && daysLeft(e) <= 7) {
          const d = daysLeft(e);
          out.push({ key: `tls:${c.id}:${e}`, icon: '⏳', rank: d < 0 ? 2 : 5, client: c,
            text: d < 0 ? 'Compte TLS expiré : créer un nouveau compte' : `Compte TLS expire dans ${d} j : créer le nouveau` });
        }
        if (c.etape === 'manque') out.push({ key: `manque:${c.id}:${today}`, icon: '📎', rank: 6, client: c, text: `Relancer : il manque ${c.manque || 'des documents'}` });
      }
      return out;
    },
    bls(clients) {
      const out = [];
      for (const c of clients) {
        const day = c.reserve?.day;
        if (!day || c.lettre) continue;
        const d = dayDiff(day), time = c.reserve.time, selfie = c.reserve.face ? ' · selfie à faire' : '';
        if (d === 0) out.push({ key: `rdv0:${c.id}:${day}`, icon: '🗓', rank: 1, time, client: c, text: `RDV BLS aujourd'hui${at(time)}${selfie}` });
        else if (d === 1) out.push({ key: `rdv1:${c.id}:${day}`, icon: '🗓', rank: 4, time, client: c, text: `RDV BLS demain${at(time)} : préparer le dossier${selfie}` });
        else if (d > 1 && c.reserve.face) out.push({ key: `selfie:${c.id}:${day}`, icon: '🤳', rank: 5, client: c, text: `Selfie à faire avant le RDV du ${frShort(day)}` });
      }
      return out;
    },
  };

  function build(a) {
    const today = ymd(), { tasks, clients } = state[a];
    const byId = new Map(tasks.map(t => [t.id, t]));
    const rows = [];
    for (const x of AUTO[a](clients, today)) {
      const id = `auto:${x.key}`, t = byId.get(id);
      rows.push({ ...x, id, auto: true, day: today, done: !!t?.done && !t.deleted, doneBy: t?.doneBy });
    }
    for (const t of tasks) {
      if (t.deleted || t.id.startsWith('auto:')) continue;
      const day = t.day || today;
      rows.push({ id: t.id, text: t.text, client: clients.find(c => c.id === t.clientId), day, done: !!t.done, doneBy: t.doneBy, by: t.by,
        icon: '✎', rank: day < today ? 0 : day === today ? 3 : 9, late: !t.done && day < today });
    }
    rows.sort((x, y) => x.rank - y.rank || (x.time || '').localeCompare(y.time || '') || x.day.localeCompare(y.day));
    return {
      late: rows.filter(r => r.late),
      now: rows.filter(r => !r.done && !r.late && r.day <= today),
      later: rows.filter(r => !r.done && r.day > today).sort((x, y) => x.day.localeCompare(y.day)),
      done: rows.filter(r => r.done && (r.auto || r.day <= today)),
    };
  }

  // ---- Server ----
  async function loadClients(a) {
    const sel = ['id', 'prenom:data->>prenom', 'nom:data->>nom', 'num:data->>num',
      ...APPS[a].fields.split(',').map(f => `${f}:data->${f}`)].join(',');
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(APPS[a].table).select(sel).neq('id', TEAM).range(from, from + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) break;
    }
    state[a].clients = rows;
  }
  // What the lists need from a full client (realtime events carry the whole row).
  function pick(a, row) {
    const d = row.data || {}, o = { id: row.id, prenom: d.prenom ?? null, nom: d.nom ?? null, num: d.num ?? null };
    for (const f of APPS[a].fields.split(',')) o[f] = d[f] ?? null;
    return o;
  }
  async function loadTasks(a) {
    const { data, error } = await sb.from(APPS[a].table).select('data').eq('id', TEAM).maybeSingle();
    if (error) throw error;
    state[a].tasks = data?.data?.tasks || [];
  }
  async function load(a, withClients = true) {
    try {
      await Promise.all([loadTasks(a), withClients ? loadClients(a) : null]);
      state[a].loaded = true;
      status('');
    } catch (e) {
      status('Pas de connexion au serveur : ' + (e.message || e), true);
    }
    render();
  }

  // Old ticks and deletions go away after a while (same as the extensions).
  const prune = list => list.filter(t => {
    const age = Date.now() - (t.at || 0);
    if (t.deleted || t.id.startsWith('auto:')) return age < 30 * DAY;
    return !t.done || age < 14 * DAY;
  });
  // Read the team row, change the tasks, write it back: the team's other settings (Telegram…) stay as they are.
  async function change(a, fn) {
    const table = APPS[a].table;
    const { data: row, error } = await sb.from(table).select('data').eq('id', TEAM).maybeSingle();
    if (error) throw error;
    const cur = row?.data || {};
    const tasks = prune(fn([...(cur.tasks || [])]));
    const { error: e2 } = await sb.from(table).upsert({ id: TEAM, data: { ...cur, tasks }, updated_at: new Date().toISOString(), updated_by: me });
    if (e2) throw e2;
    state[a].tasks = tasks;
    render();
  }
  async function put(a, t) {
    const before = state[a].tasks;
    // Show it right away; the server confirms.
    state[a].tasks = [...before.filter(x => x.id !== t.id), { ...t, at: Date.now() }];
    render();
    try {
      await change(a, list => [...list.filter(x => x.id !== t.id), { ...t, at: Date.now() }]);
      return true;
    } catch (e) {
      state[a].tasks = before;
      render();
      toast('Pas enregistré : ' + (e.message || 'pas de connexion'), true);
      return false;
    }
  }

  // ---- Screen ----
  function status(msg, bad) {
    const s = $('#status');
    s.hidden = !msg;
    s.textContent = msg;
    s.classList.toggle('bad', !!bad);
  }

  function row(r) {
    const tick = el('button', {
      className: 'box', type: 'button', ariaLabel: r.done ? 'Remettre à faire' : 'Marquer fait', textContent: r.done ? '✓' : '',
      onclick: () => {
        const t = state[app].tasks.find(x => x.id === r.id) || { id: r.id };
        put(app, r.done ? { ...t, done: false, doneBy: undefined } : { ...t, done: true, doneBy: me || undefined })
          .then(ok => ok && !r.done && toast('✓ Fait'));
      },
    });
    const meta = [
      r.client ? el('button', { type: 'button', className: 'client', textContent: label(r.client), onclick: () => AFClients.open(r.client.id) }) : null,
      r.late ? el('span', { className: 'late', textContent: `en retard · ${frShort(r.day)}` }) : null,
      !r.late && !r.done && r.day > ymd() ? el('span', { textContent: r.day === plus(1) ? 'demain' : frShort(r.day) }) : null,
      r.done && r.doneBy ? el('span', { textContent: `fait par ${who(r.doneBy)}` }) : null,
      !r.done && r.by ? el('span', { textContent: `de ${who(r.by)}` }) : null,
    ].filter(Boolean);
    return el('li', { className: 'task' + (r.done ? ' done' : '') + (r.late ? ' is-late' : '') },
      tick,
      el('div', { className: 'main' },
        el('p', { className: 'text' }, el('span', { className: 'ico', textContent: r.icon }), ' ', r.text),
        meta.length ? el('p', { className: 'meta' }, ...meta) : null),
      r.auto ? null : el('button', {
        className: 'del', type: 'button', textContent: '✕', ariaLabel: 'Supprimer la tâche',
        onclick: () => { if (confirmDelete(r)) put(app, { id: r.id, deleted: true }).then(ok => ok && toast('Tâche supprimée')); },
      }));
  }
  // A second tap within 3 s confirms (no browser dialog).
  let armed = null;
  function confirmDelete(r) {
    if (armed === r.id) { armed = null; return true; }
    armed = r.id;
    toast('Touchez ✕ encore une fois pour supprimer');
    setTimeout(() => { if (armed === r.id) armed = null; }, 3000);
    return false;
  }

  function group(title, rows, cls = '') {
    return el('section', { className: 'group ' + cls },
      el('h2', {}, title, el('span', { className: 'count', textContent: String(rows.length) })),
      el('ul', {}, ...rows.map(row)));
  }

  function render() {
    document.body.dataset.app = app;
    const d = new Date();
    $('#today').textContent = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    for (const b of document.querySelectorAll('.switch button')) {
      const a = b.dataset.app, on = a === app;
      b.setAttribute('aria-selected', String(on));
      b.classList.toggle('on', on);
      const { late, now } = build(a);
      const n = late.length + now.length;
      const badge = b.querySelector('.n');
      badge.textContent = state[a].loaded && n ? String(n) : '';
      badge.classList.toggle('bad', late.length > 0);
    }
    for (const b of document.querySelectorAll('.nav button')) b.classList.toggle('on', b.dataset.view === view);
    $('#title').textContent = view === 'clients' ? 'Clients' : view === 'bilan' ? 'Bilan du mois' : "À faire aujourd'hui";
    $('#add').textContent = view === 'clients' ? '＋ Nouveau client' : '＋ Nouvelle tâche';
    $('#add').hidden = view === 'bilan';
    const list = $('#list');
    if (!state[app].loaded) { list.replaceChildren(el('p', { className: 'empty', textContent: 'Chargement…' })); return; }
    if (view === 'clients') return AFClients.render(list);
    if (view === 'bilan') return AFBilan.render(list);
    const { late, now, later, done } = build(app);
    const kids = [];
    if (late.length) kids.push(group('En retard', late, 'late'));
    if (now.length) kids.push(group("Aujourd'hui", now));
    if (!late.length && !now.length) kids.push(el('div', { className: 'empty' }, el('b', { textContent: 'Rien à faire aujourd\'hui.' }), el('span', { textContent: 'Ajoutez une tâche avec ＋, elle arrive tout de suite dans l\'extension.' })));
    const foot = [];
    if (later.length) foot.push(el('button', { type: 'button', className: open.later ? 'on' : '', textContent: `📅 Plus tard · ${later.length}`, onclick: () => { open.later = !open.later; render(); } }));
    if (done.length) foot.push(el('button', { type: 'button', className: open.done ? 'on' : '', textContent: `✓ Fait · ${done.length}`, onclick: () => { open.done = !open.done; render(); } }));
    if (foot.length) kids.push(el('div', { className: 'more' }, ...foot));
    if (open.later && later.length) kids.push(group('Plus tard', later, 'sub'));
    if (open.done && done.length) kids.push(group('Fait', done, 'sub'));
    list.replaceChildren(...kids);
  }

  // ---- New task sheet ----
  const form = $('#new');
  let pickedDay = ymd();
  function openSheet() {
    form.reset();
    pickedDay = ymd();
    form.day.value = '';
    for (const b of form.querySelectorAll('.days button')) b.classList.toggle('on', b.dataset.day === '0');
    form.querySelector('.for').textContent = app === 'tls' ? '· TLS France' : '· BLS Espagne';
    const clients = state[app].clients.filter(c => !c.archive)
      .sort((x, y) => (+x.num || 1e9) - (+y.num || 1e9) || name(x).localeCompare(name(y)));
    form.client.replaceChildren(el('option', { value: '', textContent: 'Client (optionnel)' }),
      ...clients.map(c => el('option', { value: c.id, textContent: label(c) })));
    $('#sheet').hidden = false;
    setTimeout(() => form.text.focus(), 50);
  }
  const closeSheet = () => { $('#sheet').hidden = true; };
  for (const b of form.querySelectorAll('.days button')) {
    b.onclick = () => {
      pickedDay = plus(+b.dataset.day);
      form.day.value = '';
      for (const x of form.querySelectorAll('.days button')) x.classList.toggle('on', x === b);
    };
  }
  form.day.onchange = () => {
    if (!form.day.value) return;
    pickedDay = form.day.value;
    for (const x of form.querySelectorAll('.days button')) x.classList.remove('on');
  };
  form.onsubmit = async e => {
    e.preventDefault();
    const text = form.text.value.trim();
    if (!text) return;
    closeSheet();
    const ok = await put(app, { id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, day: pickedDay, clientId: form.client.value || undefined, by: me || undefined });
    if (ok) toast('✓ Tâche envoyée à l\'équipe');
  };
  form.text.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } };
  for (const x of document.querySelectorAll('[data-close]')) x.onclick = closeSheet;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
  $('#add').onclick = () => (view === 'clients' ? AFClients.open(null) : openSheet());
  for (const b of document.querySelectorAll('.nav button')) {
    b.onclick = () => {
      view = b.dataset.view;
      try { localStorage.setItem('view', view); } catch { /* private mode */ }
      window.scrollTo(0, 0);
      render();
    };
  }

  for (const b of document.querySelectorAll('.switch button')) {
    b.onclick = () => {
      app = b.dataset.app;
      try { localStorage.setItem('app', app); } catch { /* private mode */ }
      open.later = open.done = false;
      render();
      if (!state[app].loaded) load(app);
    };
  }
  $('#menu').onclick = () => { $('#account').hidden = !$('#account').hidden; };
  $('#logout').onclick = async () => { await sb.auth.signOut(); location.reload(); };

  // Shared with clients.js
  globalThis.AF = {
    sb, APPS, TEAM, state, el, $, toast, ymd, frShort, dayDiff, daysLeft, tlsExpiry, name, label, pick, render,
    app: () => app, me: () => me,
  };

  // ---- Start ----
  let channel = null;
  function live() {
    if (channel) return;
    channel = sb.channel('a-faire-mobile');
    for (const [a, { table }] of Object.entries(APPS)) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, p => {
        const id = p.new?.id || p.old?.id;
        if (!id) return;
        if (id === TEAM) { if (p.new?.data) state[a].tasks = p.new.data.tasks || []; }
        else if (p.eventType === 'DELETE') state[a].clients = state[a].clients.filter(c => c.id !== id);
        else if (p.new?.data) state[a].clients = [...state[a].clients.filter(c => c.id !== id), pick(a, p.new)];
        render();
      });
    }
    channel.subscribe();
  }
  async function start(session) {
    me = session.user.email || '';
    $('#who').textContent = me;
    $('#login-view').hidden = true;
    $('#app-view').hidden = false;
    render();
    await load(app);
    live();
    load(app === 'tls' ? 'bls' : 'tls'); // the other tab's count
  }
  // Back on the app: refresh (clients may have changed on the PCs, the day may have changed).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && me) { load('tls'); load('bls'); }
  });

  $('#login').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('button');
    btn.disabled = true;
    $('#login-error').textContent = '';
    const { data, error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    btn.disabled = false;
    if (error) {
      $('#login-error').textContent = /invalid/i.test(error.message) ? 'Email ou mot de passe incorrect (le même que ☁ dans l\'extension).' : error.message;
      return;
    }
    start(data.session);
  };

  sb.auth.getSession().then(({ data }) => {
    if (data.session) start(data.session);
    else $('#login-view').hidden = false;
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
