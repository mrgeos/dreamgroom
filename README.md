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
  - On a regular website (GitHub Pages) the game uses two paths at once:
    a direct WebRTC connection (PeerJS, `0.peerjs.com` is used only to find each
    other) and a relay through free public MQTT brokers (`broker.hivemq.com`,
    `broker.emqx.io`). Every message carries a sequence number and goes over all
    live paths; the receiver keeps the newest, so the faster path wins by itself.
    When mobile networks block the direct connection, the relay keeps the game going.
  - Opened as a page on claude.ai, it uses the page's `room` capability instead
    and also lists open games.
- The phone is held in landscape.

Controls on a phone:
- Bottom of the screen: movement. Hold the left half to go left, the right half to go right.
- Top of the screen: jump. You can keep holding movement and tap jump with another finger.
- In 2-player mode on one phone, each player has their own half of the screen with the same zones.
- Keyboard: `A` / `D` / `W` (red) and `←` / `→` / `↑` (blue).

Rules: send the ball over the net to the opponent's side. If the ball touches the ground, the opponent scores. A team may touch the ball at most 3 times on its side. The match goes to 11 points, and you must win by 2.

## Online error codes

When a connection fails, the game shows a code, and the online screen has a
"Журнал подключения" (connection log) button with a step-by-step log that can be copied.

| Code | Meaning |
| --- | --- |
| `NET-404` | No game with this code (wrong code, or the creator closed the game). |
| `NET-409` | Could not reserve a game code on the server. |
| `NET-SRV` | None of the game servers answer (PeerJS and both brokers): no internet, or the network/VPN blocks them. |
| `NET-SRV-TIMEOUT` | The servers did not answer within 15 seconds. |
| `NET-P2P` | The phones could not connect directly. Only shown together with `NET-RELAY`, because otherwise the relay is used. |
| `NET-RELAY` | The relay brokers (HiveMQ, EMQX) are unreachable too. |
| `NET-RTC` | WebRTC error in the browser (e.g. a messenger's built-in browser). |
| `NET-BROWSER` | The browser does not support WebRTC. |
| `NET-LOST` | The connection to the game creator was lost. |
| `NET-UNKNOWN` | Anything else; the log shows the raw error type. |

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
