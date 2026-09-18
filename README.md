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

Wider ranges on the settings the game already has, plus a stats panel
richer than the single ping/fps line behind the native toggle.

The dialog's own sliders cap out well short of what the setting will
actually accept - `setValue()` stores whatever you give it, no clamping at
all. FOV, mouse sensitivity, crosshair accuracy offset, UI scale and render
quality each get a second slider here with a wider range, writing through
that exact same call - same setting, same storage, just more room on the
dial.

Stats shows kills, deaths, flags, K/D, score, elo, ping and fps live for
the match you're in, plus a running total that carries across matches
until you reset it - kills, deaths, flags and K/D for the whole session,
not just the current round.

- A **Settings & Stats** button appears in the main menu.
- Needs the same one-off cache patch as 1 Kill = 1 Stat Point to reach
  your settings and stats - safe to have installed alongside it.

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
