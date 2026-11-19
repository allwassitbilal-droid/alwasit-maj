// «Traductions» app: the register of the documents the agency has translated, with the money of each one:
// price for the client and what he paid, cost of the translator and what we paid him, and the profit.
// Rows of the Supabase table "traductions" (the same documents as 📝 in the extensions and «À faire»);
// the row "__code__" is the team's 4-digit code (pin.js), not a document. Same login as «À faire» and «Caisse».
// data: { id, num, type, client, tel, de, vers, pages, traducteur, envoi, livraison, remise, etat,
//         prix, paye, cout, coutPaye, notes, cree, by }
(() => {
  const cfg = globalThis.AA_CONFIG;
  const sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } });
  const TABLE = 'traductions';
  // 🔄 Version of this app and what is new in it: the first phone that opens a new version tells the team on Telegram.
  const VERSION = '2026-11-19.1';
  const NOUVEAUTES = [
    '💲 Tarifs فـ Traductions: الثمن ديالنا لكل نوع ديال الوثيقة (عقود الزواج 300، شواهد الملكية 150…)، وحداه الثمن ديال المترجم.',
    'ملي كتختار النوع فالورقة، كيتعمر الثمن ديالنا والثمن ديال المترجم بوحدهم، والربح كيبان، والطوطال فـ Bilan.',
  ];
  const ETATS = { traducteur: '✍️ Chez le traducteur', bureau: '🏢 Au bureau', prete: '✅ Prête', remise: '📦 Remise au client' };
  // 💲 Prices of the agency by type of document (the list on paper), and the translator's price next to each one.
  // Kept in the row "__tarifs__" of the table; until it is saved once, this list is shown.
  const TARIFS0 = [['عقود الزواج', 300], ['عقود الطلاق', 300], ['عقود الشراء العدلية', 350], ['شواهد الملكية', 150], ['رخصة البناية', 150],
    ['عقود الكراء', 200], ['الشواهد الفلاحية', 150], ['القرار العاملي TAXI', 200], ['السجل التجاري', 200], ['عقد كراء المأذونية', 250],
    ['المأذونية (الكريمة)', 250], ['الشواهد الإدارية', 150], ['نسخة كاملة', 200], ['شواهد العزوبة', 150], ['توكيل', 200], ['Model 7', 300]]
    .map(([nom, prix]) => ({ nom, prix }));
  let tarifs = TARIFS0, tarifsSaved = false;
  const tarifOf = type => tarifs.find(t => norm(t.nom) === norm(type));
  const TYPES = ['Acte de naissance', 'Copie intégrale', 'Fiche anthropométrique (casier)', 'Certificat de résidence', 'Attestation de travail',
    'Bulletins de paie', 'Relevé bancaire', 'Attestation de scolarité', 'Diplôme', 'Relevé de notes', 'Acte de mariage', 'Livret de famille',
    'Certificat de vie individuelle', 'Registre de commerce', 'Attestation CNSS', 'Contrat de travail', 'Permis de conduire', 'Jugement'];
  const LANGUES = ['Arabe', 'Français', 'Espagnol', 'Anglais', 'Allemand', 'Italien', 'Néerlandais', 'Portugais'];
  const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

  const $ = s => document.querySelector(s);
  const el = (tag, props = {}, ...kids) => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids.filter(k => k != null && k !== false && k !== ''));
    return e;
  };
  const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const fr = iso => (iso ? iso.split('-').reverse().join('/') : '');
  const money = n => `${Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} DH`;
  const amount = v => {
    const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
  };
  const r2 = n => Math.round(n * 100) / 100;
  // Money of one document
  const calc = d => {
    const prix = amount(d.prix), cout = amount(d.cout);
    return {
      prix: prix || 0, paye: amount(d.paye) || 0, reste: prix === undefined ? 0 : Math.max(0, r2(prix - (amount(d.paye) || 0))),
      cout: cout || 0, coutPaye: amount(d.coutPaye) || 0, doit: cout === undefined ? 0 : Math.max(0, r2(cout - (amount(d.coutPaye) || 0))),
      // profit only when both prices are written (an empty translator price would show the whole price as profit)
      benef: prix === undefined || cout === undefined ? null : r2(prix - cout), hasPrix: prix !== undefined, hasCout: cout !== undefined,
    };
  };
  const langs = d => [d.de, d.vers].filter(Boolean).join(' → ');
  const late = d => d.livraison && d.etat !== 'remise' && d.livraison < ymd();
  const dayOf = d => (d.cree ? ymd(new Date(d.cree)) : d.envoi || '');
  function toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { t.className = 'toast'; }, 2600);
  }

  let me = '', rows = [], loaded = false, cur = null, armed = false;
  const now = new Date();
  const ui = {
    view: ['registre', 'traducteurs', 'bilan', 'tarifs'].includes(localStorage.getItem('trad-view')) ? localStorage.getItem('trad-view') : 'registre',
    q: '', etat: '', argent: '', trad: '', period: 'month', month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  };

  // ---- Data ----
  const isDoc = id => !String(id).startsWith('__');
  async function load() {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(TABLE).select('id,data').range(from, from + 999);
      if (error) {
        toast('Pas de connexion : ' + error.message, true);
        if (!loaded) $('#list').replaceChildren(el('p', { className: 'empty', textContent: error.message }));
        return;
      }
      const t = data.find(r => r.id === '__tarifs__');
      if (t?.data?.items) { tarifs = t.data.items; tarifsSaved = true; }
      out.push(...data.filter(r => isDoc(r.id)).map(r => ({ ...r.data, id: r.id })));
      if (data.length < 1000) break;
    }
    rows = out;
    loaded = true;
    await numberOld();
    render();
  }
  let channel = null;
  function live() {
    if (channel) return;
    channel = sb.channel('traductions-app').on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, p => {
      const id = p.new?.id || p.old?.id;
      if (id === '__tarifs__' && p.new?.data?.items) { tarifs = p.new.data.items; tarifsSaved = true; if (ui.view === 'tarifs' && !cur) render(); return; }
      if (!id || !isDoc(id)) return;
      rows = p.eventType === 'DELETE' ? rows.filter(r => r.id !== id) : [...rows.filter(r => r.id !== id), { ...(p.new.data || {}), id }];
      if (!cur) render();
    }).subscribe();
  }
  const put = async data => {
    const { error } = await sb.from(TABLE).upsert({ id: data.id, data, updated_at: new Date().toISOString(), updated_by: me });
    if (error) throw error;
  };
  // N° in the register: T-<year>-0001, the next free one of the year
  const nextNum = year => {
    const max = rows.reduce((m, r) => { const x = /^T-(\d{4})-(\d+)$/.exec(r.num || ''); return x && x[1] === year ? Math.max(m, +x[2]) : m; }, 0);
    return `T-${year}-${String(max + 1).padStart(4, '0')}`;
  };
  // Documents written before this app (📝) get their N° once, in the order they were added.
  async function numberOld() {
    const todo = rows.filter(r => !r.num).sort((a, b) => (a.cree || 0) - (b.cree || 0));
    for (const d of todo) {
      const y = String(new Date(d.cree || Date.now()).getFullYear());
      const data = { ...d, num: nextNum(y) };
      try { await put(data); rows = [...rows.filter(r => r.id !== d.id), data]; } catch { return; }
    }
  }

  // ---- Screens ----
  function setView(v) {
    ui.view = v;
    localStorage.setItem('trad-view', v);
    window.scrollTo(0, 0);
    render();
  }
  document.querySelectorAll('.tabs button').forEach(b => { b.onclick = () => setView(b.dataset.v); });

  function render() {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === ui.view));
    $('#title').textContent = { registre: 'Registre', traducteurs: 'Traducteurs', bilan: 'Bilan', tarifs: 'Tarifs' }[ui.view];
    $('#add').hidden = ui.view !== 'registre';
    if (!loaded) { $('#sum').replaceChildren(); return $('#list').replaceChildren(el('p', { className: 'empty', textContent: 'Chargement…' })); }
    if (ui.view === 'registre') registre();
    else if (ui.view === 'traducteurs') traducteurs();
    else if (ui.view === 'tarifs') tarifsView();
    else bilan();
  }
  const totals = list => list.reduce((t, d) => {
    const c = calc(d);
    t.n++; t.pages += +d.pages || 0; t.prix += c.prix; t.paye += c.paye; t.reste += c.reste; t.cout += c.cout; t.coutPaye += c.coutPaye; t.doit += c.doit;
    if (c.benef !== null) t.benef += c.benef;
    return t;
  }, { n: 0, pages: 0, prix: 0, paye: 0, reste: 0, cout: 0, coutPaye: 0, doit: 0, benef: 0 });
  const kpi = (label, value, cls = '') => el('div', { className: cls }, el('span', { textContent: label }), el('b', { textContent: value }));
  const chip = (on, text, fn, cls = '') => el('button', { type: 'button', className: 'chip' + (on ? ' on' : '') + cls, textContent: text, onclick: fn });

  // 📒 Registre
  function registre() {
    const t = totals(rows);
    $('#sub').textContent = `${rows.length} document${rows.length > 1 ? 's' : ''} · ${rows.filter(d => d.etat !== 'remise').length} en cours`;
    $('#sum').replaceChildren(kpi('Reste clients', money(t.reste), t.reste ? 'out' : ''), kpi('À payer traducteurs', money(t.doit), t.doit ? 'warn' : ''),
      kpi('Bénéfice total', money(t.benef), 'net' + (t.benef < 0 ? ' neg' : '')));
    const q = el('input', { type: 'search', className: 'search', placeholder: 'Chercher : N°, client, document, traducteur…', value: ui.q });
    q.oninput = () => { ui.q = q.value; draw(); };
    const etats = el('div', { className: 'chips scroll' }, chip(!ui.etat, 'Tous', () => { ui.etat = ''; registre(); }),
      chip(ui.etat === 'cours', 'En cours', () => { ui.etat = ui.etat === 'cours' ? '' : 'cours'; registre(); }),
      ...Object.entries(ETATS).map(([k, l]) => chip(ui.etat === k, l, () => { ui.etat = ui.etat === k ? '' : k; registre(); })),
      chip(ui.etat === 'retard', '⏰ En retard', () => { ui.etat = ui.etat === 'retard' ? '' : 'retard'; registre(); }));
    const argent = el('div', { className: 'chips' },
      chip(ui.argent === 'client', '💰 Client doit', () => { ui.argent = ui.argent === 'client' ? '' : 'client'; registre(); }),
      chip(ui.argent === 'trad', '✍️ On doit au traducteur', () => { ui.argent = ui.argent === 'trad' ? '' : 'trad'; registre(); }),
      ui.trad ? chip(true, '👤 ' + ui.trad + '  ✕', () => { ui.trad = ''; registre(); }) : null);
    const box = el('div', { className: 'docs' });
    $('#list').replaceChildren(q, etats, argent, box);
    draw();
    function draw() {
      const s = norm(ui.q.trim());
      let list = rows;
      if (ui.etat === 'cours') list = list.filter(d => d.etat !== 'remise');
      else if (ui.etat === 'retard') list = list.filter(late);
      else if (ui.etat) list = list.filter(d => d.etat === ui.etat);
      if (ui.argent === 'client') list = list.filter(d => calc(d).reste > 0);
      if (ui.argent === 'trad') list = list.filter(d => calc(d).doit > 0);
      if (ui.trad) list = list.filter(d => (d.traducteur || '—') === ui.trad);
      if (s) list = list.filter(d => norm(`${d.num} ${d.client} ${d.tel} ${d.type} ${d.de} ${d.vers} ${d.traducteur} ${d.notes}`).includes(s));
      list = [...list].sort((a, b) => (b.cree || 0) - (a.cree || 0));
      box.replaceChildren(
        el('p', { className: 'selsum', textContent: `${list.length} document${list.length > 1 ? 's' : ''}` }),
        ...(list.length ? list.slice(0, 400).map(card) : [el('p', { className: 'empty', textContent: rows.length ? 'Aucun document pour ce choix.' : 'Aucun document. Touchez ＋ Nouveau document.' })]));
    }
  }
  function card(d) {
    const c = calc(d);
    return el('button', { type: 'button', className: 'doc-card', onclick: () => open(d) },
      el('span', { className: 'dc-top' }, el('b', { className: 'dc-num', textContent: d.num || '…' }), el('span', { className: 'dc-etat ' + (d.etat || ''), textContent: ETATS[d.etat] || '' })),
      el('span', { className: 'dc-type', textContent: d.type || '(type ?)' }),
      el('span', { className: 'dc-meta', textContent: [d.client && '👤 ' + d.client, langs(d) && '🌐 ' + langs(d), d.pages && `📄 ${d.pages} p.`].filter(Boolean).join('   ') }),
      d.traducteur || d.envoi || d.livraison || d.remise ? el('span', { className: 'dc-meta', textContent: [d.traducteur && '✍️ ' + d.traducteur, d.envoi && '📤 ' + fr(d.envoi).slice(0, 5),
        d.livraison && d.etat !== 'remise' && (late(d) ? '⏰ en retard ' : '📅 pour le ') + fr(d.livraison).slice(0, 5), d.remise && '📦 remis ' + fr(d.remise).slice(0, 5)].filter(Boolean).join('   ') }) : null,
      el('span', { className: 'dc-money' },
        c.hasPrix ? el('span', { textContent: `Prix ${money(c.prix)}` }) : el('span', { className: 'muted', textContent: 'Prix ?' }),
        c.reste > 0 ? el('span', { className: 'bad', textContent: `client doit ${money(c.reste)}` }) : c.hasPrix ? el('span', { className: 'ok', textContent: '✓ payé' }) : null,
        c.doit > 0 ? el('span', { className: 'warn', textContent: `traducteur ${money(c.doit)}` }) : null,
        c.benef !== null ? el('b', { className: c.benef < 0 ? 'bad' : 'ok', textContent: `Bénéfice ${money(c.benef)}` }) : null));
  }

  // 👤 Traducteurs
  function traducteurs() {
    const names = [...new Set(rows.map(d => d.traducteur || '—'))];
    const stats = names.map(n => ({ n, list: rows.filter(d => (d.traducteur || '—') === n) })).map(x => ({ ...x, t: totals(x.list) }))
      .sort((a, b) => b.t.doit - a.t.doit || b.t.n - a.t.n);
    const all = totals(rows);
    $('#sub').textContent = `${names.filter(n => n !== '—').length} traducteur${names.length > 1 ? 's' : ''}`;
    $('#sum').replaceChildren(kpi('Coût total', money(all.cout)), kpi('Déjà payé', money(all.coutPaye), 'in'), kpi('Reste à payer', money(all.doit), all.doit ? 'warn' : ''));
    $('#list').replaceChildren(...(stats.length ? stats.map(({ n, list, t }) => el('button', { type: 'button', className: 'tr-card', onclick: () => { ui.trad = n; ui.etat = ''; ui.argent = ''; setView('registre'); } },
      el('span', { className: 'dc-top' }, el('b', { className: 'tr-name', textContent: n === '—' ? 'Sans traducteur' : '✍️ ' + n }), t.doit > 0 ? el('b', { className: 'warn', textContent: `on lui doit ${money(t.doit)}` }) : el('span', { className: 'ok', textContent: '✓ rien à payer' })),
      el('span', { className: 'dc-meta', textContent: `${t.n} document${t.n > 1 ? 's' : ''} · ${t.pages} pages · ${list.filter(d => d.etat === 'traducteur').length} chez lui maintenant` }),
      el('span', { className: 'dc-money' }, el('span', { textContent: `Coût ${money(t.cout)}` }), el('span', { textContent: `payé ${money(t.coutPaye)}` }), el('b', { className: 'ok', textContent: `Bénéfice ${money(t.benef)}` }))))
      : [el('p', { className: 'empty', textContent: 'Aucun document pour l\'instant.' })]));
  }

  // 💲 Tarifs: our price and the translator's price for each type of document. Typing the type in a document fills both.
  function tarifsView() {
    $('#sub').textContent = `${tarifs.length} types de documents`;
    const withCout = tarifs.filter(t => amount(t.cout) !== undefined).length;
    $('#sum').replaceChildren(kpi('Types', String(tarifs.length)), kpi('Avec prix traducteur', `${withCout} / ${tarifs.length}`, withCout < tarifs.length ? 'warn' : 'in'),
      kpi('Enregistré', tarifsSaved ? '✓ oui' : 'pas encore', tarifsSaved ? 'in' : 'warn'));
    const list = tarifs.map(t => ({ ...t }));
    const body = el('div', { className: 'tarifs' });
    const benef = t => { const a = amount(t.prix), b = amount(t.cout); return a === undefined || b === undefined ? '' : money(r2(a - b)); };
    const draw = () => body.replaceChildren(
      el('div', { className: 'tf-row tf-head' }, el('span', { textContent: 'Document' }), el('span', { textContent: 'Notre prix' }), el('span', { textContent: 'Prix traducteur' }), el('span', { textContent: 'Bénéfice' }), el('span')),
      ...list.map((t, i) => {
        const b = el('b', { className: 'ok', textContent: benef(t) });
        const f = (k, ph, mode) => { const x = el('input', { value: t[k] ?? '', placeholder: ph, inputMode: mode || 'text', autocomplete: 'off' }); x.oninput = () => { t[k] = x.value; b.textContent = benef(t); }; return x; };
        return el('div', { className: 'tf-row' }, f('nom', 'Type de document'), f('prix', 'DH', 'decimal'), f('cout', 'DH', 'decimal'), b,
          el('button', { type: 'button', className: 'tf-del', textContent: '✕', ariaLabel: 'Enlever cette ligne', onclick: () => { list.splice(i, 1); draw(); } }));
      }));
    draw();
    $('#list').replaceChildren(
      el('p', { className: 'rhint dark', textContent: 'Notre prix = ce que paie le client. Prix traducteur = ce qu\'on paie au traducteur. Dans un document, choisir le type remplit les deux.' }),
      body,
      el('button', { type: 'button', className: 'ghost', textContent: '＋ Ajouter un type de document', onclick: () => { list.push({ nom: '', prix: '' }); draw(); body.lastChild.querySelector('input').focus(); } }),
      el('button', { type: 'button', className: 'primary', textContent: 'Enregistrer les tarifs', onclick: async e => {
        const items = list.map(t => ({ nom: String(t.nom || '').trim(), prix: amount(t.prix), cout: amount(t.cout) })).filter(t => t.nom)
          .map(t => JSON.parse(JSON.stringify(t)));
        e.target.disabled = true;
        const { error } = await sb.from(TABLE).upsert({ id: '__tarifs__', data: { items, at: Date.now(), by: me }, updated_at: new Date().toISOString(), updated_by: me });
        e.target.disabled = false;
        if (error) return toast('Pas enregistré : ' + error.message, true);
        tarifs = items; tarifsSaved = true;
        toast('✓ Tarifs enregistrés (pour toute l\'équipe)');
        tarifsView();
      } }));
  }

  // 📊 Bilan (month or year, by the day the document was added)
  const inPeriod = d => dayOf(d).startsWith(ui.period === 'year' ? ui.month.slice(0, 4) : ui.month);
  const periodTitle = () => { const [y, m] = ui.month.split('-').map(Number); return ui.period === 'year' ? `Année ${y}` : `${MONTHS[m - 1]} ${y}`; };
  function shift(n) {
    const [y, m] = ui.month.split('-').map(Number);
    const d = ui.period === 'year' ? new Date(y + n, m - 1, 1) : new Date(y, m - 1 + n, 1);
    ui.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    bilan();
  }
  const groupBy = (list, key) => {
    const g = new Map();
    for (const d of list) { const k = key(d) || '—'; g.set(k, [...(g.get(k) || []), d]); }
    return [...g.entries()].map(([k, l]) => [k, totals(l)]).sort((a, b) => b[1].prix - a[1].prix);
  };
  function bilan() {
    const list = rows.filter(inPeriod), t = totals(list);
    $('#sub').textContent = `${t.n} document${t.n > 1 ? 's' : ''} · ${t.pages} pages`;
    $('#sum').replaceChildren(kpi('Prix clients', money(t.prix), 'in'), kpi('Coût traducteurs', money(t.cout), 'out'), kpi('Bénéfice', money(t.benef), 'net' + (t.benef < 0 ? ' neg' : '')));
    const table = (head, body) => el('table', { className: 'btable' }, el('thead', {}, el('tr', {}, ...head.map(h => el('th', { textContent: h })))),
      el('tbody', {}, ...body.map(r => el('tr', {}, ...r.map((c, i) => el('td', { textContent: c, className: i ? 'n' : '' }))))));
    const grp = (title, key) => { const g = groupBy(list, key); return g.length ? el('section', { className: 'bsec' }, el('h3', { textContent: title }),
      table(['', 'Docs', 'Prix', 'Bénéfice'], g.map(([k, x]) => [k, String(x.n), money(x.prix), money(x.benef)]))) : null; };
    $('#list').replaceChildren(
      el('div', { className: 'period' },
        el('div', { className: 'chips' }, chip(ui.period === 'month', 'Mois', () => { ui.period = 'month'; bilan(); }), chip(ui.period === 'year', 'Année', () => { ui.period = 'year'; bilan(); })),
        el('div', { className: 'month' }, el('button', { type: 'button', textContent: '‹', onclick: () => shift(-1) }), el('b', { textContent: periodTitle() }), el('button', { type: 'button', textContent: '›', onclick: () => shift(1) }))),
      el('section', { className: 'bsec' }, el('h3', { textContent: 'Argent' }), table(['', 'Montant'], [
        ['Prix total (clients)', money(t.prix)], ['Encaissé des clients', money(t.paye)], ['Reste chez les clients', money(t.reste)],
        ['Coût des traducteurs', money(t.cout)], ['Payé aux traducteurs', money(t.coutPaye)], ['Reste à payer aux traducteurs', money(t.doit)],
        ['Bénéfice (prix − coût)', money(t.benef)]])),
      grp('Par traducteur', d => d.traducteur),
      grp('Par type de document', d => d.type),
      grp('Par langue', d => langs(d)),
      el('div', { className: 'bact' },
        el('button', { type: 'button', className: 'primary', textContent: '📄 Rapport PDF', onclick: () => report() }),
        el('button', { type: 'button', className: 'ghost', textContent: '⬇ Excel', onclick: () => excel() })));
  }

  // ---- One document ----
  function open(d) {
    cur = d ? { ...d } : { etat: 'traducteur', de: 'Arabe', vers: 'Français', envoi: ymd() };
    armed = false;
    $('#doc').hidden = false;
    document.body.classList.add('noscroll');
    try { history.pushState({ doc: 1 }, ''); } catch { /* not important */ }
    form();
  }
  function close(fromBack) {
    if (!cur) return;
    if (fromBack !== true && history.state?.doc) { history.back(); return; }
    $('#doc').hidden = true;
    document.body.classList.remove('noscroll');
    cur = null;
    render();
  }
  window.addEventListener('popstate', () => { if (cur) close(true); });
  const lab = (t, input, cls) => el('label', { className: cls || '' }, t, input);
  const inp = (name, value, { list, ...props } = {}) => {
    const i = el('input', { name, value: value ?? '', autocomplete: 'off', ...props });
    if (list) i.setAttribute('list', list); // read-only as a property
    return i;
  };
  function form() {
    const d = cur, isNew = !d.id;
    const f = el('form', { className: 'form tform', noValidate: true });
    const etat = el('select', { name: 'etat' }, ...Object.entries(ETATS).map(([k, t]) => el('option', { value: k, textContent: t, selected: (d.etat || 'traducteur') === k })));
    const prix = inp('prix', d.prix, { inputMode: 'decimal', placeholder: 'ex : 300' }), paye = inp('paye', d.paye, { inputMode: 'decimal', placeholder: '0' });
    const cout = inp('cout', d.cout, { inputMode: 'decimal', placeholder: 'ex : 180' }), coutPaye = inp('coutPaye', d.coutPaye, { inputMode: 'decimal', placeholder: '0' });
    const res = el('div', { className: 'tres' });
    const sync = () => {
      const c = calc({ prix: prix.value, paye: paye.value, cout: cout.value, coutPaye: coutPaye.value });
      res.replaceChildren(
        el('div', {}, el('span', { textContent: 'Client doit' }), el('b', { className: c.reste ? 'bad' : 'ok', textContent: c.hasPrix ? money(c.reste) : '—' })),
        el('div', {}, el('span', { textContent: 'On doit au traducteur' }), el('b', { className: c.doit ? 'warn' : 'ok', textContent: c.hasCout ? money(c.doit) : '—' })),
        el('div', { className: 'big' }, el('span', { textContent: 'Bénéfice' }), el('b', { className: c.benef < 0 ? 'bad' : 'ok', textContent: c.benef === null ? '—' : money(c.benef) })));
    };
    prix.oninput = paye.oninput = cout.oninput = coutPaye.oninput = sync;
    const all = (from, to) => el('button', { type: 'button', className: 'mini', textContent: 'Tout payé', onclick: () => { const v = amount(from.value); if (v === undefined) return from.focus(); to.value = v; sync(); } });
    const names = [...new Set(rows.map(r => r.traducteur).filter(Boolean))].sort();
    const clients = [...new Set(rows.map(r => r.client).filter(Boolean))].sort();
    const del = isNew ? null : el('button', { type: 'button', className: 'del', textContent: '🗑 Supprimer ce document', onclick: () => remove(del) });
    f.append(...[
      el('header', { className: 'phead' },
        el('button', { type: 'button', className: 'back', textContent: '←', ariaLabel: 'Retour', onclick: () => close() }),
        el('div', {}, el('h2', { textContent: isNew ? 'Nouveau document' : d.num || 'Document' }),
          el('p', { className: 'added', textContent: isNew ? `Le N° sera ${nextNum(String(new Date().getFullYear()))}` : `${d.type || ''} · ajouté le ${new Date(d.cree || Date.now()).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}${d.by ? ' · ' + d.by.split('@')[0] : ''}` }))),
      el('section', { className: 'cardsec' }, el('h3', { textContent: 'Document' }),
        lab('Type de document', inp('type', d.type, { list: 'dl-types', placeholder: 'Ex : Acte de naissance' })),
        el('div', { className: 'two' }, lab('Client', inp('client', d.client, { list: 'dl-clients', placeholder: 'Nom et prénom', autocapitalize: 'words' })),
          lab('Téléphone (optionnel)', inp('tel', d.tel, { type: 'tel', inputMode: 'tel', placeholder: '06…' }))),
        el('div', { className: 'two' }, lab('Langue du document', inp('de', d.de, { list: 'dl-langs' })), lab('Traduire en', inp('vers', d.vers, { list: 'dl-langs' }))),
        el('div', { className: 'two' }, lab('Nombre de pages', inp('pages', d.pages, { type: 'number', inputMode: 'numeric', min: 1 })), lab('État', etat))),
      el('section', { className: 'cardsec' }, el('h3', { textContent: 'Traducteur et dates' }),
        lab('Traducteur', inp('traducteur', d.traducteur, { list: 'dl-trad', placeholder: 'Nom du traducteur', autocapitalize: 'words' })),
        el('div', { className: 'two' }, lab('Envoyé au traducteur le', inp('envoi', d.envoi, { type: 'date' })), lab('À livrer le', inp('livraison', d.livraison, { type: 'date' }))),
        lab('Remis au client le', inp('remise', d.remise, { type: 'date' }))),
      el('section', { className: 'cardsec' }, el('h3', { textContent: '💰 Argent' }),
        el('div', { className: 'two' }, lab('Prix pour le client (DH)', prix), lab('Payé par le client (DH)', paye)), all(prix, paye),
        el('div', { className: 'two' }, lab('Coût du traducteur (DH)', cout), lab('Payé au traducteur (DH)', coutPaye)), all(cout, coutPaye),
        res),
      lab('Notes', el('textarea', { name: 'notes', rows: 2, value: d.notes || '', placeholder: 'Ex : original à rendre…' })),
      el('datalist', { id: 'dl-types' }, ...[...new Set([...tarifs.map(t => t.nom), ...TYPES])].map(v => el('option', { value: v }))),
      el('datalist', { id: 'dl-langs' }, ...LANGUES.map(v => el('option', { value: v }))),
      el('datalist', { id: 'dl-trad' }, ...names.map(v => el('option', { value: v }))),
      el('datalist', { id: 'dl-clients' }, ...clients.map(v => el('option', { value: v }))),
      el('div', { className: 'save' }, el('button', { type: 'submit', className: 'primary', textContent: isNew ? 'Ajouter au registre' : 'Enregistrer' }), del),
    ].filter(Boolean));
    sync();
    // 💲 Choosing a type with a tariff fills our price and the translator's price (empty boxes only)
    const typeIn = f.elements.type;
    const fillTarif = () => {
      const t = tarifOf(typeIn.value.trim());
      if (!t) return;
      if (prix.value === '' && amount(t.prix) !== undefined) prix.value = t.prix;
      if (cout.value === '' && amount(t.cout) !== undefined) cout.value = t.cout;
      sync();
    };
    typeIn.addEventListener('change', fillTarif);
    typeIn.addEventListener('input', () => { if (tarifOf(typeIn.value.trim())) fillTarif(); });
    etat.onchange = () => { if (etat.value === 'remise' && !f.elements.remise.value) f.elements.remise.value = ymd(); };
    f.onsubmit = e => { e.preventDefault(); save(f); };
    $('#doc').replaceChildren(f);
  }
  async function save(f) {
    const E = f.elements, v = k => E[k].value.trim();
    if (!v('type')) { toast('Tapez le type de document', true); return E.type.focus(); }
    if (!v('client')) { toast('Tapez le nom du client', true); return E.client.focus(); }
    const btn = f.querySelector('.save .primary');
    btn.disabled = true;
    const d = cur;
    const id = d.id || 'tr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const data = JSON.parse(JSON.stringify({
      ...d, id, num: d.num || nextNum(String(new Date().getFullYear())), type: v('type'), client: v('client'), tel: v('tel') || undefined,
      de: v('de') || undefined, vers: v('vers') || undefined, pages: v('pages') === '' ? undefined : +v('pages'), etat: v('etat') || 'traducteur',
      traducteur: v('traducteur') || undefined, envoi: v('envoi') || undefined, livraison: v('livraison') || undefined,
      remise: v('remise') || (v('etat') === 'remise' ? ymd() : undefined), notes: v('notes') || undefined,
      prix: amount(v('prix')), paye: amount(v('paye')), cout: amount(v('cout')), coutPaye: amount(v('coutPaye')),
      cree: d.cree || Date.now(), by: d.by || me || undefined,
    }));
    try { await put(data); } catch (e) { btn.disabled = false; return toast('Pas enregistré : ' + e.message, true); }
    rows = [...rows.filter(r => r.id !== id), data];
    toast(d.id ? '✓ Enregistré' : `✓ ${data.num} ajouté au registre`);
    close();
  }
  async function remove(btn) {
    if (!armed) {
      armed = true;
      btn.textContent = '🗑 Touchez encore pour supprimer';
      btn.classList.add('armed');
      setTimeout(() => { if (armed && btn.isConnected) { armed = false; btn.textContent = '🗑 Supprimer ce document'; btn.classList.remove('armed'); } }, 3000);
      return;
    }
    const id = cur.id;
    const { error } = await sb.from(TABLE).delete().eq('id', id);
    if (error) return toast('Pas supprimé : ' + error.message, true);
    rows = rows.filter(r => r.id !== id);
    toast('Document supprimé');
    close();
  }

  // ---- 📄 Report (PDF with the phone's print) and ⬇ Excel, for the period of the Bilan ----
  const sorted = () => rows.filter(inPeriod).sort((a, b) => (a.num || '').localeCompare(b.num || ''));
  function report() {
    const list = sorted();
    if (!list.length) return toast('Aucun document pour cette période', true);
    const t = totals(list);
    const tbl = (head, body, foot) => el('table', {}, el('thead', {}, el('tr', {}, ...head.map(h => el('th', { textContent: h })))),
      el('tbody', {}, ...body.map(r => el('tr', {}, ...r.map((c, i) => el('td', { textContent: c, className: i && /DH$|^\d+$/.test(String(c)) ? 'n' : '' }))))),
      foot ? el('tfoot', {}, el('tr', {}, ...foot.map((c, i) => el('td', { textContent: c, className: i ? 'n' : '' })))) : null);
    const grp = (title, key) => { const g = groupBy(list, key); return el('section', {}, el('h2', { textContent: title }),
      tbl(['', 'Docs', 'Pages', 'Prix', 'Coût', 'Bénéfice'], g.map(([k, x]) => [k, String(x.n), String(x.pages), money(x.prix), money(x.cout), money(x.benef)]),
        ['Total', String(t.n), String(t.pages), money(t.prix), money(t.cout), money(t.benef)])); };
    const doc = el('article', { className: 'report' },
      el('header', {}, el('h1', { textContent: `Traductions · ${periodTitle()}` }),
        el('p', { textContent: `Al Wasit — rapport du ${new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })} · ${t.n} documents · ${t.pages} pages` })),
      el('div', { className: 'kpis' }, el('div', { className: 'in' }, el('span', { textContent: 'Prix clients' }), el('b', { textContent: money(t.prix) })),
        el('div', { className: 'out' }, el('span', { textContent: 'Coût traducteurs' }), el('b', { textContent: money(t.cout) })),
        el('div', { className: 'net' }, el('span', { textContent: 'Bénéfice' }), el('b', { textContent: money(t.benef) }))),
      el('section', {}, el('h2', { textContent: 'Argent' }), tbl(['', 'Montant'], [['Encaissé des clients', money(t.paye)], ['Reste chez les clients', money(t.reste)],
        ['Payé aux traducteurs', money(t.coutPaye)], ['Reste à payer aux traducteurs', money(t.doit)]])),
      grp('Par traducteur', d => d.traducteur), grp('Par type de document', d => d.type), grp('Par langue', d => langs(d)),
      el('section', {}, el('h2', { textContent: 'Tous les documents' }), tbl(['N°', 'Date', 'Document', 'Client', 'Traducteur', 'Prix', 'Coût', 'Bénéfice'],
        list.map(d => { const c = calc(d); return [d.num || '', fr(dayOf(d)), d.type || '', d.client || '', d.traducteur || '', c.hasPrix ? money(c.prix) : '', c.hasCout ? money(c.cout) : '', c.benef === null ? '' : money(c.benef)]; }))));
    const page = $('#report');
    page.replaceChildren(
      el('div', { className: 'rbar' },
        el('button', { type: 'button', className: 'back', textContent: '←', ariaLabel: 'Retour', onclick: () => { page.hidden = true; document.body.classList.remove('noscroll'); } }),
        el('button', { type: 'button', className: 'primary', textContent: '📄 Enregistrer en PDF', onclick: () => window.print() })),
      el('p', { className: 'rhint', textContent: 'Touchez «Enregistrer en PDF», puis choisissez «Enregistrer au format PDF» comme imprimante.' }), doc);
    document.title = `Traductions ${periodTitle()}`;
    page.hidden = false;
    document.body.classList.add('noscroll');
  }
  window.addEventListener('afterprint', () => { document.title = 'Traductions'; });
  function excel() {
    const list = sorted();
    if (!list.length) return toast('Aucun document pour cette période', true);
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`, num = n => (n === undefined || n === '' ? '' : String(n).replace('.', ','));
    const lines = [['N°', 'Ajouté le', 'Document', 'Client', 'Téléphone', 'De', 'Vers', 'Pages', 'Traducteur', 'Envoyé le', 'À livrer le', 'Remis le', 'État',
      'Prix (DH)', 'Payé client (DH)', 'Reste client (DH)', 'Coût traducteur (DH)', 'Payé traducteur (DH)', 'Reste traducteur (DH)', 'Bénéfice (DH)', 'Notes'].map(cell).join(';'),
    ...list.map(d => { const c = calc(d); return [d.num, fr(dayOf(d)), d.type, d.client, d.tel, d.de, d.vers, d.pages, d.traducteur, fr(d.envoi), fr(d.livraison), fr(d.remise),
      (ETATS[d.etat] || '').replace(/^\S+\s/, ''), num(amount(d.prix)), num(amount(d.paye)), num(c.reste), num(amount(d.cout)), num(amount(d.coutPaye)), num(c.doit),
      c.benef === null ? '' : num(c.benef), d.notes].map(cell).join(';'); })];
    const a = el('a', { href: URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })),
      download: `traductions-${ui.period === 'year' ? ui.month.slice(0, 4) : ui.month}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
  }

  // ---- 🔒 Code, 🔄 announce, start ----
  const code = {
    get: async () => { const { data, error } = await sb.from(TABLE).select('data').eq('id', '__code__').maybeSingle(); if (error) throw error; return data?.data || null; },
    set: async v => { const { error } = await sb.from(TABLE).upsert({ id: '__code__', data: v, updated_at: new Date().toISOString(), updated_by: me }); if (error) throw error; },
  };
  async function lock() {
    $('#app-view').hidden = true;
    $('#doc').hidden = true;
    while (!(await AAPin.unlock({ ...code, cancel: false, title: '📝 Traductions' }))) { /* the code is asked again */ }
    $('#app-view').hidden = false;
    if (cur) $('#doc').hidden = false;
  }
  AAPin.relockAfter(5 * 60_000, () => { if (me) lock(); });
  $('#pincode').onclick = async () => { $('#menu-box').hidden = true; if (await AAPin.change(code)) toast('✓ Nouveau code enregistré (pour toute l\'équipe)'); };
  $('#menu').onclick = () => { $('#menu-box').hidden = !$('#menu-box').hidden; };
  $('#logout').onclick = async () => { await sb.auth.signOut(); location.reload(); };
  $('#add').onclick = () => open(null);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && cur) close(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && me && !cur) load(); });

  async function announce() {
    for (const table of ['clients_tls', 'clients']) {
      const { data: row } = await sb.from(table).select('data').eq('id', '__equipe__').maybeSingle();
      const c1 = row?.data, tg = c1?.telegram;
      if (!tg?.botToken || !tg?.chatId) continue;
      if ((c1.majTrad || '') >= VERSION) return;
      await new Promise(r => setTimeout(r, 3_000 + Math.random() * 20_000));
      const { data: again } = await sb.from(table).select('data').eq('id', '__equipe__').maybeSingle();
      const c2 = again?.data;
      if (!c2 || (c2.majTrad || '') >= VERSION) return;
      const mark = v => sb.from(table).upsert({ id: '__equipe__', data: { ...c2, majTrad: v }, updated_at: new Date().toISOString(), updated_by: me });
      if ((await mark(VERSION)).error) return;
      const text = `🔄 ميزاجور جديدة — Traductions 📝\n\n${NOUVEAUTES.map(l => '• ' + l).join('\n')}`;
      const ok = await fetch(`https://api.telegram.org/bot${encodeURIComponent(tg.botToken)}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: tg.chatId, text }),
      }).then(r => r.json()).then(j => j.ok).catch(() => false);
      if (!ok) await mark(c2.majTrad);
      return;
    }
  }

  async function start(session) {
    me = session.user.email || '';
    $('#who').textContent = me;
    $('#login-view').hidden = true;
    await lock();
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
    if (error) { $('#login-error').textContent = /invalid/i.test(error.message) ? 'Email ou mot de passe incorrect (le même que ☁ dans l\'extension).' : error.message; return; }
    start(data.session);
  };
  sb.auth.getSession().then(({ data }) => { if (data.session) start(data.session); else $('#login-view').hidden = false; });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
