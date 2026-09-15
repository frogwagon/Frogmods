// ==UserScript==
// @name         Target Practice
// @namespace    narrowone-target-practice
// @version      1.0.0
// @description  A self-contained aim trainer in Narrow One's own menu. Press, hold, release, same as the bow - no bots, no aim assist, just reps.
// @author       Frogwagon
// @match        https://narrow.one/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * Target Practice  -  Narrow One
 * -------------------------------
 * A menu tab that opens a full-screen range: circular targets appear, you
 * aim and shoot, it tells you how you did. That is the whole mod.
 *
 * It does not touch the live game in any way - no reading your stats, no
 * writing them, no hooking the game's bundle. It never needs to: there is
 * nothing here that depends on a real match, a real player, or a real gear
 * set. It is a canvas drawn on top of the page, driven by your own mouse.
 * Nothing it does could give you an edge in an actual match - it is a place
 * to warm up before one.
 *
 * The "shot" is a mousedown-then-mouseup, same shape as the game's own bow:
 * press to draw, release to fire. The shot lands wherever the cursor is on
 * release, and a ring grows under the cursor while you hold so the draw is
 * visible - it does not change scoring, it is just honest feedback about
 * when the shot will actually go off.
 *
 * Two modes:
 *   Static  - one target at a time, appears, times out into a miss if you
 *             do not take it, a new one takes its place.
 *   Moving  - one target drifts and bounces around the screen the whole
 *             session; every hit is a hit, it never stops to wait for you.
 *
 * Everything - settings, personal bests, a short history - lives in
 * localStorage. Nothing is sent anywhere.
 */

