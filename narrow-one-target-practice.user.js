// ==UserScript==
// @name         Target Practice
// @namespace    narrowone-target-practice
// @version      1.23.0
// @description  An aim trainer for Narrow One: practice dummies inside the real map that you shoot with your real bow (real arrow speed and drop for every bow), plus on-screen static, moving and Bot Range drills. Only on your screen - no aim assist, no coins, nothing sent to the game. F9 toggles the in-game range.
// @author       Frogwagon
// @match        https://narrow.one/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * Target Practice  -  Narrow One
 * -------------------------------
 * A menu tab with two kinds of practice:
 *
 * 1. In-game range: practice dummies inside the real map, shot with your
 *    real bow, so the arrow speed and drop are exactly the game's for
 *    whichever bow you hold. See the "In-game range" section below for
 *    how - it hooks the game the same reversible way the other Frogmods
 *    do, draws the dummies only on your screen and sends nothing.
 *
 * 2. On-screen drills: a canvas drawn on top of the page, driven by your
 *    own mouse. These never touch the live game.
 *
 * Nothing here gives you an edge in a real fight - no aim assist, no
 * coins, no stats. It is a place to warm up.
 *
 * On-screen drills:
 * The "shot" is a mousedown-then-mouseup, same shape as the game's own bow:
 * press to draw, release to fire. The shot lands wherever the cursor is on
 * release, and a ring grows under the cursor while you hold so the draw is
 * visible - it does not change scoring, it is just honest feedback about
 * when the shot will actually go off.
 *
 * Three modes:
 *   Static  - one target at a time, appears, times out into a miss if you
 *             do not take it, a new one takes its place.
 *   Moving  - one target drifts and bounces around the screen the whole
 *             session; every hit is a hit, it never stops to wait for you.
 *   Bot Range - practice dummies on three lanes (far ones smaller and
 *             slower) that run, change direction, stop and jump. Body hit
 *             = 1 point, headshot = 2. Sliders for how many, respawn time
 *             and speed; with waves on, every wave adds a dummy and speed.
 *             These are drawings on your screen, not game bots - they give
 *             no coins and no real stats.
 *
 * Everything - settings, personal bests, a short history - lives in
 * localStorage. Nothing is sent anywhere.
 */

