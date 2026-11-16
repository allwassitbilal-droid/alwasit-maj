// «Bilan» tab: the month at a glance for the chosen extension (TLS or BLS): new clients, appointments,
// clients by folder, money of the month's files, the stages now, and every file with something left to pay.
globalThis.AFBilan = (() => {
  const { el } = AF;
  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const ETAPES = { nouveau: '🆕 Nouveau', docs: '📄 Documents', manque: '⚠️ Il manque', complet: '✅ Complet', rdv: '🗓 RDV pris' };
  let month = AF.ymd().slice(0, 7); // YYYY-MM
  const shift = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const label = m => { const [y, mo] = m.split('-').map(Number); return `${MONTHS[mo - 1]} ${y}`; };
  const addedIn = (c, m) => { const at = c.ajout?.at; return at ? AF.ymd(new Date(at)).slice(0, 7) === m : false; };
  const rdvDay = (a, c) => (a === 'tls' ? (c.rdvDate || '') : (c.reserve?.day || ''));

  function tile(n, text, cls = '') {
    return el('div', { className: 'tile ' + cls }, el('b', { textContent: String(n) }), el('span', { textContent: text }));
  }
  function bars(rows) {
    const max = Math.max(1, ...rows.map(r => r[1]));
    return el('ul', { className: 'bars' }, ...rows.map(([k, n]) => el('li', {},
      el('span', { className: 'bk', textContent: k }),
      el('span', { className: 'bt' }, el('i', { style: `width:${Math.max(4, (n / max) * 100)}%` })),
      el('b', { textContent: String(n) }))));
  }
  const section = (title, ...kids) => el('section', { className: 'bs' }, el('h3', { textContent: title }), ...kids);

  function render(list) {
    const a = AF.app(), all = AF.state[a].clients;
    const { pay, money } = AFClients;
    const now = AF.ymd().slice(0, 7);
    const nav = el('div', { className: 'bnav' },
      el('button', { type: 'button', textContent: '‹', ariaLabel: 'Mois précédent', onclick: () => { month = shift(month, -1); render(list); } }),
      el('b', { textContent: label(month) }),
      el('button', { type: 'button', textContent: '›', ariaLabel: 'Mois suivant', disabled: month >= now, onclick: () => { month = shift(month, 1); render(list); } }));

    const added = all.filter(c => addedIn(c, month));
    const rdv = all.filter(c => rdvDay(a, c).slice(0, 7) === month);
    const money3 = added.reduce((s, c) => { const p = pay(c); if (p) { s.prix += p.prix; s.paye += Math.min(p.paye, p.prix); s.reste += p.reste; s.n++; } return s; }, { prix: 0, paye: 0, reste: 0, n: 0 });
    const kids = [nav,
      el('div', { className: 'tiles' },
        tile(added.length, added.length > 1 ? 'nouveaux clients' : 'nouveau client'),
        tile(rdv.length, 'RDV ce mois'),
        tile(money3.prix ? money(money3.prix) : '—', 'prix des dossiers', 'wide'))];

    // By folder (new clients of the month)
    const byFolder = new Map();
    for (const c of added) byFolder.set(c.dossier || 'Sans dossier', (byFolder.get(c.dossier || 'Sans dossier') || 0) + 1);
    kids.push(section('Nouveaux clients par dossier', byFolder.size ? bars([...byFolder].sort((x, y) => y[1] - x[1]))
      : el('p', { className: 'bempty', textContent: 'Aucun client ajouté ce mois.' })));

    // Money of the month's files
    kids.push(section('Argent des dossiers du mois',
      money3.n ? el('div', { className: 'money' },
        el('div', {}, el('span', { textContent: 'Prix' }), el('b', { textContent: money(money3.prix) })),
        el('div', {}, el('span', { textContent: 'Payé' }), el('b', { className: 'ok', textContent: money(money3.paye) })),
        el('div', {}, el('span', { textContent: 'Reste' }), el('b', { className: money3.reste ? 'due' : 'ok', textContent: money(money3.reste) })))
        : el('p', { className: 'bempty', textContent: 'Aucun prix tapé pour les dossiers de ce mois (Clients → un client → Paiement).' }),
      money3.n && money3.n < added.length ? el('p', { className: 'bnote', textContent: `${added.length - money3.n} dossier(s) du mois sans prix.` }) : null));

    // Stages now (TLS)
    if (a === 'tls') {
      const live = all.filter(c => !c.archive), counts = new Map();
      for (const c of live) counts.set(ETAPES[c.etape] || '— Sans étape', (counts.get(ETAPES[c.etape] || '— Sans étape') || 0) + 1);
      kids.push(section(`Dossiers en cours maintenant · ${live.length}`, bars(Object.values(ETAPES).concat('— Sans étape').filter(k => counts.has(k)).map(k => [k, counts.get(k)]))));
    }

    // Everything left to pay (all months)
    const due = all.filter(c => !c.archive && pay(c)?.reste > 0).sort((x, y) => pay(y).reste - pay(x).reste);
    const total = due.reduce((s, c) => s + pay(c).reste, 0);
    kids.push(section(`Reste à payer · tous les dossiers`,
      due.length ? el('p', { className: 'btotal' }, el('b', { textContent: money(total) }), ` sur ${due.length} dossier${due.length > 1 ? 's' : ''}`) : el('p', { className: 'bempty', textContent: 'Personne ne doit rien 👌' }),
      due.length ? el('ul', { className: 'due' }, ...due.slice(0, 50).map(c => el('li', {},
        el('button', { type: 'button', onclick: () => AFClients.open(c.id) },
          el('span', { textContent: AF.label(c) }), el('b', { textContent: money(pay(c).reste) }))))) : null));

    const old = all.filter(c => !c.ajout?.at).length;
    if (old) kids.push(el('p', { className: 'bnote', textContent: `${old} client(s) ajoutés avant le suivi des dates ne comptent pas dans « nouveaux clients ».` }));
    list.replaceChildren(el('div', { className: 'bilan' }, ...kids));
  }

  return { render };
})();
