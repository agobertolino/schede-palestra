# DESIGN

Reading this as: app personale per segnare l'allenamento in palestra, usata con una mano sola e il telefono sudato, in stile fitness tracker atletico e scuro, dial ENERGY 2 / RHYTHM 1 / MOTION 1.

## Direzione
- Tema scuro di default (si usa in palestra, spesso con luce bassa, e fa risaltare i numeri). In Impostazioni si sceglie Scuro, Chiaro o Automatico. Entrambi i temi devono reggere senza rotture (R-34).
- I numeri (kg, reps, tempo) sono il contenuto: grandi, tabulari, peso 700. Titoli e testi di contorno restano piccoli e calmi.
- Un solo punto focale per schermata: durante l'allenamento e' la prossima serie da fare.

## Colori (token in `:root`)
- Base: nero caldo `#0b0b0c`, superfici `#161618` e `#1f1f22`, bordi sottili `#2c2c30`. Testo `#f4f4f5`, secondario `#a1a1aa`.
- Accento unico: arancio `#ff7a1a`, solo per l'azione primaria, la tab attiva e il progresso del timer. Mai su testo piccolo in tema chiaro (li' si usa la variante scura `#b8480a`).
- Verde `--ok` solo per "serie fatta" e "si riparte". Rosso `--err` solo per azioni distruttive, con variante per ciascun tema.
- Niente gradienti, niente glow, niente blur decorativo. Il blur resta solo sull'intestazione fissa.

## Forma
- Raggi: 10 (campi), 14 (card e bottoni), 999 solo per il timer ridotto. Nessun altro valore.
- Spazi su scala 4: 4, 8, 12, 16, 24.
- Ombre: solo il timer fluttuante, perche' e' l'unico elemento che sta sopra il contenuto.
- Bersagli di tocco almeno 44x44 px, con 8 px tra uno e l'altro.

## Tipografia
Font di sistema (SF su iPhone). Scala: 12 etichette, 14 secondario, 16 corpo, 18 titolo esercizio, 22 titolo pagina, 28 numeri delle serie, 40 tempo del timer.

## Movimento
Solo funzionale: pressione dei bottoni (scala 0.97, 90 ms), barra del recupero che si svuota, spunta della serie. Tutto si ferma con `prefers-reduced-motion`.

## Testi
Italiano, frasi brevi, verbi all'infinito sui bottoni (Aggiungi, Togli, Applica). Nessun trattino lungo, nessuna emoji decorativa, nessuna frase motivazionale.

## Motivo identitario
Il numero di serie dentro un quadrato arrotondato: la serie e' l'unita' dell'app, e la spunta riempie quel quadrato di verde.
