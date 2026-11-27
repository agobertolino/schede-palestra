# Schede palestra

PWA vanilla JS (nessun build) per segnare gli allenamenti. File: `index.html`, `style.css`, `app.js` (un'unica IIFE), `sw.js`, `schede.json`, `catalogo.json`, `fonts/` (Barlow e Barlow Condensed, licenza OFL).

## Convenzioni
- Testi dell'interfaccia e nomi di funzioni/variabili in italiano; nomi degli esercizi in inglese (i vecchi nomi restano negli `alias`).
- Dati in localStorage con chiavi `sp.*` (vedi `K` in `app.js`). Non cambiare la struttura dei dati senza migrazione.
- Ad ogni rilascio incrementare `CACHE` in `sw.js` (service worker cache-first). Ogni file nuovo va aggiunto a `FILES`, altrimenti offline manca.
- In `app.js` i pulsanti dentro `main` portano `data-az="nome"` e l'azione sta nella tabella `AZIONI`.
- `main` e' il sito pubblicato: si lavora su un branch e si fa merge su `main` solo quando l'utente chiede di pubblicare.

## UI
La direzione visiva e' in `DESIGN.md`. Per lavori su interfaccia o testi usa le skill antislop in `.claude/skills/` (modalita' "during").
