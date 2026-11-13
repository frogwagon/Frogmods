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

**Name tags (Settings option) - never on the green (spectator) team:** "Name tags above players" is added under "Show ping and fps" in the native Settings dialog (off by default). The game has no in-world name tags, so this projects each player's position through the game's camera and draws a label. Teammates are always tagged; enemies (red-tinted) only while you can actually see them - each one is gated on the game's own wall raycast (the one that stops arrows), so a tag never appears through solid geometry, and if that test cannot run the tag stays hidden. An enemy tag is also only as big as the share of that player you can see: nine points over their body (head to feet, plus both shoulders and hips) are each tested against walls, so a fully visible enemy gets a full-size tag, one peeking out from cover gets a small one, and one fully behind a wall gets none. The tag also starts small when they come into view and grows to full size over about 1.5 seconds, and shrinks with distance (full up to 10 m, 30% from 70 m) - so someone who flashes past only ever gets a very small tag. Teammate tags stay full size.

**Flag reset timer (Settings option):** "Flag reset timer" sits right under the name-tag row (off by default) and puts a label over every dropped flag, drawn like the name tags (dark for your flag, red-tinted for the enemy's). The game already shows flag icons through walls, so this adds nothing about where a flag is - only how long it has left. The game never tells the client the reset time: the server just sends "flag returned" with no player when its timer runs out. So the mod times the first one it watches (drop to server return) and remembers it; from then on it shows a countdown (`⟳ 12s`). Until it has learned it, the label shows how long the flag has been down (`Down 8s`). Standing on your own dropped flag shows the game's own return progress (`Returning 40%`).

**Scoreboard:** team headers read Red team / Blue team (named from your own team's colour, the only one the game exposes), each row has the player's avatar (re-fetched every ~7 seconds while the panel is up, so a changed picture updates) and a Streak column - kills since that player's last death, in orange from 3 up - and the weapon-switch bar keeps its normal grey.

**Kill feed (Settings option):** "Kill feed" sits under the name-tag row (off by default) and lists kills down the right side (below the flag display) as `Killer → Victim`, coloured by team, fading after a few seconds. The game never tells the client who killed whom, so this infers it from the scoreboard's own numbers - a player dying, paired with whoever's kill count just went up - and shows "X died" if nobody's count moved. Spectators are left out.

**Bow charge (Settings option):** "Bow charge under crosshair" draws a readout under your crosshair that is different for each bow, told apart by the bow's own type: B1 (small bow) a draw bar with three circles for the stacked arrows; B2 and B3 (medium and large bow) a draw bar plus one circle that lights when fully drawn; B4 (small crossbow) and B6 (large crossbow) a reload bar plus one circle, both full when it is ready; B5 (repeating crossbow) a reload bar, then once it is full one circle per arrow in the box (10) that drop away as you fire. Only shown while you are alive and not spectating.

**Anti-fog (Settings option):** "Anti-fog" sits under the bow-charge row (off by default). Fog is a few shader values the game copies onto every material when the map's weather is applied; this wraps that call so they go in as zero, so distant terrain and players are drawn clearly. Colour grading and sky are untouched, and turning it off re-applies the map's real weather straight away, no reload.

**Arrow trail color (Settings options):** rows under the bow-charge one - an "Arrow trail color" on/off, a "Trail color" picker, a "Rainbow trail" toggle and a "Trail strength" slider (1x-5x). If the color does nothing, type `NarrowSettingsStats.trailDebug` in the console - it shows how many of your arrows it saw and patched, and why it skipped one. The game already draws a faint white trail behind every arrow; this recolors and brightens that same trail by patching the trail material's shader. There are separate colours for your own arrows, your teammates' and the enemy's; teammate and enemy colouring each have their own on/off box (off = the game's normal trail), and Rainbow applies to your own arrows.

**Hitboxes (Settings options):** "Hitboxes" draws every other player's hitbox: the three spheres (feet, body, head) the game tests arrows against, read from each player's own physics body. "Hitboxes: filled" switches between see-through outlines (off) and translucent filled shapes (on), with separate colour pickers for enemies and teammates and an opacity slider. They are real objects in the game's 3D scene that test depth, so walls hide them exactly as they hide the player - nothing shows through solid geometry. They also respect the fog: the map's own fog amount (the same formula the game's shader uses) fades each hitbox with distance, and past the point where the fog hides 90% of things the hitbox is not drawn at all - so on a foggy map you only see hitboxes about as far as you can see players, and the range follows the map's real weather even with Anti-fog on. On a clear map the range is over a kilometre, so nothing changes. Your own body and spectators are skipped. If nothing appears, `NarrowSettingsStats.hitboxDebug` in the console says why (it also shows the current fog range).

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

### [Warband](narrow-one-warband.user.js)

A friends system for a game that has none - checked directly in the game's
own code, there's no friends list, no join-request approval, no presence at
all. This adds one, through a small relay server you deploy yourself (see
[warband-server/](warband-server/)); nothing here works until that's set up
and its URL is pasted into the mod's own Settings tab.

**Friends, by a Warband ID** - a random id this mod makes up for itself, not
your real account. Request/accept by id, see who's online, ask permission
before joining someone or before inviting them (the actual join still goes
through the game's own real squad system, this only ever hands back a squad
code once approved), direct message them, and gift them some of your
cosmetic coins. Friend icons are a coloured circle with an initial, not a
real avatar - a Warband id has no connection to the game's own
player/account system, so there's no picture to honestly show for one.

**Daily + weekly quests, cosmetic coins.** A handful of quests (kills,
headshots, flags, matches) refresh every day at an easy difficulty, plus a
separate, harder set that refreshes every 7 days for a bigger payout - both
pay out "cosmetic coins", a made-up currency that only exists in this mod's
own local storage. You can also watch a real rewarded ad (through the
game's own existing ad provider) for a coin top-up - only pays out on a
genuinely completed ad, never a fake credit.

**The Cosmetic Shop - the game's own shop, copied and edited.** Reached from a
real "Cosmetic" tab in the Shop dialog (styled like its native tabs). It is
built out of the game's own dialog and item-grid classes, so it looks native
and shows the same live 3D preview of every item, but everything about
buying and wearing is this mod's own: every bow, melee and arrow skin in the
real shop is listed at 1/100th of the real price in cosmetic coins, the real
purchase code is never reached, and wearing one only changes how the weapon
looks on your own screen - it never touches your real equipped gear or your
stats, and no tile shows a stat bonus it doesn't give. Melee is the one
caveat: in this game a melee "skin" is really a different weapon, so a
cosmetic one only reskins a melee weapon you already carry. Also in there: a
fantasy-styled reskin for your Medium Bow, a real downloaded CC0 3D model.
Everything can be taken off again: click a worn tile to un-wear it, use
"Take off all" for the current category, or "Take off" on the Fantasy Bow row.
Gear and helmets aren't in yet.

- A **Warband** button appears in the main menu.
- Tested against a local fake relay and the real game with a couple of real
  accounts.
- Needs its own relay server - a one-time deploy to your own free
  Cloudflare account, see [warband-server/README.md](warband-server/README.md).
  An id is as sensitive as a squad code - anyone who has it can act as you
  on the relay - so hand it out the same way.
- Squad chat (a nicer floating panel around the game's own real "Press T"
  chat box) is still an unfinished shell as of this version - it opens, but
  doesn't yet show message content.

### [Modifier Roulette](narrow-one-modifier-roulette.user.js)

A chaos mod made for videos. While you're in a match, a random ridiculous
modifier lands on you every 20 seconds (the first one 10 seconds after you
appear). Each one lasts exactly 20 seconds, then the next one takes over.
Twenty-one of them:

- **Are you sure?** - shooting, jumping, walking or looking each ask "Are you
  sure you want to ...?" before they'll work (the Yes and No buttons swap
  sides at random), plus an **Everything** version that gates shooting,
  aiming, jumping, walking, looking, sprinting and weapon swaps all at once.
- **CAPTCHA** - an "I'm not a robot" box and a "select all squares with a
  frog" grid. **Terms & Conditions** -
  scroll to the very bottom to unlock Accept; Decline just makes them
  longer.
- **Inverted Controls** - mouse up is down, mouse left is right, W walks
  backwards and A goes right.
- **Glass Cannon** - any hit you take puts a "ONE SHOT" screen over the game
  and freezes your inputs for 4 seconds.
- **The screen** - Drunk, Upside Down, Mirror World, Potato Mode, Tiny
  Screen, Zoom Fever, Disco, Silent Movie, Strobe, Fog of War.
- **Liar Crosshair** (a second crosshair that wanders off) and **Backseat
  Gamer** (unsolicited advice from "Mum", "A Seagull" and friends).

It only ever makes the game harder for you, and never plays for you: the
popups block an input until you confirm it by hand, Inverted Controls only
mirrors the moves you actually make, the CAPTCHA is its own
little emoji one solved by hand, and nothing is sent anywhere. One honest
limit: damage is decided by the server, so Glass Cannon can't truly one-shot
you - it's an honour-system penalty, which is why it freezes you instead.

- Click the little dice pill at the top of the screen for settings: switch it
  on or off, tick which modifiers can be rolled, and hit
  **Try** next to any of them to force it right now. **F8** toggles the whole
  mod even in a match.
- It pauses and clears itself whenever you're not in a match, so menus and the
  skin previews always look normal.
- Console: `NarrowModifierRoulette.list()`, `.force('drunk')`, `.roll()`,
  `.clear()`.

### [Quiver Rework](narrow-one-quiver-rework.user.js)

A challenge "update": no more infinite arrows. Every quiver in the shop gets
its own arrow profile - how many arrows it holds, how many seconds each
arrow takes to come back, and how long it waits after a shot before it
starts refilling. Small pouches refill fast; big quivers hold a lot but
refill slowly (the Wooden Log holds 30, at 7 seconds an arrow).

- You start every life with a full quiver. Each arrow fired uses one (a
  multi-arrow shot uses one per arrow), and when it's empty the bow won't
  draw until one comes back. Running out of arrows never blocks melee.
- Right of your health bar: a small white quiver icon, your arrow count, and
  a refill bar (grey while it waits after a shot, red number when empty).
- In the shop, hovering a quiver shows its Arrows, refill speed and refill
  delay as extra rows under the game's own stats (Focus, Movement Speed...).
- **Stamina:** moving, jumping and charging melee use stamina (it refills
  when you rest; a jump only costs a little). Every arm, glove, leg and shoe
  piece adds its own max stamina and regen; arms and gloves make melee
  cheaper, legs and shoes make moving cheaper. At 0 you are tired -
  slower walking, no jumping, no melee charge - until you are back to 30%.
  A stamina row with a lightning icon sits under the arrow counter, and
  arm/glove/leg/shoe pieces show their stamina stats in the shop too.
- **Bows:** your bow itself changes your quiver's numbers. Scout, Runner and
  Support are a lot better at everything (double arrows, refill twice as
  fast, 0.5s shorter wait); Assault is a bit better (30% more arrows, 20%
  faster refill, 0.2s shorter wait); Sharpshooter and Defender use the
  quiver as it is.
- **F7** opens the tables of every quiver, bow and arm/glove/leg/shoe piece, with
  yours highlighted, and on/off switches for arrows and stamina.
- It only makes things harder for you. It never touches your gear or its
  stats, and never changes damage - damage is decided by the game's server,
  and extra damage would land on real players who never agreed to it.
- Uses the same reversible cache patch as the other mods here; on a fresh
  install, reload once when it tells you to.

### [Target Practice](narrow-one-target-practice.user.js)

An aim trainer for Narrow One, behind a **Target Practice** button in the
game's menu.

**In-game range (your real bow):** practice dummies inside the real map
that you shoot with your real bow, so the arrow speed and drop are exactly
the game's for whichever bow you hold - Scout, Assault, Sharpshooter or any
crossbow. Start it from the menu while you're in a match, or press **F9**
while playing (F9 again stops it).

**Getting around:** the first time you open the menu, a short tutorial
walks you through it. You can replay it any time from the Help tab. The
menu has tabs:
- **Range:** start / stop, quick presets, the mode, difficulty, and what
  shows on screen.
- **Dummies:** how many, where they spawn, which kinds, and what they've
  learned.
- **Dummy stats**, **Records**, **Screen drills** and **Help**.

The quick presets set everything in one click: Warm-up, Real fight,
Tracking, 1v1 sweat and Chaos (50). Changing the mode or picking a preset
while the range runs restarts it.

- **Up to 50 dummies.** Far ones that you can't see update every 2nd or
  3rd frame (you can't tell), so even 50 stay smooth.
- **Spawn anywhere:** dummies can come in at their base, in front of you,
  at random spots all over the map (never in water, death zones, or right
  next to you), or a mix of all three.
- **Custom mix:** set exactly how many of each kind you want, up to 50 in
  all. Use it in Normal range and Timed challenge, or leave it on
  Automatic. There are 15 kinds:
  - hunters, explorers, high-ground takers, flag / hill runners, base
    defenders, campers, rushers, flankers and standing targets;
  - **snipers:** hold high ground 40+ m away, go for your head, and move
    away if you get within 30 m;
  - **bunny-hoppers:** circle you at 12-20 m, jumping the whole time;
  - **cowards:** run and hide from you, and never shoot (good for chasing
    practice);
  - **medics:** follow the most hurt dummy and heal it;
  - **bodyguards:** stand between you and another dummy, preferring a flag
    carrier;
  - **patrollers:** walk back and forth on a set path, stopping at each
    end.
- **A difficulty for each kind:** in the custom mix, each kind has its own
  difficulty button. Click it to cycle from Same (the Difficulty on the
  Range tab) through Stationary up to Hacker. For example, Pro snipers
  with Easy explorers and Stationary targets.
- **Your own presets:** "Save current setup as a preset" keeps every range
  setting under a name you choose, up to 12. That includes the mode, the
  dummies, the mix with its difficulties, and the stats. Your presets show
  under the built-in ones; click one to load it, or x to delete it.
- **Session history:** the Records tab graphs your last 30 sessions. It
  can show kills, hit %, headshot % or average hit distance, for all modes
  or just one. It can also show your results in the challenge or Waves you
  play most. A line tells you whether you're getting better (comparing
  your first few sessions with your latest few).
- **Keys:**
  - F9: start / stop.
  - F8: respawn every dummy somewhere new. This doesn't work in 1v1,
    team fights or Waves, where it would skip the fight.
  - Shift+F8: freeze / unfreeze the dummies.
- **HUD:** a tidy panel with three lines.
  1. The mode and its score.
  2. Your shooting.
  3. Everything else.

  Set it to Full, Compact or Off, at the top centre, top right or bottom
  centre.
- **Summary card:** when you stop the range, a card shows how you did,
  including your kills, hit %, headshots and longest / average hit.

- **They look like players:** each dummy is a real Narrow One player model
  in one of the game's default outfits, in the enemy team's colours, with
  the running pose and walking legs players have. (If the model can't be
  built, plain spheres stand in.)
- **They start at the enemy base:** the enemy flag in Capture the Flag,
  otherwise the enemy team's spawn area. ("In front of me" is a setting too.)
- **Each has a reason to move:** hunting you (only when they can shoot -
  with shooting off nobody hunts you) (closes to its favourite
  distance, then strafes while watching you), exploring (heads for ground
  no dummy has stood on yet), taking high ground (climbs to the highest spot
  it can find and holds it), or - for objective runners - going for your
  flag or the hill. What each one is doing shows over its head, above a
  health bar built from Narrow One's own health bar (the same torn-paper
  bar, border and heart as yours, shrunk down, in the enemy team's colour;
  the heart beats under 20%, like yours).
- **They move like real players - noobs to pros:** based on Narrow One
  player guides. Easy and Medium dummies play like noobs: they run straight at
  you to chase the kill, stand still in the open holding their aim, strafe in
  long predictable runs, bunny-hop for no reason and always rush the main
  lane. Hard, Pro and Hacker play like pros: micro-strafes with sudden stops,
  fighting from cover (peek about half a second - longer if the shot isn't
  drawn yet - often with a jump, shoot, duck back, then peek from a
  different spot), shooting back right after
  you release, sticking with a partner, and in Capture the Flag taking a
  different route each push (main lane, side lane or a wide wrap), escorts
  body-blocking for the carrier, and one defender staying at home. In a test
  against the same wall, a noob was in your sight 88-100% of the time and a
  pro 5-12%.
- **They try not to die:** hit one and it sprints away, zig-zagging and
  jumping. Get one below half health and it finds a spot you can't see,
  hides there and heals until it's nearly full.
- **They're taught each map automatically:** the first time the range runs on
  a map, the mod surveys the whole map with the game's own raycasts - every
  wall, every floor level, every step, stair and drop between levels - a
  little each frame in the background (about 7 seconds for a big map), and
  saves it so each map is only surveyed once. Each dummy is then told a share
  of the survey by difficulty: Easy a quarter, Medium half, Hard 80%, Pro all
  of it. In a test, a Pro dummy got round a long wall on its very first trip
  with no bumps; Easy still blundered into it. No files to import - it's
  automatic.
- **They learn the map:** every time a dummy walks into a wall it
  remembers it, and every time it gets through somewhere it remembers that
  too. All dummies share one memory per map, saved in your browser, so they
  get smarter the more you play: they plan routes round walls they've been
  told about and prefer ways other dummies have walked before. In a test with
  a long wall, the first trip took 12-17 s and about 260 bumps; after about
  20 trips a Pro dummy crossed in about 6.5 s with 0-4 bumps.
- **They understand height:** they learn the stairs, ramps, jumps and drops
  between levels, plan routes up and down with them, and on a map they don't
  know yet they climb step by step towards a flag that's above them. (In a
  test, a runner that had never seen the map climbed 8 steps to a flag on a
  4 m platform in under 10 seconds and learned the stairs on the way.)
