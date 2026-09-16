// ==UserScript==
// @name         Hotkey Editor
// @namespace    narrowone-hotkeys
// @version      2.1.2
// @description  Rebind the game's own controls, plus menu shortcuts like Shop and Settings that never had a key at all, plus the toggle keys of whichever other Narrow One mods you have installed. Adds a Hotkeys tab to the main menu.
// @author       Frogwagon
// @match        https://narrow.one/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

/*
 * Hotkey Editor  -  Narrow One
 * -----------------------------
 * Two unrelated things live under one tab because they're both "hotkeys":
 *
 * 1. The game's OWN controls - move, shoot, jump, switch weapon, scoreboard,
 *    chat, third person, fly (while spectating). These come straight from the
 *    bundle's own input registry:
 *
 *      this.keys.set("up",   new Binding({keyCodes:["KeyW","ArrowUp"]}))
 *      this.keys.set("fire", new Binding({mouseButtons:[0]}))
 *      ...
 *
 *    reached at `po().input.keys` - a live Map every action's own key check
 *    reads directly and unconditionally on every keydown/mousedown:
 *
 *      setKeyCodePressed(code) { return this.keyCodes.includes(code) && ... }
 *
 *    Mutating that array is the whole rebind - the very next press is tested
 *    against the new value, no reload needed. The list of actions is read
 *    from that same Map, not hand-typed here, so it can't go stale if a
 *    future build adds or renames one.
 *
 * 2. The toggle keys the OTHER mods use to open their own menus (F for the
 *    stat-point manager, Insert for Health, ...). Those already read a
 *    shared localStorage entry for their own key - this is the one place
 *    that writes to it. A mod's row only appears once that mod has actually
 *    registered itself on the page, so this never lists something you don't
 *    have installed.
 *
 * Reaching the game's input registry needs the exact same one-line bundle
 * patch as the 1 Kill = 1 Stat Point mod (see its own header for the full
 * reasoning). The patch is idempotent and anchored on an error string rather
 * than minified names, so it's safe to have both mods apply it - whichever
 * loads first does the actual write, the other sees "already patched".
 */

