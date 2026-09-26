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
this adds a K/D row.

**Ending the session:** the running session (kills/deaths/flags for this browser session, carried across matches - see the Tab panel below) has nowhere to reset itself, so the profile dialog also gets an **End session (reset to 0)** button. A session left untouched for 2 hours ends by itself the next time you load the game.

**Hold Tab:** replaces the game's own scoreboard while held - a centered panel with the full player table (kills, deaths, K/D, flags, score by team) next to this match's
kills/deaths/flags/K-D/ping/fps, a live breakdown of every way you've
scored a point this match (kills, headshots, flag captures, assists, ... -
the game's own scoring categories, not a guess), the running session, and
a centred coin counter under the stats (this round and last round, 1 coin per 10 points rounded up - the game's own rate) -
for exactly as long as Tab is held, hooked into the game's own Tab
binding, not a separate toggle.

**Name tags (Settings option) - never on the green (spectator) team:** "Name tags above players" is added under "Show ping and fps" in the native Settings dialog (off by default). The game has no in-world name tags, so this projects each player's position through the game's camera and draws a label. Teammates are always tagged; enemies (red-tinted) only while you can actually see them - each one is gated on the game's own wall raycast (the one that stops arrows), so a tag never appears through solid geometry, and if that test cannot run the tag stays hidden.

**Scoreboard:** team headers read Red team / Blue team (named from your own team's colour, the only one the game exposes), each row has the player's avatar (re-fetched every ~7 seconds while the panel is up, so a changed picture updates) and a Streak column - kills since that player's last death, in orange from 3 up - and the weapon-switch bar keeps its normal grey.

**Kill feed (Settings option):** "Kill feed" sits under the name-tag row (off by default) and lists kills down the right side (below the flag display) as `Killer → Victim`, coloured by team, fading after a few seconds. The game never tells the client who killed whom, so this infers it from the scoreboard's own numbers - a player dying, paired with whoever's kill count just went up - and shows "X died" if nobody's count moved. Spectators are left out.

**Bow charge (Settings option):** "Bow charge under crosshair" draws a readout under your crosshair that is different for each bow, told apart by the bow's own type: B1 (small bow) a draw bar with three circles for the stacked arrows; B2 and B3 (medium and large bow) a draw bar plus one circle that lights when fully drawn; B4 (small crossbow) and B6 (large crossbow) a reload bar plus one circle, both full when it is ready; B5 (repeating crossbow) a reload bar, then once it is full one circle per arrow in the box (10) that drop away as you fire. Only shown while you are alive and not spectating.

**Anti-fog (Settings option):** "Anti-fog" sits under the bow-charge row (off by default). Fog is a few shader values the game copies onto every material when the map's weather is applied; this wraps that call so they go in as zero, so distant terrain and players are drawn clearly. Colour grading and sky are untouched, and turning it off re-applies the map's real weather straight away, no reload.

**Arrow trail color (Settings options):** rows under the bow-charge one - an "Arrow trail color" on/off, a "Trail color" picker, a "Rainbow trail" toggle and a "Trail strength" slider (1x-5x). If the color does nothing, type `NarrowSettingsStats.trailDebug` in the console - it shows how many of your arrows it saw and patched, and why it skipped one. The game already draws a faint white trail behind every arrow; this recolors and brightens that same trail by patching the trail material's shader. There are separate colours for your own arrows, your teammates' and the enemy's; teammate and enemy colouring each have their own on/off box (off = the game's normal trail), and Rainbow applies to your own arrows.

**Hitboxes (Settings options):** "Hitboxes" draws every other player's hitbox: the three spheres (feet, body, head) the game tests arrows against, read from each player's own physics body. "Hitboxes: filled" switches between see-through outlines (off) and translucent filled shapes (on), with separate colour pickers for enemies and teammates and an opacity slider. They are real objects in the game's 3D scene that test depth, so walls hide them exactly as they hide the player - nothing shows through solid geometry. Your own body and spectators are skipped. If nothing appears, `NarrowSettingsStats.hitboxDebug` in the console says why.

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

### [Spectator Cam](narrow-one-spectator-cam.user.js)

Camera tools for when you are **spectating**: lock onto a player in chase or
first-person view, and follow the arrows they fire, on top of the free flight
the game already gives spectators.

Only active while you are a spectator, and it decides that the way the game
does - flight (`rigidBody.fly`) is switched on only for spectators - so while
you are playing every key here is ignored and the camera is left alone.
Spectators already see the whole match by design, so it shows nothing the
game wasn't willing to show you.

- **Z / X** previous / next player, **C** change view (chase, first person,
  arrow cam), **V** back to free camera - all rebindable in Hotkey Editor.
- First person hides the watched player's body but keeps the weapon they are
  holding, so you see their real bow or melee weapon, and hides your own
  weapon so it is not drawn over the view.
- **Mouse** swings the camera round the player or arrow from any angle, and the
  **wheel** zooms (about a third of the default distance out to 14x). With a
  free cursor, hold the left button to orbit. First person stays fixed to their
  eyes. The camera stops short of walls instead of going inside them.
- Arrow cam rides the locked player's latest arrow and stays on it for a
  moment after it lands.
- Needs "Fly when spectating" on (it is by default) and the same one-off cache
  patch as 1 Kill = 1 Stat Point, which it applies itself.
- Not a replay: the game deletes the map when a round ends, so there is nothing
  to fly through afterwards. This works live, for a match you are watching.

### [Achievements](narrow-one-achievements.user.js)

A trophy button in the main menu, with two sets of achievements underneath it.

**The game's own Steam achievements, working in the browser.** The client
already has every one of their unlock conditions built in and already runs
them during ordinary play - they just have nowhere to go outside the Steam
build. Every place the game decides you've earned one, it calls a single
function that only does anything if something named `steamworks` exists on
the page. Rather than fake that (which turns out to change other behaviour
too - see below), this patches that one function directly, the same
one-line cache-rewrite technique 1 Kill = 1 Stat Point uses to reach the
game's instance: the game's own condition, same moment, same seventeen ids
- this only catches the call. Steam's own achievement names and
descriptions live on Steam's servers, not in the client, so the name and
description shown for each one is this mod's own best reading of the
surrounding code, not the official text.

**A tiered set of new achievements**, covering seven stats (kills,
headshots, long-range hits, flag captures, assists, wins, matches played)
across up to three flavours each - an all-time running total, the most
you've done in one match, and a streak - five tiers apiece, plus a handful
of one-off "Secret" achievements for things that don't reduce to a single
number (a kill within seconds of respawning, absorbing hits without dying,
getting 10 kills with every bow in one match, and more). A tier only shows
up once you've earned the tier before it in that same row, and reaching a
high tier in one jump unlocks everything below it in that row too, but
never spills into an unrelated stat.

- A **Trophies** button appears in the main menu; tabs at the top (T1-T5,
  Secret) split everything up, and tiered rows carry a live progress bar.
- Needs the same one-off cache patch as 1 Kill = 1 Stat Point (for the new
  achievements) - applied automatically, no button, one reload the first
  time. The Steam-mirrored ones need it too now (an earlier version of
  this mod didn't require it for those, at the cost of a bug - see next).
- An earlier version tried a shortcut for the Steam achievements: making
  the page look like it was running inside Steam. That turned out to
  affect more than intended - it looks like the game uses the same signal
  to decide whether to apply your Pelican Party+ perks in the browser,
  since Steam handles its own entitlements separately. Fixed by patching
  the one function directly instead, so nothing about how the game sees
  itself changes.

### [Warband (Beta)](narrow-one-warband.user.js)

A friends system for a game that has none - checked directly in the game's
own code, there's no friends list, no join-request approval, no presence at
all. This adds one, through a small relay server you deploy yourself (see
[warband-server/](warband-server/)); nothing here works until that's set up
and its URL is pasted into the mod's own Settings tab.

**Friends, by a Warband ID** - a random id this mod makes up for itself, not
your real account. Request/accept by id, see who's online, ask permission
before joining someone or before inviting them (the actual join still goes
through the game's own real squad system, this only ever hands back a squad
code once approved), direct message them, and gift them some of your acorns.
Friend icons are a coloured circle with an initial, not a real avatar - a
Warband id has no connection to the game's own player/account system, so
there's no picture to honestly show for one.

**Weekly quests + acorns.** A handful of quests (kills, headshots, flags,
matches) refresh every 7 days and pay out "acorns" - a made-up currency that
only exists in this mod's own local storage. Spend them on cosmetic badges
shown in a small HUD icon only you see - never a skin swap, since the game
computes your equipped skin and your combat stats from the same field, and
changing that locally risks nudging your own stats too.

- A **Warband** button appears in the main menu.
- **Beta**: tested against a local fake relay and the real game with a
  couple of real accounts, but it's newer and less battle-tested than the
  rest of these - expect rough edges, especially in the friends system.
- Needs its own relay server - a one-time deploy to your own free
  Cloudflare account, see [warband-server/README.md](warband-server/README.md).
  An id is as sensitive as a squad code - anyone who has it can act as you
  on the relay - so hand it out the same way.
- Squad chat (a nicer floating panel around the game's own real "Press T"
  chat box) is still an unfinished shell as of this version - it opens, but
  doesn't yet show message content.

## Install (all eight)

1. Install **[Tampermonkey](https://www.tampermonkey.net/)** (Chrome, Edge,
   Firefox, Opera).
   - On Chrome-based browsers, enable **Developer mode** at
     `chrome://extensions` or userscripts won't run.
2. Open the Tampermonkey dashboard → **+** (Create a new script).
3. Delete the template, paste in the whole contents of the `.user.js` file you
   want, and save (Ctrl+S).
4. Repeat for any of the others.
5. Open <https://narrow.one/> and join a match.

Warband needs one extra one-time step before its Friends tab does anything -
deploying your own free relay server, see
[warband-server/README.md](warband-server/README.md).

## Notes

- These read and write values the game's own UI already exposes - no raw
  network packets, no equipping gear you don't own, no automation of play.
- `research/` (extracted game source, used while building these) and
  `st.html` (a scratch test file) are intentionally left out of this repo -
  see [.gitignore](.gitignore).
