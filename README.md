# Sumo Volley

A mobile browser game: two sumo wrestlers play volleyball with their bodies.
Plain HTML5 Canvas + JavaScript, no dependencies and no build step.

## How to play

- **1 player**: against a bot.
- **2 players**: on one phone; each player controls their own half of the screen.
- **Online**: with friends on different phones. Available only when the game is opened
  as a page on claude.ai (it uses the page's `room` capability). One player creates
  a game and gets a 4-letter code; the other picks the game from the list or enters
  the code. Anyone else who joins with the same code watches. The creator's phone
  runs the physics; the opponent's phone sends only its controls.
- The phone is held in landscape.

Controls:
- Finger on your half of the screen: slide it left or right to move.
- Swipe up or tap: jump.
- Keyboard: `A` / `D` / `W` (red) and `←` / `→` / `↑` (blue).

Rules: send the ball over the net to the opponent's side. If the ball touches the ground, the opponent scores. A team may touch the ball at most 3 times on its side. The match goes to 11 points, and you must win by 2.

## Running

Open `index.html` in a browser, or serve the folder with any static server:

```sh
python3 -m http.server 8000
```

To play on a phone, enable GitHub Pages
(Settings → Pages → Deploy from branch → `main` / root). The game will then be at
`https://<user>.github.io/dreamgroom/`. In the browser you can use
"Add to Home Screen" to launch it fullscreen like an app.

## Files

- `index.html`: page and menus
- `style.css`: menu and overlay styles
- `game.js`: physics, bot, controls and rendering
- `manifest.webmanifest`, `icon.svg`: for installing to the home screen
