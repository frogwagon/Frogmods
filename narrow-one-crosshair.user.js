// ==UserScript==
// @name         Crosshair Customizer
// @namespace    crosshair-customizer
// @version      0.10.0
// @description  Stack multiple crosshairs at once - the game's own seven styles plus dot, cross, circle, square, X and T - each with its own colour, size, thickness, gap, opacity and bow-spread response. Adds a Crosshair tab to the main menu.
// @author       Frogwagon
// @match        https://narrow.one/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * Crosshair Customizer  -  Narrow One
 * -----------------------------------
 * Build a crosshair out of layers. Add as many as you like and they draw on top
 * of each other, so you can have a dot inside a circle inside a cross.
 *
 * Why layers instead of restyling the game's crosshair
 * ---------------------------------------------------
 * The game's crosshair is three <div class="crosshair-line"> elements whose
 * `transform` is rewritten every frame to animate bow spread. Touching those
 * means fighting the game for control, and there are only ever three of them.
 *
 * So this mod leaves them alone and appends its own layers to the same parent:
 *
 *   <div class="crosshair-container" style="--line-color: #fff; --outline-color: #000">
 *     <svg class="flagReturnProgressContainer">...</svg>
 *     <div class="crosshair-line"></div>   x3   <- the game's, untouched
 *     <div id="noch-layers">...</div>           <- ours
 *   </div>
 *
 * That parent is `position:absolute; left:50%; top:50%` with a 0x0 box, so its
 * origin sits exactly at screen centre - a child at left:0/top:0 pulled back by
 * half its own size lands dead centre. It is also the element the game shows and
 * hides as you enter and leave a match, so our layers inherit that for free and
 * never appear over the menu.
 *
 * The layers only draw inside a match, because the game hides
 * .crosshair-container in the menu - so the dialog carries a live preview of
 * the stack, otherwise you would be editing blind from the menu.
 *
 * The game's Crosshair group is stripped out of its own Settings dialog, so
 * there is exactly one place to configure a crosshair, and its built-in
 * crosshair can be switched off here.
 *
 * Layers can follow bow spread - the game's Accuracy Offset behaviour - by
 * reading the live spread straight off the game's own crosshair transform.
 * See the spread section below.
 */

