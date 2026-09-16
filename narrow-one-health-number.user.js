// ==UserScript==
// @name         Narrow One - Health Number
// @namespace    narrowone-health-number
// @version      2.2.0
// @description  Shows your health as a live number (0-100) beside the health bar, plus a red screen tint when you are low. Press Insert to open settings.
// @author       frogwagon
// @match        https://narrow.one/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * How it works
 * ------------
 * Narrow One builds its health HUD in JS. From the shipped game bundle:
 *
 *   setHealth(t){ const e = 100*(t = clamp01(t));
 *                 this.mainBarContainer.style.width = `${e}%`; ... }
 *
 * `mainBarContainer` is the element with classes "health-ui-bar clip" that sits
 * as a DIRECT child of ".health-ui-bar-container". (The other ".clip" in that
 * subtree is the damage-protection bar, nested one level deeper.) So the live
 * health fraction is simply the inline width percentage of:
 *
 *   .health-ui-bar-container > .health-ui-bar.clip
 *
 * This reads only your own HUD - the same number the bar in front of you is
 * already drawing. Nothing is hooked, sent, or intercepted.
 *
 * The structure the game creates, for reference:
 *
 *   .health-ui-container.wrinkledPaper
 *     .health-ui-bar-container                  <- position: relative, 270x22
 *       .health-ui-bar.bg.wrinkledPaper
 *       .health-ui-bar.clip                     <- width = health %  [read this]
 *         .health-ui-bar.main.wrinkledPaper
 *         .health-ui-bar
 *           .health-ui-bar.clip
 *             .health-ui-bar.damage-protection
 *       .health-ui-bar.border.wrinkledPaper
 *     .health-ui-heart
 */