(function () {
  'use strict';

  var STORE_KEY = 'narrowone.targetpractice.v1';

  var DEFAULTS = {
    mode: 'static',      // 'static' | 'moving'
    targetSize: 32,       // radius, px
    duration: 30,         // seconds per session
    moveSpeed: 260,       // px/sec, moving mode only
    lifetime: 1400        // ms before an unclaimed static target is a miss
  };

  function load() {
    var out = { settings: {}, bests: { static: null, moving: null }, history: [] };
    Object.keys(DEFAULTS).forEach(function (k) { out.settings[k] = DEFAULTS[k]; });
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        if (saved.settings) {
          Object.keys(DEFAULTS).forEach(function (k) {
            if (saved.settings[k] !== undefined) out.settings[k] = saved.settings[k];
          });
        }
        if (saved.bests) out.bests = saved.bests;
        if (Array.isArray(saved.history)) out.history = saved.history;
      }
    } catch (e) {}
    return out;
  }

  var state = load();
  var cfg = state.settings;

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        settings: cfg, bests: state.bests, history: state.history
      }));
    } catch (e) {}
  }

  /* ================================================================ *
   * Look and feel - the same building blocks the other mods use, so
   * this reads as one more native tab rather than a bolted-on toy.
   * ================================================================ */

  var ICON = '<svg viewBox="0 0 101 104" xmlns="http://www.w3.org/2000/svg">' +
    '<circle cx="50" cy="52" r="36" fill="none" stroke="black" stroke-width="7"/>' +
    '<circle cx="50" cy="52" r="20" fill="none" stroke="black" stroke-width="7"/>' +
    '<circle cx="50" cy="52" r="6" fill="black"/>' +
    '<path d="M50 4 L50 20 M50 84 L50 100 M2 52 L18 52 M82 52 L98 52" ' +
    'stroke="black" stroke-width="7" stroke-linecap="round"/></svg>';
  var ICON_URL = 'data:image/svg+xml,' + encodeURIComponent(ICON);

  function seed() { return Math.floor(Math.random() * 99999); }

  var CSS = [
    '#ntp-dialog .ntp-note { opacity: .6; margin: 2px 0 10px; }',
    '#ntp-dialog .ntp-row { display:flex; align-items:center; gap:10px; }',
    '#ntp-dialog .ntp-modes { display:flex; gap:8px; margin: 4px 0 12px; }',
    '#ntp-dialog .ntp-mode-btn { flex: 1 1 auto; }',
    '#ntp-dialog .ntp-mode-btn.ntp-active { outline: 2px solid rgba(0,0,0,.35); }',
    '#ntp-dialog .ntp-best { display:flex; justify-content:space-between; gap:10px; ' +
      'padding:6px 0; border-bottom:1px solid rgba(0,0,0,.12); font-size:13px; }',
    '#ntp-dialog .ntp-best:last-child { border-bottom:none; }',
    '#ntp-dialog .ntp-best b { font-size:15px; }',
    '#ntp-overlay { position:fixed; inset:0; z-index:200; cursor:crosshair; ' +
      'background:rgba(20,20,25,.35); }',
    '#ntp-overlay canvas { position:absolute; inset:0; width:100%; height:100%; }',
    '#ntp-hud { position:fixed; top:18px; left:50%; transform:translateX(-50%); z-index:201; ' +
      'display:flex; gap:22px; padding:8px 22px; border-radius:10px; ' +
      'background:rgba(15,15,20,.65); color:#fff; font:600 15px system-ui,sans-serif; ' +
      'pointer-events:none; }',
    '#ntp-hud span { opacity:.6; font-weight:400; margin-right:4px; }',
    '#ntp-quit { position:fixed; top:18px; right:18px; z-index:201; }',
    '#ntp-summary { position:fixed; inset:0; z-index:202; display:flex; ' +
      'align-items:center; justify-content:center; background:rgba(10,10,14,.55); }'
  ].join('\n');

  (function injectStyle() {
    if (document.getElementById('ntp-style')) return;
    var el = document.createElement('style');
    el.id = 'ntp-style';
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
    d.className = 'ntp-note';
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
   * Settings dialog - a tab in the game's own menu, same shape as
   * Health, Crosshair and 1 Kill = 1 Stat Point.
   * ================================================================ */

  var dialogEl = null, curtainEl = null, bodyEl = null;

  function fmtPct(n) { return Math.round(n) + '%'; }
  function fmtMs(n) { return Math.round(n) + 'ms'; }

  function bestRow(label, mode) {
    var b = state.bests[mode];
    var r = document.createElement('div');
    r.className = 'ntp-best';
    if (!b) {
      r.innerHTML = '<span>' + label + '</span><span style="opacity:.5">No sessions yet</span>';
      return r;
    }
    r.innerHTML = '<span>' + label + '</span>' +
      '<span><b>' + fmtPct(b.accuracy) + '</b> acc &middot; ' +
      b.hits + ' hits &middot; streak ' + b.bestStreak +
      ' &middot; ' + fmtMs(b.avgReaction) + ' avg</span>';
    return r;
  }

  function fill(inner) {
    inner.textContent = '';

    inner.appendChild(h3('Practice'));
    inner.appendChild(note('Press and hold to draw, release to shoot - same as the bow. ' +
      'This never touches a real match; it is just a range.'));

    var modes = document.createElement('div');
    modes.className = 'ntp-modes';
    ['static', 'moving'].forEach(function (m) {
      var b = button(m === 'static' ? 'Static' : 'Moving', function () {
        cfg.mode = m; save(); refresh();
      });
      b.className += ' ntp-mode-btn' + (cfg.mode === m ? ' ntp-active' : '');
      modes.appendChild(b);
    });
    inner.appendChild(modes);
    inner.appendChild(note(cfg.mode === 'static'
      ? 'One target at a time. Miss the window and it moves on.'
      : 'One target, always moving. Every shot that lands counts.'));

    inner.appendChild(startRow());

    inner.appendChild(h3('Settings'));
    inner.appendChild(sliderRow('Target size', 'targetSize', 14, 60, 2, 'px'));
    inner.appendChild(sliderRow('Session length', 'duration', 10, 90, 5, 's'));
    if (cfg.mode === 'moving') {
      inner.appendChild(sliderRow('Target speed', 'moveSpeed', 80, 600, 20, 'px/s'));
    } else {
      inner.appendChild(sliderRow('Time to react', 'lifetime', 500, 3000, 100, 'ms'));
    }

    inner.appendChild(h3('Personal bests'));
    inner.appendChild(bestRow('Static', 'static'));
    inner.appendChild(bestRow('Moving', 'moving'));

    if (state.history.length) {
      inner.appendChild(h3('Recent sessions'));
      state.history.slice(0, 5).forEach(function (s) {
        var r = document.createElement('div');
        r.className = 'ntp-best';
        var when = new Date(s.at).toLocaleString();
        r.innerHTML = '<span>' + (s.mode === 'static' ? 'Static' : 'Moving') +
          ' &middot; ' + when + '</span>' +
          '<span>' + fmtPct(s.accuracy) + ' acc &middot; ' + s.hits + ' hits</span>';
        inner.appendChild(r);
      });
    }
  }

  function startRow() {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:8px; margin:6px 0 4px;';
    row.appendChild(button('Start', function () {
      closeDialog();
      runSession();
    }));
    return row;
  }

  function sliderRow(label, key, min, max, step, unit) {
    var kr = document.createElement('label');
    kr.className = 'settings-item';
    var kt = document.createElement('div');
    kt.className = 'settings-item-text';
    kt.textContent = label;
    kr.appendChild(kt);
    var sl = document.createElement('div');
    sl.className = 'settings-item-slider';
    var si = document.createElement('input');
    si.className = 'dialog-range-input';
    si.type = 'range'; si.min = min; si.max = max; si.step = step; si.value = cfg[key];
    var sv = document.createElement('div');
    sv.className = 'settings-item-slider-value';
    sv.textContent = cfg[key] + unit;
    si.addEventListener('input', function () {
      cfg[key] = Number(si.value);
      sv.textContent = si.value + unit;
      save();
    });
    sl.appendChild(si); sl.appendChild(sv); kr.appendChild(sl);
    return kr;
  }

  function refresh() { if (bodyEl) fill(bodyEl); }

  function closeDialog() {
    bodyEl = null;
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
    dialogEl.id = 'ntp-dialog';
    dialogEl.style.setProperty('--wrinkled-paper-seed', seed());
    dialogEl.style.zIndex = '100';

    var title = document.createElement('h2');
    title.className = 'dialogTitle blueNight';
    title.textContent = 'Target Practice';
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
   * The range itself - a full-screen canvas, driven by mousedown /
   * mouseup instead of click, so a "shot" has the same press-then-
   * release shape as the game's own bow.
   * ================================================================ */

  function runSession() {
    if (document.pointerLockElement) document.exitPointerLock();

    var overlay = document.createElement('div');
    overlay.id = 'ntp-overlay';
    var canvas = document.createElement('canvas');
    overlay.appendChild(canvas);
    document.body.appendChild(overlay);

    var hud = document.createElement('div');
    hud.id = 'ntp-hud';
    document.body.appendChild(hud);

    var quitBtn = button('Stop', function () { finish(true); });
    quitBtn.id = 'ntp-quit';
    document.body.appendChild(quitBtn);

    var ctx = canvas.getContext('2d');
    var dpr = Math.max(1, window.devicePixelRatio || 1);
    var W = 0, H = 0;

    function resize() {
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    var mode = cfg.mode;
    var R = cfg.targetSize;
    var margin = R + 24;

    var hits = 0, misses = 0, streak = 0, bestStreak = 0;
    var reactions = [];
    var ended = false;
    var startedAt = performance.now();
    var endsAt = startedAt + cfg.duration * 1000;

    var target = null;      // { x, y, spawnedAt, vx, vy }
    var drawing = false;    // mouse currently held
    var drawStart = 0;

    function rand(a, b) { return a + Math.random() * (b - a); }

    function spawnStatic() {
      target = {
        x: rand(margin, W - margin),
        y: rand(margin, H - margin),
        spawnedAt: performance.now()
      };
    }

    function spawnMoving(first) {
      var ang = rand(0, Math.PI * 2);
      target = {
        x: first ? rand(margin, W - margin) : target.x,
        y: first ? rand(margin, H - margin) : target.y,
        vx: Math.cos(ang) * cfg.moveSpeed,
        vy: Math.sin(ang) * cfg.moveSpeed,
        spawnedAt: performance.now()
      };
    }

    if (mode === 'static') spawnStatic(); else spawnMoving(true);

    function registerHit() {
      hits++;
      streak++;
      if (streak > bestStreak) bestStreak = streak;
      reactions.push(performance.now() - target.spawnedAt);
      if (mode === 'static') spawnStatic(); else spawnMoving(false);
    }

    function registerMiss() {
      misses++;
      streak = 0;
    }

    function onDown(e) {
      if (ended) return;
      drawing = true;
      drawStart = performance.now();
    }

    function onUp(e) {
      if (ended || !drawing) return;
      drawing = false;
      var rect = canvas.getBoundingClientRect();
      var x = e.clientX - rect.left, y = e.clientY - rect.top;
      var dx = x - target.x, dy = y - target.y;
      if (Math.sqrt(dx * dx + dy * dy) <= R) registerHit();
      else registerMiss();
    }

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);

    function onKey(e) {
      if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(true); }
    }
    window.addEventListener('keydown', onKey, true);

    var raf = null;
    function loop(now) {
      if (ended) return;
      raf = requestAnimationFrame(loop);

      if (mode === 'static' && now - target.spawnedAt > cfg.lifetime) {
        registerMiss();
        spawnStatic();
      }
      if (mode === 'moving') {
        var dt = 1 / 60;
        target.x += target.vx * dt;
        target.y += target.vy * dt;
        if (target.x < margin || target.x > W - margin) target.vx *= -1;
        if (target.y < margin || target.y > H - margin) target.vy *= -1;
        target.x = Math.min(Math.max(target.x, margin), W - margin);
        target.y = Math.min(Math.max(target.y, margin), H - margin);
      }

      ctx.clearRect(0, 0, W, H);

      // the target: dark backing disc so it reads on any background, then a
      // white ring and a red centre - contrast over legibility on top of an
      // arbitrary game scene.
      ctx.beginPath();
      ctx.arc(target.x, target.y, R + 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(target.x, target.y, R, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(target.x, target.y, R * 0.28, 0, Math.PI * 2);
      ctx.fillStyle = '#e0393e';
      ctx.fill();

      // the draw ring - grows while the mouse is held, purely visual.
      if (drawing) {
        var held = now - drawStart;
        var mouse = lastMouse;
        if (mouse) {
          ctx.beginPath();
          ctx.arc(mouse.x, mouse.y, Math.min(30, 6 + held / 20), 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,255,255,.8)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      var left = Math.max(0, endsAt - now);
      hud.innerHTML =
        '<div><span>Time</span>' + Math.ceil(left / 1000) + 's</div>' +
        '<div><span>Hits</span>' + hits + '</div>' +
        '<div><span>Misses</span>' + misses + '</div>' +
        '<div><span>Streak</span>' + streak + '</div>';

      if (now >= endsAt) finish(false);
    }

    var lastMouse = null;
    function onMove(e) {
      var rect = canvas.getBoundingClientRect();
      lastMouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    window.addEventListener('mousemove', onMove);

    raf = requestAnimationFrame(loop);

    function finish(early) {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
      hud.remove();
      quitBtn.remove();

      var total = hits + misses;
      var accuracy = total ? (hits / total) * 100 : 0;
      var avgReaction = reactions.length
        ? reactions.reduce(function (a, b) { return a + b; }, 0) / reactions.length
        : 0;

      showSummary({
        mode: mode, hits: hits, misses: misses, accuracy: accuracy,
        bestStreak: bestStreak, avgReaction: avgReaction, early: early
      });
    }
  }

  function showSummary(r) {
    var wrap = document.createElement('div');
    wrap.id = 'ntp-summary';

    var card = document.createElement('div');
    card.className = 'dialog wrinkledPaper';
    card.style.setProperty('--wrinkled-paper-seed', seed());
    card.style.maxWidth = '360px';

    var title = document.createElement('h2');
    title.className = 'dialogTitle blueNight';
    title.textContent = r.early ? 'Stopped early' : 'Session complete';
    card.appendChild(title);

    var list = document.createElement('div');
    list.className = 'settings-list';

    var lines = [
      ['Mode', r.mode === 'static' ? 'Static' : 'Moving'],
      ['Accuracy', fmtPct(r.accuracy)],
      ['Hits', String(r.hits)],
      ['Misses', String(r.misses)],
      ['Best streak', String(r.bestStreak)],
      ['Avg reaction', fmtMs(r.avgReaction)]
    ];
    lines.forEach(function (pair) {
      var row = document.createElement('div');
      row.className = 'ntp-best';
      row.innerHTML = '<span>' + pair[0] + '</span><b>' + pair[1] + '</b>';
      list.appendChild(row);
    });

    if (r.early) {
      list.appendChild(note('Ended early, so this was not saved to your bests or history - ' +
        'run out the full session length for that.'));
    } else {
      recordSession(r);
      list.appendChild(note('Saved.'));
    }

    card.appendChild(list);

    var btns = document.createElement('div');
    btns.className = 'dialogButtonsContainer';
    btns.appendChild(button('Again', function () { wrap.remove(); runSession(); }));
    btns.appendChild(button('Done', function () { wrap.remove(); }));
    card.appendChild(btns);

    wrap.appendChild(card);
    document.body.appendChild(wrap);
  }

  /** Only a completed, full-length session counts toward bests and history. */
  function recordSession(r) {
    var entry = {
      mode: r.mode, hits: r.hits, misses: r.misses, accuracy: r.accuracy,
      bestStreak: r.bestStreak, avgReaction: r.avgReaction, at: Date.now()
    };

    state.history.unshift(entry);
    state.history = state.history.slice(0, 20);

    var prev = state.bests[r.mode];
    // Accuracy first, hits as the tiebreaker - the same order the summary
    // itself leads with.
    var better = !prev || entry.accuracy > prev.accuracy ||
      (entry.accuracy === prev.accuracy && entry.hits > prev.hits);
    if (better) state.bests[r.mode] = entry;

    save();
  }

  /* ================================================================ *
   * Menu button
   * ================================================================ */

  function injectMenuButton() {
    var bar = document.querySelector('.menu-buttons-container');
    if (!bar || bar.querySelector('#ntp-menu-button')) return;

    var c = document.createElement('div');
    c.className = 'main-menu-button-container';
    c.id = 'ntp-menu-button';

    var b = document.createElement('button');
    b.className = 'wrinkledPaper main-menu-button';
    b.setAttribute('aria-label', 'Target Practice');
    b.style.setProperty('--wrinkled-paper-seed', seed());

    var img = document.createElement('div');
    img.className = 'buttonImage';
    img.style.backgroundImage = 'url("' + ICON_URL + '")';
    img.style.backgroundSize = '90%';
    b.appendChild(img);

    var l = document.createElement('div');
    l.className = 'main-menu-button-text whiteBigText blueNight';
    l.setAttribute('aria-hidden', 'true');
    l.textContent = 'Target Practice';

    c.appendChild(b); c.appendChild(l);
    b.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (dialogEl && dialogEl.isConnected) closeDialog(); else openDialog();
    });

    var sibs = Array.prototype.slice.call(bar.querySelectorAll('.main-menu-button-container'));
    var anchor = sibs.filter(function (x) {
      var t = (x.textContent || '').trim();
      return t === 'Crosshair' || t === 'Health' || t === 'Settings' ||
             t === '1 Kill = 1 Stat Point';
    }).pop();
    if (anchor && anchor.nextSibling) bar.insertBefore(c, anchor.nextSibling);
    else bar.appendChild(c);
  }

  injectMenuButton();
  setInterval(injectMenuButton, 1000);

  window.addEventListener('keydown', function (e) {
    if (e.code === 'Escape' && dialogEl && dialogEl.isConnected) {
      e.preventDefault(); e.stopPropagation(); closeDialog();
    }
  }, true);

  window.NarrowTargetPractice = {
    open: openDialog,
    start: runSession,
    get bests() { return state.bests; },
    get history() { return state.history; }
  };

  console.log('[Target Practice] ready.');
})();