(function () {
  'use strict';
  if (window.__narrowOneCrosshair) return;
  window.__narrowOneCrosshair = true;

  var STORE_KEY = 'narrowone.crosshair.v1';
  var CONTAINER = '.crosshair-container';

  /**
   * The hotkey Hotkey Editor rebinds this to. A shared, tiny read - each mod
   * checks it itself rather than trusting a message from another script, so
   * this works regardless of what order Tampermonkey happens to run them in.
   *
   * Missing entry: use the default. Explicit null: unbound (this mod's
   * default - it only ever had the menu button until Hotkey Editor could
   * assign it one). Anything else: the code of the key it was rebound to.
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

  /** Skip a hotkey while you're typing - a preset/layer name field included. */
  function typingInDialog(e) {
    var t = e.target;
    if (!t || !t.tagName) return false;
    var tag = t.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || t.isContentEditable;
  }

  /* ================================================================== *
   * Settings
   * ================================================================== */

  /**
   * The game's own crosshair styles, rebuilt as layer shapes.
   *
   * Each built-in style is just a set of line rotations. Straight from the
   * game's crosshair builder:
   *
   *   if ("three" == t) e = [30, 150, 270];
   *   else if ("three-low" == t) e = [0, 90, 180];
   *   else if ("three-extra-low" == t) e = [60, 90, 120];
   *   else if ("four" == t) for (let t = 45; t < 360; t += 90) e.push(t);
   *   else if ("four-flat" == t) e = [-30, 30, 150, 210];
   *   else if ("four-sharp" == t) e = [-60, 60, 120, 240];
   *   else if ("six" == t) for (let t = 30; t < 360; t += 60) e.push(t);
   *
   * Each rotation becomes a .crosshair-line: a 15x2 rounded bar with a 2px
   * outline, pushed out from centre by the accuracy offset. Rebuilding them
   * here means they preview, stack and recolour like any other layer, and can
   * be combined with a dot or a ring.
   *
   * Names are the game's own, from its Style dropdown.
   */
  var VANILLA_ANGLES = {
    tri:       [30, 150, 270],
    quad:      [45, 135, 225, 315],
    sharpQuad: [-60, 60, 120, 240],
    horizon:   [0, 90, 180],
    whiskers:  [-30, 30, 150, 210],
    soulPatch: [60, 90, 120],
    wallmart:  [30, 90, 150, 210, 270, 330]
  };

  var TYPES = [
    ['dot', 'Dot'], ['circle', 'Circle'], ['square', 'Square'],
    ['cross', 'Cross'], ['x', 'X'], ['t', 'T shape'],
    // the game's own styles
    ['tri', 'Tri'], ['quad', 'Quad'], ['sharpQuad', 'Sharp Quad'],
    ['horizon', 'Horizon'], ['whiskers', 'Whiskers'],
    ['soulPatch', 'Soul patch'], ['wallmart', 'Wallmart']
  ];

  /* Shapes made of arms radiating from the centre - these use gap and grow with
     bow spread. Everything the game ships is one of these. */
  function isArmed(type) {
    return type === 'cross' || type === 'x' || type === 't' || !!VANILLA_ANGLES[type];
  }
  function isRing(type) { return type === 'circle' || type === 'square'; }

  /* Which controls make sense for which shape. */
  function usesThickness(type) { return type !== 'dot'; }
  function usesGap(type) { return isArmed(type); }

  function newLayer(type) {
    type = type || 'dot';
    var vanilla = !!VANILLA_ANGLES[type];
    return {
      enabled: true,
      type: type,
      // A rebuilt game style defaults to exactly what the game draws:
      // white 15x2 bars, 2px black outline, 7px out from centre.
      color: vanilla ? '#ffffff' : '#00ff88',
      outlineColor: '#000000',
      outlineWidth: 2,
      size: type === 'dot' ? 4 : (vanilla ? 15 : 10),
      thickness: 2,
      gap: vanilla ? 7 : 6,
      opacity: 100,
      // Breathe with the bow the way the built-in crosshair does.
      followSpread: true,
      spreadScale: 100
    };
  }

  var DEFAULTS = {
    vanillaOff: false,   // hide the game's built-in crosshair
    layers: [newLayer('dot')],
    presets: []          // { name, layers } - saved stacks you can name and reload
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var cfg = load();

  function load() {
    var out = clone(DEFAULTS);
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        if (typeof saved.vanillaOff === 'boolean') out.vanillaOff = saved.vanillaOff;
        if (Array.isArray(saved.presets)) {
          out.presets = saved.presets.map(function (p, i) {
            return {
              name: (p && typeof p.name === 'string') ? p.name : 'Preset ' + (i + 1),
              // Same defensive merge as live layers, so an old preset still loads.
              layers: (p && Array.isArray(p.layers) ? p.layers : []).map(function (s) {
                var base = newLayer(s && s.type);
                Object.keys(base).forEach(function (k) {
                  if (s && s[k] !== undefined) base[k] = s[k];
                });
                return base;
              })
            };
          });
        }
        if (Array.isArray(saved.layers)) {
          // Merge each saved layer onto a fresh default so a layer written by an
          // older version never arrives missing a field.
          out.layers = saved.layers.map(function (s) {
            var base = newLayer(s && s.type);
            Object.keys(base).forEach(function (k) {
              if (s && s[k] !== undefined) base[k] = s[k];
            });
            return base;
          });
        }
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

  var STYLE_ID = 'noch-style';

  var CSS = [
    /* The layers sit at the crosshair container's origin, which is screen
       centre, and must never eat clicks. */
    '#noch-layers { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; }',
    /* Hiding the game's crosshair must not hide our layers, so target only its
       own three lines - our layers live in #noch-layers alongside them. */
    'body.noch-hide-vanilla .crosshair-container > .crosshair-line { display: none !important; }',
    '.noch-layer {',
    '  position: absolute; left: 0; top: 0;',
    '  transform: translate(-50%, -50%);',
    '  pointer-events: none;',
    '  line-height: 0;',
    '}',
    /* The game's own `.settings-list` already has overflow/max-height, and its
       `.settings-item-text` is `display:inline; width:200px` - so only add what
       is genuinely missing rather than overriding either. */
    '#noch-dialog .noch-empty { opacity: .6; padding: 14px 0 18px; width: 260px; }',
    '#noch-dialog .noch-layer-head {',
    '  display: flex; align-items: center; justify-content: space-between; gap: 12px;',
    '}',
    '#noch-dialog .noch-remove {',
    '  margin: 0; padding: 2px 12px; font-size: 16px; flex: 0 0 auto;',
    '}',
    '#noch-dialog .noch-add { margin-top: 4px; }',
    '#noch-dialog .noch-preview {',
    '  background: rgba(0,0,0,.35); border-radius: 6px;',
    '  height: 120px; margin: 6px 0 4px; position: relative; overflow: hidden;',
    '}',
    '#noch-dialog .noch-preview-inner { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }',

    /* stacking list */
    '#noch-dialog .noch-order-note { opacity: .6; margin: 2px 0 8px; }',
    '#noch-dialog .noch-order-row { display: flex; align-items: center; gap: 10px; }',
    '#noch-dialog .noch-thumb {',
    '  width: 30px; height: 30px; flex: 0 0 auto; border-radius: 4px;',
    '  background: rgba(0,0,0,.3);',
    '  display: flex; align-items: center; justify-content: center; overflow: hidden;',
    '}',
    '#noch-dialog .noch-thumb svg { max-width: 100%; max-height: 100%; }',
    '#noch-dialog .noch-order-name { flex: 1 1 auto; }',
    '#noch-dialog .noch-order-btns { display: flex; gap: 6px; flex: 0 0 auto; }',
    '#noch-dialog .noch-order-btn { margin: 0; padding: 0 10px; min-width: 0; }',
    '#noch-dialog .noch-order-btn:disabled { opacity: .3; cursor: default; }',

    /* presets */
    /* nowrap and width:auto override the game's .settings-item wrapping and the
       fixed width on .dialog-text-input, which otherwise pushed the buttons
       onto a second line. */
    '#noch-dialog .noch-preset-row { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; }',
    '#noch-dialog .noch-preset-thumb {',
    '  width: 36px; height: 36px; flex: 0 0 auto; border-radius: 4px;',
    '  background: rgba(0,0,0,.3); position: relative; overflow: hidden;',
    '}',
    /* the layers centre themselves, so shrink the whole stack about that point */
    '#noch-dialog .noch-preset-thumb-inner {',
    '  position: absolute; left: 50%; top: 50%; width: 0; height: 0; transform: scale(.38);',
    '}',
    '#noch-dialog .noch-preset-name { flex: 1 1 40px; width: auto; min-width: 0; margin: 0; }',
    '#noch-dialog .noch-preset-btn { margin: 0; padding: 0 10px; min-width: 0; }',
    '#noch-dialog .noch-preset-add { margin: 8px 0 4px; }'
  ].join('\n');

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = CSS;
    (document.head || document.documentElement).appendChild(el);
  }

  /* ================================================================== *
   * Drawing the layers
   * ================================================================== */

  /**
   * Build one layer as an SVG. Each shape is drawn twice: a fatter pass in the
   * outline colour underneath, then the real colour on top. Round caps, to match
   * the game's own crosshair lines (which carry border-radius: 10px).
   */
  function layerSvg(L) {
    var th = Math.max(1, L.thickness);
    var ow = Math.max(0, L.outlineWidth);
    // Bow spread pushes the arms of a cross outward, and grows the radius of a
    // ring or box. A dot has nothing to spread, so it stays put - same as the
    // centre of the game's own crosshair.
    var spread = layerSpread(L);
    var ring = isRing(L.type);
    var armed = isArmed(L.type);
    var size = Math.max(1, L.size + (ring ? spread * 2 : 0));
    var gap = Math.max(0, L.gap + (armed ? spread : 0));

    // How far from the centre the shape reaches, plus room for the outline.
    var reach;
    if (L.type === 'dot') reach = size / 2 + ow;
    else if (L.type === 'circle' || L.type === 'square') reach = size / 2 + th / 2 + ow;
    else reach = gap + size + th / 2 + ow;

    var half = Math.ceil(reach) + 2;
    var box = half * 2;
    var c = half;

    function twoPass(inner) {
      var out = '';
      if (ow > 0) {
        out += '<g fill="none" stroke="' + L.outlineColor + '" stroke-width="' + (th + ow * 2) +
               '" stroke-linecap="round" stroke-linejoin="round">' + inner + '</g>';
      }
      out += '<g fill="none" stroke="' + L.color + '" stroke-width="' + th +
             '" stroke-linecap="round" stroke-linejoin="round">' + inner + '</g>';
      return out;
    }

    var shapes = '';

    if (L.type === 'dot') {
      var r = size / 2;
      if (ow > 0) shapes += '<circle cx="' + c + '" cy="' + c + '" r="' + (r + ow) + '" fill="' + L.outlineColor + '"/>';
      shapes += '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="' + L.color + '"/>';

    } else if (L.type === 'circle') {
      shapes = twoPass('<circle cx="' + c + '" cy="' + c + '" r="' + (size / 2) + '"/>');

    } else if (L.type === 'square') {
      shapes = twoPass('<rect x="' + (c - size / 2) + '" y="' + (c - size / 2) +
                       '" width="' + size + '" height="' + size + '"/>');

    } else if (L.type === 'cross' || L.type === 't') {
      var arms = [];
      if (L.type === 'cross') arms.push('M' + c + ' ' + (c - gap) + ' V' + (c - gap - size));
      arms.push('M' + c + ' ' + (c + gap) + ' V' + (c + gap + size));
      arms.push('M' + (c - gap) + ' ' + c + ' H' + (c - gap - size));
      arms.push('M' + (c + gap) + ' ' + c + ' H' + (c + gap + size));
      shapes = twoPass(arms.map(function (d) { return '<path d="' + d + '"/>'; }).join(''));

    } else if (VANILLA_ANGLES[L.type]) {
      // Arms radiating outward at the game's own rotations. CSS rotate(0deg)
      // points along +x and turns clockwise, which is what the SVG y-down
      // coordinate system gives us directly.
      var rays = VANILLA_ANGLES[L.type].map(function (deg) {
        var a = deg * Math.PI / 180;
        var dx = Math.cos(a), dy = Math.sin(a);
        return '<path d="M' + (c + dx * gap) + ' ' + (c + dy * gap) +
               ' L' + (c + dx * (gap + size)) + ' ' + (c + dy * (gap + size)) + '"/>';
      });
      shapes = twoPass(rays.join(''));

    } else if (L.type === 'x') {
      var i = gap / Math.SQRT2, o = (gap + size) / Math.SQRT2;
      var ps = [
        'M' + (c - i) + ' ' + (c - i) + ' L' + (c - o) + ' ' + (c - o),
        'M' + (c + i) + ' ' + (c - i) + ' L' + (c + o) + ' ' + (c - o),
        'M' + (c - i) + ' ' + (c + i) + ' L' + (c - o) + ' ' + (c + o),
        'M' + (c + i) + ' ' + (c + i) + ' L' + (c + o) + ' ' + (c + o)
      ];
      shapes = twoPass(ps.map(function (d) { return '<path d="' + d + '"/>'; }).join(''));
    }

    return '<svg width="' + box + '" height="' + box + '" viewBox="0 0 ' + box + ' ' + box +
           '" xmlns="http://www.w3.org/2000/svg">' + shapes + '</svg>';
  }

  function renderLayers() {
    var host = document.querySelector(CONTAINER);
    if (!host) return;

    var wrap = host.querySelector('#noch-layers');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'noch-layers';
      host.appendChild(wrap);
    }

    wrap.textContent = '';
    cfg.layers.forEach(function (L) {
      if (!L.enabled) return;
      var el = document.createElement('div');
      el.className = 'noch-layer';
      el.style.opacity = Math.max(0, Math.min(1, L.opacity / 100)).toFixed(2);
      el.innerHTML = layerSvg(L);
      wrap.appendChild(el);
    });
  }

  /** The crosshair container outlives rounds, but re-add ours if it is replaced. */
  function keepLayersAlive() {
    var host = document.querySelector(CONTAINER);
    if (host && !host.querySelector('#noch-layers')) renderLayers();
  }

  /* The dialog's preview swatch, refreshed on its own so that editing a slider
     updates it live. It is deliberately separate from rebuilding the settings
     list: rebuilding mid-drag would destroy the slider under the cursor. */
  var previewInnerEl = null;

  function renderPreview() {
    // Deliberately NOT checking isConnected: the dialog is built detached and
    // only appended to the document afterwards, so on first open the preview
    // element has no parent yet. Gating on isConnected here left the preview
    // blank until something else forced a rebuild. closeDialog() nulls this
    // reference, so a stale element is not a risk.
    if (!previewInnerEl) return;
    previewInnerEl.textContent = '';
    cfg.layers.forEach(function (L) {
      if (!L.enabled) return;
      var el = document.createElement('div');
      el.className = 'noch-layer';
      el.style.opacity = Math.max(0, Math.min(1, L.opacity / 100)).toFixed(2);
      el.innerHTML = layerSvg(L);
      previewInnerEl.appendChild(el);
    });
  }

  function applyAndRedraw() {
    save();
    renderLayers();
    renderPreview();
  }

  /* ================================================================== *
   * Menu button + dialog
   * ================================================================== */

  var CROSSHAIR_SVG =
    '<svg viewBox="0 0 101 104" xmlns="http://www.w3.org/2000/svg">' +
      '<circle cx="50.5" cy="52" r="30" fill="none" stroke="black" stroke-width="7"/>' +
      '<g stroke="black" stroke-width="7" stroke-linecap="round">' +
        '<path d="M50.5 7 V27"/>' +
        '<path d="M50.5 77 V97"/>' +
        '<path d="M5 52 H25"/>' +
        '<path d="M76 52 H96"/>' +
      '</g>' +
      '<circle cx="50.5" cy="52" r="7.5" fill="black"/>' +
    '</svg>';

  var ICON_URL = 'data:image/svg+xml,' + encodeURIComponent(CROSSHAIR_SVG);

  function seed() { return Math.floor(Math.random() * 99999); }

  /* ---- row builders, using the game's own input classes ---- */

  function labelled(text) {
    var row = document.createElement('label');
    row.className = 'settings-item';
    var t = document.createElement('div');
    t.className = 'settings-item-text';
    t.textContent = text;
    row.appendChild(t);
    return row;
  }

  function boolRow(text, get, set) {
    var row = labelled(text);
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'dialog-checkbox-input wrinkledPaper';
    box.style.setProperty('--wrinkled-paper-seed', seed());
    box.checked = !!get();
    box.addEventListener('change', function () { set(box.checked); });
    row.appendChild(box);
    return row;
  }

  function selectRow(text, options, get, set) {
    var row = labelled(text);
    var wrap = document.createElement('div');
    wrap.className = 'dialog-select-wrapper wrinkledPaper';
    wrap.style.setProperty('--wrinkled-paper-seed', seed());
    var sel = document.createElement('select');
    sel.className = 'dialog-select-input blueNight';
    options.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = String(o[0]);
      opt.textContent = o[1];
      sel.appendChild(opt);
    });
    sel.value = String(get());
    sel.addEventListener('change', function () { set(sel.value); });
    wrap.appendChild(sel);
    row.appendChild(wrap);
    return row;
  }

  function rangeRow(text, min, max, step, suffix, get, set) {
    var row = labelled(text);
    var slider = document.createElement('div');
    slider.className = 'settings-item-slider';
    var input = document.createElement('input');
    input.className = 'dialog-range-input';
    input.type = 'range';
    input.min = min; input.max = max; input.step = step;
    input.value = get();
    var val = document.createElement('div');
    val.className = 'settings-item-slider-value';
    var render = function () { val.textContent = input.value + (suffix || ''); };
    render();
    input.addEventListener('input', function () { set(Number(input.value)); render(); });
    slider.appendChild(input);
    slider.appendChild(val);
    row.appendChild(slider);
    return row;
  }

  function colorRow(text, get, set) {
    var row = labelled(text);
    var col = document.createElement('input');
    col.type = 'color';
    col.className = 'dialog-color-input wrinkledPaper';
    col.style.setProperty('--wrinkled-paper-seed', seed());
    col.value = get();
    col.addEventListener('input', function () { set(col.value); });
    row.appendChild(col);
    return row;
  }

  /* ---- the dialog ---- */

  var dialogEl = null;
  var curtainEl = null;

  function closeDialog() {
    previewInnerEl = null;
    if (dialogEl && dialogEl.isConnected) dialogEl.remove();
    if (curtainEl && curtainEl.isConnected) curtainEl.remove();
    dialogEl = null;
    curtainEl = null;
  }

  /**
   * Adding, removing or reshaping a layer rebuilds the whole list - including
   * the control that fired the event. Doing that synchronously destroys an
   * element mid-event, so the rebuild is pushed to the next tick.
   */
  function defer(fn) { setTimeout(fn, 0); }

  /* ================================================================== *
   * Cutting the game's own crosshair options out of Settings
   *
   * The game's Settings dialog has a Crosshair group - Style, Color, Outline
   * Color, Accuracy Offset. Rather than reimplementing them (which could not
   * drive the real crosshair anyway), this MOVES the actual elements here.
   *
   * That works because the game applies those settings live, on the inputs'
   * own `input`/`change` handlers, rather than on Save - verified by changing
   * the colour input and watching --line-color update with the dialog's Save
   * button untouched. The nodes keep working after being reparented.
   *
   * Flow: opening this dialog silently opens the game's Settings dialog,
   * lifts the four rows out, and hides the game's dialog. Closing puts them
   * back and clicks Save, which persists and closes the game's dialog.
   * ================================================================== */

  function findGroupRows(dlg, title) {
    var headers = Array.prototype.slice.call(dlg.querySelectorAll('.settings-group-header'));
    var head = headers.filter(function (h) { return (h.textContent || '').trim() === title; })[0];
    if (!head) return null;
    var rows = [];
    var n = head.nextElementSibling;
    while (n && !n.classList.contains('settings-group-header')) {
      if (n.classList.contains('settings-item')) rows.push(n);
      n = n.nextElementSibling;
    }
    return { header: head, rows: rows };
  }

  /**
   * Take the Crosshair group out of the game's own Settings dialog. The dialog
   * is rebuilt from scratch every time it opens, so this runs on each one.
   */
  /* ================================================================== *
   * The game's crosshair: strip it from Settings, and read its spread
   *
   * Two separate jobs.
   *
   * 1. The game's Settings dialog has a Crosshair group (Style, Color,
   *    Outline Color, Accuracy Offset). Since this tab is the place to
   *    configure a crosshair, that group is stripped out of every Settings
   *    dialog the game builds. Its own crosshair can be switched off here too.
   *
   * 2. Accuracy offset. From the game's own crosshair update:
   *
   *      smoothAccuracy = lerp(smoothAccuracy, currentAccuracy, .5);
   *      const s = 7 + smoothAccuracy * settings.getValue('crosshairAccuracyOffset');
   *      line.el.style.transform =
   *        `translateY(-3px) rotate(${rotation}deg) translateX(${s}px)`;
   *
   *    So the live spread is sitting in the inline transform of any
   *    .crosshair-line: `translateX(<s>px)`, where 7 is the resting offset and
   *    everything above that is bow spread. Reading it off the DOM means our
   *    layers can breathe with the bow exactly like the built-in crosshair,
   *    with no hooking of game internals at all - and it automatically honours
   *    whatever the player set Accuracy Offset to.
   * ================================================================== */

  var VANILLA_BASE_OFFSET = 7;   // the `7 +` in the formula above

  function hideVanillaGroup(dlg) {
    var group = findGroupRows(dlg, 'Crosshair');
    if (!group) return null;
    group.header.style.display = 'none';
    group.rows.forEach(function (r) { r.style.display = 'none'; });
    return group;
  }

  /* The game's Settings dialog is created on demand, so watch for it and strip
     the Crosshair group before it is ever seen. */
  var dialogWatcher = new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      Array.prototype.forEach.call(m.addedNodes, function (node) {
        if (!node || node.nodeType !== 1) return;
        if (!node.classList || !node.classList.contains('dialog')) return;
        if (node.id === 'noch-dialog') return;      // ours
        hideVanillaGroup(node);
      });
    });
  });

  function watchGameDialogs() {
    var host = document.getElementById('gameWrapper') || document.body;
    dialogWatcher.observe(host, { childList: true });
  }

  function vanillaIsOn() { return !cfg.vanillaOff; }

  function applyVanillaHidden() {
    document.body.classList.toggle('noch-hide-vanilla', !!cfg.vanillaOff);
  }

  function setVanillaOn(on) {
    cfg.vanillaOff = !on;
    applyVanillaHidden();
    save();
  }

  /* ---- live bow spread, read off the game's own crosshair ---- */

  var spreadPx = 0;          // current extra spread beyond the resting offset
  var lastAppliedSpread = -1;

  /**
   * Pull `translateX(<n>px)` out of a .crosshair-line's inline transform.
   * Returns the extra spread beyond the resting 7px, or 0 if unavailable -
   * which is also the right answer when the game's crosshair style is `off`
   * and it stops updating the lines.
   */
  function readSpread() {
    var line = document.querySelector(CONTAINER + ' > .crosshair-line');
    if (!line) return 0;
    var t = line.style.transform;
    if (!t) return 0;
    var m = /translateX\(\s*(-?[\d.]+)px\s*\)/.exec(t);
    if (!m) return 0;
    var s = parseFloat(m[1]);
    if (isNaN(s)) return 0;
    return Math.max(0, s - VANILLA_BASE_OFFSET);
  }

  /** How far this layer should be pushed out by the current bow spread. */
  function layerSpread(L) {
    if (!L.followSpread) return 0;
    return spreadPx * (L.spreadScale / 100);
  }

  /**
   * Watch the game's crosshair for spread changes and redraw the layers that
   * follow it. Only redraws on a change of at least half a pixel, so a steady
   * bow costs nothing and a draw costs a handful of small SVG rebuilds.
   */
  function spreadLoop() {
    requestAnimationFrame(spreadLoop);
    if (!cfg.layers.some(function (L) { return L.enabled && L.followSpread; })) return;
    spreadPx = readSpread();
    if (Math.abs(spreadPx - lastAppliedSpread) < 0.5) return;
    lastAppliedSpread = spreadPx;
    renderLayers();
  }

  /** Rebuild the scrolling body of the dialog from the current layer list. */
  function fillList(inner) {
    inner.textContent = '';

    // ---- live preview -------------------------------------------------
    // The real layers only draw inside a match, because the game hides
    // .crosshair-container in the menu. Without this you would be editing blind.
    var previewHead = document.createElement('h3');
    previewHead.className = 'settings-group-header';
    previewHead.textContent = 'Preview';
    inner.appendChild(previewHead);

    var preview = document.createElement('div');
    preview.className = 'noch-preview';
    previewInnerEl = document.createElement('div');
    previewInnerEl.className = 'noch-preview-inner';
    preview.appendChild(previewInnerEl);
    inner.appendChild(preview);
    renderPreview();

    inner.appendChild(buildPresetList(inner));

    // ---- the game's own crosshair options, moved in from Settings -------
    var vanillaHead = document.createElement('h3');
    vanillaHead.className = 'settings-group-header';
    vanillaHead.textContent = "Game crosshair";
    inner.appendChild(vanillaHead);

    // On/off for the game's built-in crosshair. Works with or without the
    // harvested rows, since it hides the lines directly as well as driving the
    // game's own Style setting.
    inner.appendChild(boolRow('Show game crosshair',
      vanillaIsOn,
      function (v) {
        setVanillaOn(v);
        defer(function () { fillList(inner); });   // the Style row follows it
      }));


    if (!cfg.layers.length) {
      var empty = document.createElement('div');
      empty.className = 'noch-empty';
      empty.textContent = 'No crosshairs yet. Add one below.';
      inner.appendChild(empty);
    }

    cfg.layers.forEach(function (L, idx) {
      var head = document.createElement('h3');
      head.className = 'settings-group-header noch-layer-head';
      var name = document.createElement('span');
      name.textContent = 'Crosshair ' + (idx + 1);
      head.appendChild(name);

      var rm = document.createElement('button');
      rm.className = 'dialog-button blueNight wrinkledPaper noch-remove';
      rm.style.setProperty('--wrinkled-paper-seed', seed());
      rm.innerHTML = '<span>Remove</span>';
      rm.addEventListener('click', function (e) {
        e.preventDefault();
        cfg.layers.splice(idx, 1);
        applyAndRedraw();
        defer(function () { fillList(inner); });
      });
      head.appendChild(rm);
      inner.appendChild(head);

      inner.appendChild(boolRow('Show',
        function () { return L.enabled; },
        function (v) { L.enabled = v; applyAndRedraw(); }));

      inner.appendChild(selectRow('Shape', TYPES,
        function () { return L.type; },
        function (v) {
          L.type = v;
          applyAndRedraw();
          // The relevant controls change with the shape, so rebuild the list.
          defer(function () { fillList(inner); });
        }));

      inner.appendChild(colorRow('Colour',
        function () { return L.color; },
        function (v) { L.color = v; applyAndRedraw(); }));

      inner.appendChild(colorRow('Outline colour',
        function () { return L.outlineColor; },
        function (v) { L.outlineColor = v; applyAndRedraw(); }));

      inner.appendChild(rangeRow('Outline width', 0, 6, 1, 'px',
        function () { return L.outlineWidth; },
        function (v) { L.outlineWidth = v; applyAndRedraw(); }));

      inner.appendChild(rangeRow(L.type === 'dot' ? 'Dot size' :
                                 isRing(L.type) ? 'Size' : 'Line length',
        1, 60, 1, 'px',
        function () { return L.size; },
        function (v) { L.size = v; applyAndRedraw(); }));

      if (usesThickness(L.type)) {
        inner.appendChild(rangeRow('Thickness', 1, 12, 1, 'px',
          function () { return L.thickness; },
          function (v) { L.thickness = v; applyAndRedraw(); }));
      }

      if (usesGap(L.type)) {
        inner.appendChild(rangeRow('Centre gap', 0, 40, 1, 'px',
          function () { return L.gap; },
          function (v) { L.gap = v; applyAndRedraw(); }));
      }

      inner.appendChild(rangeRow('Opacity', 5, 100, 1, '%',
        function () { return L.opacity; },
        function (v) { L.opacity = v; applyAndRedraw(); }));

      // Accuracy offset: follow the bow the way the built-in crosshair does.
      if (L.type !== 'dot') {
        inner.appendChild(boolRow('Follow bow spread',
          function () { return L.followSpread; },
          function (v) {
            L.followSpread = v;
            applyAndRedraw();
            defer(function () { fillList(inner); });
          }));

        if (L.followSpread) {
          inner.appendChild(rangeRow('Spread amount', 0, 300, 5, '%',
            function () { return L.spreadScale; },
            function (v) { L.spreadScale = v; applyAndRedraw(); }));
        }
      }
    });

    if (cfg.layers.length > 1) inner.appendChild(buildOrderList(inner));
  }

  /**
   * Named presets. A preset is just a snapshot of the layer stack, so saving is
   * a deep copy in and loading is a deep copy out - never a shared reference,
   * or editing a layer would silently rewrite the preset you loaded it from.
   */
  function buildPresetList(inner) {
    var frag = document.createDocumentFragment();

    var head = document.createElement('h3');
    head.className = 'settings-group-header';
    head.textContent = 'Presets';
    frag.appendChild(head);

    var note = document.createElement('div');
    note.className = 'noch-order-note';
    note.textContent = cfg.presets.length
      ? 'Type in a name to rename it.'
      : 'Save the current crosshair so you can switch back to it later.';
    frag.appendChild(note);

    cfg.presets.forEach(function (P, i) {
      var row = document.createElement('div');
      row.className = 'settings-item noch-preset-row';

      // A stacked thumbnail of everything in the preset, shrunk to fit.
      var thumb = document.createElement('div');
      thumb.className = 'noch-preset-thumb';
      var thumbInner = document.createElement('div');
      thumbInner.className = 'noch-preset-thumb-inner';
      P.layers.forEach(function (L) {
        if (!L.enabled) return;
        var el = document.createElement('div');
        el.className = 'noch-layer';
        el.style.opacity = Math.max(0, Math.min(1, L.opacity / 100)).toFixed(2);
        el.innerHTML = layerSvg(L);
        thumbInner.appendChild(el);
      });
      thumb.appendChild(thumbInner);
      row.appendChild(thumb);

      var name = document.createElement('input');
      name.type = 'text';
      name.className = 'dialog-text-input wrinkledPaper noch-preset-name';
      name.style.setProperty('--wrinkled-paper-seed', seed());
      name.value = P.name;
      name.setAttribute('aria-label', 'Preset name');
      // Rename as you type. No list rebuild here - that would yank the field
      // out from under the cursor mid-word.
      name.addEventListener('input', function () {
        P.name = name.value;
        save();
      });
      row.appendChild(name);

      var btns = document.createElement('div');
      btns.className = 'noch-order-btns';

      var load = document.createElement('button');
      load.className = 'dialog-button blueNight wrinkledPaper noch-preset-btn';
      load.style.setProperty('--wrinkled-paper-seed', seed());
      load.innerHTML = '<span>Load</span>';
      load.addEventListener('click', function (e) {
        e.preventDefault();
        cfg.layers = clone(P.layers);
        applyAndRedraw();
        defer(function () { fillList(inner); });
      });

      // Overwrite this preset with whatever is on screen now.
      var update = document.createElement('button');
      update.className = 'dialog-button blueNight wrinkledPaper noch-preset-btn';
      update.style.setProperty('--wrinkled-paper-seed', seed());
      update.innerHTML = '<span>Save</span>';
      update.addEventListener('click', function (e) {
        e.preventDefault();
        P.layers = clone(cfg.layers);
        save();
        defer(function () { fillList(inner); });   // refresh the thumbnail
      });

      var del = document.createElement('button');
      del.className = 'dialog-button blueNight wrinkledPaper noch-preset-btn';
      del.style.setProperty('--wrinkled-paper-seed', seed());
      del.innerHTML = '<span>×</span>';
      del.setAttribute('aria-label', 'Delete preset');
      del.addEventListener('click', function (e) {
        e.preventDefault();
        cfg.presets.splice(i, 1);
        save();
        defer(function () { fillList(inner); });
      });

      btns.appendChild(load);
      btns.appendChild(update);
      btns.appendChild(del);
      row.appendChild(btns);
      frag.appendChild(row);
    });

    var addRow = document.createElement('div');
    addRow.className = 'noch-preset-add';
    var add = document.createElement('button');
    add.className = 'dialog-button blueNight wrinkledPaper';
    add.style.setProperty('--wrinkled-paper-seed', seed());
    add.innerHTML = '<span>Save current as preset</span>';
    add.addEventListener('click', function (e) {
      e.preventDefault();
      cfg.presets.push({
        name: 'Preset ' + (cfg.presets.length + 1),
        layers: clone(cfg.layers)
      });
      save();
      defer(function () { fillList(inner); });
    });
    addRow.appendChild(add);
    frag.appendChild(addRow);

    return frag;
  }

  /** Human name for a shape, from the same table the Shape dropdown uses. */
  function layerName(L) {
    var t = TYPES.filter(function (o) { return o[0] === L.type; })[0];
    return t ? t[1] : L.type;
  }

  /**
   * The stacking list. Layers are drawn in array order, so the last one lands
   * on top - which is why this list is shown reversed, top-most first, the way
   * any layers panel does it.
   */
  function buildOrderList(inner) {
    var frag = document.createDocumentFragment();

    var head = document.createElement('h3');
    head.className = 'settings-group-header';
    head.textContent = 'Layer order';
    frag.appendChild(head);

    var note = document.createElement('div');
    note.className = 'noch-order-note';
    note.textContent = 'Top of this list draws on top.';
    frag.appendChild(note);

    function move(from, to) {
      var moved = cfg.layers.splice(from, 1)[0];
      cfg.layers.splice(to, 0, moved);
      applyAndRedraw();
      defer(function () { fillList(inner); });
    }

    for (var d = cfg.layers.length - 1; d >= 0; d--) {
      (function (idx) {
        var L = cfg.layers[idx];

        var row = document.createElement('div');
        row.className = 'settings-item noch-order-row';

        var thumb = document.createElement('div');
        thumb.className = 'noch-thumb';
        thumb.innerHTML = layerSvg(L);
        row.appendChild(thumb);

        var name = document.createElement('div');
        name.className = 'noch-order-name';
        name.textContent = (idx + 1) + '. ' + layerName(L) + (L.enabled ? '' : ' (hidden)');
        row.appendChild(name);

        var btns = document.createElement('div');
        btns.className = 'noch-order-btns';

        // "Up" means further up the visual stack, which is later in the array.
        var up = document.createElement('button');
        up.className = 'dialog-button blueNight wrinkledPaper noch-order-btn';
        up.style.setProperty('--wrinkled-paper-seed', seed());
        up.innerHTML = '<span>▲</span>';
        up.disabled = (idx === cfg.layers.length - 1);
        up.addEventListener('click', function (e) {
          e.preventDefault();
          if (!up.disabled) move(idx, idx + 1);
        });

        var down = document.createElement('button');
        down.className = 'dialog-button blueNight wrinkledPaper noch-order-btn';
        down.style.setProperty('--wrinkled-paper-seed', seed());
        down.innerHTML = '<span>▼</span>';
        down.disabled = (idx === 0);
        down.addEventListener('click', function (e) {
          e.preventDefault();
          if (!down.disabled) move(idx, idx - 1);
        });

        btns.appendChild(up);
        btns.appendChild(down);
        row.appendChild(btns);

        frag.appendChild(row);
      })(d);
    }

    return frag;
  }

  function openDialog() {
    if (dialogEl && dialogEl.isConnected) return;
    var host = document.getElementById('gameWrapper') || document.body;

    curtainEl = document.createElement('div');
    curtainEl.className = 'dialogCurtain fullScreen';
    curtainEl.id = 'noch-curtain';
    curtainEl.style.zIndex = '99';
    curtainEl.addEventListener('click', closeDialog);
    host.appendChild(curtainEl);

    dialogEl = document.createElement('div');
    dialogEl.className = 'dialog wrinkledPaper';
    dialogEl.id = 'noch-dialog';
    dialogEl.style.setProperty('--wrinkled-paper-seed', seed());
    dialogEl.style.zIndex = '100';

    var title = document.createElement('h2');
    title.className = 'dialogTitle blueNight';
    title.textContent = 'Crosshair';
    dialogEl.appendChild(title);

    var list = document.createElement('div');
    list.className = 'settings-list';
    var inner = document.createElement('div');
    fillList(inner);
    list.appendChild(inner);
    dialogEl.appendChild(list);

    var btns = document.createElement('div');
    btns.className = 'dialogButtonsContainer';

    var addBtn = document.createElement('button');
    addBtn.className = 'dialog-button blueNight wrinkledPaper noch-add';
    addBtn.style.setProperty('--wrinkled-paper-seed', seed());
    addBtn.innerHTML = '<span>Add crosshair</span>';
    addBtn.addEventListener('click', function (e) {
      e.preventDefault();
      cfg.layers.push(newLayer(cfg.layers.length ? 'cross' : 'dot'));
      applyAndRedraw();
      defer(function () {
        fillList(inner);
        list.scrollTop = list.scrollHeight;   // show the one just added
      });
    });

    var doneBtn = document.createElement('button');
    doneBtn.className = 'dialog-button blueNight wrinkledPaper';
    doneBtn.style.setProperty('--wrinkled-paper-seed', seed());
    doneBtn.innerHTML = '<span>Done</span>';
    doneBtn.addEventListener('click', closeDialog);

    btns.appendChild(addBtn);
    btns.appendChild(doneBtn);
    dialogEl.appendChild(btns);

    ['keydown', 'keyup', 'keypress'].forEach(function (t) {
      dialogEl.addEventListener(t, function (e) { e.stopPropagation(); });
    });
    if (document.pointerLockElement) document.exitPointerLock();

    // Add/Done live outside fillList's own container, so the wrap above
    // doesn't reach them - one more sweep over the whole dialog catches
    // those two along with everything fillList already covered.
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
    if (!bar) return;
    if (bar.querySelector('#noch-menu-button')) return;

    var container = document.createElement('div');
    container.className = 'main-menu-button-container';
    container.id = 'noch-menu-button';

    var btn = document.createElement('button');
    btn.className = 'wrinkledPaper main-menu-button';
    btn.setAttribute('aria-label', 'Crosshair');
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
    label.textContent = 'Crosshair';

    container.appendChild(btn);
    container.appendChild(label);

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleDialog();
    });

    // Sit after the Health tab if that mod is installed, otherwise after
    // Settings, so the order stays stable however the two load.
    var siblings = Array.prototype.slice.call(bar.querySelectorAll('.main-menu-button-container'));
    var anchor = siblings.filter(function (c) {
      var t = (c.textContent || '').trim();
      return t === 'Health' || t === 'Settings';
    }).pop();

    if (anchor && anchor.nextSibling) bar.insertBefore(container, anchor.nextSibling);
    else bar.appendChild(container);
  }

  /* ================================================================== *
   * Boot
   * ================================================================== */

  /**
   * Never let a dialog button become a Tab-navigation stop.
   *
   * The game silently drops every keydown while any BUTTON/INPUT/SELECT has
   * focus (its own inputHasFocus() check), so Tab's default browser focus
   * cycling landing on one of ours would look exactly like the game
   * ignoring your controls - and it stays that way until focus moves off
   * it again. fillList rebuilds the dialog's buttons from scratch on nearly
   * every interaction, so this wraps it once here rather than touching
   * every one of its call sites.
   */
  (function guardFillListButtons() {
    var original = fillList;
    fillList = function (inner) {
      original(inner);
      inner.querySelectorAll('button, input, select').forEach(function (el) { el.tabIndex = -1; });
    };
  })();

  injectStyle();
  applyVanillaHidden();
  watchGameDialogs();   // strip the Crosshair group from the game's Settings
  injectMenuButton();
  renderLayers();
  requestAnimationFrame(spreadLoop);   // follow the bow
  setInterval(function () { injectMenuButton(); keepLayersAlive(); }, 1000);

  window.addEventListener('keydown', function (e) {
    // Unbound by default - only there if you set one in the Hotkey Editor.
    var key = hotkeyFor('crosshair.toggle', null);
    if (key !== null && e.code === key && !e.ctrlKey && !e.altKey && !e.metaKey &&
        !typingInDialog(e)) {
      e.preventDefault(); e.stopPropagation();
      if (dialogEl && dialogEl.isConnected) closeDialog(); else openDialog();
      return;
    }
    if (e.code === 'Escape' && dialogEl && dialogEl.isConnected) {
      e.preventDefault();
      e.stopPropagation();
      closeDialog();
    }
  }, true);

  window.NarrowCrosshair = {
    config: cfg,
    save: save,
    open: toggleDialog,
    redraw: renderLayers,
    /** Drop a preview of the current layers on screen outside a match. */
    preview: function (on) {
      var host = document.querySelector(CONTAINER);
      if (!host) return 'no crosshair container';
      host.style.display = on === false ? '' : 'block';
      renderLayers();
      return on === false ? 'preview off' : 'preview on - NarrowCrosshair.preview(false) to stop';
    }
  };

  console.log('[Narrow One Crosshair] loaded - Crosshair tab added to the main menu.');
})();
