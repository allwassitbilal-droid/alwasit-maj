// 🔒 The team's 4-digit code for the money pages (Caisse, 📝 Traductions), on the phone and in the extensions.
// One code for the whole team: whoever has it can open these pages; it stays the same until someone changes it
// (with the old code). Kept hashed (never the digits) in the row "__code__" of the Supabase table "traductions",
// so the phone, Caisse and both extensions read the same one. The first person to open a locked page chooses it.
// Same file in telephone/ and in both extensions: the page gives get() / set() to read and write that row.
globalThis.AAPin = (() => {
  const CSS = `
.pin-wrap { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center; padding: 20px;
  background: rgba(8, 18, 32, .97); color: #E8EEF6; font: 15px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
.pin-box { width: 100%; max-width: 300px; display: flex; flex-direction: column; align-items: center; gap: 14px; text-align: center; }
.pin-lock { font-size: 30px; line-height: 1; }
.pin-box h2 { margin: 0; font-size: 19px; font-weight: 700; }
.pin-box p { margin: 0; color: #8FA3BF; font-size: 13px; min-height: 1.4em; }
.pin-box p.bad { color: #FF7A80; }
.pin-dots { display: flex; gap: 14px; margin: 4px 0; }
.pin-dots i { width: 15px; height: 15px; border-radius: 50%; border: 2px solid #8FA3BF; }
.pin-dots i.on { background: #E8EEF6; border-color: #E8EEF6; }
.pin-dots.shake { animation: pin-shake .35s; }
@keyframes pin-shake { 25% { transform: translateX(-8px); } 75% { transform: translateX(8px); } }
.pin-keys { display: grid; grid-template-columns: repeat(3, 64px); gap: 10px; }
.pin-keys button { width: 64px; height: 56px; border-radius: 14px; border: 1px solid #23395A; background: #0F1E33; color: #E8EEF6; font: 600 22px/1 system-ui, sans-serif; cursor: pointer; }
.pin-keys button:active { background: #23395A; }
.pin-keys button:disabled { opacity: .35; }
.pin-keys .pin-x { font-size: 17px; }
.pin-cancel { border: 0; background: none; color: #8FA3BF; font-size: 13.5px; text-decoration: underline; cursor: pointer; padding: 4px; }`;
  const enc = new TextEncoder();
  const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  const hash = async (salt, pin) => hex(await crypto.subtle.digest('SHA-256', enc.encode(`alwasit:${salt}:${pin}`)));
  const tries = { n: 0, until: 0 };

  // One screen: title, 4 dots, a keypad. Resolves with the 4 digits, or null if cancelled.
  function ask({ title, text, cancel }) {
    return new Promise(resolve => {
      if (!document.getElementById('pin-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'pin-css', textContent: CSS }));
      const wrap = document.createElement('div');
      wrap.className = 'pin-wrap';
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      wrap.innerHTML = `<div class="pin-box"><div class="pin-lock">🔒</div><h2></h2><p></p><div class="pin-dots"><i></i><i></i><i></i><i></i></div>
        <div class="pin-keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" data-k="${n}">${n}</button>`).join('')}
        <span></span><button type="button" data-k="0">0</button><button type="button" class="pin-x" data-k="x" aria-label="Effacer">⌫</button></div>
        ${cancel ? '<button type="button" class="pin-cancel">Annuler</button>' : ''}</div>`;
      wrap.querySelector('h2').textContent = title;
      const msg = wrap.querySelector('p');
      msg.textContent = text || '';
      const dots = [...wrap.querySelectorAll('.pin-dots i')];
      let v = '';
      const paint = () => dots.forEach((d, i) => d.classList.toggle('on', i < v.length));
      const done = r => { document.removeEventListener('keydown', onKey, true); wrap.remove(); resolve(r); };
      const press = k => {
        if (k === 'x') v = v.slice(0, -1);
        else if (/^\d$/.test(k) && v.length < 4) v += k;
        paint();
        if (v.length === 4) setTimeout(() => done(v), 120);
      };
      const onKey = e => {
        if (/^\d$/.test(e.key)) press(e.key);
        else if (e.key === 'Backspace') press('x');
        else if (e.key === 'Escape' && cancel) done(null);
        else return;
        e.preventDefault();
        e.stopPropagation();
      };
      wrap.querySelectorAll('[data-k]').forEach(b => { b.onclick = () => press(b.dataset.k); });
      wrap.querySelector('.pin-cancel')?.addEventListener('click', () => done(null));
      document.addEventListener('keydown', onKey, true);
      document.body.append(wrap);
      wrap.say = (t, bad) => { msg.textContent = t; msg.className = bad ? 'bad' : ''; };
    });
  }
  // Shows a message on the next screen (wrong code, codes differ…)
  async function askWithError(opts, err) { return ask({ ...opts, text: err || opts.text }); }

  // Choose a new code (twice). Returns true when saved.
  async function create({ set, cancel }, first) {
    let err = first;
    for (;;) {
      const a = await askWithError({ title: 'Choisissez le code de l\'équipe', text: '4 chiffres, pour Caisse et 📝 Traductions', cancel }, err);
      if (a == null) return false;
      const b = await ask({ title: 'Retapez le code', text: 'Pour être sûr', cancel });
      if (b == null) return false;
      if (a !== b) { err = '⚠️ Les deux codes sont différents, recommencez'; continue; }
      const salt = Math.random().toString(36).slice(2, 10);
      try { await set({ salt, hash: await hash(salt, a), at: Date.now() }); } catch (e) { err = 'Pas enregistré : ' + (e.message || e); continue; }
      return true;
    }
  }

  // Asks the team's code (creates it if there is none yet). Resolves true when opened, false if cancelled.
  async function unlock({ get, set, cancel = true, title = 'Code de l\'équipe' }) {
    let row;
    try { row = await get(); } catch (e) { row = undefined; }
    if (row === undefined) {
      await ask({ title: 'Pas de connexion', text: 'Impossible de vérifier le code. Réessayez avec internet.', cancel: true });
      return false;
    }
    if (!row?.hash) return create({ set, cancel }, 'Pas encore de code : choisissez-en un (4 chiffres)');
    let err = '';
    for (;;) {
      const wait = Math.ceil((tries.until - Date.now()) / 1000);
      if (wait > 0) err = `Trop d'essais : attendez ${wait} s`;
      const v = await askWithError({ title, text: 'Tapez le code à 4 chiffres', cancel }, err);
      if (v == null) return false;
      if (tries.until > Date.now()) continue;
      if ((await hash(row.salt, v)) === row.hash) { tries.n = 0; return true; }
      tries.n++;
      if (tries.n >= 5) { tries.n = 0; tries.until = Date.now() + 60_000; }
      err = '⚠️ Code incorrect';
    }
  }

  // Change the code: the old one first.
  async function change({ get, set }) {
    let row;
    try { row = await get(); } catch { row = undefined; }
    if (row?.hash) {
      let err = '';
      for (;;) {
        const v = await askWithError({ title: 'Code actuel', text: 'Tapez le code actuel', cancel: true }, err);
        if (v == null) return false;
        if ((await hash(row.salt, v)) === row.hash) break;
        err = '⚠️ Code incorrect';
      }
    }
    return create({ set, cancel: true });
  }

  // Locks again after a while in the background (phone apps): calls relock() when the page comes back after `ms`.
  function relockAfter(ms, relock) {
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > ms) { hiddenAt = 0; relock(); }
    });
  }

  return { unlock, change, relockAfter };
})();
