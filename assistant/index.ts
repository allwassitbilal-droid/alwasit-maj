// 🤖 Al Wasit — assistant de l'agence sur Telegram (Supabase Edge Function «assistant»).
// On lui envoie un texte, un vocal, une photo ou un PDF ; l'IA (OpenRouter) comprend, propose les changements
// (nouveau client, RDV, paiement, tâche, fichier, caisse) et les enregistre après ✅ dans les mêmes tables que
// les extensions et le téléphone (clients = BLS 🇪🇸, clients_tls = TLS 🇫🇷, caisse).
// Secrets (Edge Functions → Secrets) : TELEGRAM_TOKEN, OPENROUTER_KEY, JOIN_CODE, WEBHOOK_SECRET [, AI_MODEL].
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis par Supabase.
// «Verify JWT» doit être désactivé pour cette fonction (Telegram n'envoie pas de JWT ; WEBHOOK_SECRET protège).

const env = (k: string) => Deno.env.get(k) || '';
const TG = env('TELEGRAM_TOKEN');
const SB = env('SUPABASE_URL');
const SK = env('SUPABASE_SERVICE_ROLE_KEY');
const MODEL = env('AI_MODEL') || 'google/gemini-2.5-flash';
const TZ = 'Africa/Casablanca';
// WEBHOOK_SECRET may hold any characters (or a stray space / new line): Telegram gets its SHA-256 (hex only).
const SECRET = () => env('WEBHOOK_SECRET').trim();
async function hookToken() {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('alwasit:' + SECRET()));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const APPS: Record<string, { table: string; bucket: string; slots: string[]; label: string }> = {
  bls: { table: 'clients', bucket: 'fichiers', slots: ['formulaire', 'photo', 'passeport', 'lettre'], label: 'BLS 🇪🇸' },
  tls: { table: 'clients_tls', bucket: 'fichiers-tls', slots: ['formulaire', 'photo', 'passeport'], label: 'TLS 🇫🇷' },
};
const TEAM = '__equipe__';
const CAISSE_IN = ['rdv-es', 'rdv-fr', 'vfs', 'reservation', 'formulaire', 'traduction', 'divers-in'];
const CAISSE_OUT = ['achat-rdv', 'frais-vfs', 'traducteur', 'loyer', 'charges', 'salaires', 'fournitures', 'divers-out'];
const FIELDS = ['prenom', 'nom', 'passeport', 'naissance', 'expire', 'delivre', 'lieu', 'mobile', 'gmail', 'num', 'prix', 'paye', 'dossier', 'lien', 'notes', 'manque', 'etape', 'pret', 'archive'];

// ---------- small helpers ----------
const today = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const nowText = () => new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date());
const fr = (iso?: string) => (iso ? iso.split('-').reverse().join('/') : '');
const nameOf = (c: any) => `${c?.prenom || ''} ${c?.nom || ''}`.trim() || '(sans nom)';
const rid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);
const num = (v: any) => { const n = parseFloat(String(v ?? '').replace(',', '.').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };
function b64(buf: ArrayBuffer) {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------- Supabase (REST, service role) ----------
async function sb(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...init, headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
async function getRow(table: string, id: string) {
  const rows = await sb(`${table}?id=eq.${encodeURIComponent(id)}&select=id,data`);
  return rows?.[0]?.data ?? null;
}
async function putRow(table: string, id: string, data: any, by: string) {
  await sb(`${table}?on_conflict=id`, {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id, data: JSON.parse(JSON.stringify(data)), updated_at: new Date().toISOString(), updated_by: by }),
  });
}
async function delRow(table: string, id: string) { await sb(`${table}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }); }
async function allRows(table: string) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = await sb(`${table}?select=id,data&order=id`, { headers: { Range: `${from}-${from + 999}` } });
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}
async function upload(bucket: string, path: string, bytes: ArrayBuffer, type: string) {
  const r = await fetch(`${SB}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST', headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': type || 'application/octet-stream', 'x-upsert': 'true' }, body: bytes,
  });
  if (!r.ok) throw new Error(`Fichier ${r.status}: ${(await r.text()).slice(0, 150)}`);
}
async function listFiles(bucket: string, prefix: string) {
  const r = await fetch(`${SB}/storage/v1/object/list/${bucket}`, {
    method: 'POST', headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix, limit: 20 }),
  });
  return r.ok ? (await r.json()).filter((f: any) => f.id).map((f: any) => `${prefix}/${f.name}`) : [];
}
async function removeFiles(bucket: string, paths: string[]) {
  if (!paths.length) return;
  await fetch(`${SB}/storage/v1/object/${bucket}`, {
    method: 'DELETE', headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }),
  });
}

