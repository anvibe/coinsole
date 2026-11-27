# Adding games to Coinsole

Coinsole shows every game it finds in its **Games** folder: next to `Coinsole.app` for a copy you built, or
`~/Library/Application Support/Coinsole/Games` for an installed one.
Add a game by dropping it on the Coinsole window, choosing **Add game**, or copying it into that folder.

## What counts as a game

| In `Games/` | How it plays |
|---|---|
| A Mac app (`MyGame.app`) | Opens in its own window, placed on Coinsole's screen when the game supports it (see below) |
| A folder containing a `.app` | Same, using that app |
| An `.html` file, or a folder with `index.html` | Plays **inside** Coinsole's screen (web game) |
| A folder with `start.command`, `start.sh`, `run.sh`, `play.command` or a program file | Runs it from inside that folder |

## Cover and info (optional)

- **Cover:** `MyGame.png` (or `.jpg`) next to the game in `Games/`, or `cover.png` inside the game's folder.
- **Icon:** a square picture shown beside the title: `MyGame.icon.png` next to the game, or `icon.png` inside
  its folder. Without one, the cover is shown there.
- **Info card:** `MyGame.json` next to the game, or `info.json` inside its folder:

```json
{
  "publisher": "You",
  "year": "2026",
  "description": "One or two sentences about the game.",
  "controls": "Stick move · A jump · X fire",
  "aspect": "4:3"
}
```

When you add a `.app` from somewhere else, the files with the same name next to it (cover, icon and
info) come with it. In a folder that holds an app, files named after the app work too.

`keys` is optional: the keys the game uses, with a short word for what each does (up to 7 letters, or `""`).
While the game plays, Coinsole's on-screen keyboard shows them. Keys are named as in web pages:

```json
{ "keys": { "ArrowLeft": "", "ArrowRight": "", "Space": "JUMP", "KeyZ": "THROW" } }
```

`aspect` is the game's screen shape (`"4:3"`, `"16:9"`, `"8:7"`…). Coinsole's screens take that shape,
so the game fills them without black bars. Without it, Coinsole assumes 16:9.

## Web games

A web game is a normal web page. Coinsole loads it in a frame on its screen and helps it with:

| Message | Direction | What it does |
|---|---|---|
| `{ type: "arcade-pad", b: [...], a: [...] }` | Coinsole → game, via `postMessage` | The controller: `b` = 17 buttons (standard gamepad order: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 View, 9 Menu, 10 L3, 11 R3, 12–15 d-pad up/down/left/right, 16 Xbox), `a` = sticks `[leftX, leftY, rightX, rightY]`, −1…1, down is positive |
| `{ type: "arcade-exit" }` | game → Coinsole, `parent.postMessage(…, "*")` | Leave the game (send it on Esc) |
| `{ type: "arcade-bigscreen" }` | game → Coinsole | Big screen on/off (send it on F); the Xbox button does this too |

These messages are all a web game shares with Coinsole. It runs in a sandboxed frame with an origin of its
own, so it cannot reach Coinsole's page, open windows or dialogs, or read other games. In practice:

- A game made of several files needs its own folder with `index.html`; load them with relative paths. A
  single `.html` file cannot load files kept next to it, and symbolic links that lead out of a game's folder
  are not followed.
- What a game saves (`localStorage`) is private to it and tied to its file name in `Games/`: a renamed game
  starts fresh. Data saved by Coinsole 1.0, where all games shared one store, is not carried over, except the
  high scores of Meteor Run and Pixel Serpent.

Starting a web game costs one credit. The built-in games in [`games/`](../games) use a small shared
file, [`games/base.js`](../games/base.js) (a 320×240 pixel screen, keyboard and controller input,
sound, text and high scores), which is a good starting point for a new one.

## Mac games that know Coinsole (optional)

Any Mac app can be added. A game that wants to sit exactly on Coinsole's screen and use its
credits can read these environment variables, which Coinsole sets when it starts the game:

| Variable | Meaning |
|---|---|
| `ARCADE_SCREEN` | `x,y,w,h`: where Coinsole's screen is, in screen points from the top left of the main display. Open a borderless window there. |
| `ARCADE_PID` | Coinsole's process id, for the signals below |
| `ARCADE_CREDITS` | Credits already paid for this game (1 when started with Play) |
| `ARCADE_KIOSK` | `1` when Coinsole is in full-screen mode (hide the Dock and menu bar while in front) |

Signals and notices:

- **Coin:** send `SIGUSR1` to `ARCADE_PID` to ask for a coin. If the wallet has a credit, Coinsole takes it and answers with `SIGUSR1`.
- **Back to Coinsole:** send `SIGUSR2` to `ARCADE_PID` (the game waits, paused).
- **Big screen on/off:** post the distributed notification `coinsole.bigscreen`.
- Coinsole posts these distributed notifications to the game: `coinsole.game.hide` / `coinsole.game.show` (hide or show your window), `coinsole.game.move` (object: the new `x,y,w,h` of the screen), `coinsole.game.kiosk` (object `"1"` or `"0"`).

Games that don't do any of this still work: they simply open in their own window.
