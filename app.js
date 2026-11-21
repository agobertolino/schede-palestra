'use strict';
(() => {
  // ---------- Archiviazione (localStorage con try/catch ovunque) ----------
  const K = {
    sessioni: 'sp.sessioni', bozza: 'sp.bozza', durata: 'sp.durata',
    timer: 'sp.timer', tab: 'sp.tab', schede: 'sp.schede', ridotto: 'sp.ridotto'
  };
  function leggi(k, def) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? def : JSON.parse(v);
    } catch (e) {
      console.warn('Lettura non riuscita', k, e);
      return def;
    }
  }
  function scrivi(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
      return true;
    } catch (e) {
      console.warn('Scrittura non riuscita', k, e);
      toast('⚠️ Impossibile salvare sul dispositivo');
      return false;
    }
  }

  // ---------- Utilità ----------
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim().replace(',', '.');
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const fmtNum = (n) => (n === null || n === undefined || n === '' ? '' : String(n).replace('.', ','));
  const fmtData = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) +
      ' · ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  };
  const fmtDataBreve = (iso) => new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  const pad = (n) => String(n).padStart(2, '0');
  const dataCsv = (iso) => {
    const d = new Date(iso);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  };
  const mmss = (s) => Math.floor(s / 60) + ':' + pad(s % 60);

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // ---------- Stato ----------
  const main = $('#main');
  let schede = [];
  let tab = leggi(K.tab, null);
  let vista = 'scheda'; // 'scheda' | 'storico' | 'dettaglio'
  let dettaglioId = null;
  let sessioni = leggi(K.sessioni, []);
  if (!Array.isArray(sessioni)) sessioni = [];
  let bozza = leggi(K.bozza, {});
  if (!bozza || typeof bozza !== 'object' || Array.isArray(bozza)) bozza = {};
  let durata = leggi(K.durata, 120);
  if (![90, 120, 180].includes(durata)) durata = 120;
  let timer = leggi(K.timer, null);
  if (!timer || typeof timer.fine !== 'number') timer = null;

  let ridotto = leggi(K.ridotto, false) === true;

  const corrente = () => schede.find((s) => s.id === tab) || schede[0];
  const ordinate = () => [...sessioni].sort((a, b) => String(b.data).localeCompare(String(a.data)));
  const chiave = (i, ex) => i + '|' + ex.nome;
  // Elenco degli esercizi di oggi: quelli della scheda + quelli aggiunti a mano - quelli tolti.
  // Le modifiche valgono solo per la seduta di oggi (sono nella bozza), la scheda resta com'è.
  function elenco(s) {
    const b = bozzaDi(s.id);
    const v = s.esercizi.map((ex, i) => ({ key: chiave(i, ex), ex }));
    (b.aggiunti || []).forEach((a) => {
      let pos = 0;
      if (a.dopo) { const k = v.findIndex((x) => x.key === a.dopo); pos = k < 0 ? v.length : k + 1; }
      v.splice(pos, 0, { key: 'x' + a.id + '|' + a.ex.nome, ex: a.ex });
    });
    const rim = b.rimossi || [];
    return v.filter((x) => !rim.includes(x.key));
  }
  const voce = (s, key) => elenco(s).find((v) => v.key === key);
  // Stesso esercizio anche se rinominato: "alias" in schede.json elenca i nomi precedenti.
  const stessoEsercizio = (x, ex) => x.nome === ex.nome || (Array.isArray(ex.alias) && ex.alias.includes(x.nome));
  const nSerie = (ex) => Math.max(1, parseInt(ex.serie, 10) || 1);
  const oggi = () => dataCsv(new Date().toISOString()).slice(0, 10);
  const oraBreve = (iso) => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

  // Seduta in corso per scheda: valida solo nel giorno in cui è iniziata.
  // Il giorno dopo si riparte con una seduta nuova, precompilata dalla precedente.
  function bozzaDi(id) {
    let b = bozza[id];
    if (!b || b.giorno !== oggi() || !b.esercizi || typeof b.esercizi !== 'object') {
      b = bozza[id] = { giorno: oggi(), sedutaId: null, esercizi: {} };
    }
    return b;
  }
  const inCorso = (scheda) => {
    const b = bozza[scheda.id];
    return b && b.giorno === oggi() ? b.sedutaId : null;
  };

  // ---------- Schede ----------
  function validaSchede(d) {
    if (!d || !Array.isArray(d.schede) || !d.schede.length) throw new Error('formato non valido');
    d.schede.forEach((s) => {
      if (!s.id || !s.nome || !Array.isArray(s.esercizi)) throw new Error('scheda non valida');
    });
  }
  async function caricaSchede() {
    try {
      const r = await fetch('schede.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      validaSchede(d);
      scrivi(K.schede, d);
      return d;
    } catch (e) {
      const d = leggi(K.schede, null);
      if (d) return d;
      throw e;
    }
  }

  // Valori dell'ultima volta: seduta più recente di questa scheda con quell'esercizio,
  // altrimenti i carichi "ultimo" di schede.json.
  function precedente(scheda, ex) {
    const escludi = inCorso(scheda);
    for (const s of ordinate()) {
      if (s.scheda !== scheda.id || s.id === escludi || !Array.isArray(s.esercizi)) continue;
      const e = s.esercizi.find((x) => stessoEsercizio(x, ex));
      if (e && Array.isArray(e.serie) && e.serie.length) return { data: s.data, serie: e.serie };
    }
    const kg = Array.isArray(ex.ultimo) ? ex.ultimo : [];
    const reps = Array.isArray(ex.ultimoReps) ? ex.ultimoReps : [];
    const n = Math.max(kg.length, reps.length);
    if (!n) return null;
    return { data: null, serie: Array.from({ length: n }, (_, j) => ({ n: j + 1, kg: num(kg[j]), reps: num(reps[j]) })) };
  }

  function schema(ex) {
    const reps = String(ex.reps ?? '').trim();
    if (!reps) return ex.serie + ' serie';
    if (/\dx\d/i.test(reps)) return ex.serie + ' serie · ' + reps;
    return ex.serie + ' × ' + reps;
  }

  function testoUltima(prev) {
    if (!prev) return 'Ultima volta: —';
    const parti = prev.serie.map((x) => {
      const kg = num(x.kg), reps = num(x.reps);
      if (kg !== null && reps !== null) return fmtNum(kg) + '×' + reps;
      if (kg !== null) return fmtNum(kg) + ' kg';
      if (reps !== null) return reps + ' reps';
      return '—';
    });
    const etichetta = prev.data ? 'Ultima (' + esc(fmtDataBreve(prev.data)) + ')' : 'Ultima volta';
    return etichetta + ': <b>' + esc(parti.join(' · ')) + '</b>';
  }

  // Precompila la serie j con la seduta più recente che la contiene, altrimenti con schede.json.
  function precedenteSerie(scheda, ex, j) {
    const escludi = inCorso(scheda);
    for (const s of ordinate()) {
      if (s.scheda !== scheda.id || s.id === escludi || !Array.isArray(s.esercizi)) continue;
      const e = s.esercizi.find((x) => stessoEsercizio(x, ex));
      const r = e && Array.isArray(e.serie) ? e.serie.find((x) => x.n === j + 1) : null;
      if (r) return r;
    }
    const kg = Array.isArray(ex.ultimo) ? num(ex.ultimo[j]) : null;
    const reps = Array.isArray(ex.ultimoReps) ? num(ex.ultimoReps[j]) : null;
    return kg !== null || reps !== null ? { kg, reps } : null;
  }

  function valore(scheda, ex, key, j) {
    const b = bozzaDi(scheda.id).esercizi[key];
    if (b && b[j]) return { kg: b[j].kg ?? '', reps: b[j].reps ?? '', fatta: !!b[j].fatta, toccata: !!b[j].toccata };
    const p = precedenteSerie(scheda, ex, j);
    return { kg: p ? fmtNum(num(p.kg)) : '', reps: p ? fmtNum(num(p.reps)) : '', fatta: false, toccata: false };
  }

  // ---------- Render ----------
  function renderTabbar() {
    $('#tabbar').innerHTML = schede.map((s) =>
      '<button type="button" class="tab" data-tab="' + esc(s.id) + '"' +
      (s.id === tab ? ' aria-current="page"' : '') + '>' + esc(s.nome) + '</button>').join('');
  }

  function render() {
    const s = corrente();
    if (!s) return;
    tab = s.id;
    renderTabbar();
    $('#titolo').textContent = vista === 'scheda' ? s.nome : 'Storico · ' + s.nome;
    $('#btn-vista').textContent = vista === 'scheda' ? 'Storico' : 'Allenamento';
    if (vista === 'scheda') renderScheda(s);
    else if (vista === 'storico') renderStorico(s);
    else renderDettaglio();
  }

  function renderScheda(s) {
    let h = '';
    const lista = elenco(s);
    const btnAgg = (dopo) => '<button type="button" class="aggiungi-ex" data-dopo="' + esc(dopo) + '">+ Aggiungi esercizio qui</button>';
    let prevKey = '';
    lista.forEach(({ key, ex }) => {
      h += btnAgg(prevKey);
      prevKey = key;
      const prev = precedente(s, ex);
      const righe = bozzaDi(s.id).esercizi[key];
      const n = Array.isArray(righe) && righe.length ? righe.length : nSerie(ex);
      const oggiSerie = n !== nSerie(ex) ? ' · oggi ' + n + ' serie' : '';
      h += '<article class="card" data-key="' + esc(key) + '">' +
        '<h2>' + esc(ex.nome) + '</h2><span class="schema">' + esc(schema(ex) + oggiSerie) + '</span>' +
        (ex.nota ? '<p class="nota">' + esc(ex.nota) + '</p>' : '') +
        '<p class="ultima">' + testoUltima(prev) + '</p>' +
        '<div class="serie-head" aria-hidden="true"><span>#</span><span>kg</span><span>reps</span><span>fatta</span></div>';
      for (let j = 0; j < n; j++) {
        const v = valore(s, ex, key, j);
        const lab = esc(ex.nome) + ', serie ' + (j + 1);
        h += '<div class="serie' + (v.fatta ? ' fatta' : '') + '"' + (v.toccata ? ' data-toccata="1"' : '') + '>' +
          '<span class="n">' + (j + 1) + '</span>' +
          '<input type="text" inputmode="decimal" autocomplete="off" name="kg" placeholder="kg" aria-label="' + lab + ', kg" value="' + esc(v.kg) + '">' +
          '<input type="text" inputmode="decimal" autocomplete="off" name="reps" placeholder="reps" aria-label="' + lab + ', ripetizioni" value="' + esc(v.reps) + '">' +
          '<button type="button" class="spunta" aria-pressed="' + v.fatta + '" aria-label="' + lab + ', fatta">✓</button>' +
          '</div>';
      }
      h += '<div class="azioni-serie">' +
        '<button type="button" class="meno-serie"' + (n <= 1 ? ' disabled' : '') + ' aria-label="' + esc(ex.nome) + ', togli una serie">− Serie</button>' +
        '<button type="button" class="piu-serie" aria-label="' + esc(ex.nome) + ', aggiungi una serie">+ Serie</button>' +
        '</div><button type="button" class="togli-ex" aria-label="Togli ' + esc(ex.nome) + ' dalla seduta">Togli esercizio</button></article>';
    });
    h += btnAgg(prevKey);
    main.innerHTML = h;
  }

  function renderStorico(s) {
    const lista = ordinate().filter((x) => x.scheda === s.id);
    let h = '<h2 class="sez">Sedute salvate</h2>';
    if (!lista.length) {
      h += '<p class="vuoto">Nessuna seduta salvata per questa scheda.</p>';
    } else {
      h += '<ul class="lista">' + lista.map((x) => {
        const es = (x.esercizi || []).length;
        const se = (x.esercizi || []).reduce((t, e) => t + (e.serie || []).length, 0);
        return '<li><button type="button" class="voce" data-id="' + esc(x.id) + '"><span><strong>' +
          esc(fmtData(x.data)) + '</strong><small>' + es + ' esercizi · ' + se + ' serie</small></span>' +
          '<span class="freccia" aria-hidden="true">›</span></button></li>';
      }).join('') + '</ul>';
    }
    h += '<section class="dati"><h2 class="sez">Esporta e importa</h2>' +
      '<p class="sub">Tutte le schede · ' + sessioni.length + ' sedute in totale</p>' +
      '<button type="button" id="btn-csv" class="btn-sec piena">📋 Copia storico in CSV</button>' +
      '<button type="button" id="btn-json" class="btn-sec piena">⬇️ Scarica JSON completo</button>' +
      '<button type="button" id="btn-import" class="btn-sec piena">⬆️ Importa JSON (ripristina)</button>' +
      '</section>';
    main.innerHTML = h;
  }

  function renderDettaglio() {
    const x = sessioni.find((y) => y.id === dettaglioId);
    if (!x) { vista = 'storico'; render(); return; }
    let h = '<button type="button" id="btn-indietro" class="btn-sec">‹ Tutte le sedute</button>' +
      '<h2 class="sez">' + esc(fmtData(x.data)) + '</h2><p class="sub">' + esc(x.nomeScheda || x.scheda) + '</p>';
    (x.esercizi || []).forEach((e) => {
      h += '<article class="card"><h2>' + esc(e.nome) + '</h2><table class="tab-serie"><thead><tr><th>Serie</th><th>kg</th><th>Reps</th></tr></thead><tbody>' +
        (e.serie || []).map((r) => '<tr><td>' + esc(r.n) + '</td><td>' + (r.kg === null || r.kg === undefined ? '—' : esc(fmtNum(r.kg))) +
          '</td><td>' + (r.reps === null || r.reps === undefined ? '—' : esc(fmtNum(r.reps))) + '</td></tr>').join('') +
        '</tbody></table></article>';
    });
    main.innerHTML = h;
  }

  // ---------- Salvataggio automatico ----------
  function salvaBozzaCard(card) {
    const s = corrente();
    const key = card.dataset.key;
    if (!voce(s, key)) return;
    bozzaDi(s.id).esercizi[key] = [...card.querySelectorAll('.serie')].map((r) => ({
      kg: r.querySelector('[name="kg"]').value,
      reps: r.querySelector('[name="reps"]').value,
      fatta: r.classList.contains('fatta'),
      toccata: r.dataset.toccata === '1'
    }));
    autosalva(s);
  }

  // Aggiunge (d = 1) o toglie (d = -1) l'ultima serie di un esercizio, solo per la seduta di oggi.
  function cambiaSerie(card, d) {
    const s = corrente();
    const key = card.dataset.key;
    const v = voce(s, key);
    if (!v) return;
    const ex = v.ex;
    salvaBozzaCard(card);
    const righe = bozzaDi(s.id).esercizi[key];
    if (!Array.isArray(righe)) return;
    if (d > 0) {
      const p = precedenteSerie(s, ex, righe.length);
      const u = righe[righe.length - 1] || {};
      righe.push(p ? { kg: fmtNum(num(p.kg)), reps: fmtNum(num(p.reps)), fatta: false, toccata: false }
        : { kg: u.kg ?? '', reps: u.reps ?? '', fatta: false, toccata: false });
    } else if (righe.length > 1) {
      righe.pop();
    } else return;
    autosalva(s);
    const y = window.scrollY;
    renderScheda(s);
    window.scrollTo(0, y);
  }

  function rirenderMantenendoScroll(s) {
    const y = window.scrollY;
    renderScheda(s);
    window.scrollTo(0, y);
  }

  function togliEsercizio(card) {
    const s = corrente();
    const key = card.dataset.key;
    const v = voce(s, key);
    if (!v) return;
    if (card.querySelector('.serie.fatta') &&
        !confirm('Togliere "' + v.ex.nome + '"? Le serie già fatte oggi verranno tolte dalla seduta.')) return;
    const b = bozzaDi(s.id);
    b.rimossi = (b.rimossi || []).concat(key);
    delete b.esercizi[key];
    autosalva(s);
    rirenderMantenendoScroll(s);
  }

  // Esercizi già noti (di tutte le schede e dello storico), per proporli quando se ne aggiunge uno.
  function modelli() {
    const m = new Map();
    schede.forEach((s) => s.esercizi.forEach((e) => { if (!m.has(e.nome)) m.set(e.nome, e); }));
    sessioni.forEach((x) => (x.esercizi || []).forEach((e) => {
      if (!m.has(e.nome)) m.set(e.nome, { nome: e.nome, serie: 3, reps: '' });
    }));
    return m;
  }
  const dlg = $('#dlg-ex');
  let dlgDopo = '';
  function apriAggiungi(dopo) {
    dlgDopo = dopo;
    const mod = modelli();
    $('#elenco-ex').innerHTML = [...mod.keys()].sort((x, y) => x.localeCompare(y))
      .map((n) => '<option value="' + esc(n) + '"></option>').join('');
    $('#dlg-form').reset();
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    $('#dlg-nome').focus();
  }
  function chiudiAggiungi() {
    if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
  }
  function confermaAggiungi() {
    const nome = $('#dlg-nome').value.trim();
    if (!nome) { $('#dlg-nome').focus(); return; }
    const s = corrente();
    const t = modelli().get(nome);
    const serie = parseInt($('#dlg-serie').value, 10);
    const reps = $('#dlg-reps').value.trim();
    const ex = {
      nome, serie: serie > 0 ? serie : (t ? nSerie(t) : 3), reps: reps || (t ? t.reps : '') || '', nota: '',
      ultimo: t && Array.isArray(t.ultimo) ? t.ultimo : [],
      ultimoReps: t && Array.isArray(t.ultimoReps) ? t.ultimoReps : [],
      alias: t && Array.isArray(t.alias) ? t.alias : []
    };
    const b = bozzaDi(s.id);
    b.aggiunti = (b.aggiunti || []).concat({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), dopo: dlgDopo, ex });
    scrivi(K.bozza, bozza);
    chiudiAggiungi();
    rirenderMantenendoScroll(s);
  }

  // Aggiorna (o crea) la seduta di oggi con le serie spuntate o modificate a mano.
  function autosalva(s) {
    const b = bozzaDi(s.id);
    const esercizi = [];
    elenco(s).forEach(({ key, ex }) => {
      const righe = b.esercizi[key];
      if (!Array.isArray(righe)) return;
      const serie = righe
        .map((r, j) => ({ n: j + 1, kg: num(r.kg), reps: num(r.reps), fatta: !!r.fatta, toccata: !!r.toccata }))
        .filter((r) => r.fatta || (r.toccata && (r.kg !== null || r.reps !== null)))
        .map((r) => ({ n: r.n, kg: r.kg, reps: r.reps }));
      if (serie.length) esercizi.push({ nome: ex.nome, serie });
    });
    const ora = new Date().toISOString();
    const idx = b.sedutaId ? sessioni.findIndex((x) => x.id === b.sedutaId) : -1;
    if (!esercizi.length) {
      if (idx >= 0) sessioni.splice(idx, 1);
      b.sedutaId = null;
    } else if (idx >= 0) {
      sessioni[idx].esercizi = esercizi;
      sessioni[idx].aggiornata = ora;
    } else {
      const seduta = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        data: ora, aggiornata: ora, scheda: s.id, nomeScheda: s.nome, esercizi
      };
      sessioni.push(seduta);
      b.sedutaId = seduta.id;
    }
    if (!(scrivi(K.sessioni, sessioni) && scrivi(K.bozza, bozza))) toast('⚠️ Salvataggio non riuscito');
  }

  // ---------- Timer di recupero ----------
  const elTimer = $('#timer');
  const elTempo = $('#timer-tempo');
  const elBarra = $('#timer-barra');
  let tick = null;

  function avviaTimer() {
    const ora = Date.now();
    timer = { inizio: ora, fine: ora + durata * 1000, avvisato: false };
    scrivi(K.timer, timer);
    mostraTimer();
  }
  function fermaTimer() {
    timer = null;
    scrivi(K.timer, null);
    mostraTimer();
  }
  function mostraTimer() {
    elTimer.querySelectorAll('[data-durata]').forEach((b) =>
      b.setAttribute('aria-pressed', String(Number(b.dataset.durata) === durata)));
    if (!timer) {
      elTimer.hidden = true;
      elTimer.classList.remove('finito');
      document.body.classList.remove('con-timer');
      clearInterval(tick); tick = null;
      return;
    }
    const eraNascosto = elTimer.hidden;
    elTimer.hidden = false;
    elTimer.classList.toggle('ridotto', ridotto);
    document.body.classList.add('con-timer');
    elTimer.classList.remove('finito');
    if (eraNascosto) { elTimer.classList.remove('entra'); void elTimer.offsetWidth; elTimer.classList.add('entra'); }
    // La barra si svuota in modo fluido con una animazione CSS sincronizzata sul tempo reale.
    const tot = Math.max(1, (timer.fine - timer.inizio) / 1000);
    const trascorso = Math.max(0, (Date.now() - timer.inizio) / 1000);
    elBarra.style.animation = 'none';
    void elBarra.offsetWidth;
    elBarra.style.animation = 'scarica ' + tot + 's linear ' + (-trascorso) + 's forwards';
    aggiornaTimer();
    if (!tick && timer && timer.fine > Date.now()) tick = setInterval(aggiornaTimer, 250);
  }
  function aggiornaTimer() {
    if (!timer) return;
    const resto = Math.ceil((timer.fine - Date.now()) / 1000);
    if (resto > 0) {
      elTempo.textContent = mmss(resto);
      elTimer.classList.remove('finito');
      return;
    }
    clearInterval(tick); tick = null;
    elTempo.textContent = ridotto ? '✓' : 'Si riparte!';
    if (!elTimer.classList.contains('finito')) elTimer.classList.add('finito');
    if (!timer.avvisato) {
      timer.avvisato = true;
      scrivi(K.timer, timer);
      try { if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]); } catch (e) { /* non supportata */ }
    }
  }

  // ---------- Esporta / importa ----------
  function generaCsv() {
    const q = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const righe = [['data', 'scheda', 'esercizio', 'serie', 'kg', 'reps']];
    [...sessioni].sort((a, b) => String(a.data).localeCompare(String(b.data))).forEach((x) =>
      (x.esercizi || []).forEach((e) => (e.serie || []).forEach((r) =>
        righe.push([dataCsv(x.data), x.nomeScheda || x.scheda, e.nome, r.n, r.kg, r.reps]))));
    return righe.map((r) => r.map(q).join(',')).join('\n');
  }
  async function copiaCsv() {
    if (!sessioni.length) { toast('Storico vuoto'); return; }
    const testo = generaCsv();
    try {
      await navigator.clipboard.writeText(testo);
      toast('CSV copiato negli appunti ✓');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = testo;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, testo.length);
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
      toast(ok ? 'CSV copiato negli appunti ✓' : 'Copia non riuscita');
    }
  }
  async function scaricaJson() {
    const oggi = dataCsv(new Date().toISOString()).slice(0, 10);
    const nome = 'schede-palestra-' + oggi + '.json';
    const dati = { app: 'schede-palestra', versione: 1, esportato: new Date().toISOString(), durataRecupero: durata, sessioni };
    const blob = new Blob([JSON.stringify(dati, null, 2)], { type: 'application/json' });
    // Su iPhone il foglio di condivisione permette "Salva su File"; altrimenti download classico.
    try {
      const file = new File([blob], nome, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
        await navigator.share({ files: [file], title: nome });
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('JSON scaricato ✓');
  }
  function sedutaValida(x) {
    return x && typeof x.id === 'string' && typeof x.data === 'string' && !isNaN(Date.parse(x.data)) &&
      typeof x.scheda === 'string' && Array.isArray(x.esercizi) &&
      x.esercizi.every((e) => e && typeof e.nome === 'string' && Array.isArray(e.serie));
  }
  async function importaJson(file) {
    let d;
    try { d = JSON.parse(await file.text()); } catch (e) { toast('File JSON non leggibile'); return; }
    const lista = Array.isArray(d) ? d : d && d.sessioni;
    if (!Array.isArray(lista) || !lista.every(sedutaValida)) { toast('Formato JSON non valido'); return; }
    if (!confirm('Importare ' + lista.length + ' sedute? Lo storico attuale (' + sessioni.length + ' sedute) verrà sostituito.')) return;
    const vecchie = sessioni;
    sessioni = lista;
    if (!scrivi(K.sessioni, sessioni)) { sessioni = vecchie; return; }
    if (d && [90, 120, 180].includes(d.durataRecupero)) { durata = d.durataRecupero; scrivi(K.durata, durata); mostraTimer(); }
    render();
    toast('Storico ripristinato ✓');
  }

  // ---------- Eventi ----------
  main.addEventListener('input', (e) => {
    const card = e.target.closest('article.card');
    if (card && e.target.matches('input')) {
      e.target.closest('.serie').dataset.toccata = '1';
      salvaBozzaCard(card);
    }
  });
  main.addEventListener('focusin', (e) => {
    if (e.target.matches('.serie input')) setTimeout(() => { try { e.target.select(); } catch (x) { /* */ } }, 0);
  });
  main.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.classList.contains('spunta')) {
      const riga = t.closest('.serie');
      const fatta = !riga.classList.contains('fatta');
      riga.classList.toggle('fatta', fatta);
      t.setAttribute('aria-pressed', String(fatta));
      salvaBozzaCard(t.closest('article.card'));
      if (fatta) avviaTimer();
    } else if (t.classList.contains('togli-ex')) {
      togliEsercizio(t.closest('article.card'));
    } else if (t.classList.contains('aggiungi-ex')) {
      apriAggiungi(t.dataset.dopo);
    } else if (t.classList.contains('piu-serie') || t.classList.contains('meno-serie')) {
      cambiaSerie(t.closest('article.card'), t.classList.contains('piu-serie') ? 1 : -1);
    } else if (t.classList.contains('voce')) { dettaglioId = t.dataset.id; vista = 'dettaglio'; render(); window.scrollTo(0, 0); }
    else if (t.id === 'btn-indietro') { vista = 'storico'; render(); }
    else if (t.id === 'btn-csv') copiaCsv();
    else if (t.id === 'btn-json') scaricaJson();
    else if (t.id === 'btn-import') $('#file-import').click();
  });
  $('#file-import').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importaJson(f);
    e.target.value = '';
  });
  $('#tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b || b.dataset.tab === tab) return;
    tab = b.dataset.tab;
    scrivi(K.tab, tab);
    if (vista === 'dettaglio') vista = 'storico';
    render();
    window.scrollTo(0, 0);
  });
  $('#btn-vista').addEventListener('click', () => {
    vista = vista === 'scheda' ? 'storico' : 'scheda';
    render();
    window.scrollTo(0, 0);
  });
  elTimer.addEventListener('click', (e) => {
    if (e.target.closest('a')) return; // link a Musica
    if (ridotto) {
      if (elTimer.classList.contains('finito')) fermaTimer();
      else { ridotto = false; scrivi(K.ridotto, false); mostraTimer(); }
      return;
    }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'timer-riduci') { ridotto = true; scrivi(K.ridotto, true); mostraTimer(); return; }
    if (b.dataset.durata) {
      durata = Number(b.dataset.durata);
      scrivi(K.durata, durata);
      if (timer) {
        timer.fine = timer.inizio + durata * 1000;
        timer.avvisato = timer.fine <= Date.now() ? timer.avvisato : false;
        scrivi(K.timer, timer);
      }
      mostraTimer();
    } else if (b.id === 'timer-chiudi' || (b.id === 'timer-tempo' && elTimer.classList.contains('finito'))) {
      fermaTimer();
    }
  });
  $('#dlg-form').addEventListener('submit', (e) => { e.preventDefault(); confermaAggiungi(); });
  $('#dlg-annulla').addEventListener('click', chiudiAggiungi);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && timer) mostraTimer(); });

  // ---------- Avvio ----------
  async function avvio() {
    try {
      const d = await caricaSchede();
      schede = d.schede;
    } catch (e) {
      main.innerHTML = '<p class="errore">Impossibile caricare le schede (' + esc(e.message) +
        '). Apri l\'app una volta con internet attivo.</p>';
      return;
    }
    if (!schede.some((s) => s.id === tab)) tab = schede[0].id;
    render();
    mostraTimer();
  }
  avvio();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker non registrato', e));
    });
  }
})();
