'use strict';
(() => {
  // ---------- Archiviazione (localStorage con try/catch ovunque) ----------
  const K = {
    sessioni: 'sp.sessioni', bozza: 'sp.bozza', durata: 'sp.durata',
    timer: 'sp.timer', tab: 'sp.tab', schede: 'sp.schede', ridotto: 'sp.ridotto', catalogo: 'sp.catalogo',
    schedeUtente: 'sp.schedeUtente', tema: 'sp.tema', suono: 'sp.suono'
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
      toast('Impossibile salvare sul telefono');
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
  const pad = (n) => String(n).padStart(2, '0');
  const maiuscola = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const migliaia = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); // 2340 -> 2.340
  const fmtDataBreve = (iso) => new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  const fmtDataLunga = (iso) => maiuscola(new Date(iso).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  const oraBreve = (iso) => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const dataCsv = (iso) => {
    const d = new Date(iso);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  };
  const mmss = (s) => Math.floor(s / 60) + ':' + pad(s % 60);
  const plurale = (n, uno, molti) => n + ' ' + (n === 1 ? uno : molti);

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  const ICONA = {
    avanti: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    su: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 15l7-7 7 7"/></svg>',
    giu: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9l7 7 7-7"/></svg>',
    piu: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    meno: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
    spunta: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
  };

  // ---------- Stato ----------
  const main = $('#main');
  let schede = [];
  let catalogo = []; // dataset di tutti gli esercizi noti (catalogo.json)
  let schedeBase = []; // schede originali di schede.json (per "Ripristina")
  let tab = leggi(K.tab, null);
  let vista = 'scheda'; // 'scheda' | 'storico' | 'dettaglio' | 'impostazioni' | 'modifica'
  let sessioni = leggi(K.sessioni, []);
  if (!Array.isArray(sessioni)) sessioni = [];
  let bozza = leggi(K.bozza, {});
  if (!bozza || typeof bozza !== 'object' || Array.isArray(bozza)) bozza = {};
  let durata = leggi(K.durata, 120);
  if (![90, 120, 180].includes(durata)) durata = 120;
  let timer = leggi(K.timer, null);
  if (!timer || typeof timer.fine !== 'number') timer = null;
  let ridotto = leggi(K.ridotto, false) === true;
  let suono = leggi(K.suono, true) !== false;
  let tema = leggi(K.tema, 'scuro');
  if (!['scuro', 'chiaro', 'auto'].includes(tema)) tema = 'scuro';

  // Stato della sola interfaccia (non si salva): cosa e' aperto e quali conferme sono in sospeso.
  const aperto = {};          // per scheda: chiave dell'esercizio aperto ('' = tutti chiusi, assente = il primo da fare)
  let serieAttiva = null;     // serie in modifica nell'esercizio aperto (null = la prima da fare)
  let confermaTogli = null;   // chiave dell'esercizio di cui si chiede conferma di rimozione
  let modificaId = null;      // scheda aperta nell'editor
  let edAperto = -1;          // esercizio aperto nell'editor
  let confermaEd = -1;        // esercizio dell'editor in attesa di conferma di rimozione
  let confermaElimina = false; // conferma "Elimina scheda" nell'editor
  let confermaReset = false;  // conferma "Ripristina le schede originali"
  let importAttesa = null;    // backup letto, in attesa di conferma
  let dettaglioId = null;
  let confermaSeduta = false; // conferma "Elimina seduta"
  let filtroStorico = '';

  // Tema: scuro (predefinito), chiaro o automatico (segue il telefono). Il primo disegno lo imposta index.html.
  function applicaTema() {
    const chiaro = tema === 'chiaro' || (tema === 'auto' && window.matchMedia('(prefers-color-scheme: light)').matches);
    document.documentElement.dataset.tema = tema;
    document.documentElement.dataset.luce = chiaro ? 'chiaro' : 'scuro';
    const m = $('#tc');
    if (m) m.setAttribute('content', chiaro ? '#f2efe8' : '#121110');
  }

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
  // Tenute a tempo (plank e simili): le "reps" sono secondi.
  const aTempo = (ex) => /["”″']/.test(String(ex.reps ?? ''));

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
  const MAX_SCHEDE = 7;
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
    delete aperto[s.id];
    salvaSchede();
  }
  function nuovaScheda() {
    let k = schede.length + 1;
    while (schede.some((s) => s.nome === 'Scheda ' + k)) k++;
    return { id: 's' + Date.now().toString(36), nome: 'Scheda ' + k, nota: '', esercizi: [] };
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
    if (!reps) return plurale(nSerie(ex), 'serie', 'serie');
    if (/\dx\d/i.test(reps)) return ex.serie + ' serie · ' + reps;
    return ex.serie + ' × ' + reps;
  }

  // ---------- Progressione intelligente ----------
  // Doppia progressione: finché non raggiungi il massimo del range di reps su tutte le serie
  // col carico più alto, resta a quel peso e aggiungi ripetizioni; poi alza il peso e riparti dal minimo.
  function intervalliReps(ex) {
    const txt = String(ex.reps ?? '');
    if (!txt.trim() || aTempo(ex)) return null; // tenute a tempo: nessun suggerimento
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
    const tutti = voci();
    return tutti.find((c) => norm(c.nome) === n) || tutti.find((c) => (c.alias || []).some((x) => norm(x) === n)) || null;
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
  // Range di reps di partenza per un esercizio nuovo (serve al tracker per consigliare quando alzare).
  function repsPredefinite(c) {
    if (c.gruppo === 'Cardio') return '';
    if (/plank|hold|hang|wall sit|carry|walk|battle/i.test(c.nome)) return '30"';
    return '8-12';
  }

  // ---------- Seduta di oggi ----------
  // Righe (serie) di un esercizio nella seduta di oggi. Finche' non le tocchi restano calcolate
  // dall'ultima volta; con crea = true entrano nella bozza e da li' in poi si modificano.
  function righeDi(s, key, ex, crea) {
    const b = bozzaDi(s.id);
    const r = b.esercizi[key];
    if (Array.isArray(r) && r.length) return r;
    const nuove = Array.from({ length: nSerie(ex) }, (_, j) => {
      const v = valore(s, ex, key, j);
      return { kg: v.kg, reps: v.reps, fatta: false, toccata: false };
    });
    if (crea) b.esercizi[key] = nuove;
    return nuove;
  }
  function statoSeduta(s) {
    return elenco(s).map(({ key, ex }) => {
      const righe = righeDi(s, key, ex, false);
      const fatte = righe.filter((r) => r.fatta).length;
      return { key, ex, righe, fatte, completo: fatte === righe.length };
    });
  }
  function chiaveAperta(s, lista) {
    const a = aperto[s.id];
    if (a === '') return '';
    if (a && lista.some((x) => x.key === a)) return a;
    const primo = lista.find((x) => !x.completo);
    return primo ? primo.key : '';
  }
  function indiceAttivo(v) {
    if (serieAttiva !== null && serieAttiva < v.righe.length) return serieAttiva;
    return v.righe.findIndex((r) => !r.fatta);
  }

  // Aggiorna (o crea) la seduta di oggi con le serie fatte.
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
    if (!(scrivi(K.sessioni, sessioni) && scrivi(K.bozza, bozza))) toast('Salvataggio non riuscito');
  }

  // Numeri di una seduta salvata: esercizi, serie, minuti e kg sollevati (peso × reps).
  function numeriSeduta(x) {
    let serie = 0, volume = 0;
    (x.esercizi || []).forEach((e) => (e.serie || []).forEach((r) => {
      serie++;
      const k = num(r.kg), p = num(r.reps);
      if (k !== null && p !== null) volume += k * p;
    }));
    const min = x.aggiornata && x.data ? Math.max(0, Math.round((Date.parse(x.aggiornata) - Date.parse(x.data)) / 60000)) : 0;
    return { es: (x.esercizi || []).length, serie, volume, min };
  }
  // "65×10" nelle righe compatte.
  function breveSerie(x) {
    const kg = num(x.kg), reps = num(x.reps);
    if (kg !== null && reps !== null) return fmtNum(kg) + '×' + fmtNum(reps);
    if (kg !== null) return fmtNum(kg) + ' kg';
    if (reps !== null) return fmtNum(reps);
    return '-';
  }
  // "65 kg × 10" nelle righe grandi.
  function htmlValore(x, tempo) {
    const kg = num(x.kg), reps = num(x.reps);
    const u = tempo ? 'sec' : 'reps';
    if (kg !== null && reps !== null) return '<span class="serie-val">' + esc(fmtNum(kg)) + '<small>kg ×</small>' + esc(fmtNum(reps)) + (tempo ? '<small>sec</small>' : '') + '</span>';
    if (kg !== null) return '<span class="serie-val">' + esc(fmtNum(kg)) + '<small>kg</small></span>';
    if (reps !== null) return '<span class="serie-val">' + esc(fmtNum(reps)) + '<small>' + u + '</small></span>';
    return '<span class="serie-val vuota">Da compilare</span>';
  }

  // ---------- Navigazione ----------
  // Cronologia: ogni livello (Impostazioni, Storico, Seduta) e' una voce, cosi' lo swipe indietro di iOS torna al livello sopra.
  const PROFONDITA = { scheda: 0, impostazioni: 1, storico: 2, modifica: 2, dettaglio: 3 };
  const GENITORE = { impostazioni: 'scheda', storico: 'impostazioni', modifica: 'impostazioni', dettaglio: 'storico' };
  const TITOLO = { impostazioni: 'Impostazioni', storico: 'Storico', modifica: 'Modifica scheda', dettaglio: 'Seduta' };
  const TORNA = { impostazioni: 'Torna all\'allenamento', storico: 'Torna alle impostazioni', modifica: 'Torna alle impostazioni', dettaglio: 'Torna allo storico' };
  let profondita = 0;
  let ignoraPop = false;
  function sincronizzaStoria() {
    const t = PROFONDITA[vista] ?? 0;
    try {
      if (t > profondita) { for (let d = profondita + 1; d <= t; d++) history.pushState({ d }, ''); profondita = t; }
      else if (t < profondita) { ignoraPop = true; const delta = t - profondita; profondita = t; history.go(delta); }
    } catch (e) { profondita = t; }
  }
  function azzeraConferme() {
    confermaTogli = null; confermaEd = -1; confermaElimina = false; confermaReset = false; confermaSeduta = false; importAttesa = null;
  }
  function vai(v) {
    azzeraConferme();
    vista = v;
    render();
    window.scrollTo(0, 0);
  }
  function indietro() { vai(GENITORE[vista] || 'scheda'); }
  function mantieniScroll(fn) {
    const y = window.scrollY;
    fn();
    window.scrollTo(0, y);
  }

  function renderNav() {
    const nav = $('#schede-nav');
    nav.innerHTML = tutte().map((s) =>
      '<button type="button" class="tab" data-tab="' + esc(s.id) + '"' +
      (s.id === tab ? ' aria-current="page"' : '') + '>' + esc(s.nome) + '</button>').join('');
    const att = nav.querySelector('[aria-current="page"]');
    if (att) nav.scrollLeft = Math.max(0, att.offsetLeft - 24);
    aggiornaFade();
  }
  function aggiornaFade() {
    const t = $('#schede-nav');
    t.classList.toggle('fade-dx', t.scrollWidth > t.clientWidth + 2 && t.scrollLeft + t.clientWidth < t.scrollWidth - 2);
  }

  function render() {
    const s = corrente();
    if (!s) return;
    tab = s.id;
    sincronizzaStoria();
    const inScheda = vista === 'scheda';
    const titolo = $('#titolo');
    $('#schede-nav').hidden = !inScheda;
    $('#btn-impostazioni').hidden = !inScheda;
    $('#btn-indietro').hidden = inScheda;
    $('#btn-indietro').setAttribute('aria-label', TORNA[vista] || 'Indietro');
    titolo.classList.toggle('sr-only', inScheda);
    titolo.textContent = inScheda ? 'Allenamento: ' + s.nome : TITOLO[vista];
    document.title = (inScheda ? s.nome : TITOLO[vista]) + ' · Schede palestra';
    if (inScheda) { renderNav(); renderAllenamento(s); }
    else if (vista === 'storico') renderStorico();
    else if (vista === 'impostazioni') renderImpostazioni();
    else if (vista === 'modifica') renderModifica();
    else renderDettaglio();
  }

  // ---------- Vista: allenamento ----------
  function htmlRiepilogo(s, lista) {
    const tot = lista.reduce((t, v) => t + v.righe.length, 0);
    const fatte = lista.reduce((t, v) => t + v.fatte, 0);
    const esFatti = lista.filter((v) => v.completo).length;
    const sed = sessioni.find((x) => x.id === inCorso(s));
    let riga1, riga2 = '';
    if (fatte === tot) {
      const n = sed ? numeriSeduta(sed) : null;
      riga1 = 'Seduta completa';
      riga2 = [n && n.min > 0 ? n.min + ' min' : '', n && n.volume > 0 ? migliaia(n.volume) + ' kg sollevati' : ''].filter(Boolean).join(' · ');
    } else if (fatte > 0) {
      riga1 = esFatti + ' di ' + plurale(lista.length, 'esercizio', 'esercizi');
      riga2 = sed ? 'Iniziata alle ' + oraBreve(sed.data) : '';
    } else {
      const ultima = ordinate().find((x) => x.scheda === s.id);
      riga1 = plurale(lista.length, 'esercizio', 'esercizi');
      riga2 = ultima ? 'Ultima seduta: ' + fmtDataBreve(ultima.data) : 'Prima seduta';
    }
    const striscia = lista.map((v) => '<span class="gr" style="flex:' + v.righe.length + '">' +
      v.righe.map((r) => '<i' + (r.fatta ? ' class="piena"' : '') + '></i>').join('') + '</span>').join('');
    return '<section class="riepilogo" aria-label="Avanzamento della seduta"><div class="riep-riga">' +
      '<p class="riep-num">' + fatte + '<span>/' + tot + '</span><small>serie fatte</small></p>' +
      '<p class="riep-info"><strong>' + esc(riga1) + '</strong>' + esc(riga2) + '</p></div>' +
      '<div class="striscia" aria-hidden="true">' + striscia + '</div></section>';
  }

  function htmlConsiglio(s, v) {
    const sug = suggerimento(s, v.ex);
    if (!sug) return '';
    const daFare = v.righe.map((r, j) => ({ r, j })).filter((x) => !x.r.fatta);
    const applicato = daFare.length > 0 && daFare.every(({ r, j }) => {
      const p = sug.piano(j);
      return (p.kg === null || num(r.kg) === p.kg) && num(r.reps) === p.reps;
    });
    return '<div class="consiglio"><p><b>Consiglio</b>' + esc(sug.testo) + '</p>' +
      (!daFare.length ? '' : applicato ? '<span class="applicato">Applicato</span>'
        : '<button type="button" class="btn" data-az="applica">Applica</button>') + '</div>';
  }

  function htmlPasso(campo, eti, unita, val, cosa) {
    return '<div class="passo"><label for="in-' + campo + '">' + eti + (unita ? '<small>' + unita + '</small>' : '') + '</label>' +
      '<button type="button" class="passo-btn" data-az="passo" data-campo="' + campo + '" data-d="-1" aria-label="Diminuisci ' + cosa + '">' + ICONA.meno + '</button>' +
      '<input id="in-' + campo + '" name="' + campo + '" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="0" value="' + esc(val) + '">' +
      '<button type="button" class="passo-btn" data-az="passo" data-campo="' + campo + '" data-d="1" aria-label="Aumenta ' + cosa + '">' + ICONA.piu + '</button></div>';
  }

  function htmlEsercizio(s, v, apertoOra) {
    const { key, ex, righe, fatte, completo } = v;
    const n = righe.length;
    const tempo = aTempo(ex);
    const sotto = completo ? righe.map(breveSerie).join(' · ') : schema(ex) + (n !== nSerie(ex) ? ' · oggi ' + n + ' serie' : '');
    let h = '<li class="es' + (apertoOra ? ' aperto' : '') + (completo ? ' completo' : '') + '" data-key="' + esc(key) + '">' +
      '<h2 class="es-h"><button type="button" class="es-testa" data-az="apri" aria-expanded="' + apertoOra + '">' +
      '<span class="es-nome">' + esc(ex.nome) + '</span>' +
      '<span class="tacche" aria-hidden="true">' + righe.map((r) => '<i' + (r.fatta ? ' class="piena"' : '') + '></i>').join('') + '</span>' +
      '<span class="es-sotto">' + esc(sotto) + '</span>' +
      '<span class="sr-only">, ' + fatte + ' di ' + n + ' serie fatte</span></button></h2>';
    if (!apertoOra) return h + '</li>';

    const prev = precedente(s, ex);
    h += '<div class="es-corpo">';
    if (ex.nota) h += '<p class="es-nota">' + esc(ex.nota) + '</p>';
    h += '<p class="es-ultima"><span>' + (prev && prev.data ? 'Ultima volta, ' + esc(fmtDataBreve(prev.data)) : 'Ultima volta') + '</span>' +
      '<b>' + (prev ? esc(prev.serie.map(breveSerie).join(' · ')) : 'nessun dato') + '</b></p>';
    h += htmlConsiglio(s, v);

    const att = indiceAttivo(v);
    h += '<ol class="serie-lista">';
    righe.forEach((r, j) => {
      if (j === att) {
        h += '<li class="serie-attiva" data-j="' + j + '">' +
          '<p class="ed-titolo"><span class="tacca-n' + (r.fatta ? ' piena' : '') + '" aria-hidden="true">' + (j + 1) + '</span>' +
          '<span>Serie ' + (j + 1) + ' di ' + n + '</span>' + (r.fatta ? '<span class="ed-stato">fatta</span>' : '') + '</p>' +
          htmlPasso('kg', 'Peso', 'kg', r.kg, 'il peso') +
          htmlPasso('reps', tempo ? 'Tempo' : 'Reps', tempo ? 'sec' : '', r.reps, tempo ? 'il tempo' : 'le ripetizioni') +
          (r.fatta
            ? '<button type="button" class="btn btn-tonale piena" data-az="non-fatta">Segna da fare</button>'
            : '<button type="button" class="btn btn-pri piena" data-az="fatta">Serie fatta</button>') + '</li>';
      } else {
        h += '<li><button type="button" class="serie-riga' + (r.fatta ? ' fatta' : '') + '" data-az="serie" data-j="' + j + '">' +
          '<span class="tacca-n' + (r.fatta ? ' piena' : '') + '"><span class="sr-only">Serie </span>' + (j + 1) + '</span>' +
          htmlValore(r, tempo) +
          (r.fatta ? ICONA.spunta + '<span class="sr-only">fatta, tocca per correggere</span>' : '<span class="sr-only">da fare, tocca per modificare</span>') +
          '</button></li>';
      }
    });
    h += '</ol>';

    h += '<div class="es-azioni">' +
      '<button type="button" class="btn btn-tonale" data-az="meno-serie"' + (n <= 1 ? ' disabled' : '') + '>Togli serie</button>' +
      '<button type="button" class="btn btn-tonale" data-az="piu-serie"' + (n >= 12 ? ' disabled' : '') + '>Aggiungi serie</button></div>';
    if (confermaTogli === key) {
      h += '<div class="conferma" role="alert"><p>Togliere ' + esc(ex.nome) + ' dalla seduta di oggi?' +
        (fatte ? ' ' + (fatte === 1 ? 'La serie già fatta viene cancellata.' : 'Le ' + fatte + ' serie già fatte vengono cancellate.') : '') +
        ' La scheda non cambia.</p><div class="conferma-azioni">' +
        '<button type="button" class="btn btn-tonale" data-az="togli-annulla">Annulla</button>' +
        '<button type="button" class="btn btn-rosso" data-az="togli-ok">Togli</button></div></div>';
    } else {
      h += '<div class="es-piede">' +
        '<button type="button" class="btn-testo" data-az="aggiungi-ex" data-dopo="' + esc(key) + '">Aggiungi esercizio dopo</button>' +
        '<button type="button" class="btn-testo rosso" data-az="togli-ex">Togli esercizio</button></div>';
    }
    return h + '</div></li>';
  }

  function renderAllenamento(s) {
    const lista = statoSeduta(s);
    if (!lista.length) {
      main.innerHTML = '<div class="stato-vuoto"><p>' +
        (s.libera ? 'La Giornaliera parte vuota ogni giorno. Aggiungi gli esercizi mentre ti alleni.' : 'Questa scheda non ha ancora esercizi.') +
        '</p><button type="button" class="btn btn-pri piena" data-az="aggiungi-ex" data-dopo="">Aggiungi esercizio</button></div>';
      return;
    }
    const kA = chiaveAperta(s, lista);
    main.innerHTML = htmlRiepilogo(s, lista) +
      '<ol class="esercizi">' + lista.map((v) => htmlEsercizio(s, v, v.key === kA)).join('') + '</ol>' +
      '<button type="button" class="btn btn-tonale piena" data-az="aggiungi-ex" data-dopo="' + esc(lista[lista.length - 1].key) + '">' +
      ICONA.piu + 'Aggiungi esercizio</button>';
  }
  const ridisegna = () => mantieniScroll(() => renderAllenamento(corrente()));

  const riduciMovimento = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  // Porta l'esercizio appena aperto sotto la testata, se e' finito fuori vista.
  function portaInVista() {
    const el = main.querySelector('.es.aperto');
    if (!el) return;
    const r = el.getBoundingClientRect();
    const testa = $('.top').offsetHeight;
    const sotto = elDock.hidden ? 0 : elDock.offsetHeight;
    if (r.top < testa + 8 || r.top > (window.innerHeight - sotto) * 0.5) {
      window.scrollTo({ top: window.scrollY + r.top - testa - 8, behavior: riduciMovimento.matches ? 'auto' : 'smooth' });
    }
  }

  function apriEsercizio(key) {
    const s = corrente();
    const era = chiaveAperta(s, statoSeduta(s));
    aperto[s.id] = era === key ? '' : key;
    serieAttiva = null;
    confermaTogli = null;
    ridisegna();
    if (era !== key) portaInVista();
  }

  function segna(key, j, fatta) {
    const s = corrente();
    const v = voce(s, key);
    if (!v) return;
    const righe = righeDi(s, key, v.ex, true);
    if (!righe[j]) return;
    righe[j].fatta = fatta;
    autosalva(s);
    confermaTogli = null;
    if (!fatta) { serieAttiva = j; ridisegna(); return; }
    // Le serie dopo, se hanno ancora un campo vuoto (esercizio nuovo, niente storico), partono da questa.
    righe.slice(j + 1).forEach((r) => {
      if (r.fatta) return;
      if (num(r.kg) === null) r.kg = righe[j].kg;
      if (num(r.reps) === null) r.reps = righe[j].reps;
    });
    scrivi(K.bozza, bozza);
    sblocca();
    serieAttiva = null;
    const lista = statoSeduta(s);
    const io = lista.findIndex((x) => x.key === key);
    const finita = lista.every((x) => x.completo);
    let cambia = false;
    if (lista[io].completo) {
      const prossimo = lista.slice(io + 1).find((x) => !x.completo) || lista.find((x) => !x.completo);
      aperto[s.id] = prossimo ? prossimo.key : '';
      cambia = true;
    }
    if (finita) fermaTimer(); else avviaTimer();
    ridisegna();
    if (finita) window.scrollTo({ top: 0, behavior: riduciMovimento.matches ? 'auto' : 'smooth' });
    else if (cambia) portaInVista();
    const b = main.querySelector('[data-az="fatta"]');
    if (b) b.focus({ preventScroll: true });
  }

  // Pulsanti meno e piu': il peso si muove del passo dell'attrezzo, le reps di 1 (i secondi di 5).
  function passo(key, j, campo, d) {
    const s = corrente();
    const v = voce(s, key);
    if (!v) return;
    const r = righeDi(s, key, v.ex, true)[j];
    if (!r) return;
    const ora = num(r[campo]);
    let nuovo;
    if (campo === 'kg') {
      if (ora === null && d < 0) return;
      const base = ora ?? 0;
      nuovo = Math.max(0, mezzo(base + d * passoCarico(v.ex, d > 0 ? base : base - 0.01)));
    } else {
      nuovo = Math.max(0, Math.round((ora ?? 0) + d * (aTempo(v.ex) ? 5 : 1)));
    }
    r[campo] = fmtNum(nuovo);
    autosalva(s);
    const campoEl = main.querySelector('#in-' + campo);
    if (campoEl) campoEl.value = r[campo];
  }

  function applicaConsiglio(key) {
    const s = corrente();
    const v = voce(s, key);
    const sug = v && suggerimento(s, v.ex);
    if (!sug) return;
    righeDi(s, key, v.ex, true).forEach((r, j) => {
      if (r.fatta) return;
      const p = sug.piano(j);
      if (p.kg !== null) r.kg = fmtNum(p.kg);
      r.reps = fmtNum(p.reps);
    });
    autosalva(s);
    ridisegna();
  }

  // Aggiunge (d = 1) o toglie (d = -1) l'ultima serie di un esercizio, solo per la seduta di oggi.
  function cambiaSerie(key, d) {
    const s = corrente();
    const v = voce(s, key);
    if (!v) return;
    const righe = righeDi(s, key, v.ex, true);
    if (d > 0 && righe.length < 12) {
      const p = precedenteSerie(s, v.ex, righe.length);
      const u = righe[righe.length - 1] || {};
      righe.push(p ? { kg: fmtNum(num(p.kg)), reps: fmtNum(num(p.reps)), fatta: false, toccata: false }
        : { kg: u.kg ?? '', reps: u.reps ?? '', fatta: false, toccata: false });
    } else if (d < 0 && righe.length > 1) {
      righe.pop();
    } else return;
    serieAttiva = null;
    autosalva(s);
    ridisegna();
  }

  function togliEsercizio(key) {
    const s = corrente();
    if (!voce(s, key)) return;
    const b = bozzaDi(s.id);
    b.rimossi = (b.rimossi || []).concat(key);
    delete b.esercizi[key];
    confermaTogli = null;
    delete aperto[s.id];
    serieAttiva = null;
    autosalva(s);
    ridisegna();
  }

  // ---------- Foglio "Aggiungi esercizio" ----------
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
    const scelto = trova(q);
    const ris = cerca(q, dlgGruppo).slice(0, 60);
    let h = '';
    if (q.trim() && !scelto) {
      h += '<li><button type="button" class="ris" data-nome="' + esc(q.trim()) + '" aria-pressed="true"><span><b>Usa "' + esc(q.trim()) + '"</b>' +
        '<small>Esercizio nuovo, non in elenco</small></span>' + ICONA.spunta + '</button></li>';
    }
    h += ris.map((c) => '<li><button type="button" class="ris" data-nome="' + esc(c.nome) + '" aria-pressed="' + (scelto === c) + '"><span><b>' + esc(c.nome) + '</b>' +
      '<small>' + esc([c.gruppo, c.attrezzo].filter(Boolean).join(' · ')) + '</small></span>' + ICONA.spunta + '</button></li>').join('');
    if (!h) h = '<li class="stato">Nessun esercizio in questo gruppo.</li>';
    $('#dlg-risultati').innerHTML = h;
    $('#dlg-conteggio').textContent = plurale(ris.length, 'risultato', 'risultati');
    const t = scelto ? modelloScheda(scelto.nome) : null;
    $('#dlg-serie').placeholder = t ? String(nSerie(t)) : '3';
    $('#dlg-reps').placeholder = t && t.reps ? String(t.reps) : (scelto ? repsPredefinite(scelto) || '8-12' : '8-12');
  }
  function apriAggiungi(dopo, modo) {
    dlgDopo = dopo;
    dlgModo = modo || 'seduta';
    dlgGruppo = '';
    $('#dlg-form').reset();
    $('#dlg-errore').hidden = true;
    $('#dlg-titolo').textContent = dlgModo === 'scheda' ? 'Aggiungi alla scheda' : 'Aggiungi esercizio';
    renderGruppi();
    renderRisultati();
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    adattaFoglio();
    $('#dlg-risultati').scrollTop = 0;
    $('#dlg-nome').focus();
  }
  // Con la tastiera aperta lo schermo visibile si riduce: il foglio lo segue, cosi' "Aggiungi" resta raggiungibile.
  function adattaFoglio() {
    const vv = window.visualViewport;
    if (!vv || window.innerWidth >= 700) { dlg.style.top = ''; dlg.style.height = ''; return; }
    const sopra = vv.offsetTop + 12;
    dlg.style.top = sopra + 'px';
    dlg.style.height = Math.max(240, vv.height - 12) + 'px';
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => { if (dlg.open) adattaFoglio(); });
    window.visualViewport.addEventListener('scroll', () => { if (dlg.open) adattaFoglio(); });
  }
  function chiudiAggiungi() {
    if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
  }
  function confermaAggiungi() {
    const scritto = $('#dlg-nome').value.trim();
    if (!scritto) { $('#dlg-errore').hidden = false; $('#dlg-nome').focus(); return; }
    const s = corrente();
    const c = trova(scritto);
    const nome = c ? c.nome : scritto;      // nome ufficiale del catalogo, così si ritrovano gli stessi esercizi
    const t = modelloScheda(nome);
    const serie = parseInt($('#dlg-serie').value, 10);
    const reps = $('#dlg-reps').value.trim();
    const alias = [...new Set([...(c && c.alias ? c.alias : []), ...(t && t.alias ? t.alias : []), ...(t && t.nome !== nome ? [t.nome] : [])])]
      .filter((x) => x !== nome);
    const ex = {
      nome, serie: serie > 0 ? Math.min(12, serie) : (t ? nSerie(t) : 3), reps: reps || (t ? t.reps : '') || repsPredefinite(c || { nome, gruppo: '' }), nota: '',
      ultimo: t && Array.isArray(t.ultimo) ? t.ultimo : [],
      ultimoReps: t && Array.isArray(t.ultimoReps) ? t.ultimoReps : [],
      alias
    };
    if (dlgModo === 'scheda') {
      const sc = schede.find((x) => x.id === modificaId);
      if (sc) { modificaScheda(sc, () => sc.esercizi.splice(dlgDopo + 1, 0, ex)); edAperto = dlgDopo + 1; }
      chiudiAggiungi();
      mantieniScroll(renderModifica);
      return;
    }
    const b = bozzaDi(s.id);
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    b.aggiunti = (b.aggiunti || []).concat({ id, dopo: dlgDopo, ex });
    scrivi(K.bozza, bozza);
    aperto[s.id] = 'x' + id + '|' + ex.nome;
    serieAttiva = null;
    confermaTogli = null;
    chiudiAggiungi();
    ridisegna();
    portaInVista();
  }

  // ---------- Vista: impostazioni ----------
  // Riga di elenco toccabile. La freccia c'e' solo quando porta a un'altra pagina.
  function rigaNav(az, id, titolo, sotto, extra, azione) {
    return '<li><button type="button" class="riga-nav" data-az="' + az + '"' + (id ? ' data-id="' + esc(id) + '"' : '') + '>' + (extra || '') +
      '<span class="riga-testo"><strong>' + esc(titolo) + '</strong><small>' + esc(sotto) + '</small></span>' + (azione ? '' : ICONA.avanti) + '</button></li>';
  }
  function htmlConferma(testo, azAnnulla, azOk, etiOk) {
    return '<div class="conferma" role="alert"><p>' + esc(testo) + '</p><div class="conferma-azioni">' +
      '<button type="button" class="btn btn-tonale" data-az="' + azAnnulla + '">Annulla</button>' +
      '<button type="button" class="btn btn-rosso" data-az="' + azOk + '">' + etiOk + '</button></div></div>';
  }
  function renderImpostazioni() {
    const seg = (az, v, txt, attivo) => '<button type="button" data-az="' + az + '" data-v="' + v + '" aria-pressed="' + attivo + '">' + txt + '</button>';
    const ultima = ordinate()[0];
    let h = '<h2 class="sez">Schede</h2><ul class="lista">' +
      schede.map((s) => rigaNav('apri-scheda', s.id, s.nome, plurale(s.esercizi.length, 'esercizio', 'esercizi'))).join('') + '</ul>';
    h += schede.length < MAX_SCHEDE
      ? '<button type="button" class="btn btn-tonale piena" data-az="nuova-scheda">' + ICONA.piu + 'Nuova scheda</button>'
      : '<p class="aiuto">Hai raggiunto il massimo di ' + MAX_SCHEDE + ' schede.</p>';
    h += confermaReset
      ? htmlConferma('Ripristinare le schede originali? Le modifiche che hai fatto alle schede vanno perse. Lo storico resta.', 'reset-annulla', 'reset-ok', 'Ripristina')
      : '<p class="rientro"><button type="button" class="btn-testo" data-az="reset">Ripristina le schede originali</button></p>';

    h += '<h2 class="sez">Storico</h2><ul class="lista">' +
      rigaNav('apri-storico', '', 'Sedute salvate', sessioni.length
        ? plurale(sessioni.length, 'seduta', 'sedute') + ', ultima il ' + fmtDataBreve(ultima.data)
        : 'Ancora nessuna') + '</ul>';

    h += '<h2 class="sez">Recupero</h2><p class="eti" id="eti-durata">Durata tra una serie e l\'altra</p>' +
      '<div class="segmentato" role="group" aria-labelledby="eti-durata">' +
      [90, 120, 180].map((d) => seg('durata', d, mmss(d), durata === d)).join('') + '</div>' +
      '<label class="interruttore"><span class="riga-testo"><strong>Suono a fine recupero</strong>' +
      '<small>Tre bip. Su iPhone non suona in modalità silenziosa.</small></span>' +
      '<input type="checkbox" role="switch" id="imp-suono"' + (suono ? ' checked' : '') + '></label>';

    h += '<h2 class="sez">Aspetto</h2><div class="segmentato" role="group" aria-label="Tema">' +
      seg('tema', 'scuro', 'Scuro', tema === 'scuro') + seg('tema', 'chiaro', 'Chiaro', tema === 'chiaro') + seg('tema', 'auto', 'Automatico', tema === 'auto') + '</div>';

    h += '<h2 class="sez" id="sez-dati">Dati</h2>';
    if (importAttesa) {
      h += htmlConferma('Ripristinare ' + plurale(importAttesa.lista.length, 'seduta', 'sedute') + ' dal backup? Lo storico attuale (' +
        plurale(sessioni.length, 'seduta', 'sedute') + ') viene sostituito.', 'importa-annulla', 'importa-ok', 'Sostituisci');
    } else {
      h += '<ul class="lista">' +
        rigaNav('csv', '', 'Copia lo storico in CSV', 'Da incollare in un foglio di calcolo', '', true) +
        rigaNav('json', '', 'Scarica un backup', 'Un file con tutte le sedute', '', true) +
        rigaNav('importa', '', 'Ripristina da un backup', 'Sostituisce lo storico attuale', '', true) + '</ul>';
    }
    h += '<p class="aiuto">Tutto resta salvato solo su questo telefono. Scarica un backup ogni tanto.</p>';
    main.innerHTML = h;
  }

  // ---------- Vista: editor della scheda ----------
  function renderModifica() {
    const s = schede.find((x) => x.id === modificaId);
    if (!s) { vista = 'impostazioni'; render(); return; }
    const n = s.esercizi.length;
    let h = '<div class="campo"><label for="ed-nome">Nome della scheda</label>' +
      '<input id="ed-nome" type="text" maxlength="24" autocomplete="off" value="' + esc(s.nome) + '"></div>' +
      '<div class="campo"><label for="ed-nota">Nota<small>facoltativa</small></label>' +
      '<input id="ed-nota" type="text" autocomplete="off" value="' + esc(s.nota || '') + '"></div>' +
      '<h2 class="sez">Esercizi</h2>';
    if (!n) h += '<p class="stato">Nessun esercizio. Aggiungi il primo.</p>';
    else {
      h += '<ol class="ed-lista">' + s.esercizi.map((ex, i) => {
        const ap = i === edAperto;
        let c = '<li class="ed-es' + (ap ? ' aperto' : '') + '" data-i="' + i + '">' +
          '<h3 class="es-h"><button type="button" class="ed-testa" data-az="ed-apri" aria-expanded="' + ap + '">' +
          '<span class="ed-n" aria-hidden="true">' + (i + 1) + '</span><span class="es-nome">' + esc(ex.nome) + '</span>' +
          (ap ? ICONA.su : ICONA.giu) + '<span class="es-sotto">' + esc(schema(ex)) + '</span></button></h3>';
        if (!ap) return c + '</li>';
        c += '<div class="campo"><label for="ex-nome">Nome</label><input id="ex-nome" data-campo="nome" type="text" autocomplete="off" value="' + esc(ex.nome) + '"></div>' +
          '<div class="due"><div class="campo"><label for="ex-serie">Serie</label><input id="ex-serie" data-campo="serie" type="text" inputmode="numeric" maxlength="2" autocomplete="off" value="' + esc(ex.serie) + '"></div>' +
          '<div class="campo"><label for="ex-reps">Reps</label><input id="ex-reps" data-campo="reps" type="text" autocomplete="off" aria-describedby="ex-reps-aiuto" value="' + esc(ex.reps ?? '') + '">' +
          '<p class="aiuto" id="ex-reps-aiuto">Per esempio 8-12, oppure 30" per i secondi.</p></div></div>' +
          '<div class="campo"><label for="ex-nota">Nota<small>facoltativa</small></label><input id="ex-nota" data-campo="nota" type="text" autocomplete="off" value="' + esc(ex.nota ?? '') + '"></div>';
        if (confermaEd === i) {
          c += htmlConferma('Togliere ' + ex.nome + ' dalla scheda? Lo storico resta.', 'ed-togli-annulla', 'ed-togli-ok', 'Togli');
        } else {
          c += '<div class="es-azioni">' +
            '<button type="button" class="btn btn-tonale" data-az="ed-su"' + (i === 0 ? ' disabled' : '') + '>' + ICONA.su + 'Sposta su</button>' +
            '<button type="button" class="btn btn-tonale" data-az="ed-giu"' + (i === n - 1 ? ' disabled' : '') + '>' + ICONA.giu + 'Sposta giù</button></div>' +
            '<div class="es-piede"><button type="button" class="btn-testo" data-az="ed-aggiungi" data-idx="' + i + '">Aggiungi esercizio dopo</button>' +
            '<button type="button" class="btn-testo rosso" data-az="ed-togli">Togli dalla scheda</button></div>';
        }
        return c + '</li>';
      }).join('') + '</ol>';
    }
    h += '<button type="button" class="btn btn-tonale piena" data-az="ed-aggiungi" data-idx="' + (n - 1) + '">' + ICONA.piu + 'Aggiungi esercizio</button>';
    if (confermaElimina) {
      h += htmlConferma('Eliminare la scheda ' + s.nome + ' con ' + plurale(n, 'esercizio', 'esercizi') + '? Le sedute già salvate restano nello storico.', 'ed-elimina-annulla', 'ed-elimina-ok', 'Elimina');
    } else if (schede.length > 1) {
      h += '<p class="elimina"><button type="button" class="btn-testo rosso" data-az="ed-elimina">Elimina questa scheda</button></p>';
    }
    main.innerHTML = h;
  }

  // ---------- Vista: storico ----------
  function renderStorico() {
    const tutteLe = ordinate();
    const nomi = new Map();
    tutteLe.forEach((x) => { if (!nomi.has(x.scheda)) nomi.set(x.scheda, x.nomeScheda || x.scheda); });
    if (filtroStorico && !nomi.has(filtroStorico)) filtroStorico = '';
    const lista = tutteLe.filter((x) => !filtroStorico || x.scheda === filtroStorico);
    let h = '';
    if (!tutteLe.length) {
      main.innerHTML = '<div class="stato-vuoto"><p>Ancora nessuna seduta. Si salva da sola quando segni la prima serie.</p>' +
        '<button type="button" class="btn btn-tonale piena" data-az="vai-allenamento">Vai all\'allenamento</button></div>';
      return;
    }
    if (nomi.size > 1) {
      h += '<div class="chips" role="group" aria-label="Filtra per scheda">' +
        [['', 'Tutte'], ...nomi].map(([id, nome]) =>
          '<button type="button" class="chip" data-az="filtro" data-id="' + esc(id) + '" aria-pressed="' + (id === filtroStorico) + '">' + esc(nome) + '</button>').join('') + '</div>';
    }
    let mese = '';
    lista.forEach((x) => {
      const d = new Date(x.data);
      const m = maiuscola(d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }));
      if (m !== mese) { h += (mese ? '</ul>' : '') + '<h2 class="sez">' + esc(m) + '</h2><ul class="lista">'; mese = m; }
      const n = numeriSeduta(x);
      h += rigaNav('apri-seduta', x.id, x.nomeScheda || x.scheda,
        [plurale(n.es, 'esercizio', 'esercizi'), plurale(n.serie, 'serie', 'serie'), n.min > 0 ? n.min + ' min' : ''].filter(Boolean).join(' · '),
        '<span class="giorno"><b>' + d.getDate() + '</b><small>' + esc(d.toLocaleDateString('it-IT', { weekday: 'short' })) + '</small></span>');
    });
    main.innerHTML = h + '</ul>';
  }

  function renderDettaglio() {
    const x = sessioni.find((y) => y.id === dettaglioId);
    if (!x) { vista = 'storico'; render(); return; }
    $('#titolo').textContent = x.nomeScheda || x.scheda;
    const n = numeriSeduta(x);
    let h = '<p class="det-data">' + esc(fmtDataLunga(x.data)) + ', ore ' + esc(oraBreve(x.data)) + '</p>' +
      '<div class="numeri"><p><b>' + n.serie + '</b><span>serie</span></p>' +
      '<p><b>' + (n.min > 0 ? n.min : '-') + '</b><span>minuti</span></p>' +
      '<p><b>' + (n.volume > 0 ? migliaia(n.volume) : '-') + '</b><span>kg sollevati</span></p></div>';
    (x.esercizi || []).forEach((e) => {
      const tempo = aTempo(modelloScheda(e.nome) || {});
      h += '<section class="det-es"><h2>' + esc(e.nome) + '</h2><ol class="det-serie">' +
        (e.serie || []).map((r) => '<li><span class="tacca-n piena"><span class="sr-only">Serie </span>' + esc(r.n) + '</span>' + htmlValore(r, tempo) + '</li>').join('') +
        '</ol></section>';
    });
    h += confermaSeduta
      ? htmlConferma('Eliminare questa seduta dallo storico? Non si può annullare.', 'seduta-annulla', 'seduta-ok', 'Elimina')
      : '<p class="elimina"><button type="button" class="btn-testo rosso" data-az="seduta-elimina">Elimina questa seduta</button></p>';
    main.innerHTML = h;
  }
  function eliminaSeduta(id) {
    const i = sessioni.findIndex((x) => x.id === id);
    if (i < 0) return;
    sessioni.splice(i, 1);
    // Se era la seduta di oggi, si azzera anche la bozza: altrimenti rinascerebbe alla prossima serie.
    Object.keys(bozza).forEach((k) => { if (bozza[k] && bozza[k].sedutaId === id) delete bozza[k]; });
    scrivi(K.sessioni, sessioni);
    scrivi(K.bozza, bozza);
    vai('storico');
    toast('Seduta eliminata');
  }

  // ---------- Recupero ----------
  const elDock = $('#timer');
  const elTempo = $('#timer-tempo');
  const elBarra = $('#timer-barra');
  const elPillola = $('#timer-pillola');
  let tick = null;

  // Schermo acceso mentre il recupero corre (se il telefono lo permette): altrimenti il conto alla rovescia si ferma.
  let wake = null;
  async function tieniAcceso(si) {
    try {
      if (si && !wake && 'wakeLock' in navigator && !document.hidden) {
        wake = await navigator.wakeLock.request('screen');
        wake.addEventListener('release', () => { wake = null; });
      } else if (!si && wake) { const w = wake; wake = null; await w.release(); }
    } catch (e) { wake = null; /* non supportato o negato */ }
  }
  // Suono di fine recupero: il contesto audio si sblocca col primo tocco su "Serie fatta".
  let audio = null;
  function sblocca() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC || !suono) return;
      if (!audio) audio = new AC();
      if (audio.state === 'suspended') audio.resume();
    } catch (e) { audio = null; }
  }
  function suona() {
    try {
      if (!audio || !suono) return;
      [0, 0.28, 0.56].forEach((t, i) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = 'sine'; o.frequency.value = i === 2 ? 1175 : 880;
        const t0 = audio.currentTime + t;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
        o.connect(g); g.connect(audio.destination);
        o.start(t0); o.stop(t0 + 0.25);
      });
    } catch (e) { /* audio non disponibile */ }
  }

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
  function impostaDurata(d) {
    durata = d;
    scrivi(K.durata, durata);
    if (timer) {
      timer.fine = timer.inizio + durata * 1000;
      timer.avvisato = timer.fine <= Date.now() ? timer.avvisato : false;
      scrivi(K.timer, timer);
    }
    mostraTimer();
  }
  function mostraTimer() {
    const btn = $('#timer-durata');
    btn.querySelector('b').textContent = mmss(durata);
    btn.setAttribute('aria-label', 'Durata del recupero ' + mmss(durata) + ', tocca per cambiarla');
    document.body.classList.toggle('con-dock', !!timer && !ridotto);
    document.body.classList.toggle('con-pillola', !!timer && ridotto);
    if (!timer) {
      elDock.hidden = true;
      elPillola.hidden = true;
      clearInterval(tick); tick = null;
      tieniAcceso(false);
      return;
    }
    elDock.hidden = ridotto;
    elPillola.hidden = !ridotto;
    // La barra si svuota in modo fluido con una animazione CSS sincronizzata sul tempo reale.
    const tot = Math.max(1, (timer.fine - timer.inizio) / 1000);
    const trascorso = Math.max(0, (Date.now() - timer.inizio) / 1000);
    elBarra.style.animation = 'none';
    void elBarra.offsetWidth;
    elBarra.style.animation = 'scarica ' + tot + 's linear ' + (-trascorso) + 's forwards';
    aggiornaTimer();
    if (!tick && timer.fine > Date.now()) tick = setInterval(aggiornaTimer, 250);
    tieniAcceso(timer.fine > Date.now());
  }
  function aggiornaTimer() {
    if (!timer) return;
    const resto = Math.ceil((timer.fine - Date.now()) / 1000);
    const finito = resto <= 0;
    elDock.classList.toggle('finito', finito);
    elPillola.classList.toggle('finito', finito);
    const testo = finito ? 'Si riparte' : mmss(resto);
    if (elTempo.textContent !== testo) {
      elTempo.textContent = testo;
      $('#timer-pillola-tempo').textContent = testo;
      $('#timer-eti').textContent = finito ? 'Recupero finito' : 'Recupero';
      $('#timer-salta').textContent = finito ? 'Chiudi' : 'Salta';
    }
    if (!finito) {
      if (riduciMovimento.matches) elBarra.style.transform = 'scaleX(' + Math.max(0, Math.min(1, (timer.fine - Date.now()) / Math.max(1, timer.fine - timer.inizio))) + ')';
      return;
    }
    clearInterval(tick); tick = null;
    tieniAcceso(false);
    if (!timer.avvisato) {
      timer.avvisato = true;
      scrivi(K.timer, timer);
      try { if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]); } catch (e) { /* non supportata */ }
      suona();
      $('#timer-annuncio').textContent = 'Recupero finito, si riparte.';
      setTimeout(() => { $('#timer-annuncio').textContent = ''; }, 3000);
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
    if (!sessioni.length) { toast('Lo storico è vuoto'); return; }
    const testo = generaCsv();
    try {
      await navigator.clipboard.writeText(testo);
      toast('CSV copiato negli appunti');
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
      toast(ok ? 'CSV copiato negli appunti' : 'Copia non riuscita');
    }
  }
  async function scaricaJson() {
    const nome = 'schede-palestra-' + oggi() + '.json';
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
    toast('Backup scaricato');
  }
  function sedutaValida(x) {
    return x && typeof x.id === 'string' && typeof x.data === 'string' && !isNaN(Date.parse(x.data)) &&
      typeof x.scheda === 'string' && Array.isArray(x.esercizi) &&
      x.esercizi.every((e) => e && typeof e.nome === 'string' && Array.isArray(e.serie));
  }
  // Legge il file e chiede conferma dentro la pagina: lo storico attuale viene sostituito solo dopo "Sostituisci".
  async function leggiBackup(file) {
    let d;
    try { d = JSON.parse(await file.text()); } catch (e) { toast('Il file non è un backup leggibile'); return; }
    const lista = Array.isArray(d) ? d : d && d.sessioni;
    if (!Array.isArray(lista) || !lista.every(sedutaValida)) { toast('Il file non è un backup di questa app'); return; }
    importAttesa = { lista, durata: d && [90, 120, 180].includes(d.durataRecupero) ? d.durataRecupero : null };
    renderImpostazioni();
    const sez = $('#sez-dati');
    if (sez) sez.scrollIntoView({ block: 'start' });
  }
  function confermaImporta() {
    if (!importAttesa) return;
    const vecchie = sessioni;
    sessioni = importAttesa.lista;
    if (!scrivi(K.sessioni, sessioni)) { sessioni = vecchie; return; }
    if (importAttesa.durata) impostaDurata(importAttesa.durata);
    importAttesa = null;
    mantieniScroll(renderImpostazioni);
    toast('Storico ripristinato');
  }

  // ---------- Eventi ----------
  const AZIONI = {
    // Allenamento
    'apri': (t, key) => apriEsercizio(key),
    'serie': (t) => { serieAttiva = Number(t.dataset.j); confermaTogli = null; ridisegna(); const i = main.querySelector('.serie-attiva .btn'); if (i) i.focus({ preventScroll: true }); },
    'passo': (t, key) => passo(key, Number(t.closest('.serie-attiva').dataset.j), t.dataset.campo, Number(t.dataset.d)),
    'fatta': (t, key) => segna(key, Number(t.closest('.serie-attiva').dataset.j), true),
    'non-fatta': (t, key) => segna(key, Number(t.closest('.serie-attiva').dataset.j), false),
    'applica': (t, key) => applicaConsiglio(key),
    'piu-serie': (t, key) => cambiaSerie(key, 1),
    'meno-serie': (t, key) => cambiaSerie(key, -1),
    'togli-ex': (t, key) => { confermaTogli = key; ridisegna(); const a = main.querySelector('[data-az="togli-annulla"]'); if (a) a.focus({ preventScroll: true }); },
    'togli-annulla': () => { confermaTogli = null; ridisegna(); },
    'togli-ok': (t, key) => togliEsercizio(key),
    'aggiungi-ex': (t) => apriAggiungi(t.dataset.dopo),
    'riprova': () => location.reload(),
    'vai-allenamento': () => vai('scheda'),
    // Impostazioni
    'apri-scheda': (t) => { modificaId = t.dataset.id; edAperto = -1; vai('modifica'); },
    'nuova-scheda': () => {
      if (schede.length >= MAX_SCHEDE) return;
      const s = nuovaScheda();
      schede.push(s); salvaSchede();
      modificaId = s.id; edAperto = -1; vai('modifica');
    },
    'reset': () => { confermaReset = true; mantieniScroll(renderImpostazioni); },
    'reset-annulla': () => { confermaReset = false; mantieniScroll(renderImpostazioni); },
    'reset-ok': () => {
      schede = copia(schedeBase); confermaReset = false; salvaSchede();
      Object.keys(aperto).forEach((k) => delete aperto[k]);
      if (!tutte().some((x) => x.id === tab)) { tab = schede[0].id; scrivi(K.tab, tab); }
      mantieniScroll(renderImpostazioni);
      toast('Schede originali ripristinate');
    },
    'apri-storico': () => vai('storico'),
    'durata': (t) => { impostaDurata(Number(t.dataset.v)); mantieniScroll(renderImpostazioni); },
    'tema': (t) => { tema = t.dataset.v; scrivi(K.tema, tema); applicaTema(); mantieniScroll(renderImpostazioni); },
    'csv': () => copiaCsv(),
    'json': () => scaricaJson(),
    'importa': () => $('#file-import').click(),
    'importa-annulla': () => { importAttesa = null; mantieniScroll(renderImpostazioni); },
    'importa-ok': () => confermaImporta(),
    // Editor della scheda
    'ed-apri': (t) => { const i = Number(t.closest('.ed-es').dataset.i); edAperto = edAperto === i ? -1 : i; confermaEd = -1; mantieniScroll(renderModifica); },
    'ed-su': (t) => spostaEsercizio(Number(t.closest('.ed-es').dataset.i), -1),
    'ed-giu': (t) => spostaEsercizio(Number(t.closest('.ed-es').dataset.i), 1),
    'ed-togli': (t) => { confermaEd = Number(t.closest('.ed-es').dataset.i); mantieniScroll(renderModifica); },
    'ed-togli-annulla': () => { confermaEd = -1; mantieniScroll(renderModifica); },
    'ed-togli-ok': (t) => {
      const s = schede.find((x) => x.id === modificaId);
      const i = Number(t.closest('.ed-es').dataset.i);
      confermaEd = -1; edAperto = -1;
      if (s && s.esercizi[i]) modificaScheda(s, () => s.esercizi.splice(i, 1));
      mantieniScroll(renderModifica);
    },
    'ed-aggiungi': (t) => apriAggiungi(Number(t.dataset.idx), 'scheda'),
    'ed-elimina': () => { confermaElimina = true; renderModifica(); const a = main.querySelector('[data-az="ed-elimina-annulla"]'); if (a) a.scrollIntoView({ block: 'center' }); },
    'ed-elimina-annulla': () => { confermaElimina = false; mantieniScroll(renderModifica); },
    'ed-elimina-ok': () => {
      if (schede.length <= 1) return;
      const nome = (schede.find((x) => x.id === modificaId) || {}).nome;
      schede = schede.filter((x) => x.id !== modificaId);
      salvaSchede();
      if (!tutte().some((x) => x.id === tab)) { tab = schede[0].id; scrivi(K.tab, tab); }
      vai('impostazioni');
      toast('Scheda ' + nome + ' eliminata');
    },
    // Storico
    'filtro': (t) => { filtroStorico = t.dataset.id; renderStorico(); window.scrollTo(0, 0); },
    'apri-seduta': (t) => { dettaglioId = t.dataset.id; vai('dettaglio'); },
    'seduta-elimina': () => { confermaSeduta = true; mantieniScroll(renderDettaglio); },
    'seduta-annulla': () => { confermaSeduta = false; mantieniScroll(renderDettaglio); },
    'seduta-ok': () => eliminaSeduta(dettaglioId)
  };
  function spostaEsercizio(i, d) {
    const s = schede.find((x) => x.id === modificaId);
    const j = i + d;
    if (!s || j < 0 || j >= s.esercizi.length) return;
    modificaScheda(s, () => { const [x] = s.esercizi.splice(i, 1); s.esercizi.splice(j, 0, x); });
    edAperto = j;
    mantieniScroll(renderModifica);
    const b = main.querySelector('.ed-es.aperto [data-az="' + (d < 0 ? 'ed-su' : 'ed-giu') + '"]:not(:disabled)') || main.querySelector('.ed-es.aperto .ed-testa');
    if (b) b.focus({ preventScroll: true });
  }

  main.addEventListener('click', (e) => {
    const t = e.target.closest('[data-az]');
    if (!t || t.disabled) return;
    const fn = AZIONI[t.dataset.az];
    if (!fn) return;
    const es = t.closest('.es');
    fn(t, es ? es.dataset.key : null);
  });
  // Scrivere a mano nei campi della serie in modifica.
  main.addEventListener('input', (e) => {
    const t = e.target;
    const riga = t.closest('.serie-attiva');
    if (!riga || !t.matches('input')) return;
    const s = corrente();
    const key = t.closest('.es').dataset.key;
    const v = voce(s, key);
    if (!v) return;
    const r = righeDi(s, key, v.ex, true)[Number(riga.dataset.j)];
    if (!r) return;
    r[t.name] = t.value;
    autosalva(s);
  });
  main.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input[type="text"]')) e.target.blur();
  });
  main.addEventListener('focusin', (e) => {
    // Seleziona il valore per sovrascriverlo, ma solo se il fuoco e' ancora li' (select() altrimenti se lo riprende).
    const campo = e.target;
    if (campo.matches('.passo input')) setTimeout(() => { try { if (document.activeElement === campo) campo.select(); } catch (x) { /* non selezionabile */ } }, 0);
  });
  main.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'imp-suono') { suono = t.checked; scrivi(K.suono, suono); return; }
    if (vista !== 'modifica') return;
    const s = schede.find((x) => x.id === modificaId);
    if (!s) return;
    if (t.id === 'ed-nome') {
      const nome = t.value.trim();
      if (!nome) { t.value = s.nome; return; }
      s.nome = nome; salvaSchede();
    } else if (t.id === 'ed-nota') { s.nota = t.value.trim(); salvaSchede(); }
    else if (t.dataset.campo) {
      const ex = s.esercizi[Number(t.closest('.ed-es').dataset.i)];
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
        if (v > 0) { ex.serie = Math.min(12, v); t.value = ex.serie; modificaScheda(s, () => {}); } else t.value = ex.serie;
      } else { ex[campo] = t.value.trim(); salvaSchede(); }
      // Il titolo della riga segue i campi senza ridisegnare (il fuoco resta dov'e').
      const testa = t.closest('.ed-es').querySelector('.ed-testa');
      testa.querySelector('.es-nome').textContent = ex.nome;
      testa.querySelector('.es-sotto').textContent = schema(ex);
    }
  });
  $('#file-import').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) leggiBackup(f);
    e.target.value = '';
  });

  $('#schede-nav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b || b.dataset.tab === tab) return;
    tab = b.dataset.tab;
    scrivi(K.tab, tab);
    serieAttiva = null;
    confermaTogli = null;
    render();
    window.scrollTo(0, 0);
  });
  $('#schede-nav').addEventListener('scroll', aggiornaFade, { passive: true });
  window.addEventListener('resize', aggiornaFade);
  $('#btn-impostazioni').addEventListener('click', () => vai('impostazioni'));
  $('#btn-indietro').addEventListener('click', indietro);
  // Swipe indietro di iOS o tasto indietro: si sale di un livello invece di uscire dall'app.
  window.addEventListener('popstate', (e) => {
    if (ignoraPop) { ignoraPop = false; return; }
    const d = e.state && typeof e.state.d === 'number' ? e.state.d : 0;
    profondita = d;
    while ((PROFONDITA[vista] ?? 0) > d) vista = GENITORE[vista] || 'scheda';
    azzeraConferme();
    render();
    window.scrollTo(0, 0);
  });

  $('#timer-durata').addEventListener('click', () => impostaDurata(durata === 90 ? 120 : durata === 120 ? 180 : 90));
  $('#timer-riduci').addEventListener('click', () => { ridotto = true; scrivi(K.ridotto, true); mostraTimer(); elPillola.focus({ preventScroll: true }); });
  $('#timer-salta').addEventListener('click', fermaTimer);
  elPillola.addEventListener('click', () => {
    if (elPillola.classList.contains('finito')) { fermaTimer(); return; }
    ridotto = false; scrivi(K.ridotto, false); mostraTimer();
    $('#timer-riduci').focus({ preventScroll: true });
  });

  $('#dlg-nome').addEventListener('input', () => { $('#dlg-errore').hidden = true; renderRisultati(); });
  $('#dlg-gruppi').addEventListener('click', (e) => {
    const b = e.target.closest('[data-g]');
    if (!b) return;
    dlgGruppo = b.dataset.g;
    renderGruppi();
    renderRisultati();
    $('#dlg-risultati').scrollTop = 0;
  });
  $('#dlg-risultati').addEventListener('click', (e) => {
    const b = e.target.closest('[data-nome]');
    if (!b) return;
    $('#dlg-nome').value = b.dataset.nome;
    $('#dlg-errore').hidden = true;
    renderRisultati();
    // La tastiera si chiude, cosi' serie, reps e "Aggiungi" tornano visibili.
    $('#dlg-form').querySelector('button[type="submit"]').focus();
  });
  $('#dlg-form').addEventListener('submit', (e) => { e.preventDefault(); confermaAggiungi(); });
  $('#dlg-annulla').addEventListener('click', chiudiAggiungi);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) chiudiAggiungi(); });

  document.addEventListener('visibilitychange', () => { if (!document.hidden && timer) mostraTimer(); });
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    if (mq.addEventListener) mq.addEventListener('change', () => { if (tema === 'auto') applicaTema(); });
  }

  // ---------- Avvio ----------
  applicaTema();
  async function avvio() {
    try {
      const d = await caricaSchede();
      schedeBase = d.schede;
      schede = copia(d.schede);
      const u = leggi(K.schedeUtente, null);
      try { validaSchede({ schede: u }); if (u.length <= MAX_SCHEDE) schede = u; } catch (e) { /* si usano quelle originali */ }
      await caricaCatalogo();
    } catch (e) {
      main.innerHTML = '<div class="errore" role="alert"><p>Non riesco a caricare le schede (' + esc(e.message) +
        '). Apri l\'app una volta con internet attivo.</p><button type="button" class="btn btn-tonale" data-az="riprova">Riprova</button></div>';
      $('#btn-impostazioni').hidden = true;
      return;
    }
    if (!tutte().some((s) => s.id === tab)) tab = schede[0].id;
    try { history.replaceState({ d: 0 }, ''); } catch (e) { /* cronologia non disponibile */ }
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
