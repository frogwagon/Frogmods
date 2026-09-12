# Health Number

A Tampermonkey userscript that shows your health as a live number (0–100) next to
Narrow One's health bar. It drops when you take damage and climbs back as you regen.
At 35 HP and below, the screen edges turn red and pulse twice a second so you
know you are in trouble, with a heartbeat to match. The game's own health bar
and outline turn green while you are regenerating, with a matching green screen tint.

## Install

1. Install **Tampermonkey** (Chrome / Edge / Firefox / Opera).
   - On Chrome-based browsers you also need **Developer mode** enabled at
     `chrome://extensions` or the script will not run.
2. Open the Tampermonkey dashboard → **+** (Create a new script).
3. Delete the template, paste the whole contents of
   [`narrow-one-health-number.user.js`](narrow-one-health-number.user.js), and save
   (Ctrl+S).
4. Open <https://narrow.one/> and join a match. The number appears next to the bar.

**Not the Steam build.** Steam ships this game through Pelican Party's own
[steam-web-wrap](https://github.com/Pelican-Party/steam-web-wrap), an Electron shell
that loads narrow.one from a URL. It is the same web client with the same DOM, so
the mod's logic would work there — but it is an app window, not a browser, so a
userscript extension has no way to inject into it. Play at narrow.one in a browser.

## Using it

- A **Health** button appears in the main menu next to Settings, with a heart-and-arrow
  icon. It opens a settings dialog built from the game's own markup, so it looks native.
- **Insert** opens/closes the same dialog. Opening it releases the mouse, so it
  is usable mid-match.
- The number only exists while you are in a match — the game creates and destroys
  the health HUD per round, and the script follows it.

The dialog is grouped the same way the game's own Settings dialog is.

**Health number**

| Setting | What it does |
| --- | --- |
| Show health number | Master on/off for the number |
| Format | `73`, `73 / 100`, or `73%` |
| Decimals | Whole numbers or one decimal place |
| Position | Right of bar, end of bar, centre of bar, or above it |
| Text size | 10–72 px |
| Text colour | Graded green→red, or a fixed colour |
| Fixed colour | Used when Text colour is set to *Fixed colour* |
| Damage popups | Floating `-32` / `+6` beside the bar |

**Low health**

| Setting | What it does |
| --- | --- |
| Red screen tint | The low-health vignette on/off |
| Turns on at | HP cutoff — on at this value and below (default 35) |
| Tint opacity | Flat opacity while it is on (default 60) |
| Tint colour | Defaults to red, any colour works |
| Pulse the number | Fades the number itself in and out when low |
| Number pulses at | Threshold for that (default 25) |
| Always on (for testing) | Pins the tint on at any health, even in the menu. Off by default |

**Heartbeat**

| Setting | What it does |
| --- | --- |
| Flash the tint | The pulse on/off. Off = steady tint |
| Beat every | Pulse length in seconds, constant at every health level (default 0.5) |
| Heartbeat sound | The synthesised thump |
| Sound volume | 0–100 (default 35) |

**Regenerating**

| Setting | What it does |
| --- | --- |
| Green health bar | Turn the bar fill green while healing |
| Green bar outline | Turn the bar's outline green too |
| Green screen tint | Steady green screen edges while healing (never pulses) |
| Tint opacity | Opacity of that green tint (default 35) |
| Regen colour | The green (or any colour) used for all three |

Settings persist in `localStorage` under `narrowone.healthNumber.v6` and apply
instantly as you change them - there is no Save step.

## The low-health tint

A fullscreen vignette — transparent through the middle 30%, colour only towards
the edges — so the part of the screen you actually aim through stays clear. It is
`pointer-events: none` at `z-index: 50`, which puts it above the game canvas but
below the crosshair and HUD, and it never intercepts clicks.

Rather than fading one solid colour out to transparent, it uses explicit `rgba`
stops (0 → 0.35 → 0.8 → 1 across 30%–100% of the radius). That keeps the middle
genuinely clear while letting the edges reach full opacity, so it reads as a red
border rather than a pink haze over everything.

The behaviour is deliberately binary — no ramp, no acceleration:

| HP | Tint |
| --- | --- |
| 36 and above | off |
| **35 and below** | **0.60 opacity, pulsing every 0.5s** |

It looks identical at 35 HP and at 1 HP. Earlier versions faded in gradually and
sped the beat up as you approached death, which was hard to notice mid-fight and
made the tint ambiguous; a flat on/off at a fixed rate reads instantly.

`Starts below` sets the HP cutoff, `Strength %` the opacity, `Beat (sec)` the
pulse length. Turn **Flashing** off for a steady tint with no pulse at all.

### Test mode

**Always on (test)** pins the tint at a flat `Strength %` no matter your health —
and even outside a match, so it shows on the main menu. It exists so you can
confirm the tint renders without having to get shot first. It uses the same beat
rate as normal. Off by default.

### Seeing it without playing

```js
NarrowHealthNumber.testTint(0)   // pretend you are at 0 hp - tint on
NarrowHealthNumber.testTint(80)  // pretend you are at 80 hp - tint off
NarrowHealthNumber.testTint()    // release the hold
```

The hold releases itself after 15 seconds so you cannot get stuck behind a red
screen.

> **Upgrading:** the settings key is bumped whenever tint defaults change (now
> `…v6`, as of v1.6.0) so the new values actually take effect — saved settings
> otherwise override defaults. Customisation from earlier versions is reset.
> v1.7.0 does *not* bump it: its settings are all new keys, which fall through to
> their defaults without disturbing anything you have already tuned. Same for v1.8.0.

## The menu button and dialog

The mod adds itself to the game's own main menu rather than floating a panel over
it. The button clones the structure the game uses for Settings/Shop/Maps:

```html
<div class="main-menu-button-container">
  <button class="wrinkledPaper main-menu-button" aria-label="Health"
          style="--wrinkled-paper-seed: …">
    <div class="buttonImage" style="background-image: url(…)"></div>
  </button>
  <div class="main-menu-button-text whiteBigText blueNight">Health</div>
</div>
```

and the dialog uses `.dialog.wrinkledPaper`, `.dialogTitle`, `.settings-list`,
`.settings-group-header`, `.settings-item`, `.dialog-range-input`,
`.dialog-checkbox-input`, `.dialog-color-input`, `.dialog-select-wrapper` and
`.dialogButtonsContainer` — all the game's own classes. That means it inherits
the paper texture, the BlueNight font, the slider and checkbox styling and the
light/dark theme for free, and it will follow along if the game restyles them.

Each `wrinkledPaper` element gets its own random `--wrinkled-paper-seed`, the way
the game does, so no two paper surfaces have an identical wrinkle pattern.

The dialog gets its own `.dialogCurtain` rather than reusing the game's, so the
two never fight over dialog state. Escape or a click on the curtain closes it.

### The icon

A heart with an arrow through it, in the same 101×104 viewBox as the game's
icons, inlined as a `data:` URI so the script stays a single file. The heart is
the exact path the game uses for the health HUD heart.

The first attempt drew the heart as an outline, but the white halo that makes the
arrow read as *passing through* chewed straight through the thin outline and the
shape stopped looking like a heart at 70px. Filling the heart solid and keeping
the halo fixed it — which also matches the filled heart in the HUD.

The menu is rebuilt between rounds, so the button re-injects itself on a 1s
interval if it goes missing.

## Heartbeat sound

A synthesised "lub-dub" on every tint pulse — two sine thumps sliding 74→38 Hz
and 66→34 Hz, the second softer, 0.15s apart. It is generated with WebAudio
rather than shipped as an audio file so the script stays one self-contained text
file you can paste anywhere.

Browsers will not start an `AudioContext` until the page has seen a real user
gesture, so the context is created lazily and resumed on the first click or
keypress. In practice it is awake long before you are ever low on health. Volume
0 is handled explicitly — `exponentialRampToValueAtTime` throws on a zero target,
so the peak is floored just above it.

The beat is restarted the moment the tint switches on, and the CSS pulse
animation is restarted at the same instant, so the sound and the visual flash
stay in phase rather than drifting apart.

## Regen feedback

While your health is climbing you get three signals, each toggleable:

1. the health bar **fill** goes green,
2. the bar **outline** goes green,
3. a steady green **screen tint** at the edges — the same vignette shape as the
   red one, but it never pulses. Healing is not an emergency.

Regen is inferred from your own HP curve: any frame where health increased counts
as a regen tick, held for 400ms afterwards so nothing strobes between ticks. It
switches off at full health, and the respawn snap is excluded, so spawning in
does not flash everything green.

### Precedence

**Regen outranks the low-health tint.** If your health is climbing you get green,
even below 35 HP — and the red tint *and its heartbeat* both stop. The reasoning:
below 35 and dropping means you are in trouble; below 35 and rising means you are
already getting out of it, so the alarm is just noise. The moment regen stalls —
because you took another hit — the red and the heartbeat come straight back.

| State | Screen | Heartbeat |
| --- | --- | --- |
| Above 35 HP, not healing | clear | silent |
| At/below 35, not healing | red, pulsing | beating |
| At/below 35, **healing** | **green, steady** | **silent** |
| Above 35, healing | green, steady | silent |
| Full health | clear | silent |

Only the two vignettes are mutually exclusive; the green bar fill and outline
show whenever you are healing, red tint or not.

Test mode (`Always on`) still forces the red tint regardless, since its whole
job is to make the tint appear on demand.

### Recolouring the real bar

The bar is painted by a Houdini paint worklet — `background: paint(wrinkledPaper)`
— reading custom properties the game sets inline per element: `--wrinkled-paper-color`
for the fill and `--wrinkled-paper-border-color` for the outline. Both are
`inputProperties` of the worklet, so changing either repaints it; overriding them
with `!important` recolours the *real* bar rather than covering it with an overlay.

Only the fill colour is registered with `@property { syntax: '<color>' }`, which
is why its computed value comes back normalised as `rgb(…)` while the outline
stays whatever hex you gave it. Registration affects typing and interpolation,
not whether the repaint happens — both work.

The fill and outline use separate marker classes (`nohn-regen`, `nohn-regen-ol`)
so either can be switched off on its own.

## How it works

Narrow One builds its health HUD in JavaScript. From the shipped bundle:

```js
setHealth(t){ const e = 100*(t = clamp01(t));
              this.mainBarContainer.style.width = `${e}%`; ... }
```

`mainBarContainer` is the `.health-ui-bar clip` element that is a **direct child**
of `.health-ui-bar-container` — the other `.clip` in that subtree is the
damage-protection bar, nested a level deeper. So the live health fraction is just
the inline width percentage of:

```
.health-ui-bar-container > .health-ui-bar.clip
```

The script reads that on each animation frame and renders it as text. That is all
it does. It reads only your own HUD — the same value the bar in front of you is
already drawing — and it does not hook, intercept, or send anything.

The DOM the game builds, for reference:

```
.health-ui-container.wrinkledPaper
  .health-ui-bar-container            ← position: relative, 270×22
    .health-ui-bar.bg.wrinkledPaper
    .health-ui-bar.clip               ← width = health %   [we read this]
      .health-ui-bar.main.wrinkledPaper
      .health-ui-bar
        .health-ui-bar.clip           ← damage protection, NOT this one
          .health-ui-bar.damage-protection
    .health-ui-bar.border.wrinkledPaper
  .health-ui-heart
```

### Respawn handling

Regen arrives in small per-frame steps, so any single jump larger than 5 points
that lands at full health can only be a respawn, not a heal — those are suppressed
so you do not get a bogus `+39` popup every time you spawn. An instant heal that
does not top you off still shows normally.

## Testing without a match

From the browser console:

```js
NarrowHealthNumber.demo()      // fake health bar: drops to 12, regens to 100
NarrowHealthNumber.panel(true) // force the settings panel open
NarrowHealthNumber.config      // live settings object
```

## Notes on the client (useful for future mods)

Gathered by inspecting the live client:

- three.js **r128**, Rollup build, shipped as ES modules:
  `js/index-*.js` (entry) + `js/colors-*.js` (shared chunk).
- **UI class names are semantic, not hashed** — `.crosshair-container`,
  `.health-ui-bar`, `.game-ad-wrapper`, `#mainMenu`. CSS-level mods survive rebuilds.
- The crosshair is already driven by CSS custom properties the game sets inline:
  `--line-color` and `--outline-color` on `.crosshair-container`. The three
  `.crosshair-line` elements are positioned by JS `transform` for bow spread, so a
  crosshair mod should change colour/size/opacity but never `transform`.
- Styles live in `document.adoptedStyleSheets`, not `<link>` tags, so
  `document.styleSheets` looks nearly empty.
- The shared chunk is **importable**: ES modules are singletons, so
  `await import('https://narrow.one/js/colors-<hash>.js')` returns the *same*
  three.js classes the game is using. Identify them by duck-typing (`isScene`,
  `isPerspectiveCamera`, `isColor`, `isMesh`) rather than by minified export name,
  and the lookup survives rebuilds. Patching `Object3D.prototype.updateMatrixWorld`
  then gives you the live scene and camera every frame.
  (`WebGLRenderer` is not in that chunk — it lives in the entry bundle.)
- `requestAnimationFrame` is suspended while the tab is backgrounded, which is
  correct behaviour but worth knowing when testing.

`research/` holds the two downloaded bundles used for the above. They are the
game's own code, kept locally as reference only — safe to delete.
