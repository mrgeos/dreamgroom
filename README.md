# Sumo Volley

A mobile browser game: two sumo wrestlers play volleyball with their bodies.
Plain HTML5 Canvas + JavaScript, no dependencies and no build step.

## How to play

- **1 player**: against a bot.
- **2 players**: on one phone; each player controls their own half of the screen.
- **Online**: with friends on different phones. One player creates a game and gets a
  4-letter code plus an invite link; the friend opens the link or enters the code.
  Anyone else who joins with the same code watches. The creator's phone runs the
  physics; the opponent's phone sends only its controls.
  - On a regular website (GitHub Pages) phones connect directly over WebRTC.
    PeerJS's free public server (`0.peerjs.com`) is used only to find each other.
    No account needed. On some mobile networks a direct connection may fail;
    Wi-Fi usually works.
  - Opened as a page on claude.ai, it uses the page's `room` capability instead
    and also lists open games.
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

The site is published with GitHub Pages from the `gh-pages` branch:
<https://mrgeos.github.io/dreamgroom/>. To update it, push the new files to that branch.
In the browser you can use "Add to Home Screen" to launch it fullscreen like an app.

## Files

- `index.html`: page and menus
- `style.css`: menu and overlay styles
- `game.js`: physics, bot, controls and rendering
- `manifest.webmanifest`, `icon.svg`: for installing to the home screen