(function () {
  'use strict';

  /*
   * If anything goes wrong, say so - on screen and in the console (F12) - with the reason, the
   * browser and the version, so it can be fixed instead of the mod just quietly not working.
   */
  var TP_VERSION = '1.23.0';
  var reported = {};
  function tpReport(where, err) {
    var msg = (err && err.message) || String(err);
    var key = where + ':' + msg;
    if (reported[key]) return;
    reported[key] = true;
    try {
      console.error('[Target Practice ' + TP_VERSION + '] failed in ' + where + ': ' + msg +
        '\n  browser: ' + navigator.userAgent + '\n', err);
      var box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483000;max-width:90vw;' +
        'padding:10px 16px;border-radius:10px;background:rgba(120,20,20,.92);color:#fff;font:600 14px system-ui,sans-serif;' +
        'box-shadow:0 6px 20px rgba(0,0,0,.5);pointer-events:auto;cursor:pointer;';
      box.textContent = 'Target Practice ' + TP_VERSION + ' had a problem (' + where + '): ' + msg + '  -  press F12 > Console for details. Click to close.';
      box.addEventListener('click', function () { box.remove(); });
      (document.body || document.documentElement).appendChild(box);
      setTimeout(function () { box.remove(); }, 20000);
    } catch (e2) {}
  }
  try {

  var STORE_KEY = 'narrowone.targetpractice.v1';

  var DEFAULTS = {
    mode: 'static',      // 'static' | 'moving' | 'bots'
    targetSize: 32,       // radius, px
    duration: 30,         // seconds per session
    moveSpeed: 260,       // px/sec, moving mode only
    lifetime: 1400,       // ms before an unclaimed static target is a miss
    botCount: 4,          // bot range: dummies on screen at once
    botRespawn: 1.0,      // bot range: seconds before a downed dummy comes back
    botSpeed: 220,        // bot range: run speed, px/sec (near lane)
    botWaves: 1           // bot range: 1 = waves get harder, 0 = steady
  };

  var MODE_NAMES = { static: 'Static', moving: 'Moving', bots: 'Bot Range', range: 'In-game range' };

  function load() {
    var out = { settings: {}, bests: { static: null, moving: null, bots: null, range: null }, history: [], chal: {}, aim: null, sessions: [] };
    Object.keys(DEFAULTS).forEach(function (k) { out.settings[k] = DEFAULTS[k]; });
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        if (saved.settings) {
          Object.keys(saved.settings).forEach(function (k) {
            if (k in DEFAULTS || k.indexOf('range_') === 0) out.settings[k] = saved.settings[k];   // includes range_stats
          });
        }
        if (saved.bests) Object.keys(saved.bests).forEach(function (k) { out.bests[k] = saved.bests[k]; });
        if (Array.isArray(saved.history)) out.history = saved.history;
        if (saved.chal && typeof saved.chal === 'object') out.chal = saved.chal;       // challenge / waves records
        if (saved.aim && saved.aim.bows) out.aim = saved.aim;                           // your aim stats, per bow
        if (Array.isArray(saved.sessions)) out.sessions = saved.sessions;              // in-game range sessions, for the history graph
      }
    } catch (e) {}
    return out;
  }

  var state = load();
  var cfg = state.settings;

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        settings: cfg, bests: state.bests, history: state.history, chal: state.chal, aim: state.aim, sessions: state.sessions
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
      'padding:6px 10px 6px 0; border-bottom:1px solid rgba(0,0,0,.12); font-size:13px; }',
    '#ntp-dialog .ntp-best:last-child { border-bottom:none; }',
    '#ntp-dialog .ntp-best b { font-size:15px; }',
    '#ntp-dialog .ntp-tabs { display:flex; flex-wrap:wrap; gap:4px; margin:-8px 0 10px; max-width:min(600px, 86vw); }',
    '#ntp-dialog .ntp-tab { flex:1 1 auto; min-width:0; margin:2px !important; padding:4px 10px !important; font-size:16px !important; height:32px !important; }',
    '#ntp-dialog .ntp-btnrow .dialog-button { margin:2px 4px !important; padding:4px 14px !important; font-size:17px !important; height:32px !important; }',
    '#ntp-dialog .settings-item-text { width:230px; }',
    '#ntp-dialog .settings-item-slider { width:auto; }',
    '#ntp-dialog .settings-item-slider > input { width:150px; }',
    '#ntp-dialog .settings-item-slider-value { width:auto; min-width:40px; margin-left:10px; text-align:left; white-space:nowrap; }',
    '#ntp-dialog .ntp-note { max-width:560px; }',
    '#ntp-dialog .ntp-tab.ntp-active { outline:3px solid rgba(0,0,0,.45); }',
    '#ntp-dialog .ntp-btnrow { display:flex; flex-wrap:wrap; gap:8px; margin:6px 0 8px; }',
    '#ntp-dialog .ntp-btnrow .dialog-button { flex:1 1 auto; min-width:0; }',
    '#ntp-dialog .ntp-mypreset { display:inline-flex; align-items:center; }',
    '#ntp-dialog .ntp-btnrow .ntp-x { min-width:0 !important; width:30px; padding:0 !important; margin-left:-2px !important; font-size:15px !important; }',
    '#ntp-dialog .ntp-mix { display:flex; align-items:center; gap:8px; padding:3px 10px 3px 0; border-bottom:1px solid rgba(0,0,0,.1); }',
    '#ntp-dialog .ntp-mix-label { flex:1 1 auto; display:flex; flex-direction:column; font-size:14px; }',
    '#ntp-dialog .ntp-mix-label span { font-size:12px; opacity:.6; }',
    '#ntp-dialog .ntp-mix .ntp-diff { min-width:0 !important; width:84px; margin:0 6px 0 0 !important; padding:2px 0 !important; font-size:14px !important; height:28px !important; }',
    '#ntp-dialog .ntp-mix-n { width:28px; text-align:center; font-weight:800; font-size:16px; }',
    '#ntp-dialog .ntp-mix .ntp-small { min-width:0 !important; width:36px; margin:0 !important; padding:2px 0 !important; font-size:20px !important; height:30px !important; }',
    '#ntp-dialog .ntp-tut-head { font-weight:800; opacity:.7; font-size:13px; }',
    '#ntp-dialog .ntp-tut-dots { display:flex; gap:5px; margin:6px 0 2px; }',
    '#ntp-dialog .ntp-tut-dots span { width:22px; height:5px; border-radius:3px; background:rgba(0,0,0,.18); }',
    '#ntp-dialog .ntp-tut-dots span.on { background:rgba(0,0,0,.6); }',
    '#ntp-dialog .ntp-tut-p { margin:6px 0 8px; line-height:1.4; max-width:560px; }',
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
    b.tabIndex = -1;   // see the menu button's own comment on why
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

  var dialogEl = null, curtainEl = null, bodyEl = null, tabsEl = null;

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
    if (mode === 'range') {
      r.innerHTML = '<span>' + label + '</span>' +
        '<span><b>' + fmtPct(b.accuracy) + '</b> &middot; ' + b.hits + ' hits &middot; ' +
        b.headshots + ' heads &middot; longest ' + (b.longest || 0) + ' m</span>';
      return r;
    }
    if (mode === 'bots') {
      r.innerHTML = '<span>' + label + '</span>' +
        '<span><b>' + b.score + '</b> pts &middot; ' + b.hits + ' down &middot; ' +
        b.headshots + ' heads &middot; wave ' + b.wave + ' &middot; ' + fmtPct(b.accuracy) + '</span>';
      return r;
    }
    r.innerHTML = '<span>' + label + '</span>' +
      '<span><b>' + fmtPct(b.accuracy) + '</b> acc &middot; ' +
      b.hits + ' hits &middot; streak ' + b.bestStreak +
      ' &middot; ' + fmtMs(b.avgReaction) + ' avg</span>';
    return r;
  }

  /*
   * The menu is split into tabs so it isn't one long scroll: Range (start, mode, fight), Dummies
   * (how many, where, which kinds, what they've learned), Dummy stats, Records, the on-screen drills
   * and Help. The first time it opens, the tutorial shows instead.
   */
  var TABS = ['Range', 'Dummies', 'Dummy stats', 'Records', 'Screen drills', 'Help'];
  var tutStep = null;                       // null = not in the tutorial
  function fill(inner) {
    inner.textContent = '';
    if (!cfg.range_tutSeen) { cfg.range_tutSeen = 1; save(); tutStep = 0; }
    if (tabsEl) tabsEl.style.display = tutStep !== null ? 'none' : '';
    if (tutStep !== null) { fillTutorial(inner); return; }
    var tabs = tabsEl || document.createElement('div');           // the tabs sit above the scrolling list
    tabs.textContent = '';
    tabs.className = 'ntp-tabs';
    TABS.forEach(function (t, k) {
      var b = button(t, function () { cfg.range_uiTab = k; save(); refresh(); });
      b.className += ' ntp-tab' + ((cfg.range_uiTab || 0) === k ? ' ntp-active' : '');
      tabs.appendChild(b);
    });
    if (!tabsEl) inner.appendChild(tabs);
    [fillRangeTab, fillDummiesTab, fillStatsTab, fillRecordsTab, fillScreenTab, fillHelpTab][cfg.range_uiTab || 0](inner);
  }
  function btnRow(btns) {
    var r = document.createElement('div');
    r.className = 'ntp-btnrow';
    btns.forEach(function (b) { r.appendChild(b); });
    return r;
  }
  var MODE_INFO = [
    'Dummies do their own thing: hunt you, explore, take high ground, go for your flag. Pick how many and what kinds on the Dummies tab.',
    'One dummy that plays like a real 1v1 player with its bow. Rounds to a first-to score; shooting back and practice health are always on.',
    'Dummies in front of you each walk one pattern, so you can practice leading one kind of movement. They don\'t shoot.',
    'A goal against the clock. Your best for each challenge, bow and map goes on the board in Records.',
    'Survive on your practice health. Every wave adds a dummy; every third wave is a difficulty harder (starting from Difficulty below).',
    'You and dummy teammates against a dummy team, in rounds. If you die you\'re out until the next round.',
    'Every dummy goes for your flag (or the hill on maps without flags). Stop the carriers.'
  ];
  var PRESETS = [
    ['Warm-up', 'Easy dummies in front of you that don\'t shoot back', { range_mode: 0, range_diff: 1, range_count: 6, range_spawn: 1, range_band: 3, range_shoot: 0, range_dmg: 0, range_mixOn: 0, range_pers: 0, range_runners: 0 }],
    ['Real fight', 'Hard dummies from their base that shoot back and hurt', { range_mode: 0, range_diff: 3, range_count: 8, range_spawn: 0, range_shoot: 1, range_dmg: 1, range_mixOn: 0, range_pers: 1, range_runners: 1 }],
    ['Tracking', 'Mixed movement drill with distance rings', { range_mode: 2, range_drill: 5, range_count: 6, range_spawn: 1, range_band: 3, range_rings: 1 }],
    ['1v1 sweat', 'A Pro 1v1, first to 5', { range_mode: 1, range_diff: 4, range_firstTo: 5 }],
    ['Chaos (50)', '50 Hard dummies all over the map', { range_mode: 0, range_diff: 3, range_count: 50, range_spawn: 2, range_shoot: 1, range_dmg: 1, range_mixOn: 0, range_pers: 1, range_runners: 3 }]
  ];
  /* Your own presets: every range setting (mode, dummies, mix, stats...), not the menu's own state. */
  var MY_PRESETS_MAX = 12;
  var NOT_IN_PRESET = { range_uiTab: 1, range_tutSeen: 1, range_coachSeen: 1, range_myPresets: 1, range_histModeIdx: 1, range_histMetric: 1 };
  function saveMyPreset() {
    var name = prompt('Name for this preset:', 'My preset ' + ((cfg.range_myPresets || []).length + 1));
    if (name === null) return;
    name = String(name).trim().slice(0, 24) || 'My preset';
    var set = {};
    Object.keys(cfg).forEach(function (k) { if (k.indexOf('range_') === 0 && !NOT_IN_PRESET[k]) set[k] = JSON.parse(JSON.stringify(cfg[k])); });
    if (!cfg.range_myPresets) cfg.range_myPresets = [];
    var same = cfg.range_myPresets.findIndex(function (p) { return p.name === name; });
    if (same >= 0) cfg.range_myPresets[same].set = set; else cfg.range_myPresets.push({ name: name, set: set });
    save(); toast('Saved preset "' + name + '"'); refresh();
  }
  function applyPreset(p) {
    p = [p[0], p[1], JSON.parse(JSON.stringify(p[2]))];           // never share objects with the preset itself
    Object.keys(p[2]).forEach(function (k) { cfg[k] = p[2][k]; });
    save();
    if (range.on) restartRange();
    toast('Preset: ' + p[0] + (range.on ? ' (range restarted)' : ''));
    refresh();
  }
  function fillRangeTab(inner) {
    inner.appendChild(btnRow([
      button(range.on ? 'Stop range  (F9)' : 'Start range  (F9)', function () {
        if (range.on) { stopRange(); refresh(); return; }
        closeDialog();
        startRange();
      }),
      button('Tutorial', function () { tutStep = 0; refresh(); })
    ]));
    inner.appendChild(note(range.on ? 'Running: ' + RANGE_MODE_NAMES[rMode()] + '. Changing the mode (or a preset) restarts it.'
      : 'Practice dummies inside a real match, shot with your real bow. Join a match, then Start - or press F9 while playing. Only you see them.'));

    inner.appendChild(h3('Quick presets'));
    inner.appendChild(btnRow(PRESETS.map(function (p) { var b = button(p[0], function () { applyPreset(p); }); b.title = p[1]; return b; })));
    // your own presets: load (click), delete (x), and save the current setup
    var mine = cfg.range_myPresets || [];
    if (mine.length) {
      var row = btnRow([]);
      mine.forEach(function (p, k) {
        var b = button(p.name, function () { applyPreset([p.name, '', p.set]); });
        b.title = 'Your preset - click to load';
        var x = button('x', function () {
          if (!confirm('Delete your preset "' + p.name + '"?')) return;
          cfg.range_myPresets.splice(k, 1); save(); refresh();
        });
        x.className += ' ntp-x'; x.title = 'Delete this preset';
        var wrap = document.createElement('span'); wrap.className = 'ntp-mypreset';
        wrap.appendChild(b); wrap.appendChild(x); row.appendChild(wrap);
      });
      inner.appendChild(row);
    }
    inner.appendChild(btnRow([button('Save current setup as a preset', saveMyPreset, mine.length >= MY_PRESETS_MAX)]));

    inner.appendChild(h3('Mode'));
    inner.appendChild(namedSliderRow('Mode', 'range_mode', RANGE_MODE_NAMES, { refresh: true, restart: true }));
    inner.appendChild(note(MODE_INFO[rMode()] || ''));
    if (isRounds()) inner.appendChild(sliderRow(isTeam() ? 'Team fight: first to' : '1v1: first to', 'range_firstTo', 1, 10, 1, ' rounds'));
    if (isTeam()) inner.appendChild(namedSliderRow('Team size', 'range_team', ['2v2', '3v3'], { restart: true }));
    if (isDrill()) inner.appendChild(namedSliderRow('Pattern', 'range_drill', DRILL_NAMES, { restart: true }));
    if (isChal()) inner.appendChild(namedSliderRow('Challenge', 'range_chal', CHALS.map(function (c) { return c.name; }), { restart: true }));

    inner.appendChild(h3('Fight'));
    inner.appendChild(namedSliderRow(isWaves() ? 'Difficulty (wave 1)' : 'Difficulty', 'range_diff', DIFF_NAMES));
    inner.appendChild(namedSliderRow('Their bow', 'range_bow', BOT_BOWS.map(function (b) { return b.name; })));
    if (isDrill()) inner.appendChild(note('Drill dummies never shoot.'));
    else if (isDuel() || isWaves() || isTeam()) inner.appendChild(note('In this mode they always shoot back and hurt your practice health.'));
    else {
      inner.appendChild(namedSliderRow('Dummies shoot back', 'range_shoot', ['Off', 'On']));
      inner.appendChild(namedSliderRow('Dummies damage you (practice health)', 'range_dmg', ['Off', 'On']));
    }
    inner.appendChild(namedSliderRow('No natural deaths (water, falling: back to land)', 'range_noNat', ['Off', 'On']));

    inner.appendChild(h3('On screen'));
    inner.appendChild(namedSliderRow('Distance rings (10 / 25 / 50 / 75 m)', 'range_rings', ['Off', 'On']));
    inner.appendChild(namedSliderRow('Range HUD', 'range_hud', ['Full', 'Compact', 'Off']));
    inner.appendChild(namedSliderRow('HUD position', 'range_hudPos', HUD_POS));
    inner.appendChild(note('Keys while the range is on: F9 start / stop  ·  F8 respawn every dummy somewhere new  ·  Shift+F8 freeze / unfreeze them.'));
  }
  function fillDummiesTab(inner) {
    inner.appendChild(h3('How many and where'));
    if (isDuel()) inner.appendChild(note('1v1: always one dummy.'));
    else if (isTeam()) inner.appendChild(note('Team fight: ' + (teamSize() - 1) + ' teammate' + (teamSize() > 2 ? 's' : '') + ' and ' + teamSize() + ' enemies.'));
    else if (isWaves()) inner.appendChild(note('Waves: the wave decides how many (one more each wave).'));
    else if (mixOn()) inner.appendChild(note('Custom mix: ' + mixTotal() + ' dummies - set below.'));
    else inner.appendChild(sliderRow('Dummies', 'range_count', 1, MIX_MAX, 1, ''));
    if (effCountGuess() > 20) inner.appendChild(note('With lots of dummies, far ones you can\'t see update less often so the game stays smooth.'));
    inner.appendChild(namedSliderRow('Spawn at', 'range_spawn', SPAWN_NAMES, { refresh: true }));
    if (cfg.range_spawn === 1 || cfg.range_spawn === 3) inner.appendChild(namedSliderRow('Distance (in front of me)', 'range_band', BAND_NAMES));
    inner.appendChild(sliderRow('Dummy speed', 'range_speed', 1, 10, 0.5, ' m/s'));
    inner.appendChild(sliderRow('Respawn time', 'range_respawn', 0, 3, 0.25, 's'));

    inner.appendChild(h3('Kinds of dummies'));
    inner.appendChild(namedSliderRow('Kinds', 'range_mixOn', ['Automatic', 'Custom mix'], { refresh: true }));
    if (!cfg.range_mixOn) {
      inner.appendChild(sliderRow('Objective runners (flag / hill)', 'range_runners', 0, MIX_MAX, 1, ''));
      inner.appendChild(namedSliderRow('Personalities', 'range_pers', PERS_NAMES));
      inner.appendChild(note('Automatic: each dummy picks hunting, exploring or high ground by itself (plus the runners). Personalities make them campers, rushers or flankers instead.'));
    } else {
      inner.appendChild(note('Exactly how many of each kind (up to ' + MIX_MAX + ' in all), and each kind\'s difficulty - click it to change ("Same" uses the Difficulty on the Range tab). Used in Normal range and Timed challenge.'));
      fillMixEditor(inner);
    }
    inner.appendChild(h3('What the dummies have learned'));
    var bs = loadBrains(), mapsN = Object.keys(bs).length, wallsN = 0, bumpsN = 0;
    Object.keys(bs).forEach(function (k) {
      bumpsN += bs[k].bumps || 0;
      for (var e in bs[k].edges) { var v = bs[k].edges[e]; if (v[0] >= 2 && v[0] > v[1] * 1.5) wallsN++; }
    });
    inner.appendChild(note('Every time a dummy walks into a wall it remembers it, and all dummies share that memory for the map, ' +
      'so they get smarter the more you play. How much of it each one is told depends on difficulty (Easy a quarter, Pro all), ' +
      'and each also has its own memory with a learning cap. Saved in this browser - export it to share with friends.'));
    var stats = document.createElement('div');
    stats.className = 'ntp-best';
    stats.innerHTML = '<span>' + mapsN + ' map' + (mapsN === 1 ? '' : 's') + '</span><span><b>' + wallsN + '</b> walls known &middot; ' + bumpsN + ' bumps so far</span>';
    inner.appendChild(stats);
    var br = document.createElement('div');
    br.style.cssText = 'display:flex; gap:8px; margin:6px 0 4px; flex-wrap:wrap;';
    br.appendChild(button('Export', function () {
      saveBrains(true);
      var blob = new Blob([JSON.stringify({ kind: 'narrowone-dummy-brain', v: 1, maps: loadBrains() })], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'narrow-one-dummy-brain.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    }));
    br.appendChild(button('Import (adds to it)', function () {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.json,application/json';
      inp.addEventListener('change', function () {
        var file = inp.files && inp.files[0];
        if (!file) return;
        file.text().then(function (txt) {
          var data = JSON.parse(txt);
          if (!data || data.kind !== 'narrowone-dummy-brain' || !data.maps) throw new Error('not a dummy brain file');
          mergeBrains(data.maps);
          refresh();
        }).catch(function (e) { alert('Could not import: ' + e.message); });
      });
      inp.click();
    }));
    br.appendChild(button('Forget everything', function () {
      if (!confirm('Forget everything the dummies have learned on every map?')) return;
      brains = {}; brain = null; brainDirty = true; saveBrains(true); refresh();
    }));
    inner.appendChild(br);

  }
  function effCountGuess() { return isDuel() ? 1 : isTeam() ? teamSize() * 2 - 1 : isWaves() ? 30 : mixOn() ? mixTotal() : cfg.range_count; }
  function fillMixEditor(inner) {
    if (!cfg.range_mix || typeof cfg.range_mix !== 'object') cfg.range_mix = {};
    var total = mixTotal();
    MIX_TYPES.forEach(function (t) {
      var n = Math.max(0, Math.floor(+cfg.range_mix[t[0]] || 0));
      var r = document.createElement('div');
      r.className = 'ntp-mix';
      var l = document.createElement('div');
      l.className = 'ntp-mix-label';
      l.innerHTML = '<b></b><span></span>';
      l.firstChild.textContent = t[1]; l.lastChild.textContent = t[2];
      var minus = button('-', function () { setMix(t[0], n - 1); }, n <= 0);
      var val = document.createElement('div'); val.className = 'ntp-mix-n'; val.textContent = n;
      var plus = button('+', function () { setMix(t[0], n + 1); }, total >= MIX_MAX);
      minus.className += ' ntp-small'; plus.className += ' ntp-small';
      if (!cfg.range_mixDiff) cfg.range_mixDiff = {};
      var kd = cfg.range_mixDiff[t[0]], kdi = typeof kd === 'number' ? kd : -1;
      var dBtn = button(kdi < 0 ? 'Same' : DIFF_NAMES[kdi], function () {
        cfg.range_mixDiff[t[0]] = kdi + 1 >= DIFF_NAMES.length ? -1 : kdi + 1; mixChanged();
      });
      dBtn.className += ' ntp-diff';
      dBtn.title = 'Difficulty for ' + t[1] + ' (click to change). "Same" = the Difficulty on the Range tab.';
      r.appendChild(l); r.appendChild(dBtn); r.appendChild(minus); r.appendChild(val); r.appendChild(plus);
      inner.appendChild(r);
    });
    var tot = document.createElement('div');
    tot.className = 'ntp-best';
    tot.innerHTML = '<span>Total</span><span><b>' + total + '</b> / ' + MIX_MAX + '</span>';
    inner.appendChild(tot);
    inner.appendChild(btnRow([
      button('A bit of everything', function () { MIX_TYPES.forEach(function (t) { cfg.range_mix[t[0]] = t[0] === 'still' ? 0 : 1; }); mixChanged(); }),
      button('Clear', function () { cfg.range_mix = {}; mixChanged(); })
    ]));
  }
  function setMix(type, n) {
    var others = mixTotal() - Math.max(0, Math.floor(+cfg.range_mix[type] || 0));
    cfg.range_mix[type] = Math.max(0, Math.min(n, MIX_MAX - others));
    mixChanged();
  }
  function mixChanged() {
    save();
    if (range.on && mixOn()) respawnAll(true);                    // the new kinds take over straight away
    refresh();
  }
  function fillStatsTab(inner) {
    inner.appendChild(h3('Dummy stats'));
    inner.appendChild(note('Give the dummies any stats - past what any player can have, up to infinity (type a number, or "inf"). ' +
      'They work the way stats work in the game, just without the cap. The normal max is shown on each. ' +
      'Melee and Stun stats aren\'t here because dummies don\'t melee you and can\'t stun you.'));
    if (!cfg.range_stats) cfg.range_stats = {};
    BOT_STATS.forEach(function (st) { inner.appendChild(statRow(st)); });
    var sr = document.createElement('div');
    sr.style.cssText = 'display:flex; gap:8px; margin:6px 0 4px; flex-wrap:wrap;';
    sr.appendChild(button('All max', function () { BOT_STATS.forEach(function (st) { cfg.range_stats[st[0]] = st[2]; }); save(); refresh(); }));
    sr.appendChild(button('All infinite', function () { BOT_STATS.forEach(function (st) { cfg.range_stats[st[0]] = 'inf'; }); save(); refresh(); }));
    sr.appendChild(button('Reset to 0', function () { cfg.range_stats = {}; save(); refresh(); }));
    inner.appendChild(sr);

  }
  var HIST_METRICS = [
    ['Kills', function (e) { return e.kills; }, ''],
    ['Hit %', function (e) { return e.shots ? e.acc : undefined; }, '%'],
    ['Headshot %', function (e) { return e.hits ? Math.round(e.heads / e.hits * 100) : undefined; }, '%'],
    ['Avg hit distance', function (e) { return e.hits ? e.avg : undefined; }, ' m'],
    ['Challenge / waves results', null, '']
  ];
  /** A graph of your last 30 sessions: pick the mode and what to show. */
  function fillHistory(inner) {
    var all = state.sessions || [];
    if (typeof cfg.range_histModeIdx !== 'number') cfg.range_histModeIdx = 0;
    if (typeof cfg.range_histMetric !== 'number') cfg.range_histMetric = 0;
    var modeF = cfg.range_histModeIdx - 1, met = cfg.range_histMetric;      // modeF -1 = all modes
    inner.appendChild(namedSliderRow('Show', 'range_histMetric', HIST_METRICS.map(function (m) { return m[0]; }), { refresh: true }));
    if (met !== 4) inner.appendChild(namedSliderRow('Mode', 'range_histModeIdx', ['All modes'].concat(RANGE_MODE_NAMES), { refresh: true }));
    var pts = [], unit = HIST_METRICS[met][2], label = HIST_METRICS[met][0];
    if (met === 4) {
      // challenge / waves results: the one you've played most
      var counts = {};
      all.forEach(function (e) { if (e.result) counts[e.result] = (counts[e.result] || 0) + 1; });
      var top = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
      if (top) {
        all.filter(function (e) { return e.result === top; }).slice(-30).forEach(function (e) { pts.push({ v: e.unit === 'ms' ? +(e.val / 1000).toFixed(1) : e.val, at: e.at }); });
        unit = all.find(function (e) { return e.result === top; }).unit === 'ms' ? ' s' : '';
        label = top + (unit === ' s' ? ' (time - lower is better)' : '');
      }
    } else {
      all.filter(function (e) { return !e.result && (modeF < 0 || e.mode === modeF); }).slice(-30).forEach(function (e) {
        var v = HIST_METRICS[met][1](e); if (typeof v === 'number') pts.push({ v: v, at: e.at });
      });
    }
    if (pts.length < 2) { inner.appendChild(note('Play a couple of sessions (' + (met === 4 ? 'challenges or waves' : 'start and stop the range') + ') and your history shows up here.')); return; }
    var W = 360, H = 120, P = 30, max = Math.max.apply(null, pts.map(function (p) { return p.v; })), min = 0;
    if (unit === '%') max = 100;
    if (!(max > min)) max = min + 1;
    var X = function (i) { return P + i / (pts.length - 1) * (W - P - 8); }, Y = function (v) { return 8 + (1 - (v - min) / (max - min)) * (H - 26); };
    var grid = [0, 0.5, 1].map(function (q) { var v = min + (max - min) * q, y = Y(v).toFixed(1);
      return '<line x1="' + P + '" x2="' + (W - 8) + '" y1="' + y + '" y2="' + y + '" stroke="rgba(0,0,0,.15)"/><text x="2" y="' + (+y + 3) + '" fill="#555">' + (Math.round(v * 10) / 10) + '</text>'; }).join('');
    var line = pts.map(function (p, i) { return X(i).toFixed(1) + ',' + Y(p.v).toFixed(1); }).join(' ');
    var dots = pts.map(function (p, i) { return '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(p.v).toFixed(1) + '" r="2.5" fill="#1d5fd0"><title>' + new Date(p.at).toLocaleString() + ': ' + p.v + unit + '</title></circle>'; }).join('');
    var last = pts[pts.length - 1].v, nAvg = Math.max(1, Math.min(5, Math.floor(pts.length / 2))), firsts = pts.slice(0, nAvg), lasts = pts.slice(-nAvg);   // never overlapping
    var avgF = firsts.reduce(function (a, p) { return a + p.v; }, 0) / firsts.length, avgL = lasts.reduce(function (a, p) { return a + p.v; }, 0) / lasts.length;
    var g = document.createElement('div');
    g.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:' + W + 'px;display:block;font:10px system-ui,sans-serif">' + grid +
      '<polyline fill="none" stroke="#1d5fd0" stroke-width="2" stroke-linejoin="round" points="' + line + '"/>' + dots +
      '<text x="' + P + '" y="' + (H - 2) + '" fill="#555">oldest</text><text x="' + (W - 8) + '" y="' + (H - 2) + '" fill="#555" text-anchor="end">latest: ' + last + unit + '</text></svg>';
    inner.appendChild(g);
    var better = unit === ' s' ? avgL < avgF : avgL > avgF;
    inner.appendChild(note(label + ' over your last ' + pts.length + ': first few averaged ' + (Math.round(avgF * 10) / 10) + unit + ', latest few ' + (Math.round(avgL * 10) / 10) + unit +
      (Math.abs(avgL - avgF) < 0.05 ? '.' : better ? ' - getting better!' : ' - a bit down lately.')));
  }
  function fillRecordsTab(inner) {
    inner.appendChild(h3('Session history'));
    fillHistory(inner);
    inner.appendChild(h3('Your aim (in-game range)'));
    fillAim(inner);
    inner.appendChild(h3('Challenge high scores'));
    fillChalBoard(inner);

    inner.appendChild(h3('Personal bests'));
    inner.appendChild(bestRow('Static', 'static'));
    inner.appendChild(bestRow('Moving', 'moving'));
    inner.appendChild(bestRow('Bot Range', 'bots'));
    inner.appendChild(bestRow('In-game range', 'range'));

    if (state.history.length) {
      inner.appendChild(h3('Recent sessions'));
      state.history.slice(0, 5).forEach(function (s) {
        var r = document.createElement('div');
        r.className = 'ntp-best';
        var when = new Date(s.at).toLocaleString();
        r.innerHTML = '<span>' + (MODE_NAMES[s.mode] || s.mode) +
          ' &middot; ' + when + '</span>' +
          '<span>' + (s.mode === 'bots' ? s.score + ' pts &middot; ' : '') +
          fmtPct(s.accuracy) + ' acc &middot; ' + s.hits + ' hits</span>';
        inner.appendChild(r);
      });
    }
  }
  function fillScreenTab(inner) {
    inner.appendChild(h3('Practice'));
    inner.appendChild(note('Press and hold to draw, release to shoot - same as the bow. ' +
      'This never touches a real match; it is just a range.'));

    var modes = document.createElement('div');
    modes.className = 'ntp-modes';
    ['static', 'moving', 'bots'].forEach(function (m) {
      var b = button(MODE_NAMES[m], function () {
        cfg.mode = m; save(); refresh();
      });
      b.className += ' ntp-mode-btn' + (cfg.mode === m ? ' ntp-active' : '');
      modes.appendChild(b);
    });
    inner.appendChild(modes);
    inner.appendChild(note(cfg.mode === 'static'
      ? 'One target at a time. Miss the window and it moves on.'
      : cfg.mode === 'moving'
        ? 'One target, always moving. Every shot that lands counts.'
        : 'Practice dummies that run, strafe and jump on three lanes. Body hit = 1 point, headshot = 2. ' +
          'Only on your screen - no coins, no real stats, nothing sent to the game.'));

    inner.appendChild(startRow());

    inner.appendChild(h3('Settings'));
    inner.appendChild(sliderRow('Target size', 'targetSize', 14, 60, 2, 'px'));
    inner.appendChild(sliderRow('Session length', 'duration', 10, 120, 5, 's'));
    if (cfg.mode === 'moving') {
      inner.appendChild(sliderRow('Target speed', 'moveSpeed', 80, 600, 20, 'px/s'));
    } else if (cfg.mode === 'bots') {
      inner.appendChild(sliderRow('Dummies at once', 'botCount', 1, 10, 1, ''));
      inner.appendChild(sliderRow('Respawn time', 'botRespawn', 0, 3, 0.25, 's'));
      inner.appendChild(sliderRow('Dummy speed', 'botSpeed', 60, 500, 20, 'px/s'));
      inner.appendChild(sliderRow('Waves (0 = off, 1 = on)', 'botWaves', 0, 1, 1, ''));
    } else {
      inner.appendChild(sliderRow('Time to react', 'lifetime', 500, 3000, 100, 'ms'));
    }

  }
  function fillHelpTab(inner) {
    inner.appendChild(btnRow([button('Start the tutorial', function () { tutStep = 0; refresh(); })]));
    TUTORIAL.forEach(function (st) {
      inner.appendChild(h3(st[0]));
      st[1].forEach(function (t) { inner.appendChild(note(t)); });
    });
  }
  var TUTORIAL = [
    ['Welcome to Target Practice', [
      'Target Practice puts practice dummies into a real Narrow One match. You shoot them with your real bow, so the arrow speed and drop are exactly the game\'s - whichever bow you hold.',
      'Only you can see them. Nothing is sent to the game: no coins, no real stats, the real flag and score are never touched, and other players aren\'t affected.']],
    ['1. Get into a match', [
      'Join any match - a quiet server or a private game is best, so nobody shoots you while you practice. The dummies are built around you in that map.',
      'The very first time, the mod may ask you to reload the page once so it can hook into the game.']],
    ['2. Start the range', [
      'Open this menu and press "Start range" on the Range tab, or press F9 while playing. F9 again stops it, and you get a summary of how you did.',
      'Not sure what to pick? Try a quick preset: Warm-up, Real fight, Tracking, 1v1 sweat or Chaos (50).']],
    ['3. Pick a mode', [
      'Normal range: dummies do their own thing.  1v1 duel: one tough opponent, in rounds.  Movement drill: one movement pattern to track.',
      'Timed challenge: beat your best time or score.  Waves: survive as long as you can.  Team fight: you and dummy teammates vs a dummy team.  Flag defense: they all go for your flag.']],
    ['4. Choose your dummies', [
      'On the Dummies tab: how many (up to 50), where they spawn (their base, in front of you, anywhere on the map, or a mix), speed and respawn time.',
      'Kinds: leave it on Automatic, or pick a Custom mix - exactly how many hunters, explorers, campers, rushers, flankers, flag runners and so on.',
      'Dummy stats lets you give them any stats, even past the max. Difficulty (Range tab) decides how smart they are, from Stationary to Hacker.']],
    ['5. Shoot!', [
      'Each dummy has a health bar with what it\'s doing over its head. Hits show the damage and distance; headshots are yellow. Melee works too.',
      'The HUD at the top shows your kills, hits, accuracy and the mode\'s score - make it compact, move it, or hide it on the Range tab.',
      'If the dummies can hurt you, a second "Practice" health bar appears under yours. Your real health is never touched.']],
    ['6. Handy keys', [
      'F9: start / stop the range.  F8: respawn every dummy somewhere new.  Shift+F8: freeze them (handy to line up a shot or take a break).']],
    ['7. Get better', [
      'The Records tab keeps your hit %, headshot % and average hit distance for every bow, with a graph of how you improve, plus your challenge and waves high scores.',
      'The dummies also learn the maps as you play (and survey a new map by themselves), so they get smarter over time. You can export what they\'ve learned and share it.']]
  ];
  function fillTutorial(inner) {
    var st = TUTORIAL[tutStep];
    var head = document.createElement('div');
    head.className = 'ntp-tut-head';
    head.textContent = 'Tutorial  ·  ' + (tutStep + 1) + ' of ' + TUTORIAL.length;
    inner.appendChild(head);
    var dots = document.createElement('div');
    dots.className = 'ntp-tut-dots';
    TUTORIAL.forEach(function (x, k) { var d = document.createElement('span'); if (k <= tutStep) d.className = 'on'; dots.appendChild(d); });
    inner.appendChild(dots);
    inner.appendChild(h3(st[0]));
    st[1].forEach(function (t) { var p = document.createElement('p'); p.className = 'ntp-tut-p'; p.textContent = t; inner.appendChild(p); });
    var last = tutStep === TUTORIAL.length - 1;
    inner.appendChild(btnRow([
      button('Back', function () { tutStep--; refresh(); }, tutStep === 0),
      button(last ? 'Done' : 'Next', function () { if (last) { tutStep = null; cfg.range_uiTab = 0; save(); } else tutStep++; refresh(); }),
      button('Skip', function () { tutStep = null; refresh(); }, last)
    ]));
  }

  /** Hit %, headshot % and average hit distance per bow, and a graph of your sessions. */
  function fillAim(inner) {
    var A = state.aim, names = A ? Object.keys(A.bows).filter(function (n) { return A.bows[n].shots > 0; }) : [];
    if (!names.length) { inner.appendChild(note('Shoot dummies in the in-game range and your hit %, headshot % and hit distance show up here for every bow, with a graph of how you improve.')); return; }
    names.sort(function (a, b) { return A.bows[b].shots - A.bows[a].shots; });
    var best = null;
    names.forEach(function (n) {
      var b = A.bows[n], r = document.createElement('div');
      r.className = 'ntp-best';
      var acc = b.hits / b.shots * 100;
      if (b.shots >= 20 && (!best || acc > best.acc)) best = { n: n, acc: acc };
      var l = document.createElement('span'); l.textContent = n;
      var v = document.createElement('span');
      v.textContent = Math.round(acc) + '% hit · ' + (b.hits ? Math.round(b.heads / b.hits * 100) : 0) + '% headshots · avg ' +
        (b.hits ? Math.round(b.dist / b.hits) : 0) + ' m · ' + b.shots + ' arrows';
      r.appendChild(l); r.appendChild(v); inner.appendChild(r);
    });
    if (best && names.length > 1) inner.appendChild(note('You aim best with ' + best.n + ' (' + Math.round(best.acc) + '% of arrows hit).'));
    var ss = A.sessions.filter(function (x) { return x.shots >= 3; }).slice(-30);
    if (ss.length < 2) return;
    var W = 320, H = 96, P = 22;
    function line(vals, col) {
      return '<polyline fill="none" stroke="' + col + '" stroke-width="2" stroke-linejoin="round" points="' + vals.map(function (v, i) {
        return (P + i / (vals.length - 1) * (W - P - 6)).toFixed(1) + ',' + (6 + (1 - v / 100) * (H - 18)).toFixed(1);
      }).join(' ') + '"/>';
    }
    var g = document.createElement('div');
    g.style.cssText = 'margin:6px 0 2px;';
    g.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:' + W + 'px;display:block;font:10px system-ui,sans-serif">' +
      [0, 50, 100].map(function (p) { var y = (6 + (1 - p / 100) * (H - 18)).toFixed(1); return '<line x1="' + P + '" x2="' + (W - 6) + '" y1="' + y + '" y2="' + y + '" stroke="rgba(255,255,255,.18)"/><text x="2" y="' + (+y + 3) + '" fill="#ccc">' + p + '%</text>'; }).join('') +
      line(ss.map(function (x) { return x.hits / x.shots * 100; }), '#ffffff') +
      line(ss.map(function (x) { return x.hits ? x.heads / x.hits * 100 : 0; }), '#ffd23b') +
      '<text x="' + P + '" y="' + (H - 1) + '" fill="#fff">hit %</text><text x="' + (P + 40) + '" y="' + (H - 1) + '" fill="#ffd23b">headshot %</text>' +
      '<text x="' + (W - 6) + '" y="' + (H - 1) + '" fill="#ccc" text-anchor="end">last ' + ss.length + ' sessions</text></svg>';
    inner.appendChild(g);
  }
  function fillChalBoard(inner) {
    var recs = Object.keys(state.chal || {}).map(function (k) { return state.chal[k]; });
    if (!recs.length) { inner.appendChild(note('Play a Timed challenge or Waves and your best for each challenge, bow and map is kept here.')); return; }
    recs.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : (b.last || b.at) - (a.last || a.at); });
    recs.slice(0, 20).forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'ntp-best';
      var l = document.createElement('span'); l.textContent = r.name + ' · ' + r.bow + ' · ' + r.map;
      var v = document.createElement('span'); v.textContent = fmtChal(r.best, r.unit);
      v.style.fontWeight = '800';
      row.appendChild(l); row.appendChild(v); inner.appendChild(row);
    });
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

  function sliderRow(label, key, min, max, step, unit, opts) {
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
    rowOpts(si, opts);
    sl.appendChild(si); sl.appendChild(sv); kr.appendChild(sl);
    return kr;
  }

  /** One stat in the dummy stat editor: a box you type points into (any number, or "inf"). */
  function statRow(st) {
    var kr = document.createElement('label');
    kr.className = 'settings-item';
    var kt = document.createElement('div');
    kt.className = 'settings-item-text';
    kt.textContent = st[1] + ' (max ' + st[2] + ')';
    kt.title = st[3];
    kr.appendChild(kt);
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'dialog-text-input';
    inp.style.cssText = 'width:80px;text-align:right;';
    var cur = cfg.range_stats[st[0]];
    inp.value = cur === 'inf' ? '∞' : String(cur || 0);
    inp.addEventListener('change', function () {
      var raw = String(inp.value).trim().toLowerCase();
      if (raw === '∞' || raw === 'inf' || raw === 'infinity' || raw === 'infinite') { cfg.range_stats[st[0]] = 'inf'; inp.value = '∞'; }
      else {
        var n = Number(raw);
        if (!(n >= 0) || !isFinite(n)) n = 0;
        cfg.range_stats[st[0]] = n; inp.value = String(n);
      }
      save();
    });
    kr.appendChild(inp);
    return kr;
  }
  /** A slider whose positions have names (0..names.length-1). */
  function namedSliderRow(label, key, names, opts) {
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
    si.type = 'range'; si.min = 0; si.max = names.length - 1; si.step = 1; si.value = cfg[key];
    var sv = document.createElement('div');
    sv.className = 'settings-item-slider-value';
    sv.textContent = names[cfg[key]] || '';
    si.addEventListener('input', function () {
      cfg[key] = Number(si.value);
      sv.textContent = names[cfg[key]];
      save();
    });
    rowOpts(si, opts);
    sl.appendChild(si); sl.appendChild(sv); kr.appendChild(sl);
    return kr;
  }

  /** When a slider is let go: rebuild the menu (rows that depend on it), and/or restart a running range. */
  function rowOpts(si, opts) {
    if (!opts) return;
    si.addEventListener('change', function () {
      if (opts.restart && range.on) restartRange();
      if (opts.refresh || opts.restart) setTimeout(refresh, 0);
    });
  }
  function refresh() {
    if (!bodyEl) return;
    fill(bodyEl);
    guardFocus(bodyEl);
  }

  // Never a Tab-navigation stop - the game silently drops every keydown
  // while any BUTTON/INPUT/SELECT has focus (its own inputHasFocus()
  // check). fill() rebuilds the sliders/mode buttons from scratch on
  // nearly every interaction, so this has to run every time, not just once.
  function guardFocus(root) {
    root.querySelectorAll('button, input, select').forEach(function (el) { el.tabIndex = -1; });
  }

  function closeDialog() {
    bodyEl = null; tabsEl = null;
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

    tabsEl = document.createElement('div');
    dialogEl.appendChild(tabsEl);
    var list = document.createElement('div');
    list.className = 'settings-list';
    list.style.width = 'min(600px, 86vw)';                       // the same width on every tab
    list.style.maxHeight = 'min(460px, 58vh)';
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

    /* ---- Bot Range: practice dummies that run, strafe and jump ---- */

    // Three lanes, far to near: higher up the screen, smaller and slower when far away.
    var LANES = [{ y: 0.47, scale: 0.6 }, { y: 0.66, scale: 0.8 }, { y: 0.88, scale: 1.0 }];
    var GRAVITY = 1700;            // px/s^2 at scale 1
    var bots = [], score = 0, headshots = 0, wave = 1, waveKills = 0, waveBannerUntil = 0;
    function waveTarget() { return 5 + wave * 2; }                     // downs needed to clear this wave
    function waveCount() { return cfg.botWaves ? Math.min(12, cfg.botCount + wave - 1) : cfg.botCount; }
    function waveSpeed() { return cfg.botSpeed * (cfg.botWaves ? 1 + 0.12 * (wave - 1) : 1); }

    function newBot(now) {
      var lane = LANES[Math.floor(Math.random() * LANES.length)];
      var dir = Math.random() < 0.5 ? -1 : 1;
      return {
        lane: lane, x: rand(margin, W - margin), jumpY: 0, jumpV: 0,
        dir: dir, speedMul: rand(0.7, 1.25),
        nextTurn: now + rand(400, 1500), nextJump: now + rand(1200, 3500),
        spawnedAt: now, downAt: 0, alive: true, hitFlash: 0, hitHead: false
      };
    }
    function botShape(b) {
      // Sizes come from the Target size slider so the range scales with it.
      var s = b.lane.scale * R / 32;
      var feetY = b.lane.y * H - b.jumpY;
      var headR = 11 * s, bodyW = 22 * s, bodyH = 30 * s, legH = 22 * s;
      return {
        s: s, feetY: feetY, headR: headR, headX: b.x, headY: feetY - legH - bodyH - headR,
        bodyX: b.x - bodyW / 2, bodyY: feetY - legH - bodyH, bodyW: bodyW, bodyH: bodyH, legH: legH
      };
    }
    function initBots() {
      var now = performance.now();
      bots = [];
      for (var i = 0; i < waveCount(); i++) bots.push(newBot(now));
    }
    function updateBots(now, dt) {
      // keep the right number of dummies for this wave
      while (bots.length < waveCount()) bots.push(newBot(now));
      for (var i = bots.length - 1; i >= 0; i--) {
        var b = bots[i];
        if (!b.alive) {
          if (now - b.downAt >= cfg.botRespawn * 1000) {
            if (bots.length > waveCount()) bots.splice(i, 1);
            else bots[i] = newBot(now);
          }
          continue;
        }
        moveBot(b, now, dt);
      }
    }
    function moveBot(b, now, dt) {
      {
        var sp = waveSpeed() * b.speedMul * b.lane.scale;
        if (now >= b.nextTurn) {                                    // strafe: change direction, sometimes stop
          var r = Math.random();
          b.dir = r < 0.15 ? 0 : (r < 0.6 ? -b.dir || 1 : b.dir || -1);
          b.nextTurn = now + rand(350, 1400);
        }
        if (now >= b.nextJump && b.jumpY === 0) {                   // jump
          b.jumpV = 620 * b.lane.scale;
          b.nextJump = now + rand(1200, 3800);
        }
        b.x += b.dir * sp * dt;
        if (b.x < margin) { b.x = margin; b.dir = 1; }
        if (b.x > W - margin) { b.x = W - margin; b.dir = -1; }
        if (b.jumpV !== 0 || b.jumpY > 0) {
          b.jumpY += b.jumpV * dt;
          b.jumpV -= GRAVITY * b.lane.scale * dt;
          if (b.jumpY <= 0) { b.jumpY = 0; b.jumpV = 0; }
        }
      }
    }
    /** Which dummy (and whether the head) is under the shot. Near lanes are in front, so they're checked first. */
    function botAt(x, y) {
      var order = bots.filter(function (b) { return b.alive; })
        .sort(function (a, b2) { return b2.lane.y - a.lane.y; });
      for (var i = 0; i < order.length; i++) {
        var sh = botShape(order[i]);
        var dx = x - sh.headX, dy = y - sh.headY;
        if (dx * dx + dy * dy <= sh.headR * sh.headR) return { bot: order[i], head: true };
        var legW = sh.bodyW * 0.8;
        if ((x >= sh.bodyX && x <= sh.bodyX + sh.bodyW && y >= sh.bodyY && y <= sh.bodyY + sh.bodyH) ||
            (x >= order[i].x - legW / 2 && x <= order[i].x + legW / 2 && y >= sh.feetY - sh.legH && y <= sh.feetY)) {
          return { bot: order[i], head: false };
        }
      }
      return null;
    }
    function shootBots(x, y) {
      var now = performance.now();
      var hit = botAt(x, y);
      if (!hit) { registerMiss(); return; }
      var b = hit.bot;
      b.alive = false; b.downAt = now; b.hitHead = hit.head;
      hits++; streak++;
      if (streak > bestStreak) bestStreak = streak;
      reactions.push(now - b.spawnedAt);
      score += hit.head ? 2 : 1;
      if (hit.head) headshots++;
      popups.push({ x: x, y: y, text: hit.head ? '+2 HEADSHOT' : '+1', at: now });
      waveKills++;
      if (cfg.botWaves && waveKills >= waveTarget()) {
        wave++; waveKills = 0; waveBannerUntil = now + 1500;
      }
    }
    var popups = [];
    function drawBots(now) {
      LANES.forEach(function (l) {                                 // lane ground lines
        ctx.beginPath();
        ctx.moveTo(0, l.y * H); ctx.lineTo(W, l.y * H);
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.12 + 0.12 * l.scale) + ')';
        ctx.lineWidth = 2 * l.scale;
        ctx.stroke();
      });
      bots.slice().sort(function (a, b) { return a.lane.y - b.lane.y; }).forEach(function (b) {
        var sh = botShape(b);
        var down = !b.alive;
        var fade = down ? Math.max(0, 1 - (now - b.downAt) / 400) : 1;
        if (fade <= 0) return;
        ctx.save();
        ctx.globalAlpha = fade;
        var body = down ? (b.hitHead ? '#ffd23b' : '#ffffff') : '#c9473b';
        // legs, animated while running
        var swing = b.alive && b.dir !== 0 && b.jumpY === 0 ? Math.sin(now / 90 + b.x) * 6 * sh.s : 0;
        ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 6 * sh.s; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(b.x - 4 * sh.s, sh.feetY - sh.legH); ctx.lineTo(b.x - 4 * sh.s + swing, sh.feetY);
        ctx.moveTo(b.x + 4 * sh.s, sh.feetY - sh.legH); ctx.lineTo(b.x + 4 * sh.s - swing, sh.feetY);
        ctx.stroke();
        // body
        ctx.fillStyle = 'rgba(0,0,0,.35)';
        ctx.fillRect(sh.bodyX - 2, sh.bodyY - 2, sh.bodyW + 4, sh.bodyH + 4);
        ctx.fillStyle = body;
        ctx.fillRect(sh.bodyX, sh.bodyY, sh.bodyW, sh.bodyH);
        // head
        ctx.beginPath(); ctx.arc(sh.headX, sh.headY, sh.headR + 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
        ctx.beginPath(); ctx.arc(sh.headX, sh.headY, sh.headR, 0, Math.PI * 2);
        ctx.fillStyle = down ? body : '#f0c9a0'; ctx.fill();
        ctx.restore();
      });
      popups = popups.filter(function (p) { return now - p.at < 700; });
      popups.forEach(function (p) {
        var t = (now - p.at) / 700;
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.font = '800 16px system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = '#000';
        ctx.strokeText(p.text, p.x, p.y - 20 - 30 * t);
        ctx.fillStyle = p.text.indexOf('HEAD') !== -1 ? '#ffd23b' : '#fff';
        ctx.fillText(p.text, p.x, p.y - 20 - 30 * t);
        ctx.restore();
      });
      if (now < waveBannerUntil) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, (waveBannerUntil - now) / 400);
        ctx.font = '900 46px system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 6; ctx.strokeStyle = '#000';
        ctx.strokeText('WAVE ' + wave, W / 2, H * 0.3);
        ctx.fillStyle = '#fff';
        ctx.fillText('WAVE ' + wave, W / 2, H * 0.3);
        ctx.restore();
      }
    }

    if (mode === 'static') spawnStatic();
    else if (mode === 'moving') spawnMoving(true);
    else initBots();

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
      if (mode === 'bots') { shootBots(x, y); return; }
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

    var raf = null, lastFrame = performance.now();
    function loop(now) {
      if (ended) return;
      raf = requestAnimationFrame(loop);
      var frameDt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;

      if (mode === 'bots') {
        updateBots(now, frameDt);
        ctx.clearRect(0, 0, W, H);
        drawBots(now);
        drawRing(now);
        var leftB = Math.max(0, endsAt - now);
        hud.innerHTML =
          '<div><span>Time</span>' + Math.ceil(leftB / 1000) + 's</div>' +
          '<div><span>Score</span>' + score + '</div>' +
          '<div><span>Down</span>' + hits + '</div>' +
          '<div><span>Heads</span>' + headshots + '</div>' +
          '<div><span>Misses</span>' + misses + '</div>' +
          (cfg.botWaves ? '<div><span>Wave</span>' + wave + ' (' + waveKills + '/' + waveTarget() + ')</div>' : '');
        if (now >= endsAt) finish(false);
        return;
      }

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

      drawRing(now);

      var left = Math.max(0, endsAt - now);
      hud.innerHTML =
        '<div><span>Time</span>' + Math.ceil(left / 1000) + 's</div>' +
        '<div><span>Hits</span>' + hits + '</div>' +
        '<div><span>Misses</span>' + misses + '</div>' +
        '<div><span>Streak</span>' + streak + '</div>';

      if (now >= endsAt) finish(false);
    }

    // the draw ring - grows while the mouse is held, purely visual.
    function drawRing(now) {
      if (!drawing || !lastMouse) return;
      var held = now - drawStart;
      ctx.beginPath();
      ctx.arc(lastMouse.x, lastMouse.y, Math.min(30, 6 + held / 20), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
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
        bestStreak: bestStreak, avgReaction: avgReaction, early: early,
        score: score, headshots: headshots, wave: wave
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

    var lines = [['Mode', MODE_NAMES[r.mode] || r.mode]];
    if (r.mode === 'bots') {
      lines.push(['Score', String(r.score)]);
      lines.push(['Headshots', String(r.headshots)]);
      if (cfg.botWaves) lines.push(['Wave reached', String(r.wave)]);
    }
    lines = lines.concat([
      ['Accuracy', fmtPct(r.accuracy)],
      ['Hits', String(r.hits)],
      ['Misses', String(r.misses)],
      ['Best streak', String(r.bestStreak)],
      ['Avg reaction', fmtMs(r.avgReaction)]
    ]);
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
    if (r.mode === 'bots' || r.mode === 'range') { entry.score = r.score; entry.headshots = r.headshots; entry.wave = r.wave; }
    if (r.mode === 'range') entry.longest = r.longest;

    state.history.unshift(entry);
    state.history = state.history.slice(0, 20);

    var prev = state.bests[r.mode];
    // Accuracy first, hits as the tiebreaker - the same order the summary
    // itself leads with. Bot Range goes by score, then accuracy.
    var better = r.mode === 'bots'
      ? !prev || entry.score > prev.score || (entry.score === prev.score && entry.accuracy > prev.accuracy)
      : !prev || entry.accuracy > prev.accuracy ||
        (entry.accuracy === prev.accuracy && entry.hits > prev.hits);
    if (better) state.bests[r.mode] = entry;

    save();
  }

  /* ================================================================ *
   * In-game range - practice dummies inside the real 3D map, shot with
   * your real bow.
   *
   * The dummies are three spheres each, copied from YOUR player's own
   * hitbox (feet, body, head), drawn into the game's scene only on your
   * screen. Your arrows are the game's own arrow objects with the game's
   * own speed and drop for whichever bow you hold: each one reports every
   * point it travels through (arrow.onTravelCbs - the same points the
   * game tests walls and players against), and the mod tests that same
   * path against the dummies.
   *
   * A dummy hit is handled the way the game handles hitting a player:
   * the arrow stops and vanishes and the game's own hit / headshot sound
   * plays. Nothing is sent to the server - other players never see the
   * dummies, they give no coins and no stats. An arrow that hits a dummy
   * stops there, so it can't also hit a real player behind it.
   *
   * Needs the game's main instance (window.__NARROW), published by the
   * same reversible cache patch the other Frogmods use.
   * ================================================================ */

  var MARK = '__NARROW';
  var PO_RE = /function ([A-Za-z_$][\w$]*)\(\)\{if\(!([A-Za-z_$][\w$]*)\)throw new Error\("Main instance is not initialized"\);return \2\}/;
  var ENTRY_RE = /\/js\/index-[^/]*\.js$/;
  var CACHE_RE = /^narrowClient\d+$/;
  function game() { return window[MARK] || null; }
  /** Writes the patched bundle into the game's own cache; it takes effect on the next reload. */
  function ensurePatched() {
    if (!window.caches) return Promise.resolve('no-cache');
    var cacheRef = null, urlRef = null;
    return caches.keys().then(function (keys) {
      var hit = keys.filter(function (k) { return CACHE_RE.test(k); });
      if (!hit.length) return 'no-cache';
      return caches.open(hit[hit.length - 1]).then(function (cache) {
        cacheRef = cache;
        var tags = document.querySelectorAll('script[type="module"][src]');
        for (var i = 0; i < tags.length; i++) {
          if (ENTRY_RE.test(new URL(tags[i].src, location.href).pathname)) return tags[i].src;
        }
        return cache.keys().then(function (reqs) {
          for (var j = 0; j < reqs.length; j++) if (ENTRY_RE.test(new URL(reqs[j].url).pathname)) return reqs[j].url;
          return null;
        });
      }).then(function (url) {
        if (!url) return 'no-entry';
        urlRef = url;
        return cacheRef.match(url, { ignoreSearch: true }).then(function (res) {
          return res ? res.text() : fetch(url, { credentials: 'same-origin' }).then(function (r) { return r.text(); });
        }).then(function (src) {
          if (src.indexOf('window.' + MARK + '=') !== -1) return 'already';
          var out = src.replace(PO_RE, 'function $1(){if(!$2)throw new Error("Main instance is not initialized");window.' + MARK + '=$2;return $2}');
          if (out === src) return 'no-match';
          return cacheRef.put(urlRef, new Response(out, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } }))
            .then(function () { return 'patched'; });
        });
      });
    }).catch(function () { return 'error'; });
  }
  ensurePatched();

  var RANGE_DEFAULTS = { count: 4, band: 3, diff: 2, speed: 5, respawn: 1, runners: 0, spawn: 0, shoot: 0, dmg: 0, bow: 1, mode: 0, firstTo: 5, noNat: 0, drill: 5, chal: 0, team: 0, pers: 0, rings: 0,
    mixOn: 0, mix: { hunter: 2, explorer: 2, high: 1, flag: 1, anchor: 0, camper: 1, rusher: 1, flanker: 1, still: 0 },
    hud: 0, hudPos: 0, uiTab: 0, tutSeen: 0, coachSeen: 0 };

  /*
   * Dummy stat editor. The game turns stat points into an effect like this (getStatClassValue):
   *   t = (points - min) / (max - min), clamped to 0..1, then each stat does lerp(a, b, t).
   * For the dummies the points can go past the max, up to infinity - t just keeps going, so the
   * effect keeps growing past anything a real player can have. Where that would break things it's
   * capped: speed at 80 m/s, damage taken never below 0 (immune, not healed), and so on.
   */
  var BOT_STATS = [
    // id, name, the game's max points, what it does to a dummy
    ['movementSpeed', 'Movement Speed', 20, 'walk speed x lerp(0.9, 1.1)'],
    ['armorStrength', 'Damage Protection', 20, 'damage taken x lerp(1.1, 0.7) - 55+ points: immune'],
    ['healthRegenSpeed', 'Health Regen', 20, 'starts healing lerp(8, 2) s after a hit, heals faster past max'],
    ['bloodlust', 'Bloodlust', 11, '+10% health per point-step when it kills you (practice)'],
    ['shootingFocus', 'Focus', 10, 'their aim gets steadier'],
    ['bowAttackStrength', 'Attack Strength', 10, 'arrow damage x lerp(0.8, 1.2)'],
    ['arrowLoadingSpeed', 'Loading Speed', 5, 'they shoot faster'],
    ['arrowFlySpeed', 'Travel Speed', 5, 'arrow speed x lerp(0.82, 1.05)']
  ];
  // The bow the dummies use: the game's own damage multiplier, how far its arrows go, how often it fires.
  var BOT_BOWS = [
    { name: 'Scout (small bow)', type: 'smallBow', dmg: 0.5, speed: 0.8, fire: 0.7 },
    { name: 'Assault (medium bow)', type: 'mediumBow', dmg: 1, speed: 1, fire: 1 },
    { name: 'Sharpshooter (large bow)', type: 'largeBow', dmg: 2, speed: 1.6, fire: 1.4 },
    { name: 'Runner (small crossbow)', type: 'smallCrossbow', dmg: 1 / 3, speed: 1, fire: 0.9 },
    { name: 'Support (repeating crossbow)', type: 'repeatingCrossbow', dmg: 0.4, speed: 1, fire: 0.35 },
    { name: 'Defender (large crossbow)', type: 'largeCrossbow', dmg: 2, speed: 1.2, fire: 1.6 }
  ];
  function botBow() { return BOT_BOWS[cfg.range_bow] || BOT_BOWS[1]; }
  /*
   * The shooting action. A dummy (anything but a Hacker) can only shoot you at the end of a real
   * shot: it raises its bow and draws it - the game's own aiming / drawing poses - while slowed
   * down the way you are when you pull your bow (the game's own numbers), facing you, and only
   * lets go once it's fully drawn. Lose sight of you mid-draw and it holds a moment, then lowers it.
   *   ms   = how long the draw (or a crossbow's aim) takes; Loading Speed makes it quicker
   *   slow = walk speed while drawing (Player: getWalkSpeedMultiplier while pulling / loading)
   *   aim / load = the game's pose layers for this bow
   */
  var DRAW = {
    smallBow:          { ms: 350,  slow: 0.5,  aim: 'shooting',   load: 'shootingLoaded' },
    mediumBow:         { ms: 700,  slow: 0.3,  aim: 'shooting',   load: 'shootingLoaded' },
    largeBow:          { ms: 1100, slow: 0.1,  aim: 'shooting',   load: 'shootingLoaded' },
    smallCrossbow:     { ms: 200,  slow: 0.7,  aim: 'shooting',   load: null },
    repeatingCrossbow: { ms: 300,  slow: 0.2,  aim: 'shootStart', load: null },
    largeCrossbow:     { ms: 900,  slow: 0.05, aim: 'shooting',   load: null }
  };
  function drawInfo() { return DRAW[botBow().type] || DRAW.mediumBow; }
  function drawMs() { return drawInfo().ms / lerp(1, 2, botT('arrowLoadingSpeed')); }
  function statPoints(id) {
    var v = cfg.range_stats && cfg.range_stats[id];
    if (v === 'inf') return Infinity;
    v = Number(v);
    return v > 0 ? v : 0;
  }
  /** The game's 0..1 value - except it isn't capped at 1 for dummies (huge, not infinite, so the maths stays sane). */
  function botT(id) {
    for (var i = 0; i < BOT_STATS.length; i++) if (BOT_STATS[i][0] === id) return Math.min(1e6, statPoints(id) / BOT_STATS[i][2]);
    return 0;
  }
  function clampN(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  Object.keys(RANGE_DEFAULTS).forEach(function (k) {
    if (cfg['range_' + k] === undefined) cfg['range_' + k] = RANGE_DEFAULTS[k];
  });
  var BANDS = [[8, 25], [25, 50], [50, 90], [8, 90]];
  var BAND_NAMES = ['Near (8-25 m)', 'Mid (25-50 m)', 'Far (50-90 m)', 'Mixed (8-90 m)'];
  var DIFF_NAMES = ['Stationary', 'Easy', 'Medium', 'Hard', 'Pro', 'Hacker'];
  // What each difficulty changes. speed multiplies the Dummy speed slider; jump = [min, max] ms between jumps
  // (0 = never); flee/hide = run when hit / hide and heal when hurt; flip = how often a strafer changes
  // direction; weave = side-to-side juking while running; regen multiplies healing.
  // know = how much of what all dummies have learned about the map this one is told (0..1);
  // ownCap = how many walls it can remember from its own bumps (its own learning cap).
  var DIFFS = [
    { speed: 0,    jump: 0,            flee: false, hide: false, flip: [0, 0],      weave: 0,    regen: 0,   know: 0,    ownCap: 0,        fire: [3500, 5500], spread: 0.06, lead: 0,    fear: 0,     wary: 0, skill: 0 },
    { speed: 0.6,  jump: 0,            flee: false, hide: false, flip: [1500, 3000], weave: 0,    regen: 0,   know: 0.25, ownCap: 15,       fire: [4000, 6000], spread: 0.09, lead: 0,    fear: 15000, wary: 0.3, skill: 0.1 },
    { speed: 1.0,  jump: [3000, 7000], flee: true,  hide: true,  flip: [800, 2000],  weave: 0,    regen: 1,   know: 0.5,  ownCap: 60,       fire: [2500, 4000], spread: 0.05, lead: 0.5,  fear: 30000, wary: 0.6, skill: 0.4 },
    { speed: 1.3,  jump: [1500, 4000], flee: true,  hide: true,  flip: [500, 1300],  weave: 0.3,  regen: 1.5, know: 0.8,  ownCap: 250,      fire: [1800, 3000], spread: 0.03, lead: 0.85, fear: 45000, wary: 0.85, skill: 0.75 },
    { speed: 1.6,  jump: [700, 2200],  flee: true,  hide: true,  flip: [250, 800],   weave: 0.55, regen: 2,   know: 1,    ownCap: Infinity, fire: [1200, 2000], spread: 0.015, lead: 1,   fear: 60000, wary: 1, skill: 1 },
    // Hacker: flies, very fast, near-perfect aim, knows the whole map and isn't scared of anything
    { speed: 2.2,  jump: 0,            flee: true,  hide: false, flip: [200, 500],   weave: 0.7,  regen: 3,   know: 1,    ownCap: Infinity, fire: [500, 900],   spread: 0.003, lead: 1,   fear: 0,     wary: 0, skill: 1, fly: true }
  ];
  /** The difficulty in play: the setting - or, in Waves, the current wave's. */
  // The dummy being worked on right now: in a custom mix each kind can have its own difficulty.
  var curD = null;
  function diffIdx() {
    if (curD && curD.diffOwn !== undefined && curD.diffOwn !== null) return curD.diffOwn;
    return isWaves() && range.wave ? range.wave.diff : cfg.range_diff;
  }
  /** Run something "as" one dummy (its own difficulty). */
  function asDummy(d, fn) { var prev = curD; curD = d; try { return fn(); } finally { curD = prev; } }
  function diff() { return DIFFS[diffIdx()] || DIFFS[2]; }
  var SPAWN_NAMES = ['Enemy base', 'In front of me', 'Random (anywhere on the map)', 'Mixed (all of these)'];
  var HUD_POS = ['Top centre', 'Top right', 'Bottom centre'];
  // Fallback if your own hitbox can't be read: the game's own values (sphere radius, height, arrow damage).
  var DEFAULT_PARTS = [{ part: 'feet', r: 0.4, y: 0.4, dmg: 1 / 3 }, { part: 'body', r: 0.5, y: 1.1, dmg: 0.5 }, { part: 'head', r: 0.3, y: 1.7, dmg: 1 }];

  // Dummy physics, in the game's units (metres, seconds).
  var GRAVITY = 22;          // a jump of about 1.2 m, like a player's
  var JUMP_SPEED = 7.2;
  var STEP_UP = 0.55;        // ledges lower than this are stepped onto; higher ones block
  var BODY_RADIUS = 0.45;    // how close a dummy gets to a wall
  var FLAG_REACH = 1.6;      // a flag runner "takes" your flag this close to it
  var CELL = 6;              // explorers remember where they've been in 6 m squares
  var REGEN_PER_SEC = 0.12;  // healing while hidden and left alone
  var REGEN_AFTER = 4000;    // ms without being hit before healing starts

  // Why each dummy moves. The label shows over its head while you can see it.
  var MOTIVES = {
    hunter:   { label: 'hunting you' },
    camper:   { label: 'camping' },
    rusher:   { label: 'rushing you' },
    flanker:  { label: 'flanking you' },
    sniper:   { label: 'sniping' },
    hopper:   { label: 'bunny-hopping' },
    coward:   { label: 'running from you' },
    medic:    { label: 'medic' },
    bodyguard: { label: 'guarding' },
    patrol:   { label: 'patrolling' },
    drill:    { label: '' },
    explorer: { label: 'exploring' },
    high:     { label: 'taking high ground' },
    flag:     { label: 'going for your flag' },
    anchor:   { label: 'defending their base' },
    hill:     { label: 'taking the hill' },
    still:    { label: '' }
  };

  var range = {
    on: false, game: null, scene: null, kit: null, geo: null, modelKit: null,
    dummies: [], visited: {}, hooked: typeof WeakSet !== 'undefined' ? new WeakSet() : null,
    meleePatched: typeof WeakSet !== 'undefined' ? new WeakSet() : null,
    shots: 0, hits: 0, heads: 0, kills: 0, melee: 0, flagsTaken: 0, longest: 0, last: 0, wallsKnown: 0,
    hitsTaken: 0, headsTaken: 0, carry: { by: null, flag: null, dropped: null, ghost: null, loading: false },
    hudEl: null, barLayer: null, raf: null
  };

  function myPlayer(ag) {
    var me = null;
    if (ag && ag.players && ag.players.forEach) ag.players.forEach(function (p) { if (!me && p && p.hasOwnership) me = p; });
    return me;
  }
  function liveGame() {
    var g = game();
    var ag = g && g.gameManager && g.gameManager.activeGame;
    return ag && ag.players && ag.arrowManager && ag.physics ? ag : null;
  }
  function myParts(me) {
    try {
      var cols = me.rigidBody.colliders;
      var parts = cols.map(function (c) {
        return { part: c.bodyPart, r: c.radius, y: c.center.y - me.pos.y, dmg: typeof c.arrowDamage === 'number' ? c.arrowDamage : 0.5 };
      });
      if (parts.length && parts.every(function (p) { return p.r > 0 && isFinite(p.y); })) return parts;
    } catch (e) {}
    return DEFAULT_PARTS;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function stat(p, name) {
    try { var v = p.getStatClassValue(name); return typeof v === 'number' ? v : 0; } catch (e) { return 0; }
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function flatDist(ax, az, bx, bz) { var dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); }

  /* ---- looks: a real player model in a default outfit, or plain spheres as a fallback ---- */

  /** The game's own player-model and skeleton classes, borrowed from players already in the match. */
  function findModelKit(ag, me) {
    var Model = null;
    ag.players.forEach(function (p) { if (!Model && p.activeModel && p.activeModel.obj && typeof p.activeModel.applySkeleton === 'function') Model = p.activeModel.constructor; });
    var Skeleton = me.skeleton && typeof me.skeleton.applyLayers === 'function' ? me.skeleton.constructor : null;
    var g = game();
    var presets = g && g.skins && g.skins.defaultSkinPresets;
    if (!Model || !Skeleton || !presets || !presets.length) return null;
    return { Model: Model, Skeleton: Skeleton, presets: presets };
  }
  function enemyTeamOf(me) { return me.teamId === 1 ? 2 : 1; }
  function buildModel(d, me) {
    var mk = range.modelKit;
    if (!mk) return;
    var preset = mk.presets[Math.floor(Math.random() * mk.presets.length)];
    var model, skel;
    try {
      model = new mk.Model({ skinObjectOpts: { teamId: d.side === 'friend' ? me.teamId : enemyTeamOf(me), skin: preset } });   // teammates wear your colours
      skel = new mk.Skeleton({ gender: preset.gender || 'male' });
    } catch (e) { return; }
    d.modelLoading = true;
    Promise.resolve(model.waitForInit()).then(function () {
      return skel.init();
    }).then(function () {
      skel.addPoseLayer('baseRig');
      skel.addPoseLayer('bows/' + botBow().type + '/running');   // arms down, holding their bow, like a running player
      var DI = drawInfo();
      d.layAim = skel.addPoseLayer('bows/' + botBow().type + '/' + DI.aim);   // raising the bow to aim
      d.layLoad = DI.load ? skel.addPoseLayer('bows/' + botBow().type + '/' + DI.load) : null;   // pulling the string back
      if (d.layAim) d.layAim.weight = 0;
      if (d.layLoad) d.layLoad.weight = 0;
      return skel.waitForLinkLayerObjects();
    }).then(function () {
      d.modelLoading = false;
      if (!range.on || !model.obj || range.dummies.indexOf(d) === -1) { try { model.destructor(); } catch (e) {} return; }
      model.obj.frustumCulled = false;
      model.obj.traverse(function (o) { o.frustumCulled = false; });
      model.obj.visible = false;
      range.scene.add(model.obj);
      d.model = model; d.skel = skel;
      d.meshes.forEach(function (m) { m.visible = false; });   // the model replaces the spheres
    }).catch(function () { d.modelLoading = false; });
  }
  function poseModel(d, now, dt) {
    var obj = d.model.obj, sk = d.skel;
    obj.visible = d.alive || now < d.flashUntil;
    if (!obj.visible) return;
    obj.position.set(d.x, d.y, d.z);
    obj.rotation.y = d.yaw;
    obj.updateWorldMatrix(false, true);
    // Posing the skeleton is the costly part. Off screen: skip it (nobody sees the legs); far
    // away: every third frame (you can't tell at that distance).
    d.legT += d.speedNow * dt * 2.2;
    var g = game(), cam = g && g.cam && g.cam.cam, onScreen = true, far = false;
    if (cam && typeof cam.getWorldDirection === 'function' && range.camDir) {
      var ex = d.x - range.camPos.x, ey = d.y + 1 - range.camPos.y, ez = d.z - range.camPos.z, el = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1;
      onScreen = (ex * range.camDir.x + ey * range.camDir.y + ez * range.camDir.z) / el > 0.35 || el < 4;   // roughly inside the view
      far = el > 45;
    }
    if (!onScreen) return;
    d.poseTick = (d.poseTick || 0) + 1;
    if (far && d.poseTick % 3) return;
    // the shooting action, shown with the game's own poses: aim up while drawing (and just after
    // letting go), string pulled back as far as the draw has got
    var aimW = d.drawing || d.burstLeft > 0 || now - (d.lastReleaseAt || 0) < 250 ? 1 : 0;
    var loadW = d.drawing ? Math.min(1, (now - d.drawStart) / drawMs()) : 0;
    if (d.layAim) d.layAim.weight += (aimW - d.layAim.weight) * Math.min(1, dt * 12);
    if (d.layLoad) d.layLoad.weight = loadW;
    sk.applyLayers();
    sk.setLookRotY(0, {});
    // legs: the same swing the game gives players, faster when running
    var amt = Math.min(1, d.speedNow / 5);
    var legs = [[sk.legObjectsL, d.legT], [sk.legObjectsR, d.legT + Math.PI]];
    legs.forEach(function (l) {
      var o = l[0], i = l[1];
      if (!o) return;
      if (!d.onGround) { o.upper.rotation.x = -0.4; o.lower.rotation.x = 0.7; o.foot.rotation.x = 0.7; return; }
      o.upper.rotation.x = 0.5 * Math.cos(i) * amt;
      o.lower.rotation.x = 0.3 * (1 + Math.cos(i)) * amt;
      o.foot.rotation.x = 0.5 * Math.cos(i) * amt;
    });
    sk.updateMatrices();
    d.model.applySkeleton(sk);
  }

  // Sphere fallback (and the shapes the hit test uses).
  function rangeKit(g) {
    var mesh = null;
    g.scene.traverse(function (o) {
      if (!mesh && o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh && o.geometry && o.geometry.isBufferGeometry &&
          o.geometry.attributes && o.geometry.attributes.position) mesh = o;
    });
    var shaderMat = g.materials && g.materials.arrowTrailMat;
    if (!mesh || !shaderMat) return null;
    return { Mesh: mesh.constructor, Geometry: mesh.geometry.constructor, Attribute: mesh.geometry.attributes.position.constructor, Material: shaderMat.constructor };
  }
  function sphereGeo(kit) {
    var lat = 10, lon = 16, pos = [], idx = [];
    for (var i = 0; i <= lat; i++) {
      var th = Math.PI * i / lat;
      for (var j = 0; j <= lon; j++) {
        var ph = 2 * Math.PI * j / lon;
        pos.push(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
      }
    }
    for (var a = 0; a < lat; a++) for (var b = 0; b < lon; b++) {
      var p = a * (lon + 1) + b, q = p + lon + 1;
      idx.push(p, q, p + 1, q, q + 1, p + 1);
    }
    var geo = new kit.Geometry();
    geo.setAttribute('position', new kit.Attribute(new Float32Array(pos), 3));
    geo.setIndex(idx);
    return geo;
  }
  function dummyMat(kit) {
    return new kit.Material({
      vertexShader: 'varying vec3 vN;\nvoid main(){ vN = normalize(normalMatrix * position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 col; uniform float flash; varying vec3 vN;\n' +
        'void main(){ float l = 0.55 + 0.45 * max(dot(normalize(vN), normalize(vec3(0.4, 0.8, 0.5))), 0.0);\n' +
        '  gl_FragColor = vec4(mix(col * l, vec3(1.0), flash), 1.0); }',
      uniforms: { col: { value: { x: 0, y: 0, z: 0 } }, flash: { value: 0 } }
    });
  }
  var PART_COLS = { feet: '#5b3a1e', body: '#c9473b', head: '#f0c9a0' };
  function setCol(m, hex) {
    var c = m.uniforms.col.value;
    c.x = parseInt(hex.substr(1, 2), 16) / 255;
    c.y = parseInt(hex.substr(3, 2), 16) / 255;
    c.z = parseInt(hex.substr(5, 2), 16) / 255;
  }
  function placeMesh(mesh, scene, x, y, z, r) {
    mesh.position.set(x, y, z);
    mesh.scale.set(r, r, r);
    if (typeof mesh.updateMatrix === 'function') {
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      if (mesh.matrixWorld && mesh.matrixWorld.copy) mesh.matrixWorld.copy(mesh.matrix);
      if (scene.matrixWorld && mesh.matrixWorld && mesh.matrixWorld.premultiply) mesh.matrixWorld.premultiply(scene.matrixWorld);
      mesh.matrixWorldNeedsUpdate = true;
    }
  }

  /* ---- the map: the game's own raycasts for ground, walls and line of sight ---- */
  function solidFilter(hit) {
    var c = hit && hit.collider;
    return !!c && !(c.excludeTeamId >= 0) && !(typeof c.isTriggerCollider === 'function' && c.isTriggerCollider());
  }
  function sightFilter(hit) { return solidFilter(hit) && !hit.collider.ignoreArrows; }
  // What stops a body walking - like for you, a death trigger (the river) does not stop you, it kills you.
  function wallFilter(hit) { return solidFilter(hit) && hit.collider.isDeathTrigger !== true; }
  function rayHit(ag, from, to, filter) {
    var ray = ag.physics.getRayCastCache(from, to);
    return ray ? ag.physics.rayCastMapColliders(ray, filter || sightFilter) : null;
  }
  /** Floor under (x, z): looks down from a little above yRef, so indoors it finds the floor, not the roof. */
  function groundAt(ag, V, x, yRef, z, fromAbove) {
    var hit = rayHit(ag, new V(x, yRef + (fromAbove || 2.5), z), new V(x, yRef - 40, z), solidFilter);
    return hit && hit.pos ? hit.pos.y : null;
  }
  function eyePos(g, me, V) {
    var cam = g.cam && g.cam.cam;
    var e = new V(0, 0, 0);
    if (cam && typeof cam.getWorldPosition === 'function') cam.getWorldPosition(e);
    else e.set(me.pos.x, me.pos.y + 1.6, me.pos.z);
    return e;
  }
  function lookYaw(g, V) {
    var cam = g.cam && g.cam.cam;
    if (cam && typeof cam.getWorldDirection === 'function') {
      var d = new V(0, 0, -1); cam.getWorldDirection(d);
      return Math.atan2(d.x, d.z);
    }
    return 0;
  }
  /** Can you see this point from where you stand? */
  function youCanSee(ag, eye, V, x, y, z) { return !rayHit(ag, eye, new V(x, y, z)); }

  /* ---- where they come from ---- */
  function flagList(ag) {
    var f = ag.flags;
    if (!f) return [];
    return Array.isArray(f) ? f : Object.keys(f).map(function (k) { return f[k]; });
  }
  /** Your own team's flag - the one flag runners go for. */
  function myFlag(ag, me) {
    var list = flagList(ag);
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].teamId === me.teamId && list[i].position) return list[i];
    return null;
  }
  /**
   * The enemy base: where the enemy's flag lives in Capture the Flag; otherwise the group of
   * spawn points furthest from where you last spawned (the game keeps one group per side).
   */
  function enemyBasePoints(ag, me) {
    var pts = [];
    flagList(ag).forEach(function (fl) {
      if (fl && fl.teamId !== me.teamId && fl.defaultPosition) pts.push(fl.defaultPosition);
    });
    if (pts.length) return pts;
    var groups = ag.spawnPositions;
    if (!Array.isArray(groups) || !groups.length) return null;
    var home = me.lastRespawnPosition && me.lastRespawnPosition.x !== undefined ? me.lastRespawnPosition : me.pos;
    var best = null;
    groups.forEach(function (gp) {
      if (!Array.isArray(gp) || !gp.length) return;
      var cx = 0, cz = 0, n = 0;
      gp.forEach(function (s) { if (s && s.pos) { cx += s.pos.x; cz += s.pos.z; n++; } });
      if (!n) return;
      var dist = flatDist(cx / n, cz / n, home.x, home.z);
      if (!best || dist > best.dist) best = { dist: dist, pts: gp.map(function (s) { return s.pos; }) };
    });
    return best ? best.pts : null;
  }
  function spotAtBase(ag, me, V) {
    var pts = enemyBasePoints(ag, me);
    if (!pts || !pts.length) return null;
    for (var tries = 0; tries < 10; tries++) {
      var p = pts[Math.floor(Math.random() * pts.length)];
      var x = p.x + rnd(-2.5, 2.5), z = p.z + rnd(-2.5, 2.5);
      var gy = groundAt(ag, V, x, p.y, z);
      if (gy === null || Math.abs(gy - p.y) > 3) continue;
      return { x: x, y: gy, z: z, ang: Math.atan2(me.pos.x - x, me.pos.z - z) };
    }
    return null;
  }
  /** Anywhere on the map: a random spot on solid ground (no water, death zones or edges), not right next to you. */
  function spotRandom(ag, me, V) {
    var b = mapBounds(ag);
    if (!b) return null;
    var deathY = mapVar('floorDeathHeight');
    for (var tries = 0; tries < 25; tries++) {
      var x = rnd(b.x0, b.x1), z = rnd(b.z0, b.z1);
      if (flatDist(x, z, me.pos.x, me.pos.z) < 12) continue;
      var gy = groundAt(ag, V, x, me.pos.y, z, 40);
      if (gy === null || (deathY !== null && gy < deathY + 2) || hazardAt(ag, V, x, gy, z)) continue;
      return { x: x, y: gy, z: z, ang: Math.atan2(me.pos.x - x, me.pos.z - z) };
    }
    return null;
  }
  /** Where a dummy comes in, by the Spawn setting. "Mixed" picks one of the three each time. */
  function spawnSpot(g, ag, me, V) {
    var sp = cfg.range_spawn;
    if (sp === 3) sp = Math.floor(Math.random() * 3);
    if (diffIdx() === 0 && sp === 0) sp = 1;                   // standing targets come in front of you
    var spot = sp === 0 ? spotAtBase(ag, me, V) : sp === 2 ? spotRandom(ag, me, V) : null;
    return spot || spotInFront(g, ag, me, V);
  }
  /** A spot in front of you, on the ground, in plain sight, inside the distance band. */
  function spotInFront(g, ag, me, V, bandOverride) {
    var band = bandOverride || BANDS[cfg.range_band] || BANDS[3];
    var eye = eyePos(g, me, V), yaw = lookYaw(g, V);
    for (var tries = 0; tries < 30; tries++) {
      var dist = band[0] + Math.random() * (band[1] - band[0]);
      if (tries > 20) dist = band[0] + Math.random() * 10;
      var ang = yaw + (Math.random() - 0.5) * (Math.PI / 2);
      var x = me.pos.x + Math.sin(ang) * dist, z = me.pos.z + Math.cos(ang) * dist;
      var gy = groundAt(ag, V, x, me.pos.y, z);
      if (gy === null) gy = groundAt(ag, V, x, me.pos.y, z, 25);
      if (gy === null || Math.abs(gy - me.pos.y) > 25) continue;
      if (!youCanSee(ag, eye, V, x, gy + 1.6, z)) continue;
      return { x: x, y: gy, z: z, ang: ang + Math.PI };
    }
    return null;
  }

  /*
   * 1v1 duel mode: one dummy, a proper duel. Its main goal is to kill you, but it doesn't want to
   * die either (it backs off to cover and heals when hurt, then comes back). Rounds to a first-to
   * score with a countdown and a reset between rounds. Shooting and practice health are always on.
   * It plays differently with each bow, the way people play them in 1v1s:
   */
  var DUEL_STYLES = {
    smallBow:          { style: 'aggro',    range: [8, 16],  label: 'rushing you (Scout)' },
    mediumBow:         { style: 'balanced', range: [18, 28], label: 'dueling (Assault)' },
    largeBow:          { style: 'hold',     range: [35, 60], label: 'holding an angle (Sharpshooter)', head: 0.7 },
    smallCrossbow:     { style: 'hitrun',   range: [8, 14],  label: 'hit and run (Runner)' },
    repeatingCrossbow: { style: 'burst',    range: [15, 25], label: 'bursting (Support)', burst: 5 },
    largeCrossbow:     { style: 'hold',     range: [25, 40], label: 'holding still (Defender)', steady: true, head: 0.3 }
  };
  /*
   * Range modes:
   *   0 Normal range     - the dummies do their own thing (hunting, exploring, high ground, objective)
   *   1 1v1 duel         - see above
   *   2 Movement drill   - dummies in front of you walk one set pattern, so you can practise leading
   *                        shots against one kind of movement at a time; they don't shoot
   *   3 Timed challenge  - a goal against the clock, with a high-score board per challenge, bow and map
   *   4 Waves            - survive rounds of dummies on your practice health; every wave has one more,
   *                        and every third wave they get a difficulty harder (and a bit faster)
   *   5 Team fight       - 2v2 or 3v3: you and friendly dummies against enemy dummies, in rounds
   *   6 Flag defense     - every dummy goes for your flag; stop the carriers
   */
  var RANGE_MODE_NAMES = ['Normal range', '1v1 duel', 'Movement drill', 'Timed challenge', 'Waves', 'Team fight', 'Flag defense'];
  function rMode() { return cfg.range_mode || 0; }
  function isDuel() { return rMode() === 1; }
  function isDrill() { return rMode() === 2; }
  function isChal() { return rMode() === 3; }
  function isWaves() { return rMode() === 4; }
  function isTeam() { return rMode() === 5; }
  function isFlagDef() { return rMode() === 6; }
  function isRounds() { return isDuel() || isTeam(); }
  function teamSize() { return cfg.range_team === 1 ? 3 : 2; }
  function sideFor(i) { return isTeam() && i < teamSize() - 1 ? 'friend' : 'enemy'; }   // the first ones are on your team
  function effCount() {
    return isDuel() ? 1 : isTeam() ? teamSize() * 2 - 1 : isWaves() ? (range.wave ? range.wave.count : 0) : mixOn() ? mixTotal() : Math.min(MIX_MAX, cfg.range_count);
  }
  function pracOn() { return !!(cfg.range_dmg || isDuel() || isWaves() || isTeam()); }
  function dummiesShoot() { return !isDrill() && !!(cfg.range_shoot || cfg.range_dmg || isDuel() || isWaves() || isTeam()); }

  /* Personalities (a setting): instead of all playing the same, a dummy can be a camper (finds a
     high or covered spot and holds it, aiming steadily), a rusher (runs straight at you, jumping,
     never backs off) or a flanker (circles round to your side, then attacks from there). */
  var PERS_NAMES = ['Off (by difficulty)', 'Mixed', 'All campers', 'All rushers', 'All flankers'];
  var PERS = ['camper', 'rusher', 'flanker'];
  function persKind(i) {
    var p = cfg.range_pers;
    if (!p || isRounds() || isDrill()) return null;
    return p === 1 ? PERS[i % 3] : PERS[p - 2] || null;
  }

  /* Custom mix (a setting): exactly how many of each kind of dummy, instead of letting them pick. */
  var MIX_MAX = 50;
  var MIX_TYPES = [
    ['hunter', 'Hunters', 'come for you and fight (with shooting off they explore instead)'],
    ['explorer', 'Explorers', 'roam the whole map'],
    ['high', 'High-ground takers', 'climb up and hold high spots'],
    ['flag', 'Flag / hill runners', 'go for your flag (or the hill)'],
    ['anchor', 'Base defenders', 'guard their own base'],
    ['camper', 'Campers', 'hold a high or covered spot, aiming steadily'],
    ['rusher', 'Rushers', 'run straight at you and never back off'],
    ['flanker', 'Flankers', 'circle round to your side, then attack'],
    ['still', 'Standing targets', 'stay where they spawn'],
    ['sniper', 'Snipers', 'hold high ground 40+ m away and go for your head'],
    ['hopper', 'Bunny-hoppers', 'circle you at mid range, jumping the whole time'],
    ['coward', 'Cowards', 'run and hide from you - practice chasing'],
    ['medic', 'Medics', 'follow hurt dummies and heal them'],
    ['bodyguard', 'Bodyguards', 'stand between you and another dummy'],
    ['patrol', 'Patrollers', 'walk back and forth on a set path']
  ];
  function mixOn() { return !!cfg.range_mixOn && (rMode() === 0 || isChal()); }
  function mixCounts() { var m = cfg.range_mix || {}; return MIX_TYPES.map(function (t) { return Math.max(0, Math.floor(+m[t[0]] || 0)); }); }
  function mixTotal() { return Math.min(MIX_MAX, mixCounts().reduce(function (a, b) { return a + b; }, 0)); }
  function mixType(i) {
    var c = mixCounts(), k = 0;
    for (var j = 0; j < c.length; j++) { k += c[j]; if (i < k) return MIX_TYPES[j][0]; }
    return 'explorer';
  }

  /* Movement drills: the patterns. "Mixed" gives each dummy its own. */
  var DRILL_NAMES = ['Side strafe', 'Jump spam', 'Strafe + jumps', 'Stop and go', 'Ledge drops', 'Mixed'];

  /* Timed challenges. rule: which hits count (and do damage) - any, headshots only, or 40 m+ only. */
  var CHALS = [
    { name: 'Race: 10 kills', goal: 10, cap: 120, rule: 'any' },        // fastest time
    { name: 'Kill rush (60 s)', secs: 60, rule: 'any' },
    { name: 'Headshots only (60 s)', secs: 60, rule: 'head' },
    { name: 'Long shots 40 m+ (90 s)', secs: 90, rule: 'long' }
  ];

  /* Your bow, by the game's own type name. */
  var BOW_LABELS = { smallBow: 'Scout', mediumBow: 'Assault', largeBow: 'Sharpshooter', smallCrossbow: 'Runner', repeatingCrossbow: 'Support', largeCrossbow: 'Defender' };
  var BOW_BY_ID = ['Scout', 'Assault', 'Sharpshooter', 'Runner', 'Support', 'Defender'];
  function myBowName(me) {
    var bw = me && me.bowWeapon;
    return (bw && (BOW_LABELS[bw.bowWeaponTypeId] || BOW_BY_ID[bw.bowWeaponId])) || 'Your bow';
  }
  function mapLabel(ag) {
    var c = [ag.mapName, ag.map && ag.map.name, ag.mapConfig && ag.mapConfig.name, ag.mapData && ag.mapData.name];
    for (var i = 0; i < c.length; i++) if (typeof c[i] === 'string' && c[i]) return c[i];
    return 'map ' + mapKey(ag).slice(3, 8);
  }

  /*
   * How they move, from how Narrow One players are described in guides (narrow0ne-online.pages.dev
   * beginner + game-mode guides): skill 0 = noob, 1 = pro.
   *   Noobs: stand still in the open holding their aim, run straight at you to chase kills, strafe in
   *     long predictable runs, bunny-hop for no reason, re-peek from the same spot, go alone, and in
   *     CTF "all rush mid" (always the main lane).
   *   Pros: micro-strafe (left-right-left) with sudden stops to break your release timing; fight from
   *     cover - peek ~0.4-0.6 s, shoot, hide, and re-peek from a DIFFERENT angle; jump-peek; shoot
   *     back right after you release; take high ground; stay in pairs ("two archers beat one"); in
   *     CTF vary the route each push (main lane / side lane / wrap), escorts body-block for the
   *     carrier, and one anchor stays home.
   */
  function skill() { return diff().skill || 0; }
  function isPro() { return skill() >= 0.6; }
  function pickMotive(d, i, ag, me) {
    if (isDuel() || isTeam()) return diffIdx() === 0 ? 'still' : 'duel';
    if (isDrill()) return 'drill';
    if (diffIdx() === 0) return 'still';
    d.flyAlt = 0;
    // flag defense: every dummy is after your flag (or the hill, on a map without flags)
    if (isFlagDef()) {
      if (myFlag(ag, me)) return 'flag';
      if (ag.kingOfTheHillPosition && ag.kingOfTheHillSphere) return 'hill';
    }
    // a custom mix: this one's kind is set
    if (mixOn()) {
      var mt = mixType(i);
      if (mt === 'flag') return myFlag(ag, me) ? 'flag' : ag.kingOfTheHillPosition && ag.kingOfTheHillSphere ? 'hill' : 'explorer';
      return mt;
    }
    if (i < Math.min(cfg.range_runners, cfg.range_count)) {
      if (myFlag(ag, me)) return 'flag';
      if (ag.kingOfTheHillPosition && ag.kingOfTheHillSphere) return 'hill';
    }
    // pros keep one defender at their base in Capture the Flag
    if (isPro() && cfg.range_runners > 0 && i === Math.min(cfg.range_runners, cfg.range_count) && myFlag(ag, me) && cfg.range_count > cfg.range_runners + 1) return 'anchor';
    var pk = persKind(i);                                          // a personality, if they're switched on
    if (pk) return pk;
    var r = Math.random();
    if (diff().fly && dummiesShoot() && Math.random() < 0.7) return 'hunter';   // hackers mostly come for you
    // Hunting you only makes sense if they can shoot you; otherwise they explore or take high ground.
    if (!dummiesShoot()) return r < 0.6 ? 'explorer' : 'high';
    return r < 0.4 ? 'hunter' : r < 0.75 ? 'explorer' : 'high';
  }

  function spawnDummy(d, i, g, ag, me, V, now) {
    // Stationary targets always stand in front of you; everyone else starts at the enemy base if that's picked.
    var spot = isDuel() ? (spotInFront(g, ag, me, V, [20, 40]) || spotInFront(g, ag, me, V, [8, 25]))   // a duel starts face to face
      : isTeam() ? (d.side === 'friend' ? (spotInFront(g, ag, me, V, [3, 9]) || spotInFront(g, ag, me, V, [3, 20]))   // teammates start with you
        : (cfg.range_spawn === 0 ? spotAtBase(ag, me, V) : cfg.range_spawn === 1 ? null : spawnSpot(g, ag, me, V)) || spotInFront(g, ag, me, V, [30, 55]) || spotInFront(g, ag, me, V, [15, 40]))
      : isDrill() ? spotInFront(g, ag, me, V)                                   // drills happen in front of you
      : spawnSpot(g, ag, me, V);
    if (!spot) { d.alive = false; d.downAt = now; return; }
    d.x = spot.x; d.z = spot.z; d.y = spot.y; d.vy = 0; d.onGround = true;
    d.hp = 1; d.lastHitAt = 0; d.fleeUntil = 0; d.hiding = false; d.cover = null; d.dmgHistory = [];
    d.lastSafe = { x: d.x, y: d.y, z: d.z }; d.safeNow = null;
    d.drawing = false; d.burstAimed = false; d.burstLeft = 0;
    d.drillKind = cfg.range_drill >= 5 ? i % 5 : cfg.range_drill; d.anchor = null; d.drillPhase = null; d.noWeave = isDrill();
    d.campSpot = null; d.flankPhase = null; d.flankPt = null; d.patrolPts = null; d.hopDir = 0;
    d.yaw = spot.ang; d.speedNow = 0; d.legT = 0;
    // a custom mix: its kind's own difficulty (if one is set)
    var kd = mixOn() && cfg.range_mixDiff ? cfg.range_mixDiff[mixType(i)] : undefined;
    d.diffOwn = typeof kd === 'number' && kd >= 0 ? kd : null;
    curD = d;
    d.motive = pickMotive(d, i, ag, me);
    d.goal = null; d.goalUntil = 0; d.holdUntil = 0;
    // noobs come close to chase the kill; pros keep a proper bow distance
    d.prefDist = isPro() ? rnd(16, 30) : rnd(6, 14); d.strafeDir = Math.random() < 0.5 ? -1 : 1; d.nextStrafeFlip = now + rnd(600, 1800);
    d.lane = isPro() ? ['main', 'side', 'wrap'][Math.floor(Math.random() * 3)] : 'main';   // noobs all rush mid
    d.laneSide = Math.random() < 0.5 ? -1 : 1; d.laneDone = false; d.peekPhase = null; d.stopUntil = 0; d.holdStillUntil = 0; d.nextHoldAt = now + rnd(2000, 5000);
    d.nextJump = diff().jump ? now + rnd(diff().jump[0], diff().jump[1]) : Infinity;
    d.detourUntil = 0; d.detourAng = 0; d.stuckFor = 0;
    d.route = null; d.routeGoal = null; d.replanAt = 0;
    // a fresh life: its own memory starts empty, and it is told a share of what the others found
    d.mem = new Set(); d.seed = Math.random().toString(36).slice(2);
    d.alive = true; d.flashUntil = 0;
    if (!d.model) d.meshes.forEach(function (m) { m.visible = true; });
  }

  function buildDummy(me, i) {
    var parts = myParts(me);
    var d = { parts: parts, meshes: [], mats: [], alive: false, downAt: 0, hp: 1, model: null, skel: null, side: sideFor(i || 0) };
    parts.forEach(function () {
      var mat = dummyMat(range.kit);
      var mesh = new range.kit.Mesh(range.geo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      range.scene.add(mesh);
      d.meshes.push(mesh);
      d.mats.push(mat);
    });
    buildModel(d, me);
    return d;
  }

  /* ---- learning: a shared map memory that grows every time a dummy bumps into something ---- */
  /*
   * The map is a grid of 2 m squares (with a 3 m height band, so floors don't mix). Each time a
   * dummy walks into a wall it records "blocked" for that square and direction; each time it gets
   * through it records "open". All dummies add to the same memory, it's saved per map in your
   * browser, and it keeps growing every session - so the more you play a map, the more they know.
   *
   * Each dummy then plans its route over that memory (A* search), going round walls it has been
   * TOLD about instead of walking into them. How much of the shared memory it is told depends on
   * difficulty (Easy a quarter, Pro all of it), and on top of that it remembers its own bumps, up
   * to its own learning cap. The memory can be exported to a file, shared and imported.
   */
  var BRAIN_KEY = 'narrowone.targetpractice.brain.v1';
  var GRID = 2;                  // metres per square
  var MAX_EDGES = 40000;         // per map, so storage never runs away
  var DIRS = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];   // 8 directions, angle k*45deg
  var brains = null, brain = null, brainDirty = false, lastBrainSave = 0;
  function loadBrains() {
    if (brains) return brains;
    try { brains = JSON.parse(localStorage.getItem(BRAIN_KEY) || '{}') || {}; } catch (e) { brains = {}; }
    return brains;
  }
  function saveBrains(force) {
    if (!brains || (!brainDirty && !force)) return;
    try { localStorage.setItem(BRAIN_KEY, JSON.stringify(brains)); brainDirty = false; } catch (e) {
      // storage full: drop the least-used half of the biggest map and try once more
      try {
        var big = Object.keys(brains).sort(function (a, b) { return Object.keys(brains[b].edges).length - Object.keys(brains[a].edges).length; })[0];
        if (big) prune(brains[big], 0.5);
        localStorage.setItem(BRAIN_KEY, JSON.stringify(brains)); brainDirty = false;
      } catch (e2) {}
    }
  }
  /** Add another player's brain to ours: counts add up, so what both of you found is kept. */
  function mergeBrains(maps) {
    loadBrains();
    Object.keys(maps).forEach(function (mk) {
      if (!/^map[0-9a-z]{1,12}$/.test(mk)) return;                 // only well-formed entries from a file
      var src = maps[mk];
      if (!src || typeof src.edges !== 'object') return;
      var dst = brains[mk] || (brains[mk] = { edges: {}, bumps: 0, sessions: 0 });
      Object.keys(src.edges).forEach(function (ek) {
        if (!/^-?\d{1,6},-?\d{1,4},-?\d{1,6}:[0-7]$/.test(ek)) return;
        var v = src.edges[ek];
        if (!Array.isArray(v) || v.length !== 2) return;
        var e = dst.edges[ek] || (dst.edges[ek] = [0, 0]);
        e[0] += Math.max(0, Math.min(1e6, v[0] | 0)); e[1] += Math.max(0, Math.min(1e6, v[1] | 0));
      });
      dst.bumps = (dst.bumps || 0) + (src.bumps | 0);
      if (src.scan && src.scan.v === SCAN_VERSION && src.scan.done && src.scan.cells && typeof src.scan.cells === 'object' && !(dst.scan && dst.scan.done)) {
        var cells = {};
        Object.keys(src.scan.cells).forEach(function (k) {
          if (/^-?\d{1,6},-?\d{1,4},-?\d{1,6}$/.test(k)) cells[k] = src.scan.cells[k] & 255;
        });
        dst.scan = { v: SCAN_VERSION, cells: cells, done: true, progress: 1 };
      }
      dst.playerKills = (dst.playerKills || 0) + Math.max(0, Math.min(1e6, src.playerKills | 0));
      if (src.killSpots && typeof src.killSpots === 'object') {
        if (!dst.killSpots) dst.killSpots = {};
        Object.keys(src.killSpots).forEach(function (k) {
          if (!/^-?\d{1,6},-?\d{1,6}$/.test(k)) return;
          dst.killSpots[k] = (dst.killSpots[k] || 0) + Math.max(0, Math.min(1e6, src.killSpots[k] | 0));
        });
      }
      if (src.deaths && typeof src.deaths === 'object') {
        if (!dst.deaths) dst.deaths = {};
        Object.keys(src.deaths).forEach(function (k) {
          if (!/^-?\d{1,6},-?\d{1,6}$/.test(k)) return;
          dst.deaths[k] = (dst.deaths[k] || 0) + Math.max(0, Math.min(1e6, src.deaths[k] | 0));
        });
      }
      if (src.links && typeof src.links === 'object') {
        if (!dst.links) dst.links = {};
        Object.keys(src.links).forEach(function (fk) {
          if (!/^-?\d{1,6},-?\d{1,4},-?\d{1,6}$/.test(fk) || typeof src.links[fk] !== 'object') return;
          var dl = dst.links[fk] || (dst.links[fk] = {});
          Object.keys(src.links[fk]).forEach(function (tk) {
            if (!/^-?\d{1,6},-?\d{1,4},-?\d{1,6}$/.test(tk)) return;
            dl[tk] = (dl[tk] || 0) + Math.max(0, Math.min(1e6, src.links[fk][tk] | 0));
          });
        });
      }
      if (Object.keys(dst.edges).length > MAX_EDGES) prune(dst, MAX_EDGES / Object.keys(dst.edges).length);
    });
    brainDirty = true; saveBrains(true);
    if (range.game) brain = brains[mapKey(range.game)] || brain;
  }
  function prune(b, keep) {
    var keys = Object.keys(b.edges);
    keys.sort(function (x, y) { var a = b.edges[x], c = b.edges[y]; return (c[0] + c[1]) - (a[0] + a[1]); });
    var next = {};
    keys.slice(0, Math.floor(keys.length * keep)).forEach(function (k) { next[k] = b.edges[k]; });
    b.edges = next;
  }
  /** A name for this map that stays the same every time: built from its spawn points and objectives. */
  function mapKey(ag) {
    var parts = [];
    (ag.spawnPositions || []).forEach(function (gp) { (gp || []).forEach(function (s) { if (s && s.pos) parts.push(Math.round(s.pos.x) + ',' + Math.round(s.pos.y) + ',' + Math.round(s.pos.z)); }); });
    flagList(ag).forEach(function (f) { var p = f && (f.defaultPosition || f.position); if (p) parts.push('f' + Math.round(p.x) + ',' + Math.round(p.z)); });
    var k = ag.kingOfTheHillPosition; if (k && k.x !== undefined) parts.push('k' + Math.round(k.x) + ',' + Math.round(k.z));
    parts.sort();
    var h = 0, s = parts.join('|');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return 'map' + h.toString(36);
  }
  function useBrainFor(ag) {
    loadBrains();
    var key = mapKey(ag);
    if (!brains[key]) brains[key] = { edges: {}, bumps: 0, sessions: 0 };
    if (!brains[key].links) brains[key].links = {};
    brain = brains[key];
    brain.sessions = (brain.sessions || 0) + 1;
    brainDirty = true;
  }
  function cellOf(x, y, z) { return [Math.floor(x / GRID), Math.floor((y + 0.5) / 3), Math.floor(z / GRID)]; }
  function dirOf(ang) { return ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8; }
  function edgeKey(c, k) { return c[0] + ',' + c[1] + ',' + c[2] + ':' + k; }
  function hash01(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
  /** Learn: something blocked this dummy going this way. */
  function learnBump(d, ang) {
    if (!brain) return;
    var k = edgeKey(cellOf(d.x, d.y, d.z), dirOf(ang));
    var e = brain.edges[k] || (brain.edges[k] = [0, 0]);
    e[0]++; brain.bumps = (brain.bumps || 0) + 1; brainDirty = true;
    // its own memory, up to its own learning cap
    if (d.mem && d.mem.size < diff().ownCap) d.mem.add(k);
    if (Object.keys(brain.edges).length > MAX_EDGES) prune(brain, 0.8);
  }
  /** Learn: this dummy got through from one square to the next. */
  function learnPass(d, ox, oy, oz) {
    if (!brain) return;
    var a = cellOf(ox, oy, oz), b = cellOf(d.x, d.y, d.z);
    if (a[0] === b[0] && a[2] === b[2]) return;
    var k = edgeKey(a, dirOf(Math.atan2(b[0] - a[0], b[2] - a[2])));
    var e = brain.edges[k] || (brain.edges[k] = [0, 0]);
    e[1]++; brainDirty = true;
    if (d.mem) d.mem.delete(k);
  }
  function cellKey3(c) { return c[0] + ',' + c[1] + ',' + c[2]; }
  /**
   * Learn: this dummy went from one height level to another next to it - up stairs, a ramp or a
   * jump, or down a drop. These links are how they find their way to a flag on another floor.
   */
  function learnLink(a, b) {
    if (!brain || a[1] === b[1]) return;
    if (Math.abs(a[0] - b[0]) > 1 || Math.abs(a[2] - b[2]) > 1) return;
    if (!brain.links) brain.links = {};
    var from = cellKey3(a), to = cellKey3(b);
    var l = brain.links[from] || (brain.links[from] = {});
    l[to] = (l[to] || 0) + 1;
    brainDirty = true;
  }
  /** Does this dummy believe the way from square c in direction k is blocked? */
  function thinksBlocked(d, c, k) {
    var key = edgeKey(c, k);
    if (d.mem && d.mem.has(key)) return true;                  // it bumped there itself
    var told = scanSays(d, c, k);
    if (told === true) return true;                             // the map survey says it's a wall
    if (told === false && !(brain.edges[key] && brain.edges[key][0] >= 4 && brain.edges[key][0] > brain.edges[key][1] * 3)) return false;
    var e = brain && brain.edges[key];
    if (!e || e[0] < 2 || e[0] <= e[1] * 1.5) return false;   // not sure yet
    var know = diff().know;
    return know >= 1 || hash01(key + d.seed) < know;           // told about it by the others, as far as its difficulty allows
  }
  /*
   * Map survey ("research"). The first time the range runs on a map, the mod surveys the whole map
   * with the game's own raycasts - a little every frame, in the background - and saves it, so each
   * map is only surveyed once. For every 2 m square it finds each floor level (looking down from
   * above the map and then below each floor it finds), and from each floor it checks all 8
   * directions: a wall (knee or chest height), a step up or down to another level (a link, like
   * stairs), a drop, or open ground. Dummies are then TOLD a share of the survey by difficulty, the
   * same as the shared bump memory: Easy a quarter, Medium half, Hard 80%, Pro all of it.
   */
  var SCAN_VERSION = 2;                 // 2: also marks deadly / hurting squares
  var SCAN_BUDGET_MS = 4;                 // per frame, so the game stays smooth while it surveys
  var scanJob = null;
  function scanState() {
    if (!brain) return null;
    if (!brain.scan || brain.scan.v !== SCAN_VERSION) brain.scan = { v: SCAN_VERSION, cells: {}, done: false, progress: 0 };
    return brain.scan;
  }
  function startScan(ag) {
    var sc = scanState();
    if (!sc || sc.done) { scanJob = null; return; }
    var b = mapBounds(ag);
    if (!b) { scanJob = null; return; }
    var ys = [];
    (ag.spawnPositions || []).forEach(function (gp) { (gp || []).forEach(function (p) { if (p && p.pos) ys.push(p.pos.y); }); });
    flagList(ag).forEach(function (fl) { var p = fl && (fl.defaultPosition || fl.position); if (p) ys.push(p.y); });
    var top = (ys.length ? Math.max.apply(null, ys) : 0) + 40, bottom = (ys.length ? Math.min.apply(null, ys) : 0) - 30;
    var x0 = Math.floor(b.x0 / GRID), x1 = Math.ceil(b.x1 / GRID), z0 = Math.floor(b.z0 / GRID), z1 = Math.ceil(b.z1 / GRID);
    scanJob = { ag: ag, x0: x0, x1: x1, z0: z0, z1: z1, ix: x0, iz: z0, top: top, bottom: bottom,
      total: (x1 - x0 + 1) * (z1 - z0 + 1), doneCells: Math.round((sc.progress || 0) * (x1 - x0 + 1) * (z1 - z0 + 1)) };
    // resume where an earlier session stopped
    var skip = scanJob.doneCells;
    while (skip-- > 0) advanceScan();
  }
  function advanceScan() {
    var j = scanJob;
    j.iz++;
    if (j.iz > j.z1) { j.iz = j.z0; j.ix++; }
  }
  /** Survey one 2 m square: every floor in it, and what lies in each of the 8 directions. */
  function scanCell(V, ix, iz) {
    var j = scanJob, ag = j.ag, sc = brain.scan;
    var x = (ix + 0.5) * GRID, z = (iz + 0.5) * GRID;
    var from = j.top, lastFloor = Infinity;
    for (var level = 0; level < 4; level++) {
      var hit = rayHit(ag, new V(x, from, z), new V(x, j.bottom, z), solidFilter);
      if (!hit || !hit.pos) break;
      var y = hit.pos.y;
      if (lastFloor - y >= 1.9) {                                 // room to stand (a floor right under another isn't one)
        var hz = rayHit(ag, new V(x, y + 1.8, z), new V(x, y - 0.3, z), hazardFilter);
        if (hz && hz.collider && (hz.collider.isDeathTrigger === true || hz.collider.touchDamageAmount > 0)) {
          var hc = cellOf(x, y + 0.01, z);
          sc.cells[cellKey3(hc)] = 255;                            // a deadly or hurting square: never walk into it
          if (!brain.hazards) brain.hazards = {};
          brain.hazards[cellKey(x, z)] = hz.collider.isDeathTrigger === true ? 2 : 1;
          lastFloor = y; from = y - 0.4; if (from <= j.bottom) break; continue;
        }
        var c = cellOf(x, y + 0.01, z), mask = 0, d0 = { x: x, y: y, z: z };
        for (var k = 0; k < 8; k++) {
          var ang = k * Math.PI / 4, ux = Math.sin(ang), uz = Math.cos(ang);
          var nx = x + DIRS[k][0] * GRID, nz = z + DIRS[k][1] * GRID;
          var reach = Math.sqrt(DIRS[k][0] * DIRS[k][0] + DIRS[k][1] * DIRS[k][1]) * GRID;
          var wall = rayHit(ag, new V(x, y + STEP_UP + 0.1, z), new V(x + ux * reach, y + STEP_UP + 0.1, z + uz * reach), wallFilter) ||
                     rayHit(ag, new V(x, y + 1.2, z), new V(x + ux * reach, y + 1.2, z + uz * reach), wallFilter);
          if (wall) { mask |= 1 << k; continue; }
          var hzn = rayHit(ag, new V(nx, y + 1.8, nz), new V(nx, y - 0.6, nz), hazardFilter);
          if (hzn && hzn.collider && (hzn.collider.isDeathTrigger === true || hzn.collider.touchDamageAmount > 0)) { mask |= 1 << k; continue; }
          var g2 = groundAt(ag, V, nx, y, nz, STEP_UP + 0.25);
          if (g2 === null || g2 < y - 6) { mask |= 1 << k; continue; }   // a cliff or a hole: not a way to go
          var c2 = cellOf(nx, g2 + 0.01, nz);
          if (c2[1] !== c[1]) {
            // a step to another level (stairs) or a drop: same-level walking is blocked, a link takes its place
            mask |= 1 << k;
            learnLinkScan(c, c2);
            if (g2 > y - STEP_UP - 0.1) learnLinkScan(c2, c);       // a small step works both ways
          }
        }
        sc.cells[cellKey3(c)] = mask;
      }
      lastFloor = y;
      from = y - 0.4;                                             // look again below this floor
      if (from <= j.bottom) break;
    }
  }
  function learnLinkScan(a, b) {
    if (!brain.links) brain.links = {};
    var l = brain.links[cellKey3(a)] || (brain.links[cellKey3(a)] = {});
    if (!l[cellKey3(b)]) l[cellKey3(b)] = 1;
  }
  function tickScan(V) {
    if (!scanJob || !brain || !brain.scan || brain.scan.done) return;
    var t0 = performance.now(), n = 0;
    while (performance.now() - t0 < SCAN_BUDGET_MS && n++ < 300) {   // a time budget, and a hard cap too
      if (scanJob.ix > scanJob.x1) { brain.scan.done = true; brain.scan.progress = 1; brainDirty = true; scanJob = null; saveBrains(true); return; }
      scanCell(V, scanJob.ix, scanJob.iz);
      scanJob.doneCells++;
      advanceScan();
    }
    brain.scan.progress = scanJob.doneCells / scanJob.total;
    brainDirty = true;
  }
  /** What the survey says about square c, direction k, as far as this dummy is told: true = blocked, false = open, null = not surveyed. */
  function scanSays(d, c, k) {
    var sc = brain && brain.scan;
    if (!sc || !sc.cells) return null;
    var mask = sc.cells[cellKey3(c)];
    if (mask === undefined) return null;
    var key = cellKey3(c) + ':' + k, know = diff().know;
    if (!(know >= 1 || hash01(key + d.seed + 's') < know)) return null;   // not told about this one
    return !!(mask & (1 << k));
  }
  /** A* over the learned grid: unknown squares count as open, known walls are avoided. */
  function planRoute(d, tx, ty, tz) {
    var start = cellOf(d.x, d.y, d.z), goal = cellOf(tx, ty, tz);
    if (Math.abs(goal[0] - start[0]) > 60 || Math.abs(goal[2] - start[2]) > 60) return null;
    var know = diff().know, now = performance.now();
    // Everything below is asked many times per plan (each square from up to 8 sides, diagonal corner
    // checks...), so each answer is worked out once per plan and remembered.
    var maskMemo = {}, riskMemo = {};
    var scanCells = brain && brain.scan && brain.scan.cells, edges = (brain && brain.edges) || {};
    /**
     * All 8 directions of one square in one go (same rules as thinksBlocked / the "walked before"
     * check): bits of b = blocked, bits of p = proven open.
     */
    function squareMask(ck) {
      var v = maskMemo[ck];
      if (v) return v;
      var b = 0, p = 0, sm = scanCells ? scanCells[ck] : undefined;
      for (var k = 0; k < 8; k++) {
        var key = ck + ':' + k, e = edges[key];
        var told = null;
        if (sm !== undefined && (know >= 1 || hash01(key + d.seed + 's') < know)) told = !!(sm & (1 << k));
        if (told === false || (e && e[1] > 0 && (know >= 1 || hash01(key + d.seed + 'o') < know))) p |= 1 << k;
        if (d.mem && d.mem.has(key)) { b |= 1 << k; continue; }
        if (told === true) { b |= 1 << k; continue; }
        if (told === false && !(e && e[0] >= 4 && e[0] > e[1] * 3)) continue;
        if (!e || e[0] < 2 || e[0] <= e[1] * 1.5) continue;
        if (know >= 1 || hash01(key + d.seed) < know) b |= 1 << k;
      }
      return (maskMemo[ck] = { b: b, p: p });
    }
    function blockedK(c, ck, k) { return !!(squareMask(ck).b & (1 << k)); }
    function risk(ix, iz) {
      var x = (ix + 0.5) * GRID, z = (iz + 0.5) * GRID, key = Math.floor(x / CELL) + ',' + Math.floor(z / CELL), v = riskMemo[key];
      if (v === undefined) v = riskMemo[key] = dangerAt(d, x, z, now);   // danger is per 6 m square: one answer covers 9 of these
      return v;
    }
    // a binary heap on f - much faster than scanning the whole open list every step
    var heap = [];
    function hpush(node) {
      heap.push(node);
      var i = heap.length - 1;
      while (i > 0) { var p = (i - 1) >> 1; if (heap[p].f <= heap[i].f) break; var t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p; }
    }
    function hpop() {
      var top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        var i = 0, n = heap.length;
        for (;;) {
          var l = 2 * i + 1, r = l + 1, m = i;
          if (l < n && heap[l].f < heap[m].f) m = l;
          if (r < n && heap[r].f < heap[m].f) m = r;
          if (m === i) break;
          var t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
        }
      }
      return top;
    }
    var came = {}, gs = {}, closed = {};
    var sk = cellKey3(start);
    gs[sk] = 0;
    hpush({ c: start, k: sk, g: 0, f: 0 });
    var expanded = 0;
    function h(n) { return (Math.hypot(goal[0] - n[0], goal[2] - n[2]) + Math.abs(goal[1] - n[1]) * 2) * 1.4; }   // x1.4: searches far fewer squares, routes barely longer
    function push(cur, n, g) {
      var nk = cellKey3(n);
      if (gs[nk] !== undefined && gs[nk] <= g) return;
      gs[nk] = g; came[nk] = cur.c;
      hpush({ c: n, k: nk, g: g, f: g + h(n) });
    }
    while (heap.length && expanded < 2000) {
      var cur = hpop();
      if (closed[cur.k] || cur.g > gs[cur.k]) continue;            // an older, worse copy
      closed[cur.k] = true;
      expanded++;
      if (cur.c[0] === goal[0] && cur.c[2] === goal[2] && cur.c[1] === goal[1]) {
        var path = [], c = cur.c;
        while (c) { path.unshift(c); c = came[cellKey3(c)]; }
        return path.slice(1).map(function (p) { return { x: (p[0] + 0.5) * GRID, y: p[1] * 3 - 0.5, z: (p[2] + 0.5) * GRID }; });
      }
      var ck = cur.k;
      // walking on the same level
      for (var dk = 0; dk < 8; dk++) {
        if (blockedK(cur.c, ck, dk)) continue;
        // no cutting diagonally past a wall corner (that is how it would clip walls)
        if (dk % 2 && (blockedK(cur.c, ck, (dk + 7) % 8) || blockedK(cur.c, ck, (dk + 1) % 8))) continue;
        var n = [cur.c[0] + DIRS[dk][0], cur.c[1], cur.c[2] + DIRS[dk][1]];
        // Prefer ways dummies have actually walked before (as far as this one is told about them);
        // untried ground costs more, so known-good routes win once they exist.
        var proven = !!(squareMask(ck).p & (1 << dk));
        push(cur, n, cur.g + (dk % 2 ? 1.414 : 1) * (proven ? 1 : 1.8) + risk(n[0], n[2]) * 4);   // keep away from where others died
      }
      // stairs, ramps, jumps and drops other dummies found (as far as this one is told about them)
      var links = brain && brain.links && brain.links[ck];
      if (links) for (var tk in links) {
        if (!(know >= 1 || hash01(tk + d.seed + 'l') < know)) continue;
        push(cur, tk.split(',').map(Number), cur.g + 1.5);
      }
    }
    return null;
  }
  /**
   * No known way up or down yet: climb one step at a time - walk to the nearest reachable ground
   * that is higher (or lower) than where it stands, then look again from there. On stairs and
   * ramps that goes all the way up; every level change it makes is learned for next time.
   */
  function pickClimbStep(ag, V, d, tx, ty, tz) {
    var up = ty > d.y, best = null;
    for (var i = 0; i < 20; i++) {
      var a = Math.random() * Math.PI * 2, dist = rnd(1.5, 14);
      var x = d.x + Math.sin(a) * dist, z = d.z + Math.cos(a) * dist;
      var gy = groundAt(ag, V, x, d.y, z, up ? 2.6 : 1.0);
      if (gy === null) continue;
      var rise = gy - d.y;
      if (up ? (rise < 0.3 || rise > 2.6) : (rise > -0.5 || gy < ty - 1.5)) continue;
      if (rayHit(ag, new V(d.x, d.y + 1.2, d.z), new V(x, Math.max(gy, d.y) + 1.2, z), solidFilter)) continue;   // a wall in between
      var score = Math.abs(rise) - dist * 0.12 - flatDist(x, z, tx, tz) * 0.05;
      if (!best || score > best.score) best = { x: x, y: gy, z: z, score: score };
    }
    return best;
  }
  function knownWalls() {
    var n = 0;
    if (brain && brain.scan && brain.scan.cells) for (var ck in brain.scan.cells) { var mk = brain.scan.cells[ck]; while (mk) { n += mk & 1; mk >>= 1; } }
    if (brain) for (var k in brain.edges) { var e = brain.edges[k]; if (e[0] >= 2 && e[0] > e[1] * 1.5) n++; }
    return n;
  }

  /* ---- danger: where dummies died, the others keep away ---- */
  /*
   * Every death leaves a danger zone (8 m around where it fell) that the others avoid for a while -
   * longer the higher the difficulty. Deaths are also counted in the map memory, so spots where you
   * keep getting kills stay feared next session too (as far as each dummy is told, like walls).
   */
  var DANGER_RADIUS = 8;
  var dangers = [];
  function rememberDeath(d, now) {
    if (diffIdx() === 0) return;
    dangers.push({ x: d.x, y: d.y, z: d.z, at: now });
    if (dangers.length > 30) dangers.shift();
    if (brain) {
      if (!brain.deaths) brain.deaths = {};
      var k = cellKey(d.x, d.z);
      brain.deaths[k] = (brain.deaths[k] || 0) + 1;
      brainDirty = true;
    }
  }
  /** How dangerous a spot looks to this dummy: 0 = fine, bigger = worse. */
  function dangerAt(d, x, z, now, deathsOnly) {
    var D = diff(), v = 0;
    for (var i = 0; i < dangers.length; i++) {
      var z0 = dangers[i];
      if (now - z0.at > D.fear) continue;
      var dist = flatDist(x, z, z0.x, z0.z);
      if (dist < DANGER_RADIUS) v += 1 - dist / DANGER_RADIUS * 0.5;
    }
    var fy = fearOfYou();
    if (fy > 0 && !deathsOnly) {
      var me = myPlayer(range.game);
      if (me) { var pd = flatDist(x, z, me.pos.x, me.pos.z); if (pd < 25) v += fy * (1 - pd / 25) * 1.5; }   // close to you
      v += fy * nearKillSpot(d, x, z);                                                       // your favourite spots
    }
    var hzk = cellKey(x, z), hz = brain && brain.hazards && brain.hazards[hzk];
    if (hz && (D.know >= 1 || hash01(hzk + d.seed + 'h') < D.know)) v += hz * 2;
    var k = cellKey(x, z), n = brain && brain.deaths && brain.deaths[k];
    if (n && (D.know >= 1 || hash01(k + d.seed + 'd') < D.know)) v += Math.min(1.5, n * 0.25);   // old deaths, as far as it's told
    return v;
  }
  /*
   * Fear of YOU. Every time you kill one, they get warier: kills this session count a lot, kills
   * from earlier sessions on this map a bit (they're saved), and how fast they learn it depends on
   * difficulty. The spots you were standing on when you got kills are remembered too.
   * A scared dummy keeps its distance, prefers places you can't see, routes away from you and
   * your favourite spots, and peeks out and hides again instead of standing in the open.
   */
  var sessionKills = 0;
  function learnFromKill(now) {
    sessionKills++;
    var me = myPlayer(range.game);
    if (!brain || !me) return;
    brain.playerKills = (brain.playerKills || 0) + 1;
    if (!brain.killSpots) brain.killSpots = {};
    var k = cellKey(me.pos.x, me.pos.z);
    brain.killSpots[k] = (brain.killSpots[k] || 0) + 1;
    brainDirty = true;
  }
  /** 0 = not scared of you at all, 1 = very. */
  function fearOfYou() {
    var learned = sessionKills * 0.12 + (brain && brain.playerKills ? Math.min(0.4, brain.playerKills * 0.01) : 0);
    return Math.min(1, learned) * diff().wary;
  }
  /** Near a spot you like to get kills from? (as far as this dummy is told about it) */
  function nearKillSpot(d, x, z) {
    if (!brain || !brain.killSpots) return 0;
    var v = 0, cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) {
      var k = (cx + dx) + ',' + (cz + dz), n = brain.killSpots[k];
      if (n && (diff().know >= 1 || hash01(k + d.seed + 'k') < diff().know)) v += Math.min(1, n * 0.2);
    }
    return v;
  }
  /** The nearest fresh danger zone this dummy is standing in, if any. */
  function zoneHere(d, now) {
    var D = diff(), best = null;
    for (var i = 0; i < dangers.length; i++) {
      var z0 = dangers[i];
      if (now - z0.at > D.fear) continue;
      var dist = flatDist(d.x, d.z, z0.x, z0.z);
      if (dist < DANGER_RADIUS && (!best || dist < best.dist)) best = { x: z0.x, z: z0.z, dist: dist };
    }
    return best;
  }

  /* ---- movement: walls, ledges, gravity ---- */

  /**
   * Can a dummy step dx, dz? Its body is a player's body: the same three spheres (feet, body, head),
   * at the same heights and sizes, read from your own player. Each sphere is checked straight ahead
   * and to both sides of its front, so it can't poke into walls or slide under a ceiling a player
   * couldn't fit under. The feet sphere bumping something low is a step: fine if the ground there
   * is low enough to step onto, as it is for you.
   */
  /**
   * How far the nearest wall is, all round, at the height of each body sphere (8 directions x 3
   * heights). Re-measured about 5 times a second. While a dummy is well clear of every wall, its
   * steps can't touch one, so they skip the detailed per-step checks below (most steps, in the open).
   */
  var PROBE_REACH = 3, PROBE_EVERY = 200;
  function probeClear(ag, V, d) {
    var parts = d.parts && d.parts.length ? d.parts : DEFAULT_PARTS, r = PROBE_REACH;
    for (var i = 0; i < parts.length && r > 0; i++) {
      var cy = d.y + parts[i].y;
      for (var k = 0; k < 8; k++) {
        var a = k * Math.PI / 4;
        var hit = rayHit(ag, new V(d.x, cy, d.z), new V(d.x + Math.sin(a) * PROBE_REACH, cy, d.z + Math.cos(a) * PROBE_REACH), wallFilter);
        if (hit && hit.dist < r) r = hit.dist;
      }
    }
    // the gaps between the 8 directions: a wall at distance r can be ~8% closer between two rays
    return { x: d.x, y: d.y, z: d.z, r: r * 0.92, at: performance.now() };
  }
  function canStep(ag, V, d, dx, dz) {
    var len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-6) return true;
    var pr = d.probe, tnow = performance.now();
    if (!pr || tnow - pr.at > PROBE_EVERY || Math.abs(d.y - pr.y) > 0.3) pr = d.probe = probeClear(ag, V, d);
    if (Math.abs(d.y - pr.y) < 0.05 && flatDist(pr.x, pr.z, d.x + dx, d.z + dz) + 0.55 < pr.r) return true;   // clear of every wall: fine
    var ux = dx / len, uz = dz / len;
    var parts = d.parts && d.parts.length ? d.parts : DEFAULT_PARTS;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i], cy = d.y + p.y;
      var from = new V(d.x, cy, d.z);
      var blocked = false;
      for (var side = -1; side <= 1; side++) {
        var a = side * 0.6;                                       // straight ahead, and 35 degrees either side
        var vx = ux * Math.cos(a) - uz * Math.sin(a), vz = ux * Math.sin(a) + uz * Math.cos(a);
        var reach = (side === 0 ? len : len * 0.5) + p.r;
        if (rayHit(ag, from, new V(d.x + vx * reach, cy, d.z + vz * reach), wallFilter)) { blocked = true; break; }
      }
      if (!blocked) {
        // sideways: the sphere is as wide as a player's - a step that pushes it INTO a wall at
        // either side doesn't fit (sliding along a wall is fine)
        for (var sd = -1; sd <= 1; sd += 2) {
          var px = -uz * sd, pz = ux * sd;
          var hn = rayHit(ag, new V(d.x + dx, cy, d.z + dz), new V(d.x + dx + px * p.r, cy, d.z + dz + pz * p.r), wallFilter);
          if (!hn || hn.dist >= p.r - 0.03) continue;
          var ho = rayHit(ag, from, new V(d.x + px * p.r, cy, d.z + pz * p.r), wallFilter);
          if (!ho || ho.dist > hn.dist + 0.001) { blocked = true; break; }
        }
        if (!blocked) continue;
      }
      if (p.part === 'feet' || i === 0) {
        var gy = groundAt(ag, V, d.x + ux * (len + p.r), d.y, d.z + uz * (len + p.r), STEP_UP + 0.15);
        if (gy !== null && gy - d.y <= STEP_UP) continue;          // just a step: walk up it
      }
      return false;
    }
    return true;
  }
  /** Walk toward an angle, going round things in the way. Returns false if completely stuck. */
  function walk(ag, V, d, ang, speed, now, dt) {
    if (d.noWalk) { d.speedNow = 0; return false; }              // standing on something you can't walk on
    speed *= d.slowMul || 1;
    if (d.drawing || d.burstLeft > 0) speed *= drawInfo().slow;   // pulling a bow slows you down, as in the game
    if (now < d.detourUntil) ang += d.detourAng;
    else if (diff().weave && !d.onRoute && !d.noWeave) ang += diff().weave * Math.sin(now / 170 + d.x);   // juke side to side (not while following a route)
    var dx = Math.sin(ang) * speed * dt, dz = Math.cos(ang) * speed * dt;
    var ox = d.x, oy = d.y, oz = d.z;
    if (canStep(ag, V, d, dx, dz)) {
      d.x += dx; d.z += dz; d.stuckFor = 0; d.speedNow = speed; d.yaw = ang;
      learnPass(d, ox, oy, oz);
      if (now > d.detourUntil + 1000) d.wallSide = 0;              // clear for a while: forget which way it went round
      return true;
    }
    learnBump(d, ang);                                            // remember: that way is a wall
    d.bumpsLately = (d.bumpsLately || 0) + 1;
    if (d.onRoute && now > (d.lastReplanForBump || 0) + 1000) { d.replanAt = 0; d.lastReplanForBump = now; }   // and rethink the route
    // Blocked: follow the wall. Pick a side once and stick with it, so it walks along the wall
    // to the end instead of wobbling back and forth in front of it.
    if (!d.wallSide) d.wallSide = Math.random() < 0.5 ? 1 : -1;
    var base = [0.5, 1.0, 1.57, 2.1, 2.6];
    var tries = base.map(function (t) { return t * d.wallSide; }).concat(base.map(function (t) { return -t * d.wallSide; }));
    for (var i = 0; i < tries.length; i++) {
      var a = ang + tries[i];
      var tx = Math.sin(a) * speed * dt, tz = Math.cos(a) * speed * dt;
      if (canStep(ag, V, d, tx, tz)) {
        d.detourAng = tries[i]; d.detourUntil = now + 900;
        if (i >= base.length) d.wallSide = -d.wallSide;              // that side was a dead end
        d.x += tx; d.z += tz; d.speedNow = speed; d.yaw = a;
        learnPass(d, ox, oy, oz);
        d.stuckFor = 0;
        return true;
      }
    }
    d.stuckFor += dt; d.speedNow = 0;
    if (d.onGround && d.stuckFor > 0.4) { d.vy = JUMP_SPEED; d.onGround = false; }   // try hopping over it
    return false;
  }
  /** Head for a point, following a route planned over what it knows about the map. */
  function walkTo(ag, V, d, tx, tz, speed, now, dt, ty) {
    var gd = flatDist(tx, tz, d.x, d.z);
    var tY = typeof ty === 'number' ? ty : d.y;
    var climb = Math.abs(tY - d.y) > 2.2;                      // the goal is on another level
    var far = gd > GRID * 2 || climb;
    // Not getting any closer for 4 s? Drop the plan for a while and just follow the wall - that always gets round.
    var gdist = gd + Math.abs(tY - d.y) * 2;
    if (!d.goalKey || flatDist(d.goalKey.x, d.goalKey.z, tx, tz) > GRID * 2) { d.goalKey = { x: tx, z: tz }; d.bestDist = gdist; d.progressAt = now; d.bestLeft = undefined; }
    if (gdist < d.bestDist - 1) { d.bestDist = gdist; d.progressAt = now; }
    if (now - d.progressAt > 4000) { d.noRouteUntil = now + 5000; d.progressAt = now; d.bestDist = gdist; d.route = null; d.bestLeft = undefined; }
    // bumping again and again while following its plan: the plan is wrong, follow the wall for a bit instead
    if (!d.bumpWindowAt || now - d.bumpWindowAt > 3000) { if ((d.bumpsLately || 0) > 60 && d.route) { d.noRouteUntil = now + 5000; d.route = null; } d.bumpWindowAt = now; d.bumpsLately = 0; }
    if (far && brain && diff().know > 0 && !(now < d.noRouteUntil)) {
      var moved = !d.routeGoal || flatDist(d.routeGoal.x, d.routeGoal.z, tx, tz) > GRID * 2;
      if (moved || now > d.replanAt) {
        d.route = planRoute(d, tx, tY, tz);
        d.routeGoal = { x: tx, z: tz };
        if (!d.route) {
          // no way there that it knows of: don't search again for a while (that search is the
          // costly bit) - just head that way and follow walls; explorers will pick somewhere else
          d.noRouteUntil = now + 4000; d.routeFailedAt = now;
        }
        // a route that's working is kept longer; the random part spreads replans over frames
        d.replanAt = now + (d.route && d.stuckFor === 0 ? 2500 : 1500) + Math.random() * 400;
      }
      while (d.route && d.route.length && flatDist(d.route[0].x, d.route[0].z, d.x, d.z) < GRID * 0.5 &&
             Math.abs(d.route[0].y - d.y) < 2.5) d.route.shift();
      // progress = fewer route steps left than ever before (going the long way round still counts;
      // a fresh plan whose first step is right here does not)
      if (d.route && d.route.length < (d.bestLeft === undefined ? Infinity : d.bestLeft) - 0.5) { d.bestLeft = d.route.length; d.progressAt = now; }
      if (d.route && d.route.length) {
        d.onRoute = true;
        var ok = walk(ag, V, d, Math.atan2(d.route[0].x - d.x, d.route[0].z - d.z), speed, now, dt);
        d.onRoute = false;
        return ok;
      }
    }
    // On another level and no known route: work its way up (or down) step by step.
    if (climb && diffIdx() > 0) {
      if (!d.climbTo || now > d.climbUntil || flatDist(d.climbTo.x, d.climbTo.z, d.x, d.z) < 0.8) {
        d.climbTo = pickClimbStep(ag, V, d, tx, tY, tz);
        d.climbUntil = now + 4000;
      }
      if (d.climbTo) {
        d.label = tY > d.y ? 'climbing up' : 'heading down';
        return walk(ag, V, d, Math.atan2(d.climbTo.x - d.x, d.climbTo.z - d.z), speed, now, dt);
      }
    } else {
      d.climbTo = null;
    }
    return walk(ag, V, d, Math.atan2(tx - d.x, tz - d.z), speed, now, dt);
  }
  /*
   * Hazards - the same rules that apply to you, read from the map's own colliders and variables:
   *   isDeathTrigger         (e.g. the river in Fields)  touching it kills you        -> kills a dummy too
   *   touchDamageAmount      touching it hurts you, again every touchDamageDistance  -> hurts a dummy the same
   *   slowDownPlayerAmount   it slows you down                                       -> slows a dummy
   *   allowWalk = false      you can't walk on it                                    -> a dummy can't either
   *   floorDeathHeight       falling below it kills you                              -> kills a dummy
   *   sphereDeathRadius      more than 5 s outside it kills you                      -> kills a dummy
   * Deaths like these leave a danger zone and go into the map memory, so they learn to keep away.
   */
  function hazardFilter(hit) {
    var c = hit && hit.collider;
    return !!c && (c.isDeathTrigger === true || c.touchDamageAmount > 0 || c.slowDownPlayerAmount > 0 || c.allowWalk === false);
  }
  /** The hazard a body standing at (x, y, z) is in or on, if any (looks from head height down to just under the feet). */
  function hazardAt(ag, V, x, y, z) {
    var hit = rayHit(ag, new V(x, y + 1.8, z), new V(x, y - 0.3, z), hazardFilter);
    return hit ? hit.collider : null;
  }
  function mapVar(name) {
    try { var g = game(), mv = g && g.mapLoader && g.mapLoader.mapVariablesManager; var v = mv && mv.get(name); return typeof v === 'number' ? v : null; } catch (e) { return null; }
  }
  /*
   * No natural deaths (a setting - and always for Hackers): instead of dying in water, a death zone,
   * off the map or outside its edge, a dummy is put straight back on the last spot where it stood
   * safely on solid ground. The danger is still remembered, so they still learn to keep away.
   */
  function noNaturalDeath() { return !!cfg.range_noNat || !!diff().fly; }
  function backToLand(d, how, now) {
    var p = d.lastSafe || d.safeNow;                            // the safe spot before the latest, or the latest if that's all there is
    if (!p) return false;
    d.x = p.x; d.y = p.y; d.z = p.z; d.vy = 0; d.onGround = !diff().fly;
    d.route = null; d.routeGoal = null; d.goal = null; d.outsideFor = 0;
    d.hazard = null; d.hazardCheckAt = now; d.lastHazardDmgPos = null; d.safeNow = null;
    d.probe = null; d.flyAlt = d.flyAlt || 0;
    dangers.push({ x: d.x, y: d.y, z: d.z, at: now });           // still learns the spot was dangerous
    if (dangers.length > 30) dangers.shift();
    rangePopup(d, how + ' - back on land', false, '#9fd0ff');
    range.saves = (range.saves || 0) + 1;
    return true;
  }
  function killDummyBy(d, how, now) { return asDummy(d, function () { return killDummyByAs(d, how, now); }); }
  function killDummyByAs(d, how, now) {
    if (!d.alive) return;
    if (noNaturalDeath() && backToLand(d, how, now)) return;
    if (isDuel()) duelRoundOver(true, 'it ' + how.toLowerCase(), now);
    d.alive = false; d.downAt = now; d.hp = 0; d.flashUntil = now + 120;
    rememberDeath(d, now);                                       // a danger zone, and remembered for next time
    if (range.carry.by === d) dropFlag(d, now);
    rangePopup(d, how, false, '#9fd0ff');
    range.envDeaths = (range.envDeaths || 0) + 1;
  }
  function tickHazards(ag, V, d, now, dtMs) {
    d.slowMul = 1; d.noWalk = false;
    var deathY = mapVar('floorDeathHeight');
    if (deathY !== null && d.y < deathY) { killDummyBy(d, 'FELL OFF THE MAP', now); return; }
    var R = mapVar('sphereDeathRadius');
    if (R !== null && R > 0 && Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z) > R) {
      d.outsideFor = (d.outsideFor || 0) + dtMs;
      if (d.outsideFor > 5000) { killDummyBy(d, 'LEFT THE MAP', now); return; }
    } else d.outsideFor = 0;
    if (!d.hazardCheckAt || now - d.hazardCheckAt > 100) {
      d.hazardCheckAt = now; d.hazard = hazardAt(ag, V, d.x, d.y, d.z);
      // a spot only counts as safe right after a fresh check says so; the one before it (a step
      // further from any edge) is where it goes back to
      if (!d.hazard && (d.onGround || diff().fly) && (deathY === null || d.y > deathY + 1)) {
        if (d.safeNow) d.lastSafe = d.safeNow;
        d.safeNow = { x: d.x, y: d.y, z: d.z };
      }
    }
    var h = d.hazard;
    if (!h) { d.lastHazardDmgPos = null; return; }
    if (h.isDeathTrigger === true) { killDummyBy(d, 'DROWNED', now); return; }
    if (h.touchDamageAmount > 0) {
      // like you: damage on touching it, then again every touchDamageDistance you move while touching
      var p = d.lastHazardDmgPos, every = h.touchDamageDistance > 0 ? h.touchDamageDistance : Infinity;
      if (!p || flatDist(p.x, p.z, d.x, d.z) > every) {
        d.lastHazardDmgPos = { x: d.x, z: d.z };
        damageDummy(d, h.touchDamageAmount, 'OUCH', false, now, '#ffb36a', true);
      }
    }
    if (h.slowDownPlayerAmount > 0) d.slowMul = 1 / (1 + h.slowDownPlayerAmount * 0.8 * 2);   // like the game's slowDownColliderAmount
    if (h.allowWalk === false) d.noWalk = true;
  }
  function applyGravity(ag, V, d, me, now, dt) {
    if (diff().fly) {
      // a hacker hovers a few metres above whatever is under it, bobbing, and won't fly into a ceiling
      var below = groundAt(ag, V, d.x, d.y, d.z, 0.5);
      if (below === null) below = d.y - 6;
      if (!d.flyAlt) d.flyAlt = rnd(3, 8);
      var want = below + d.flyAlt + Math.sin(now / 600 + d.x) * 0.6;
      var head = d.parts[d.parts.length - 1] || { y: 1.7, r: 0.3 };
      if (want > d.y && rayHit(ag, new V(d.x, d.y + head.y, d.z), new V(d.x, d.y + head.y + head.r + (want - d.y), d.z), wallFilter)) want = d.y;
      d.y += (want - d.y) * Math.min(1, dt * 2.5);
      d.vy = 0; d.onGround = false;
      return;
    }
    var floor = groundAt(ag, V, d.x, d.y, d.z, STEP_UP + 0.3);
    if (floor === null) floor = d.y - 50;
    if (d.onGround && floor > d.y - STEP_UP && floor <= d.y + STEP_UP + 0.3) {
      d.y = floor;
    } else {
      d.onGround = false;
      if (d.vy > 0) {
        var hp = d.parts[d.parts.length - 1] || { y: 1.7, r: 0.3 };
        if (rayHit(ag, new V(d.x, d.y + hp.y, d.z), new V(d.x, d.y + hp.y + hp.r + d.vy * dt, d.z), wallFilter)) d.vy = 0;   // bonk
      }
      d.vy -= GRAVITY * dt;
      d.y += d.vy * dt;
      if (d.y <= floor) { d.y = floor; d.vy = 0; d.onGround = true; }
    }
    if (d.y < me.pos.y - 80 && mapVar('floorDeathHeight') === null) killDummyBy(d, 'FELL OFF THE MAP', now);   // no death height set: a safety net
  }

  /* ---- motives: a reason to move ---- */
  function cellKey(x, z) { return Math.floor(x / CELL) + ',' + Math.floor(z / CELL); }
  /** Explorers head for nearby ground they (or another dummy) haven't stood on yet. */
  /** The map's rough extent, from its spawn points, flags and hill (plus a margin). */
  function mapBounds(ag) {
    var xs = [], zs = [];
    (ag.spawnPositions || []).forEach(function (gp) { (gp || []).forEach(function (s) { if (s && s.pos) { xs.push(s.pos.x); zs.push(s.pos.z); } }); });
    flagList(ag).forEach(function (f) { var p = f && (f.defaultPosition || f.position); if (p) { xs.push(p.x); zs.push(p.z); } });
    var k = ag.kingOfTheHillPosition; if (k && k.x !== undefined && (k.x || k.z)) { xs.push(k.x); zs.push(k.z); }
    if (xs.length < 2) return null;
    return { x0: Math.min.apply(null, xs) - 20, x1: Math.max.apply(null, xs) + 20, z0: Math.min.apply(null, zs) - 20, z1: Math.max.apply(null, zs) + 20 };
  }
  /** Extra cost for a goal you can see from where you stand - only for dummies that fear you. */
  function seenPenalty(ag, V, x, y, z) {
    var fy = fearOfYou();
    if (fy <= 0.05) return 0;
    var g = game(), me = myPlayer(range.game);
    if (!g || !me) return 0;
    return youCanSee(ag, eyePos(g, me, V), V, x, y + 1.6, z) ? fy * 8 : 0;
  }
  function pickExploreGoal(ag, V, d) {
    // Now and then, set off for an unexplored part of the WHOLE map, not just nearby.
    var b = mapBounds(ag);
    if (b && Math.random() < 0.35) {
      for (var t = 0; t < 12; t++) {
        var fx = rnd(b.x0, b.x1), fz = rnd(b.z0, b.z1);
        if (range.visited[cellKey(fx, fz)] || dangerAt(d, fx, fz, performance.now()) > 0.3) continue;
        var fy = groundAt(ag, V, fx, d.y + 20, fz, 1);
        if (fy === null || Math.abs(fy - d.y) > 20) continue;
        return { x: fx, y: fy, z: fz, score: 10, far: true };
      }
    }
    var best = null;
    for (var i = 0; i < 14; i++) {
      var a = Math.random() * Math.PI * 2, dist = rnd(8, 30);
      var x = d.x + Math.sin(a) * dist, z = d.z + Math.cos(a) * dist;
      var gy = groundAt(ag, V, x, d.y + 3, z);
      if (gy === null || gy > d.y + 4 || gy < d.y - 12) continue;
      var score = (range.visited[cellKey(x, z)] ? 0 : 10) + Math.random() * 4 - dangerAt(d, x, z, performance.now()) * 12 - seenPenalty(ag, V, x, gy, z);
      if (rayHit(ag, new V(d.x, d.y + 1.2, d.z), new V(x, gy + 1.2, z), solidFilter)) score -= 5;   // prefer places it can walk straight to
      if (!best || score > best.score) best = { x: x, y: gy, z: z, score: score };
    }
    return best;
  }
  /** High-ground seekers look around for the highest ground they can see and go stand on it. */
  function pickHighGoal(ag, V, d) {
    var best = null;
    for (var i = 0; i < 16; i++) {
      var a = Math.random() * Math.PI * 2, dist = rnd(8, 35);
      var x = d.x + Math.sin(a) * dist, z = d.z + Math.cos(a) * dist;
      var gy = groundAt(ag, V, x, d.y + 14, z);
      if (gy === null || gy > d.y + 12 || gy < d.y - 4) continue;
      var score = gy - d.y + Math.random() - dangerAt(d, x, z, performance.now()) * 6 - seenPenalty(ag, V, x, gy, z);
      if (!best || score > best.score) best = { x: x, y: gy, z: z, score: score };
    }
    return best;
  }
  /** Somewhere close that you can't see from where you stand - to hide and heal. */
  function pickCover(ag, V, d, eye) {
    var best = null;
    for (var i = 0; i < 18; i++) {
      var a = Math.random() * Math.PI * 2, dist = rnd(3, 18);
      var x = d.x + Math.sin(a) * dist, z = d.z + Math.cos(a) * dist;
      var gy = groundAt(ag, V, x, d.y + 3, z);
      if (gy === null || Math.abs(gy - d.y) > 4) continue;
      if (youCanSee(ag, eye, V, x, gy + 1.7, z) || youCanSee(ag, eye, V, x, gy + 0.9, z)) continue;
      if (dangerAt(d, x, z, performance.now(), true) > 0.5) continue;   // not where one died (being near YOU is the point of hiding)
      if (!best || dist < best.dist) best = { x: x, y: gy, z: z, dist: dist };
    }
    return best;
  }

  function think(d, g, ag, V, me, eye, now, dt) {
    var D = diff();
    d.speedNow = 0;
    if (d.motive === 'drill') { drillThink(d, ag, V, me, now, dt); return; }
    var speed = Math.min(80, cfg.range_speed * D.speed * lerp(0.9, 1.1, botT('movementSpeed')) / 0.9);   // their Movement Speed (0 points = as before)
    speed *= waveSpeedMul();
    if (d.motive === 'rusher') speed *= 1.15;
    range.visited[cellKey(d.x, d.z)] = true;
    if (!(speed > 0)) { d.label = ''; d.yaw = Math.atan2(me.pos.x - d.x, me.pos.z - d.z); return; }   // stationary: just face you

    // Staying alive comes first.
    // badly hurt: hide and heal - and once hiding, stay hidden until nearly full again
    var hurt = D.hide && d.motive !== 'rusher' && (d.hp < 0.5 || (d.hiding && d.hp < 0.95));   // rushers never back off
    d.hiding = hurt;
    if (D.flee && d.motive !== 'rusher' && now < d.fleeUntil) {
      // just got hit: sprint away from you, zig-zagging and jumping
      var away = Math.atan2(d.x - me.pos.x, d.z - me.pos.z) + Math.sin(now / 250) * 0.7;
      walk(ag, V, d, away, speed * 1.5, now, dt);
      if (d.onGround && Math.random() < dt * 1.5) { d.vy = JUMP_SPEED; d.onGround = false; }
      d.label = 'running away';
      return;
    }
    if (hurt && d.alive) {
      if (!d.cover || now > d.coverUntil) { d.cover = pickCover(ag, V, d, eye); d.coverUntil = now + 6000; }
      var seen = youCanSee(ag, eye, V, d.x, d.y + 1.7, d.z);
      if (d.cover && seen) {
        walkTo(ag, V, d, d.cover.x, d.cover.z, speed * 1.3, now, dt);
        d.label = 'looking for cover';
        return;
      }
      if (!seen) {
        d.label = 'hiding (healing)';
        // healing itself is the game's own (below, for every dummy); hiding just keeps it alive meanwhile
        return;
      }
    }

    var m = d.motive;
    d.label = MOTIVES[m] ? MOTIVES[m].label : '';
    if (m === 'still') return;

    // someone died here: get away from it (flag runners carry on - that's their job)
    var zone = m !== 'flag' ? zoneHere(d, now) : null;
    if (zone) {
      walk(ag, V, d, Math.atan2(d.x - zone.x, d.z - zone.z), speed, now, dt);
      d.label = 'avoiding where one died';
      d.goal = null;
      return;
    }

    if (m === 'flag' || m === 'hill') {
      var target = null;
      if (m === 'flag') { var fl = myFlag(ag, me); target = fl && fl.position; }
      else target = ag.kingOfTheHillPosition;
      if (!target) { d.motive = 'explorer'; return; }
      var fd = flatDist(target.x, target.z, d.x, d.z);
      if (m === 'flag') {
        var c = range.carry;
        if (c.by === d) {
          // carrying your flag: take it home to their base
          var home = enemyHome(ag, me);
          d.label = 'carrying your flag!';
          if (!home) { flagHome(''); return; }
          if (flatDist(home.x, home.z, d.x, d.z) < 3 && Math.abs(home.y - d.y) < 3) {
            range.flagsTaken++;
            flagHome('The dummies captured your flag! (practice only - the real score is untouched)');
            d.motive = 'hunter';
            return;
          }
          if (!d.carryLanePicked) { d.carryLanePicked = true; d.laneDone = false; d.laneWp = null; d.lane = isPro() ? ['main', 'side', 'wrap'][Math.floor(Math.random() * 3)] : 'main'; }
          laneTo(ag, V, d, home.x, home.y, home.z, speed * 1.1, now, dt);
          return;
        }
        if (c.by) {
          d.label = 'escorting the flag';
          if (isPro()) {
            // body-block: stand between the carrier and you
            var bx = me.pos.x - c.by.x, bz = me.pos.z - c.by.z, bl = Math.sqrt(bx * bx + bz * bz) || 1;
            var ex = c.by.x + bx / bl * 3, ez = c.by.z + bz / bl * 3;
            var eg = flatDist(ex, ez, d.x, d.z);
            if (eg > 1) walkTo(ag, V, d, ex, ez, speed * (eg > 6 ? 1.5 : 1.3), now, dt, c.by.y); else d.yaw = Math.atan2(bx, bz);   // fallen behind: hurry
            d.label = 'shielding the carrier';
          } else walkTo(ag, V, d, c.by.x, c.by.z, speed, now, dt, c.by.y);
          return;
        }
        if (c.dropped) target = { x: c.dropped.x, y: c.dropped.y, z: c.dropped.z };
        fd = flatDist(target.x, target.z, d.x, d.z);
        if (fd < FLAG_REACH && Math.abs(target.y - d.y) < 2.5) {
          if (c.dropped) { c.by = d; d.carrying = true; c.dropped = null; rangePopup(d, 'A DUMMY PICKED UP YOUR FLAG!', false, '#7fb6ff'); return; }
          if (fl && !fl.currentHoldingPlayer && fl.isOnDefaultPos !== false) { grabFlag(d, fl, now); return; }
        }
      }
      if (fd > 2 || Math.abs(target.y - d.y) > 2.2) { if (m === 'flag') laneTo(ag, V, d, target.x, target.y, target.z, speed, now, dt); else walkTo(ag, V, d, target.x, target.z, speed, now, dt, target.y); }
      else { d.label = m === 'hill' ? 'holding the hill' : d.label; strafe(ag, V, d, me, speed * 0.6, now, dt); }
      return;
    }

    if (m === 'duel') { duelThink(d, g, ag, V, me, eye, now, dt, speed); return; }
    if (m === 'anchor') {
      // a defender at their base: stays near it and fights from there (from cover, like a pro)
      var base = enemyHome(ag, me);
      if (!base) { d.motive = 'hunter'; return; }
      if (flatDist(base.x, base.z, d.x, d.z) > 9) { walkTo(ag, V, d, base.x, base.z, speed, now, dt, base.y); return; }
      if (dummiesShoot() && proPeek(d, ag, V, me, eye, speed, now, dt)) return;
      strafe(ag, V, d, me, speed * 0.6, now, dt);
      return;
    }
    if (PERS_THINK[m]) { persThink(d, g, ag, V, me, eye, now, dt, speed); return; }
    if (m === 'hunter' && !dummiesShoot()) { d.motive = m = 'explorer'; d.goal = null; }   // shooting was switched off
    if (m === 'hunter') {
      // keep a favourite distance from you: close in, back off, or strafe while watching you
      var dist = flatDist(me.pos.x, me.pos.z, d.x, d.z);
      var toMe = Math.atan2(me.pos.x - d.x, me.pos.z - d.z);
      var fy = fearOfYou();
      var want = d.prefDist + fy * 25;                           // the more you've killed, the further they keep
      if (fy > 0.3) {
        // peek and hide: a few seconds in the open, then duck out of your sight
        if (!d.peekUntil || now > d.peekUntil + d.hideFor) { d.peekUntil = now + rnd(1500, 3500) * (1.3 - fy); d.hideFor = rnd(2000, 4000) * (0.5 + fy); d.peekCover = null; }
        if (now > d.peekUntil) {
          if (!d.peekCover) d.peekCover = pickCover(ag, V, d, eye) || { x: d.x, z: d.z };
          if (flatDist(d.peekCover.x, d.peekCover.z, d.x, d.z) > 1) walkTo(ag, V, d, d.peekCover.x, d.peekCover.z, speed, now, dt);
          d.label = 'staying out of your sight';
          return;
        }
        d.label = 'wary of you';
      }
      // pros stick with a partner: two archers covering each other beat one
      var buddy = isPro() ? buddyOf(d) : null;
      if (buddy && flatDist(buddy.x, buddy.z, d.x, d.z) > 14) { walkTo(ag, V, d, buddy.x, buddy.z, speed, now, dt, buddy.y); d.label = 'regrouping'; return; }
      if (dist > want + 4) {
        walkTo(ag, V, d, me.pos.x, me.pos.z, speed, now, dt);
        if (!isPro() && d.onGround && Math.random() < dt * 0.8) { d.vy = JUMP_SPEED; d.onGround = false; }   // noobs bunny-hop everywhere
        return;
      }
      if (dist < want - 4) { walk(ag, V, d, toMe + Math.PI, speed * 0.8, now, dt); d.yaw = toMe; return; }
      if (isPro()) { if (proPeek(d, ag, V, me, eye, speed, now, dt)) return; }
      else if (noobHold(d, me, now)) return;
      strafe(ag, V, d, me, speed * 0.8, now, dt);
      return;
    }

    // explorer / high ground: pick a goal, go there, look around, pick the next one
    if (!d.goal || now > d.goalUntil || d.stuckFor > 1.5 || (d.routeFailedAt && now - d.routeFailedAt < 100 && flatDist(d.goal.x, d.goal.z, d.x, d.z) > 20)) {
      d.routeFailedAt = 0;
      d.goal = m === 'high' ? pickHighGoal(ag, V, d) : pickExploreGoal(ag, V, d);
      d.stuckFor = 0; d.holdUntil = 0;
      if (!d.goal) return;
      d.goalUntil = now + Math.max(12000, flatDist(d.goal.x, d.goal.z, d.x, d.z) / Math.max(1, speed) * 1500);   // far goals get time to get there
    }
    if (flatDist(d.goal.x, d.goal.z, d.x, d.z) > 1.5) {
      walkTo(ag, V, d, d.goal.x, d.goal.z, speed, now, dt, d.goal.y);
      if (d.goal && d.goal.far && d.label === MOTIVES.explorer.label) d.label = 'exploring the map';
    } else {
      if (!d.holdUntil) d.holdUntil = now + (m === 'high' ? rnd(5000, 9000) : rnd(800, 2000));
      if (m === 'high') { d.label = 'holding high ground'; strafe(ag, V, d, me, speed * 0.5, now, dt); }
      if (now > d.holdUntil) d.goal = null;
    }
  }
  /** Personalities: how a camper, rusher or flanker plays. */
  var PERS_THINK = { camper: 1, rusher: 1, flanker: 1, sniper: 1, hopper: 1, coward: 1, medic: 1, bodyguard: 1, patrol: 1 };
  function persThink(d, g, ag, V, me, eye, now, dt, speed) {
    var dist = flatDist(me.pos.x, me.pos.z, d.x, d.z), toMe = Math.atan2(me.pos.x - d.x, me.pos.z - d.z);
    if (d.motive === 'sniper') {
      // a high spot far from you; too close and it moves somewhere further
      if (dist < 30) { walk(ag, V, d, toMe + Math.PI, speed * 1.1, now, dt); d.yaw = toMe; d.label = 'keeping its distance'; d.campSpot = null; return; }
      if (!d.campSpot || now > d.campUntil) {
        var best = null;
        for (var k = 0; k < 4; k++) { var c = pickHighGoal(ag, V, d); if (c && flatDist(c.x, c.z, me.pos.x, me.pos.z) > 40 && (!best || c.y > best.y)) best = c; }
        d.campSpot = best || { x: d.x, y: d.y, z: d.z }; d.campUntil = now + rnd(30000, 45000); d.campSince = now;
      }
      var sp = d.campSpot;
      if (flatDist(sp.x, sp.z, d.x, d.z) > 1.5 && now - d.campSince < 15000) { walkTo(ag, V, d, sp.x, sp.z, speed, now, dt, sp.y); d.label = 'finding a sniping spot'; return; }
      d.label = 'sniping'; d.speedNow = 0; d.yaw = toMe; d.steadyAim = true;
      return;
    }
    if (d.motive === 'hopper') {
      // circle you at 12-20 m, jumping the whole time
      if (!d.hopDir) d.hopDir = Math.random() < 0.5 ? -1 : 1;
      var adj = dist > 20 ? -0.6 : dist < 12 ? 0.6 : 0;                 // drift in / out to stay in range
      if (d.onGround) { d.vy = JUMP_SPEED; d.onGround = false; }
      if (dist > 26) { walkTo(ag, V, d, me.pos.x, me.pos.z, speed * 1.1, now, dt); d.label = 'bunny-hopping in'; return; }   // far: come in first
      if (!walk(ag, V, d, toMe + d.hopDir * (Math.PI / 2 + adj), speed * 1.1, now, dt)) d.hopDir = -d.hopDir;
      if (now > (d.hopFlipAt || 0)) { d.hopFlipAt = now + rnd(2500, 5000); if (Math.random() < 0.4) d.hopDir = -d.hopDir; }
      if (d.onGround) { d.vy = JUMP_SPEED; d.onGround = false; }
      d.yaw = toMe; d.label = 'bunny-hopping';
      return;
    }
    if (d.motive === 'coward') {
      // keeps away from you; if you can see it, it heads for cover
      var seen = youCanSee(ag, eye, V, d.x, d.y + 1.6, d.z);
      if (seen && dist < 40) {
        if (!d.cover || now > d.coverUntil) { d.cover = pickCover(ag, V, d, eye); d.coverUntil = now + 4000; }
        if (d.cover && flatDist(d.cover.x, d.cover.z, d.x, d.z) > 1) walkTo(ag, V, d, d.cover.x, d.cover.z, speed * 1.2, now, dt, d.cover.y);
        else walk(ag, V, d, toMe + Math.PI + Math.sin(now / 400) * 0.6, speed * 1.2, now, dt);
        d.label = 'running from you';
        return;
      }
      if (dist < 25) { walk(ag, V, d, toMe + Math.PI, speed, now, dt); d.label = 'backing away'; return; }
      d.speedNow = 0; d.yaw = toMe; d.label = 'hiding from you';
      return;
    }
    if (d.motive === 'medic' || d.motive === 'bodyguard') {
      // a dummy to look after: the medic picks the most hurt one, the bodyguard a flag carrier or the nearest
      var pick = null, ps = Infinity;
      range.dummies.forEach(function (o) {
        if (o === d || !o.alive || o.side !== d.side || o.motive === d.motive) return;
        var sc = flatDist(o.x, o.z, d.x, d.z) + (d.motive === 'medic' ? o.hp * 60 : o.carrying ? -100 : 0);
        if (sc < ps) { ps = sc; pick = o; }
      });
      if (!pick) { strafe(ag, V, d, me, speed * 0.6, now, dt); d.label = d.motive === 'medic' ? 'nobody to heal' : 'nobody to guard'; return; }
      if (d.motive === 'medic') {
        if (flatDist(pick.x, pick.z, d.x, d.z) > 3.5) { walkTo(ag, V, d, pick.x, pick.z, speed * 1.1, now, dt, pick.y); d.label = pick.hp < 1 ? 'going to heal a dummy' : 'following'; return; }
        d.speedNow = 0; d.yaw = toMe;
        if (pick.hp < 1) { pick.hp = Math.min(1, pick.hp + 0.1 * dt); d.label = 'healing'; } else d.label = 'standing by';
        return;
      }
      // bodyguard: 3 m from its dummy, on your side of it
      var bx = me.pos.x - pick.x, bz = me.pos.z - pick.z, bl = Math.sqrt(bx * bx + bz * bz) || 1;
      var gx = pick.x + bx / bl * 3, gz = pick.z + bz / bl * 3;
      if (flatDist(gx, gz, d.x, d.z) > 1) walkTo(ag, V, d, gx, gz, speed * 1.2, now, dt, pick.y); else { d.speedNow = 0; d.yaw = toMe; }
      d.label = 'guarding';
      return;
    }
    if (d.motive === 'patrol') {
      // back and forth between where it spawned and a point 15-25 m across your view, stopping at each end
      if (!d.patrolPts) {
        var side = toMe + Math.PI / 2 * (Math.random() < 0.5 ? -1 : 1), L = rnd(15, 25);
        var px = d.x + Math.sin(side) * L, pz = d.z + Math.cos(side) * L, py = groundAt(ag, V, px, d.y, pz, 4);
        d.patrolPts = [{ x: d.x, y: d.y, z: d.z }, py === null ? { x: d.x - Math.sin(side) * L, y: d.y, z: d.z - Math.cos(side) * L } : { x: px, y: py, z: pz }];
        d.patrolLeg = 1; d.patrolWait = 0;
      }
      if (now < d.patrolWait) { d.speedNow = 0; d.yaw = toMe; d.label = 'patrolling'; return; }
      var pt = d.patrolPts[d.patrolLeg];
      if (flatDist(pt.x, pt.z, d.x, d.z) < 1.2 || d.stuckFor > 2) { d.patrolLeg = 1 - d.patrolLeg; d.patrolWait = now + 1000; d.stuckFor = 0; return; }
      walkTo(ag, V, d, pt.x, pt.z, speed * 0.8, now, dt, pt.y);
      d.label = 'patrolling';
      return;
    }
    if (d.motive === 'rusher') {
      // straight at you, jumping, and right up close
      d.label = 'rushing you';
      if (d.onGround && Math.random() < dt * 1.3) { d.vy = JUMP_SPEED; d.onGround = false; }
      if (dist > 5) { walkTo(ag, V, d, me.pos.x, me.pos.z, speed, now, dt); return; }
      strafe(ag, V, d, me, speed * 0.9, now, dt);
      return;
    }
    if (d.motive === 'camper') {
      // find a spot (high ground, or cover) and hold it, aiming steadily; move on now and then
      if (!d.campSpot || now > d.campUntil) {
        d.campSpot = pickHighGoal(ag, V, d) || pickCover(ag, V, d, eye) || { x: d.x, y: d.y, z: d.z };
        d.campUntil = now + rnd(25000, 40000); d.campSince = now;
      }
      if (dist < 8) { walk(ag, V, d, toMe + Math.PI, speed, now, dt); d.yaw = toMe; d.label = 'backing off'; d.campSpot = null; return; }
      var cs = d.campSpot;
      if (flatDist(cs.x, cs.z, d.x, d.z) > 1.5 && now - d.campSince < 15000) { walkTo(ag, V, d, cs.x, cs.z, speed, now, dt, cs.y); d.label = 'finding a camping spot'; return; }
      d.label = 'camping'; d.speedNow = 0; d.yaw = toMe; d.steadyAim = true;
      return;
    }
    // flanker: go round to your side (out of where you're looking), attack from there, then the other side
    if (!d.flankPhase || (d.flankPhase === 'attack' && now > d.phaseUntil)) {
      d.flankSide = -(d.flankSide || (Math.random() < 0.5 ? 1 : -1));
      d.flankPt = flankPoint(g, ag, V, me, d.flankSide) || flankPoint(g, ag, V, me, -d.flankSide);
      d.flankPhase = d.flankPt ? 'go' : 'attack';
      d.phaseUntil = now + (d.flankPt ? 14000 : rnd(6000, 10000));
    }
    if (d.flankPhase === 'go') {
      if (flatDist(d.flankPt.x, d.flankPt.z, d.x, d.z) < 3 || now > d.phaseUntil) { d.flankPhase = 'attack'; d.phaseUntil = now + rnd(6000, 10000); }
      else { walkTo(ag, V, d, d.flankPt.x, d.flankPt.z, speed * 1.1, now, dt, d.flankPt.y); d.label = 'flanking you'; return; }
    }
    d.label = 'attacking from the side';
    if (dist > 16) { walkTo(ag, V, d, me.pos.x, me.pos.z, speed, now, dt); return; }
    strafe(ag, V, d, me, speed * 0.8, now, dt);
  }
  /** A spot about 20 m off to your side (90 degrees or more from where you're looking), on solid ground. */
  function flankPoint(g, ag, V, me, side) {
    var yaw = lookYaw(g, V);
    for (var k = 0; k < 4; k++) {
      var a = yaw + side * (Math.PI / 2 + k * 0.25), r = 20 - k * 3;
      var x = me.pos.x + Math.sin(a) * r, z = me.pos.z + Math.cos(a) * r;
      var gy = groundAt(ag, V, x, me.pos.y, z, 8);
      if (gy !== null && Math.abs(gy - me.pos.y) < 8) return { x: x, y: gy, z: z };
    }
    return null;
  }
  /** Movement drills: one set pattern per dummy, near where it started, facing you. */
  function drillThink(d, ag, V, me, now, dt) {
    var speed = Math.min(80, cfg.range_speed * lerp(0.9, 1.1, botT('movementSpeed')) / 0.9);
    var k = d.drillKind || 0, toMe = Math.atan2(me.pos.x - d.x, me.pos.z - d.z);
    d.label = DRILL_NAMES[k].toLowerCase();
    if (!d.anchor) { d.anchor = { x: d.x, z: d.z }; d.anchorY = d.y; }
    if (k === 4 && now > (d.noLedgeUntil || 0)) {
      // ledge drops: climb onto something higher, then walk off the edge toward you
      if (d.drillPhase === 'drop') {
        if (d.y < d.dropFromY - 0.8 || now > d.phaseUntil) { d.drillPhase = null; d.goal = null; }
        else { walk(ag, V, d, toMe + d.strafeDir * 0.5, speed, now, dt); d.yaw = toMe; d.label = 'ledge drop'; return; }
      }
      if (!d.goal || now > d.goalUntil) {
        var hg = pickHighGoal(ag, V, d);
        d.goal = hg && hg.y > d.y + 1 ? hg : null; d.goalUntil = now + 12000;
        if (!d.goal) d.noLedgeUntil = now + 5000;                 // nothing higher around: strafe and jump meanwhile
      }
      if (d.goal) {
        if (flatDist(d.goal.x, d.goal.z, d.x, d.z) > 1.2 && !(d.onGround && d.y > d.goal.y - 0.3 && d.y > d.anchorY + 1)) {
          walkTo(ag, V, d, d.goal.x, d.goal.z, speed, now, dt, d.goal.y); d.label = 'climbing up (ledge drops)'; return;
        }
        d.drillPhase = 'drop'; d.dropFromY = d.y; d.phaseUntil = now + 4000; d.goal = null;
        return;
      }
    }
    if (k === 4) k = 2;
    var flipMs = k === 1 ? [400, 700] : k === 3 ? [500, 1100] : [900, 1600];
    if (now > (d.drillFlip || 0)) {
      d.strafeDir = k === 3 ? (Math.random() < 0.5 ? -1 : 1) : -d.strafeDir;
      var stop = k === 3 ? rnd(300, 800) : 0;                     // stop and go: stop dead, then run
      d.stopUntil = now + stop;
      d.drillFlip = now + stop + rnd(flipMs[0], flipMs[1]);
    }
    // stay near where it started: turn back once it's 7 m off
    var side = toMe + d.strafeDir * Math.PI / 2, ax = d.x - d.anchor.x, az = d.z - d.anchor.z;
    if (Math.sqrt(ax * ax + az * az) > 7 && Math.sin(side) * ax + Math.cos(side) * az > 0) { d.strafeDir = -d.strafeDir; side = toMe + d.strafeDir * Math.PI / 2; }
    if (k === 3 && now < d.stopUntil) { d.speedNow = 0; d.yaw = toMe; return; }
    if (!walk(ag, V, d, side, speed * (k === 1 ? 0.35 : k === 3 ? 1.2 : 1), now, dt)) d.strafeDir = -d.strafeDir;
    d.yaw = toMe;
    if (k === 1 && d.onGround) { d.vy = JUMP_SPEED; d.onGround = false; }                       // jump spam
    if (k === 2 && d.onGround && now > (d.drillJumpAt || 0)) { d.vy = JUMP_SPEED; d.onGround = false; d.drillJumpAt = now + rnd(700, 1500); }
  }
  function waveSpeedMul() { return range.wave ? Math.min(1.6, 1 + 0.04 * (range.wave.n - 1)) : 1; }
  /** How a duelist fights, by bow. Hurt-and-hide comes first (in think), so this is the fighting part. */
  function duelThink(d, g, ag, V, me, eye, now, dt, speed) {
    var P = DUEL_STYLES[botBow().type] || DUEL_STYLES.mediumBow;
    var dist = flatDist(me.pos.x, me.pos.z, d.x, d.z), toMe = Math.atan2(me.pos.x - d.x, me.pos.z - d.z);
    var youLow = (me.isProxy ? me.hp : prac.hp) < 0.4;                                    // you're nearly dead: go for the kill
    var lo = P.range[0], hi = P.range[1];
    if (youLow) { lo *= 0.6; hi *= 0.7; }
    d.label = youLow ? 'going for the kill' : P.label;
    if (P.style === 'hitrun') {
      // dash in, shoot, get out while reloading, repeat
      if (!d.hrPhase) d.hrPhase = 'in';
      if (d.hrPhase === 'in') {
        if (dist > lo + 2) { walkTo(ag, V, d, me.pos.x, me.pos.z, speed * 1.2, now, dt); return; }
        d.nextShotAt = Math.min(d.nextShotAt || Infinity, now + 80);      // in range: shoot now
        d.hrPhase = 'shoot'; d.phaseUntil = now + 250; return;
      }
      if (d.hrPhase === 'shoot') { d.yaw = toMe; d.speedNow = 0; if (now > d.phaseUntil) { d.hrPhase = 'out'; d.phaseUntil = now + rnd(1600, 2400); d.hrCover = pickCover(ag, V, d, eye); } return; }
      d.label = 'reloading behind cover';
      if (d.hrCover && flatDist(d.hrCover.x, d.hrCover.z, d.x, d.z) > 0.8) walkTo(ag, V, d, d.hrCover.x, d.hrCover.z, speed * 1.2, now, dt, d.hrCover.y);
      else walk(ag, V, d, toMe + Math.PI, speed, now, dt);
      if (now > d.phaseUntil) d.hrPhase = 'in';
      return;
    }
    if (P.style === 'burst') {
      // stay in range; when it can see you, a quick burst of arrows, then reload behind cover
      if (!d.burstPhase) d.burstPhase = 'fight';
      if (d.burstPhase === 'reload') {
        d.label = 'reloading';
        if (!d.peekCover) d.peekCover = pickCover(ag, V, d, eye);
        if (d.peekCover && flatDist(d.peekCover.x, d.peekCover.z, d.x, d.z) > 0.8) walkTo(ag, V, d, d.peekCover.x, d.peekCover.z, speed, now, dt, d.peekCover.y);
        if (now > d.phaseUntil) { d.burstPhase = 'fight'; d.peekCover = null; }
        return;
      }
      if (d.barSeen && !(d.burstLeft > 0) && now > (d.burstCooldown || 0)) { d.burstLeft = P.burst; d.nextShotAt = now + 60; }
      if (d.burstDone) { d.burstDone = false; d.burstPhase = 'reload'; d.phaseUntil = now + rnd(1800, 2600); d.burstCooldown = d.phaseUntil + 300; return; }
    }
    if (P.style === 'hold') {
      // long range from cover; backs off if you rush it; Defender stands still for its heavy shots
      if (dist < lo) { walk(ag, V, d, toMe + Math.PI, speed * 1.1, now, dt); d.yaw = toMe; d.label = 'backing off'; return; }
      if (dist > hi + 10) { walkTo(ag, V, d, me.pos.x, me.pos.z, speed, now, dt); return; }
      if (P.steady) {
        if (isPro() && proPeek(d, ag, V, me, eye, speed * 0.8, now, dt)) return;
        d.speedNow = 0; d.yaw = toMe; d.steadyAim = true; return;
      }
      if (proPeek(d, ag, V, me, eye, speed, now, dt)) return;
      strafe(ag, V, d, me, speed * 0.6, now, dt);
      return;
    }
    // aggro (Scout) / balanced (Assault) / burst while fighting
    if (dist > hi) {
      walkTo(ag, V, d, me.pos.x, me.pos.z, speed * (P.style === 'aggro' ? 1.15 : 1), now, dt);
      if (P.style === 'aggro' && d.onGround && Math.random() < dt * 1.2) { d.vy = JUMP_SPEED; d.onGround = false; }
      return;
    }
    if (dist < lo - 3 && P.style !== 'aggro') { walk(ag, V, d, toMe + Math.PI, speed * 0.8, now, dt); d.yaw = toMe; return; }
    if (P.style === 'balanced' && isPro() && !youLow && proPeek(d, ag, V, me, eye, speed, now, dt)) return;
    strafe(ag, V, d, me, speed * (P.style === 'aggro' ? 1 : 0.85), now, dt);
    if (P.style === 'aggro' && d.onGround && Math.random() < dt * 1.5) { d.vy = JUMP_SPEED; d.onGround = false; }   // scouts jump a lot
  }
  /** The partner a pro sticks with: dummies pair up 0-1, 2-3, ... */
  function buddyOf(d) {
    var i = range.dummies.indexOf(d), b = range.dummies[i ^ 1];
    return b && b !== d && b.alive && !b.carrying && b.motive !== 'flag' ? b : null;
  }
  /** Noob habit: every few seconds, stand still in the open and hold the aim for a long time. */
  function noobHold(d, me, now) {
    if (now >= d.nextHoldAt && !d.holdStillUntil) { d.holdStillUntil = now + rnd(1500, 3200); }
    if (d.holdStillUntil) {
      if (now < d.holdStillUntil) { d.speedNow = 0; d.yaw = Math.atan2(me.pos.x - d.x, me.pos.z - d.z); d.label = 'standing in the open'; return true; }
      d.holdStillUntil = 0; d.nextHoldAt = now + rnd(2500, 6000);
    }
    return false;
  }
  /**
   * Pro habit: fight from cover. Hide behind something you can't see through, then peek out for
   * ~0.4-0.6 s (sometimes with a jump), shoot straight away, duck back, and next time peek from a
   * DIFFERENT spot. Returns false if there's no cover around (then it just strafes).
   */
  function proPeek(d, ag, V, me, eye, speed, now, dt) {
    if (now < (d.noPeekUntil || 0)) return false;
    if (!d.peekPhase) { d.peekPhase = 'hide'; d.peekCover = pickCover(ag, V, d, eye); d.phaseUntil = now + rnd(800, 1600); d.coverSince = now; d.coverFails = d.coverFails || 0; }
    if (!d.peekCover) { d.peekPhase = null; return false; }
    var cv = d.peekCover;
    if (d.peekPhase === 'hide') {
      if (flatDist(cv.x, cv.z, d.x, d.z) > 0.8) {
        if (now - d.coverSince > 4000) {
          // can't get there: try somewhere else, and after two misses just fight in the open for a bit
          d.coverFails++; d.peekPhase = null; d.peekCover = null;
          if (d.coverFails >= 2) { d.coverFails = 0; d.noPeekUntil = now + 5000; }
          return false;
        }
        walkTo(ag, V, d, cv.x, cv.z, speed, now, dt, cv.y); d.label = 'taking cover'; return true;
      }
      d.coverFails = 0;
      d.yaw = Math.atan2(me.pos.x - d.x, me.pos.z - d.z); d.speedNow = 0; d.label = 'behind cover';
      if (now > d.phaseUntil) {
        // peek: step out to where it can see you, sometimes jumping, and shoot at once
        d.peekPhase = 'peek'; d.phaseUntil = now + rnd(400, 600);
        d.peekDir = Math.random() < 0.5 ? -1 : 1;
        d.nextShotAt = now + 60;
        if (skill() >= 0.9 && d.onGround && Math.random() < 0.5) { d.vy = JUMP_SPEED; d.onGround = false; }   // jump-peek
      }
      return true;
    }
    // peeking
    var toMe = Math.atan2(me.pos.x - d.x, me.pos.z - d.z);
    walk(ag, V, d, toMe + d.peekDir * Math.PI / 2, speed, now, dt);
    d.yaw = toMe; d.label = 'peeking';
    // a peek lasts until the shot is out: a pro doesn't duck back with a half-drawn bow
    if (now > d.phaseUntil && !(d.drawing && now < d.drawStart + drawMs() + 200)) {
      // back into cover - and a different spot for the next peek
      d.peekPhase = 'hide'; d.phaseUntil = now + rnd(800, 1600); d.coverSince = now;
      var next = pickCover(ag, V, d, eye);
      if (next && flatDist(next.x, next.z, cv.x, cv.z) > 2) d.peekCover = next;
    }
    return true;
  }
  /** Pros vary their route: main lane straight there, side lane ~15 m off the line, wrap ~30 m round. */
  function laneTo(ag, V, d, tx, ty, tz, speed, now, dt) {
    if (d.lane !== 'main' && !d.laneDone) {
      if (!d.laneWp || d.laneFor !== tx + ',' + tz) {
        var dx = tx - d.x, dz = tz - d.z, L = Math.sqrt(dx * dx + dz * dz) || 1;
        var off = (d.lane === 'wrap' ? 30 : 15) * d.laneSide;
        var wx = d.x + dx * 0.5 - dz / L * off, wz = d.z + dz * 0.5 + dx / L * off;
        var wy = groundAt(ag, V, wx, d.y + 10, wz, 1);
        d.laneWp = wy === null ? null : { x: wx, y: wy, z: wz }; d.laneFor = tx + ',' + tz;
        if (!d.laneWp) d.laneDone = true;
      }
      if (d.laneWp) {
        if (flatDist(d.laneWp.x, d.laneWp.z, d.x, d.z) < 3) d.laneDone = true;
        else { walkTo(ag, V, d, d.laneWp.x, d.laneWp.z, speed, now, dt, d.laneWp.y); return; }
      }
    }
    walkTo(ag, V, d, tx, tz, speed, now, dt, ty);
  }
  function strafe(ag, V, d, me, speed, now, dt) {
    // pros: short left-right-left with sudden stops (breaks your release timing)
    if (isPro()) {
      if (now < d.stopUntil) { d.speedNow = 0; d.yaw = Math.atan2(me.pos.x - d.x, me.pos.z - d.z); return; }
      if (now > d.nextStrafeFlip && Math.random() < 0.35) d.stopUntil = now + rnd(120, 300);
    }
    if (now > d.nextStrafeFlip) { d.strafeDir = -d.strafeDir; d.nextStrafeFlip = now + rnd(diff().flip[0], diff().flip[1]); }
    var toMe = Math.atan2(me.pos.x - d.x, me.pos.z - d.z);
    if (!walk(ag, V, d, toMe + d.strafeDir * Math.PI / 2, speed, now, dt)) d.strafeDir = -d.strafeDir;
    d.yaw = toMe;                                               // face you while side-stepping
  }

  /* ---- damage: the game's own numbers ---- */
  /*
   * What the game does to a player who gets hit (Player.applyDamage):
   *   damage x lerp(1.1, 0.7, Damage Protection)  - so x1.1 with no armour, which the dummies have;
   *   and no more than 0.9 (90% of full health) in total within any 1 second.
   * Healing is the game's too: nothing for 8 s after a hit (less with Health Regen), then it
   * comes back faster and faster: health += 0.0005 * ms * min(1, (0.3 * (seconds - 8))^5).
   */
  function realDamage(history, raw, armour, now) {
    for (var i = history.length - 1; i >= 0; i--) if (now - history[i].time > 1000) history.splice(i, 1);
    var t = raw * Math.max(0, lerp(1.1, 0.7, armour || 0));   // past ~2.75 (55 points) a dummy is immune, never healed by hits
    var recent = 0;
    history.forEach(function (h) { recent += h.damage; });
    var total = t + recent;
    t -= total - Math.min(total, 0.9);                         // at most 90% of full health per second
    if (t < 0) t = 0;
    history.unshift({ damage: t, time: now });
    return t;
  }
  function realRegen(hp, lastHitAt, regenStat, now, dtMs, rateMul) {
    if (hp >= 1) return 1;
    var secs = (now - lastHitAt) / 1000, wait = Math.max(0, lerp(8, 2, regenStat || 0));
    var a = Math.min(1, Math.max(0, Math.pow(0.3 * (secs - wait), 5)));
    if (!(secs > wait)) a = 0;
    return Math.min(1, hp + 0.0005 * dtMs * a * (rateMul || 1));
  }

  function damageDummy(d, amount, label, head, now, color, byMap, byBot) {
    return asDummy(d, function () { return damageDummyAs(d, amount, label, head, now, color, byMap, byBot); });
  }
  function damageDummyAs(d, amount, label, head, now, color, byMap, byBot) {
    // exactly what that hit would do to a normal player with no armour
    amount = realDamage(d.dmgHistory || (d.dmgHistory = []), amount, botT('armorStrength'), now);   // their Damage Protection (0 = none)
    d.hp -= amount;
    d.flashUntil = now + 120;
    d.lastHitAt = now;
    if (byMap && d.hp <= 0.0001 && noNaturalDeath() && d.lastSafe) { d.hp = 0.05; backToLand(d, 'NEARLY DIED', now); return; }
    var killed = d.hp <= 0.0001;
    if (killed) {
      d.alive = false; d.downAt = now; d.hp = 0;
      if (!byMap && !byBot) range.kills++;
      if (byBot && d.side === 'enemy') range.teamKills = (range.teamKills || 0) + 1;
      if (isDuel()) duelRoundOver(true, byMap ? 'it died to the map' : '', now);
      rememberDeath(d, now);
      if (!byMap && !byBot) learnFromKill(now);    // only YOUR kills make them fear you
      if (!byMap && !byBot) chalKill(now);
      if (range.carry.by === d) { dropFlag(d, now); if (!byMap) range.stops = (range.stops || 0) + 1; }
    } else {
      d.fleeUntil = now + rnd(1800, 2800);                       // try not to die: run
      d.cover = null;
    }
    rangePopup(d, label + (killed ? (byMap ? '  DIED' : '  KILL') : '  -' + Math.round(amount * 100)), head, color);
    var g = game();
    if (!byMap && !byBot) try {
      if (g && g.sfx) {
        g.sfx.playSound('feedback/hitPlayer');
        if (head) g.sfx.playSound('feedback/headShot');
      }
    } catch (e) {}
  }

  /* ---- arrows: the arrow's own path against the dummies' spheres ---- */
  function segSphere(ax, ay, az, bx, by, bz, cx, cy, cz, r) {
    var dx = bx - ax, dy = by - ay, dz = bz - az;
    var fx = ax - cx, fy = ay - cy, fz = az - cz;
    var a = dx * dx + dy * dy + dz * dz;
    if (a < 1e-9) return fx * fx + fy * fy + fz * fz <= r * r ? 0 : -1;
    var b = 2 * (fx * dx + fy * dy + fz * dz), c = fx * fx + fy * fy + fz * fz - r * r;
    var disc = b * b - 4 * a * c;
    if (disc < 0) return -1;
    var s = Math.sqrt(disc), t1 = (-b - s) / (2 * a), t2 = (-b + s) / (2 * a);
    if (t1 >= 0 && t1 <= 1) return t1;
    if (t1 < 0 && t2 >= 0) return 0;
    return -1;
  }
  function arrowDamageMul(arrow) {
    var m = 1;
    if (arrow.arrowWeaponOpts && typeof arrow.arrowWeaponOpts.damageMultiplier === 'number') m *= arrow.arrowWeaponOpts.damageMultiplier;
    if (typeof arrow.playerDamageMultiplier === 'number') m *= arrow.playerDamageMultiplier;
    return m;
  }
  /*
   * The game checks each stretch of an arrow's path against players not just once but for 200 ms
   * (someone stepping into its path right after still gets hit), oldest stretch first, and once the
   * arrow has hit a wall, only the part of the last stretch in front of the wall counts. Same here.
   */
  var ARROW_RAY_LIFE = 200;
  var arrowSegs = [];
  function tickArrowSegs(now) {
    for (var i = arrowSegs.length - 1; i >= 0; i--) if (now - arrowSegs[i].at > ARROW_RAY_LIFE || arrowSegs[i].arrow.didHitPlayer) arrowSegs.splice(i, 1);
    for (var j = 0; j < arrowSegs.length; j++) {
      var sgm = arrowSegs[j];
      if (sgm.arrow.didHitPlayer) continue;
      testArrow(sgm.arrow, sgm.from, sgm.to, segLimit(sgm));
    }
  }
  function segLimit(sgm) {
    var a = sgm.arrow;
    if (!a.didHitWorld || sgm !== a.__lastSeg || !(a.worldHitLastRayDistance >= 0)) return 1;
    var L = Math.sqrt(Math.pow(sgm.to.x - sgm.from.x, 2) + Math.pow(sgm.to.y - sgm.from.y, 2) + Math.pow(sgm.to.z - sgm.from.z, 2));
    return L > 0 ? Math.min(1, a.worldHitLastRayDistance / L) : 1;
  }
  function testArrow(arrow, from, to, maxT) {
    if (!range.on || arrow.didHitPlayer || arrow.__fromDead) return;
    var best = null, lim = maxT === undefined ? 1 : maxT;
    range.dummies.forEach(function (d) {
      if (!d.alive || d.side === 'friend') return;                  // your arrows go through teammates
      d.parts.forEach(function (p) {
        var t = segSphere(from.x, from.y, from.z, to.x, to.y, to.z, d.x, d.y + p.y, d.z, p.r);
        if (t >= 0 && t <= lim && (!best || t < best.t || (t === best.t && p.part === 'head'))) best = { t: t, d: d, p: p };
      });
    });
    if (!best) return;
    arrow.didHitPlayer = true;
    if (arrow.obj) arrow.obj.visible = false;
    var head = best.p.part === 'head';
    var me = myPlayer(range.game);
    var dist = me ? Math.round(flatDist(best.d.x, best.d.z, me.pos.x, me.pos.z)) : 0;
    range.hits++;
    if (head) range.heads++;
    range.last = dist;
    if (dist > range.longest) range.longest = dist;
    range.distSum = (range.distSum || 0) + dist;
    var ar = aimRow(arrow.__bow); ar.hits++; if (head) ar.heads++; ar.dist += dist;
    if (isDrill() && range.drillHits && best.d.drillKind !== undefined) range.drillHits[best.d.drillKind]++;
    // a challenge's rule: only headshots / only long shots count (and hurt)
    var rule = range.chal && !range.chal.over ? CHALS[range.chal.idx].rule : 'any';
    if (rule === 'head' && !head) { rangePopup(best.d, 'BODY - only headshots count', false, '#bbbbbb'); return; }
    if (rule === 'long' && dist < 40) { rangePopup(best.d, dist + ' m - too close (40 m+)', false, '#bbbbbb'); return; }
    damageDummy(best.d, best.p.dmg * arrowDamageMul(arrow), (head ? 'HEADSHOT ' : '') + dist + ' m', head, performance.now());
  }
  function hookArrows(ag, me) {
    var mine = ag.arrowManager.arrows.get(me.id);
    if (!mine || !range.hooked) return;
    mine.forEach(function (arrow) {
      if (range.hooked.has(arrow)) return;
      range.hooked.add(arrow);
      if (!arrow.onTravelCbs || typeof arrow.onTravelCbs.add !== 'function') return;
      // shot while you're dead on your practice health (out of a team round, or the death screen): it doesn't count
      if (practiceDead()) { arrow.__fromDead = true; return; }
      range.shots++;
      arrow.__bow = myBowName(me);                                  // for your aim stats, per bow
      aimRow(arrow.__bow).shots++;
      // pros punish your release: anyone who can see you shoots back a moment later
      if (isPro()) range.dummies.forEach(function (d) { if (d.alive && d.barSeen && d.side !== 'friend') d.nextShotAt = performance.now() + rnd(250, 600); });
      var prev = null;
      arrow.onTravelCbs.add(function (p) {
        var from = prev || arrow.startPos || p;
        var to = p.clone ? p.clone() : { x: p.x, y: p.y, z: p.z };
        var sgm = { arrow: arrow, from: from, to: to, at: performance.now() };
        arrow.__lastSeg = sgm;
        arrowSegs.push(sgm);
        try { testArrow(arrow, from, to); } catch (e) {}
        prev = to;
      });
    });
  }

  /* ---- melee: exactly the game's own target test, run on the dummies ---- */
  function angleBetween(ax, ay, az, bx, by, bz) {
    var la = Math.sqrt(ax * ax + ay * ay + az * az), lb = Math.sqrt(bx * bx + by * by + bz * bz);
    if (la < 1e-9 || lb < 1e-9) return 0;
    return Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / (la * lb))));
  }
  function meleeOnDummies(w, me) {
    if (!range.on || !me || me.dead || practiceDead()) return false;   // no melee while you're out
    var ag = range.game;
    var V = me.pos.constructor;
    if (typeof me.getCamPos !== 'function' || typeof me.getLookDirection !== 'function') return false;
    var cam = me.getCamPos(), look = me.getLookDirection();
    var reach = lerp(2, 4, stat(me, 'meleeAttackReach')) * (typeof w.getRangeMultiplier === 'function' ? w.getRangeMultiplier() : 1);
    var hMul = typeof w.getRequiredHorizontalAngleMultiplier === 'function' ? w.getRequiredHorizontalAngleMultiplier() : 1;
    var vMul = typeof w.getRequiredVerticalAngleMultiplier === 'function' ? w.getRequiredVerticalAngleMultiplier() : 1;
    var best = null;
    if (range.chal && !range.chal.over && CHALS[range.chal.idx].rule !== 'any') return false;   // that challenge is arrows only
    range.dummies.forEach(function (d) {
      if (!d.alive || d.side === 'friend') return;
      d.parts.forEach(function (p) {
        var cx = d.x, cy = d.y + p.y, cz = d.z;
        // o = cam - centre; the game compares it with its look direction exactly like this
        var ox = cam.x - cx, oy = cam.y - cy, oz = cam.z - cz;
        var m = Math.sqrt(ox * ox + oy * oy + oz * oz);
        if (!(m < reach) || m < 1e-6) return;
        var l = angleBetween(ox, 0, oz, look.x, 0, look.z);                 // sideways angle
        var hx = oz, hz = -ox;                                              // o flattened, turned 90 degrees
        var hh = hx * hx + hz * hz;
        var k = hh > 1e-9 ? (look.x * hx + look.z * hz) / hh : 0;
        var gAng = angleBetween(ox, oy, oz, look.x - hx * k, look.y, look.z - hz * k);   // up/down angle
        if (l < hMul / m && gAng < vMul / m) {
          var score = angleBetween(ox, oy, oz, look.x, look.y, look.z) * m;
          if (!best || score < best.score) best = { score: score, d: d, p: p, cx: cx, cy: cy, cz: cz, m: m };
        }
      });
    });
    if (!best) return false;
    var wall = rayHit(ag, new V(cam.x, cam.y, cam.z), new V(best.cx, best.cy, best.cz));
    if (wall && wall.dist < best.m - best.p.r) return false;    // a wall in the way, same rule as the game
    var dmg = (typeof w.getDamageMultiplier === 'function' ? w.getDamageMultiplier() : 0.5) * lerp(0.5, 1.5, stat(me, 'meleeAttackStrength'));
    if (!(dmg > 0)) return false;
    range.melee++;
    damageDummy(best.d, dmg, 'MELEE', false, performance.now(), '#ff9b5a');
    try { if (typeof w.playHitSfx === 'function') w.playHitSfx(); } catch (e) {}
    return true;
  }
  function patchMelee(w) {
    if (!w || typeof w.attack !== 'function' || !range.meleePatched || range.meleePatched.has(w)) return;
    range.meleePatched.add(w);
    var orig = w.attack;
    w.attack = function () {
      var hitReal = orig.apply(this, arguments);
      if (hitReal) return hitReal;                              // a real player always comes first
      try { if (this.player && this.player.hasOwnership) return meleeOnDummies(this, this.player) || hitReal; } catch (e) {}
      return hitReal;
    };
  }

  /* ---- on-screen bits: health bars with what each dummy is doing, hit popups, a score line ---- */
  function screenPoint(g, V, x, y, z) {
    var cam = g.cam && g.cam.cam;
    if (!cam) return null;
    var v = new V(x, y, z);
    v.project(cam);
    if (!(v.z > -1 && v.z < 1) || Math.abs(v.x) > 1.15 || Math.abs(v.y) > 1.15) return null;   // behind you or off the edge of the screen
    return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight };
  }
  function rangePopup(d, text, head, color) {
    var g = game(), me = myPlayer(range.game);
    if (!g || !me) return;
    var pt = screenPoint(g, me.pos.constructor, d.x, d.y + 2.6, d.z);
    if (!pt) return;
    var el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'position:fixed;left:' + pt.x + 'px;top:' + pt.y + 'px;transform:translate(-50%,-100%);' +
      'font:900 17px system-ui,sans-serif;color:' + (color || (head ? '#ffd23b' : '#fff')) + ';text-shadow:0 2px 0 #000,0 0 6px #000;' +
      'pointer-events:none;z-index:151;white-space:nowrap;transition:transform .8s ease-out,opacity .8s ease-out;';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.style.transform = 'translate(-50%,-170%)'; el.style.opacity = '0'; });
    setTimeout(function () { el.remove(); }, 900);
  }
  function drawBars(g, ag, me, V, eye, now) {
    if (!range.barLayer || !range.barLayer.isConnected) {
      range.barLayer = document.createElement('div');
      range.barLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:149;overflow:hidden;';
      document.body.appendChild(range.barLayer);
    }
    range.dummies.forEach(function (d) {
      if (!d.bar) {
        d.bar = document.createElement('div');
        d.bar.style.cssText = 'position:absolute;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;gap:1px;';
        d.barLabel = document.createElement('div');
        d.barLabel.style.cssText = 'font:700 11px system-ui,sans-serif;color:#fff;text-shadow:0 0 3px #000,0 0 3px #000;white-space:nowrap;';
        d.bar.appendChild(d.barLabel);
        d.bar.appendChild(buildGameHealthBar(d, undefined, d.side === 'friend'));   // a teammate's bar is in your colour
        range.barLayer.appendChild(d.bar);
      }
      var pt = d.alive ? screenPoint(g, V, d.x, d.y + 2.25, d.z) : null;
      // like the dummy itself, no bar through walls (re-checked 7 times a second)
      if (pt) {
        if (d.barCheckAt === undefined || now - d.barCheckAt > 150) { d.barCheckAt = now; d.barSeen = youCanSee(ag, eye, V, d.x, d.y + 1.7, d.z) || youCanSee(ag, eye, V, d.x, d.y + 1.0, d.z); }
        if (!d.barSeen) pt = null;
      }
      if (!pt) { d.bar.style.display = 'none'; if (!d.alive || !screenPoint(g, V, d.x, d.y + 1, d.z)) d.barSeen = false; return; }   // off screen: not in sight
      d.bar.style.display = 'flex';
      d.bar.style.left = pt.x + 'px';
      d.bar.style.top = pt.y + 'px';
      var lbl = (d.side === 'friend' ? 'teammate: ' : '') + (d.label || '');
      if (d.barLabel.textContent !== lbl) d.barLabel.textContent = lbl;
      // exactly what the game's own setHealth() does: clip the main bar, and the heart beats under 20%
      d.barClip.style.width = Math.max(0, Math.min(1, d.hp)) * 100 + '%';
      if (d.barHeart) d.barHeart.classList.toggle('beating', d.hp < 0.2);
    });
  }

  /*
   * Narrow One's own health bar, built from the same pieces and CSS classes as yours in the
   * top-left (health-ui-bar bg / clip+main / border, the wrinkled-paper look and the heart),
   * just shrunk to sit over a dummy's head and coloured for the enemy team.
   */
  var BAR_SCALE_DEFAULT = 0.24;               // the game's bar is 270 x 22 px; this makes it about 65 px wide
  function yourBarColours() {
    var e = enemyBarColours();
    return e.fill === '#3a8ee6' ? { fill: '#e64a3a', border: '#86261d' } : { fill: '#3a8ee6', border: '#1d4f86' };
  }
  function enemyBarColours() {
    // Your own bar is in your team's colour; the dummies are the other team, so use the other colour.
    var mine = document.querySelector('.health-ui-container .health-ui-bar.main');
    var c = mine ? getComputedStyle(mine).getPropertyValue('--wrinkled-paper-color').trim() : '';
    var m = c.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    var red = m ? (+m[1] > +m[3]) : /^#?(f|e|d|c)/i.test(c.replace('#', ''));
    return red ? { fill: '#3a8ee6', border: '#1d4f86' } : { fill: '#e64a3a', border: '#86261d' };
  }
  function buildGameHealthBar(d, scale, yours) {
    var BAR_SCALE = scale || BAR_SCALE_DEFAULT;
    var seed = String(Math.floor(Math.random() * 99999));
    var col = yours ? yourBarColours() : enemyBarColours();
    var holder = document.createElement('div');
    holder.style.cssText = 'position:relative;width:' + Math.round(270 * BAR_SCALE) + 'px;height:' + Math.round(22 * BAR_SCALE) + 'px;' +
      'filter:var(--default-drop-shadow);';
    // Same size and layout as the game's .health-ui-bar-container, but not that class: other mods
    // look for the FIRST .health-ui-bar-container on the page to find YOUR health.
    var box = document.createElement('div');
    box.className = 'ntp-health-box';
    box.style.cssText = 'position:absolute;left:0;top:0;width:270px;height:22px;margin:0;' +
      'transform:scale(' + BAR_SCALE + ');transform-origin:0 0;';
    var bg = document.createElement('div');
    bg.className = 'health-ui-bar bg wrinkledPaper';
    bg.style.cssText = '--wrinkled-paper-seed: ' + seed + ';';
    var clip = document.createElement('div');
    clip.className = 'health-ui-bar clip';
    var main = document.createElement('div');
    main.className = 'health-ui-bar main wrinkledPaper';
    main.style.cssText = '--wrinkled-paper-seed: ' + seed + '; --wrinkled-paper-color: ' + col.fill + ';';
    clip.appendChild(main);
    var border = document.createElement('div');
    border.className = 'health-ui-bar border wrinkledPaper';
    border.style.cssText = '--wrinkled-paper-seed: ' + seed + '; --wrinkled-paper-border-color: ' + col.border + ';';
    box.appendChild(bg); box.appendChild(clip); box.appendChild(border);
    // the game's heart, same shape and classes
    var heart = document.createElement('div');
    heart.className = 'health-ui-heart';
    heart.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 101 104">' +
      '<path d="M88.46 29.518c-20.115-17.868-37.426 7.436-37.426 7.436s-17.608-24.235-37.723-6.367c-19.15 17.013-1.536 36.621 6.817 45.585 8.678 9.313 27.586 18.743 30.166 18.743s22.968-9.634 31.646-18.947c8.353-8.968 25.67-29.439 6.52-46.45z" style="fill: var(--default-ui-bg-color)"/>' +
      '<path class="fg" d="M78.92 38.154c-14.928-13.261-28.075 9.169-28.075 9.169s-12.7-21.638-27.622-8.376c-14.212 12.624-.877 25.725 5.322 32.377 6.44 6.911 21.905 13.981 21.905 13.981s15.041-7.183 21.482-14.094c6.197-6.653 21.201-20.432 6.988-33.057z" style="fill: var(--default-text-color)"/></svg>';
    box.appendChild(heart);
    holder.appendChild(box);
    d.barClip = clip;
    d.barHeart = heart.querySelector('.fg');
    return holder;
  }
  /** The HUD part for the drill / challenge / waves / flag defense. */
  function modeHud() {
    var now = performance.now();
    if (isDrill() && range.drillHits) {
      var parts = [];
      range.drillHits.forEach(function (n, k) { if (n) parts.push(DRILL_NAMES[k].toLowerCase() + ' ' + n); });
      return '  ·  🏃 ' + DRILL_NAMES[cfg.range_drill] + (parts.length ? ' (hits: ' + parts.join(', ') + ')' : '');
    }
    if (range.chal) {
      var C = range.chal, def = CHALS[C.idx];
      if (C.over) return '  ·  ⏱ ' + def.name + ': done - again in ' + Math.max(0, Math.ceil((C.restartAt - now) / 1000)) + ' s';
      if (now < C.startAt) return '  ·  ⏱ ' + def.name + ': go in ' + Math.ceil((C.startAt - now) / 1000);
      var left = def.goal ? def.cap - (now - C.startAt) / 1000 : def.secs - (now - C.startAt) / 1000;
      return '  ·  ⏱ ' + def.name + ': ' + C.score + (def.goal ? ' / ' + def.goal : '') + ' kills, ' +
        (def.goal ? ((now - C.startAt) / 1000).toFixed(1) + ' s' : Math.max(0, Math.ceil(left)) + ' s left');
    }
    if (range.wave) {
      var W = range.wave, alive = range.dummies.filter(function (x) { return x.alive || (W.state === 'fight' && !x.waveSpawned); }).length;
      return '  ·  🌊 Wave ' + W.n + ' (' + DIFF_NAMES[W.diff] + ')' + (W.state === 'fight' ? ', ' + alive + ' left' : W.state === 'break' ? ', next in ' + Math.max(0, Math.ceil((W.nextAt - now) / 1000)) + ' s' : ' - game over');
    }
    if (isFlagDef()) return '  ·  🛡 Carriers stopped ' + (range.stops || 0);
    if (isTeam() && range.teamKills) return '  ·  Teammate kills ' + range.teamKills;
    return '';
  }
  /*
   * The range HUD: a tidy panel instead of one long line.
   *   1st line: the mode and its score (the 1v1 score, the wave, the challenge clock...)
   *   2nd line: your shooting - kills, hits, accuracy, headshots, longest and average hit
   *   3rd line (Full only, smaller): everything else - flag, practice deaths, learning, keys
   * It can be Full, Compact (first two lines) or Off, at the top centre, top right or bottom centre.
   */
  function rangeHud() {
    var mode = cfg.range_hud || 0;
    if (!range.hudEl || !range.hudEl.isConnected) {
      range.hudEl = document.createElement('div');
      for (var k = 0; k < 3; k++) range.hudEl.appendChild(document.createElement('div'));
      range.hudEl.children[0].style.cssText = 'font:800 15px system-ui,sans-serif;';
      range.hudEl.children[2].style.cssText = 'font:500 11px system-ui,sans-serif;opacity:.75;margin-top:2px;';
      document.body.appendChild(range.hudEl);
      range.hudPosNow = -1;
    }
    var el = range.hudEl;
    if (mode === 2) { el.style.display = 'none'; return; }
    if (range.hudPosNow !== cfg.range_hudPos) {
      range.hudPosNow = cfg.range_hudPos;
      var pos = cfg.range_hudPos === 1 ? 'top:64px;right:12px;text-align:right;'
        : cfg.range_hudPos === 2 ? 'bottom:96px;left:50%;transform:translateX(-50%);text-align:center;'
        : 'top:64px;left:50%;transform:translateX(-50%);text-align:center;';
      el.style.cssText = 'position:fixed;z-index:150;pointer-events:none;max-width:min(92vw,760px);' + pos +
        'padding:6px 14px;border-radius:10px;background:rgba(15,15,20,.62);color:#fff;font:600 13px system-ui,sans-serif;line-height:1.35;';
    }
    el.style.display = '';
    var acc = range.shots ? Math.round(range.hits / range.shots * 100) : 0;
    var top = range.frozen ? '❄ FROZEN (Shift+F8)  ·  ' : '';
    if (range.duel) top += isTeam() ? '⚔ ' + teamSize() + 'v' + teamSize() + '  Your team ' + range.duel.you + ' - ' + range.duel.them + ' Their team  (first to ' + (cfg.range_firstTo || 5) + ')' + (prac.out ? '  ·  you\'re out' : '')
      : '⚔ 1v1  You ' + range.duel.you + ' - ' + range.duel.them + ' Dummy  (first to ' + (cfg.range_firstTo || 5) + ')';
    else {
      var mh = modeHud().replace(/^  ·  /, '');
      top += mh || '🎯 ' + RANGE_MODE_NAMES[rMode()] + '  ·  ' + DIFF_NAMES[diffIdx()] + '  ·  ' + range.dummies.filter(function (x) { return x.alive; }).length + ' / ' + effCount() + ' dummies';
    }
    var mid = 'Kills ' + range.kills + '  ·  Hits ' + range.hits + ' (' + acc + '%)  ·  Heads ' + range.heads + '  ·  Longest ' + range.longest + ' m' +
      (range.hits ? '  ·  Avg ' + Math.round((range.distSum || 0) / range.hits) + ' m' : '') + (range.melee ? '  ·  Melee ' + range.melee : '') +
      (dummiesShoot() ? '  ·  Hit by them ' + range.hitsTaken : '');
    var flagOn = cfg.range_runners > 0 || isFlagDef() || (mixOn() && (cfg.range_mix || {}).flag > 0);
    var extra = mode === 1 ? '' : [
      flagOn ? 'Flag captured ' + range.flagsTaken + (range.carry.by ? ' (they have it!)' : range.carry.dropped ? ' (dropped!)' : '') : '',
      pracOn() && !isDuel() ? 'Practice deaths ' + prac.deaths : '',
      range.envDeaths ? 'Died to the map ' + range.envDeaths : '',
      range.saves ? 'Saved from the map ' + range.saves : '',
      cfg.range_stats && Object.keys(cfg.range_stats).some(function (k) { return statPoints(k) > 0; }) ? '📈 custom stats' : '',
      '🧠 ' + range.wallsKnown + ' walls learned',
      brain && brain.scan && !brain.scan.done ? '🗺 surveying the map ' + Math.round((brain.scan.progress || 0) * 100) + '%' : '',
      fearOfYou() > 0.05 ? '😨 fear of you ' + Math.round(fearOfYou() * 100) + '%' : '',
      'F9 stop · F8 respawn · Shift+F8 freeze'
    ].filter(Boolean).join('  ·  ');
    var c = el.children;
    if (c[0].textContent !== top) c[0].textContent = top;
    if (c[1].textContent !== mid) c[1].textContent = mid;
    if (c[2].textContent !== extra) c[2].textContent = extra;
    c[2].style.display = extra ? '' : 'none';
  }

  /* ---- your flag: dummies grab it and try to carry it home - on YOUR screen only ---- */
  /*
   * The real flag is never touched: the game and the server never hear about any of this, so it
   * can't score or end the match. While a dummy "has" your flag, the real flag is just hidden on
   * your screen and a copy of the game's own flag model rides on the dummy. One carrier at a time.
   * Kill the carrier and the flag drops: touch it to return it, or it goes home by itself after
   * 20 seconds - unless another dummy picks it up first.
   */
  var FLAG_DROP_RETURN = 20000;
  function carryFlagObj(fl) {
    // the game's own flag model, loaded through its own asset loader
    var g = game();
    if (range.carry.ghost || range.carry.loading || !g || !g.assets || typeof g.assets.loadGlbViaWorker !== 'function') return;
    range.carry.loading = true;
    Promise.resolve(g.assets.loadGlbViaWorker('flag.glb', { teamId: fl.teamId })).then(function (obj) {
      range.carry.loading = false;
      if (!obj || !range.on || !range.carry.flag) return;
      obj.traverse && obj.traverse(function (o) { o.frustumCulled = false; });
      range.scene.add(obj);
      range.carry.ghost = obj;
    }).catch(function () { range.carry.loading = false; });
  }
  function setRealFlagHidden(fl, hidden) {
    if (!fl) return;
    try {
      if (fl.obj) fl.obj.visible = !hidden;
      if (fl.icon && typeof fl.icon.setVisibility === 'function') fl.icon.setVisibility(!hidden);
    } catch (e) {}
  }
  function flagHome(msg, color) {
    var c = range.carry;
    if (c.flag) setRealFlagHidden(c.flag, false);
    if (c.ghost && c.ghost.parent) c.ghost.parent.remove(c.ghost);
    if (c.by) c.by.carrying = false;
    range.carry = { by: null, flag: null, dropped: null, ghost: null, loading: false };
    if (msg) toast(msg);
  }
  function grabFlag(d, fl, now) {
    range.carry.by = d; range.carry.flag = fl; range.carry.dropped = null;
    d.carrying = true;
    setRealFlagHidden(fl, true);
    carryFlagObj(fl);
    rangePopup(d, 'A DUMMY GRABBED YOUR FLAG!', false, '#7fb6ff');
  }
  function dropFlag(d, now) {
    if (range.carry.by !== d) return;
    d.carrying = false;
    range.carry.by = null;
    range.carry.dropped = { x: d.x, y: d.y, z: d.z, at: now };
    toast('Your flag was dropped - touch it to return it.');
  }
  /** Runs every frame: keeps the flag copy where it should be and handles returns and captures. */
  function tickFlag(ag, me, now) {
    var c = range.carry;
    if (!c.flag) return;
    var fl = c.flag;
    // a real player grabbed or moved the real flag: the practice flag goes back at once
    if (fl.currentHoldingPlayer || fl.isOnDefaultPos === false) { flagHome(''); return; }
    setRealFlagHidden(fl, true);
    var pos = null;
    if (c.by && c.by.alive) pos = { x: c.by.x, y: c.by.y + 0.4, z: c.by.z };
    else if (c.by && !c.by.alive) dropFlag(c.by, now);
    if (c.dropped) {
      pos = c.dropped;
      if (now - c.dropped.at > FLAG_DROP_RETURN) { flagHome('Your flag went back home.'); return; }
      if (me && !me.dead && flatDist(me.pos.x, me.pos.z, c.dropped.x, c.dropped.z) < 1.8 && Math.abs(me.pos.y - c.dropped.y) < 2.5) {
        flagHome('You returned your flag!'); return;
      }
    }
    if (c.ghost && pos) {
      c.ghost.position.set(pos.x, pos.y, pos.z);
      c.ghost.rotation.y = c.by ? c.by.yaw : 0;
      if (typeof c.ghost.updateMatrixWorld === 'function') c.ghost.updateMatrixWorld(true);
    }
  }
  function enemyHome(ag, me) {
    var pts = enemyBasePoints(ag, me);
    if (!pts || !pts.length) return null;
    var x = 0, y = 0, z = 0;
    pts.forEach(function (p) { x += p.x; y += p.y; z += p.z; });
    return { x: x / pts.length, y: y / pts.length, z: z / pts.length };
  }

  /* ---- dummies shoot back (a setting) - arrows only you see, that can't hurt you for real ---- */
  /*
   * Your real health belongs to the server, so these arrows only count: a red flash and "hit by a
   * dummy" when one lands. They fly like arrows (speed and drop), stop on walls, and dummies aim
   * better - and lead you when you move - the higher the difficulty.
   */
  var DARROW_SPEED = 55, DARROW_GRAVITY = 12;
  var dArrows = [];
  function botArrowSpeed() { return clampN(DARROW_SPEED * botBow().speed * lerp(0.82, 1.05, botT('arrowFlySpeed')) / 0.82, 10, 400); }
  function aimAt(sx, sy, sz, tx, ty, tz) {
    // the low arc that hits (tx, ty, tz) at this speed and drop
    var dx = tx - sx, dz = tz - sz, dy = ty - sy, x = Math.sqrt(dx * dx + dz * dz);
    var SPD = botArrowSpeed();
    var v2 = SPD * SPD, g = DARROW_GRAVITY;
    var root = v2 * v2 - g * (g * x * x + 2 * dy * v2);
    var pitch = root < 0 ? Math.PI / 4 : Math.atan2(v2 - Math.sqrt(root), g * x);
    return { yaw: Math.atan2(dx, dz), pitch: pitch, time: x / (SPD * Math.cos(pitch) || 1) };
  }
  function dummyShoots(d, me, V, now) {
    var D = diff();
    var sx = d.x, sy = d.y + 1.5, sz = d.z;
    var DS = d.motive === 'duel' ? (DUEL_STYLES[botBow().type] || {}) : d.motive === 'sniper' ? { head: 0.6 } : {};   // snipers go for the head
    var tx = me.pos.x, ty = me.pos.y + (DS.head && Math.random() < DS.head ? 1.65 : 1.1), tz = me.pos.z;   // Sharpshooters go for the head
    var aim = aimAt(sx, sy, sz, tx, ty, tz);
    var v = me.rigidBody && me.rigidBody.velocity;
    if (v && D.lead) { tx += v.x * aim.time * D.lead; tz += v.z * aim.time * D.lead; aim = aimAt(sx, sy, sz, tx, ty, tz); }
    var spread = D.spread / (1 + 2 * botT('shootingFocus'));          // Focus steadies their aim
    if (d.steadyAim && d.speedNow === 0) spread *= 0.6;              // standing still for a heavy shot
    d.steadyAim = false;
    var SPD = botArrowSpeed();
    var yaw = aim.yaw + (Math.random() - 0.5) * 2 * spread, pitch = aim.pitch + (Math.random() - 0.5) * 2 * spread;
    var mesh = new range.kit.Mesh(range.geo, arrowMat());
    mesh.frustumCulled = false;
    range.scene.add(mesh);
    dArrows.push({ x: sx, y: sy, z: sz, vx: Math.sin(yaw) * Math.cos(pitch) * SPD, vy: Math.sin(pitch) * SPD,
      vz: Math.cos(yaw) * Math.cos(pitch) * SPD, mesh: mesh, born: now, stuckAt: 0, by: d });
    d.yaw = aim.yaw;
    if (dArrows.length > 40) removeDArrow(dArrows.shift());
  }
  var arrowMatShared = null;
  function arrowMat() {
    if (!arrowMatShared) { arrowMatShared = dummyMat(range.kit); setCol(arrowMatShared, '#3a2a1a'); }
    return arrowMatShared;
  }
  function removeDArrow(a) { if (a.mesh && a.mesh.parent) a.mesh.parent.remove(a.mesh); }
  function placeArrow(a) {
    var m = a.mesh;
    m.position.set(a.x, a.y, a.z);
    m.scale.set(0.035, 0.035, 0.45);
    if (typeof m.lookAt === 'function' && !a.stuckAt) m.lookAt(a.x + a.vx, a.y + a.vy, a.z + a.vz);
    if (typeof m.updateMatrix === 'function') {
      m.matrixAutoUpdate = false; m.updateMatrix();
      if (m.matrixWorld && m.matrixWorld.copy) m.matrixWorld.copy(m.matrix);
      m.matrixWorldNeedsUpdate = true;
    }
  }
  function tickDArrows(ag, me, V, now, dt) {
    var parts = myParts(me);
    for (var i = dArrows.length - 1; i >= 0; i--) {
      var a = dArrows[i];
      if (a.stuckAt) { if (now - a.stuckAt > 3000) { removeDArrow(a); dArrows.splice(i, 1); } continue; }
      var nx = a.x + a.vx * dt, ny = a.y + a.vy * dt, nz = a.z + a.vz * dt;
      a.vy -= DARROW_GRAVITY * dt;
      // you first (the game's own body spheres), then walls
      var hitYou = null, hitBot = null, friendShot = !!(a.by && a.by.side === 'friend');
      // team fight: a teammate's arrow hits the other team; theirs hit you and your teammates
      if (isTeam()) range.dummies.forEach(function (t) {
        if (!t.alive || t === a.by || (t.side === 'friend') === friendShot) return;
        t.parts.forEach(function (p) {
          var tt = segSphere(a.x, a.y, a.z, nx, ny, nz, t.x, t.y + p.y, t.z, p.r);
          if (tt >= 0 && (!hitBot || tt < hitBot.t)) hitBot = { t: tt, p: p, d: t };
        });
      });
      if (me && !me.dead && !friendShot && !(isTeam() && prac.out)) parts.forEach(function (p) {
        var t = segSphere(a.x, a.y, a.z, nx, ny, nz, me.pos.x, me.pos.y + p.y, me.pos.z, p.r);
        if (t >= 0 && (!hitYou || t < hitYou.t)) hitYou = { t: t, p: p };
      });
      var wall = rayHit(ag, new V(a.x, a.y, a.z), new V(nx, ny, nz));
      var wallT = wall ? wall.dist / (Math.sqrt(Math.pow(nx - a.x, 2) + Math.pow(ny - a.y, 2) + Math.pow(nz - a.z, 2)) || 1) : 2;
      if (hitBot && hitBot.t <= wallT && (!hitYou || hitBot.t < hitYou.t)) {
        var bh = hitBot.p.part === 'head';
        damageDummy(hitBot.d, (hitBot.p.dmg || 0.5) * dummyBowDamage(), (bh ? 'HEADSHOT ' : '') + (friendShot ? 'TEAMMATE HIT' : 'ENEMY HIT'), bh, now,
          friendShot ? '#7fb6ff' : '#ff6a5a', false, true);
        removeDArrow(a); dArrows.splice(i, 1);
        continue;
      }
      if (hitYou && hitYou.t <= wallT) {
        range.hitsTaken++;
        if (hitYou.p.part === 'head') range.headsTaken++;
        if (pracOn()) practiceHit(hitYou.p, me, now, a.by);
        youWereHit(hitYou.p.part === 'head');
        removeDArrow(a); dArrows.splice(i, 1);
        continue;
      }
      if (wall) { a.x = wall.pos.x; a.y = wall.pos.y; a.z = wall.pos.z; a.stuckAt = now; placeArrow(a); continue; }
      a.x = nx; a.y = ny; a.z = nz;
      if (now - a.born > 6000) { removeDArrow(a); dArrows.splice(i, 1); continue; }
      placeArrow(a);
    }
  }
  /*
   * Practice health (a setting): dummy arrows hurt a second health bar under yours, using the same
   * rules as a real hit - the body part x the dummies' bow (Assault, x1) x their Attack Strength
   * (none, x0.8), then YOUR real Damage Protection and the 90%-per-second limit; it heals with
   * YOUR Health Regen on the game's curve. Your real health belongs to the server and is untouched.
   */
  function dummyBowDamage() { return botBow().dmg * lerp(0.8, 1.2, botT('bowAttackStrength')); }
  var prac = { hp: 1, lastHitAt: 0, history: [], deaths: 0, deadUntil: 0, el: null };
  function practiceDead() { return pracOn() && (prac.out || performance.now() < prac.deadUntil); }
  function practiceHit(part, me, now, shooter) {
    if (now < prac.deadUntil) return 0;
    var raw = (part.dmg || 0.5) * dummyBowDamage();
    var t = realDamage(prac.history, raw, stat(me, 'armorStrength'), now);
    prac.hp -= t; prac.lastHitAt = now;
    if (prac.hp <= 0.0001) {
      prac.hp = 0; prac.deaths++; prac.deadUntil = now + 2500;
      if (isDuel()) duelRoundOver(false, '', now);
      if (isTeam()) { prac.out = true; prac.deadUntil = Infinity; }   // out until the round ends; your team fights on
      if (isWaves()) waveOver(now);
      // Bloodlust: the game gives a killer +0.1 x its bloodlust value in health
      if (shooter && shooter.alive) shooter.hp = Math.min(1, shooter.hp + 0.1 * botT('bloodlust'));
      practiceDeathScreen(isTeam() ? 'YOU\'RE OUT - your team fights on' : null);
    }
    return t;
  }
  function practiceDeathScreen(text) {
    var o = document.createElement('div');
    o.style.cssText = 'position:fixed;inset:0;z-index:152;pointer-events:none;background:rgba(40,40,40,.45);' +
      'display:flex;align-items:center;justify-content:center;font:900 30px system-ui,sans-serif;color:#fff;' +
      'text-shadow:0 3px 0 #000,0 0 10px #000;transition:opacity .5s;';
    o.textContent = text || 'KILLED BY A DUMMY  (practice)';
    document.body.appendChild(o);
    setTimeout(function () { o.style.opacity = '0'; }, 2000);
    setTimeout(function () { o.remove(); }, 2600);
  }
  function tickPractice(me, now, dtMs) {
    var on = pracOn() && range.on;
    if (!on) { if (prac.el) prac.el.style.display = 'none'; return; }
    if (now >= prac.deadUntil && prac.hp <= 0) { prac.hp = 1; prac.history = []; }
    prac.hp = realRegen(prac.hp, prac.lastHitAt, stat(me, 'healthRegenSpeed'), now, dtMs);
    if (!prac.el || !prac.el.isConnected) {
      prac.el = document.createElement('div');
      prac.el.style.cssText = 'position:fixed;z-index:101;pointer-events:none;display:flex;align-items:center;gap:8px;';
      var lab = document.createElement('div');
      lab.textContent = 'Practice';
      lab.style.cssText = 'font:800 12px system-ui,sans-serif;color:#fff;text-shadow:0 0 3px #000,0 0 3px #000;';
      var holder = { };
      prac.el.appendChild(buildGameHealthBar(holder, 0.6, true));
      prac.el.appendChild(lab);
      prac.clip = holder.barClip; prac.heart = holder.barHeart;
      document.body.appendChild(prac.el);
    }
    // sits just under the game's own health bar
    var real = document.querySelector('.health-ui-container');
    var r = real && real.getBoundingClientRect();
    prac.el.style.display = r && r.width > 0 ? 'flex' : 'none';
    if (r) { prac.el.style.left = Math.round(r.left + 60) + 'px'; prac.el.style.top = Math.round(r.bottom + 2) + 'px'; }
    prac.clip.style.width = Math.max(0, prac.hp) * 100 + '%';
    if (prac.heart) prac.heart.classList.toggle('beating', prac.hp < 0.2);
  }
  function youWereHit(head) {
    var f = document.createElement('div');
    f.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:148;box-shadow:inset 0 0 120px rgba(255,30,30,.75);transition:opacity .6s;';
    document.body.appendChild(f);
    requestAnimationFrame(function () { f.style.opacity = '0'; });
    setTimeout(function () { f.remove(); }, 700);
    var t = document.createElement('div');
    t.textContent = head ? 'HEADSHOT BY A DUMMY' : 'HIT BY A DUMMY';
    t.style.cssText = 'position:fixed;left:50%;top:58%;transform:translateX(-50%);pointer-events:none;z-index:151;' +
      'font:900 16px system-ui,sans-serif;color:#ff6a5a;text-shadow:0 2px 0 #000,0 0 6px #000;transition:opacity .9s;';
    document.body.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; }, 400);
    setTimeout(function () { t.remove(); }, 1400);
  }
  function duelBanner(text, sub) {
    var o = document.createElement('div');
    o.style.cssText = 'position:fixed;left:50%;top:30%;transform:translateX(-50%);z-index:152;pointer-events:none;text-align:center;' +
      'font:900 34px system-ui,sans-serif;color:#fff;text-shadow:0 3px 0 #000,0 0 10px #000;transition:opacity .4s;';
    o.innerHTML = '';
    var a = document.createElement('div'); a.textContent = text; o.appendChild(a);
    if (sub) { var b = document.createElement('div'); b.textContent = sub; b.style.cssText = 'font-size:18px;margin-top:6px;'; o.appendChild(b); }
    document.body.appendChild(o);
    setTimeout(function () { o.style.opacity = '0'; }, 2400);
    setTimeout(function () { o.remove(); }, 2900);
  }
  /** A round ended: score it, then a 3 s countdown with both of you reset - or the match is over. */
  function duelRoundOver(youWon, how, now) {
    var D = range.duel;
    if (!D || D.over) return;
    if (youWon) D.you++; else D.them++;
    var T = isTeam(), vs = teamSize() + 'v' + teamSize();
    var score = T ? 'Your team ' + D.you + ' - ' + D.them + ' Their team' : 'You ' + D.you + ' - ' + D.them + ' Dummy';
    var target = cfg.range_firstTo || 5;
    if (D.you >= target || D.them >= target) {
      D.over = true;
      duelBanner(T ? (D.you > D.them ? 'YOUR TEAM WINS THE ' + vs + '!' : 'THEIR TEAM WINS THE ' + vs) : D.you > D.them ? 'YOU WIN THE 1v1!' : 'THE DUMMY WINS THE 1v1', score + ' (first to ' + target + ')');
      recordSession({ mode: 'range', hits: range.hits, misses: range.shots - range.hits, accuracy: range.shots ? range.hits / range.shots * 100 : 0,
        bestStreak: 0, avgReaction: 0, score: D.you, headshots: range.heads, wave: 0, longest: range.longest });
      D.restartAt = now + 5000;                                   // a fresh match after a short break
      return;
    }
    D.round++;
    D.nextRoundAt = now + 3000;
    duelBanner((T ? (youWon ? 'ROUND TO YOUR TEAM' : 'ROUND TO THEIR TEAM') : youWon ? 'ROUND TO YOU' : 'ROUND TO THE DUMMY') + (how ? ' - ' + how : ''), score + '  -  round ' + D.round + ' in 3...');
    // reset both sides for the next round
    prac.hp = 1; prac.history = []; prac.deadUntil = 0; prac.out = false;
    despawnAll(now);
  }
  function duelRoundStarted(d, now) {
    d.hp = 1; d.dmgHistory = []; d.hrPhase = null; d.burstPhase = null; d.burstLeft = 0; d.peekPhase = null;
    d.nextShotAt = now + rnd(500, 900);
    if (isDuel()) { prac.hp = 1; prac.history = []; }
  }
  /** Everyone off the field (between rounds / waves / challenges); a carried flag goes home. */
  /** F8: every dummy comes back somewhere new (not in the round / wave modes, where that would be cheating). */
  function respawnAll(quiet) {
    if (isRounds() || isWaves()) { if (!quiet) toast('Respawning isn\'t used in ' + RANGE_MODE_NAMES[rMode()] + ' - it\'d skip the fight.'); return; }
    if (range.carry.by) flagHome('');
    range.dummies.forEach(function (x) { x.alive = false; x.downAt = -1e9; x.flashUntil = 0; });
    if (!quiet) toast('Every dummy respawned');
  }
  function despawnAll(now) {
    if (range.carry.by) flagHome('');
    range.dummies.forEach(function (x) { if (x.alive) { x.alive = false; x.downAt = now; } x.roundSpawned = false; x.waveSpawned = false; });
  }
  /** Team fight: the round ends when one side is all down (you count for yours until you're out). */
  function tickTeam(me, now) {
    var D = range.duel;
    if (!isTeam() || !D || D.over || now < D.nextRoundAt) return;
    var en = range.dummies.filter(function (x) { return x.side === 'enemy'; });
    var fr = range.dummies.filter(function (x) { return x.side === 'friend'; });
    if (!en.length || en.some(function (x) { return !x.roundSpawned; })) return;   // still coming in
    if (en.every(function (x) { return !x.alive; })) { duelRoundOver(true, 'their team is down', now); return; }
    var youIn = !prac.out && me && !me.dead;
    if (!youIn && fr.every(function (x) { return !x.alive; })) duelRoundOver(false, 'your team is down', now);
  }
  /** Who a dummy fights in a team fight: the nearest one on the other side (you included). */
  function teamTarget(d, me) {
    var best = null, bd = Infinity;
    function take(o, x, z) { var k = flatDist(x, z, d.x, d.z); if (k < bd) { bd = k; best = o; } }
    if (d.side !== 'friend' && me && !me.dead && !prac.out) take(me, me.pos.x, me.pos.z);
    range.dummies.forEach(function (o) { if (o !== d && o.alive && (o.side === 'friend') !== (d.side === 'friend')) take(o, o.x, o.z); });
    return best;
  }
  /** A dummy dressed up as a "player" target, so the same fighting code can aim at it. */
  function proxyOf(o, V) {
    var p = o.proxy || (o.proxy = { isProxy: true, dead: false, pos: new V(0, 0, 0), rigidBody: { velocity: { x: 0, y: 0, z: 0 } }, hp: 1 });
    p.pos.x = o.x; p.pos.y = o.y; p.pos.z = o.z;
    p.rigidBody.velocity.x = o.velX || 0; p.rigidBody.velocity.z = o.velZ || 0; p.hp = o.hp;
    return p;
  }

  /* ---- waves ---- */
  function newWave(n, at) {
    var base = Math.max(1, cfg.range_diff);
    return { n: n, count: Math.min(30, n + 1), diff: cfg.range_diff === 5 ? 5 : Math.min(4, base + Math.floor((n - 1) / 3)), state: 'break', nextAt: at };
  }
  function tickWaves(now) {
    var W = range.wave;
    if (!isWaves() || !W) return;
    if (W.state === 'over') {
      if (now >= W.restartAt) {
        range.wave = newWave(1, now + 3000);
        prac.hp = 1; prac.history = []; prac.deadUntil = 0;
        duelBanner('WAVES', 'again from wave 1 - starting in 3...');
      }
      return;
    }
    if (W.state === 'break') {
      if (now >= W.nextAt) { W.state = 'fight'; range.dummies.forEach(function (x) { x.waveSpawned = false; }); }
      return;
    }
    if (range.dummies.length >= W.count && range.dummies.every(function (x) { return x.waveSpawned && !x.alive; })) {
      var nx = newWave(W.n + 1, now + 4000);
      range.wave = nx;
      prac.hp = 1; prac.history = [];                               // a breather: full health for the next wave
      duelBanner('WAVE ' + W.n + ' CLEARED', 'wave ' + nx.n + ': ' + nx.count + ' dummies (' + DIFF_NAMES[nx.diff] + ') in 4...');
    }
  }
  function waveOver(now) {
    var W = range.wave;
    if (!W || W.state === 'over') return;
    W.state = 'over'; W.restartAt = now + 7000;
    var rec = recordChallenge('Waves', W.n, 'wave', false);
    logResult('Waves', W.n, 'wave');
    duelBanner('GAME OVER - WAVE ' + W.n, (rec.isNew ? 'a new best! ' : 'best: wave ' + rec.best + '.  ') + 'Again in 7...');
    despawnAll(now);
  }

  /* ---- timed challenges ---- */
  function newChal(now) {
    var def = CHALS[cfg.range_chal] || CHALS[0];
    duelBanner('CHALLENGE', def.name + '  -  go in 3...');
    return { idx: CHALS.indexOf(def), startAt: now + 3000, score: 0, over: false };
  }
  function chalKill(now) {
    var C = range.chal;
    if (C && !C.over && now >= C.startAt) C.score++;
  }
  function tickChal(now) {
    var C = range.chal;
    if (!isChal() || !C) return;
    if (C.over) { if (now >= C.restartAt) { despawnAll(now); range.chal = newChal(now); } return; }
    if (now < C.startAt) return;
    var def = CHALS[C.idx], t = now - C.startAt;
    var done = def.goal ? (C.score >= def.goal || t >= def.cap * 1000) : t >= def.secs * 1000;
    if (!done) return;
    C.over = true; C.restartAt = now + 8000;
    if (def.goal && C.score < def.goal) {
      duelBanner('OUT OF TIME', C.score + ' / ' + def.goal + ' kills  -  again in 8...');
      return;
    }
    var val = def.goal ? Math.round(t) : C.score;
    var rec = recordChallenge(def.name, val, def.goal ? 'ms' : 'kills', !!def.goal);
    logResult(def.name, val, def.goal ? 'ms' : 'kills');
    duelBanner(def.goal ? 'DONE IN ' + fmtChal(val, 'ms') : C.score + ' KILLS', (rec.isNew ? 'a new best!' : 'best: ' + fmtChal(rec.best, def.goal ? 'ms' : 'kills')) + '  -  again in 8...');
  }
  function fmtChal(v, unit) { return unit === 'ms' ? (v / 1000).toFixed(1) + ' s' : unit === 'wave' ? 'wave ' + v : v + ' kill' + (v === 1 ? '' : 's'); }
  /** Keep your best for this challenge, with this bow, on this map. */
  function recordChallenge(name, value, unit, lowerBetter) {
    var ag = range.game, me = ag && myPlayer(ag);
    var bow = myBowName(me), key = name + '|' + bow + '|' + (ag ? mapKey(ag) : '');
    if (!state.chal) state.chal = {};
    var r = state.chal[key];
    var isNew = !r || (lowerBetter ? value < r.best : value > r.best);
    if (isNew) state.chal[key] = r = { name: name, bow: bow, map: ag ? mapLabel(ag) : '', best: value, unit: unit, at: Date.now() };
    r.last = Date.now();
    save();
    return { isNew: isNew, best: r.best };
  }

  /* ---- session history: every range session, and every challenge / waves result, for the graph ---- */
  function pushSession(e) {
    if (!state.sessions) state.sessions = [];
    state.sessions.push(e);
    state.sessions = state.sessions.slice(-200);
    save();
  }
  function logSession(acc) {
    pushSession({ at: Date.now(), mode: rMode(), kills: range.kills, shots: range.shots, hits: range.hits, heads: range.heads,
      acc: Math.round(acc), avg: range.hits ? Math.round((range.distSum || 0) / range.hits) : 0, longest: range.longest,
      won: range.duel ? range.duel.you : undefined });
  }
  function logResult(name, val, unit) { pushSession({ at: Date.now(), mode: rMode(), result: name, val: val, unit: unit }); }

  /* ---- your aim stats, per bow ---- */
  function aimRow(bow) {
    var A = range.aimNow || (range.aimNow = {}), k = bow || 'Your bow';
    return A[k] || (A[k] = { shots: 0, hits: 0, heads: 0, dist: 0 });
  }
  function saveAim() {
    if (!range.aimNow) return;
    if (!state.aim) state.aim = { bows: {}, sessions: [] };
    Object.keys(range.aimNow).forEach(function (n) {
      var r = range.aimNow[n];
      if (!r.shots) return;
      var b = state.aim.bows[n] || (state.aim.bows[n] = { shots: 0, hits: 0, heads: 0, dist: 0 });
      b.shots += r.shots; b.hits += r.hits; b.heads += r.heads; b.dist += r.dist;
      state.aim.sessions.push({ at: Date.now(), bow: n, shots: r.shots, hits: r.hits, heads: r.heads, dist: r.dist, mode: rMode() });
    });
    state.aim.sessions = state.aim.sessions.slice(-60);
    range.aimNow = {};
    save();
  }

  /* ---- distance rings: dots on the ground at 10 / 25 / 50 / 75 m around you ---- */
  var RINGS = [10, 25, 50, 75], RING_COLS = ['#7dff9a', '#ffe17d', '#ffad5c', '#ff6a6a'], RING_PTS = 48;
  function tickRings(g, ag, me, V, eye, now) {
    if (!cfg.range_rings || !me || me.dead) { if (range.ringCv) range.ringCv.style.display = 'none'; return; }
    var cv = range.ringCv;
    if (!cv || !cv.isConnected) {
      cv = range.ringCv = document.createElement('canvas');
      cv.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:147;';
      document.body.appendChild(cv);
      range.ringPts = []; range.ringJob = null; range.ringAt = null;
    }
    cv.style.display = '';
    // where the ground is (and whether you can see it) around you, one ring per frame, again when you move
    var at = range.ringAt;
    if (!range.ringJob && (!at || flatDist(at.x, at.z, me.pos.x, me.pos.z) > 1.5 || Math.abs(at.y - me.pos.y) > 1 || now - at.t > 1500)) {
      range.ringJob = { x: me.pos.x, y: me.pos.y, z: me.pos.z, k: 0, pts: [] };
    }
    var J = range.ringJob;
    if (J) {
      var R = RINGS[J.k], ring = [];
      for (var i = 0; i < RING_PTS; i++) {
        var a = i / RING_PTS * Math.PI * 2, x = J.x + Math.sin(a) * R, z = J.z + Math.cos(a) * R;
        var gy = groundAt(ag, V, x, J.y, z, 10);
        if (gy === null) continue;
        ring.push({ x: x, y: gy, z: z, a: a, seen: youCanSee(ag, eye, V, x, gy + 0.3, z) });
      }
      J.pts[J.k] = ring;
      if (++J.k >= RINGS.length) { range.ringPts = J.pts; range.ringAt = { x: J.x, y: J.y, z: J.z, t: now }; range.ringJob = null; }
    }
    var ctx = cv.getContext && cv.getContext('2d');
    if (!ctx) return;
    if (cv.width !== window.innerWidth || cv.height !== window.innerHeight) { cv.width = window.innerWidth; cv.height = window.innerHeight; }
    ctx.clearRect(0, 0, cv.width, cv.height);
    var yaw = lookYaw(g, V);
    range.ringPts.forEach(function (ring, k) {
      if (!ring) return;
      var lbl = null, bd = 9;
      ctx.fillStyle = RING_COLS[k];
      ring.forEach(function (p) {
        if (!p.seen) return;
        var sp = screenPoint(g, V, p.x, p.y + 0.08, p.z);
        if (!sp) return;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, k === 0 ? 4 : 3, 0, Math.PI * 2); ctx.fill();
        var da = Math.abs(Math.atan2(Math.sin(p.a - yaw), Math.cos(p.a - yaw)));
        if (da < bd) { bd = da; lbl = sp; }
      });
      if (lbl && bd < 0.6) {
        ctx.font = '800 14px system-ui,sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)';
        ctx.strokeText(RINGS[k] + ' m', lbl.x, lbl.y - 8); ctx.fillText(RINGS[k] + ' m', lbl.x, lbl.y - 8);
      }
    });
  }
  function maybeShoot(d, ag, me, V, eye, now) {
    if (!dummiesShoot() || !me || me.dead || !d.alive) return;
    if (d.carrying || (diff().flee && now < d.fleeUntil) || d.hiding) { d.drawing = false; return; }   // busy running
    if (d.motive !== 'hunter' && d.motive !== 'high' && d.motive !== 'still' && d.motive !== 'explorer' && d.motive !== 'anchor' && d.motive !== 'duel' &&
        !(PERS_THINK[d.motive] && d.motive !== 'coward')) return;            // cowards never shoot
    if (range.duel && now < range.duel.nextRoundAt) return;          // countdown
    var hacker = !!diff().fly;                                     // Hackers skip the shooting action
    var toMeYaw = Math.atan2(me.pos.x - d.x, me.pos.z - d.z);
    if (d.burstLeft > 0) {
      // a Support burst: aim first (the shooting action), then one arrow every 140 ms
      if (!hacker && !d.burstAimed) {
        if (!d.drawing) { d.drawing = true; d.drawStart = now; }
        d.yaw = toMeYaw;
        if (now - d.drawStart < drawMs()) return;
        d.drawing = false; d.burstAimed = true;
      }
      d.yaw = toMeYaw;
      if (now < d.nextShotAt) return;
      d.nextShotAt = now + 140; d.burstLeft--;
      if (d.burstLeft === 0) { d.burstDone = true; d.burstAimed = false; }
      d.lastReleaseAt = now;
      if (youCanSee(ag, eye, V, d.x, d.y + 1.5, d.z)) dummyShoots(d, me, V, now);
      return;
    }
    if (d.motive === 'duel' && (DUEL_STYLES[botBow().type] || {}).burst && !(d.burstLeft > 0)) return;   // Support only shoots in bursts
    if (flatDist(d.x, d.z, me.pos.x, me.pos.z) > 70) return;
    var fireMul = botBow().fire / lerp(1, 2, botT('arrowLoadingSpeed'));   // the bow's pace, faster with Loading Speed
    if (!d.nextShotAt) d.nextShotAt = now + Math.max(80, rnd(diff().fire[0], diff().fire[1]) * fireMul);
    var gap = Math.max(80, rnd(diff().fire[0], diff().fire[1]) * fireMul);
    if (hacker) {
      // a Hacker just fires - no shooting action
      if (now < d.nextShotAt) return;
      d.nextShotAt = now + gap;
      if (youCanSee(ag, eye, V, d.x, d.y + 1.5, d.z)) dummyShoots(d, me, V, now);
      return;
    }
    if (!d.drawing) {
      if (now < d.nextShotAt) return;
      if (!youCanSee(ag, eye, V, d.x, d.y + 1.5, d.z)) { d.nextShotAt = now + 200; return; }   // only starts a shot at you if it can see you
      d.drawing = true; d.drawStart = now; d.drawLostAt = 0;      // the shooting action starts: raise and draw
      d.yaw = toMeYaw;
      return;
    }
    // drawing: face you; lost sight of you? hold the draw a moment, then lower the bow
    d.yaw = toMeYaw;
    if (!youCanSee(ag, eye, V, d.x, d.y + 1.5, d.z)) {
      if (!d.drawLostAt) d.drawLostAt = now;
      if (now - d.drawLostAt > 1200) { d.drawing = false; d.nextShotAt = now + 300; }
      return;
    }
    d.drawLostAt = 0;
    if (now - d.drawStart < drawMs()) return;                    // not fully drawn yet
    d.drawing = false; d.lastReleaseAt = now;
    d.nextShotAt = now + Math.max(150, gap - drawMs());          // the draw is part of its pace
    dummyShoots(d, me, V, now);                                   // let go
  }

  /* ---- start / stop / loop ---- */
  function removeDummy(d) {
    d.meshes.forEach(function (m) { if (m.parent) m.parent.remove(m); });
    d.mats.forEach(function (m) { try { m.dispose(); } catch (e) {} });
    if (d.model) { if (d.model.obj && d.model.obj.parent) d.model.obj.parent.remove(d.model.obj); try { d.model.destructor(); } catch (e) {} d.model = null; }
    if (d.bar) d.bar.remove();
  }
  function clearDummies() {
    range.dummies.forEach(removeDummy);
    range.dummies = [];
    if (range.barLayer) { range.barLayer.remove(); range.barLayer = null; }
  }
  /** A card with how the session went (when the range stops). */
  function summaryCard(title, rows) {
    var o = document.createElement('div');
    o.style.cssText = 'position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:300;pointer-events:none;min-width:280px;' +
      'padding:14px 22px;border-radius:12px;background:rgba(15,15,20,.86);color:#fff;font:600 14px system-ui,sans-serif;transition:opacity .6s;';
    var h = document.createElement('div');
    h.textContent = title;
    h.style.cssText = 'font-size:18px;font-weight:900;margin-bottom:8px;text-align:center;';
    o.appendChild(h);
    rows.forEach(function (r) {
      if (!r) return;
      var l = document.createElement('div');
      l.style.cssText = 'display:flex;justify-content:space-between;gap:24px;padding:2px 0;';
      var a = document.createElement('span'); a.textContent = r[0]; a.style.opacity = '.7';
      var b = document.createElement('b'); b.textContent = String(r[1]);
      l.appendChild(a); l.appendChild(b); o.appendChild(l);
    });
    document.body.appendChild(o);
    setTimeout(function () { o.style.opacity = '0'; }, 6500);
    setTimeout(function () { o.remove(); }, 7200);
  }
  /** The first time the range starts: what to do and the keys. */
  function coachTip() {
    if (cfg.range_coachSeen) return;
    cfg.range_coachSeen = 1; save();
    summaryCard('Target Practice is on!', [
      ['Shoot the dummies', 'with your real bow (or melee)'],
      ['F9', 'stop the range'],
      ['F8', 'respawn every dummy'],
      ['Shift+F8', 'freeze / unfreeze them'],
      ['Settings', 'Target Practice in the menu']
    ]);
  }
  function toast(msg) {
    var m = document.createElement('div');
    m.textContent = msg;
    m.style.cssText = 'position:fixed;left:50%;bottom:24%;transform:translateX(-50%);z-index:300;pointer-events:none;max-width:86vw;text-align:center;' +
      'padding:9px 16px;border-radius:10px;background:rgba(15,15,20,.8);color:#fff;font:700 15px system-ui,sans-serif;';
    document.body.appendChild(m);
    setTimeout(function () { m.remove(); }, 3000);
  }
  function startRange() {
    try { return startRangeInner(); } catch (err) { tpReport('starting the in-game range', err); range.on = false; return false; }
  }
  function startRangeInner() {
    var g = game();
    if (!g) {
      ensurePatched().then(function (r) {
        toast(r === 'patched' ? 'Target Practice is hooked in - reload the page once, then try again.'
          : r === 'already' ? 'Reload the page once - the hook is in place but this page loaded before it.'
          : r === 'no-cache' ? 'Play one round first (so the game saves itself), then reload the page and try again.'
          : r === 'no-match' ? 'The game was updated and Target Practice can\'t hook into it any more - it needs an update.'
          : 'Target Practice could not hook into the game (' + r + '). Press F12 > Console for details.');
      });
      return false;
    }
    var ag = liveGame(), me = ag && myPlayer(ag);
    if (!ag || !me) { toast('Join a match first - the range is set up around you in the real map.'); return false; }
    range.kit = rangeKit(g);
    if (!range.kit) { toast('Could not set up the dummies on this map.'); return false; }
    range.game = ag; range.scene = g.scene; range.geo = sphereGeo(range.kit);
    range.modelKit = findModelKit(ag, me);                     // null: plain sphere dummies instead
    range.visited = {};
    useBrainFor(ag);                                           // this map's memory from earlier sessions
    startScan(ag);                                             // and survey the map if that's not done yet
    range.wallsKnown = knownWalls();
    range.shots = 0; range.hits = 0; range.heads = 0; range.kills = 0; range.melee = 0; range.flagsTaken = 0;
    range.longest = 0; range.last = 0; range.hitsTaken = 0; range.headsTaken = 0;
    dangers = [];
    sessionKills = 0;
    var t0 = performance.now();
    range.distSum = 0; range.stops = 0; range.teamKills = 0; range.aimNow = {}; range.drillHits = [0, 0, 0, 0, 0];
    prac.out = false;
    range.duel = isRounds() ? { you: 0, them: 0, round: 1, over: false, nextRoundAt: t0 + 3000 } : null;
    if (isDuel()) duelBanner('1v1', 'first to ' + (cfg.range_firstTo || 5) + '  -  vs ' + botBow().name + '  -  starting in 3...');
    if (isTeam()) duelBanner(teamSize() + 'v' + teamSize(), 'you + ' + (teamSize() - 1) + ' teammate' + (teamSize() > 2 ? 's' : '') + '  -  first to ' + (cfg.range_firstTo || 5) + '  -  starting in 3...');
    range.wave = isWaves() ? newWave(1, t0 + 3000) : null;
    if (isWaves()) duelBanner('WAVES', 'survive as long as you can  -  wave 1 in 3...');
    range.chal = isChal() ? newChal(t0) : null;
    range.ringCv = null; range.ringPts = []; range.ringJob = null; range.ringAt = null;
    range.envDeaths = 0; range.saves = 0;
    prac.hp = 1; prac.history = []; prac.deaths = 0; prac.deadUntil = 0;
    range.hooked = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    var mine = ag.arrowManager.arrows.get(me.id);
    if (mine && range.hooked) mine.forEach(function (a) { range.hooked.add(a); });
    range.on = true;
    range.frozen = false; range.frameNo = 0;
    coachTip();
    if (isFlagDef()) toast(myFlag(ag, me) ? 'Flag defense: ' + cfg.range_count + ' dummies are coming for your flag. Stop the carriers! F9 to stop.'
      : ag.kingOfTheHillPosition ? 'No flags on this map - they\'ll go for the hill instead. F9 to stop.' : 'No flag on this map - flag defense needs Capture the Flag. F9 to stop.');
    else if (isDrill()) toast('Movement drill: ' + DRILL_NAMES[cfg.range_drill] + ', ' + cfg.range_count + ' dummies in front of you. F9 to stop.');
    else if (!isRounds() && !isWaves() && !isChal()) toast('Range on (' + DIFF_NAMES[cfg.range_diff] + '): ' + effCount() + ' dummies from ' + (cfg.range_spawn === 0 ? 'the enemy base' : cfg.range_spawn === 1 ? 'in front of you' : cfg.range_spawn === 2 ? 'all over the map' : 'all over') +
      (cfg.range_runners > 0 ? ', ' + Math.min(cfg.range_runners, cfg.range_count) + ' going for the objective' : '') + '. F9 to stop.');
    if (!range.raf) range.raf = requestAnimationFrame(rangeLoop);
    return true;
  }
  function restartRange() { stopRange(true); startRange(); }
  function stopRange(quiet) {
    try { stopRangeInner(quiet); } catch (err) { range.on = false; tpReport('stopping the in-game range', err); }
  }
  function stopRangeInner(quiet) {
    if (!range.on) return;
    range.on = false;
    saveBrains(true);
    flagHome('');
    arrowSegs = [];
    dArrows.forEach(removeDArrow); dArrows = [];
    if (prac.el) { prac.el.remove(); prac.el = null; }
    if (range.ringCv) { range.ringCv.remove(); range.ringCv = null; }
    saveAim();
    clearDummies();
    if (range.hudEl) { range.hudEl.remove(); range.hudEl = null; }
    if (range.shots > 0 || range.melee > 0) {
      var acc = range.shots ? range.hits / range.shots * 100 : 0;
      logSession(acc);
      recordSession({ mode: 'range', hits: range.hits, misses: range.shots - range.hits, accuracy: acc,
        bestStreak: 0, avgReaction: 0, score: range.kills, headshots: range.heads, wave: 0, longest: range.longest });
      if (!quiet) summaryCard('Range over  ·  ' + RANGE_MODE_NAMES[rMode()], [
        ['Kills', range.kills],
        ['Arrows hit', range.hits + ' / ' + range.shots + '  (' + Math.round(acc) + '%)'],
        ['Headshots', range.heads + (range.hits ? '  (' + Math.round(range.heads / range.hits * 100) + '% of hits)' : '')],
        ['Longest / average hit', range.longest + ' m / ' + (range.hits ? Math.round((range.distSum || 0) / range.hits) : 0) + ' m'],
        range.melee ? ['Melee hits', range.melee] : null,
        range.hitsTaken ? ['Hit by dummies', range.hitsTaken + (prac.deaths ? ', practice deaths ' + prac.deaths : '')] : null,
        range.duel ? ['Score', range.duel.you + ' - ' + range.duel.them] : null,
        range.stops ? ['Carriers stopped', range.stops] : null
      ]);
    } else if (!quiet) toast('Range off');
  }
  var lastRangeFrame = 0;
  function rangeLoop(now) {
    range.raf = null;
    if (!range.on) return;
    range.raf = requestAnimationFrame(rangeLoop);
    try { rangeFrame(now); } catch (err) { tpReport('the in-game range', err); }
  }
  function rangeFrame(now) {
    var dt = Math.min(0.05, Math.max(0, (now - (lastRangeFrame || now)) / 1000));
    lastRangeFrame = now;
    range.frameNo = (range.frameNo || 0) + 1;
    var g = game(), ag = liveGame();
    if (!g || !ag || ag !== range.game || g.scene !== range.scene) { stopRange(); return; }   // match ended
    var me = myPlayer(ag);
    if (!me) return;
    var V = me.pos.constructor;
    var eye = eyePos(g, me, V);
    var camO = g.cam && g.cam.cam;
    if (camO && typeof camO.getWorldDirection === 'function') { range.camDir = range.camDir || new V(0, 0, -1); camO.getWorldDirection(range.camDir); range.camPos = eye; }
    hookArrows(ag, me);
    patchMelee(me.meleeWeapon);
    if (!range.modelKit) range.modelKit = findModelKit(ag, me);
    while (range.dummies.length < effCount()) range.dummies.push(buildDummy(me, range.dummies.length));
    while (range.dummies.length > effCount()) removeDummy(range.dummies.pop());
    range.dummies.forEach(function (d, i) {
      curD = d;                                                     // its own difficulty (custom mix)
      if (!d.model && !d.modelLoading && range.modelKit) buildModel(d, me);
      if (!d.alive) {
        if (now >= d.flashUntil) d.meshes.forEach(function (m) { m.visible = false; });
        var canSpawn = isRounds() ? (range.duel && now >= range.duel.nextRoundAt && !range.duel.over && !d.roundSpawned)   // once per round
          : isWaves() ? (range.wave && range.wave.state === 'fight' && !d.waveSpawned)                                       // once per wave
          : isChal() ? (range.chal && !range.chal.over && now - d.downAt >= cfg.range_respawn * 1000)
          : now - d.downAt >= cfg.range_respawn * 1000;
        if (canSpawn && !me.dead) {
          spawnDummy(d, i, g, ag, me, V, now);
          if (d.alive && isRounds()) { d.roundSpawned = true; duelRoundStarted(d, now); }
          if (d.alive && isWaves()) d.waveSpawned = true;
        }
      } else if (range.frozen) {
        d.speedNow = 0; d.drawing = false;                            // frozen (Shift+F8): stand still, don't shoot
      } else {
        // With lots of dummies, one that's far away and out of your sight is updated every 2nd or
        // 3rd frame (with the time in between added up) - you can't tell, and it keeps 50 smooth.
        var every = 1;
        if (range.dummies.length > 12 && !d.barSeen && !d.carrying && d.side !== 'friend') {
          var far = flatDist(d.x, d.z, me.pos.x, me.pos.z);
          every = far > 45 ? 3 : far > 25 ? 2 : 1;
        }
        d.lodDt = (d.lodDt || 0) + dt;
        if ((range.frameNo + i) % every === 0) {
          var udt = Math.min(0.12, d.lodDt);
          d.lodDt = 0;
          // who it's up against: you - or, in a team fight, the nearest one on the other side
          var tgt = me, tEye = eye, ox = d.x, oz = d.z;
          if (isTeam()) {
            var tg = teamTarget(d, me);
            tgt = tg === me ? me : tg ? proxyOf(tg, V) : null;
            if (tg && tg !== me) tEye = new V(tg.x, tg.y + 1.6, tg.z);
          }
          if (tgt) think(d, g, ag, V, tgt, tEye, now, udt);
          else { d.speedNow = 0; d.label = ''; }
          if (diffIdx() > 0) { var rgT = botT('healthRegenSpeed'); d.hp = realRegen(d.hp, d.lastHitAt || 0, rgT, now, udt * 1000, Math.max(1, rgT)); }   // heals like a player
          if (tgt) maybeShoot(d, ag, tgt, V, tEye, now);
          var DJ = diff().jump;
          if (DJ && d.onGround && now >= d.nextJump) {
            d.vy = JUMP_SPEED; d.onGround = false; d.nextJump = now + rnd(DJ[0], DJ[1]);
          }
          if (!DJ) d.nextJump = Infinity;
          applyGravity(ag, V, d, me, now, udt);
          tickHazards(ag, V, d, now, udt * 1000);                       // rivers, damage zones, falling off - same as for you
          if (udt > 0) { d.velX = (d.x - ox) / udt; d.velZ = (d.z - oz) / udt; }   // how it's moving (so others can lead it)

          // learn level changes: walking up stairs, jumping up, dropping down
          if (d.onGround) {
            var cellAfter = cellOf(d.x, d.y, d.z);
            if (d.lastGroundCell && d.lastGroundCell[1] !== cellAfter[1]) learnLink(d.lastGroundCell, cellAfter);
            d.lastGroundCell = cellAfter;
          }
        }
      }
      var flash = now < d.flashUntil ? 1 : 0;
      if (d.model) {
        poseModel(d, now, dt);
      } else {
        d.parts.forEach(function (p, j) {
          var m = d.meshes[j];
          setCol(m.material, PART_COLS[p.part] || '#c9473b');
          m.material.uniforms.flash.value = flash;
          placeMesh(m, range.scene, d.x, d.y + p.y, d.z, p.r);
        });
      }
    });
    curD = null;
    if (range.duel && range.duel.over && now >= range.duel.restartAt) {
      range.duel = { you: 0, them: 0, round: 1, over: false, nextRoundAt: now + 3000 };
      duelBanner(isTeam() ? 'NEW ' + teamSize() + 'v' + teamSize() : 'NEW 1v1', 'first to ' + (cfg.range_firstTo || 5) + '  -  starting in 3...');
      prac.hp = 1; prac.history = []; prac.out = false; prac.deadUntil = 0;
      despawnAll(now);
    }
    tickTeam(me, now);
    tickWaves(now);
    tickChal(now);
    tickRings(g, ag, me, V, eye, now);
    tickScan(V);
    tickArrowSegs(now);
    tickFlag(ag, me, now);
    tickPractice(me, now, dt * 1000);
    tickDArrows(ag, me, V, now, dt);
    drawBars(g, ag, me, V, eye, now);
    if (now - lastBrainSave > 10000) { lastBrainSave = now; saveBrains(); range.wallsKnown = knownWalls(); }
    rangeHud();
  }

  window.addEventListener('keydown', function (e) {
    if (e.repeat) return;
    if (e.code === 'F9') {
      e.preventDefault();
      if (range.on) stopRange(); else startRange();
    } else if (e.code === 'F8' && range.on) {
      e.preventDefault();
      if (e.shiftKey) { range.frozen = !range.frozen; toast(range.frozen ? 'Dummies frozen - Shift+F8 to let them go' : 'Dummies moving again'); }
      else respawnAll(false);
    }
  }, true);

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
    // Never a Tab-navigation stop - the game silently drops every keydown
    // while any BUTTON/INPUT/SELECT has focus (its own inputHasFocus()
    // check), so this button must never be where Tab's default focus
    // cycling can land while you're actually playing.
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

  console.log('[Target Practice ' + TP_VERSION + '] ready.');
  } catch (err) {
    tpReport('starting up', err);
  }
})();