(function () {
  'use strict';

  var PAGE = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;

  var ENTRY_RE = /\/js\/index-[^/]*\.js$/;
  var PO_RE = /function ([A-Za-z_$][\w$]*)\(\)\{if\(!([A-Za-z_$][\w$]*)\)throw new Error\("Main instance is not initialized"\);return \2\}/;
  var CACHE_RE = /^narrowClient\d+$/;
  var MARK = '__NARROW';

  /* ================================================================== *
   * Part 1 - the same cache patch 1 Kill = 1 Stat Point uses, to reach
   * po().input. See that mod's header for the full explanation of why
   * this is the only reliable way in and why it's safe to reapply.
   * ================================================================== */

  var patchState = { ok: false, error: null, cacheName: null, entryUrl: null, patched: false };

  (function removeStaleBlobServiceWorkers() {
    if (!navigator.serviceWorker || !navigator.serviceWorker.getRegistrations) return;
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (reg) {
        var w = reg.active || reg.waiting || reg.installing;
        var url = w && w.scriptURL ? w.scriptURL : '';
        if (url.indexOf('blob:') === 0) reg.unregister();
      });
    }).catch(function () {});
  })();

  function patchSource(src) {
    var out = src.replace(PO_RE,
      'function $1(){if(!$2)throw new Error("Main instance is not initialized");' +
      'window.' + MARK + '=$2;return $2}');
    if (out === src) throw new Error('could not find the singleton accessor - the game may have changed');
    return out;
  }

  function findCacheName() {
    if (!window.caches) return Promise.resolve(null);
    return caches.keys().then(function (keys) {
      var hit = keys.filter(function (k) { return CACHE_RE.test(k); });
      return hit.length ? hit[hit.length - 1] : null;
    }).catch(function () { return null; });
  }

  function findEntryUrl(cache) {
    var tags = document.querySelectorAll('script[type="module"][src]');
    for (var i = 0; i < tags.length; i++) {
      if (ENTRY_RE.test(new URL(tags[i].src, location.href).pathname)) return Promise.resolve(tags[i].src);
    }
    if (!cache) return Promise.resolve(null);
    return cache.keys().then(function (reqs) {
      for (var j = 0; j < reqs.length; j++) {
        if (ENTRY_RE.test(new URL(reqs[j].url).pathname)) return reqs[j].url;
      }
      return null;
    }).catch(function () { return null; });
  }

  function readCachedOrNetwork(cache, url) {
    return cache.match(url, { ignoreSearch: true }).then(function (res) {
      if (res) return res.text();
      return fetch(url, { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      });
    });
  }

  function enablePatch() {
    var cacheRef = null, urlRef = null;
    return findCacheName().then(function (name) {
      if (!name) throw new Error('the game\'s cache is not there yet - play one round, then try again');
      patchState.cacheName = name;
      return caches.open(name);
    }).then(function (cache) {
      cacheRef = cache;
      return findEntryUrl(cache);
    }).then(function (url) {
      if (!url) throw new Error('could not find the game\'s entry bundle');
      urlRef = url;
      patchState.entryUrl = url;
      return readCachedOrNetwork(cacheRef, url);
    }).then(function (src) {
      if (src.indexOf('window.' + MARK + '=') !== -1) return 'already patched';
      var patched = patchSource(src);
      return cacheRef.put(urlRef, new Response(patched, {
        headers: { 'Content-Type': 'text/javascript; charset=utf-8' }
      })).then(function () { return 'patched'; });
    });
  }

  function disablePatch() {
    return findCacheName().then(function (name) {
      if (!name) return 'nothing to undo';
      return caches.open(name).then(function (cache) {
        return findEntryUrl(cache).then(function (url) {
          if (!url) return 'nothing to undo';
          return cache.delete(url, { ignoreSearch: true }).then(function () { return 'restored'; });
        });
      });
    });
  }

  function checkPatched() {
    return findCacheName().then(function (name) {
      patchState.cacheName = name;
      if (!name) return false;
      return caches.open(name).then(function (cache) {
        return findEntryUrl(cache).then(function (url) {
          patchState.entryUrl = url;
          if (!url) return false;
          return cache.match(url, { ignoreSearch: true }).then(function (res) {
            if (!res) return false;
            return res.text().then(function (t) { return t.indexOf('window.' + MARK + '=') !== -1; });
          });
        });
      });
    }).then(function (v) {
      patchState.patched = !!v;
      return patchState.patched;
    }).catch(function (e) {
      patchState.error = e.message;
      return false;
    });
  }

  checkPatched();

  function findGame() { return PAGE[MARK] || null; }
  function findInput() {
    var g = findGame();
    return (g && g.input && g.input.keys instanceof Map) ? g.input : null;
  }

  /* ================================================================== *
   * Part 2 - the mod proper
   * ================================================================== */

  function whenReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  whenReady(function () {
    if (PAGE.__narrowOneHotkeys) return;
    PAGE.__narrowOneHotkeys = true;

    var MOD_KEY = 'narrowone.hotkeys.v1';           // other mods' toggle keys
    var CTRL_KEY = 'narrowone.hotkeys.controls.v1';  // game-control overrides

    /** Every mod that might have registered itself on the page. */
    /**
     * Two different kinds of action share this one list:
     *
     *  - a mod toggle (no `run`) - this only writes a key into shared
     *    storage. The mod itself already has its own listener that reads
     *    that key and opens its own dialog; Hotkey Editor never touches it.
     *
     *  - a menu shortcut (has `run`) - there's no mod on the other end, so
     *    Hotkey Editor's own listener below fires `run` directly. These are
     *    native menu buttons - Shop, Settings, Maps, Squad, full screen,
     *    exiting the round - that the game itself never gave a key at all,
     *    found and clicked the same way this mod places its own button:
     *    match `.main-menu-button-container` by its text, click the button
     *    inside it. Log in / Install / Update / Quit aren't here on purpose -
     *    one-off or destructive, not something worth a stray keypress.
     */
    function clickMenuButton(labels) {
      var bar = document.querySelector('.menu-buttons-container');
      if (!bar) return false;
      var sibs = Array.prototype.slice.call(bar.querySelectorAll('.main-menu-button-container'));
      var hit = sibs.find(function (x) { return labels.indexOf((x.textContent || '').trim()) !== -1; });
      var btn = hit && hit.querySelector('button');
      if (!btn) return false;
      btn.click();
      return true;
    }

    var MOD_ACTIONS = [
      { id: 'underdog.toggle', mod: '1 Kill = 1 Stat Point', label: 'Open the stat-point manager', def: 'KeyF',
        present: function () { return !!PAGE.NarrowUnderdog; } },
      { id: 'health.toggle', mod: 'Health Number', label: 'Open Health settings', def: 'Insert',
        present: function () { return !!PAGE.NarrowHealthNumber; } },
      { id: 'crosshair.toggle', mod: 'Crosshair Customizer', label: 'Open Crosshair settings', def: null,
        present: function () { return !!PAGE.NarrowCrosshair; } },
      { id: 'targetpractice.toggle', mod: 'Target Practice', label: 'Open Target Practice', def: null,
        present: function () { return !!PAGE.NarrowTargetPractice; } },

      { id: 'menu.shop', mod: 'Game Menu', label: 'Open Shop', def: null,
        present: function () { return true; }, run: function () { clickMenuButton(['Shop']); } },
      { id: 'menu.settings', mod: 'Game Menu', label: 'Open Settings', def: null,
        present: function () { return true; }, run: function () { clickMenuButton(['Settings']); } },
      { id: 'menu.maps', mod: 'Game Menu', label: 'Open Maps', def: null,
        present: function () { return true; }, run: function () { clickMenuButton(['Maps']); } },
      { id: 'menu.squad', mod: 'Game Menu', label: 'Open Squad', def: null,
        present: function () { return true; }, run: function () { clickMenuButton(['Squad']); } },
      { id: 'menu.fullscreen', mod: 'Game Menu', label: 'Toggle Full Screen', def: null,
        present: function () { return true; },
        run: function () { clickMenuButton(['Full Screen', 'Exit Full Screen']); } },
      { id: 'menu.exitRound', mod: 'Game Menu', label: 'Exit Round', def: null,
        present: function () { return true; }, run: function () { clickMenuButton(['Exit Round']); } }
    ];

    /** Friendly names and, where known, the game's own out-of-the-box binding. */
    var CONTROL_META = {
      up:                  { label: 'Move Forward',       def: { keyCodes: ['KeyW', 'ArrowUp'] } },
      down:                { label: 'Move Backward',      def: { keyCodes: ['KeyS', 'ArrowDown'] } },
      left:                { label: 'Strafe Left',        def: { keyCodes: ['KeyA', 'ArrowLeft'] } },
      right:               { label: 'Strafe Right',       def: { keyCodes: ['KeyD', 'ArrowRight'] } },
      jump:                { label: 'Jump',                def: { keyCodes: ['Space'] } },
      fire:                { label: 'Shoot',                def: { mouseButtons: [0] } },
      toggleWeapon:        { label: 'Switch Weapon',        def: { keyCodes: ['KeyQ'] } },
      prevWeapon:          { label: 'Previous Weapon',      def: { keyCodes: [] } },
      nextWeapon:          { label: 'Next Weapon',          def: { keyCodes: [] } },
      playerList:          { label: 'Scoreboard',           def: { keyCodes: ['Tab'] } },
      chat:                { label: 'Chat',                 def: { keyCodes: ['KeyT'] } },
      toggleChatVisibility:{ label: 'Hide/Show Chat',        def: { keyCodes: [] } },
      toggleThirdPerson:   { label: 'Third Person',          def: { keyCodes: ['KeyY'] } },
      mainMenu:            { label: 'Pause Menu',            def: { keyCodes: ['Escape'] } },
      flyUp:               { label: 'Fly Up (spectating)',   def: { keyCodes: ['KeyE', 'Space'] } },
      flyDown:             { label: 'Fly Down (spectating)', def: { keyCodes: ['KeyQ', 'ShiftLeft'] } },
      playerListTouch:     { label: 'Scoreboard (touch)',    def: { keyCodes: [] } }
    };

    function prettifyId(id) {
      // camelCase fallback for anything a future build adds that isn't above.
      return id.replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/^./, function (c) { return c.toUpperCase(); });
    }
    function labelFor(id) { return (CONTROL_META[id] && CONTROL_META[id].label) || prettifyId(id); }

    // Keys that already mean something everywhere - refuse to bind over them
    // rather than let a rebind quietly break every dialog's Escape or the
    // scoreboard hold-to-view.
    var RESERVED = { Escape: 'closes every dialog', Tab: 'held to view the scoreboard' };

    function loadMap(key) {
      try {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : {};
      } catch (e) { return {}; }
    }
    function saveMap(key, map) {
      try { localStorage.setItem(key, JSON.stringify(map)); } catch (e) {}
    }

    var modMap = loadMap(MOD_KEY);
    var ctrlOverrides = loadMap(CTRL_KEY);   // { actionId: {keyCodes:[...], mouseButtons:[...]} }

    function effectiveModKey(action) {
      return Object.prototype.hasOwnProperty.call(modMap, action.id) ? modMap[action.id] : action.def;
    }
    function setModKey(actionId, code) { modMap[actionId] = code; saveMap(MOD_KEY, modMap); }
    function resetModKey(actionId) { delete modMap[actionId]; saveMap(MOD_KEY, modMap); }

    function keyLabel(code) {
      if (code === null || code === undefined) return 'Unbound';
      if (/^Key[A-Z]$/.test(code)) return code.slice(3);
      if (/^Digit[0-9]$/.test(code)) return code.slice(5);
      return code;
    }
    var MOUSE_NAMES = { 0: 'Mouse Left', 1: 'Mouse Middle', 2: 'Mouse Right', 3: 'Mouse Back', 4: 'Mouse Forward' };
    function mouseLabel(btn) { return MOUSE_NAMES[btn] || ('Mouse ' + btn); }

    /** How a binding object ({keyCodes, mouseButtons}) reads as one string. */
    function bindingLabel(b) {
      if (!b) return 'Unbound';
      var parts = [];
      (b.keyCodes || []).forEach(function (c) { parts.push(keyLabel(c)); });
      (b.mouseButtons || []).forEach(function (m) { parts.push(mouseLabel(m)); });
      return parts.length ? parts.join(' / ') : 'Unbound';
    }

    /**
     * Apply every saved override onto the live input registry, and keep
     * doing it - if the game ever rebuilds its input manager (nothing found
     * to suggest it does mid-session, but the cost of checking is one small
     * loop every half second, same as 1 Kill = 1 Stat Point holds its own
     * stats down), a saved rebind should not silently stop working.
     */
    function applyControlOverrides() {
      var input = findInput();
      if (!input) return;
      Object.keys(ctrlOverrides).forEach(function (id) {
        var binding = input.keys.get(id);
        var saved = ctrlOverrides[id];
        if (!binding || !saved) return;
        binding.keyCodes = (saved.keyCodes || []).slice();
        binding.mouseButtons = (saved.mouseButtons || []).slice();
      });
    }
    setInterval(applyControlOverrides, 200);   // cheap safety net between the events above

    /**
     * The poll above only catches a reset up to half a second late - fine
     * normally, but "my rebind stopped working" is really "it stopped
     * working and stayed that way", which a poll alone doesn't explain.
     *
     * Every one of this mod's own dialogs calls exitPointerLock() on open,
     * and closing one (or opening the game's own pause menu) is exactly the
     * moment pointer lock is re-requested - the same moment a rebind would
     * need reapplying if something along the way reset it. So this also
     * reapplies immediately on the events that actually mark that moment,
     * rather than waiting on the timer to catch up: pointer lock changing
     * either way, the tab regaining focus (alt-tab and back), and this
     * mod's own dialog closing - which happens to be the exact "open the
     * menu and close it" workaround, now automatic instead of manual.
     */
    document.addEventListener('pointerlockchange', applyControlOverrides);
    window.addEventListener('focus', applyControlOverrides);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) applyControlOverrides();
    });

    function setControlBinding(actionId, next) {
      ctrlOverrides[actionId] = next;
      saveMap(CTRL_KEY, ctrlOverrides);
      applyControlOverrides();
    }
    function resetControlBinding(actionId) {
      delete ctrlOverrides[actionId];
      saveMap(CTRL_KEY, ctrlOverrides);
      var input = findInput();
      var def = CONTROL_META[actionId] && CONTROL_META[actionId].def;
      if (input && def) {
        var binding = input.keys.get(actionId);
        if (binding) {
          binding.keyCodes = (def.keyCodes || []).slice();
          binding.mouseButtons = (def.mouseButtons || []).slice();
        }
      }
    }

    /* ================================================================ *
     * Look and feel
     * ================================================================ */

    var ICON = '<svg viewBox="0 0 101 104" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="6" y="30" width="89" height="50" rx="8" fill="none" stroke="black" stroke-width="7"/>' +
      '<rect x="20" y="44" width="12" height="12" fill="black"/>' +
      '<rect x="40" y="44" width="12" height="12" fill="black"/>' +
      '<rect x="60" y="44" width="12" height="12" fill="black"/>' +
      '<rect x="30" y="62" width="41" height="10" rx="3" fill="black"/></svg>';
    var ICON_URL = 'data:image/svg+xml,' + encodeURIComponent(ICON);

    function seed() { return Math.floor(Math.random() * 99999); }

    var CSS = [
      '#nhk-dialog .nhk-note { opacity: .6; margin: 2px 0 10px; }',
      '#nhk-dialog .nhk-row { display:flex; align-items:center; gap:10px; padding: 8px 0; ' +
        'border-bottom: 1px solid rgba(0,0,0,.12); }',
      '#nhk-dialog .nhk-row:last-child { border-bottom: none; }',
      '#nhk-dialog .nhk-labels { flex: 1 1 auto; min-width: 0; }',
      '#nhk-dialog .nhk-mod { opacity: .5; font-size: 12px; }',
      '#nhk-dialog .nhk-key { min-width: 110px; text-align: center; padding: 4px 10px; ' +
        'border-radius: 6px; background: rgba(0,0,0,.12); font-weight: 600; ' +
        'font-family: inherit; font-size: 13px; border: none; color: inherit; }',
      '#nhk-dialog .nhk-key.nhk-capturing { background: rgba(224,57,62,.25); }',
      '#nhk-dialog .nhk-warn { color: #b23; font-size: 12px; margin-top: 2px; }',
      '#nhk-dialog .nhk-links { font-size: 12px; opacity: .6; display:flex; gap: 10px; flex: 0 0 auto; }',
      '#nhk-dialog .nhk-links a { cursor: pointer; text-decoration: underline; }',
      '#nhk-dialog .nhk-setup-row { display:flex; gap:8px; margin: 6px 0 4px; }'
    ].join('\n');

    (function injectStyle() {
      if (document.getElementById('nhk-style')) return;
      var el = document.createElement('style');
      el.id = 'nhk-style';
      el.textContent = CSS;
      (document.head || document.documentElement).appendChild(el);
    })();

    function h3(t) {
      var h = document.createElement('h3');
      h.className = 'settings-group-header';
      h.textContent = t;
      return h;
    }
    function note(t) {
      var d = document.createElement('div');
      d.className = 'nhk-note';
      d.textContent = t;
      return d;
    }
    function button(label, onClick, disabled) {
      var b = document.createElement('button');
      b.className = 'dialog-button blueNight wrinkledPaper';
      b.tabIndex = -1;   // see the menu button's own comment on why
      b.style.setProperty('--wrinkled-paper-seed', seed());
      b.innerHTML = '<span>' + label + '</span>';
      if (disabled) b.disabled = true;
      else b.addEventListener('click', function (e) { e.preventDefault(); onClick(); });
      return b;
    }

    /* ================================================================ *
     * Rebind capture - a real, focused <input readonly>, not a window
     * listener. The other mods' own key checks skip firing when the
     * event's target is an input, so a rebind here can never also
     * trigger whatever key is currently being captured. Accepts both a
     * keyboard key and a mouse button, since "Shoot" is bound to a click.
     * ================================================================ */

    var activeCancel = null;   // cancels whatever capture is in progress, if any

    function beginCapture(getLabel, onPick, placeholder, keyEl) {
      var input = document.createElement('input');
      input.type = 'text';
      input.readOnly = true;
      input.className = 'nhk-key nhk-capturing';
      input.value = placeholder;
      keyEl.replaceWith(input);
      input.focus();

      var done = false;
      function finish() {
        if (done) return;
        done = true;
        input.removeEventListener('keydown', onKey);
        input.removeEventListener('blur', onBlur);
        input.removeEventListener('mousedown', onMouse);
        input.removeEventListener('contextmenu', onContextMenu);
        if (activeCancel === finish) activeCancel = null;
        refresh();
      }
      function onBlur() { finish(); }
      function onContextMenu(e) { e.preventDefault(); }

      function onKey(e) {
        e.preventDefault();
        e.stopPropagation();
        if (e.code === 'Escape') { finish(); return; }
        // Shift alone is a real binding here - the game's own default for
        // Fly Down is ShiftLeft - so modifier taps are accepted like any
        // other key, not treated as a wait-for-something-else combo.
        if (RESERVED[e.code]) {
          input.value = keyLabel(e.code) + ' is ' + RESERVED[e.code] + ' - pick another';
          return;
        }
        onPick({ type: 'key', code: e.code });
        finish();
      }

      function onMouse(e) {
        e.preventDefault();
        e.stopPropagation();
        onPick({ type: 'mouse', button: e.button });
        finish();
      }

      activeCancel = finish;
      input.addEventListener('keydown', onKey);
      input.addEventListener('blur', onBlur);
      input.addEventListener('mousedown', onMouse);
      input.addEventListener('contextmenu', onContextMenu);
    }

    /* ================================================================ *
     * Rows
     * ================================================================ */

    var dialogEl = null, curtainEl = null, bodyEl = null;
    function refresh() {
      if (!bodyEl) return;
      fill(bodyEl);
      guardFocus(bodyEl);
    }

    // Never a Tab-navigation stop - the game silently drops every keydown
    // while any BUTTON/INPUT/SELECT has focus (its own inputHasFocus()
    // check). fill() rebuilds every row from scratch on nearly every
    // interaction, so this has to run every time, not just once.
    function guardFocus(root) {
      root.querySelectorAll('button, input, select').forEach(function (el) { el.tabIndex = -1; });
    }

    function modConflictsFor(action, code) {
      if (code === null) return [];
      var labels = MOD_ACTIONS.filter(function (a) {
        return a.present() && a.id !== action.id && effectiveModKey(a) === code;
      }).map(function (a) { return a.label; });

      // Also flag a clash against a real game control, so "Open Shop" bound
      // to the same key as "Switch Weapon" doesn't come as a surprise.
      var input = findInput();
      if (input) {
        input.keys.forEach(function (b, id) {
          if ((b.keyCodes || []).indexOf(code) !== -1) labels.push(labelFor(id));
        });
      }
      return labels;
    }

    function modActionRow(action) {
      var row = document.createElement('div');
      row.className = 'nhk-row';

      var labels = document.createElement('div');
      labels.className = 'nhk-labels';
      var name = document.createElement('div');
      name.textContent = action.label;
      labels.appendChild(name);
      var mod = document.createElement('div');
      mod.className = 'nhk-mod';
      mod.textContent = action.mod;
      labels.appendChild(mod);
      row.appendChild(labels);

      var code = effectiveModKey(action);
      var keyEl = document.createElement('button');
      keyEl.className = 'nhk-key';
      keyEl.type = 'button';
      keyEl.tabIndex = -1;   // see the menu button's own comment on why
      keyEl.textContent = keyLabel(code);
      keyEl.title = 'Click to rebind';
      keyEl.addEventListener('click', function () {
        beginCapture(keyLabel, function (picked) {
          if (picked.type === 'key') setModKey(action.id, picked.code);
          // mod toggles don't take a mouse button - a stray click just cancels.
        }, 'Press a key…', keyEl);
      });
      row.appendChild(keyEl);

      var links = document.createElement('div');
      links.className = 'nhk-links';
      if (code !== null) {
        var clearLink = document.createElement('a');
        clearLink.textContent = 'Unbind';
        clearLink.addEventListener('click', function () { setModKey(action.id, null); refresh(); });
        links.appendChild(clearLink);
      }
      if (modMap.hasOwnProperty(action.id)) {
        var resetLink = document.createElement('a');
        resetLink.textContent = 'Reset';
        resetLink.addEventListener('click', function () { resetModKey(action.id); refresh(); });
        links.appendChild(resetLink);
      }
      row.appendChild(links);

      return wrapWithWarning(row, modConflictsFor(action, code));
    }

    function controlConflictsFor(actionId, b) {
      if (!b) return [];
      var labels = [];
      var input = findInput();
      if (input) {
        input.keys.forEach(function (other, otherId) {
          if (otherId === actionId) return;
          var shared = (b.keyCodes || []).some(function (c) { return (other.keyCodes || []).includes(c); }) ||
            (b.mouseButtons || []).some(function (m) { return (other.mouseButtons || []).includes(m); });
          if (shared) labels.push(labelFor(otherId));
        });
      }
      // The reverse of modConflictsFor's own game-control check, so a clash
      // shows up on whichever row you happen to be looking at.
      (b.keyCodes || []).forEach(function (code) {
        MOD_ACTIONS.forEach(function (a) {
          if (a.present() && effectiveModKey(a) === code) labels.push(a.label);
        });
      });
      return labels;
    }

    function controlActionRow(actionId, binding) {
      var row = document.createElement('div');
      row.className = 'nhk-row';

      var labels = document.createElement('div');
      labels.className = 'nhk-labels';
      var name = document.createElement('div');
      name.textContent = labelFor(actionId);
      labels.appendChild(name);
      var idEl = document.createElement('div');
      idEl.className = 'nhk-mod';
      idEl.textContent = actionId;
      labels.appendChild(idEl);
      row.appendChild(labels);

      var keyEl = document.createElement('button');
      keyEl.className = 'nhk-key';
      keyEl.type = 'button';
      keyEl.tabIndex = -1;   // see the menu button's own comment on why
      keyEl.textContent = bindingLabel(binding);
      keyEl.title = 'Click to rebind - a key or a mouse button';
      keyEl.addEventListener('click', function () {
        beginCapture(bindingLabel, function (picked) {
          if (picked.type === 'key') {
            setControlBinding(actionId, { keyCodes: [picked.code], mouseButtons: [] });
          } else {
            setControlBinding(actionId, { keyCodes: [], mouseButtons: [picked.button] });
          }
        }, 'Press a key or click…', keyEl);
      });
      row.appendChild(keyEl);

      var links = document.createElement('div');
      links.className = 'nhk-links';
      var hasAny = (binding.keyCodes || []).length || (binding.mouseButtons || []).length;
      if (hasAny) {
        var clearLink = document.createElement('a');
        clearLink.textContent = 'Unbind';
        clearLink.addEventListener('click', function () {
          setControlBinding(actionId, { keyCodes: [], mouseButtons: [] });
          refresh();
        });
        links.appendChild(clearLink);
      }
      if (ctrlOverrides.hasOwnProperty(actionId) && CONTROL_META[actionId]) {
        var resetLink = document.createElement('a');
        resetLink.textContent = 'Reset';
        resetLink.addEventListener('click', function () { resetControlBinding(actionId); refresh(); });
        links.appendChild(resetLink);
      }
      row.appendChild(links);

      return wrapWithWarning(row, controlConflictsFor(actionId, binding));
    }

    function wrapWithWarning(row, conflictLabels) {
      var outer = document.createElement('div');
      outer.style.cssText = 'display:flex; flex-wrap:wrap; width:100%;';
      outer.appendChild(row);
      if (conflictLabels.length) {
        var wrap = document.createElement('div');
        wrap.style.cssText = 'flex-basis:100%;';
        var warn = document.createElement('div');
        warn.className = 'nhk-warn';
        warn.textContent = 'Also bound to ' + conflictLabels.join(', ') + ' - only one will actually fire.';
        wrap.appendChild(warn);
        outer.appendChild(wrap);
      }
      return outer;
    }

    function fill(inner) {
      inner.textContent = '';

      inner.appendChild(h3('Game Controls'));

      var input = findInput();
      if (!input) {
        if (patchState.patched) {
          inner.appendChild(note('The patched game is in place but has not loaded yet. ' +
            'Reload the page (Ctrl+Shift+R) and this will connect.'));
        } else {
          inner.appendChild(note(
            'Rebinding the game\'s own controls needs one-off set-up, the same patch ' +
            '1 Kill = 1 Stat Point uses to reach your stats. It writes a patched copy of the ' +
            'game into the game\'s own cache. The page reloads once, then it is connected every time.' +
            (patchState.cacheName ? '' : '\n\nThe cache is not there yet - load a match once, then come back.')));
        }
        if (patchState.error) inner.appendChild(note('Last attempt: ' + patchState.error));

        var setupRow = document.createElement('div');
        setupRow.className = 'nhk-setup-row';
        setupRow.appendChild(button(patchState.patched ? 'Reload now' : 'Enable', function () {
          if (patchState.patched) { location.reload(); return; }
          enablePatch().then(function () { location.reload(); }).catch(function (e) {
            patchState.error = e.message;
            refresh();
          });
        }));
        setupRow.appendChild(button('Undo', function () {
          disablePatch().then(function () { location.reload(); }).catch(function (e) {
            patchState.error = e.message;
            refresh();
          });
        }));
        inner.appendChild(setupRow);
        inner.appendChild(note('Undo removes the patched copy and puts the untouched game back.'));
      } else {
        inner.appendChild(note('Click a key to rebind it - a keyboard key or a mouse button both work. ' +
          'Escape cancels a rebind in progress.'));
        var ids = Array.from(input.keys.keys());
        ids.forEach(function (id) {
          inner.appendChild(controlActionRow(id, input.keys.get(id)));
        });
      }

      var available = MOD_ACTIONS.filter(function (a) { return a.present(); });
      if (available.length) {
        inner.appendChild(h3('Other Hotkeys'));
        inner.appendChild(note('Menu shortcuts (Shop, Settings, Maps, ...) are unbound until you ' +
          'assign a key - none of these had a default before.'));
        available.forEach(function (a) { inner.appendChild(modActionRow(a)); });
      }

      var resetAllRow = document.createElement('div');
      resetAllRow.style.cssText = 'display:flex; gap:8px; margin-top:10px;';
      resetAllRow.appendChild(button('Reset everything to defaults', function () {
        modMap = {};
        saveMap(MOD_KEY, modMap);
        Object.keys(ctrlOverrides).forEach(function (id) { resetControlBinding(id); });
        ctrlOverrides = {};
        saveMap(CTRL_KEY, ctrlOverrides);
        refresh();
      }));
      inner.appendChild(resetAllRow);
    }

    function closeDialog() {
      bodyEl = null;
      activeCancel = null;
      if (dialogEl && dialogEl.isConnected) dialogEl.remove();
      if (curtainEl && curtainEl.isConnected) curtainEl.remove();
      dialogEl = null; curtainEl = null;
      applyControlOverrides();   // don't wait for the next poll or pointer-lock event
    }

    function openDialog() {
      if (dialogEl && dialogEl.isConnected) return;
      var host = document.getElementById('gameWrapper') || document.body;

      curtainEl = document.createElement('div');
      curtainEl.className = 'dialogCurtain fullScreen';
      curtainEl.style.zIndex = '99';
      curtainEl.addEventListener('click', closeDialog);
      host.appendChild(curtainEl);

      dialogEl = document.createElement('div');
      dialogEl.className = 'dialog wrinkledPaper';
      dialogEl.id = 'nhk-dialog';
      dialogEl.style.setProperty('--wrinkled-paper-seed', seed());
      dialogEl.style.zIndex = '100';

      var title = document.createElement('h2');
      title.className = 'dialogTitle blueNight';
      title.textContent = 'Hotkeys';
      dialogEl.appendChild(title);

      var list = document.createElement('div');
      list.className = 'settings-list';
      bodyEl = document.createElement('div');
      fill(bodyEl);
      guardFocus(bodyEl);
      list.appendChild(bodyEl);
      dialogEl.appendChild(list);

      var btns = document.createElement('div');
      btns.className = 'dialogButtonsContainer';
      btns.appendChild(button('Done', closeDialog));
      dialogEl.appendChild(btns);

      ['keydown', 'keyup', 'keypress'].forEach(function (t) {
        dialogEl.addEventListener(t, function (e) { e.stopPropagation(); });
      });
      if (document.pointerLockElement) document.exitPointerLock();

      host.appendChild(dialogEl);
    }

    /* ================================================================ *
     * Menu button
     * ================================================================ */

    function injectMenuButton() {
      var bar = document.querySelector('.menu-buttons-container');
      if (!bar || bar.querySelector('#nhk-menu-button')) return;

      var c = document.createElement('div');
      c.className = 'main-menu-button-container';
      c.id = 'nhk-menu-button';

      var b = document.createElement('button');
      b.className = 'wrinkledPaper main-menu-button';
      b.setAttribute('aria-label', 'Hotkeys');
      // Never a Tab-navigation stop - the game silently drops every keydown
      // while any BUTTON/INPUT/SELECT has focus (its own inputHasFocus()
      // check), so this button must never be where Tab's default focus
      // cycling can land while you're actually playing. This is almost
      // certainly what "my rebind stopped working" actually was.
      b.tabIndex = -1;
      b.style.setProperty('--wrinkled-paper-seed', seed());

      var img = document.createElement('div');
      img.className = 'buttonImage';
      img.style.backgroundImage = 'url("' + ICON_URL + '")';
      img.style.backgroundSize = '90%';
      b.appendChild(img);

      var l = document.createElement('div');
      l.className = 'main-menu-button-text whiteBigText blueNight';
      l.setAttribute('aria-hidden', 'true');
      l.textContent = 'Hotkeys';

      c.appendChild(b); c.appendChild(l);
      b.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (dialogEl && dialogEl.isConnected) closeDialog(); else openDialog();
      });

      var sibs = Array.prototype.slice.call(bar.querySelectorAll('.main-menu-button-container'));
      var anchor = sibs.filter(function (x) {
        var t = (x.textContent || '').trim();
        return t === 'Crosshair' || t === 'Health' || t === 'Settings' ||
               t === '1 Kill = 1 Stat Point' || t === 'Target Practice';
      }).pop();
      if (anchor && anchor.nextSibling) bar.insertBefore(c, anchor.nextSibling);
      else bar.appendChild(c);
    }

    injectMenuButton();
    setInterval(injectMenuButton, 1000);

    window.addEventListener('keydown', function (e) {
      if (e.code !== 'Escape') return;
      if (activeCancel) {
        e.preventDefault(); e.stopPropagation();
        activeCancel();          // cancel the rebind, leave the dialog open
        return;
      }
      if (dialogEl && dialogEl.isConnected) {
        e.preventDefault(); e.stopPropagation(); closeDialog();
      }
    }, true);

    /** Skip a shortcut while you're typing somewhere - chat included. */
    function typingElsewhere(e) {
      var t = e.target;
      if (!t || !t.tagName) return false;
      var tag = t.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || t.isContentEditable;
    }

    // Fires the menu-shortcut actions (Shop, Settings, Maps, ...) - the
    // mod-toggle actions need nothing here, each of those mods already
    // listens for its own key.
    window.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (typingElsewhere(e)) return;
      MOD_ACTIONS.forEach(function (a) {
        if (!a.run || !a.present()) return;
        var key = effectiveModKey(a);
        if (key !== null && e.code === key) {
          e.preventDefault(); e.stopPropagation();
          a.run();
        }
      });
    }, true);

    PAGE.NarrowHotkeys = window.NarrowHotkeys = {
      open: openDialog,
      get controls() { var i = findInput(); return i ? i.keys : null; },
      get modMap() { return modMap; },
      get controlOverrides() { return ctrlOverrides; },
      setMod: setModKey,
      resetMod: resetModKey,
      setControl: setControlBinding,
      resetControl: resetControlBinding,
      patchState: patchState,
      enable: enablePatch,
      disable: disablePatch,
      check: checkPatched
    };

    console.log('[Hotkey Editor] ready. Patched copy in cache:', patchState.patched);
  });
})();
