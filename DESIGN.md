# DESIGN

Reading this as: strumento personale per segnare l'allenamento in sala pesi, usato con una mano tra una serie e l'altra, in stile "ghisa e gesso" (la lavagna di una palestra), dial ENERGY 2 / RHYTHM 2 / MOTION 1.

Ogni scelta ha il suo motivo accanto. Se una scelta cambia, cambia qui prima che nel codice.

## Struttura
- Niente barra in basso: la scheda si sceglie una volta per seduta, quindi sta in alto come riga di nomi. La zona del pollice resta al recupero e al pulsante della serie.
- Impostazioni in alto a destra. Dentro: Schede, Storico, Recupero, Aspetto, Dati. Sono cose che si toccano di rado.
- Lo swipe indietro di iOS risale di un livello, non esce dall'app.

## Allenamento
- Un esercizio aperto alla volta. Gli altri sono righe chiuse con nome, schema e tacche: si vede tutta la seduta senza scorrere tre schermate.
- Dentro l'esercizio aperto una sola serie e' in modifica: peso e reps con i pulsanti meno e piu' (passo del carico preso dall'attrezzo) e un unico pulsante giallo "Serie fatta". Scrivere a mano resta possibile.
- Dopo "Serie fatta" parte il recupero e si passa da soli alla serie dopo. Finito l'esercizio si apre il prossimo da fare.
- In cima il conto della seduta: serie fatte sul totale e una striscia di tacche, una per serie, raggruppate per esercizio.

## Recupero
- Fascia attaccata al bordo basso, larga quanto lo schermo: tempo grande, durata (1:30, 2:00, 3:00 a rotazione), Musica, nascondi, Salta.
- Nascosto diventa una pillola in basso a destra. A tempo scaduto la fascia si riempie di giallo e dice "Si riparte".

## Colori (token in `:root`)
- Base ghisa: nero caldo `#121110`, superfici `#1b1a18` e `#272522`. Testo gesso `#f3f0e9`, secondario `#aaa499`.
- Un solo accento: giallo segnale `#ffd21f`, sempre come riempimento con testo scuro `#16140d`. Vuol dire "fatto" oppure "il gesto che fa avanzare la seduta". Non si usa per decorare.
- Scelte neutre (tema, filtri, durata) si segnano invertendo gesso e ghisa, non col giallo.
- Rosso solo per togliere o eliminare. Niente verde: il fatto e' gia' il giallo.
- Tema chiaro su carta `#f2efe8`. Li' il giallo ha un bordo ambra `#8f7100` e le linee di accento diventano ambra `#6f5600`, perche' giallo su carta non si distingue.
- Niente gradienti, glow, blur.

## Tipografia
- Barlow Condensed (600, 700) per numeri, nomi degli esercizi, nomi delle schede e pulsante primario: cifre strette da tabellone che entrano tra due pulsanti da 52 px.
- Barlow (400, 500, 600) per il resto: stessa famiglia, leggibile da lontano.
- I file stanno in `fonts/` (licenza OFL), cosi' l'app funziona offline.
- Scala: 13 etichette, 15 secondario, 17 corpo, 22 nome esercizio, 24 schede, 34 valori della serie, 40 tempo, 52 conto della seduta.
- Maiuscolo solo su nomi delle schede, titoli di sezione e pulsante primario, senza spaziatura larga.

## Forma
- Raggi: 6 (tacche), 12 (pulsanti, campi, riquadri), 20 (foglio di ricerca), 999 solo la pillola del recupero.
- Spazi su scala 4: 4, 8, 12, 16, 24, 32.
- Ombra solo sulla pillola del recupero, l'unica cosa che galleggia.
- Bersagli di tocco almeno 44 px; pulsanti meno e piu' 52 px; primario 56 px.
- Icone disegnate a tratto squadrato, coerenti con il carattere.

## Pulsanti
- Primario: giallo pieno, uno per schermata.
- Tonale: superficie `--sup2`, per le azioni di contorno.
- Testo: senza fondo, per le azioni rare. In rosso se toglie qualcosa.
- Rosso pieno: solo dentro una conferma.

## Testi
Italiano, frasi brevi, infinito sui pulsanti (Aggiungi, Togli, Salta). Niente trattini lunghi, niente emoji, niente frasi motivazionali.

## Movimento
Solo funzionale: pressione dei pulsanti (scala 0.97, 90 ms), barra del recupero, riempimento della tacca. Tutto fermo con `prefers-reduced-motion`.

## Motivo identitario
La tacca: un quadratino per ogni serie. Vuota e' da fare, gialla e' fatta. Torna nel conto in cima, nelle righe degli esercizi, nel numero della serie e nello storico.
