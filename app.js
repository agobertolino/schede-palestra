'use strict';
(() => {
  // ---------- Archiviazione (localStorage con try/catch ovunque) ----------
  const K = {
    sessioni: 'sp.sessioni', bozza: 'sp.bozza', durata: 'sp.durata',
    timer: 'sp.timer', tab: 'sp.tab', schede: 'sp.schede'
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

  const corrente = () => schede.find((s) => s.id === tab) || schede[0];
  const ordinate = () => [...sessioni].sort((a, b) => String(b.data).localeCompare(String(a.data)));
  const chiave = (i, ex) => i + '|' + ex.nome;
  const nSerie = (ex) => Math.max(1, parseInt(ex.serie, 10) || 1);

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
    for (const s of ordinate()) {
      if (s.scheda !== scheda.id || !Array.isArray(s.esercizi)) continue;
      const e = s.esercizi.find((x) => x.nome === ex.nome);
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
    for (const s of ordinate()) {
      if (s.scheda !== scheda.id || !Array.isArray(s.esercizi)) continue;
      const e = s.esercizi.find((x) => x.nome === ex.nome);
      const r = e && Array.isArray(e.serie) ? e.serie.find((x) => x.n === j + 1) : null;
      if (r) return r;
    }
    const kg = Array.isArray(ex.ultimo) ? num(ex.ultimo[j]) : null;
    const reps = Array.isArray(ex.ultimoReps) ? num(ex.ultimoReps[j]) : null;
    return kg !== null || reps !== null ? { kg, reps } : null;
  }

  function valore(scheda, ex, i, j) {
    const b = bozza[scheda.id] && bozza[scheda.id][chiave(i, ex)];
    if (b && b[j]) return { kg: b[j].kg ?? '', reps: b[j].reps ?? '', fatta: !!b[j].fatta };
    const p = precedenteSerie(scheda, ex, j);
    return { kg: p ? fmtNum(num(p.kg)) : '', reps: p ? fmtNum(num(p.reps)) : '', fatta: false };
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
    let h = s.nota ? '<p class="nota-scheda">' + esc(s.nota) + '</p>' : '';
    s.esercizi.forEach((ex, i) => {
      const prev = precedente(s, ex);
      h += '<article class="card" data-ex="' + i + '">' +
        '<h2>' + esc(ex.nome) + '</h2><span class="schema">' + esc(schema(ex)) + '</span>' +
        (ex.nota ? '<p class="nota">' + esc(ex.nota) + '</p>' : '') +
        '<p class="ultima">' + testoUltima(prev) + '</p>' +
        '<div class="serie-head" aria-hidden="true"><span>#</span><span>kg</span><span>reps</span><span>fatta</span></div>';
      for (let j = 0; j < nSerie(ex); j++) {
        const v = valore(s, ex, i, j);
        const lab = esc(ex.nome) + ', serie ' + (j + 1);
        h += '<div class="serie' + (v.fatta ? ' fatta' : '') + '">' +
          '<span class="n">' + (j + 1) + '</span>' +
          '<input type="text" inputmode="decimal" autocomplete="off" name="kg" placeholder="kg" aria-label="' + lab + ', kg" value="' + esc(v.kg) + '">' +
          '<input type="text" inputmode="decimal" autocomplete="off" name="reps" placeholder="reps" aria-label="' + lab + ', ripetizioni" value="' + esc(v.reps) + '">' +
          '<button type="button" class="spunta" aria-pressed="' + v.fatta + '" aria-label="' + lab + ', fatta">✓</button>' +
          '</div>';
      }
      h += '</article>';
    });
    h += '<button type="button" id="btn-salva" class="btn-pri">Salva seduta</button>';
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

  // ---------- Bozza (input in corso, sopravvive alla chiusura dell'app) ----------
  function salvaBozzaCard(card) {
    const s = corrente();
    const i = Number(card.dataset.ex);
    const ex = s.esercizi[i];
    if (!ex) return;
    bozza[s.id] = bozza[s.id] || {};
    bozza[s.id][chiave(i, ex)] = [...card.querySelectorAll('.serie')].map((r) => ({
      kg: r.querySelector('[name="kg"]').value,
      reps: r.querySelector('[name="reps"]').value,
      fatta: r.classList.contains('fatta')
    }));
    scrivi(K.bozza, bozza);
  }

  // ---------- Salva seduta ----------
  function salvaSeduta() {
    const s = corrente();
    const righe = [];
    main.querySelectorAll('article.card').forEach((card) => {
      const ex = s.esercizi[Number(card.dataset.ex)];
      const serie = [...card.querySelectorAll('.serie')].map((r, j) => ({
        n: j + 1,
        kg: num(r.querySelector('[name="kg"]').value),
        reps: num(r.querySelector('[name="reps"]').value),
        fatta: r.classList.contains('fatta')
      }));
      righe.push({ nome: ex.nome, serie });
    });
    const fatte = righe.reduce((t, e) => t + e.serie.filter((r) => r.fatta).length, 0);
    let filtro = (r) => r.fatta;
    if (fatte === 0) {
      if (!confirm('Nessuna serie spuntata. Salvare comunque tutte le serie compilate?')) return;
      filtro = (r) => r.kg !== null || r.reps !== null;
    }
    const esercizi = righe
      .map((e) => ({ nome: e.nome, serie: e.serie.filter(filtro).map((r) => ({ n: r.n, kg: r.kg, reps: r.reps })) }))
      .filter((e) => e.serie.length);
    if (!esercizi.length) { toast('Niente da salvare'); return; }
    const seduta = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      data: new Date().toISOString(),
      scheda: s.id,
      nomeScheda: s.nome,
      esercizi
    };
    sessioni.push(seduta);
    if (!scrivi(K.sessioni, sessioni)) { sessioni.pop(); return; }
    delete bozza[s.id];
    scrivi(K.bozza, bozza);
    fermaTimer();
    render();
    window.scrollTo(0, 0);
    toast('Seduta salvata ✓');
  }

  // ---------- Timer di recupero ----------
  const elTimer = $('#timer');
  const elTempo = $('#timer-tempo');
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
    elTimer.hidden = false;
    document.body.classList.add('con-timer');
    elTimer.classList.remove('finito');
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
    elTempo.textContent = 'Recupero finito!';
    if (!elTimer.classList.contains('finito')) elTimer.classList.add('finito');
    if (!timer.avvisato) {
      timer.avvisato = true;
      scrivi(K.timer, timer);
      try { if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]); } catch (e) { /* non supportata */ }
      document.body.classList.remove('lampo');
      void document.body.offsetWidth;
      document.body.classList.add('lampo');
      setTimeout(() => document.body.classList.remove('lampo'), 1700);
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
    if (card && e.target.matches('input')) salvaBozzaCard(card);
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
    } else if (t.id === 'btn-salva') salvaSeduta();
    else if (t.classList.contains('voce')) { dettaglioId = t.dataset.id; vista = 'dettaglio'; render(); window.scrollTo(0, 0); }
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
    const b = e.target.closest('button');
    if (!b) return;
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