- **They grab your flag and run it home:** in Capture the Flag, objective
  runners take your flag and try to carry it back to their base, with others
  escorting. Only one can carry it at a time. Kill the carrier and it drops:
  touch it to return it, or it goes home by itself after 20 seconds - unless
  another dummy picks it up. This is all on your screen only: your real flag
  never moves and never scores (while a dummy "has" it, the real one is just
  hidden for you, and a copy of the game's flag model rides on the dummy). If
  a real player takes the real flag, the practice flag goes home at once.
- **Real damage:** a hit on a dummy does exactly what it would do to a
  normal player with no armour - the game's own formula: body part (feet
  1/3, body 1/2, head 1) x the bow's damage (Scout 0.5, Assault 1,
  Sharpshooter 2, Runner 1/3, Support 0.4, Defender 2) x Attack Strength
  (0.8-1.2), then x1.1 for no armour, and never more than 90% of full health
  in any one second (so, as in the game, even a headshot can't one-shot a
  full-health player). They heal the way players do: nothing for 8 seconds
  after a hit, then faster and faster.
- **Dummies damage you (a setting):** dummy arrows hurt a "Practice" health
  bar (in the game's own style) just under your real one, with the same
  rules - their Assault bow, YOUR real Damage Protection, the 90%-a-second
  limit, and YOUR Health Regen on the game's healing curve. At zero you get a
  "killed by a dummy" screen and it refills. Your real health belongs to the
  server and is never touched.
- **A real shooting action:** every dummy except a Hacker can only shoot
  you at the end of a real shot - it raises its bow and draws it (the game's
  own aim and draw poses), slowed down while pulling exactly as you are
  (small bow x0.5, medium x0.3, large x0.1, crossbows their own), facing you,
  and only lets go when fully drawn: Scout 0.35 s, Assault 0.7 s,
  Sharpshooter 1.1 s, Runner 0.2 s (already loaded), Support 0.3 s of aim
  before its burst, Defender 0.9 s (quicker with Loading Speed). Lose its
  sight mid-draw and it holds a moment, then lowers the bow. A Hacker just
  fires.
- **Dummies shoot back (a setting):** they fire arrows that fly with drop and
  stop on walls, aiming better the higher the difficulty (Hard and Pro lead
  you when you move). Your real health belongs to the server, so their hits
  only count: a red flash, "HIT BY A DUMMY", and a counter.
- **They keep away from where others died:** every kill leaves a danger zone
  the others avoid for a while (15 s on Easy up to 60 s on Pro), and deaths
  are kept in the map memory, so spots where you keep getting kills stay
  feared.
- **They learn to fear you:** every kill makes them warier - kills this
  session count a lot, kills from earlier sessions on the map a bit, and the
  spots you stand on when you get kills are remembered. Scared dummies keep
  further away (a hunter that kept 14 m kept about 39 m after 6 kills on Pro),
  prefer places you can't see, route away from you and your favourite spots,
  and peek out and duck back into cover. Easy learns this slowly, Pro fully.
  The score bar shows how scared they are.
- **The whole map:** explorers set off for unexplored parts of the whole map,
  not just nearby, and up to 50 dummies can be in at once. They're drawn at
  any distance the game draws anything (its camera reaches 900 m).
- **Each difficulty has its own learning:** how much of the shared memory a
  dummy is told depends on difficulty (Easy a quarter, Medium half, Hard
  80%, Pro all of it), and each dummy also remembers its own bumps up to a
  learning cap (Easy 15, Medium 60, Hard 250, Pro no limit).
- **Share what they learned:** the menu shows how many walls are known and
  has Export / Import / Forget buttons. Export saves the memory to a file;
  importing someone else's file adds their dummies' knowledge to yours. (The
  mod can't rewrite its own code - the learning is kept as data - but a
  well-trained file can be built into a future version as a starting brain.)
- **Difficulty:** Stationary (stand still in front of you), Easy (slow, no
  jumping, doesn't react), Medium, Hard, Pro (fast, jumps a lot, jukes side
  to side, runs and hides, heals fastest) and **Hacker** (flies a few metres
  up, over walls and rivers, very fast, near-perfect leading aim, knows the
  whole map and is never scared).
- **A player's body:** each dummy collides with the world using the same
  three spheres as a player (feet, body, head - read from your own player):
  bodies don't poke into walls, they can't walk under an overhang a player's
  head would hit or squeeze through a gap narrower than a player, jumps stop
  at ceilings, and the feet still step up stairs and small ledges.
- **Dummy stat editor:** set their Movement Speed, Damage Protection, Health
  Regen, Bloodlust, Focus, Attack Strength, Loading Speed and Travel Speed -
  any number, past the normal max, up to infinity (type "inf") - plus which
  bow they use (its damage, arrow speed and fire rate, and the bow they hold).
  Stats work the way the game works them, just without the cap; where
  infinity would break things it is capped (80 m/s, arrows 400 m/s, enough
  armour makes them immune rather than healed). The game's rule of at most
  90% of health per second still applies. "All max", "All infinite" and
  "Reset to 0" buttons. (No melee or stun stats: dummies don't melee you and
  can't stun you.)
- **Hitbox and damage are the game's own:** each dummy's hitbox is a copy
  of yours (feet, body and head spheres), and damage is the body part
  (feet 1/3, body 1/2, head 1) times your bow's damage times your Attack
  Strength. The server's exact formula isn't visible to the client, so treat
  it as very close rather than exact.
- **Melee works:** a swing that hits no real player is checked against the
  dummies with the game's own melee test - reach, aim angle, walls - and
  your weapon's damage times your Strength.
- **The same deadly ground as you:** they follow the map's own hazard rules -
  touching a death trigger (like the river in Fields) kills them, damaging
  ground hurts them the same amount and as often as it hurts you, mud and
  water slow them, they can't walk where you can't, and falling below the
  map's death height (or staying outside a round map's edge for 5 s) kills
  them. Those deaths aren't your kills, but they leave danger zones and go
  into the map memory, and the map survey marks deadly squares too - so they
  learn to stay out of the river. (Their collision itself is the game's
  raycasts, not a copy of your physics body.)
- **No natural deaths (setting):** turn it on and the map can't kill a
  dummy. If it walks into the river or a death zone, falls off the map, or
  stays outside a round map's edge, it's put straight back on the last
  spot where it stood safely on solid ground. Damaging ground can't finish
  it off either: it's left with a sliver of health and put back on land.
  It still remembers the spot was dangerous, so the learning carries on.
  The HUD counts these as "Saved from the map". **Hackers are never killed
  by the map,** even with this setting off.
- **Physics:** gravity, jumping, falling off ledges, stepping up small
  ledges, and collision - they walk along walls and round props instead of
  through them. There's no full path-finding, so on twisty maps a dummy can
  still get stuck now and then.
- A hit works like hitting a player: your arrow stops and vanishes and the
  game's own hit or headshot sound plays, with a "HEADSHOT 42 m  -50"
  popup. A bar at the top counts kills, hits, headshots, melee hits,
  accuracy, your longest hit and flag reaches; your sessions are saved.
- Arrow hits are checked the way the game checks them on players: each
  stretch of the arrow's path keeps counting for 200 ms (step into an arrow's
  path just after it passed and you're still hit), and once an arrow hits a
  wall, nothing behind the wall counts.
- How the arrows work: your arrows are the game's own arrow objects, and
  each one reports every point it travels through (the same points the game
  checks walls and players against). The mod checks that same path against
  the dummies. Nothing is sent to the server - other players never see the
  dummies, and they give no coins and no stats. An arrow that hits a dummy
  stops there, so it can't also hit a real player behind it.
- **Light on your computer:** route planning searches smartly and remembers
  its answers, gives up quickly on places it can't reach, dummies skip the
  detailed wall checks while they're well clear of walls, and models you
  can't see aren't re-posed (far ones less often). In a stress test with 20
  Pro dummies the mod's own work went from about 8 ms to under 3 ms a frame.
- It runs inside a real match (the menu map has no player to shoot with),
  so a quiet server is the best place to practice.

**1v1 duel mode:** set Mode to "1v1 duel" for practice against one dummy
that plays like a real 1v1 player. It starts 20-40 m away in sight, its
main goal is to kill you (it pushes when your practice health is low), but
it doesn't want to die either - when hurt it backs off to cover, heals and
comes back. Rounds go to a first-to score (1-10, 5 by default) with a
3-second countdown and both of you reset between rounds; shooting and
practice health are on automatically. It plays each bow ("Their bow")
differently:

- **Scout:** rushes in close (8-16 m), strafes and jumps a lot.
- **Assault:** mid range (18-28 m), strafes and peeks from cover.
- **Sharpshooter:** long range (35-60 m) from cover, careful shots aimed
  at your head, backs off if you rush it.
- **Runner:** hit and run - dashes in to ~10 m, shoots, runs to cover to
  reload.
- **Support:** mid range, fires 5-arrow bursts, then reloads behind cover.
- **Defender:** holds a spot at 25-40 m and stands still for steady, heavy
  shots.

Difficulty still decides how well it moves (noob to pro), and the stat
editor applies to it too.

**More modes** (the Mode setting):

- **Movement drill:** dummies spawn in front of you and each walks one
  set pattern, so you can practice leading shots against one kind of
  movement at a time. The patterns are side strafe, jump spam,
  strafe + jumps, stop and go (sudden stops), and ledge drops (climb onto
  something higher, then walk off the edge toward you). "Mixed" gives
  each dummy its own pattern. They stay near their spot, don't shoot, and
  the HUD counts your hits per pattern.
- **Timed challenge:** four challenges.
  - "Race: 10 kills" is timed, fastest wins.
  - "Kill rush" gives you 60 s to get as many kills as you can.
  - "Headshots only" is 60 s, and body hits do nothing.
  - "Long shots" is 90 s, and only hits from 40 m+ count.

  There's a 3-second countdown, and the challenge restarts by itself
  afterwards. Your best for each challenge, bow and map is kept on a
  high-score board in the menu.
- **Waves:** survive on your practice health. Wave 1 has 2 dummies, and
  each wave adds one. Every third wave they're a difficulty harder,
  starting from the Difficulty setting, and a little faster. You get full
  health between waves. When you die it's game over, your best wave is
  saved to the board, and it starts again from wave 1.
- **Team fight (2v2 or 3v3):** you and dummy teammates (in your team's
  colours, with a blue bar) against a dummy team. Each dummy fights the
  nearest enemy, so teammates and enemies really shoot each other. Your
  arrows go through your teammates. Rounds go to a first-to score. If you
  die you're out for the round (your arrows and melee stop counting until
  the next round), but your team fights on. A round ends
  when one side is all down.
