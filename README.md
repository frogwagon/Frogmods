# Frogmods

My mods for Narrow One, made for my videos.

Tampermonkey userscripts for [Narrow One](https://narrow.one/), a browser archery
game. Each one adds a native-looking tab or button to the game's own menu -
nothing here sends packets the game itself wouldn't send.

**Not the Steam build.** Steam ships this game through Pelican Party's own
[steam-web-wrap](https://github.com/Pelican-Party/steam-web-wrap), an Electron
shell that loads narrow.one from a URL. It's the same web client with the same
DOM, so the logic would work there too - but it's an app window, not a browser,
so a userscript extension has no way to inject into it. Play at narrow.one in a
browser.

## The mods

### [1 Kill = 1 Stat Point](narrow-one-underdog.user.js)

Strips your stats at the start of a run - your gear stays equipped, only the
numbers behind it drop to zero - and lets you earn them back one kill at a
time, up to whatever your own gear set would have given you. Never more than
your own gear's ceiling, never someone else's gear, and melee keeps its form -
a poking stick still pokes, only the numbers move.

A run carries across matches and page reloads until you press Stop, so a long
session banks kills the whole way through.

- **F** opens or closes the manager (rebindable in Hotkey Editor).
- Press **Start** once you've spawned in with your gear on.
- Each upgrade costs exactly 1 point - no bundled stats, no surprises.
- If the mod can't tell which player object is yours, it lists everyone it
  found so you can point at yourself.

### [Crosshair Customizer](narrow-one-crosshair.user.js)

Stack multiple crosshair layers on top of each other to build combos - the
game's own seven styles (dot, cross, circle, square, X, T, off) rebuilt as
layers, each with its own colour, size, thickness, gap, opacity, and whether
it opens up with bow spread. Reorder layers, save named presets, and preview
everything live before committing.

- A **Crosshair** button appears in the main menu.
- The game's own crosshair settings move here too, so there's one place for
  all of it.

### [Health Number](narrow-one-health-number.user.js)

Shows your health as a live number beside the health bar, with a red screen
tint at low HP and a green tint (plus heartbeat) while regenerating. Fully
configurable from its own menu tab - colors, opacity, and thresholds.

- **Insert** opens/closes its settings (rebindable in Hotkey Editor).
- See [docs/health-number.md](docs/health-number.md) for the full write-up.

### [Hotkey Editor](narrow-one-hotkeys.user.js)

Rebind the game's own controls - move, shoot, jump, switch weapon, third
person, chat, scoreboard, everything - plus the toggle keys of whichever
other mods you have installed. Click a key to rebind it (a mouse button
works too, since Shoot is normally a click), Escape cancels a rebind in
progress, and it warns you if two actions end up sharing the same key.

The game control list is read live from the game's own input system, not
typed out by hand, so it can't go stale. Reaching it needs the same one-off
cache patch as 1 Kill = 1 Stat Point (see that mod's section above) - safe to
have both installed, whichever loads first does the actual patch.

The mod-hotkey list only shows mods you actually have installed - nothing
appears for one you don't have, and nothing breaks if you're missing one.

Also covers menu buttons the game never gave a key at all - Shop, Settings,
Maps, Squad, Full Screen, Exit Round - all unbound until you assign one.

- A **Hotkeys** button appears in the main menu.
- Game controls: rebind anything, right down to which mouse button fires
  your bow, or a bare Shift/Ctrl/Alt press if you want it.
- Other hotkeys: **1 Kill = 1 Stat Point** (default F) and **Health Number**
  (default Insert) when installed, plus Shop/Settings/Maps/Squad/Full
  Screen/Exit Round - none of those have a default, so nothing changes
  until you set one.

### [Settings & Stats](narrow-one-settings-stats.user.js)

No tab of its own - everything lands where the game already has a spot
for it.

**Settings dialog:** FOV, mouse sensitivity, crosshair accuracy offset, UI
scale and render quality get widened right on the native slider the moment
the dialog opens. The game's own `setValue()` does no clamping at all - the
slider's min/max was only ever a UI choice - so this is the same setting,
same row, same everything, just a wider native range to drag.

**Click your name:** the profile dialog you already get from the corner
profile keeps its real lifetime stats (games played, kills, deaths, ...) -
this adds a K/D row plus a running session block (kills/deaths/flags for
this browser session, carried across matches) right into that same panel.

**Hold Tab:** replaces the game's own scoreboard while held - a centered panel with the full player table (kills, deaths, K/D, flags, score by team) next to this match's
kills/deaths/flags/K-D/ping/fps, a live breakdown of every way you've
scored a point this match (kills, headshots, flag captures, assists, ... -
the game's own scoring categories, not a guess), the running session, and
coins earned this round once the server actually sends them at round end -
for exactly as long as Tab is held, hooked into the game's own Tab
binding, not a separate toggle.

**Name tags (Settings option):** "Name tags above players" is added under "Show ping and fps" in the native Settings dialog (off by default). The game has no in-world name tags, so this projects each player's position through the game's camera and draws a label. Teammates are always tagged; enemies (red-tinted) only while you can actually see them - each one is gated on the game's own wall raycast (the one that stops arrows), so a tag never appears through solid geometry, and if that test cannot run the tag stays hidden.

**Scoreboard:** team headers read Red team / Blue team (named from your own team's colour, the only one the game exposes), each row has the player's avatar, and the weapon-switch bar keeps its normal grey.

**FPS limit (Settings option):** an "FPS limit" slider under Quality. The game runs one frame per `frameCap` browser frames (a plain integer, default 1), so the slider changes that divisor live with no reload and the labels are your real display rate divided by it (144 Hz: 144 / 72 / 48 / 36 ...). Right end is Uncapped, which means as fast as your display refreshes - the browser hands out frames at the monitor's rate and no page can exceed it. The Tab panel's FPS now shows the game's actual frame rate.

**Tinted UI:** every grey panel in the game (Settings, Shop, profile,
...) is one shared paper style driven by a single CSS colour variable, so
this swaps that variable for a half-strength dark tint - panels keep their borders, the game shows through, and it is not black,
text goes white with a dark halo, and sliders/checkboxes/text boxes keep a
faint fill so they don't vanish. Turn it off with
`NarrowSettingsStats.transparentUi(false)` in the console.

- Applies its own one-off cache patch automatically the first time the
  game's cache exists (play one round) - no button to press, just one
  page reload. Safe alongside 1 Kill = 1 Stat Point, which uses the same
  patch.

## Install (all five)

1. Install **[Tampermonkey](https://www.tampermonkey.net/)** (Chrome, Edge,
   Firefox, Opera).
   - On Chrome-based browsers, enable **Developer mode** at
     `chrome://extensions` or userscripts won't run.
2. Open the Tampermonkey dashboard → **+** (Create a new script).
3. Delete the template, paste in the whole contents of the `.user.js` file you
   want, and save (Ctrl+S).
4. Repeat for any of the others.
5. Open <https://narrow.one/> and join a match.

## Notes

- These read and write values the game's own UI already exposes - no raw
  network packets, no equipping gear you don't own, no automation of play.
- `research/` (extracted game source, used while building these) and
  `st.html` (a scratch test file) are intentionally left out of this repo -
  see [.gitignore](.gitignore).
