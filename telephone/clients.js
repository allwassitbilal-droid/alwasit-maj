// «Clients» tab of the phone app: find a client, open the file, change the simple things (stage, appointment,
// notes…), add a new client, take the passport photo. Writes the same rows and files as the extensions, so the
// PCs see every change within seconds. The France-Visas form and the autofill stay on the PC.
globalThis.AFClients = (() => {
  const { sb, APPS, el, $, toast } = AF;
  const ETAPES = {
    nouveau: '🆕 Nouveau', docs: '📄 Documents en cours', manque: '⚠️ Il manque', complet: '✅ Complet', rdv: '🗓 RDV pris',
  };
  const SLOTS = [['passeport', '🛂 Passeport'], ['photo', '🖼 Photo'], ['formulaire', '📄 Formulaire']];
  const ui = { q: '', folder: { tls: '', bls: '' } };
  const ARCHIVE = '\u0000archive';
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const frDate = iso => (iso ? iso.split('-').reverse().join('/') : '');
  const hue = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  const today = () => AF.ymd();
  const numOf = c => (c.num === null || c.num === undefined || c.num === '' ? null : +c.num);

  // ---- 💰 Payment and 💬 WhatsApp: same rules as extras.js in the extensions ----
  const money = n => `${Number(n).toLocaleString('fr-FR')} DH`;
  const amount = v => {
    const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
  };
  function pay(c) {
    const prix = amount(c.prix);
    if (prix === undefined) return null;
    const paye = amount(c.paye) || 0;
    return { prix, paye, reste: Math.max(0, Math.round((prix - paye) * 100) / 100) };
  }
  function waNumber(m) {
    let d = String(m || '').replace(/[^\d+]/g, '');
    if (d.startsWith('+')) d = d.slice(1);
    else if (d.startsWith('00')) d = d.slice(2);
    else if (/^0[5-7]\d{8}$/.test(d)) d = '212' + d.slice(1);
    else if (/^[67]\d{8}$/.test(d)) d = '212' + d;
    return /^\d{9,15}$/.test(d) ? d : '';
  }
  function messages(c, app) {
    const hi = `السلام عليكم ${c.prenom || ''}`.trim() + '،\n';
    const out = [];
    if (app === 'tls') {
      if (c.etape === 'manque') out.push({ label: '⚠ Il manque', text: `${hi}باش نكملو الدوسي ديال الفيزا ديال فرنسا، خاصك تجيب: ${c.manque || '…'}.\nشكرا.` });
      if (c.rdvDate) out.push({ label: '🗓 RDV', text: `${hi}الموعد ديالك فـ TLScontact${c.rdvCentre ? ' ' + c.rdvCentre : ''} نهار ${frDate(c.rdvDate)}${c.rdvHeure ? ' مع ' + c.rdvHeure : ''}.\nجيب معاك الباسبور والوثائق الأصلية. بالتوفيق!` });
      if (c.etape === 'complet') out.push({ label: '✅ Complet', text: `${hi}الدوسي ديالك كامل ✅. غادي نتواصلو معاك ملي يكون الموعد.` });
    } else {
      const r = c.reserve;
      if (r?.day) out.push({ label: '🗓 RDV', text: `${hi}الموعد ديالك فـ BLS (فيزا إسبانيا) نهار ${frDate(r.day)}${r.time ? ' مع ' + r.time : ''}.\nجيب معاك الباسبور والوثائق الأصلية. بالتوفيق!` });
      if (r?.face) out.push({ label: '🤳 Selfie', text: `${hi}خاصنا نديرو السيلفي ديال BLS قبل الموعد. عيط لينا عافاك باش نديروه.` });
    }
    const p = pay(c);
    if (p?.reste > 0) out.push({ label: '💰 Reste à payer', text: `${hi}باقي عليك ${money(p.reste)} ديال الدوسي.\nشكرا.` });
    out.push({ label: '✍ Message libre', text: hi });
    return out.map(m => ({ ...m, text: m.text + '\n— الوسيط' }));
  }

  // ---- List ----
  function folders(a) {
    return [...new Set(AF.state[a].clients.map(c => c.dossier).filter(Boolean))].sort((x, y) => x.localeCompare(y));
  }
  function badge(a, c) {
    if (a === 'tls') {
      if (c.archive) return ['📦 Archivé', 'past'];
      if (c.etape === 'rdv' && c.rdvDate) {
        const d = AF.dayDiff(c.rdvDate);
        return [`🗓 RDV ${d === 0 ? "aujourd'hui" : d === 1 ? 'demain' : frDate(c.rdvDate).slice(0, 5)}${c.rdvHeure ? ' ' + c.rdvHeure : ''}`, d >= 0 && d <= 1 ? 'soon' : d < 0 ? 'past' : ''];
      }
      if (c.etape === 'manque') return ['⚠️ Il manque', 'warn'];
      return c.etape && ETAPES[c.etape] ? [ETAPES[c.etape], c.etape === 'complet' ? 'ok' : ''] : null;
    }
    const r = c.reserve;
    if (!r?.day) return null;
    const d = AF.dayDiff(r.day);
    if (c.lettre) return ['✓ Lettre reçue', 'ok'];
    return [`🗓 RDV ${d === 0 ? "aujourd'hui" : d === 1 ? 'demain' : frDate(r.day).slice(0, 5)}${r.time ? ' ' + r.time : ''}${r.face ? ' · selfie' : ''}`, d >= 0 && d <= 1 ? 'soon' : d < 0 ? 'past' : ''];
  }

  function results(a) {
    const q = norm(ui.q.trim()), f = ui.folder[a];
    let list = AF.state[a].clients;
    if (f === ARCHIVE) list = list.filter(c => c.archive);
    else {
      list = list.filter(c => !c.archive);
      if (f) list = list.filter(c => c.dossier === f);
    }
    if (q) list = list.filter(c => String(numOf(c)) === q || norm(`${c.prenom} ${c.nom} ${c.nom} ${c.prenom} ${c.passeport} ${c.mobile}`).includes(q));
    return [...list].sort((x, y) => (numOf(x) ?? 1e9) - (numOf(y) ?? 1e9) || AF.name(x).localeCompare(AF.name(y)));
  }

  function payBadge(c) {
    const p = pay(c);
    if (!p) return null;
    return p.reste > 0 ? el('span', { className: 'cbadge due', textContent: `💰 Reste ${money(p.reste)}` }) : el('span', { className: 'cbadge ok', textContent: '✓ Payé' });
  }
  function card(a, c) {
    const b = badge(a, c), n = numOf(c);
    return el('li', {},
      el('button', { type: 'button', className: 'crow', onclick: () => open(c.id) },
        el('span', { className: 'cstub' + (c.dossier ? '' : ' none'), style: c.dossier ? `--h:${hue(c.dossier)}` : '' },
          el('small', { textContent: 'N°' }), el('b', { textContent: n ?? '–' })),
        el('span', { className: 'cbody' },
          el('span', { className: 'cname', textContent: AF.name(c) }),
          el('span', { className: 'cmeta', textContent: [c.passeport, c.dossier && '📁 ' + c.dossier, c.famille && '👪'].filter(Boolean).join('  ') || ' ' }),
          b || pay(c) ? el('span', { className: 'cbadges' },
            b ? el('span', { className: 'cbadge ' + b[1], textContent: b[0] }) : null,
            payBadge(c)) : null)));
  }

  function render(list) {
    const a = AF.app();
    let tool = list.querySelector('.ctool');
    if (!tool || tool.dataset.app !== a) {
      const q = el('input', { type: 'search', className: 'csearch', placeholder: 'Chercher : nom, passeport, N°, mobile…', value: ui.q, ariaLabel: 'Chercher un client' });
      q.oninput = () => { ui.q = q.value; fill(list); };
      tool = el('div', { className: 'ctool' }, q, el('div', { className: 'cfolders' }));
      tool.dataset.app = a;
      list.replaceChildren(tool, el('p', { className: 'ccount' }), el('ul', { className: 'clist' }));
    }
    fill(list);
  }
  function fill(list) {
    const a = AF.app();
    const chips = [['', 'Tous'], ...folders(a).map(f => [f, f]), ...(a === 'tls' ? [[ARCHIVE, '📦 Archive']] : [])];
    list.querySelector('.cfolders').replaceChildren(...chips.map(([v, t]) => el('button', {
      type: 'button', className: 'cchip' + (ui.folder[a] === v ? ' on' : ''), textContent: t,
      style: v && v !== ARCHIVE ? `--h:${hue(v)}` : '',
      onclick: () => { ui.folder[a] = v; fill(list); },
    })));
    const rows = results(a);
    list.querySelector('.ccount').textContent = `${rows.length} client${rows.length > 1 ? 's' : ''}`;
    list.querySelector('.clist').replaceChildren(...(rows.length ? rows.slice(0, 300).map(c => card(a, c))
      : [el('li', { className: 'empty', textContent: ui.q ? 'Aucun client trouvé.' : 'Aucun client dans ce dossier.' })]));
  }

  // ---- Files (Supabase Storage, same paths as the extensions: <client id>/<slot>/<name>) ----
  const bucket = a => sb.storage.from(APPS[a].bucket);
  async function listSlot(a, id, slot) {
    const { data, error } = await bucket(a).list(`${id}/${slot}`, { limit: 20 });
    if (error) throw error;
    return (data || []).filter(f => f.id).map(f => ({ name: f.name, path: `${id}/${slot}/${f.name}` }));
  }
  // Phone photos are heavy: 2000 px JPEG, like the extensions.
  async function shrink(file) {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || file.size < 400 * 1024) return file;
    try {
      const img = await createImageBitmap(file);
      const k = Math.min(1, 2000 / Math.max(img.width, img.height));
      const cv = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
      const g = cv.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, cv.width, cv.height);
      g.drawImage(img, 0, 0, cv.width, cv.height);
      const out = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85));
      return out && out.size < file.size ? out : file;
    } catch { return file; }
  }
  const safeName = (n, type) => {
    n = (n || 'fichier').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);
    if (type === 'image/jpeg' && !/\.jpe?g$/i.test(n)) n = n.replace(/\.[^.]*$/, '') + '.jpg';
    return n;
  };
  async function upload(a, id, slot, file) {
    const blob = await shrink(file);
    if (blob.size > 10 * 1024 * 1024) throw new Error('Fichier trop lourd (10 Mo max)');
    const name = safeName(file.name || `${slot}.jpg`, blob.type), path = `${id}/${slot}/${name}`;
    const old = await listSlot(a, id, slot);
    const { error } = await bucket(a).upload(path, blob, { upsert: true, contentType: blob.type || 'application/octet-stream' });
    if (error) throw error;
    const gone = old.map(f => f.path).filter(p => p !== path);
    if (gone.length) await bucket(a).remove(gone);
  }
  async function view(a, path) {
    const w = window.open('', '_blank'); // opened now, on the tap, so the phone doesn't block it
    const { data, error } = await bucket(a).createSignedUrl(path, 600);
    if (error || !data?.signedUrl) { w?.close(); return toast('Fichier introuvable', true); }
    if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
  }

  // ---- Client file page ----
  let cur = null; // { a, id, data, files: {slot: [...]}, pending: {slot: File} }

  function field(label, input, hint) {
    return el('label', { className: 'f' }, el('span', { textContent: label }), input, hint || null);
  }
  const inp = (name, value, { list, ...props } = {}) => {
    const i = el('input', { name, value: value ?? '', autocomplete: 'off', ...props });
    if (list) i.setAttribute('list', list); // read-only as a property
    return i;
  };

  async function open(id) {
    const a = AF.app();
    const page = $('#client');
    cur = { a, id, data: {}, files: {}, pending: {} };
    page.hidden = false;
    document.body.classList.add('noscroll');
    try { history.pushState({ client: 1 }, ''); } catch { /* not important */ } // phone «back» closes the file
    page.replaceChildren(el('p', { className: 'empty', textContent: 'Chargement…' }));
    if (id) {
      const { data, error } = await sb.from(APPS[a].table).select('data').eq('id', id).maybeSingle();
      if (error || !data) { toast('Client introuvable', true); return close(); }
      if (!cur || cur.id !== id) return;
      cur.data = data.data || {};
    } else if (ui.folder[a] && ui.folder[a] !== ARCHIVE) cur.data = { dossier: ui.folder[a], ...(a === 'tls' && { etape: 'nouveau' }) };
    else if (a === 'tls') cur.data = { etape: 'nouveau' };
    draw();
    if (id) loadFiles();
  }
  function close(fromBack) {
    if (!cur) return;
    if (fromBack !== true && history.state?.client) { history.back(); return; } // popstate closes it
    $('#client').hidden = true;
    document.body.classList.remove('noscroll');
    cur = null;
  }
  async function loadFiles() {
    const c = cur;
    try {
      const all = await Promise.all(SLOTS.map(([s]) => listSlot(c.a, c.id, s)));
      SLOTS.forEach(([s], i) => { c.files[s] = all[i]; });
    } catch { c.files.error = true; }
    if (cur === c) drawFiles();
  }

  function draw() {
    const { a, id, data: d } = cur;
    const f = el('form', { className: 'cform', noValidate: true });
    const head = el('header', { className: 'chead' },
      el('button', { type: 'button', className: 'back', textContent: '←', ariaLabel: 'Retour', onclick: () => close() }),
      el('div', {},
        el('h2', { textContent: id ? AF.name(d) : 'Nouveau client' }),
        el('p', { textContent: a === 'tls' ? 'Autofill TLS · France' : 'Autofill BLS · Espagne' })));
    const dl = el('datalist', { id: 'dl-folders' }, ...folders(a).map(x => el('option', { value: x })));
    const parts = [
      el('section', { className: 'cs' },
        el('h3', { textContent: 'Client' }),
        el('div', { className: 'two' },
          field('Prénom', inp('prenom', d.prenom, { autocapitalize: 'words' })),
          field('Nom', inp('nom', d.nom, { autocapitalize: 'characters' }))),
        el('div', { className: 'two' },
          field('N° du dossier', inp('num', d.num, { type: 'number', inputMode: 'numeric', min: 0 })),
          field('Dossier', inp('dossier', d.dossier, { list: 'dl-folders', placeholder: 'Tanger, Tetouan…' }))),
        el('div', { className: 'two' },
          field('Mobile', inp('mobile', d.mobile, { type: 'tel', inputMode: 'tel' })),
          field('N° passeport', inp('passeport', d.passeport, { autocapitalize: 'characters' }))),
        dl),
    ];
    if (a === 'tls') {
      const etape = el('select', { name: 'etape' }, el('option', { value: '', textContent: '—' }),
        ...Object.entries(ETAPES).map(([k, t]) => el('option', { value: k, textContent: t, selected: d.etape === k })));
      const manque = field('Il manque', inp('manque', d.manque, { placeholder: 'Ex : photos, relevé bancaire' }));
      const rdv = el('div', {},
        el('div', { className: 'two' },
          field('RDV TLS le', inp('rdvDate', d.rdvDate, { type: 'date' })),
          field('à', inp('rdvHeure', d.rdvHeure, { type: 'time' }))),
        field('Centre', inp('rdvCentre', d.rdvCentre, { placeholder: 'Ex : TLS Tanger' })));
      const tlsHint = el('small', { className: 'hint' });
      const tlsCree = inp('tlsCree', d.tlsCree, { type: 'date' });
      const todayBtn = el('button', { type: 'button', className: 'mini', textContent: "Aujourd'hui", onclick: () => { tlsCree.value = today(); sync(); } });
      const archive = el('label', { className: 'check' }, el('input', { type: 'checkbox', name: 'archive', checked: !!d.archive }), ' 📦 Archivé (RDV pris, dossier terminé)');
      const sync = () => {
        manque.hidden = etape.value !== 'manque';
        rdv.hidden = etape.value !== 'rdv';
        archive.hidden = etape.value !== 'rdv' && !archive.querySelector('input').checked;
        const exp = AF.tlsExpiry(tlsCree.value);
        if (!exp) { tlsHint.textContent = 'Le compte TLS dure 3 mois.'; tlsHint.className = 'hint'; return; }
        const n = AF.daysLeft(exp);
        tlsHint.className = 'hint ' + (n < 0 ? 'bad' : n <= 7 ? 'warn' : 'ok');
        tlsHint.textContent = n < 0 ? `⛔ Expiré le ${frDate(exp)} : nouveau compte à créer` : n <= 7 ? `⏳ Expire le ${frDate(exp)} (dans ${n} j)` : `✓ Valide jusqu'au ${frDate(exp)}`;
      };
      etape.onchange = sync;
      tlsCree.oninput = sync;
      parts.push(el('section', { className: 'cs' },
        el('h3', { textContent: 'Suivi du dossier' }),
        field('Étape', etape), manque, rdv, archive,
        el('label', { className: 'f' }, el('span', { textContent: 'Compte TLS créé le' }), el('div', { className: 'row' }, tlsCree, todayBtn), tlsHint),
        field('Notes', el('textarea', { name: 'notes', rows: 3, value: d.notes || '', placeholder: 'Ce qu\'il faut savoir sur ce dossier' }))));
      queueMicrotask(sync);
    } else {
      const r = d.reserve || {};
      parts.push(el('section', { className: 'cs' },
        el('h3', { textContent: 'Rendez-vous BLS' }),
        el('div', { className: 'two' },
          field('Le', inp('rdvDay', r.day, { type: 'date' })),
          field('à', inp('rdvTime', r.time, { type: 'time' }))),
        el('small', { className: 'hint', textContent: d.lettre ? '✓ Lettre de RDV reçue (changer la date l\'enlève).' : d.famille ? 'Famille : le même RDV pour tous les membres.' : 'Vide = pas de RDV.' })));
    }
    // 💰 Paiement
    const prix = inp('prix', d.prix, { inputMode: 'decimal', placeholder: 'ex : 1500' });
    const paye = inp('paye', d.paye, { inputMode: 'decimal', placeholder: '0' });
    const plus = inp('payAdd', '', { inputMode: 'decimal', placeholder: 'ex : 500' });
    const payHint = el('small', { className: 'hint' });
    const syncPay = () => {
      const p = pay({ prix: prix.value, paye: paye.value });
      payHint.className = 'hint ' + (p ? (p.reste > 0 ? 'warn' : 'ok') : '');
      payHint.textContent = !p ? 'Tapez le prix pour suivre ce qui reste à payer.' : p.reste > 0 ? `Reste à payer : ${money(p.reste)}` : '✓ Tout est payé';
    };
    prix.oninput = paye.oninput = syncPay;
    const addPay = () => {
      const v = amount(plus.value);
      if (!v) return plus.focus();
      paye.value = Math.round(((amount(paye.value) || 0) + v) * 100) / 100;
      plus.value = '';
      syncPay();
    };
    plus.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addPay(); } };
    parts.push(el('section', { className: 'cs' },
      el('h3', { textContent: 'Paiement' }),
      el('div', { className: 'two' }, field('Prix (DH)', prix), field('Déjà payé (DH)', paye)),
      el('label', { className: 'f' }, el('span', { textContent: 'Nouveau versement' }),
        el('div', { className: 'row' }, plus,
          el('button', { type: 'button', className: 'mini', textContent: '＋ Ajouter', onclick: addPay }),
          el('button', { type: 'button', className: 'mini', textContent: 'Tout payé', onclick: () => { if (amount(prix.value) === undefined) return prix.focus(); paye.value = amount(prix.value); syncPay(); } }))),
      payHint));
    queueMicrotask(syncPay);
    // 💬 WhatsApp (the client as saved)
    if (id) {
      const n = waNumber(d.mobile);
      parts.push(el('section', { className: 'cs' },
        el('h3', { textContent: 'WhatsApp' + (n ? ' · +' + n : '') }),
        n ? el('div', { className: 'wa' }, ...messages(d, a).map(m => el('a', { className: 'wa-btn', href: `https://wa.me/${n}?text=${encodeURIComponent(m.text)}`, target: '_blank', rel: 'noopener', textContent: m.label })))
          : el('small', { className: 'hint', textContent: 'Ajoutez le mobile (06… ou 07…) et enregistrez pour écrire au client.' }),
        n ? el('small', { className: 'hint', textContent: 'Le message s\'ouvre dans WhatsApp, vous pouvez le changer avant d\'envoyer.' }) : null));
    }
    parts.push(el('section', { className: 'cs', id: 'cfiles' }));
    f.append(...parts, el('div', { className: 'csave' }, el('button', { type: 'submit', className: 'primary', textContent: id ? 'Enregistrer' : 'Ajouter le client' })));
    f.onsubmit = e => { e.preventDefault(); save(f); };
    $('#client').replaceChildren(head, f);
    drawFiles();
  }

  function drawFiles() {
    const box = document.querySelector('#cfiles');
    if (!box || !cur) return;
    const { a, id, files, pending } = cur;
    const rows = SLOTS.filter(([s]) => s !== 'formulaire' || a === 'tls').map(([slot, label]) => {
      const have = files[slot] || [], p = pending[slot];
      const pick = el('input', { type: 'file', accept: slot === 'formulaire' ? 'application/pdf,image/*' : 'image/*', hidden: true });
      pick.onchange = async () => {
        const file = pick.files[0];
        if (!file) return;
        if (!id) { pending[slot] = file; drawFiles(); return; } // sent after «Ajouter le client»
        btn.disabled = true;
        btn.textContent = 'Envoi…';
        try { await upload(a, id, slot, file); toast(`✓ ${label} enregistré`); await loadFiles(); } catch (e) { toast('Pas envoyé : ' + e.message, true); drawFiles(); }
      };
      const btn = el('button', { type: 'button', className: 'mini', textContent: have.length || p ? '📷 Remplacer' : '📷 Ajouter', onclick: () => pick.click() });
      const state = p ? el('span', { className: 'ok', textContent: '✓ prêt, envoyé à l\'enregistrement' })
        : files.error ? el('span', { className: 'bad', textContent: 'Fichiers non disponibles' })
        : !id ? el('span', { textContent: 'Aucun' })
        : files[slot] === undefined ? el('span', { textContent: '…' })
        : have.length ? el('button', { type: 'button', className: 'link', textContent: 'Voir', onclick: () => view(a, have[0].path) })
        : el('span', { textContent: 'Aucun' });
      return el('li', {}, el('b', { textContent: label }), state, btn, pick);
    });
    box.replaceChildren(el('h3', { textContent: 'Fichiers' }), el('ul', { className: 'cfiles' }, ...rows),
      el('small', { className: 'hint', textContent: 'Photo du passeport : prenez-la bien à plat, page ouverte. L\'équipe complète le reste depuis le PC.' }));
  }

  async function save(f) {
    const { a, id } = cur, E = f.elements, v = k => E[k].value.trim();
    if (!v('prenom') && !v('nom')) return toast('Nom ou prénom obligatoire', true);
    const btn = f.querySelector('.csave button');
    btn.disabled = true;
    const patch = { prenom: v('prenom'), nom: v('nom'), mobile: v('mobile'), passeport: v('passeport').toUpperCase(), dossier: v('dossier') };
    patch.num = v('num') === '' ? undefined : +v('num');
    patch.prix = amount(v('prix'));
    patch.paye = amount(v('paye'));
    let family = null;
    if (a === 'tls') {
      for (const k of ['etape', 'manque', 'tlsCree', 'rdvDate', 'rdvHeure', 'rdvCentre', 'notes']) patch[k] = v(k) || undefined;
      patch.archive = E.archive.checked || undefined;
    } else {
      const before = cur.data.reserve || null, day = v('rdvDay'), time = v('rdvTime');
      let reserve = before;
      if (!day) reserve = null;
      else if (!before || before.day !== day || (before.time || '') !== time) reserve = { day, time, at: Date.now(), manual: true };
      if (JSON.stringify(reserve) !== JSON.stringify(before)) {
        patch.reserve = reserve || undefined;
        patch.lettre = undefined;
        if (reserve) patch.pret = false;
        family = cur.data.famille ? { famille: cur.data.famille, reserve } : null;
      }
    }
    const twin = patch.num !== undefined && AF.state[a].clients.find(c => c.id !== id && numOf(c) === patch.num);
    try {
      const newId = await write(a, id, patch);
      if (family) await writeFamily(a, newId, family);
      for (const [slot, file] of Object.entries(cur.pending)) await upload(a, newId, slot, file).catch(e => toast('Fichier pas envoyé : ' + e.message, true));
      toast(twin ? `Enregistré — attention : le N° ${patch.num} est aussi celui de ${AF.name(twin)}` : id ? '✓ Enregistré' : '✓ Client ajouté', !!twin);
      close();
      AF.render();
    } catch (e) {
      btn.disabled = false;
      toast('Pas enregistré : ' + (e.message || 'pas de connexion'), true);
    }
  }

  // Read the row, apply the changes, write it back: what the PCs changed meanwhile in other fields stays.
  async function write(a, id, patch) {
    const table = APPS[a].table, me = AF.me();
    let base = {};
    if (id) {
      const { data, error } = await sb.from(table).select('data').eq('id', id).maybeSingle();
      if (error) throw error;
      base = data?.data || {};
    }
    const newId = id || crypto.randomUUID();
    const data = JSON.parse(JSON.stringify({ ...base, ...patch, id: newId, ...(!id && { ajout: { by: me, pc: 'telephone', at: Date.now(), sent: false } }) }));
    const { error } = await sb.from(table).upsert({ id: newId, data, updated_at: new Date().toISOString(), updated_by: me });
    if (error) throw error;
    const s = AF.state[a];
    s.clients = [...s.clients.filter(c => c.id !== newId), AF.pick(a, { id: newId, data })];
    return newId;
  }
  // BLS: a family books together (same as the extension).
  async function writeFamily(a, selfId, { famille, reserve }) {
    for (const m of AF.state[a].clients.filter(c => c.famille === famille && c.id !== selfId)) {
      await write(a, m.id, { reserve: reserve || undefined, lettre: undefined, ...(reserve && { pret: false }) });
    }
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && cur) close(); });
  window.addEventListener('popstate', () => { if (cur) close(true); });

  return { render, open, pay, money };
})();