- **Flag defense:** every dummy goes for your flag, or the hill on maps
  without flags. Stop the carriers; the HUD counts carriers stopped. As
  always, the real flag is never touched.

**Personalities** (a setting for Normal, Timed challenge and Waves):
instead of all playing the same, dummies can be:
- **Campers:** hold a high or covered spot and aim steadily.
- **Rushers:** run straight at you jumping, and never back off.
- **Flankers:** circle round to your side, attack from there, then switch
  sides.

Pick "Mixed" for some of each, or all of one kind.

**Distance rings** (a setting): coloured dots on the ground at 10, 25, 50
and 75 m around you, labelled where you're looking, so you learn how much
your arrows drop at each range. Ground you can't see isn't marked.

**Your aim:** the menu keeps your hit %, headshot % and average hit
distance for every bow you've used in the range, says which bow you aim
best with, and graphs your hit % and headshot % over your last 30
sessions. The range HUD also shows your average hit distance.

**On-screen drills:** a canvas over the page, no game hooks:

- **Static:** one target at a time; take it before it times out.
- **Moving:** one target that keeps bouncing around the screen.
- **Bot Range:** dummies on three lanes (far ones smaller and slower) that
  run, change direction, stop and jump. A body hit is 1 point, a headshot
  is 2. Sliders for how many, respawn time and speed, and optional waves.

The in-game range uses the same reversible cache patch as the other mods
here; on a fresh install, reload once when it tells you to.

## Install (all ten)

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
