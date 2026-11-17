# Little Bean ☕ — Voice/Text Coffee Ordering Avatar

A runnable, responsive browser prototype for **SOFE 4850U UX Design, Fall 2026 — Group 12** (Connor Boivin, Gitae Yang, Elvis Sikapi). Built with plain HTML, CSS and JavaScript and the browser's built-in Web Speech API. There is no account, backend, paid API or real payment. Target platform: desktop web (Chrome), with a responsive layout that also works on mobile.

## Start

**Voice input only works when the site is served from `localhost`.** If you double-click `index.html`, the page opens as a `file://` address and Chrome/Edge block speech recognition. Typing and tapping still work, and the page shows a reminder under the message box.

**Windows (easiest):** double-click `start-server.bat`. It runs `serve.py`, which picks a free port (8765 first, skipping any port another program is using) and opens the site, e.g. `http://localhost:8765`. Keep the black window open while you use the site.

**Any OS:**

```bash
python serve.py
```

Use **Chrome or Edge** and click **Allow** when asked for the microphone. If the page that opens is not Little Bean (for example a "Windows Communication Foundation service" page), another program owns that port. `serve.py` avoids this automatically; a plain `python -m http.server 8000` does not. Chrome and Edge send speech to their online speech service, so voice input needs an internet connection. Firefox does not support speech recognition, and Brave usually fails with a network error. Use Chrome or Edge for the demo.

## How the conversation works

1. Beanie asks for each drink's details: drink, size, temperature, milk, extras (any number), quantity.
2. When a drink is complete it goes into the cart, and Beanie asks **“Anything else?”** Users can add another drink or say “that's everything”.
3. Beanie then asks once for pickup time, first name and payment preference (pay at pickup or at the counter).
4. Beanie **reads the whole order back** and asks “Is that correct?”. Users can answer **yes** (by voice, typing or the chip) to place it, **no** to make a change, or say the correction directly. **Review my order** shows the same summary as a dialog.

Several drinks can be given in one sentence: “a large hot latte and two small iced mochas” fills in the latte, then moves on to the mochas.

## Test cases (proposal and course brief)

| Case | Try this | Expected |
|---|---|---|
| Normal completion | Tap through a drink, “That's everything”, pickup, name, payment, then say “yes” | Order code shown |
| Missing information | `A latte` | Keeps the drink and asks for the size |
| Several answers at once | `Two large iced oat milk lattes` | Fills drink, size, temperature, milk and quantity, then asks about extras |
| Several drinks at once | `a large hot latte and two small iced mochas` | Builds the latte, then “Now for your Mocha” |
| Multiple extras | `vanilla and an extra shot`, or toggle chips then **Add selected** | Both extras saved |
| Invalid answer | `large coconut milk latte` | Keeps “large latte”, explains coconut isn't available, shows milk chips |
| Change of mind | `Actually make it oat milk`, `make the latte almond milk`, `remove the mocha`, `take off the caramel` | Updates only that drink; no restart |
| Name mix-up | Say `latte` when asked for a name | Not accepted as a name, and the order is not changed |
| Voice recognition problem | Press the mic and speak | Words appear live, then **I HEARD** with **Retry**, **Edit text**, **Use this** |
| Final confirmation | Finish all answers | Beanie reads the order back and waits for yes/no |
| Keyboard only | Tab through controls; Enter sends | Everything reachable |
| User control | **Back**, **Change answer**, summary **Edit**/**Remove**, **Voice on/off**, **Start over** | Always visible |

## Files

- `index.html` — page structure and dialogs
- `styles.css` — styling and animations
- `app.js` — menu data, rule-based parser, conversation engine (`respond`), UI, Web Speech API
- `tests.js` — Node regression tests for the conversation engine: `node tests.js`
- `serve.py` — local server that finds a free port and opens the browser
- `start-server.bat` — Windows launcher that runs `serve.py`

## Known limitations

- The parser is rule-based, not an AI model. It understands the menu options and common phrasing, not arbitrary sentences.
- Speech recognition depends on the browser (Chrome/Edge), microphone permission, and an internet connection. Always be ready to demo the typing/tapping fallback.
- Text-to-speech is off by default; turn it on with **Voice off / Voice on**.
- Menu items, prices and pickup times are fictional demo values. Nothing is sent to a shop and no payment is taken. Data resets on reload.
- Usability testing with at least three participants is still required before the final report.