(function () {
  'use strict';
  if (window.__narrowOneHealthNumber) return;
  window.__narrowOneHealthNumber = true;

  var BAR_SELECTOR = '.health-ui-bar-container > .health-ui-bar.clip';
  var STORE_KEY = 'narrowone.healthNumber.v6'; // v6: flat strength, 0.5s beat

  /**
   * The hotkey Hotkey Editor rebinds this to. A shared, tiny read - each mod
   * checks it itself rather than trusting a message from another script, so
   * this works regardless of what order Tampermonkey happens to run them in.
   *
   * Missing entry: use the default. Explicit null: the Hotkey Editor turned
   * it off. Anything else: the code of the key it was rebound to.
   */
  var HOTKEYS_KEY = 'narrowone.hotkeys.v1';
  function hotkeyFor(actionId, fallback) {
    try {
      var raw = localStorage.getItem(HOTKEYS_KEY);
      if (!raw) return fallback;
      var map = JSON.parse(raw);
      if (!Object.prototype.hasOwnProperty.call(map, actionId)) return fallback;
      return map[actionId];
    } catch (e) { return fallback; }
  }

  function keyLabel(code) {
    if (code === null || code === undefined) return 'Unbound';
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    return code;
  }

  /* ================================================================== *
   * Settings
   * ================================================================== */

  var DEFAULTS = {
    enabled: true,
    format: 'plain',         // plain | outOf100 | percent
    decimals: 0,             // 0 or 1
    position: 'right',       // right | barEnd | barCenter | above
    fontSize: 26,
    colorMode: 'grade',      // grade | fixed
    fixedColor: '#ffffff',
    showDeltas: true,        // floating -12 / +3 popups
    lowPulse: true,          // pulse the number at low health
    lowThreshold: 25,

    // low-health screen tint
    tintEnabled: true,
    tintFlash: true,
    tintBeatSeconds: 0.5,    // length of one pulse, constant at every health level
    tintColor: '#ff1717',
    tintThreshold: 35,       // tint is on at this hp and below, off above it
    tintStrength: 60,        // flat opacity while the tint is on, in percent
    // heartbeat sound, synced to the tint pulse
    soundEnabled: true,
    soundVolume: 35,         // percent

    // regen feedback
    regenGreen: true,        // bar fill goes green while healing
    regenOutline: true,      // bar outline goes green too
    regenTintEnabled: true,  // steady green screen tint while healing (never pulses)
    regenTintStrength: 35,   // percent
    regenColor: '#3ad353',

    tintAlwaysOn: false      // TEST MODE: tick this in the panel to pin the tint
                             // on at any health, even in the menu, when you want
                             // to check it renders without getting shot.
  };

  var cfg = load();

  function load() {
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) { out[k] = DEFAULTS[k]; });
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        Object.keys(DEFAULTS).forEach(function (k) {
          if (saved[k] !== undefined) out[k] = saved[k];
        });
      }
    } catch (e) { /* blocked or corrupt storage - defaults are fine */ }
    return out;
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (e) {}
  }

  /* ================================================================== *
   * Styles
   * ================================================================== */

  var STYLE_ID = 'nohn-style';

  var CSS = [
    '.nohn-readout {',
    '  position: absolute;',
    '  font-family: BlueNight, "Trebuchet MS", system-ui, sans-serif;',
    '  font-weight: bold;',
    '  line-height: 1;',
    '  white-space: nowrap;',
    '  pointer-events: none;',
    '  z-index: 101;',
    '  text-shadow: -2px 0 #000, 2px 0 #000, 0 -2px #000, 0 2px #000,',
    '               -2px -2px #000, 2px -2px #000, -2px 2px #000, 2px 2px #000;',
    '  transition: color .15s linear;',
    '}',
    /* positions are relative to .health-ui-bar-container (270 x 22) */
    '.nohn-readout.pos-right     { left: 100%; margin-left: 12px; top: 50%; transform: translateY(-50%); }',
    '.nohn-readout.pos-barEnd    { right: 8px; top: 50%; transform: translateY(-50%); }',
    '.nohn-readout.pos-barCenter { left: 50%; top: 50%; transform: translate(-50%, -50%); }',
    '.nohn-readout.pos-above     { left: 0; bottom: 100%; margin-bottom: 6px; }',
    '.nohn-readout.low { animation: nohn-pulse .8s ease-in-out infinite; }',
    '@keyframes nohn-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .4; } }',

    '.nohn-delta {',
    '  position: absolute;',
    '  left: 100%; margin-left: 12px; top: 50%;',
    '  font-family: BlueNight, "Trebuchet MS", system-ui, sans-serif;',
    '  font-weight: bold;',
    '  line-height: 1;',
    '  white-space: nowrap;',
    '  pointer-events: none;',
    '  z-index: 101;',
    '  text-shadow: -2px 0 #000, 2px 0 #000, 0 -2px #000, 0 2px #000;',
    '  animation: nohn-float 1s ease-out forwards;',
    '}',
    '@keyframes nohn-float {',
    '  0%   { opacity: 0; transform: translateY(-50%); }',
    '  15%  { opacity: 1; }',
    '  100% { opacity: 0; transform: translateY(-190%); }',
    '}',

    /* low-health screen tint - a vignette, so the centre of the screen where
       you are actually aiming stays clear */
    '#nohn-vignette {',
    '  position: fixed; left: 0; top: 0; right: 0; bottom: 0;',
    '  z-index: 50;',            /* above the canvas, below crosshair/HUD (100) */
    '  pointer-events: none;',
    '  opacity: 0;',
    '  transition: opacity .25s linear;',
    '}',
    '.nohn-vignette-pulse {',
    '  position: absolute; left: 0; top: 0; right: 0; bottom: 0;',
    '  animation-iteration-count: infinite;',
    '  animation-timing-function: ease-in-out;',
    '}',
    '@keyframes nohn-vig-pulse { 0%, 100% { opacity: .65; } 50% { opacity: 1; } }',

    /* Green health bar while regenerating. The bar is drawn by a Houdini paint
       worklet - `background: paint(wrinkledPaper)` - and --wrinkled-paper-color
       is a registered @property, so changing it repaints live. The game sets it
       inline, hence !important. */
    '.health-ui-bar-container.nohn-regen .health-ui-bar.main {',
    '  --wrinkled-paper-color: var(--nohn-regen-color, #3ad353) !important;',
    '}',
    /* The outline is a separate element with its own colour property, toggled by
       its own class so the fill and the outline can be greened independently. */
    '.health-ui-bar-container.nohn-regen-ol .health-ui-bar.border {',
    '  --wrinkled-paper-border-color: var(--nohn-regen-color, #3ad353) !important;',
    '}',

    /* Steady green screen tint while regenerating. Deliberately has no
       animation - the red one pulses because it is a warning, this one is just
       confirmation that you are healing. */
    '#nohn-regen-vignette {',
    '  position: fixed; left: 0; top: 0; right: 0; bottom: 0;',
    '  z-index: 49;',           /* directly under the red tint */
    '  pointer-events: none;',
    '  opacity: 0;',
    '  transition: opacity .3s linear;',
    '}',

    /* The dialog reuses the game's own .dialog / .settings-list / .dialog-*-input
       classes so it looks native. These few rules only cover what the game's
       settings dialog gets from its own container that ours does not. */
    '#nohn-dialog { max-height: calc(100vh - 60px); display: flex; flex-direction: column; }',
    '#nohn-dialog .settings-list { overflow-y: auto; flex: 1; min-height: 0; }',
    '#nohn-dialog .nohn-note {',
    '  margin: 4px 0 0; opacity: .65; font-size: 15px; max-width: 430px;',
    '}'
  ].join('\n');

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = CSS;
    (document.head || document.documentElement).appendChild(el);
  }

  /* ================================================================== *
   * Readout
   * ================================================================== */

  var barEl = null;         // the game's health bar element
  var readoutEl = null;     // our number
  var lastHealth = null;
  var pendingDelta = 0;
  var lastDeltaFlush = 0;

  function findBar() {
    if (barEl && barEl.isConnected) return barEl;
    barEl = document.querySelector(BAR_SELECTOR);
    if (!barEl) { readoutEl = null; lastHealth = null; pendingDelta = 0; }
    return barEl;
  }

  function readHealth(bar) {
    // The game writes this inline as "<n>%". Empty means setHealth() has not
    // run yet, which is full health.
    var w = bar.style.width;
    if (!w) return 100;
    var n = parseFloat(w);
    if (isNaN(n)) return null;
    return Math.max(0, Math.min(100, n));
  }

  function ensureReadout(bar) {
    var host = bar.parentElement; // .health-ui-bar-container, position: relative
    if (readoutEl && readoutEl.isConnected && readoutEl.parentElement === host) return readoutEl;
    var existing = host.querySelector('.nohn-readout');
    if (existing) { readoutEl = existing; return readoutEl; }
    readoutEl = document.createElement('div');
    readoutEl.className = 'nohn-readout';
    host.appendChild(readoutEl);
    return readoutEl;
  }

  function formatHealth(h) {
    var n = cfg.decimals === 1 ? h.toFixed(1) : String(Math.round(h));
    if (cfg.format === 'outOf100') return n + '/100';
    if (cfg.format === 'percent') return n + '%';
    return n;
  }

  function gradeColor(h) {
    if (cfg.colorMode === 'fixed') return cfg.fixedColor;
    // red at 0 -> yellow at 50 -> green at 100
    var hue = Math.max(0, Math.min(120, (h / 100) * 120));
    return 'hsl(' + hue.toFixed(0) + ', 95%, 58%)';
  }

  function spawnDelta(host, amount) {
    var rounded = amount > 0 ? Math.round(amount) : -Math.round(-amount);
    if (rounded === 0) return;
    var el = document.createElement('div');
    el.className = 'nohn-delta';
    el.textContent = (rounded > 0 ? '+' : '') + rounded;
    el.style.color = rounded > 0 ? '#5ee46b' : '#ff5a5a';
    el.style.fontSize = Math.round(cfg.fontSize * 0.7) + 'px';
    host.appendChild(el);
    setTimeout(function () {
      if (el.parentElement) el.parentElement.removeChild(el);
    }, 1100);
  }

  /* ------------------------------------------------------------------ *
   * Low-health screen tint
   * ------------------------------------------------------------------ */

  var vignetteEl = null;
  var vignettePulseEl = null;
  var lastTintCss = '';     // avoid touching style every frame
  var lastTintDur = '';
  var tintOverride = null;  // set by testTint() to hold the tint at an hp value

  function ensureVignette() {
    if (vignetteEl && vignetteEl.isConnected) return vignetteEl;
    var existing = document.getElementById('nohn-vignette');
    if (existing) {
      vignetteEl = existing;
      vignettePulseEl = existing.firstElementChild;
      return vignetteEl;
    }
    vignetteEl = document.createElement('div');
    vignetteEl.id = 'nohn-vignette';
    vignettePulseEl = document.createElement('div');
    vignettePulseEl.className = 'nohn-vignette-pulse';
    vignetteEl.appendChild(vignettePulseEl);
    // Inside #gameWrapper so it survives the game going fullscreen.
    (document.getElementById('gameWrapper') || document.body).appendChild(vignetteEl);
    lastTintCss = '';
    lastTintDur = '';
    return vignetteEl;
  }

  /* ------------------------------------------------------------------ *
   * Heartbeat sound
   *
   * Synthesised with WebAudio rather than shipping an audio file, so the
   * script stays a single self-contained text file. Browsers refuse to start
   * an AudioContext until the page has seen a real user gesture, so we create
   * it lazily and resume it on the first click or keypress.
   * ------------------------------------------------------------------ */

  var audioCtx = null;

  function ensureAudio() {
    if (audioCtx) return audioCtx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { audioCtx = new AC(); } catch (e) { return null; }
    return audioCtx;
  }

  function wakeAudio() {
    var ctx = ensureAudio();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(function () {});
  }
  window.addEventListener('pointerdown', wakeAudio, true);
  window.addEventListener('keydown', wakeAudio, true);

  /** One low thump. `when` is an offset in seconds from now. */
  function thump(when, gainScale, startHz, endHz) {
    var ctx = audioCtx;
    if (!ctx || ctx.state !== 'running') return;
    var t0 = ctx.currentTime + when;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startHz, t0);
    osc.frequency.exponentialRampToValueAtTime(endHz, t0 + 0.13);
    var peak = Math.max(0.0002, Math.min(1, cfg.soundVolume / 100) * 0.85 * gainScale);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.27);
  }

  /** lub-dub: two thumps, the second softer and slightly higher. */
  function playHeartbeat() {
    if (!cfg.soundEnabled) return;
    var ctx = ensureAudio();
    if (!ctx || ctx.state !== 'running') return;
    thump(0, 1, 74, 38);
    thump(0.15, 0.62, 66, 34);
  }

  var beatTimer = null;
  var beatPeriod = 0;

  /** Keep the heartbeat timer in step with whether the tint is showing. */
  function syncBeat(active) {
    if (!active) {
      if (beatTimer) { clearInterval(beatTimer); beatTimer = null; beatPeriod = 0; }
      return;
    }
    var period = Math.max(100, Math.min(10000, cfg.tintBeatSeconds * 1000));
    if (beatTimer && period === beatPeriod) return;  // already running at this rate
    if (beatTimer) clearInterval(beatTimer);
    beatPeriod = period;
    playHeartbeat();
    beatTimer = setInterval(playHeartbeat, period);
  }

  function hexToRgb(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return '255,23,23';
    return parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16);
  }

  var tintActive = false;

  /**
   * Called every frame with whether the tint should be showing. On the
   * off -> on edge it restarts the CSS pulse so the visual beat and the audio
   * beat start in phase with each other.
   */
  function setTintActive(active) {
    if (active !== tintActive) {
      tintActive = active;
      if (active && vignettePulseEl) {
        vignettePulseEl.style.animationName = 'none';
        void vignettePulseEl.offsetWidth;   // force reflow so the restart takes
        lastTintDur = '';                   // make the next frame re-apply it
      }
    }
    syncBeat(active && cfg.tintFlash);
  }

  function updateTint(h, regenerating) {
    if (!cfg.tintEnabled) {
      if (vignetteEl && vignetteEl.isConnected) vignetteEl.style.opacity = '0';
      setTintActive(false);
      return;
    }
    var el = ensureVignette();

    // Test mode ignores everything (and works outside a match). Otherwise the
    // tint is on at or below the threshold - EXCEPT while you are healing.
    // Regen outranks the danger tint: if health is climbing you are getting out
    // of trouble, so the red and its heartbeat give way to the green even below
    // the threshold. h === null means we are not in a match.
    if (!cfg.tintAlwaysOn && (regenerating || h === null || h > cfg.tintThreshold)) {
      el.style.opacity = '0';
      setTintActive(false);   // this also stops the heartbeat
      return;
    }

    setTintActive(true);

    // Flat strength - no ramp. At 35 hp it looks exactly the same as at 1 hp.
    el.style.opacity = (cfg.tintStrength / 100).toFixed(3);

    // Explicit rgba stops rather than fading a solid colour to transparent:
    // this keeps the middle of the screen genuinely clear while letting the
    // edges reach full opacity, so it reads as a border rather than a haze.
    var rgb = hexToRgb(cfg.tintColor);
    var bg = 'radial-gradient(ellipse at center,' +
             ' rgba(' + rgb + ',0) 30%,' +
             ' rgba(' + rgb + ',0.35) 58%,' +
             ' rgba(' + rgb + ',0.8) 80%,' +
             ' rgba(' + rgb + ',1) 100%)';
    if (bg !== lastTintCss) { vignettePulseEl.style.background = bg; lastTintCss = bg; }

    if (cfg.tintFlash) {
      // Constant beat: tintBeatSeconds is the length of one full pulse, the same
      // at 35 hp as at 0. It does not accelerate as you get lower.
      var dur = Math.max(0.1, Math.min(10, cfg.tintBeatSeconds)).toFixed(2) + 's';
      if (dur !== lastTintDur) {
        vignettePulseEl.style.animationName = 'nohn-vig-pulse';
        vignettePulseEl.style.animationDuration = dur;
        lastTintDur = dur;
      }
    } else if (lastTintDur !== 'none') {
      vignettePulseEl.style.animationName = 'none';
      vignettePulseEl.style.opacity = '1';
      lastTintDur = 'none';
    }
  }

  /* ------------------------------------------------------------------ *
   * Green health bar while regenerating
   * ------------------------------------------------------------------ */

  var lastRegenAt = -1e9;
  var regenVigEl = null;
  var lastRegenBg = '';

  function ensureRegenVignette() {
    if (regenVigEl && regenVigEl.isConnected) return regenVigEl;
    var existing = document.getElementById('nohn-regen-vignette');
    if (existing) { regenVigEl = existing; return regenVigEl; }
    regenVigEl = document.createElement('div');
    regenVigEl.id = 'nohn-regen-vignette';
    (document.getElementById('gameWrapper') || document.body).appendChild(regenVigEl);
    lastRegenBg = '';
    return regenVigEl;
  }

  function updateRegenTint(regenerating) {
    if (!cfg.regenTintEnabled) {
      if (regenVigEl && regenVigEl.isConnected) regenVigEl.style.opacity = '0';
      return;
    }
    var el = ensureRegenVignette();

    // The red low-health tint takes priority: a warning beats good news, and
    // stacking red over green just makes both unreadable.
    if (!regenerating || tintActive) { el.style.opacity = '0'; return; }

    var rgb = hexToRgb(cfg.regenColor);
    var bg = 'radial-gradient(ellipse at center,' +
             ' rgba(' + rgb + ',0) 30%,' +
             ' rgba(' + rgb + ',0.35) 58%,' +
             ' rgba(' + rgb + ',0.8) 80%,' +
             ' rgba(' + rgb + ',1) 100%)';
    if (bg !== lastRegenBg) { el.style.background = bg; lastRegenBg = bg; }
    el.style.opacity = (cfg.regenTintStrength / 100).toFixed(3);
  }

  /**
   * Are we healing right now? Regen ticks do not land on every single frame, so
   * hold the state for a moment after the last increase rather than strobing.
   */
  function computeRegen(d, h, now) {
    if (d !== null && d > 0 && h < 100) lastRegenAt = now;
    return h < 100 && (now - lastRegenAt) < 400;
  }

  function updateRegen(bar, regenerating) {
    var host = bar.parentElement;   // .health-ui-bar-container
    host.style.setProperty('--nohn-regen-color', cfg.regenColor);
    host.classList.toggle('nohn-regen', regenerating && cfg.regenGreen);
    host.classList.toggle('nohn-regen-ol', regenerating && cfg.regenOutline);
    updateRegenTint(regenerating);
  }

  function tick(now) {
    requestAnimationFrame(tick);

    var bar = findBar();
    if (!bar) { updateTint(tintOverride, false); return; } // not in a match

    var h = readHealth(bar);
    if (h === null) return;

    // Health bookkeeping runs before any of the display features, so regen
    // detection and damage popups still work with the number switched off.
    var d = null;
    if (lastHealth !== null) {
      d = h - lastHealth;
      // Ignore the instant snap back to full on respawn - that is not a heal.
      // Regen arrives in small per-frame steps, so a single jump of more than a
      // few points that lands at full health can only be a respawn. Instant
      // heals that do not top you off still show up normally.
      if (d > 5 && h >= 99) d = 0;
      pendingDelta += d;
    }
    lastHealth = h;

    // Work out whether we are healing first - the red tint defers to it - then
    // apply the tint, so updateRegen sees this frame's settled tintActive.
    var regenerating = computeRegen(d, h, now);
    updateTint(tintOverride !== null ? tintOverride : h, regenerating);
    updateRegen(bar, regenerating);

    if (cfg.showDeltas && now - lastDeltaFlush > 350) {
      lastDeltaFlush = now;
      if (Math.abs(pendingDelta) >= 1) spawnDelta(bar.parentElement, pendingDelta);
      pendingDelta = 0;
    }

    if (!cfg.enabled) {
      if (readoutEl && readoutEl.isConnected) readoutEl.style.display = 'none';
      return;
    }

    var el = ensureReadout(bar);
    el.style.display = '';
    el.className = 'nohn-readout pos-' + cfg.position +
      (cfg.lowPulse && h <= cfg.lowThreshold ? ' low' : '');
    el.style.fontSize = cfg.fontSize + 'px';
    el.style.color = gradeColor(h);

    var text = formatHealth(h);
    if (el.textContent !== text) el.textContent = text;
  }

  /* ================================================================== *
   * Settings dialog + main-menu button
   *
   * Rather than floating a custom panel over the game, this adds a real
   * button to the main menu next to Settings/Shop, and opens a dialog built
   * from the game's own markup:
   *
   *   <div class="main-menu-button-container">
   *     <button class="wrinkledPaper main-menu-button" aria-label="...">
   *       <div class="buttonImage" style="background-image: url(...)"></div>
   *     </button>
   *     <div class="main-menu-button-text whiteBigText blueNight">...</div>
   *   </div>
   *
   *   <div class="dialog wrinkledPaper">
   *     <h2 class="dialogTitle blueNight">...</h2>
   *     <div class="settings-list"><div>
   *       <h3 class="settings-group-header">...</h3>
   *       <label class="settings-item">
   *         <div class="settings-item-text">...</div>
   *         ...input...
   *       </label>
   *     </div></div>
   *     <div class="dialogButtonsContainer">...</div>
   *   </div>
   *
   * so it picks up the game's paper texture, fonts and input styling for free.
   * ================================================================== */

  /* The heart from the game's own health HUD, in the same 101x104 viewBox as
     the game's menu icons. */
  var HEART_ARROW_SVG =
    '<svg viewBox="0 0 101 104" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M88.46 29.518c-20.115-17.868-37.426 7.436-37.426 7.436s-17.608-24.235-37.723-6.367' +
        'c-19.15 17.013-1.536 36.621 6.817 45.585 8.678 9.313 27.586 18.743 30.166 18.743s22.968-9.634 ' +
        '31.646-18.947c8.353-8.968 25.67-29.439 6.52-46.45z" ' +
        'fill="black" stroke="black" stroke-width="6" stroke-linejoin="round"/>' +
    '</svg>';

  var ICON_URL = 'data:image/svg+xml,' + encodeURIComponent(HEART_ARROW_SVG);

  function seed() { return Math.floor(Math.random() * 99999); }

  /* ---- what goes in the dialog ---- */

  var GROUPS = [
    { title: 'Health number', fields: [
      { key: 'enabled',    label: 'Show health number', type: 'bool' },
      { key: 'format',     label: 'Format', type: 'select',
        options: [['plain', '73'], ['outOf100', '73 / 100'], ['percent', '73%']] },
      { key: 'decimals',   label: 'Decimals', type: 'select',
        options: [[0, 'Whole numbers'], [1, 'One decimal']] },
      { key: 'position',   label: 'Position', type: 'select',
        options: [['right', 'Right of bar'], ['barEnd', 'End of bar'],
                  ['barCenter', 'Centre of bar'], ['above', 'Above bar']] },
      { key: 'fontSize',   label: 'Text size', type: 'range', min: 10, max: 72, step: 1, suffix: 'px' },
      { key: 'colorMode',  label: 'Text colour', type: 'select',
        options: [['grade', 'Green to red'], ['fixed', 'Fixed colour']] },
      { key: 'fixedColor', label: 'Fixed colour', type: 'color' },
      { key: 'showDeltas', label: 'Damage popups', type: 'bool' }
    ]},

    { title: 'Low health', fields: [
      { key: 'tintEnabled',   label: 'Red screen tint', type: 'bool' },
      { key: 'tintThreshold', label: 'Turns on at', type: 'range', min: 1, max: 99, step: 1 },
      { key: 'tintStrength',  label: 'Tint opacity', type: 'range', min: 5, max: 100, step: 1, suffix: '%' },
      { key: 'tintColor',     label: 'Tint colour', type: 'color' },
      { key: 'lowPulse',      label: 'Pulse the number', type: 'bool' },
      { key: 'lowThreshold',  label: 'Number pulses at', type: 'range', min: 1, max: 99, step: 1 },
      { key: 'tintAlwaysOn',  label: 'Always on (for testing)', type: 'bool' }
    ]},

    { title: 'Heartbeat', fields: [
      { key: 'tintFlash',       label: 'Flash the tint', type: 'bool' },
      { key: 'tintBeatSeconds', label: 'Beat every', type: 'range', min: 0.1, max: 5, step: 0.1, suffix: 's' },
      { key: 'soundEnabled',    label: 'Heartbeat sound', type: 'bool' },
      { key: 'soundVolume',     label: 'Sound volume', type: 'range', min: 0, max: 100, step: 1, suffix: '%' }
    ]},

    { title: 'Regenerating', fields: [
      { key: 'regenGreen',        label: 'Green health bar', type: 'bool' },
      { key: 'regenOutline',      label: 'Green bar outline', type: 'bool' },
      { key: 'regenTintEnabled',  label: 'Green screen tint', type: 'bool' },
      { key: 'regenTintStrength', label: 'Tint opacity', type: 'range', min: 5, max: 100, step: 1, suffix: '%' },
      { key: 'regenColor',        label: 'Regen colour', type: 'color' }
    ]}
  ];

  /* ---- building the rows ---- */

  function buildRow(f) {
    var row = document.createElement('label');
    row.className = 'settings-item';

    var text = document.createElement('div');
    text.className = 'settings-item-text';
    text.textContent = f.label;
    row.appendChild(text);

    if (f.type === 'bool') {
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'dialog-checkbox-input wrinkledPaper';
      box.style.setProperty('--wrinkled-paper-seed', seed());
      box.checked = !!cfg[f.key];
      box.addEventListener('change', function () { cfg[f.key] = box.checked; save(); });
      row.appendChild(box);

    } else if (f.type === 'select') {
      var wrap = document.createElement('div');
      wrap.className = 'dialog-select-wrapper wrinkledPaper';
      wrap.style.setProperty('--wrinkled-paper-seed', seed());
      var sel = document.createElement('select');
      sel.className = 'dialog-select-input blueNight';
      f.options.forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = String(o[0]);
        opt.textContent = o[1];
        sel.appendChild(opt);
      });
      sel.value = String(cfg[f.key]);
      sel.addEventListener('change', function () {
        cfg[f.key] = (typeof DEFAULTS[f.key] === 'number') ? Number(sel.value) : sel.value;
        save();
      });
      wrap.appendChild(sel);
      row.appendChild(wrap);

    } else if (f.type === 'range') {
      var slider = document.createElement('div');
      slider.className = 'settings-item-slider';
      var input = document.createElement('input');
      input.className = 'dialog-range-input';
      input.type = 'range';
      input.min = f.min; input.max = f.max; input.step = f.step;
      input.value = cfg[f.key];
      var val = document.createElement('div');
      val.className = 'settings-item-slider-value';
      var render = function () {
        // step 0.1 needs a decimal place, step 1 does not
        var n = f.step < 1 ? Number(input.value).toFixed(1) : String(Math.round(input.value));
        val.textContent = n + (f.suffix || '');
      };
      render();
      input.addEventListener('input', function () {
        cfg[f.key] = Number(input.value);
        render();
        save();
      });
      slider.appendChild(input);
      slider.appendChild(val);
      row.appendChild(slider);

    } else if (f.type === 'color') {
      var col = document.createElement('input');
      col.type = 'color';
      col.className = 'dialog-color-input wrinkledPaper';
      col.style.setProperty('--wrinkled-paper-seed', seed());
      col.value = cfg[f.key];
      col.addEventListener('input', function () { cfg[f.key] = col.value; save(); });
      row.appendChild(col);
    }

    return row;
  }

  /* ---- the dialog ---- */

  var dialogEl = null;
  var curtainEl = null;

  function closeDialog() {
    if (dialogEl && dialogEl.isConnected) dialogEl.remove();
    if (curtainEl && curtainEl.isConnected) curtainEl.remove();
    dialogEl = null;
    curtainEl = null;
  }

  function openDialog() {
    if (dialogEl && dialogEl.isConnected) return;
    var host = document.getElementById('gameWrapper') || document.body;

    // Our own curtain rather than the game's, so we never fight its dialog state.
    curtainEl = document.createElement('div');
    curtainEl.className = 'dialogCurtain fullScreen';
    curtainEl.id = 'nohn-curtain';
    curtainEl.style.zIndex = '99';
    curtainEl.addEventListener('click', closeDialog);
    host.appendChild(curtainEl);

    dialogEl = document.createElement('div');
    dialogEl.className = 'dialog wrinkledPaper';
    dialogEl.id = 'nohn-dialog';
    dialogEl.style.setProperty('--wrinkled-paper-seed', seed());
    dialogEl.style.zIndex = '100';

    var title = document.createElement('h2');
    title.className = 'dialogTitle blueNight';
    title.textContent = 'Health';
    dialogEl.appendChild(title);

    var list = document.createElement('div');
    list.className = 'settings-list';
    var inner = document.createElement('div');
    list.appendChild(inner);

    GROUPS.forEach(function (g) {
      var h = document.createElement('h3');
      h.className = 'settings-group-header';
      h.textContent = g.title;
      inner.appendChild(h);
      g.fields.forEach(function (f) { inner.appendChild(buildRow(f)); });
    });

    var note = document.createElement('div');
    note.className = 'nohn-note settings-item-text';
    note.textContent = 'Changes apply instantly and are saved as you go.';
    inner.appendChild(note);

    dialogEl.appendChild(list);

    var btns = document.createElement('div');
    btns.className = 'dialogButtonsContainer';

    var resetBtn = document.createElement('button');
    resetBtn.className = 'dialog-button blueNight wrinkledPaper';
    resetBtn.tabIndex = -1;   // see the menu button's own comment on why
    resetBtn.style.setProperty('--wrinkled-paper-seed', seed());
    resetBtn.innerHTML = '<span>Reset</span>';
    resetBtn.addEventListener('click', function () {
      Object.keys(DEFAULTS).forEach(function (k) { cfg[k] = DEFAULTS[k]; });
      save();
      closeDialog();
      openDialog();
    });

    var doneBtn = document.createElement('button');
    doneBtn.className = 'dialog-button blueNight wrinkledPaper';
    doneBtn.tabIndex = -1;   // see the menu button's own comment on why
    doneBtn.style.setProperty('--wrinkled-paper-seed', seed());
    doneBtn.innerHTML = '<span>Done</span>';
    doneBtn.addEventListener('click', closeDialog);

    btns.appendChild(resetBtn);
    btns.appendChild(doneBtn);
    dialogEl.appendChild(btns);

    // Keep typing and keypresses inside the dialog away from the game's own
    // key handlers, and release the mouse so it is usable mid-match.
    ['keydown', 'keyup', 'keypress'].forEach(function (t) {
      dialogEl.addEventListener(t, function (e) { e.stopPropagation(); });
    });
    if (document.pointerLockElement) document.exitPointerLock();

    // Never a Tab-navigation stop - the game silently drops every keydown
    // while any BUTTON/INPUT/SELECT has focus (its own inputHasFocus()
    // check). This dialog is only built once per open rather than
    // re-rendered, so one sweep here catches every control in it.
    dialogEl.querySelectorAll('button, input, select').forEach(function (el) { el.tabIndex = -1; });

    host.appendChild(dialogEl);
  }

  function toggleDialog(force) {
    var open = force === undefined ? !(dialogEl && dialogEl.isConnected) : force;
    if (open) openDialog(); else closeDialog();
  }

  /* ---- the main-menu button ---- */

  function injectMenuButton() {
    var bar = document.querySelector('.menu-buttons-container');
    if (!bar) return;                                   // menu not built yet
    if (bar.querySelector('#nohn-menu-button')) return; // already there

    var container = document.createElement('div');
    container.className = 'main-menu-button-container';
    container.id = 'nohn-menu-button';

    var btn = document.createElement('button');
    btn.className = 'wrinkledPaper main-menu-button';
    btn.setAttribute('aria-label', 'Health');
    // Never a Tab-navigation stop - the game silently drops every keydown
    // while any BUTTON/INPUT/SELECT has focus (its own inputHasFocus()
    // check), so this button must never be where Tab's default focus
    // cycling can land while you're actually playing.
    btn.tabIndex = -1;
    btn.style.setProperty('--wrinkled-paper-seed', seed());

    var img = document.createElement('div');
    img.className = 'buttonImage';
    img.style.backgroundImage = 'url("' + ICON_URL + '")';
    img.style.backgroundSize = '90%';
    btn.appendChild(img);

    var label = document.createElement('div');
    label.className = 'main-menu-button-text whiteBigText blueNight';
    label.setAttribute('aria-hidden', 'true');
    label.textContent = 'Health';

    container.appendChild(btn);
    container.appendChild(label);

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleDialog();
    });

    // Sit next to Settings, which is where you would look for this.
    var settings = Array.prototype.slice.call(bar.querySelectorAll(".main-menu-button-container"))
      .find(function (c) { return (c.textContent || '').trim() === 'Settings'; });
    if (settings && settings.nextSibling) bar.insertBefore(container, settings.nextSibling);
    else bar.appendChild(container);
  }

  // The menu is built after load and rebuilt between rounds, so keep checking.
  injectMenuButton();
  setInterval(injectMenuButton, 1000);

  /** Skip a hotkey while you're typing somewhere - a colour picker included. */
  function typingInDialog(e) {
    var t = e.target;
    if (!t || !t.tagName) return false;
    var tag = t.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || t.isContentEditable;
  }

  window.addEventListener('keydown', function (e) {
    // Defaults to Insert; rebindable (or off) via the Hotkey Editor mod.
    var key = hotkeyFor('health.toggle', 'Insert');
    if (key !== null && e.code === key && !e.ctrlKey && !e.altKey && !e.metaKey &&
        !typingInDialog(e)) {
      e.preventDefault();
      toggleDialog();
    }
    if (e.code === 'Escape' && dialogEl && dialogEl.isConnected) {
      e.preventDefault();
      e.stopPropagation();
      closeDialog();
    }
  }, true);
  /* ================================================================== *
   * Boot
   * ================================================================== */

  injectStyle();
  requestAnimationFrame(tick);

  // Small console API, handy for testing without being in a match.
  window.NarrowHealthNumber = {
    config: cfg,
    save: save,
    panel: toggleDialog,
    selector: BAR_SELECTOR,
    /**
     * Hold the tint at a given hp so you can see it without being in a match.
     * testTint(0) is the strongest it ever gets. testTint() clears the hold.
     * Clears itself after 15s so you cannot get stuck with a red screen.
     */
    testTint: function (hp) {
      if (hp === undefined || hp === null) {
        tintOverride = null;
        return 'tint hold cleared';
      }
      tintOverride = Math.max(0, Math.min(100, Number(hp)));
      clearTimeout(window.__nohnTintTimer);
      window.__nohnTintTimer = setTimeout(function () { tintOverride = null; }, 15000);
      return 'tint held at ' + tintOverride + ' hp for 15s - NarrowHealthNumber.testTint() to clear';
    },
    /** Build a fake health HUD and animate it, to preview the readout. */
    demo: function (seconds) {
      var wrap = document.getElementById('gameWrapper') || document.body;
      var old = document.querySelector('.nohn-demo');
      if (old) old.remove();

      var container = document.createElement('div');
      container.className = 'health-ui-container nohn-demo';
      container.style.cssText = 'position:absolute;left:0;top:0;margin:30px;margin-left:60px;z-index:100;pointer-events:none;';

      var barContainer = document.createElement('div');
      barContainer.className = 'health-ui-bar-container';
      barContainer.style.cssText = 'margin:8px;position:relative;width:270px;height:22px;background:#0006;';

      var bar = document.createElement('div');
      bar.className = 'health-ui-bar clip';
      bar.style.cssText = 'position:absolute;left:0;top:0;height:22px;width:100%;background:#c33;';

      barContainer.appendChild(bar);
      container.appendChild(barContainer);
      wrap.appendChild(container);

      // Fall to 12, regen back to 100, then clean up.
      var t0 = performance.now();
      var span = (seconds || 12) * 1000;
      (function step(now) {
        var p = (now - t0) / span;
        if (p >= 1) { container.remove(); return; }
        var hp = p < 0.3
          ? 100 - (p / 0.3) * 88               // take damage
          : 12 + ((p - 0.3) / 0.7) * 88;       // regen
        bar.style.width = hp.toFixed(1) + '%';
        requestAnimationFrame(step);
      })(t0);
      return 'demo running';
    }
  };

  (function () {
    var key = hotkeyFor('health.toggle', 'Insert');
    var hint = key === null ? 'no key bound for settings' : 'press ' + keyLabel(key) + ' for settings';
    console.log('[Narrow One Health Number] loaded. ' + hint + ', ' +
                'or run NarrowHealthNumber.demo() to preview.');
  })();
})();
