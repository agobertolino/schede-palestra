'use strict';
(() => {
  // ---------- Archiviazione (localStorage con try/catch ovunque) ----------
  const K = {
    sessioni: 'sp.sessioni', bozza: 'sp.bozza', durata: 'sp.durata',
    timer: 'sp.timer', tab: 'sp.tab', schede: 'sp.schede', ridotto: 'sp.ridotto', catalogo: 'sp.catalogo', schedeUtente: 'sp.schedeUtente'
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
  let catalogo = []; // dataset di tutti gli esercizi noti (catalogo.json)
  let tab = leggi(K.tab, null);
  let vista = 'scheda'; // 'scheda' | 'storico' | 'dettaglio' | 'impostazioni' | 'modifica'
  let schedeBase = []; // schede originali di schede.json (per "Ripristina")
  let modificaId = null;
  let confermaImp = null; // conferma in sospeso nelle impostazioni: 'riduci' | 'reset'
  let confermaEd = -1; // indice dell'esercizio di cui si chiede conferma di rimozione nell'editor
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

  // Scheda "Giornaliera": sempre disponibile, parte vuota ogni giorno e la costruisci in palestra
  // aggiungendo gli esercizi uno alla volta. I carichi "ultima volta" arrivano da tutto lo storico.
  const GIORNALIERA = { id: 'libera', nome: 'Giornaliera', nota: '', esercizi: [], libera: true };
  const tutte = () => schede.concat(GIORNALIERA);
  const corrente = () => tutte().find((s) => s.id === tab) || schede[0];
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
  const copia = (x) => JSON.parse(JSON.stringify(x));
  function salvaSchede() { scrivi(K.schedeUtente, schede); }

  // Applica una modifica alla scheda (aggiungi/togli/sposta/rinomina esercizi) tenendo allineati
  // i dati già inseriti oggi: le chiavi della bozza dipendono dalla posizione e dal nome.
  function modificaScheda(s, fn) {
    const prima = s.esercizi.map((ex, i) => ({ ex, key: chiave(i, ex) }));
    fn();
    const b = bozza[s.id];
    if (b && b.giorno === oggi() && b.esercizi && typeof b.esercizi === 'object') {
      const mappa = new Map();
      s.esercizi.forEach((ex, j) => { const p = prima.find((x) => x.ex === ex); if (p) mappa.set(p.key, chiave(j, ex)); });
      const originale = (k) => prima.some((x) => x.key === k);
      const nuovi = {};
      Object.keys(b.esercizi).forEach((k) => {
        if (mappa.has(k)) nuovi[mappa.get(k)] = b.esercizi[k];
        else if (!originale(k)) nuovi[k] = b.esercizi[k]; // esercizio aggiunto a mano oggi
      });
      b.esercizi = nuovi;
      b.rimossi = (b.rimossi || []).filter((k) => mappa.has(k) || !originale(k)).map((k) => mappa.get(k) || k);
      (b.aggiunti || []).forEach((x) => { if (x.dopo && !mappa.has(x.dopo) && originale(x.dopo)) x.dopo = ''; else if (mappa.has(x.dopo)) x.dopo = mappa.get(x.dopo); });
      if (b.sedutaId) autosalva(s); else scrivi(K.bozza, bozza);
    }
    salvaSchede();
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

  async function caricaCatalogo() {
    let d = null;
    try {
      const r = await fetch('catalogo.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      d = await r.json();
      if (!d || !Array.isArray(d.esercizi)) throw new Error('formato non valido');
      scrivi(K.catalogo, d);
    } catch (e) {
      d = leggi(K.catalogo, null);
    }
    catalogo = d && Array.isArray(d.esercizi) ? d.esercizi.filter((c) => c && typeof c.nome === 'string') : [];
  }

  // Valori dell'ultima volta: seduta più recente di questa scheda con quell'esercizio,
  // altrimenti i carichi "ultimo" di schede.json.
  function precedente(scheda, ex) {
    const escludi = inCorso(scheda);
    for (const s of ordinate()) {
      if ((!scheda.libera && s.scheda !== scheda.id) || s.id === escludi || !Array.isArray(s.esercizi)) continue;
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

  // ---------- Progressione intelligente ----------
  // Doppia progressione: finché non raggiungi il massimo del range di reps su tutte le serie
  // col carico più alto, resta a quel peso e aggiungi ripetizioni; poi alza il peso e riparti dal minimo.
  function intervalliReps(ex) {
    const txt = String(ex.reps ?? '');
    if (!txt.trim() || /["”″']/.test(txt)) return null; // tenute a tempo: nessun suggerimento
    const segs = [];
    txt.split('+').forEach((p) => {
      const m = p.match(/(?:(\d+)(?:\s*-\s*\d+)?\s*x\s*)?(\d+)(?:\s*-\s*(\d+))?/i);
      if (!m) return;
      const lo = parseInt(m[2], 10), hi = m[3] ? parseInt(m[3], 10) : lo;
      segs.push({ cnt: m[1] ? parseInt(m[1], 10) : null, lo: Math.min(lo, hi), hi: Math.max(lo, hi) });
    });
    if (!segs.length) return null;
    return (j) => {
      let resto = j;
      for (const sg of segs) {
        if (sg.cnt === null || resto < sg.cnt) return [sg.lo, sg.hi];
        resto -= sg.cnt;
      }
      const u = segs[segs.length - 1];
      return [u.lo, u.hi];
    };
  }
  // Di quanto alzare il carico, in base all'attrezzo (dal catalogo) e al peso attuale.
  function passoCarico(ex, kg) {
    const c = trova(ex.nome);
    const att = c ? c.attrezzo : '';
    if (att === 'Manubri') return 2;
    if (kg < 10) return 1;
    if (att === 'Macchina') return 5;
    return 2.5;
  }
  const mezzo = (x) => Math.round(x * 2) / 2;

  function suggerimento(scheda, ex) {
    const prev = precedente(scheda, ex);
    const rng = intervalliReps(ex);
    if (!prev || !rng) return null;
    const serie = prev.serie.map((x, j) => ({ j, kg: num(x.kg), reps: num(x.reps) })).filter((x) => x.reps !== null);
    if (!serie.length) return null;
    const kgs = serie.map((x) => x.kg).filter((k) => k !== null);
    const conPeso = kgs.length > 0;
    const kgTop = conPeso ? Math.max(...kgs) : null;
    const top = serie.filter((x) => !conPeso || x.kg === kgTop);
    const alMax = top.every((x) => x.reps >= rng(x.j)[1]);
    const sotto = conPeso && top.every((x) => x.reps < rng(x.j)[0]);
    const ultimoDato = serie[serie.length - 1];
    const dellaSerie = (j) => serie.find((x) => x.j === j) || ultimoDato;
    const kgTxt = (k) => fmtNum(k) + ' kg';
    if (alMax) {
      const nuovo = conPeso ? mezzo(kgTop + passoCarico(ex, kgTop)) : 2.5;
      return {
        tipo: 'su',
        testo: conPeso
          ? 'Alza a ' + kgTxt(nuovo) + ' e riparti da ' + rng(0)[0] + ' reps'
          : 'Massimo del range raggiunto: aggiungi zavorra (' + kgTxt(nuovo) + ') e riparti da ' + rng(0)[0] + ' reps',
        piano: (j) => ({ kg: nuovo, reps: rng(j)[0] })
      };
    }
    if (sotto) {
      const nuovo = Math.max(0, mezzo(kgTop - passoCarico(ex, kgTop))); // un gradino sotto: i carichi reali sono a scatti
      return {
        tipo: 'giu',
        testo: 'Troppo pesante: scendi a ' + kgTxt(nuovo) + ' e punta a ' + rng(0)[0] + ' reps',
        piano: (j) => ({ kg: nuovo, reps: rng(j)[0] })
      };
    }
    const obiettivo = (j) => Math.min(rng(j)[1], dellaSerie(j).reps + 1);
    return {
      tipo: 'reps',
      testo: (conPeso ? 'Resta a ' + kgTxt(kgTop) + ': ' : 'Obiettivo: ') + '+1 rep per serie (fino a ' + rng(0)[1] + ')',
      piano: (j) => ({ kg: conPeso ? (dellaSerie(j).kg ?? kgTop) : null, reps: obiettivo(j) })
    };
  }

  // Riga con il consiglio sotto "Ultima volta"; "Applica" precompila le serie non ancora fatte.
  function htmlSuggerimento(s, ex, key, n) {
    const sug = suggerimento(s, ex);
    if (!sug) return '';
    const daFare = [];
    for (let j = 0; j < n; j++) { const v = valore(s, ex, key, j); if (!v.fatta) daFare.push({ j, v }); }
    const applicato = daFare.length && daFare.every(({ j, v }) => {
      const p = sug.piano(j);
      return (p.kg === null || num(v.kg) === p.kg) && num(v.reps) === p.reps;
    });
    const icona = sug.tipo === 'su' ? '▲' : sug.tipo === 'giu' ? '▼' : '＋';
    return '<p class="suggerimento sug-' + sug.tipo + '"><span class="sug-testo"><b>' + icona + '</b> ' + esc(sug.testo) + '</span>' +
      (!daFare.length ? '' : applicato ? '<span class="sug-ok">✓ applicato</span>'
        : '<button type="button" class="applica-sug">Applica</button>') + '</p>';
  }
  function applicaSuggerimento(card) {
    const s = corrente();
    const v = voce(s, card.dataset.key);
    const sug = v && suggerimento(s, v.ex);
    if (!sug) return;
    [...card.querySelectorAll('.serie')].forEach((riga, j) => {
      if (riga.classList.contains('fatta')) return;
      const p = sug.piano(j);
      if (p.kg !== null) riga.querySelector('[name="kg"]').value = fmtNum(p.kg);
      riga.querySelector('[name="reps"]').value = fmtNum(p.reps);
    });
    salvaBozzaCard(card);
    mantieniScroll(() => renderScheda(s));
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
      if ((!scheda.libera && s.scheda !== scheda.id) || s.id === escludi || !Array.isArray(s.esercizi)) continue;
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
    $('#tabbar').innerHTML = tutte().map((s) =>
      '<button type="button" class="tab" data-tab="' + esc(s.id) + '"' +
      (s.id === tab ? ' aria-current="page"' : '') + '>' + esc(s.nome) + '</button>').join('');
  }

  function render() {
    const s = corrente();
    if (!s) return;
    tab = s.id;
    renderTabbar();
    const btn = $('#btn-vista');
    $('#tabbar').hidden = vista === 'impostazioni' || vista === 'modifica';
    if (vista === 'scheda') {
      $('#titolo').textContent = s.nome;
      btn.textContent = '⚙︎'; btn.setAttribute('aria-label', 'Impostazioni'); btn.classList.add('icona');
    } else {
      btn.classList.remove('icona'); btn.removeAttribute('aria-label');
      $('#titolo').textContent = vista === 'impostazioni' ? 'Impostazioni' : vista === 'modifica' ? 'Modifica scheda' : 'Storico · ' + s.nome;
      btn.textContent = vista === 'modifica' ? '‹ Impostazioni' : vista === 'impostazioni' ? 'Fine' : 'Allenamento';
    }
    if (vista === 'scheda') renderScheda(s);
    else if (vista === 'storico') renderStorico(s);
    else if (vista === 'impostazioni') renderImpostazioni();
    else if (vista === 'modifica') renderModifica();
    else renderDettaglio();
  }

  function renderScheda(s) {
    let h = '';
    const lista = elenco(s);
    // Riga sotto ogni esercizio: aggiungi un esercizio dopo di lui, oppure togli lui. In cima solo "aggiungi".
    const riga = (dopo, ex) => '<div class="riga-ex" data-key="' + esc(dopo) + '">' +
      '<button type="button" class="aggiungi-ex" data-dopo="' + esc(dopo) + '">+ Aggiungi esercizio</button>' +
      (ex ? '<button type="button" class="togli-ex" aria-label="Togli ' + esc(ex.nome) + ' dalla seduta">− Togli esercizio</button>' : '') +
      '</div>';
    h += riga('', null);
    if (!lista.length) {
      h += '<p class="vuoto">' + (s.libera ? 'Scheda giornaliera vuota: aggiungi gli esercizi man mano che ti alleni.' : 'Nessun esercizio in questa scheda: aggiungine uno.') + '</p>';
    }
    lista.forEach(({ key, ex }) => {
      const prev = precedente(s, ex);
      const righe = bozzaDi(s.id).esercizi[key];
      const n = Array.isArray(righe) && righe.length ? righe.length : nSerie(ex);
      const oggiSerie = n !== nSerie(ex) ? ' · oggi ' + n + ' serie' : '';
      h += '<article class="card" data-key="' + esc(key) + '">' +
        '<h2>' + esc(ex.nome) + '</h2><span class="schema">' + esc(schema(ex) + oggiSerie) + '</span>' +
        (ex.nota ? '<p class="nota">' + esc(ex.nota) + '</p>' : '') +
        '<p class="ultima">' + testoUltima(prev) + '</p>' + htmlSuggerimento(s, ex, key, n) +
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
        '</div></article>' + riga(key, ex);
    });
    main.innerHTML = h;
  }

  function renderStorico(s) {
    const lista = ordinate().filter((x) => x.scheda === s.id);
    let h = '<button type="button" id="btn-imp-torna" class="btn-sec">‹ Impostazioni</button><h2 class="sez">Sedute salvate</h2>';
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

  function mantieniScroll(fn) {
    const y = window.scrollY;
    fn();
    window.scrollTo(0, y);
  }
  function rirenderMantenendoScroll(s) {
    const y = window.scrollY;
    renderScheda(s);
    window.scrollTo(0, y);
  }

  // "Togli esercizio" chiede sempre conferma: la riga si trasforma in Annulla / Sì, togli.
  let rigaOriginale = null;
  function chiediTogli(riga) {
    const s = corrente();
    const v = voce(s, riga.dataset.key);
    if (!v) return;
    ripristinaRiga();
    const card = [...main.querySelectorAll('article.card')].find((c) => c.dataset.key === riga.dataset.key);
    const fatte = card ? card.querySelectorAll('.serie.fatta').length : 0;
    rigaOriginale = { riga, html: riga.innerHTML };
    riga.classList.add('conferma');
    riga.innerHTML = '<p class="conferma-testo" role="alert">Togliere «' + esc(v.ex.nome) + '» dalla seduta di oggi?' +
      (fatte ? (fatte === 1 ? ' La serie già fatta verrà tolta dalla seduta.' : ' Le ' + fatte + ' serie già fatte verranno tolte dalla seduta.') : '') + '</p>' +
      '<button type="button" class="annulla-togli">Annulla</button>' +
      '<button type="button" class="conferma-togli">Sì, togli</button>';
  }
  function ripristinaRiga() {
    if (!rigaOriginale) return;
    rigaOriginale.riga.classList.remove('conferma');
    rigaOriginale.riga.innerHTML = rigaOriginale.html;
    rigaOriginale = null;
  }
  function togliEsercizio(key) {
    const s = corrente();
    if (!voce(s, key)) return;
    const b = bozzaDi(s.id);
    b.rimossi = (b.rimossi || []).concat(key);
    delete b.esercizi[key];
    rigaOriginale = null;
    autosalva(s);
    rirenderMantenendoScroll(s);
  }

  // ---------- Catalogo esercizi ----------
  // Confronto senza maiuscole, accenti e punteggiatura: "Stacco rumeno" = "stacco  rumeno".
  const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();

  // Catalogo + esercizi presenti nelle schede o nello storico ma non nel catalogo (gruppo "Altri").
  function voci() {
    const noti = new Set();
    catalogo.forEach((c) => { noti.add(norm(c.nome)); (c.alias || []).forEach((x) => noti.add(norm(x))); });
    const extra = [];
    const aggiungi = (nome) => {
      const n = norm(nome);
      if (n && !noti.has(n)) { noti.add(n); extra.push({ nome, gruppo: 'Altri', attrezzo: '', alias: [] }); }
    };
    schede.forEach((s) => s.esercizi.forEach((x) => aggiungi(x.nome)));
    sessioni.forEach((x) => (x.esercizi || []).forEach((y) => aggiungi(y.nome)));
    return catalogo.concat(extra);
  }
  // Voce del catalogo con quel nome o alias (stesso esercizio, comunque lo si scriva).
  function trova(nome) {
    const n = norm(nome);
    if (!n) return null;
    return voci().find((c) => norm(c.nome) === n) || voci().find((c) => (c.alias || []).some((x) => norm(x) === n)) || null;
  }
  // Esercizio già presente in una scheda con quel nome: serve per serie, reps e ultimi carichi.
  function modelloScheda(nome) {
    const n = norm(nome);
    for (const s of schede) {
      const t = s.esercizi.find((x) => norm(x.nome) === n || (x.alias || []).some((y) => norm(y) === n));
      if (t) return t;
    }
    return null;
  }
  function cerca(q, gruppo) {
    const toks = norm(q).split(' ').filter(Boolean);
    const nq = norm(q);
    const ris = [];
    voci().forEach((c) => {
      if (gruppo && c.gruppo !== gruppo) return;
      const nome = norm(c.nome);
      const hay = nome + ' ' + (c.alias || []).map(norm).join(' ') + ' ' + norm(c.gruppo) + ' ' + norm(c.attrezzo);
      if (!toks.every((t) => hay.includes(t))) return;
      const punti = !toks.length ? 0 : nome === nq ? 0 : nome.startsWith(nq) ? 1 : nome.includes(nq) ? 2 : 3;
      ris.push({ c, punti });
    });
    ris.sort((x, y) => x.punti - y.punti || x.c.nome.localeCompare(y.c.nome));
    return ris.map((r) => r.c);
  }

  const dlg = $('#dlg-ex');
  let dlgDopo = '';
  let dlgModo = 'seduta'; // 'seduta' (solo oggi) | 'scheda' (modifica la scheda)
  let dlgGruppo = '';
  function renderGruppi() {
    const gruppi = [...new Set(voci().map((c) => c.gruppo))];
    $('#dlg-gruppi').innerHTML = ['', ...gruppi].map((g) =>
      '<button type="button" class="chip" data-g="' + esc(g) + '" aria-pressed="' + (g === dlgGruppo) + '">' + esc(g || 'Tutti') + '</button>').join('');
  }
  function renderRisultati() {
    const q = $('#dlg-nome').value;
    const ris = cerca(q, dlgGruppo).slice(0, 60);
    let h = '';
    if (q.trim() && !trova(q)) {
      h += '<li><button type="button" class="ris ris-nuovo" data-nome="' + esc(q.trim()) + '">＋ Crea “' + esc(q.trim()) + '”</button></li>';
    }
    h += ris.map((c) => '<li><button type="button" class="ris" data-nome="' + esc(c.nome) + '"><b>' + esc(c.nome) + '</b>' +
      '<small>' + esc([c.gruppo, c.attrezzo].filter(Boolean).join(' · ')) + '</small></button></li>').join('');
    if (!h) h = '<li class="vuoto">Nessun esercizio trovato</li>';
    $('#dlg-risultati').innerHTML = h;
  }
  function apriAggiungi(dopo, modo) {
    dlgDopo = dopo;
    dlgModo = modo || 'seduta';
    dlgGruppo = '';
    $('#dlg-form').reset();
    renderGruppi();
    renderRisultati();
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }
  function chiudiAggiungi() {
    if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
  }
  // Range di reps di partenza per un esercizio nuovo (serve al tracker per consigliare quando alzare).
  function repsPredefinite(c) {
    if (c.gruppo === 'Cardio') return '';
    if (/plank|hold|hang|wall sit|carry|walk|battle/i.test(c.nome)) return '30"';
    return '8-12';
  }
  function confermaAggiungi() {
    const scritto = $('#dlg-nome').value.trim();
    if (!scritto) { $('#dlg-nome').focus(); return; }
    const s = corrente();
    const c = trova(scritto);
    const nome = c ? c.nome : scritto;      // nome ufficiale del catalogo, così si ritrovano gli stessi esercizi
    const t = modelloScheda(nome);
    const serie = parseInt($('#dlg-serie').value, 10);
    const reps = $('#dlg-reps').value.trim();
    const alias = [...new Set([...(c && c.alias ? c.alias : []), ...(t && t.alias ? t.alias : []), ...(t && t.nome !== nome ? [t.nome] : [])])]
      .filter((x) => x !== nome);
    const ex = {
      nome, serie: serie > 0 ? serie : (t ? nSerie(t) : 3), reps: reps || (t ? t.reps : '') || repsPredefinite(c || { nome, gruppo: '' }), nota: '',
      ultimo: t && Array.isArray(t.ultimo) ? t.ultimo : [],
      ultimoReps: t && Array.isArray(t.ultimoReps) ? t.ultimoReps : [],
      alias
    };
    if (dlgModo === 'scheda') {
      const sc = schede.find((x) => x.id === modificaId);
      if (sc) modificaScheda(sc, () => sc.esercizi.splice(dlgDopo + 1, 0, ex));
      chiudiAggiungi();
      mantieniScroll(renderModifica);
      return;
    }
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

  // ---------- Impostazioni e schede preimpostate ----------
  const MAX_SCHEDE = 7;
  function renderImpostazioni() {
    const n = schede.length;
    let h = '<h2 class="sez">Storico</h2>' +
      '<button type="button" id="btn-apri-storico" class="voce"><span><strong>Storico sedute</strong>' +
      '<small>' + sessioni.length + (sessioni.length === 1 ? ' seduta salvata' : ' sedute salvate') + ' · esporta e importa</small></span><span class="freccia" aria-hidden="true">›</span></button>' +
      '<h2 class="sez">Schede preimpostate</h2><p class="sub">Quante schede usare (da 1 a ' + MAX_SCHEDE + ') e come sono fatte.</p>' +
      '<div class="stepper"><button type="button" id="sch-meno" aria-label="Una scheda in meno"' + (n <= 1 ? ' disabled' : '') + '>−</button>' +
      '<span class="stepper-n" aria-live="polite">' + n + (n === 1 ? ' scheda' : ' schede') + '</span>' +
      '<button type="button" id="sch-piu" aria-label="Una scheda in più"' + (n >= MAX_SCHEDE ? ' disabled' : '') + '>+</button></div>';
    if (confermaImp === 'riduci') {
      const ultima = schede[n - 1];
      h += '<div class="conferma-box" role="alert"><p class="conferma-testo">Togliere la scheda «' + esc(ultima.nome) + '» con i suoi ' +
        ultima.esercizi.length + ' esercizi? Lo storico delle sedute resta salvato.</p>' +
        '<button type="button" id="imp-annulla">Annulla</button><button type="button" id="imp-ok" class="rosso">Sì, togli</button></div>';
    }
    h += '<ul class="lista">' + schede.map((s) =>
      '<li class="scheda-imp"><label class="sr-only" for="ns-' + esc(s.id) + '">Nome della scheda</label>' +
      '<input id="ns-' + esc(s.id) + '" class="nome-scheda" data-id="' + esc(s.id) + '" type="text" maxlength="24" value="' + esc(s.nome) + '">' +
      '<button type="button" class="modifica-scheda" data-id="' + esc(s.id) + '">Esercizi · ' + s.esercizi.length + ' ›</button></li>').join('') + '</ul>';
    if (confermaImp === 'reset') {
      h += '<div class="conferma-box" role="alert"><p class="conferma-testo">Ripristinare le schede originali? Le tue modifiche alle schede andranno perse. Lo storico resta salvato.</p>' +
        '<button type="button" id="imp-annulla">Annulla</button><button type="button" id="imp-ok" class="rosso">Sì, ripristina</button></div>';
    } else {
      h += '<button type="button" id="sch-reset" class="btn-sec piena">↺ Ripristina schede originali</button>';
    }
    main.innerHTML = h;
  }
  function nuovaScheda() {
    let k = schede.length + 1;
    while (schede.some((s) => s.nome === 'Scheda ' + k)) k++;
    return { id: 's' + Date.now().toString(36), nome: 'Scheda ' + k, nota: '', esercizi: [] };
  }

  function renderModifica() {
    const s = schede.find((x) => x.id === modificaId);
    if (!s) { vista = 'impostazioni'; render(); return; }
    const riga = (idx) => '<button type="button" class="ed-aggiungi" data-idx="' + idx + '">+ Aggiungi esercizio</button>';
    let h = '<label class="campo">Nome della scheda<input id="ed-nome" type="text" maxlength="24" value="' + esc(s.nome) + '"></label>' +
      '<label class="campo">Nota (facoltativa)<input id="ed-nota" type="text" value="' + esc(s.nota || '') + '"></label>' +
      '<h2 class="sez">Esercizi</h2>';
    if (!s.esercizi.length) h += '<p class="vuoto">Nessun esercizio: aggiungine uno.</p>';
    h += riga(-1);
    s.esercizi.forEach((ex, i) => {
      const n = s.esercizi.length;
      h += '<section class="card ed-card" data-i="' + i + '">' +
        '<input class="ed-ex-nome" data-campo="nome" type="text" value="' + esc(ex.nome) + '" aria-label="Nome esercizio">' +
        '<div class="dlg-riga"><label>Serie<input data-campo="serie" type="number" inputmode="numeric" min="1" max="12" value="' + esc(ex.serie) + '"></label>' +
        '<label>Reps<input data-campo="reps" type="text" value="' + esc(ex.reps ?? '') + '"></label></div>' +
        '<label>Nota<input data-campo="nota" type="text" value="' + esc(ex.nota ?? '') + '"></label>';
      if (confermaEd === i) {
        h += '<div class="conferma-box" role="alert"><p class="conferma-testo">Togliere «' + esc(ex.nome) + '» dalla scheda?</p>' +
          '<button type="button" class="ed-annulla">Annulla</button><button type="button" class="ed-ok rosso">Sì, togli</button></div>';
      } else {
        h += '<div class="azioni-serie"><button type="button" class="ed-su"' + (i === 0 ? ' disabled' : '') + ' aria-label="Sposta su">▲</button>' +
          '<button type="button" class="ed-giu"' + (i === n - 1 ? ' disabled' : '') + ' aria-label="Sposta giù">▼</button>' +
          '<button type="button" class="ed-togli">Togli</button></div>';
      }
      h += '</section>' + riga(i);
    });
    main.innerHTML = h;
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
  main.addEventListener('change', (e) => {
    const t = e.target;
    if (vista === 'impostazioni' && t.classList.contains('nome-scheda')) {
      const s = schede.find((x) => x.id === t.dataset.id);
      const nome = t.value.trim();
      if (!s) return;
      if (!nome) { t.value = s.nome; return; }
      s.nome = nome; salvaSchede(); renderTabbar();
    } else if (vista === 'modifica') {
      const s = schede.find((x) => x.id === modificaId);
      if (!s) return;
      if (t.id === 'ed-nome') {
        const nome = t.value.trim();
        if (!nome) { t.value = s.nome; return; }
        s.nome = nome; salvaSchede();
      } else if (t.id === 'ed-nota') { s.nota = t.value.trim(); salvaSchede(); }
      else if (t.dataset.campo) {
        const i = Number(t.closest('.ed-card').dataset.i);
        const ex = s.esercizi[i];
        if (!ex) return;
        const campo = t.dataset.campo;
        if (campo === 'nome') {
          const nome = t.value.trim();
          if (!nome) { t.value = ex.nome; return; }
          if (nome !== ex.nome) {
            const vecchio = ex.nome;
            modificaScheda(s, () => {
              ex.alias = [...new Set([...(ex.alias || []), vecchio])].filter((x) => x !== nome); // lo storico resta collegato
              ex.nome = nome;
            });
          }
        } else if (campo === 'serie') {
          const v = parseInt(t.value, 10);
          if (v > 0) { ex.serie = Math.min(12, v); salvaSchede(); } else t.value = ex.serie;
        } else { ex[campo] = t.value.trim(); salvaSchede(); }
      }
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
    } else if (t.id === 'btn-imp-torna') { vista = 'impostazioni'; render(); window.scrollTo(0, 0); }
    else if (t.id === 'btn-apri-storico') { vista = 'storico'; render(); window.scrollTo(0, 0); }
    else if (t.id === 'sch-piu') {
      if (schede.length < MAX_SCHEDE) { schede.push(nuovaScheda()); salvaSchede(); confermaImp = null; mantieniScroll(renderImpostazioni); }
    } else if (t.id === 'sch-meno') { if (schede.length > 1) { confermaImp = 'riduci'; mantieniScroll(renderImpostazioni); } }
    else if (t.id === 'sch-reset') { confermaImp = 'reset'; mantieniScroll(renderImpostazioni); }
    else if (t.id === 'imp-annulla') { confermaImp = null; mantieniScroll(renderImpostazioni); }
    else if (t.id === 'imp-ok') {
      if (confermaImp === 'riduci' && schede.length > 1) schede.pop();
      else if (confermaImp === 'reset') schede = copia(schedeBase);
      confermaImp = null;
      salvaSchede();
      if (!tutte().some((x) => x.id === tab)) { tab = schede[0].id; scrivi(K.tab, tab); }
      renderTabbar();
      mantieniScroll(renderImpostazioni);
    } else if (t.classList.contains('modifica-scheda')) { modificaId = t.dataset.id; confermaEd = -1; vista = 'modifica'; render(); window.scrollTo(0, 0); }
    else if (t.classList.contains('ed-aggiungi')) { apriAggiungi(Number(t.dataset.idx), 'scheda'); }
    else if (t.classList.contains('ed-su') || t.classList.contains('ed-giu')) {
      const s = schede.find((x) => x.id === modificaId);
      const i = Number(t.closest('.ed-card').dataset.i);
      const j = t.classList.contains('ed-su') ? i - 1 : i + 1;
      if (s && j >= 0 && j < s.esercizi.length) {
        modificaScheda(s, () => { const [x] = s.esercizi.splice(i, 1); s.esercizi.splice(j, 0, x); });
        mantieniScroll(renderModifica);
      }
    } else if (t.classList.contains('ed-togli')) { confermaEd = Number(t.closest('.ed-card').dataset.i); mantieniScroll(renderModifica); }
    else if (t.classList.contains('ed-annulla')) { confermaEd = -1; mantieniScroll(renderModifica); }
    else if (t.classList.contains('ed-ok')) {
      const s = schede.find((x) => x.id === modificaId);
      const i = Number(t.closest('.ed-card').dataset.i);
      confermaEd = -1;
      if (s && s.esercizi[i]) modificaScheda(s, () => s.esercizi.splice(i, 1));
      mantieniScroll(renderModifica);
    } else if (t.classList.contains('applica-sug')) {
      applicaSuggerimento(t.closest('article.card'));
    } else if (t.classList.contains('togli-ex')) {
      chiediTogli(t.closest('.riga-ex'));
    } else if (t.classList.contains('annulla-togli')) {
      ripristinaRiga();
    } else if (t.classList.contains('conferma-togli')) {
      togliEsercizio(t.closest('.riga-ex').dataset.key);
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
    confermaImp = null; confermaEd = -1;
    if (vista === 'scheda') vista = 'impostazioni';
    else if (vista === 'modifica') vista = 'impostazioni';
    else vista = 'scheda';
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
  $('#dlg-nome').addEventListener('input', renderRisultati);
  $('#dlg-gruppi').addEventListener('click', (e) => {
    const b = e.target.closest('[data-g]');
    if (!b) return;
    dlgGruppo = b.dataset.g;
    renderGruppi();
    renderRisultati();
  });
  $('#dlg-risultati').addEventListener('click', (e) => {
    const b = e.target.closest('[data-nome]');
    if (!b) return;
    $('#dlg-nome').value = b.dataset.nome;
    const t = modelloScheda(b.dataset.nome);
    $('#dlg-serie').placeholder = t ? String(nSerie(t)) : '3';
    $('#dlg-reps').placeholder = t && t.reps ? String(t.reps) : '8-12';
    $('#dlg-serie').focus();
  });
  $('#dlg-form').addEventListener('submit', (e) => { e.preventDefault(); confermaAggiungi(); });
  $('#dlg-annulla').addEventListener('click', chiudiAggiungi);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && timer) mostraTimer(); });

  // ---------- Avvio ----------
  async function avvio() {
    try {
      const d = await caricaSchede();
      schedeBase = d.schede;
      schede = copia(d.schede);
      const u = leggi(K.schedeUtente, null);
      try { validaSchede({ schede: u }); if (u.length <= 7) schede = u; } catch (e) { /* si usano quelle originali */ }
      await caricaCatalogo();
    } catch (e) {
      main.innerHTML = '<p class="errore">Impossibile caricare le schede (' + esc(e.message) +
        '). Apri l\'app una volta con internet attivo.</p>';
      return;
    }
    if (!tutte().some((s) => s.id === tab)) tab = schede[0].id;
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
