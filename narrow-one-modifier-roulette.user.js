// ==UserScript==
// @name         Narrow One - Modifier Roulette
// @namespace    narrowone-modifier-roulette
// @version      1.2.1
// @description  Every 20 seconds in a match a random, ridiculous modifier hits you: "Are you sure you want to shoot your bow?" popups, CAPTCHAs, terms & conditions, inverted controls, a drunk/upside-down/mirrored screen, a Glass Cannon penalty and more. 21 modifiers, each lasting exactly 20 seconds. Click the little dice pill (or press F8) for settings.
// @author       frogwagon
// @match        https://narrow.one/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * Modifier Roulette
 * -----------------
 * A self-inflicted chaos mod for videos. While you're in a match, a timer
 * picks a random modifier every 20 seconds and makes your life worse
 * for those 20 seconds. Everything here is purely local and only ever makes the
 * game HARDER for you:
 *
 *   - It never sends anything, never touches the network, and never reads
 *     anything from the game beyond the health bar the HUD already draws
 *     (the same element the Health Number mod reads).
 *   - It never plays for you. The "Are you sure?" modifiers only BLOCK an
 *     input until you confirm it yourself; the CAPTCHA is the mod's own
 *     little emoji one, and it is solved by hand.
 *   - It cannot change the damage you really take - that is decided by the
 *     server. "Glass Cannon" is therefore an honour-system penalty: any hit
 *     you take freezes your inputs for a few seconds behind a "you were
 *     one-shot" screen.
 *
 * Input blocking works by catching your own keyboard/mouse events in the
 * capture phase before the game sees them; key-up and mouse-up are always
 * let through so keys never get stuck. Popups release the mouse (pointer
 * lock), and clicking an answer takes it back.
 *
 * Console: NarrowModifierRoulette.list() / .force('drunk') / .roll() / .clear()
 */