// The assistant's own small table: users, pending proposals, short chat memory.
const A = 'assistant';
const aGet = (id: string) => getRow(A, id);
const aPut = (id: string, data: any) => putRow(A, id, data, 'assistant');

// ---------- Telegram ----------
async function tg(method: string, body: any) {
  const r = await fetch(`https://api.telegram.org/bot${TG}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
const send = (chat: number, text: string, extra: any = {}) => tg('sendMessage', { chat_id: chat, text: text.slice(0, 4000), ...extra });
async function tgFile(fileId: string) {
  const f = await tg('getFile', { file_id: fileId });
  if (!f.ok) throw new Error('Telegram: fichier introuvable (max 20 Mo)');
  const r = await fetch(`https://api.telegram.org/file/bot${TG}/${f.result.file_path}`);
  return { bytes: await r.arrayBuffer(), path: f.result.file_path as string };
}

// ---------- context for the AI ----------
function clientLine(app: string, c: any) {
  const r = app === 'bls' ? (c.reserve?.day ? `RDV ${c.reserve.day} ${c.reserve.time || ''}${c.reserve.centre ? ' ' + c.reserve.centre : ''}` : '')
    : (c.rdvDate ? `RDV ${c.rdvDate} ${c.rdvHeure || ''}${c.rdvCentre ? ' ' + c.rdvCentre : ''}` : '');
  const pay = c.prix != null && c.prix !== '' ? `prix ${num(c.prix)} payé ${num(c.paye)}` : '';
  return [app, c.id, c.num != null && c.num !== '' ? 'N°' + c.num : '', nameOf(c), c.passeport, c.naissance && 'né ' + c.naissance,
    c.mobile, c.famille && 'famille ' + c.famille + (c.lien ? ' ' + c.lien : ''), c.etape && 'étape ' + c.etape, r, pay,
    c.pret && '⭐prêt', c.archive && 'archivé', c.manque && 'manque: ' + c.manque, c.dossier && 'dossier ' + c.dossier]
    .filter(Boolean).join(' | ');
}

/** Written tasks of both apps (À faire), deleted ones left out: one line each, with their id. */
function taskLines(data: any) {
  const out: string[] = [];
  for (const app of ['bls', 'tls']) {
    const byId = new Map(data[app].clients.map((c: any) => [c.id, c]));
    for (const t of data[app].team.tasks || []) {
      if (!t?.id || t.deleted || String(t.id).startsWith('auto:') || !t.text) continue;
      const c: any = t.clientId && byId.get(t.clientId);
      const added = t.cree ? new Date(t.cree).toISOString().slice(0, 10) : '';
      out.push([app, t.id, t.day || '', t.done ? `FAITE${t.doneBy ? ' par ' + t.doneBy : ''}` : (t.day && t.day < today() ? 'EN RETARD' : 'à faire'),
        t.text, c && 'client ' + nameOf(c), t.by && 'par ' + t.by, added && 'ajoutée ' + added].filter(Boolean).join(' | '));
    }
  }
  return out;
}

async function loadAll() {
  const [bls, tls] = await Promise.all([allRows(APPS.bls.table), allRows(APPS.tls.table)]);
  const split = (rows: any[]) => ({ team: rows.find(r => r.id === TEAM)?.data || {}, clients: rows.filter(r => r.id !== TEAM && r.data).map(r => ({ ...r.data, id: r.id })) });
  return { bls: split(bls), tls: split(tls) };
}

const SYSTEM = (who: string, ctx: string, tasks: string) => `Tu es l'assistant de l'agence de visas «Al Wasit» (Maroc). Tu parles avec ${who}, un membre de l'équipe.
Il t'envoie des messages en darija (arabe ou latin), français, des vocaux, des photos (passeport, CIN, reçu…) ou des PDF (lettre de rendez-vous BLS/TLS…).
Deux activités : «bls» = visas Espagne (BLS), «tls» = visas France (TLS). Une famille partage le même champ «famille».
Date et heure actuelles : ${nowText()} (aujourd'hui = ${today()}).

Réponds UNIQUEMENT en JSON : {"heard": "...", "reply": "...", "actions": [...]}
- heard : si le message contient un vocal, ce que tu as entendu (transcription courte) ; sinon "".
- reply : réponse en darija écrite en arabe (comme un collègue), qui dit ce que tu as compris et ce que tu proposes. Pour une question, la réponse COMPLÈTE est dans reply : toutes les lignes (une par client : N°, nom, date, heure, centre…), séparées par \n. Ne mets jamais la liste dans un autre champ et ne termine jamais reply par «:» sans la liste.
- actions : les changements à enregistrer (vide si c'est juste une question ou si une info manque : alors demande-la dans reply).
Types d'actions (n'utilise QUE des ids de la liste des clients ci-dessous ; jamais d'id inventé) :
1. {"type":"create_client","app":"bls|tls","fields":{...},"attach":"passeport|photo|formulaire|lettre|null"} — nouveau client (ex : photo de passeport). Avant, vérifie qu'il n'existe pas déjà (même passeport ou même nom) : sinon update_client.
2. {"type":"update_client","app":"...","id":"...","fields":{...}}
3. {"type":"set_rdv","app":"...","id":"...","day":"YYYY-MM-DD","time":"HH:MM","centre":"Tétouan","ref":"TTU-123456-26"} — rendez-vous (lettre BLS : la date du RDV est la plage horaire «2026-11-23 08:50-09:10», pas la date de paiement).
4. {"type":"add_payment","app":"...","id":"...","montant":500,"caisse":false,"mode":"especes|virement|carte|cheque"} — le client a payé (ajouté à «paye»). caisse=true seulement si on demande aussi de l'écrire dans la caisse.
5. {"type":"add_task","app":"...","text":"...","day":"YYYY-MM-DD","id":"id client ou null"} — tâche «À faire».
5b. {"type":"task_done","app":"...","task":"id de la tâche","done":true} — cocher (ou décocher avec false) une tâche de la liste des tâches.
6. {"type":"attach_file","app":"...","id":"...","slot":"passeport|photo|formulaire|lettre"} — ranger le fichier reçu dans le dossier («lettre» seulement pour bls).
7. {"type":"caisse","sens":"in|out","cat":"${[...CAISSE_IN, ...CAISSE_OUT].join('|')}","montant":0,"date":"YYYY-MM-DD","mode":"especes","client":"nom ou vide","note":"..."} — opération de caisse demandée explicitement.
Champs possibles (fields) : ${FIELDS.join(', ')}. Dates en YYYY-MM-DD. Noms en MAJUSCULES comme sur le passeport (prenom, nom). tls «etape» : nouveau|docs|manque|complet|rdv. pret = true/false (⭐ prêt pour réserver).
Pour une lettre de RDV : set_rdv + attach_file slot «lettre» (bls) sur le bon client. Pour une photo de passeport d'un client existant : update_client (champs manquants) + attach_file «passeport».
Si l'activité (bls/tls) n'est pas claire : Espagne/BLS = bls, France/TLS = tls ; si le client n'existe que dans une liste, c'est celle-là ; sinon demande.
Trouve le client même si le nom est mal écrit ou en arabe. S'il y a plusieurs clients possibles, demande lequel (donne N° et nom) au lieu d'agir.
8. {"type":"clear_rdv","app":"...","id":"..."} — enlever un rendez-vous enregistré par erreur (seulement si on le demande).
Présentation des réponses : jamais le format brut de la liste (pas de «bls |», pas de dates AAAA-MM-JJ). Une ligne par client, triée par date : «• الخميس 26/11 مع 09:15 — N°12 Mohammed FAIZ (تطوان)». «Cette semaine / les prochains jours» = à partir d'aujourd'hui ; ne mélange pas les RDV passés avec ceux à venir (si utile, une ligne «فاتو:» à part).
Ne propose jamais de supprimer un client ou un fichier. Ne mets pas de mot de passe ni de code.

Rapports : pour «rapport / خلاصة / تقرير», donne un résumé clair par activité (BLS 🇪🇸, TLS 🇫🇷) : nombre de clients, RDV à venir (et aujourd'hui/demain), ⭐ prêts, reste à payer (total + qui), dossiers où il manque des documents, et les tâches : en retard, aujourd'hui, à venir, faites récemment (avec qui les a faites). Titres courts avec emoji, listes à puces.

Tâches «À faire» (app | id tâche | jour | état | texte | client | ajoutée par | date d'ajout) :
${tasks || '(aucune)'}

Liste des clients (app | id | N° | nom | passeport | naissance | mobile | famille | étape | RDV | paiement | …) :
${ctx}`;

async function ask(who: string, ctx: string, tasks: string, history: any[], content: any[]) {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('OPENROUTER_KEY')}`, 'Content-Type': 'application/json', 'X-Title': 'Al Wasit assistant' },
    body: JSON.stringify({
      model: MODEL, temperature: 0.1, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM(who, ctx, tasks) }, ...history, { role: 'user', content }],
    }),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error('IA : ' + (j.error?.message || r.status));
  const text = j.choices?.[0]?.message?.content || '';
  const m = text.match(/\{[\s\S]*\}/);
  try { return JSON.parse(m ? m[0] : text); } catch { return { reply: text || 'ما فهمتش، عاود من فضلك', actions: [] }; }
}

/** Anything the model put outside heard / reply / actions (a list…), as text, so nothing is lost. */
function extras(out: any): string[] {
  const line = (v: any): string => (v == null ? '' : typeof v !== 'object' ? String(v)
    : Array.isArray(v) ? v.map(x => '• ' + line(x)).join('\n') : Object.values(v).filter(x => x != null && x !== '').map(line).join(' · '));
  return Object.entries(out || {}).filter(([k]) => !['heard', 'reply', 'actions'].includes(k)).map(([, v]) => line(v)).filter(Boolean);
}

// ---------- describe and apply actions ----------
function find(data: any, app: string, id: string) { return data[app]?.clients.find((c: any) => c.id === id); }

function describe(a: any, data: any) {
  const ap = APPS[a.app]?.label || '';
  const c = a.id ? find(data, a.app, a.id) : null;
  const who = c ? `${c.num != null && c.num !== '' ? 'N°' + c.num + ' ' : ''}${nameOf(c)}` : '';
  const f = (o: any) => Object.entries(o || {}).filter(([, v]) => v !== null && v !== '' && v !== undefined).map(([k, v]) => `${k}: ${v}`).join('، ');
  switch (a.type) {
    case 'create_client': return `🆕 كليان جديد ${ap}: ${nameOf(a.fields)}\n   ${f(a.fields)}${a.attach ? `\n   📎 الوثيقة ← ${a.attach}` : ''}`;
    case 'update_client': return `✏️ ${who} (${ap}): ${f(a.fields)}`;
    case 'set_rdv': return `🗓 موعد ${ap} — ${who}: ${fr(a.day)} ${a.time || ''}${a.centre ? ' · ' + a.centre : ''}${a.ref ? ' · ' + a.ref : ''}`;
    case 'add_payment': return `💰 ${who} خلص ${num(a.montant)} DH${c ? ` (كان خالص ${num(c.paye)}${c.prix ? ' من ' + num(c.prix) : ''})` : ''}${a.caisse ? ' + فالكاسة' : ''}`;
    case 'add_task': return `📋 مهمة ${fr(a.day || today())}: ${a.text}${who ? ' — ' + who : ''}`;
    case 'task_done': {
      const t = (data[a.app]?.team.tasks || []).find((x: any) => x.id === a.task);
      return `${a.done === false ? '↩️ نرجعو للمهام' : '☑️ مهمة دارت'}: ${t?.text || a.task}`;
    }
    case 'attach_file': return `📎 الوثيقة ← ${who} (${a.slot})`;
    case 'clear_rdv': return `🗑 نحيد الموعد ديال ${who} (${ap})`;
    case 'caisse': return `💵 كاسة ${a.sens === 'out' ? 'خروج −' : 'دخول +'}${num(a.montant)} DH · ${a.cat}${a.client ? ' · ' + a.client : ''}${a.note ? ' · ' + a.note : ''}`;
    default: return '';
  }
}

/** Keeps only what can be applied: known types, known clients, a file when one is needed. */
function valid(actions: any[], data: any, hasFile: boolean) {
  return (Array.isArray(actions) ? actions : []).filter(a => {
    if (!a || typeof a !== 'object') return false;
    if (a.type === 'caisse') return num(a.montant) > 0;
    if (!APPS[a.app]) return false;
    if (a.type === 'create_client') { if (!hasFile) a.attach = null; return !!(a.fields?.nom || a.fields?.prenom); }
    if (a.type === 'add_task') return !!a.text && (!a.id || !!find(data, a.app, a.id));
    if (a.type === 'task_done') return (data[a.app].team.tasks || []).some((t: any) => t.id === a.task && !t.deleted);
    if (!find(data, a.app, a.id)) return false;
    if (a.type === 'attach_file') return hasFile && APPS[a.app].slots.includes(a.slot);
    if (a.type === 'set_rdv') return /^\d{4}-\d{2}-\d{2}$/.test(a.day || '');
    if (a.type === 'add_payment') return num(a.montant) > 0;
    if (a.type === 'clear_rdv') return true;
    return a.type === 'update_client';
  });
}

const clean = (fields: any) => Object.fromEntries(Object.entries(fields || {}).filter(([k, v]) => FIELDS.includes(k) && v !== null && v !== undefined && v !== ''));

async function saveFile(app: string, id: string, slot: string, file: any) {
  const { bucket } = APPS[app];
  const { bytes } = await tgFile(file.id);
  const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] || (file.mime === 'application/pdf' ? '.pdf' : '.jpg')).toLowerCase();
  const name = (file.name || 'fichier').replace(/\.[^.]*$/, '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-60) + ext;
  const old = await listFiles(bucket, `${id}/${slot}`);
  await upload(bucket, `${id}/${slot}/${name}`, bytes, file.mime);
  await removeFiles(bucket, old.filter((p: string) => p !== `${id}/${slot}/${name}`));
}

async function apply(p: any) {
  const by = p.by, done: string[] = [];
  for (const a of p.actions) {
    try {
      const T = APPS[a.app]?.table;
      if (a.type === 'create_client') {
        const id = crypto.randomUUID();
        await putRow(T, id, { ...clean(a.fields), id, ajout: { by, pc: 'assistant', at: Date.now(), sent: false } }, by);
        if (a.attach && p.file) await saveFile(a.app, id, a.attach, p.file);
        done.push(`✅ ${nameOf(a.fields)} تزاد`);
        continue;
      }
      if (a.type === 'caisse') {
        const id = crypto.randomUUID();
        const op = { id, sens: a.sens === 'out' ? 'out' : 'in', cat: a.cat || (a.sens === 'out' ? 'divers-out' : 'divers-in'), montant: num(a.montant),
          date: a.date || today(), mode: a.mode || 'especes', client: a.client || '', note: a.note || '', par: by, cree: Date.now(), by };
        await putRow('caisse', id, op, by);
        done.push(`✅ الكاسة: ${op.sens === 'in' ? '+' : '−'}${op.montant} DH`);
        continue;
      }
      if (a.type === 'add_task') {
        const team = (await getRow(T, TEAM)) || {};
        const t = { id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), cree: Date.now(), at: Date.now(), text: a.text, day: a.day || today(), clientId: a.id || undefined, by };
        await putRow(T, TEAM, { ...team, tasks: [...(team.tasks || []), t] }, by);
        done.push(`✅ المهمة تزادت (${fr(t.day)})`);
        continue;
      }
      if (a.type === 'task_done') {
        const team = (await getRow(T, TEAM)) || {};
        const isDone = a.done !== false;
        const tasks = (team.tasks || []).map((t: any) => (t.id === a.task ? { ...t, done: isDone, doneBy: isDone ? by : undefined, at: Date.now() } : t));
        await putRow(T, TEAM, { ...team, tasks }, by);
        done.push(isDone ? '✅ المهمة تعلمات «دارت»' : '✅ المهمة رجعات «باقي»');
        continue;
      }
      const c = await getRow(T, a.id);
      if (!c) { done.push('⚠️ الكليان ما بقاش موجود'); continue; }
      if (a.type === 'update_client') {
        await putRow(T, a.id, { ...c, ...clean(a.fields) }, by);
        done.push(`✅ ${nameOf(c)} تبدل`);
      } else if (a.type === 'add_payment') {
        const paye = Math.round((num(c.paye) + num(a.montant)) * 100) / 100;
        await putRow(T, a.id, { ...c, paye }, by);
        if (a.caisse) {
          const id = crypto.randomUUID();
          await putRow('caisse', id, { id, sens: 'in', cat: a.app === 'bls' ? 'rdv-es' : 'rdv-fr', montant: num(a.montant), date: today(), mode: a.mode || 'especes', client: nameOf(c), note: 'Assistant', par: by, cree: Date.now(), by }, by);
        }
        const reste = c.prix ? Math.max(0, num(c.prix) - paye) : null;
        done.push(`✅ ${nameOf(c)}: خالص ${paye} DH${reste != null ? ` · باقي ${reste} DH` : ''}`);
      } else if (a.type === 'set_rdv') {
        if (a.app === 'bls') {
          const reserve = { day: a.day, time: a.time || '', at: Date.now(), manual: true, ...(a.centre && { centre: a.centre }), ...(a.ref && { ref: a.ref }) };
          const fam = c.famille ? (await allRows(T)).filter(r => r.data?.famille === c.famille).map(r => r.data) : [c];
          for (const m of fam) { const x = { ...m, reserve, pret: false }; delete x.lettre; await putRow(T, m.id, x, by); }
          done.push(`✅ الموعد تسجل ${fam.length > 1 ? `للعائلة (${fam.length})` : 'لـ ' + nameOf(c)}`);
        } else {
          await putRow(T, a.id, { ...c, etape: 'rdv', rdvDate: a.day, rdvHeure: a.time || '', ...(a.centre && { rdvCentre: a.centre }) }, by);
          done.push(`✅ الموعد تسجل لـ ${nameOf(c)}`);
        }
      } else if (a.type === 'clear_rdv') {
        if (a.app === 'bls') {
          const fam = c.famille ? (await allRows(T)).filter(r => r.data?.famille === c.famille).map(r => r.data) : [c];
          for (const m of fam) { const x = { ...m }; delete x.reserve; delete x.lettre; await putRow(T, m.id, x, by); }
        } else {
          const x = { ...c }; delete x.rdvDate; delete x.rdvHeure; delete x.rdvCentre; if (x.etape === 'rdv') x.etape = 'complet';
          await putRow(T, a.id, x, by);
        }
        done.push(`✅ الموعد ديال ${nameOf(c)} تحيد`);
      } else if (a.type === 'attach_file' && p.file) {
        await saveFile(a.app, a.id, a.slot, p.file);
        done.push(`✅ الوثيقة تحفظات فـ ${nameOf(c)} (${a.slot})`);
      }
    } catch (e) { done.push('❌ ' + (e as Error).message); }
  }
  return done;
}

// ---------- conversation ----------
async function users() { return ((await aGet('users')) || {}) as Record<string, { name: string; at: number }>; }

async function onMessage(m: any) {
  const chat = m.chat.id, uid = String(m.from?.id || '');
  const text = (m.text || m.caption || '').trim();
  const us = await users();
  const join = text.match(/^\/start\s+(\S+)/) || text.match(/^\/code\s+(\S+)/);
  if (join) {
    if (join[1] !== env('JOIN_CODE')) return send(chat, '⛔ الكود غالط.');
    us[uid] = { name: m.from?.first_name || 'Équipe', at: Date.now() };
    await aPut('users', us);
    return send(chat, `👋 مرحبا ${us[uid].name}! دابا تقدر تصيفط ليا:\n• ✍️ ميساج: «محمد فايز خلص 500 درهم»\n• 🎙 أوديو بالدارجة\n• 📷 تصويرة باسبور ولا وثيقة\n• 📄 PDF ديال لتر الموعد\n• ❓ سؤال: «شكون عندو موعد هاد السيمانة؟»\nوكنسولك ديما قبل ما نسجل.\nباش تبدل سميتك: /nom Bilal`);
  }
  if (!us[uid]) return send(chat, '🔒 هاد البوت خاص بالوكالة. صيفط: /start والكود ديال الإكيب.');
  const nm = text.match(/^\/nom\s+(.{2,30})$/);
  if (nm) { us[uid].name = nm[1].trim(); await aPut('users', us); return send(chat, `✓ سميتك دابا: ${us[uid].name}`); }
  if (text === '/start' || text === '/aide') return send(chat, 'صيفط ليا أوديو، تصويرة، PDF ولا ميساج، وأنا نسجل فالدوسيات من بعد ما توافق ✅');
  const by = us[uid].name;

  // the message's file (photo, PDF, image, voice)
  let file: any = null;
  if (m.photo?.length) file = { id: m.photo[m.photo.length - 1].file_id, mime: 'image/jpeg', name: 'photo.jpg', kind: 'image' };
  else if (m.document) {
    const mime = m.document.mime_type || '';
    if (/pdf|image\//.test(mime)) file = { id: m.document.file_id, mime, name: m.document.file_name || 'document', kind: /pdf/.test(mime) ? 'pdf' : 'image' };
    else return send(chat, '⚠️ كنقبل غير PDF ولا التصاور.');
  } else if (m.voice || m.audio) {
    const v = m.voice || m.audio;
    file = { id: v.file_id, mime: v.mime_type || 'audio/ogg', name: 'vocal.ogg', kind: 'audio' };
  }
  if (!text && !file) return;

  await tg('sendChatAction', { chat_id: chat, action: 'typing' });
  const content: any[] = [{ type: 'text', text: text || (file?.kind === 'audio' ? '(vocal)' : '(fichier sans texte : comprends ce que c\'est et propose)') }];
  if (file) {
    const { bytes, path } = await tgFile(file.id);
    const data = b64(bytes);
    if (file.kind === 'image') content.push({ type: 'image_url', image_url: { url: `data:${file.mime};base64,${data}` } });
    else if (file.kind === 'pdf') content.push({ type: 'file', file: { filename: file.name, file_data: `data:application/pdf;base64,${data}` } });
    else content.push({ type: 'input_audio', input_audio: { data, format: (path.split('.').pop() || 'ogg').replace('oga', 'ogg') } });
  }

  const data = await loadAll();
  const ctx = [...data.bls.clients.map(c => clientLine('bls', c)), ...data.tls.clients.map(c => clientLine('tls', c))].join('\n');
  const memKey = 'mem:' + chat;
  const mem = ((await aGet(memKey)) || { h: [] }).h.filter((x: any) => Date.now() - x.at < 2 * 3600_000);
  const history = mem.flatMap((x: any) => [{ role: 'user', content: x.u }, { role: 'assistant', content: x.a }]);

  const out = await ask(by, ctx, taskLines(data).join('\n'), history, content);
  out.reply = [out.reply, ...extras(out)].filter(Boolean).join('\n');
  const actions = valid(out.actions, data, !!file);
  await aPut(memKey, { h: [...mem, { at: Date.now(), u: (out.heard ? '🎙 ' + out.heard : text || '(fichier)') + (file && file.kind !== 'audio' ? ` [${file.kind}]` : ''), a: JSON.stringify({ reply: out.reply, actions }) }].slice(-6) });

  const head = (out.heard ? `🎙 سمعت: «${out.heard}»\n\n` : '') + (out.reply || '');
  if (!actions.length) return send(chat, head || 'ما فهمتش، عاود من فضلك 🙏');
  const id = rid();
  await aPut('p:' + id, { chat, by, at: Date.now(), actions, file: file && file.kind !== 'audio' ? file : null });
  return send(chat, `${head}\n\n${actions.map(a => describe(a, data)).join('\n')}`, {
    reply_markup: { inline_keyboard: [[{ text: '✅ سجّل', callback_data: 'ok:' + id }, { text: '❌ لا', callback_data: 'no:' + id }]] },
  });
}

async function onCallback(q: any) {
  const [what, id] = String(q.data || '').split(':');
  const chat = q.message?.chat?.id, msgId = q.message?.message_id;
  const us = await users();
  if (!us[String(q.from?.id)]) return tg('answerCallbackQuery', { callback_query_id: q.id, text: '🔒' });
  const p = await aGet('p:' + id);
  const strip = (extra: string) => tg('editMessageText', { chat_id: chat, message_id: msgId, text: `${q.message?.text || ''}\n\n${extra}`.slice(0, 4000) });
  if (!p) { await tg('answerCallbackQuery', { callback_query_id: q.id, text: 'ديجا تدار' }); return; }
  await delRow(A, 'p:' + id);
  if (what === 'no') { await tg('answerCallbackQuery', { callback_query_id: q.id, text: 'تلغى' }); return strip('❌ تلغى، ما تسجل والو.'); }
  await tg('answerCallbackQuery', { callback_query_id: q.id, text: '⏳' });
  const done = await apply({ ...p, by: us[String(q.from?.id)].name });
  return strip(done.join('\n'));
}

async function handle(u: any) {
  const chat = u.message?.chat?.id;
  try {
    if (u.callback_query) await onCallback(u.callback_query);
    else if (u.message) await onMessage(u.message);
  } catch (e) {
    console.error(e);
    if (chat) await send(chat, '⚠️ وقع مشكل: ' + (e as Error).message);
  }
}

Deno.serve(async req => {
  const url = new URL(req.url);
  // One-time setup from the phone: open …/functions/v1/assistant?setup=<WEBHOOK_SECRET>
  if (req.method === 'GET') {
    const given = (url.searchParams.get('setup') || '').trim();
    if (!given) return new Response('Al Wasit assistant ✓', { status: 200 });
    if (given !== SECRET()) return new Response('⚠️ setup= ne correspond pas à WEBHOOK_SECRET (' + given.length + ' / ' + SECRET().length + ' caractères)', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    const missing = ['TELEGRAM_TOKEN', 'OPENROUTER_KEY', 'JOIN_CODE', 'WEBHOOK_SECRET'].filter(k => !env(k));
    if (missing.length) return new Response('Secrets manquants : ' + missing.join(', '), { status: 200 });
    const hook = `${SB}/functions/v1/assistant`;
    const r = await tg('setWebhook', { url: hook, secret_token: await hookToken(), allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
    await tg('setMyCommands', { commands: [{ command: 'aide', description: 'Comment ça marche' }, { command: 'nom', description: 'Changer mon nom' }] });
    const t = await getRow(A, 'users').then(() => '✓ table assistant OK', e => '✗ table assistant : ' + e.message);
    return new Response(`${r.ok ? '✅ Webhook installé' : '❌ ' + r.description}\n${t}\nModèle : ${MODEL}`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  if (!SECRET() || req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== await hookToken()) return new Response('forbidden', { status: 403 });
  const update = await req.json().catch(() => null);
  if (update) {
    const job = handle(update);
    // Answer Telegram at once; the work goes on in the background.
    // @ts-ignore EdgeRuntime exists on Supabase
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(job); else await job;
  }
  return new Response('ok');
});
