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

- **F** opens or closes the manager.
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

- **Insert** opens/closes its settings.
- See [docs/health-number.md](docs/health-number.md) for the full write-up.

### [Target Practice](narrow-one-target-practice.user.js)

A self-contained aim trainer, built right into the game's own menu. Press and
hold to draw, release to fire - same shape as the bow - at circular targets on
a full-screen range. Static mode gives you one target at a time on a timer;
Moving mode keeps a single target drifting and bouncing the whole session.

Doesn't touch a real match in any way - no reading or writing game state, no
bundle patch needed. It's just a canvas on top of the page, driven by your own
mouse, with your accuracy, hits, best streak, and average reaction time
tracked locally so you can watch yourself improve.

- A **Target Practice** button appears in the main menu.
- Settings: mode, target size, session length, and target speed or
  reaction window depending on the mode.
- Personal bests and recent sessions are shown right in the menu.

## Install (all four)

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
