// ==UserScript==
// @name         Hotkey Editor
// @namespace    narrowone-hotkeys
// @version      1.0.0
// @description  Rebind the keys the other Narrow One mods use to open their menus - or turn any of them off. Adds a Hotkeys tab to the main menu.
// @author       Frogwagon
// @match        https://narrow.one/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * Hotkey Editor  -  Narrow One
 * -----------------------------
 * The other mods each check one shared spot in localStorage for their own
 * toggle key, falling back to their own default if nothing is set there.
 * This is the one place that writes to it.
 *
 * There is no message-passing between userscripts here on purpose - each mod
 * reads the shared key for itself, at the moment it needs it, rather than
 * trusting some cross-script call that would depend on load order and on
 * every mod actually being installed. This one only has to agree with the
 * others on a key name and a tiny JSON shape:
 *
 *   localStorage['narrowone.hotkeys.v1'] = { "<actionId>": "<KeyboardEvent.code>" | null }
 *
 * Missing entry -> that mod's own built-in default. Explicit null -> off.
 *
 * Rebinding captures a real, focused <input readonly> rather than a window-
 * level listener. That matters: the other mods' own key checks skip firing
 * when the event's target is an input, exactly so a rebind here can't also
 * trigger whatever they're currently bound to.
 */

(function () {
  'use strict';
  if (window.__narrowOneHotkeys) return;
  window.__narrowOneHotkeys = true;

  var STORE_KEY = 'narrowone.hotkeys.v1';

  /** Every rebindable action any installed mod might expose. */
  var ACTIONS = [
    { id: 'underdog.toggle',       mod: '1 Kill = 1 Stat Point', label: 'Open the stat-point manager', def: 'KeyF' },
    { id: 'health.toggle',         mod: 'Health Number',         label: 'Open Health settings',        def: 'Insert' },
    { id: 'crosshair.toggle',      mod: 'Crosshair Customizer',  label: 'Open Crosshair settings',     def: null },
    { id: 'targetpractice.toggle', mod: 'Target Practice',       label: 'Open Target Practice',        def: null }
  ];

  // Keys that already mean something everywhere - refuse to bind over them
  // rather than let a rebind quietly break every dialog's Escape or the
  // game's own scoreboard.
  var RESERVED = { Escape: 'closes every dialog', Tab: 'the scoreboard' };

  function loadMap() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function saveMap(map) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(map)); } catch (e) {}
  }

  var map = loadMap();

  /** Missing key -> the action's own default. Explicit null -> off. */
  function effective(action) {
    return Object.prototype.hasOwnProperty.call(map, action.id) ? map[action.id] : action.def;
  }

  function setKey(actionId, code) {
    map[actionId] = code;
    saveMap(map);
  }

  function resetKey(actionId) {
    delete map[actionId];
    saveMap(map);
  }

  function keyLabel(code) {
    if (code === null || code === undefined) return 'Unbound';
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    return code;
  }

  /* ================================================================ *
   * Look and feel - same building blocks the other mods use.
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
    '#nhk-dialog .nhk-key { min-width: 90px; text-align: center; padding: 4px 10px; ' +
      'border-radius: 6px; background: rgba(0,0,0,.12); font-weight: 600; ' +
      'font-family: inherit; font-size: inherit; border: none; color: inherit; }',
    '#nhk-dialog .nhk-key.nhk-capturing { background: rgba(224,57,62,.25); }',
    '#nhk-dialog .nhk-warn { color: #b23; font-size: 12px; margin-top: 2px; }',
    '#nhk-dialog .nhk-links { font-size: 12px; opacity: .6; display:flex; gap: 10px; }',
    '#nhk-dialog .nhk-links a { cursor: pointer; text-decoration: underline; }'
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
    b.style.setProperty('--wrinkled-paper-seed', seed());
    b.innerHTML = '<span>' + label + '</span>';
    if (disabled) b.disabled = true;
    else b.addEventListener('click', function (e) { e.preventDefault(); onClick(); });
    return b;
  }

  /* ================================================================ *
   * Rows
   * ================================================================ */

  var dialogEl = null, curtainEl = null, bodyEl = null;
  function refresh() { if (bodyEl) fill(bodyEl); }

  /**
   * Set while a rebind is in progress; cancels it.
   *
   * The dialog's own Escape-to-close listener sits on `window` in the
   * capture phase, which always runs before a bubble-phase listener on a
   * descendant input ever sees the event - so without this, Escape during
   * a rebind would close the whole dialog instead of just cancelling the
   * capture. The global listener below checks this first.
   */
  var activeCancel = null;

  /** Every other action currently bound to this same code, for the warning. */
  function conflictsFor(action, code) {
    if (code === null) return [];
    return ACTIONS.filter(function (a) {
      return a.id !== action.id && effective(a) === code;
    });
  }

  function actionRow(action) {
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

    var code = effective(action);
    var keyEl = document.createElement('button');
    keyEl.className = 'nhk-key';
    keyEl.type = 'button';
    keyEl.textContent = keyLabel(code);
    keyEl.title = 'Click to rebind';
    keyEl.addEventListener('click', function () { beginCapture(action, keyEl, row); });
    row.appendChild(keyEl);

    var links = document.createElement('div');
    links.className = 'nhk-links';
    if (code !== null) {
      var clearLink = document.createElement('a');
      clearLink.textContent = 'Unbind';
      clearLink.addEventListener('click', function () {
        setKey(action.id, null);
        refresh();
      });
      links.appendChild(clearLink);
    }
    if (map.hasOwnProperty(action.id)) {
      var resetLink = document.createElement('a');
      resetLink.textContent = 'Reset';
      resetLink.addEventListener('click', function () {
        resetKey(action.id);
        refresh();
      });
      links.appendChild(resetLink);
    }
    row.appendChild(links);

    var wrap = document.createElement('div');
    wrap.style.cssText = 'flex-basis:100%;';
    var conflicts = conflictsFor(action, code);
    if (conflicts.length) {
      var warn = document.createElement('div');
      warn.className = 'nhk-warn';
      warn.textContent = 'Also bound to ' + conflicts.map(function (c) { return c.label; }).join(', ') +
        ' - only one will actually fire.';
      wrap.appendChild(warn);
    }

    var outer = document.createElement('div');
    outer.style.cssText = 'display:flex; flex-wrap:wrap; width:100%;';
    outer.appendChild(row);
    if (wrap.childNodes.length) outer.appendChild(wrap);
    return outer;
  }

  /**
   * Turn the key badge into a real, focused <input readonly> and listen on
   * it directly - not on window. The other mods' own listeners check
   * e.target and skip while it's an input, so this can never also trigger
   * whatever key is being captured.
   */
  function beginCapture(action, keyEl, row) {
    var input = document.createElement('input');
    input.type = 'text';
    input.readOnly = true;
    input.className = 'nhk-key nhk-capturing';
    input.value = 'Press a key…';
    keyEl.replaceWith(input);
    input.focus();

    var done = false;
    function finish() {
      if (done) return;
      done = true;
      input.removeEventListener('keydown', onKey);
      input.removeEventListener('blur', onBlur);
      if (activeCancel === finish) activeCancel = null;
      refresh();
    }
    function onBlur() { finish(); }
    activeCancel = finish;

    function onKey(e) {
      e.preventDefault();
      e.stopPropagation();

      if (e.code === 'Escape') { finish(); return; }

      // Pure modifier taps don't count as a key - keep waiting.
      if (/^(Shift|Control|Alt|Meta)(Left|Right)?$/.test(e.code)) return;

      if (RESERVED[e.code]) {
        input.value = e.code.replace(/^Key|^Digit/, '') + ' is ' + RESERVED[e.code] + ' - pick another';
        return;
      }

      setKey(action.id, e.code);
      finish();
    }

    input.addEventListener('keydown', onKey);
    input.addEventListener('blur', onBlur);
  }

  function fill(inner) {
    inner.textContent = '';

    inner.appendChild(h3('Hotkeys'));
    inner.appendChild(note('Click a key to rebind it. Escape cancels a rebind in progress. ' +
      'Only actions from mods you actually have installed do anything - the others are just ' +
      'idle settings.'));

    ACTIONS.forEach(function (a) { inner.appendChild(actionRow(a)); });

    var resetAllRow = document.createElement('div');
    resetAllRow.style.cssText = 'display:flex; gap:8px; margin-top:10px;';
    resetAllRow.appendChild(button('Reset all to defaults', function () {
      map = {};
      saveMap(map);
      refresh();
    }));
    inner.appendChild(resetAllRow);
  }

  function closeDialog() {
    bodyEl = null;
    activeCancel = null;   // whatever it referenced is leaving the DOM
    if (dialogEl && dialogEl.isConnected) dialogEl.remove();
    if (curtainEl && curtainEl.isConnected) curtainEl.remove();
    dialogEl = null; curtainEl = null;
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
      activeCancel();         // cancel the rebind, leave the dialog open
      return;
    }
    if (dialogEl && dialogEl.isConnected) {
      e.preventDefault(); e.stopPropagation(); closeDialog();
    }
  }, true);

  window.NarrowHotkeys = {
    open: openDialog,
    actions: ACTIONS,
    get map() { return loadMap(); },
    set: setKey,
    reset: resetKey
  };

  console.log('[Hotkey Editor] ready.');
})();