(function () {
  'use strict';
  if (window.__narrowOneModifierRoulette) return;
  window.__narrowOneModifierRoulette = true;

  var STORE_KEY = 'narrowone.modifierRoulette.v1';
  var FIRST_ROLL_MS = 10000;     // grace period after you first appear in a match
  var FREEZE_MS = 4000;          // Glass Cannon penalty
  var MODIFIER_MS = 20000;       // every modifier lasts exactly 20 seconds

  /* ---------------------------------------------------------------- store */

  var settings = { enabled: true, off: {} };
  try {
    var raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      if (typeof raw.enabled === 'boolean') settings.enabled = raw.enabled;
      if (raw.off && typeof raw.off === 'object') settings.off = raw.off;
    }
  } catch (e) { /* storage blocked: defaults */ }
  function saveSettings() { try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ } }

  /* -------------------------------------------------------------- helpers */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function fmt(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }

  var rootEl = null;
  function root() {
    // Live inside <body>: the game's Full Screen button fullscreens the body, and anything outside it is hidden.
    if (rootEl && rootEl.isConnected) {
      if (document.body && rootEl.parentNode !== document.body) document.body.appendChild(rootEl);
      return rootEl;
    }
    rootEl = el('div');
    rootEl.id = 'nmr-root';
    // The game cancels wheel events on window (it uses the wheel for its own things) and may react to
    // keys, which would break scrolling and typing inside the mod's popups. Stop them at the mod's own
    // container so the game never sees them; the default action (scrolling, typing) still happens.
    ['wheel', 'keydown', 'keyup', 'keypress'].forEach(function (t) {
      rootEl.addEventListener(t, function (e) { e.stopPropagation(); });
    });
    (document.body || document.documentElement).appendChild(rootEl);
    return rootEl;
  }

  var CSS = [
    '#nmr-root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; font-family: "Trebuchet MS", system-ui, sans-serif; }',
    '#nmr-root * { box-sizing: border-box; }',
    /* pill */
    '.nmr-pill { position: fixed; top: 6px; left: 50%; transform: translateX(-50%); pointer-events: auto; cursor: pointer; padding: 4px 12px; border-radius: 999px; background: rgba(30,30,30,.72); color: #fff; font-weight: 700; font-size: 13px; white-space: nowrap; user-select: none; opacity: .8; }',
    '.nmr-pill:hover { opacity: 1; background: rgba(30,30,30,.9); }',
    /* banner + toasts */
    '.nmr-banner { position: fixed; top: 16%; left: 50%; transform: translateX(-50%); text-align: center; color: #fff; text-shadow: 0 3px 0 #000, 0 0 18px #000; animation: nmr-banner 3.2s ease-out forwards; pointer-events: none; }',
    '.nmr-banner .k { font-size: 18px; letter-spacing: 4px; opacity: .9; }',
    '.nmr-banner .n { font-size: 54px; font-weight: 900; line-height: 1.1; }',
    '.nmr-banner .d { font-size: 20px; font-weight: 700; margin-top: 4px; }',
    '@keyframes nmr-banner { 0% { opacity: 0; transform: translateX(-50%) scale(.6); } 8% { opacity: 1; transform: translateX(-50%) scale(1.08); } 14% { transform: translateX(-50%) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; } }',
    '.nmr-toast { position: fixed; bottom: 70px; left: 50%; transform: translateX(-50%); background: rgba(20,20,20,.88); color: #fff; padding: 8px 16px; border-radius: 8px; font-weight: 700; font-size: 14px; pointer-events: none; animation: nmr-toast 3.4s ease-out forwards; max-width: 80vw; text-align: center; }',
    '@keyframes nmr-toast { 0% { opacity: 0; } 8% { opacity: 1; } 85% { opacity: 1; } 100% { opacity: 0; } }',
    '.nmr-coach { position: fixed; left: 14px; bottom: 120px; max-width: 300px; background: #fff; color: #222; padding: 8px 12px; border-radius: 14px 14px 14px 2px; font-weight: 700; font-size: 14px; box-shadow: 0 3px 10px rgba(0,0,0,.5); pointer-events: none; animation: nmr-toast 4.2s ease-out forwards; }',
    '.nmr-coach b { color: #d9480f; display: block; font-size: 11px; letter-spacing: 1px; }',
    /* modal */
    '.nmr-back { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; pointer-events: auto; z-index: 2; }',
    '.nmr-box { background: #4a4a4a; color: #fff; border-radius: 8px; padding: 22px 26px; width: min(460px, 92vw); box-shadow: 0 10px 40px rgba(0,0,0,.7); }',
    '.nmr-box h2 { margin: 0 0 8px; font-size: 26px; text-transform: uppercase; letter-spacing: 2px; }',
    '.nmr-box p { margin: 0 0 14px; font-size: 17px; line-height: 1.35; }',
    '.nmr-box p.sub { font-size: 13px; opacity: .75; }',
    '.nmr-box.nmr-announce { text-align: center; animation: nmr-pop .35s ease-out; }',
    '.nmr-ann-k { font-size: 13px; font-weight: 800; letter-spacing: 4px; color: #ffb43b; }',
    '.nmr-ann-e { font-size: 64px; line-height: 1.2; }',
    '@keyframes nmr-pop { 0% { transform: scale(.6); opacity: 0; } 70% { transform: scale(1.06); opacity: 1; } 100% { transform: scale(1); } }',
    '.nmr-row { display: flex; gap: 12px; justify-content: center; }',
    '.nmr-btn { font: inherit; font-weight: 800; font-size: 16px; padding: 9px 20px; border: 0; border-radius: 6px; background: #ffb43b; color: #231a05; cursor: pointer; }',
    '.nmr-btn:hover:not(:disabled) { filter: brightness(1.12); }',
    '.nmr-btn:disabled { opacity: .45; cursor: default; }',
    '.nmr-btn.alt { background: #777; color: #fff; }',
    /* captcha */
    '.nmr-box.light { background: #f9f9f9; color: #222; border: 1px solid #d3d3d3; width: min(340px, 92vw); padding: 14px; border-radius: 3px; }',
    '.nmr-cap-check { display: flex; align-items: center; gap: 12px; padding: 14px 12px; border: 1px solid #d3d3d3; background: #fff; border-radius: 3px; font-size: 15px; cursor: pointer; }',
    '.nmr-cap-check i { width: 26px; height: 26px; border: 2px solid #c1c1c1; border-radius: 2px; background: #fff; display: inline-block; flex: none; }',
    '.nmr-cap-check i.spin { border-radius: 50%; border-color: #4a90e2 #e5e5e5 #e5e5e5 #e5e5e5; animation: nmr-spin .7s linear infinite; }',
    '@keyframes nmr-spin { to { transform: rotate(360deg); } }',
    '.nmr-cap-head { background: #4a90e2; color: #fff; padding: 12px 14px; margin: -14px -14px 10px; font-size: 14px; }',
    '.nmr-cap-head b { display: block; font-size: 24px; text-transform: capitalize; }',
    '.nmr-cap-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }',
    '.nmr-cap-grid button { font-size: 44px; line-height: 1; padding: 12px 0; background: #eee; border: 3px solid #eee; cursor: pointer; border-radius: 2px; }',
    '.nmr-cap-grid button.sel { border-color: #4a90e2; background: #cfe3fb; }',
    '.nmr-cap-msg { color: #c0392b; font-size: 13px; min-height: 18px; margin: 6px 0 2px; }',
    '.nmr-shake { animation: nmr-shake .35s; }',
    '@keyframes nmr-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-9px); } 75% { transform: translateX(9px); } }',
    /* terms */
    '.nmr-terms { height: 170px; overflow-y: scroll; background: #333; border-radius: 4px; padding: 10px 12px; font-size: 13px; line-height: 1.4; margin-bottom: 10px; text-align: left; }',
    '.nmr-terms li { margin-bottom: 6px; }',
    '.nmr-check { display: flex; gap: 8px; align-items: center; justify-content: center; margin-bottom: 12px; font-size: 14px; }',
    /* freeze */
    '.nmr-freeze { position: fixed; inset: 0; background: rgba(60,0,0,.82); color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; pointer-events: auto; z-index: 3; }',
    '.nmr-freeze .big { font-size: 78px; font-weight: 900; text-shadow: 0 4px 0 #000; }',
    '.nmr-freeze .small { font-size: 20px; font-weight: 700; margin-top: 6px; }',
    '.nmr-freeze .bar { width: min(380px, 80vw); height: 10px; background: rgba(255,255,255,.2); border-radius: 5px; margin-top: 18px; overflow: hidden; }',
    '.nmr-freeze .bar i { display: block; height: 100%; background: #ff5a4d; animation: nmr-bar ' + FREEZE_MS + 'ms linear forwards; }',
    '@keyframes nmr-bar { from { width: 100%; } to { width: 0; } }',
    /* settings */
    '.nmr-panel { position: fixed; top: 40px; left: 50%; transform: translateX(-50%); width: min(520px, 94vw); max-height: 84vh; overflow-y: auto; pointer-events: auto; z-index: 2; }',
    '.nmr-panel .top { display: flex; align-items: center; gap: 14px; margin-bottom: 12px; flex-wrap: wrap; font-size: 15px; font-weight: 700; }',
    '.nmr-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }',
    '.nmr-item { display: flex; align-items: center; gap: 8px; background: rgba(0,0,0,.25); border-radius: 5px; padding: 5px 8px; font-size: 13px; }',
    '.nmr-item .t { flex: 1; } .nmr-item .t b { font-size: 14px; } .nmr-item .t span { opacity: .75; display: block; }',
    '.nmr-item .nmr-btn { font-size: 12px; padding: 4px 10px; }',
    /* visual modifiers - they act on the game canvas only, never on the mod's own UI */
    'html.nmr-m-drunk canvas { animation: nmr-drunk 4.5s ease-in-out infinite; filter: blur(1.3px) saturate(1.3); }',
    '@keyframes nmr-drunk { 0%,100% { transform: rotate(-2.5deg) translate(-14px, 4px) scale(1.06); } 25% { transform: rotate(2.2deg) translate(12px, -8px) scale(1.1); } 50% { transform: rotate(-1deg) translate(-6px, 10px) scale(1.04); } 75% { transform: rotate(3deg) translate(8px, 2px) scale(1.09); } }',
    'html.nmr-m-upside canvas { transform: rotate(180deg) !important; }',
    'html.nmr-m-mirror canvas { transform: scaleX(-1) !important; }',
    'html.nmr-m-potato canvas { filter: blur(3.5px) saturate(.45) contrast(.85); }',
    'html.nmr-m-tiny canvas { transform: scale(.42) !important; }',
    'html.nmr-m-zoom canvas { animation: nmr-zoom 3.2s ease-in-out infinite; }',
    '@keyframes nmr-zoom { 0%,100% { transform: scale(1); } 50% { transform: scale(1.75); } }',
    'html.nmr-m-disco canvas { animation: nmr-disco 1.4s linear infinite; }',
    '@keyframes nmr-disco { from { filter: hue-rotate(0deg) saturate(2.4) brightness(1.1); } to { filter: hue-rotate(360deg) saturate(2.4) brightness(1.1); } }',
    'html.nmr-m-silent canvas { animation: nmr-silent .22s steps(1) infinite; }',
    '@keyframes nmr-silent { 0% { filter: grayscale(1) contrast(1.6) sepia(.4) brightness(.95); } 33% { filter: grayscale(1) contrast(1.4) sepia(.35) brightness(1.12); } 66% { filter: grayscale(1) contrast(1.7) sepia(.45) brightness(.85); } }',
    'html.nmr-m-strobe canvas { animation: nmr-strobe .7s steps(1) infinite; }',
    '@keyframes nmr-strobe { 0% { opacity: 1; } 68% { opacity: 0; } 82% { opacity: 1; } }',
    '.nmr-fog { position: fixed; inset: 0; pointer-events: none; background: radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 0, rgba(0,0,0,0) 8vmin, rgba(0,0,0,.97) 24vmin); z-index: 1; }',
    '.nmr-liar { position: fixed; left: 50%; top: 50%; width: 34px; height: 34px; margin: -17px 0 0 -17px; border: 3px solid #ff7b1c; border-radius: 50%; pointer-events: none; z-index: 1; box-shadow: 0 0 6px #000; }',
    '.nmr-liar::before, .nmr-liar::after { content: ""; position: absolute; background: #ff7b1c; }',
    '.nmr-liar::before { left: 50%; top: -9px; bottom: -9px; width: 3px; margin-left: -1.5px; }',
    '.nmr-liar::after { top: 50%; left: -9px; right: -9px; height: 3px; margin-top: -1.5px; }'
  ].join('\n');

  function injectCss() {
    if (document.getElementById('nmr-style')) return;
    var s = el('style');
    s.id = 'nmr-style';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  /* ----------------------------------------------------------- messaging */

  function toast(text) {
    var t = el('div', 'nmr-toast', text);
    root().appendChild(t);
    setTimeout(function () { t.remove(); }, 3500);
  }
  function banner(m) {
    var b = el('div', 'nmr-banner');
    b.appendChild(el('div', 'k', 'NEW MODIFIER'));
    b.appendChild(el('div', 'n', m.emoji + ' ' + m.name));
    b.appendChild(el('div', 'd', m.desc));
    root().appendChild(b);
    setTimeout(function () { b.remove(); }, 3300);
  }

  /**
   * The "you got ..." popup for each new modifier. It frees the mouse like the other popups, and the
   * 20-second countdown waits while it's open so you always get the full time. If another popup is
   * still up and can't be replaced, it falls back to the banner instead.
   */
  function announce(m) {
    if (modal && (modal.owner === 'gate' || modal.owner === 'announce')) modal.close(false);
    var opened = openModal('announce', function (box, close) {
      box.appendChild(el('div', 'nmr-ann-k', 'NEW MODIFIER'));
      box.appendChild(el('div', 'nmr-ann-e', m.emoji));
      box.appendChild(el('h2', null, m.name));
      box.appendChild(el('p', null, m.desc));
      box.appendChild(el('p', 'sub', 'Lasts ' + (MODIFIER_MS / 1000) + ' seconds. Good luck.'));
      var row = el('div', 'nmr-row');
      var ok = el('button', 'nmr-btn', "Let's go");
      ok.type = 'button';
      ok.addEventListener('click', function () { close(true); });
      row.appendChild(ok);
      box.appendChild(row);
    }, 'nmr-announce');
    if (!opened) banner(m);
  }

  /* -------------------------------------------------------------- modals */

  var modal = null; // { close, owner }

  function relock(lockEl) {
    if (!lockEl || !lockEl.isConnected) return;
    try {
      var r = lockEl.requestPointerLock();
      if (r && r.catch) r.catch(function () { /* the game's own click-to-play handles it */ });
    } catch (e) { /* ignore */ }
  }

  /** Opens one modal at a time. build(box, close) fills it. Returns false if one is already up. */
  function openModal(owner, build, boxClass) {
    if (modal) return false;
    var lockEl = document.pointerLockElement;
    if (lockEl) { try { document.exitPointerLock(); } catch (e) { /* ignore */ } }
    var back = el('div', 'nmr-back');
    var box = el('div', 'nmr-box' + (boxClass ? ' ' + boxClass : ''));
    back.appendChild(box);
    root().appendChild(back);
    var m = { owner: owner, closed: false };
    m.close = function (wantRelock) {
      if (m.closed) return;
      m.closed = true;
      back.remove();
      if (modal === m) modal = null;
      if (wantRelock !== false) relock(lockEl);
    };
    modal = m;
    build(box, m.close, back);
    return true;
  }

  /* ------------------------------------------------- "Are you sure?" gates */

  var SUBLINES = [
    'This action cannot be undone. It also cannot be done.',
    'Studies show that doing this is linked to doing it.',
    'Your choice may be shared with our 3,000 partners.',
    'Please consider the arrows.',
    'Think of your K/D.',
    'The bow has feelings too.',
    'Take your time. Everyone else is.',
    'Are you REALLY sure? Like, sure sure?',
    'A hamster has been informed.'
  ];

  // test(e) says whether an input event is this action. once: the permission is used up by one use;
  // otherwise it lasts keepMs after you say yes.
  var KEYS_MOVE = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };
  var ACTIONS = {
    shoot:  { label: 'shoot your bow',      once: true,  keepMs: 15000, test: function (e) { return e.type === 'mousedown' && e.button === 0; } },
    aim:    { label: 'aim down your sights', once: true, keepMs: 15000, test: function (e) { return e.type === 'mousedown' && e.button === 2; } },
    jump:   { label: 'jump',                once: true,  keepMs: 15000, test: function (e) { return e.type === 'keydown' && e.code === 'Space' && !e.repeat; } },
    move:   { label: 'move around',         once: false, keepMs: 6000,  test: function (e) { return e.type === 'keydown' && !!KEYS_MOVE[e.code] && !e.repeat; } },
    look:   { label: 'look around',         once: false, keepMs: 5000,  test: function (e) { return e.type === 'mousemove' && (e.movementX || e.movementY); } },
    swap:   { label: 'switch weapons',      once: true,  keepMs: 15000, test: function (e) { return e.type === 'keydown' && !e.repeat && (/^Digit[1-9]$/.test(e.code) || e.code === 'KeyQ' || e.code === 'KeyF'); } },
    sprint: { label: 'sprint',              once: false, keepMs: 6000,  test: function (e) { return e.type === 'keydown' && !e.repeat && (e.code === 'ShiftLeft' || e.code === 'ShiftRight'); } }
  };
  var activeActions = [];   // action names currently gated by the active modifier
  var permits = {};         // action name -> { until }

  function swallow(e) { e.stopImmediatePropagation(); e.preventDefault(); }

  function askAbout(name) {
    var def = ACTIONS[name];
    openModal('gate', function (box, close) {
      box.appendChild(el('h2', null, 'Are you sure?'));
      box.appendChild(el('p', null, 'Are you sure you want to ' + def.label + '?'));
      box.appendChild(el('p', 'sub', pick(SUBLINES)));
      var row = el('div', 'nmr-row');
      var yes = el('button', 'nmr-btn', 'Yes, I am sure');
      var no = el('button', 'nmr-btn alt', 'No, let me think');
      yes.type = no.type = 'button';
      yes.addEventListener('click', function () { permits[name] = { until: Date.now() + def.keepMs }; close(true); });
      no.addEventListener('click', function () { close(true); });
      // the buttons swap sides at random so you can't click on autopilot
      yes.style.order = Math.random() < 0.5 ? 0 : 2;
      no.style.order = 1;
      row.appendChild(yes); row.appendChild(no);
      box.appendChild(row);
    });
  }

  var frozenUntil = 0;

  function onInput(e) {
    if (!e.isTrusted) return;
    var now = Date.now();
    if (now < frozenUntil) { swallow(e); return; }
    if (modal || !document.pointerLockElement || !activeActions.length) return;
    for (var i = 0; i < activeActions.length; i++) {
      var name = activeActions[i];
      var def = ACTIONS[name];
      if (!def.test(e)) continue;
      var p = permits[name];
      if (p && p.until > now) { if (def.once) delete permits[name]; return; }
      swallow(e);
      askAbout(name);
      return;
    }
  }
  // key-up / mouse-up are never blocked so nothing gets stuck down
  ['keydown', 'mousedown', 'mousemove'].forEach(function (t) { window.addEventListener(t, onInput, true); });

  /* ------------------------------------------------------- inverted controls */

  // The game reads mouse look from movementX/movementY on window "mousemove" and keys by e.code on
  // window "keydown"/"keyup". Inverting is a one-for-one swap of YOUR input: your real event is
  // swallowed and the mirrored copy is passed on in its place. Nothing is ever generated on its own.
  var INVERT_KEYS = { KeyW: ['KeyS', 's'], KeyS: ['KeyW', 'w'], KeyA: ['KeyD', 'd'], KeyD: ['KeyA', 'a'],
    ArrowUp: ['ArrowDown', 'ArrowDown'], ArrowDown: ['ArrowUp', 'ArrowUp'], ArrowLeft: ['ArrowRight', 'ArrowRight'], ArrowRight: ['ArrowLeft', 'ArrowLeft'] };
  var invertOn = false;
  var invertHeld = {};   // real code -> swapped code we pressed down for it

  function sendKey(type, code, key, from) {
    window.dispatchEvent(new KeyboardEvent(type, { code: code, key: key, bubbles: true, cancelable: true,
      shiftKey: from ? from.shiftKey : false, ctrlKey: from ? from.ctrlKey : false, altKey: from ? from.altKey : false, repeat: from ? from.repeat : false }));
  }
  function onInvert(e) {
    if (!e.isTrusted || Date.now() < frozenUntil) return;
    if (e.type === 'keyup') {
      // always release what we pressed, even if the modifier ended while the key was held
      var held = invertHeld[e.code];
      if (!held) return;
      delete invertHeld[e.code];
      swallow(e);
      sendKey('keyup', held, INVERT_KEYS[e.code][1], e);
      return;
    }
    if (!invertOn || modal || !document.pointerLockElement) return;
    if (e.type === 'mousemove') {
      if (!e.movementX && !e.movementY) return;
      swallow(e);
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true,
        movementX: -e.movementX, movementY: -e.movementY, clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY }));
      return;
    }
    if (e.type === 'keydown' && INVERT_KEYS[e.code]) {
      swallow(e);
      invertHeld[e.code] = INVERT_KEYS[e.code][0];
      sendKey('keydown', INVERT_KEYS[e.code][0], INVERT_KEYS[e.code][1], e);
    }
  }
  ['keydown', 'keyup', 'mousemove'].forEach(function (t) { window.addEventListener(t, onInvert, true); });
  function releaseInverted() {
    Object.keys(invertHeld).forEach(function (code) { sendKey('keyup', invertHeld[code], INVERT_KEYS[code][1]); });
    invertHeld = {};
  }

  /* ---------------------------------------------------------------- CAPTCHA */

  var EMOJI_NAMES = { '🦆': 'duck', '🐸': 'frog', '🏹': 'bow', '🍞': 'bread', '🦀': 'crab', '🐢': 'turtle', '🚲': 'bicycle', '🪑': 'chair', '🍄': 'mushroom', '🧀': 'cheese', '🐙': 'octopus', '🛸': 'ufo' };
  var EMOJIS = Object.keys(EMOJI_NAMES);

  function openCaptcha() {
    return openModal('captcha', function (box, close) {
      var check = el('div', 'nmr-cap-check');
      var tick = el('i');
      check.appendChild(tick);
      check.appendChild(el('span', null, "I'm not a robot"));
      box.appendChild(check);
      box.appendChild(el('div', 'nmr-cap-msg', 'Your aim looked suspiciously consistent.'));
      var started = false;
      check.addEventListener('click', function () {
        if (started) return;
        started = true;
        tick.className = 'spin';
        setTimeout(function () { if (modal && modal.owner === 'captcha') challenge(); }, 1100);
      });

      function challenge(note) {
        box.textContent = '';
        var target = pick(EMOJIS);
        var others = EMOJIS.filter(function (x) { return x !== target; });
        var count = 2 + Math.floor(Math.random() * 3);
        var cells = [];
        var i;
        for (i = 0; i < count; i++) cells.push(target);
        while (cells.length < 9) cells.push(pick(others));
        cells = shuffle(cells);
        var head = el('div', 'nmr-cap-head');
        head.appendChild(document.createTextNode('Select all squares with'));
        head.appendChild(el('b', null, 'a ' + EMOJI_NAMES[target]));
        box.appendChild(head);
        var grid = el('div', 'nmr-cap-grid');
        var chosen = [];
        cells.forEach(function (c, idx) {
          var b = el('button', null, c);
          b.type = 'button';
          chosen.push(false);
          b.addEventListener('click', function () { chosen[idx] = !chosen[idx]; b.classList.toggle('sel', chosen[idx]); });
          grid.appendChild(b);
        });
        box.appendChild(grid);
        var msg = el('div', 'nmr-cap-msg', note || '');
        box.appendChild(msg);
        var verify = el('button', 'nmr-btn', 'VERIFY');
        verify.type = 'button';
        verify.style.background = '#4a90e2';
        verify.style.color = '#fff';
        verify.addEventListener('click', function () {
          var ok = cells.every(function (c, idx) { return (c === target) === chosen[idx]; });
          if (ok) { close(true); return; }
          box.classList.remove('nmr-shake');
          void box.offsetWidth;
          box.classList.add('nmr-shake');
          challenge('Please try again.');
        });
        box.appendChild(verify);
      }
    }, 'light');
  }

  /* ----------------------------------------------------- terms & conditions */

  var CLAUSES = [
    'You agree that arrows are a state of mind.',
    'The Company may, at any time, hold your bow hostage.',
    'You will not feed the target dummy after midnight.',
    'Any resemblance to skill is purely coincidental.',
    'You grant us a worldwide licence to your most embarrassing death.',
    'Headshots are non-refundable.',
    'You acknowledge that the floor is, in fact, lava (sometimes).',
    'We are not responsible for friendships ended by friendly fire.',
    'You waive the right to say "lag" more than twice per match.',
    'Clause 14(b) is intentionally left blank, then filled in again.',
    'You will refer to all frogs as "sir" or "madam".',
    'In the event of a draw you agree to settle it with a staring contest.',
    'This agreement is governed by the laws of Narrow One, which are unwritten.',
    'You consent to being outplayed by a toddler on the opposing team.',
    'Quivers must be returned in their original condition.'
  ];
  function clauseList(n) {
    var ol = el('ol');
    for (var i = 0; i < n; i++) ol.appendChild(el('li', null, pick(CLAUSES)));
    return ol;
  }
  function openTerms() {
    return openModal('terms', function (box, close) {
      box.appendChild(el('h2', null, 'Terms & Conditions'));
      box.appendChild(el('p', 'sub', 'Please read to the bottom. All of it. We will know.'));
      var scroller = el('div', 'nmr-terms');
      scroller.appendChild(clauseList(45));
      box.appendChild(scroller);
      var label = el('label', 'nmr-check');
      var cb = el('input');
      cb.type = 'checkbox';
      cb.disabled = true;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' I have read and understood every word'));
      box.appendChild(label);
      var row = el('div', 'nmr-row');
      var accept = el('button', 'nmr-btn', 'Accept');
      var decline = el('button', 'nmr-btn alt', 'Decline');
      accept.type = decline.type = 'button';
      accept.disabled = true;
      row.appendChild(accept); row.appendChild(decline);
      box.appendChild(row);
      function atBottom() { return scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4; }
      scroller.addEventListener('scroll', function () { if (atBottom()) cb.disabled = false; });
      cb.addEventListener('change', function () { accept.disabled = !cb.checked; });
      accept.addEventListener('click', function () { close(true); });
      decline.addEventListener('click', function () {
        // declining makes the terms longer
        scroller.appendChild(clauseList(20));
        scroller.scrollTop = 0;
        cb.checked = false; cb.disabled = true; accept.disabled = true;
        toast('Declined. The terms have been updated.');
      });
    });
  }

  /* ------------------------------------------------------------ glass cannon */

  function readHealth() {
    var bar = document.querySelector('.health-ui-bar-container > .health-ui-bar.clip');
    if (!bar) return null;
    var w = bar.style.width;
    if (!w) return 100;
    var n = parseFloat(w);
    return isNaN(n) ? null : n;
  }
  var lastHealth = null;
  var glassOn = false;

  function glassTick() {
    var h = readHealth();
    if (glassOn && h != null && lastHealth != null && h < lastHealth - 0.5 && h > 0 && Date.now() >= frozenUntil) oneShot();
    lastHealth = h;
  }
  function oneShot() {
    frozenUntil = Date.now() + FREEZE_MS;
    var f = el('div', 'nmr-freeze');
    f.appendChild(el('div', 'big', '💀 ONE SHOT'));
    f.appendChild(el('div', 'small', 'You took a hit. Glass Cannon says you are dead.'));
    var bar = el('div', 'bar');
    bar.appendChild(el('i'));
    f.appendChild(bar);
    root().appendChild(f);
    setTimeout(function () { f.remove(); }, FREEZE_MS);
  }

  /* --------------------------------------------------------------- modifiers */

  var MODS = [];
  function add(m) { MODS.push(m); }

  function gateMod(id, emoji, name, desc, actions) {
    add({ id: id, emoji: emoji, name: name, desc: desc,
      start: function () { activeActions = actions.slice(); permits = {}; },
      stop: function () { activeActions = []; permits = {}; } });
  }
  function classMod(id, emoji, name, desc) {
    add({ id: id, emoji: emoji, name: name, desc: desc,
      start: function () { document.documentElement.classList.add('nmr-m-' + id); },
      stop: function () { document.documentElement.classList.remove('nmr-m-' + id); } });
  }
  function repeating(owner, popFn, firstMs, everyMs) {
    var timer = null;
    var stopped = false;
    function go() {
      if (stopped) return;
      if (modal || !document.pointerLockElement) { timer = setTimeout(go, 1500); return; }
      popFn();
      timer = setTimeout(go, everyMs);
    }
    timer = setTimeout(go, firstMs);
    return function stop() {
      stopped = true;
      clearTimeout(timer);
      if (modal && modal.owner === owner) modal.close(false);
    };
  }

  // 1-5: the "Are you sure?" family
  gateMod('shoot', '🏹', 'Are You Sure: Shoot', 'Every shot asks "Are you sure?" first.', ['shoot']);
  gateMod('jump', '🦘', 'Are You Sure: Jump', 'Jumping needs written consent.', ['jump']);
  gateMod('move', '🚶', 'Are You Sure: Move', 'Walking is a big decision. Confirm it.', ['move']);
  gateMod('look', '👀', 'Are You Sure: Look', 'Even looking around needs a second opinion.', ['look']);
  gateMod('everything', '🤔', 'Are You Sure: Everything', 'Shooting, aiming, jumping, walking, looking, sprinting, swapping. All of it.', ['shoot', 'aim', 'jump', 'move', 'look', 'swap', 'sprint']);

  // 6-8: pop-ups
  (function () {
    var stopFn = null;
    add({ id: 'captcha', emoji: '🤖', name: 'CAPTCHA', desc: 'Prove you are not a robot. Repeatedly.',
      start: function () { stopFn = repeating('captcha', openCaptcha, 2500, 20000); },
      stop: function () { if (stopFn) stopFn(); stopFn = null; } });
    add({ id: 'terms', emoji: '📜', name: 'Terms & Conditions', desc: 'Read all of it. Twice.',
      start: function () { stopFn = repeating('terms', openTerms, 2500, 35000); },
      stop: function () { if (stopFn) stopFn(); stopFn = null; } });
  })();
  add({ id: 'glass', emoji: '💀', name: 'Glass Cannon', desc: 'Any hit you take = ' + (FREEZE_MS / 1000) + 's of being one-shot. Honour system.',
    start: function () { glassOn = true; },
    stop: function () { glassOn = false; } });

  // 9-18: the screen
  classMod('drunk', '🥴', 'Drunk', 'The world sways. So do you.');
  classMod('upside', '🙃', 'Upside Down', 'Everything is the wrong way up. Aim anyway.');
  classMod('mirror', '🪞', 'Mirror World', 'Left is right. Right is wrong.');
  classMod('potato', '🥔', 'Potato Mode', 'A very low budget graphics card.');
  classMod('tiny', '🔬', 'Tiny Screen', 'The game shrinks to a postage stamp.');
  classMod('zoom', '🔍', 'Zoom Fever', 'Your view breathes in and out. Mostly in.');
  classMod('disco', '🪩', 'Disco', 'All the colours, all the time.');
  classMod('silent', '🎞️', 'Silent Movie', 'Black and white and flickery.');
  classMod('strobe', '⚡', 'Strobe', 'The screen blinks. Aim during the blinks.');
  (function () {
    var fog = null;
    add({ id: 'fog', emoji: '🌫️', name: 'Fog of War', desc: 'You can only see a small circle in the middle.',
      start: function () { fog = el('div', 'nmr-fog'); root().appendChild(fog); },
      stop: function () { if (fog) fog.remove(); fog = null; } });
  })();

  // 19: the controls
  add({ id: 'inverted', emoji: '🔄', name: 'Inverted Controls', desc: 'Mouse up is down, left is right, W walks backwards.',
    start: function () { invertOn = true; },
    stop: function () { invertOn = false; releaseInverted(); } });

  // 20-21: just for fun
  (function () {
    var liar = null, raf = 0, t0 = 0;
    function loop(now) {
      var t = (now - t0) / 1000;
      if (liar) liar.style.transform = 'translate(' + (Math.sin(t * 0.9) * 170).toFixed(1) + 'px,' + (Math.cos(t * 1.3) * 110).toFixed(1) + 'px)';
      raf = requestAnimationFrame(loop);
    }
    add({ id: 'liar', emoji: '🎯', name: 'Liar Crosshair', desc: 'A second crosshair wanders around. It is lying.',
      start: function () { liar = el('div', 'nmr-liar'); root().appendChild(liar); t0 = performance.now(); raf = requestAnimationFrame(loop); },
      stop: function () { cancelAnimationFrame(raf); if (liar) liar.remove(); liar = null; } });
  })();
  (function () {
    var timer = null;
    var TIPS = [
      'Have you tried not dying?', 'You should have gone left.', 'That was a bad shot. Just saying.',
      'My cousin plays this and he never misses.', 'Maybe lower your sensitivity?', 'Are you even trying?',
      'Behind you. No, the other behind.', 'You are holding the bow wrong.', 'Just aim better!',
      'I would have hit that.', 'Wow. Okay.', 'Use the arrows. The pointy end.', 'Is your monitor on?'
    ];
    var NAMES = ['Gary (coach)', 'Mum', 'xX_Sniper_Xx', 'Your Cousin', 'A Seagull', 'Backseat Bob'];
    function say() {
      var c = el('div', 'nmr-coach');
      c.appendChild(el('b', null, pick(NAMES)));
      c.appendChild(document.createTextNode(pick(TIPS)));
      root().appendChild(c);
      setTimeout(function () { c.remove(); }, 4300);
    }
    add({ id: 'backseat', emoji: '🗣️', name: 'Backseat Gamer', desc: 'Unsolicited advice from people who are not playing.',
      start: function () { say(); timer = setInterval(say, 5000); },
      stop: function () { clearInterval(timer); timer = null; } });
  })();

  function modById(id) { for (var i = 0; i < MODS.length; i++) if (MODS[i].id === id) return MODS[i]; return null; }

  /* ----------------------------------------------------------------- engine */

  var current = null;      // the modifier that's currently rolled
  var running = false;     // whether its effect is currently applied (off while out of a match)
  var remainingMs = FIRST_ROLL_MS;
  var lastTickAt = Date.now();
  var pillEl = null;

  function inGame() {
    if (document.pointerLockElement) return true;
    if (modal || Date.now() < frozenUntil) return true;
    var bar = document.querySelector('.health-ui-bar-container');
    return !!(bar && bar.getClientRects().length > 0);
  }

  function applyCurrent() { if (current && !running) { running = true; try { current.start(); } catch (e) { /* ignore */ } } }
  function unapplyCurrent() { if (current && running) { running = false; try { current.stop(); } catch (e) { /* ignore */ } } }

  function activate(m, withBanner) {
    unapplyCurrent();
    current = m;
    if (m) { applyCurrent(); if (withBanner) announce(m); }
    updatePill();
  }
  function rollRandom() {
    var pool = MODS.filter(function (m) { return !settings.off[m.id] && m !== current; });
    if (!pool.length) pool = MODS.filter(function (m) { return !settings.off[m.id]; });
    if (!pool.length) { activate(null); return; }
    activate(pick(pool), true);
  }

  function tick() {
    if (rootEl) root();                       // keep the UI inside <body> (fullscreen)
    var now = Date.now();
    var dt = Math.min(now - lastTickAt, 1000);
    lastTickAt = now;
    glassTick();
    if (!settings.enabled) { if (current) activate(null); updatePill(); return; }
    if (!inGame()) {
      unapplyCurrent();   // keep menus and skin previews normal
      updatePill();
      return;
    }
    applyCurrent();
    if (!(modal && modal.owner === 'announce')) remainingMs -= dt;   // the clock waits for "Let's go"
    if (remainingMs <= 0) {
      rollRandom();
      remainingMs = MODIFIER_MS;
    }
    updatePill();
  }

  function updatePill() {
    if (!pillEl) return;
    var text;
    if (!settings.enabled) text = '🎲 Roulette off';
    else if (!inGame()) text = current ? '🎲 ' + current.emoji + ' ' + current.name + ' (paused)' : '🎲 Roulette: waiting for a match';
    else if (current) text = '🎲 ' + current.emoji + ' ' + current.name + ' · next in ' + fmt(remainingMs);
    else text = '🎲 first modifier in ' + fmt(remainingMs);
    if (pillEl.textContent !== text) pillEl.textContent = text;
  }

  /* --------------------------------------------------------------- settings */

  var panel = null;
  function closePanel() { if (panel) { panel.remove(); panel = null; } }
  function openPanel() {
    if (panel) { closePanel(); return; }
    if (document.pointerLockElement) { toast('Free your mouse (Esc) first, then click the dice.'); return; }
    var box = el('div', 'nmr-box nmr-panel');
    box.appendChild(el('h2', null, '🎲 Modifier Roulette'));
    var top = el('div', 'top');
    var enLabel = el('label');
    var en = el('input');
    en.type = 'checkbox'; en.checked = settings.enabled;
    en.addEventListener('change', function () { settings.enabled = en.checked; saveSettings(); if (!en.checked) activate(null); updatePill(); });
    enLabel.appendChild(en);
    enLabel.appendChild(document.createTextNode(' Enabled'));
    top.appendChild(enLabel);
    top.appendChild(el('span', null, 'Each one lasts 20 seconds'));
    var rollBtn = el('button', 'nmr-btn', 'Roll now');
    rollBtn.type = 'button';
    rollBtn.addEventListener('click', function () { rollRandom(); remainingMs = MODIFIER_MS; });
    var clearBtn = el('button', 'nmr-btn alt', 'Clear');
    clearBtn.type = 'button';
    clearBtn.addEventListener('click', function () { activate(null); });
    top.appendChild(rollBtn); top.appendChild(clearBtn);
    box.appendChild(top);

    var list = el('div', 'nmr-list');
    MODS.forEach(function (m) {
      var row = el('div', 'nmr-item');
      var cb = el('input');
      cb.type = 'checkbox'; cb.checked = !settings.off[m.id];
      cb.title = 'Include in the random roll';
      cb.addEventListener('change', function () { if (cb.checked) delete settings.off[m.id]; else settings.off[m.id] = true; saveSettings(); });
      var t = el('div', 't');
      t.appendChild(el('b', null, m.emoji + ' ' + m.name));
      t.appendChild(el('span', null, m.desc));
      var tryBtn = el('button', 'nmr-btn alt', 'Try');
      tryBtn.type = 'button';
      tryBtn.addEventListener('click', function () { activate(m, true); remainingMs = MODIFIER_MS; });
      row.appendChild(cb); row.appendChild(t); row.appendChild(tryBtn);
      list.appendChild(row);
    });
    box.appendChild(list);
    var close = el('button', 'nmr-btn', 'Close');
    close.type = 'button';
    close.addEventListener('click', closePanel);
    var wrap = el('div', 'nmr-row');
    wrap.appendChild(close);
    box.appendChild(wrap);
    panel = box;
    root().appendChild(box);
  }

  /* ------------------------------------------------------------------ boot */

  function boot() {
    injectCss();
    pillEl = el('div', 'nmr-pill');
    pillEl.title = 'Modifier Roulette - click for settings (F8 toggles it on and off)';
    pillEl.addEventListener('click', openPanel);
    root().appendChild(pillEl);
    updatePill();
    setInterval(tick, 250);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // F8 turns the whole thing on and off, even while the mouse is captured
  window.addEventListener('keydown', function (e) {
    if (e.code !== 'F8' || e.repeat) return;
    settings.enabled = !settings.enabled;
    saveSettings();
    if (!settings.enabled) activate(null);
    toast('Modifier Roulette ' + (settings.enabled ? 'on' : 'off'));
    updatePill();
  }, true);

  window.NarrowModifierRoulette = {
    list: function () { return MODS.map(function (m) { return m.id + ' - ' + m.name; }); },
    force: function (id) { var m = modById(id); if (!m) return false; activate(m, true); remainingMs = MODIFIER_MS; return true; },
    roll: function () { rollRandom(); remainingMs = MODIFIER_MS; },
    clear: function () { activate(null); },
    current: function () { return current && current.id; },
    count: function () { return MODS.length; }
  };
})();
