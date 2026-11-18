// «Caisse» phone app: the money in and out of the agency, typed by hand (not linked to the files of the clients).
// One row per operation in the Supabase table "caisse" (supabase-caisse.sql); same login as «À faire».
// data: { id, sens: 'in' | 'out', cat, montant, date, mode, client, note, par, cree, by }
// An operation stays until someone deletes it (🗑, two taps): nothing goes away by itself.
(() => {
  const cfg = globalThis.AA_CONFIG;
  const sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } });
  const TABLE = 'caisse';
  // 🔄 Version of this app and what is new in it: the first phone that opens a new version tells the team on Telegram.
  const VERSION = '2026-11-18.1';
  const NOUVEAUTES = [
    '💰 أپليكاسيون جديدة «Caisse»: المداخيل والمصاريف ديال الوكالة، كتكتبوهم بيديكم (ماشي مربوطة بالدوسيات).',
    'كل عملية فيها: النوع، المبلغ بالدرهم، النهار، طريقة الخلاص، شكون كتبها (Bilal / Ahmed / Hmouri) وملاحظة.',
    'الفوق: شحال دخل، شحال خرج وشحال بقا فالشهر واليوم. وكاين ⬇ Excel ديال الشهر فـ ⋯.',
    'زيدوها للإيكران: حلو golden-zabaione-79fe0d.netlify.app/caisse/ ← ⋮ ← Ajouter à l\'écran d\'accueil.',
  ];
  const CATS = {
    in: [['rdv-es', '🇪🇸 RDV Espagne'], ['rdv-fr', '🇫🇷 RDV France'], ['vfs', '🛂 VFS'], ['reservation', '🏨 Réservation'],
      ['formulaire', '📄 Formulaire'], ['traduction', '📝 Traduction'], ['divers-in', '➕ Divers']],
    out: [['achat-rdv', '🎫 Achat RDV'], ['frais-vfs', '🛂 Frais VFS'], ['traducteur', '📝 Traducteur'], ['loyer', '🏠 Loyer'],
      ['charges', '💡 Électricité / Internet'], ['salaires', '👥 Salaires'], ['fournitures', '🖨 Fournitures'], ['divers-out', '➖ Divers']],
  };
  const MODES = [['especes', '💵 Espèces'], ['virement', '🏦 Virement'], ['carte', '💳 Carte'], ['cheque', '🧾 Chèque']];
  const PEOPLE = ['Bilal', 'Ahmed', 'Hmouri'];
  const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

  const $ = s => document.querySelector(s);
  const el = (tag, props = {}, ...kids) => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids.filter(k => k != null && k !== false && k !== ''));
    return e;
  };
  const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const money = n => `${Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} DH`;
  const amount = v => {
    const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined;
  };
  const catLabel = (sens, cat) => (CATS[sens] || []).find(([k]) => k === cat)?.[1] || cat || '—';
  const modeLabel = m => MODES.find(([k]) => k === m)?.[1] || m || '';
  const dayTitle = iso => {
    const d = new Date(iso + 'T12:00:00');
    const t = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    return iso === ymd() ? "Aujourd'hui · " + t : iso === ymd(new Date(Date.now() - 864e5)) ? 'Hier · ' + t : t;
  };
  function toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { t.className = 'toast'; }, 2600);
  }

  let me = '', rows = [], loaded = false, cur = null, armed = false;
  const now = new Date();
  const ui = { month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, sens: '', cat: '', par: '', q: '' };
  const lastPar = () => localStorage.getItem('caisse-par') || '';
  const people = () => [...new Set([...PEOPLE, ...JSON.parse(localStorage.getItem('caisse-people') || '[]'), ...rows.map(r => r.par).filter(Boolean)])];

  // ---- Data ----
  async function load() {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(TABLE).select('id,data').range(from, from + 999);
      if (error) {
        toast(/caisse/.test(error.message || '') ? 'Tableau «caisse» absent : lancez supabase-caisse.sql dans Supabase' : 'Pas de connexion : ' + error.message, true);
        if (!loaded) $('#list').replaceChildren(el('p', { className: 'empty', textContent: error.message }));
        return;
      }
      out.push(...data.map(r => ({ ...r.data, id: r.id })));
      if (data.length < 1000) break;
    }
    rows = out;
    loaded = true;
    render();
  }
  let channel = null;
  function live() {
    if (channel) return;
    channel = sb.channel('caisse-mobile').on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, p => {
      const id = p.new?.id || p.old?.id;
      if (!id) return;
      rows = p.eventType === 'DELETE' ? rows.filter(r => r.id !== id) : [...rows.filter(r => r.id !== id), { ...(p.new.data || {}), id }];
      render();
    }).subscribe();
  }

  // ---- List ----
  const inMonth = r => (r.date || '').startsWith(ui.month);
  function filtered() {
    const q = norm(ui.q.trim());
    return rows.filter(r => inMonth(r) && (!ui.sens || r.sens === ui.sens) && (!ui.cat || r.cat === ui.cat) && (!ui.par || r.par === ui.par)
      && (!q || norm(`${catLabel(r.sens, r.cat)} ${r.client} ${r.note} ${r.par} ${r.montant}`).includes(q)))
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.cree || 0) - (a.cree || 0));
  }
  const total = (list, sens) => list.filter(r => r.sens === sens).reduce((s, r) => s + (+r.montant || 0), 0);

  function render() {
    const [y, m] = ui.month.split('-').map(Number);
    $('#month').textContent = `${MONTHS[m - 1]} ${y}`;
    const month = rows.filter(inMonth), today = rows.filter(r => r.date === ymd());
    const tin = total(month, 'in'), tout = total(month, 'out'), din = total(today, 'in'), dout = total(today, 'out');
    $('#sum').replaceChildren(
      el('div', { className: 'in' }, el('span', { textContent: 'Entrées' }), el('b', { textContent: money(tin) })),
      el('div', { className: 'out' }, el('span', { textContent: 'Sorties' }), el('b', { textContent: money(tout) })),
      el('div', { className: 'net' + (tin - tout < 0 ? ' neg' : '') }, el('span', { textContent: 'Reste' }), el('b', { textContent: money(tin - tout) })),
      ui.month === ymd().slice(0, 7) ? el('p', { className: 'todayline' }, "Aujourd'hui : ", el('b', { className: 'pin', textContent: '+' + money(din) }), '  ', el('b', { className: 'pout', textContent: '−' + money(dout) })) : null);
    if (!loaded) return $('#list').replaceChildren(el('p', { className: 'empty', textContent: 'Chargement…' }));

    const q = el('input', { type: 'search', className: 'search', placeholder: 'Chercher : client, note, montant…', value: ui.q });
    q.oninput = () => { ui.q = q.value; drawList(); };
    const chip = (on, text, fn, cls = '') => el('button', { type: 'button', className: 'chip' + (on ? ' on' : '') + cls, textContent: text, onclick: fn });
    const sensRow = el('div', { className: 'chips' },
      chip(!ui.sens, 'Tout', () => { ui.sens = ''; ui.cat = ''; render(); }),
      chip(ui.sens === 'in', '＋ Entrées', () => { ui.sens = 'in'; ui.cat = ''; render(); }, ' in'),
      chip(ui.sens === 'out', '－ Sorties', () => { ui.sens = 'out'; ui.cat = ''; render(); }, ' out'));
    const used = new Set(month.map(r => r.sens + ':' + r.cat));
    const cats = (ui.sens ? [ui.sens] : ['in', 'out']).flatMap(s => CATS[s].map(([k, t]) => [s, k, t]))
      .concat(month.filter(r => !CATS[r.sens]?.some(([k]) => k === r.cat)).map(r => [r.sens, r.cat, r.cat]))
      .filter(([s, k], i, a) => used.has(s + ':' + k) && a.findIndex(x => x[0] === s && x[1] === k) === i);
    const catRow = cats.length ? el('div', { className: 'chips scroll' }, chip(!ui.cat, 'Toutes catégories', () => { ui.cat = ''; render(); }),
      ...cats.map(([, k, t]) => chip(ui.cat === k, t, () => { ui.cat = ui.cat === k ? '' : k; render(); }))) : null;
    const parRow = el('div', { className: 'chips' }, chip(!ui.par, '👥 Tous', () => { ui.par = ''; render(); }),
      ...people().map(p => chip(ui.par === p, p, () => { ui.par = ui.par === p ? '' : p; render(); })));
    const box = el('div', { className: 'ops' });
    $('#list').replaceChildren(q, sensRow, catRow, parRow, box);
    drawList();

    function drawList() {
      const list = filtered();
      if (!list.length) return box.replaceChildren(el('p', { className: 'empty', textContent: rows.length ? 'Aucune opération pour ce choix.' : 'Aucune opération. Touchez ＋ Entrée ou － Sortie.' }));
      const sel = list.length !== month.length ? el('p', { className: 'selsum' }, `${list.length} opération${list.length > 1 ? 's' : ''} · `,
        el('b', { className: 'pin', textContent: '+' + money(total(list, 'in')) }), '  ', el('b', { className: 'pout', textContent: '−' + money(total(list, 'out')) })) : null;
      const days = [...new Set(list.map(r => r.date))];
      box.replaceChildren(sel || '', ...days.map(d => {
        const ops = list.filter(r => r.date === d);
        const net = total(ops, 'in') - total(ops, 'out');
        return el('section', { className: 'day' },
          el('h3', {}, el('span', { textContent: dayTitle(d) }), el('b', { className: net < 0 ? 'pout' : 'pin', textContent: (net < 0 ? '−' : '+') + money(Math.abs(net)) })),
          el('ul', {}, ...ops.map(row)));
      }));
    }
  }
  function row(r) {
    return el('li', {}, el('button', { type: 'button', className: 'op ' + r.sens, onclick: () => open(r) },
      el('span', { className: 'cat', textContent: catLabel(r.sens, r.cat) }),
      el('b', { className: 'amt', textContent: (r.sens === 'in' ? '+' : '−') + money(r.montant) }),
      el('span', { className: 'meta', textContent: [r.client && '👤 ' + r.client, r.note].filter(Boolean).join(' · ') || ' ' }),
      el('span', { className: 'by', textContent: [r.par && '✍️ ' + r.par, modeLabel(r.mode)].filter(Boolean).join('  ') })));
  }

  // ---- One operation ----
  function open(r, sens) {
    cur = r ? { ...r } : { sens, date: ymd(), mode: 'especes', par: lastPar() };
    armed = false;
    $('#op').hidden = false;
    document.body.classList.add('noscroll');
    try { history.pushState({ op: 1 }, ''); } catch { /* not important */ }
    draw();
  }
  function close(fromBack) {
    if (!cur) return;
    if (fromBack !== true && history.state?.op) { history.back(); return; }
    $('#op').hidden = true;
    document.body.classList.remove('noscroll');
    cur = null;
  }
  window.addEventListener('popstate', () => { if (cur) close(true); });

  function draw() {
    const d = cur, isNew = !d.id;
    const f = el('form', { className: 'form ' + d.sens, noValidate: true });
    const pick = (name, options, value, onPick) => {
      const wrap = el('div', { className: 'picks' });
      const paint = v => wrap.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
      wrap.append(...options.map(([k, t]) => el('button', { type: 'button', textContent: t, onclick: () => { f.dataset[name] = k; paint(k); onPick?.(k); } })));
      wrap.querySelectorAll('button').forEach((b, i) => { b.dataset.v = options[i][0]; });
      f.dataset[name] = value || '';
      paint(value || '');
      return wrap;
    };
    const sensToggle = el('div', { className: 'sens' },
      el('button', { type: 'button', className: d.sens === 'in' ? 'on in' : 'in', textContent: '＋ Entrée', onclick: () => { cur = { ...readForm(f), sens: 'in', cat: '' }; draw(); } }),
      el('button', { type: 'button', className: d.sens === 'out' ? 'on out' : 'out', textContent: '－ Sortie', onclick: () => { cur = { ...readForm(f), sens: 'out', cat: '' }; draw(); } }));
    const known = CATS[d.sens].some(([k]) => k === d.cat);
    const autre = el('input', { name: 'autre', placeholder: 'Autre catégorie (ex : Taxi, Café…)', value: d.cat && !known ? d.cat : '', autocomplete: 'off' });
    autre.oninput = () => { if (autre.value.trim()) { f.dataset.cat = ''; f.querySelectorAll('.cats button').forEach(b => b.classList.remove('on')); } };
    const cats = pick('cat', CATS[d.sens], known ? d.cat : '', () => { autre.value = ''; });
    cats.classList.add('cats');
    const pp = people();
    const addName = el('button', { type: 'button', className: 'plus', textContent: '＋', title: 'Ajouter un nom', onclick: () => {
      const n = (prompt('Nom de la personne :') || '').trim();
      if (!n) return;
      localStorage.setItem('caisse-people', JSON.stringify([...new Set([...JSON.parse(localStorage.getItem('caisse-people') || '[]'), n])]));
      cur = { ...readForm(f), par: n };
      draw();
    } });
    const parPick = pick('par', pp.map(p => [p, p]), d.par);
    parPick.append(addName);
    const del = isNew ? null : el('button', { type: 'button', className: 'del', textContent: '🗑 Supprimer', onclick: () => remove(del) });

    f.append(...[
      el('header', { className: 'phead' },
        el('button', { type: 'button', className: 'back', textContent: '←', ariaLabel: 'Retour', onclick: () => close() }),
        el('h2', { textContent: isNew ? (d.sens === 'in' ? 'Nouvelle entrée' : 'Nouvelle sortie') : 'Opération' })),
      sensToggle,
      el('label', { className: 'big' }, 'Montant (DH)', el('input', { name: 'montant', inputMode: 'decimal', value: d.montant ?? '', placeholder: '0', autocomplete: 'off' })),
      el('div', { className: 'field' }, el('span', { textContent: 'Catégorie' }), cats, autre),
      el('div', { className: 'two' },
        el('label', {}, 'Date', el('input', { name: 'date', type: 'date', value: d.date || ymd() })),
        el('label', {}, 'Paiement', el('select', { name: 'mode' }, ...MODES.map(([k, t]) => el('option', { value: k, textContent: t, selected: (d.mode || 'especes') === k }))))),
      el('div', { className: 'field' }, el('span', { textContent: 'Écrit par' }), parPick),
      el('label', {}, 'Client (optionnel)', el('input', { name: 'client', value: d.client || '', placeholder: 'Nom du client', autocomplete: 'off', autocapitalize: 'words' })),
      el('label', {}, 'Note', el('textarea', { name: 'note', rows: 2, value: d.note || '', placeholder: 'Ex : 2 RDV, payé en avance…' })),
      d.cree ? el('p', { className: 'added', textContent: `Ajoutée le ${new Date(d.cree).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}${d.by ? ' · ' + d.by.split('@')[0] : ''}` }) : null,
      el('div', { className: 'save' }, el('button', { type: 'submit', className: 'primary', textContent: isNew ? 'Enregistrer' : 'Enregistrer les changements' }), del),
    ].filter(Boolean));
    f.onsubmit = e => { e.preventDefault(); save(f); };
    $('#op').replaceChildren(f);
    if (isNew) setTimeout(() => f.elements.montant.focus(), 50);
  }
  function readForm(f) {
    const E = f.elements;
    return { ...cur, montant: E.montant.value, cat: f.dataset.cat || E.autre.value.trim(), date: E.date.value, mode: E.mode.value,
      par: f.dataset.par || '', client: E.client.value.trim(), note: E.note.value.trim() };
  }

  async function save(f) {
    const d = readForm(f);
    const montant = amount(d.montant);
    if (!montant) { toast('Tapez le montant', true); return f.elements.montant.focus(); }
    if (!d.cat) return toast('Choisissez la catégorie', true);
    if (!d.par) return toast('Choisissez qui écrit (Bilal, Ahmed, Hmouri…)', true);
    if (!d.date) return toast('Choisissez la date', true);
    const btn = f.querySelector('.save .primary');
    btn.disabled = true;
    const id = d.id || 'op' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const data = JSON.parse(JSON.stringify({ ...d, id, montant, client: d.client || undefined, note: d.note || undefined, cree: d.cree || Date.now(), by: d.by || me || undefined }));
    const { error } = await sb.from(TABLE).upsert({ id, data, updated_at: new Date().toISOString(), updated_by: me });
    if (error) { btn.disabled = false; return toast('Pas enregistré : ' + error.message, true); }
    localStorage.setItem('caisse-par', d.par);
    rows = [...rows.filter(r => r.id !== id), data];
    if (!data.date.startsWith(ui.month)) ui.month = data.date.slice(0, 7);
    toast(d.id ? '✓ Enregistré' : `✓ ${data.sens === 'in' ? 'Entrée' : 'Sortie'} de ${money(montant)} ajoutée`);
    close();
    render();
  }
  async function remove(btn) {
    if (!armed) {
      armed = true;
      btn.textContent = '🗑 Touchez encore pour supprimer';
      btn.classList.add('armed');
      setTimeout(() => { if (armed && btn.isConnected) { armed = false; btn.textContent = '🗑 Supprimer'; btn.classList.remove('armed'); } }, 3000);
      return;
    }
    const id = cur.id;
    const { error } = await sb.from(TABLE).delete().eq('id', id);
    if (error) return toast('Pas supprimé : ' + error.message, true);
    rows = rows.filter(r => r.id !== id);
    toast('Opération supprimée');
    close();
    render();
  }

  // ---- Excel (CSV with ; for Excel in French) of the month shown ----
  function exportMonth() {
    const list = rows.filter(inMonth).sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.cree || 0) - (b.cree || 0));
    if (!list.length) return toast('Aucune opération ce mois-ci', true);
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const num = n => String(n).replace('.', ',');
    const lines = [['Date', 'Type', 'Catégorie', 'Entrée (DH)', 'Sortie (DH)', 'Paiement', 'Écrit par', 'Client', 'Note'].map(cell).join(';'),
      ...list.map(r => [r.date.split('-').reverse().join('/'), r.sens === 'in' ? 'Entrée' : 'Sortie', catLabel(r.sens, r.cat).replace(/^\S+\s/, ''),
        r.sens === 'in' ? num(r.montant) : '', r.sens === 'out' ? num(r.montant) : '', modeLabel(r.mode).replace(/^\S+\s/, ''), r.par, r.client, r.note].map(cell).join(';')),
      ['', '', 'TOTAL', num(total(list, 'in')), num(total(list, 'out')), '', '', 'Reste', num(total(list, 'in') - total(list, 'out'))].map(cell).join(';')];
    const a = el('a', { href: URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })), download: `caisse-${ui.month}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
  }

  // ---- 🔄 Tell the team on Telegram about a new version (once, by the first phone that opens it) ----
  async function announce() {
    for (const table of ['clients_tls', 'clients']) {
      const { data: row } = await sb.from(table).select('data').eq('id', '__equipe__').maybeSingle();
      const cur = row?.data, tg = cur?.telegram;
      if (!tg?.botToken || !tg?.chatId) continue;
      if ((cur.majCaisse || '') >= VERSION) return;
      await new Promise(r => setTimeout(r, 3_000 + Math.random() * 20_000));
      const { data: again } = await sb.from(table).select('data').eq('id', '__equipe__').maybeSingle();
      const c2 = again?.data;
      if (!c2 || (c2.majCaisse || '') >= VERSION) return;
      const mark = v => sb.from(table).upsert({ id: '__equipe__', data: { ...c2, majCaisse: v }, updated_at: new Date().toISOString(), updated_by: me });
      if ((await mark(VERSION)).error) return;
      const text = `🔄 ميزاجور جديدة — Caisse 💰\n\n${NOUVEAUTES.map(l => '• ' + l).join('\n')}`;
      const ok = await fetch(`https://api.telegram.org/bot${encodeURIComponent(tg.botToken)}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: tg.chatId, text }),
      }).then(r => r.json()).then(j => j.ok).catch(() => false);
      if (!ok) await mark(c2.majCaisse);
      return;
    }
  }

  // ---- Start ----
  function shiftMonth(n) {
    const [y, m] = ui.month.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    ui.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    ui.cat = '';
    render();
  }
  $('#prev').onclick = () => shiftMonth(-1);
  $('#next').onclick = () => shiftMonth(1);
  $('#add-in').onclick = () => open(null, 'in');
  $('#add-out').onclick = () => open(null, 'out');
  $('#menu').onclick = () => { $('#menu-box').hidden = !$('#menu-box').hidden; };
  $('#export').onclick = () => { $('#menu-box').hidden = true; exportMonth(); };
  $('#logout').onclick = async () => { await sb.auth.signOut(); location.reload(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && cur) close(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && me) load(); });

  async function start(session) {
    me = session.user.email || '';
    $('#who').textContent = me;
    $('#login-view').hidden = true;
    $('#app-view').hidden = false;
    render();
    await load();
    live();
    announce().catch(() => {});
  }
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
