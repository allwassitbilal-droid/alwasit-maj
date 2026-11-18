// «Traductions» tab of the phone app: the documents the agency has translated for its clients.
// One row per document in the Supabase table "traductions" (supabase-traductions.sql), shared with the
// «📝 Traductions» panel of Autofill TLS and Autofill BLS: same fields, same table.
// A document stays in the list until someone deletes it (🗑, two taps): nothing goes away by itself.
// data: { id, type, client, de, vers, pages, prix, paye, etat, traducteur, envoi, livraison, remise, notes, cree, by }
// envoi = sent to the translator, livraison = to give back by, remise = given back to the client.
globalThis.AFTrad = (() => {
  const { sb, el, $, toast } = AF;
  const TABLE = 'traductions';
  const ETATS = { traducteur: '✍️ Chez le traducteur', bureau: '🏢 Au bureau', prete: '✅ Prête', remise: '📦 Remise au client' };
  const TYPES = ['Acte de naissance', 'Copie intégrale', 'Fiche anthropométrique (casier)', 'Certificat de résidence', 'Attestation de travail',
    'Bulletins de paie', 'Relevé bancaire', 'Attestation de scolarité', 'Diplôme', 'Relevé de notes', 'Acte de mariage', 'Livret de famille',
    'Certificat de vie individuelle', 'Registre de commerce', 'Attestation CNSS', 'Contrat de travail', 'Permis de conduire', 'Jugement'];
  const LANGUES = ['Arabe', 'Français', 'Espagnol', 'Anglais', 'Allemand', 'Italien', 'Néerlandais', 'Portugais'];
  const FILTERS = [['', 'Toutes'], ['cours', 'En cours'], ['bureau', '🏢 Au bureau'], ['prete', '✅ Prêtes'], ['remise', '📦 Remises'], ['reste', '💰 Reste à payer']];
  const ui = { q: '', f: '' };
  let rows = [], loaded = false, loading = null, cur = null, armed = false;

  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const frDate = iso => (iso ? iso.split('-').reverse().join('/') : '');
  const money = n => `${Number(n).toLocaleString('fr-FR')} DH`;
  const amount = v => {
    const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
  };
  const pay = d => {
    const prix = amount(d.prix);
    if (prix === undefined) return null;
    const paye = amount(d.paye) || 0;
    return { prix, paye, reste: Math.max(0, Math.round((prix - paye) * 100) / 100) };
  };
  const added = ms => { if (!ms) return ''; const d = new Date(ms); return `ajoutée le ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} à ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const langs = d => [d.de, d.vers].filter(Boolean).join(' → ');
  const late = d => d.livraison && d.etat !== 'remise' && d.livraison < AF.ymd();

  async function load() {
    if (loading) return loading;
    loading = (async () => {
      const out = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from(TABLE).select('id,data').range(from, from + 999);
        if (error) throw error;
        out.push(...data.map(r => ({ ...r.data, id: r.id })));
        if (data.length < 1000) break;
      }
      rows = out;
      loaded = true;
    })().catch(e => {
      toast(/traductions/.test(e.message || '') ? 'Tableau «traductions» absent : lancez supabase-traductions.sql dans Supabase' : 'Traductions : ' + (e.message || 'pas de connexion'), true);
    }).finally(() => { loading = null; if (AF.view() === 'trad') AF.render(); });
    return loading;
  }
  // Live: a document added on a PC shows here within seconds.
  let channel = null;
  function live() {
    if (channel) return;
    channel = sb.channel('traductions-mobile').on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, p => {
      const id = p.new?.id || p.old?.id;
      if (!id) return;
      rows = p.eventType === 'DELETE' ? rows.filter(r => r.id !== id) : [...rows.filter(r => r.id !== id), { ...(p.new.data || {}), id }];
      if (AF.view() === 'trad') AF.render();
    }).subscribe();
  }

  function results() {
    const q = norm(ui.q.trim());
    let list = rows;
    if (ui.f === 'cours') list = list.filter(d => d.etat !== 'remise');
    else if (ETATS[ui.f]) list = list.filter(d => d.etat === ui.f);
    else if (ui.f === 'reste') list = list.filter(d => pay(d)?.reste > 0);
    if (q) list = list.filter(d => norm(`${d.client} ${d.type} ${d.de} ${d.vers} ${d.traducteur} ${d.notes}`).includes(q));
    return [...list].sort((x, y) => (y.cree || 0) - (x.cree || 0)); // newest first, one under the other
  }

  function card(d) {
    const p = pay(d);
    const badges = [
      d.etat ? el('span', { className: 'cbadge ' + (d.etat === 'remise' ? 'past' : d.etat === 'prete' ? 'ok' : d.etat === 'bureau' ? 'bureau' : ''), textContent: ETATS[d.etat] || d.etat }) : null,
      d.livraison && d.etat !== 'remise' ? el('span', { className: 'cbadge ' + (late(d) ? 'soon' : ''), textContent: `${late(d) ? '⏰ En retard' : '📅 Pour le'} ${frDate(d.livraison).slice(0, 5)}` }) : null,
      p ? (p.reste > 0 ? el('span', { className: 'cbadge due', textContent: `💰 Reste ${money(p.reste)}` }) : el('span', { className: 'cbadge ok', textContent: `✓ Payé ${money(p.prix)}` })) : null,
    ].filter(Boolean);
    return el('li', {},
      el('button', { type: 'button', className: 'crow trow', onclick: () => open(d.id) },
        el('span', { className: 'tstub' }, el('b', { textContent: d.pages ? String(d.pages) : '–' }), el('small', { textContent: +d.pages > 1 ? 'pages' : 'page' })),
        el('span', { className: 'cbody' },
          el('span', { className: 'cname', textContent: d.type || '(type ?)' }),
          el('span', { className: 'cmeta', textContent: [d.client && '👤 ' + d.client, langs(d) && '🌐 ' + langs(d)].filter(Boolean).join('   ') || ' ' }),
          d.traducteur || d.envoi || d.remise ? el('span', { className: 'cmeta', textContent: [d.traducteur && '✍️ ' + d.traducteur, d.envoi && '📤 envoyé le ' + frDate(d.envoi).slice(0, 5), d.remise && '📦 remis le ' + frDate(d.remise).slice(0, 5)].filter(Boolean).join('   ') }) : null,
          badges.length ? el('span', { className: 'cbadges' }, ...badges) : null,
          d.cree ? el('span', { className: 'tadded', textContent: added(d.cree) }) : null)));
  }

  function render(list) {
    if (!loaded) { list.replaceChildren(el('p', { className: 'empty', textContent: 'Chargement…' })); load(); live(); return; }
    live();
    let tool = list.querySelector('.ctool.trad');
    if (!tool) {
      const q = el('input', { type: 'search', className: 'csearch', placeholder: 'Chercher : client, document, langue…', value: ui.q, ariaLabel: 'Chercher une traduction' });
      q.oninput = () => { ui.q = q.value; fill(list); };
      tool = el('div', { className: 'ctool trad' }, q, el('div', { className: 'cfolders' }));
      list.replaceChildren(tool, el('div', { className: 'tsum' }), el('p', { className: 'ccount' }), el('ul', { className: 'clist' }));
    }
    fill(list);
  }
  function fill(list) {
    list.querySelector('.cfolders').replaceChildren(...FILTERS.map(([v, t]) => el('button', {
      type: 'button', className: 'cchip' + (ui.f === v ? ' on' : ''), textContent: t, onclick: () => { ui.f = v; fill(list); },
    })));
    const enCours = rows.filter(d => d.etat !== 'remise').length;
    const reste = rows.reduce((s, d) => s + (pay(d)?.reste || 0), 0);
    list.querySelector('.tsum').replaceChildren(
      el('div', {}, el('b', { textContent: String(enCours) }), el('span', { textContent: 'en cours' })),
      el('div', {}, el('b', { textContent: String(rows.filter(late).length) }), el('span', { textContent: 'en retard' })),
      el('div', {}, el('b', { className: reste ? 'due' : '', textContent: reste ? money(reste) : '0' }), el('span', { textContent: 'reste à payer' })));
    const r = results();
    list.querySelector('.ccount').textContent = `${r.length} document${r.length > 1 ? 's' : ''}`;
    list.querySelector('.clist').replaceChildren(...(r.length ? r.slice(0, 500).map(card)
      : [el('li', { className: 'empty', textContent: rows.length ? 'Aucun document trouvé.' : 'Aucune traduction. ＋ pour ajouter un document.' })]));
  }

  // ---- Document page (new or edit) ----
  const field = (label, input, hint) => el('label', { className: 'f' }, el('span', { textContent: label }), input, hint || null);
  const inp = (name, value, { list, ...props } = {}) => {
    const i = el('input', { name, value: value ?? '', autocomplete: 'off', ...props });
    if (list) i.setAttribute('list', list);
    return i;
  };

  function open(id) {
    const d = id ? rows.find(r => r.id === id) : null;
    if (id && !d) return toast('Document introuvable', true);
    cur = { id, data: d ? { ...d } : { etat: 'traducteur', de: 'Arabe', vers: 'Français', envoi: AF.ymd() } };
    armed = false;
    const page = $('#trad-page');
    page.hidden = false;
    document.body.classList.add('noscroll');
    try { history.pushState({ trad: 1 }, ''); } catch { /* not important */ }
    draw();
  }
  function close(fromBack) {
    if (!cur) return;
    if (fromBack !== true && history.state?.trad) { history.back(); return; }
    $('#trad-page').hidden = true;
    document.body.classList.remove('noscroll');
    cur = null;
  }

  function draw() {
    const { id, data: d } = cur;
    const f = el('form', { className: 'cform', noValidate: true });
    const head = el('header', { className: 'chead' },
      el('button', { type: 'button', className: 'back', textContent: '←', ariaLabel: 'Retour', onclick: () => close() }),
      el('div', {}, el('h2', { textContent: id ? (d.type || 'Traduction') : 'Nouvelle traduction' }),
        el('p', { textContent: id ? added(d.cree) + (d.by ? ' · ' + d.by.split('@')[0] : '') : 'Document à traduire' })));
    const names = [...new Set(['tls', 'bls'].flatMap(a => AF.state[a].clients.map(AF.name)))].sort();
    const lists = [
      el('datalist', { id: 'dl-ttypes' }, ...TYPES.map(v => el('option', { value: v }))),
      el('datalist', { id: 'dl-tlangs' }, ...LANGUES.map(v => el('option', { value: v }))),
      el('datalist', { id: 'dl-tclients' }, ...names.map(v => el('option', { value: v }))),
      el('datalist', { id: 'dl-ttrad' }, ...[...new Set(rows.map(r => r.traducteur).filter(Boolean))].sort().map(v => el('option', { value: v }))),
    ];
    const etat = el('select', { name: 'etat' }, ...Object.entries(ETATS).map(([k, t]) => el('option', { value: k, textContent: t, selected: (d.etat || 'traducteur') === k })));
    // 💰 like the clients' Paiement
    const prix = inp('prix', d.prix, { inputMode: 'decimal', placeholder: 'ex : 150' });
    const paye = inp('paye', d.paye, { inputMode: 'decimal', placeholder: '0' });
    const payHint = el('small', { className: 'hint' });
    const syncPay = () => {
      const p = pay({ prix: prix.value, paye: paye.value });
      payHint.className = 'hint ' + (p ? (p.reste > 0 ? 'warn' : 'ok') : '');
      payHint.textContent = !p ? 'Tapez le prix pour suivre ce qui reste à payer.' : p.reste > 0 ? `Reste à payer : ${money(p.reste)}` : '✓ Tout est payé';
    };
    prix.oninput = paye.oninput = syncPay;
    queueMicrotask(syncPay);
    const del = id ? el('button', { type: 'button', className: 'mini tdel', textContent: '🗑 Supprimer ce document', onclick: () => remove(del) }) : null;
    f.append(
      el('section', { className: 'cs' },
        el('h3', { textContent: 'Document' }),
        field('Type de document', inp('type', d.type, { list: 'dl-ttypes', placeholder: 'Ex : Acte de naissance' })),
        field('Client (à qui appartient le document)', inp('client', d.client, { list: 'dl-tclients', placeholder: 'Nom et prénom', autocapitalize: 'words' })),
        el('div', { className: 'two' },
          field('Langue du document', inp('de', d.de, { list: 'dl-tlangs' })),
          field('Traduire en', inp('vers', d.vers, { list: 'dl-tlangs' }))),
        field('Nombre de pages', inp('pages', d.pages, { type: 'number', inputMode: 'numeric', min: 1 })),
        ...lists),
      el('section', { className: 'cs' },
        el('h3', { textContent: 'Traducteur' }),
        field('Nom du traducteur', inp('traducteur', d.traducteur, { list: 'dl-ttrad', placeholder: 'Nom du traducteur', autocapitalize: 'words' })),
        el('div', { className: 'two' },
          field('Envoyé au traducteur le', inp('envoi', d.envoi, { type: 'date' })),
          field('À livrer le', inp('livraison', d.livraison, { type: 'date' }))),
        el('div', { className: 'two' },
          field('État', etat),
          field('Remis au client le', inp('remise', d.remise, { type: 'date' }))),
        field('Notes', el('textarea', { name: 'notes', rows: 2, value: d.notes || '', placeholder: 'Ex : original à rendre…' }))),
      el('section', { className: 'cs' },
        el('h3', { textContent: 'Paiement' }),
        el('div', { className: 'two' }, field('Prix (DH)', prix), field('Déjà payé (DH)', paye)),
        el('div', { className: 'row' },
          el('button', { type: 'button', className: 'mini', textContent: 'Tout payé', onclick: () => { if (amount(prix.value) === undefined) return prix.focus(); paye.value = amount(prix.value); syncPay(); } })),
        payHint),
      del ? el('section', { className: 'cs' }, del, el('small', { className: 'hint', textContent: 'Le document reste dans la liste tant qu\'on ne le supprime pas.' })) : '',
      el('div', { className: 'csave' }, el('button', { type: 'submit', className: 'primary', textContent: id ? 'Enregistrer' : 'Ajouter le document' })));
    etat.onchange = () => { if (etat.value === 'remise' && !f.elements.remise.value) f.elements.remise.value = AF.ymd(); };
    f.onsubmit = e => { e.preventDefault(); save(f); };
    $('#trad-page').replaceChildren(head, f);
  }

  async function save(f) {
    const E = f.elements, v = k => E[k].value.trim();
    if (!v('type')) { toast('Tapez le type de document', true); return E.type.focus(); }
    if (!v('client')) { toast('Tapez le nom du client', true); return E.client.focus(); }
    const btn = f.querySelector('.csave button');
    btn.disabled = true;
    const id = cur.id || 'tr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const me = AF.me();
    const data = JSON.parse(JSON.stringify({
      ...cur.data, id, type: v('type'), client: v('client'), de: v('de') || undefined, vers: v('vers') || undefined,
      pages: v('pages') === '' ? undefined : +v('pages'), livraison: v('livraison') || undefined, etat: v('etat') || 'traducteur',
      traducteur: v('traducteur') || undefined, envoi: v('envoi') || undefined,
      remise: v('remise') || (v('etat') === 'remise' ? AF.ymd() : undefined), // «Remise au client» without a date: today
      notes: v('notes') || undefined, prix: amount(v('prix')), paye: amount(v('paye')),
      cree: cur.data.cree || Date.now(), by: cur.data.by || me || undefined,
    }));
    const { error } = await sb.from(TABLE).upsert({ id, data, updated_at: new Date().toISOString(), updated_by: me });
    if (error) { btn.disabled = false; return toast('Pas enregistré : ' + error.message, true); }
    rows = [...rows.filter(r => r.id !== id), data];
    toast(cur.id ? '✓ Enregistré' : '✓ Document ajouté');
    close();
    AF.render();
  }

  // Two taps: the first arms, the second (within 3 s) deletes.
  async function remove(btn) {
    if (!armed) {
      armed = true;
      btn.textContent = '🗑 Touchez encore pour supprimer';
      btn.classList.add('armed');
      setTimeout(() => { if (armed && cur) { armed = false; btn.textContent = '🗑 Supprimer ce document'; btn.classList.remove('armed'); } }, 3000);
      return;
    }
    const id = cur.id;
    const { error } = await sb.from(TABLE).delete().eq('id', id);
    if (error) return toast('Pas supprimé : ' + error.message, true);
    rows = rows.filter(r => r.id !== id);
    toast('Document supprimé');
    close();
    AF.render();
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && cur) close(); });
  window.addEventListener('popstate', () => { if (cur) close(true); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && loaded) load(); });

  return { render, open };
})();
