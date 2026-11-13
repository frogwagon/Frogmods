// ==UserScript==
// @name         Narrow One - Update
// @namespace    narrowone-quiver-rework
// @version      1.5.3
// @description  No more infinite arrows, and a stamina bar. Your quiver and your bow decide how many arrows you carry and how fast they come back; your arm, glove, leg and shoe pieces decide your stamina. Moving, jumping and charging melee use stamina. Press F7 for the tables.
// @author       Frogwagon
// @match        https://narrow.one/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

/*
 * Quiver Rework  -  Narrow One
 * ----------------------------
 * A challenge "update": arrows are limited. Each quiver gets three arrow
 * stats of its own:
 *
 *   capacity  - how many arrows it holds
 *   regen     - seconds per arrow while it refills
 *   delay     - seconds after a shot before refilling starts
 *
 * You start every life with a full quiver. Each arrow you fire uses one
 * (a multi-arrow shot uses one per arrow), and when it's empty your bow
 * won't draw until an arrow comes back. Running out of arrows never blocks melee.
 *
 * What it does NOT do: it never changes damage, never adds stats, and
 * never touches your real gear - your quiver's normal stats stay exactly
 * as they are. Damage is decided by the game's server anyway, so a mod
 * couldn't add any; and even if it could, extra damage would land on real
 * players who never agreed to the trade. This only ever makes the game
 * harder for you.
 *
 * Stamina: moving, jumping and charging your melee weapon use stamina.
 * Every arm, glove, leg and shoe piece adds its own max stamina and regen;
 * arms and gloves make melee cheaper, legs and shoes make moving cheaper.
 * At 0 you are tired: you walk slower, can't jump and can't charge melee until it is
 * back to 30%. Like the arrows, this only ever slows YOU down.
 *
 * How: the same reversible cache patch the other Frogmods use publishes
 * the game's main instance as window.__NARROW. The mod then reads which
 * quiver you have equipped (equippedSkinData.equippedSkinIds) and wraps
 * your own bow's shootArrow() to count shots. Nothing is sent anywhere.
 */

(function () {
  'use strict';

  var PAGE = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;

  /* ================================================================== *
   * Part 1 - the cache patch (same as the other Frogmods; see the
   * 1 Kill = 1 Stat Point mod for the long explanation)
   * ================================================================== */

  var ENTRY_RE = /\/js\/index-[^/]*\.js$/;
  var PO_RE = /function ([A-Za-z_$][\w$]*)\(\)\{if\(!([A-Za-z_$][\w$]*)\)throw new Error\("Main instance is not initialized"\);return \2\}/;
  var CACHE_RE = /^narrowClient\d+$/;
  var MARK = '__NARROW';

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
  /** Writes the patched bundle into the game's own cache. Takes effect on the next reload. */
  function ensurePatched() {
    var cacheRef = null, urlRef = null;
    return findCacheName().then(function (name) {
      if (!name) return 'no-cache';
      return caches.open(name).then(function (cache) {
        cacheRef = cache;
        return findEntryUrl(cache);
      }).then(function (url) {
        if (!url) return 'no-entry';
        urlRef = url;
        return cacheRef.match(url, { ignoreSearch: true }).then(function (res) {
          if (res) return res.text();
          return fetch(url, { credentials: 'same-origin' }).then(function (r) { return r.text(); });
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

  /* ================================================================== *
   * Part 2 - the rework
   * ================================================================== */

  var STORE_KEY = 'narrowone.quiverRework.v1';

  // id -> [name, capacity, seconds per arrow, delay after a shot]
  // Rough rule: big quivers refill slowly, small ones refill fast.
  var QUIVERS = {
    none:                     ['No quiver',             5, 4.0, 2.0],
    commonerArrowPouch:       ['Commoner Arrow Pouch',  8, 2.5, 1.5],
    peasantArrowPouch:        ['Peasant Arrow Pouch',   6, 2.0, 1.0],
    pelicanWarriorQuiver:     ['Pelican Warrior',      10, 3.0, 1.5],
    basicArmorQuiver:         ['Basic Armor Quiver',   12, 3.5, 2.0],
    stripedArmorQuiver:       ['Striped Armor Quiver',  9, 2.2, 1.2],
    xmasSockQuiver:           ['Christmas Sock',       24, 6.0, 3.0],
    bambooQuiver:             ['Bamboo Quiver',        11, 2.6, 0.8],
    heavySideQuiver:          ['Heavy Side Quiver',    20, 4.5, 2.5],
    hunterQuiver:             ['Hunter Quiver',        14, 2.4, 1.0],
    woodenLogQuiver:          ['Wooden Log',           30, 7.0, 4.0],
    samuraiArmorQuiver:       ['Samurai Quiver',       13, 1.8, 1.4],
    qingDynastyWarriorQuiver: ['Qing Dynasty Quiver',  15, 2.8, 1.2],
    aztecWarriorQuiver:       ['Aztec Warrior Quiver',  7, 1.2, 0.5],
    vikingBackQuiver:         ['Viking Back Quiver',   18, 3.2, 1.8],
    ottomanJanissaryQuiver:   ['Ottoman Janissary',    16, 2.0, 2.2],
    pharaohQuiver:            ['Pharaoh Quiver',       22, 3.8, 1.6],
    skullTribeWarriorQuiver:  ['Skull Tribe Quiver',   10, 1.5, 0.6],
    kingQuiver:               ['King Quiver',          25, 2.5, 2.0],
    bloodlustBarbarianQuiver: ['Bloodlust Barbarian',  12, 1.4, 3.0]
  };

  /** A quiver added to the game after this mod was written still gets a fixed profile of its own. */
  function profileFor(id) {
    if (QUIVERS[id]) { var q = QUIVERS[id]; return { id: id, name: q[0], cap: q[1], regen: q[2], delay: q[3] }; }
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    var cap = 8 + (h % 13);                        // 8-20
    return { id: id, name: id, cap: cap, regen: Math.round((1.5 + cap * 0.15) * 10) / 10, delay: 1 + (h >>> 8) % 3 * 0.5 };
  }

  // Your bow (the weapon itself, not its skin) changes your quiver's numbers.
  // The game's bow list, in its own order: bowWeaponId 0..5.
  // id -> [name, arrow capacity x, refill time x, delay after shot +seconds]
  var BOW_ORDER = ['scout', 'assault', 'sharpshooter', 'runner', 'support', 'defender'];
  var BOWS = {
    scout:        ['Scout (small bow)',            2.0, 0.5, -0.5],   // a lot better at everything
    assault:      ['Assault (medium bow)',         1.3, 0.8, -0.2],   // a bit better at everything
    sharpshooter: ['Sharpshooter (large bow)',     1.0, 1.0,  0.0],   // the quiver as it is
    runner:       ['Runner (small crossbow)',      2.0, 0.5, -0.5],   // same as Scout
    support:      ['Support (repeating crossbow)', 2.0, 0.5, -0.5],   // same as Scout
    defender:     ['Defender (large crossbow)',    1.0, 1.0,  0.0]    // same as Sharpshooter
  };
  // The bow's own type name first (safe if the game reorders its list), its list position as a fallback.
  var BOW_TYPES = { smallBow: 'scout', mediumBow: 'assault', largeBow: 'sharpshooter',
    smallCrossbow: 'runner', repeatingCrossbow: 'support', largeCrossbow: 'defender' };
  function bowIdOf(p) {
    var bw = p && p.bowWeapon;
    if (!bw) return null;
    return BOW_TYPES[bw.bowWeaponTypeId] || BOW_ORDER[bw.bowWeaponId] || null;
  }
  /** Quiver numbers with your bow's changes applied. Keeps the quiver's id. */
  function withBow(q, bowId) {
    var b = BOWS[bowId];
    if (!b) return q;
    return {
      id: q.id, name: q.name, bow: bowId,
      cap: Math.max(1, Math.round(q.cap * b[1])),
      regen: Math.round(q.regen * b[2] * 10) / 10,
      delay: Math.max(0, Math.round((q.delay + b[3]) * 10) / 10)
    };
  }
  function pct(x) { var v = Math.round((x - 1) * 100); return (v > 0 ? '+' : '') + v + '%'; }
  function secs(x) { return (x > 0 ? '+' : '') + x + 's'; }

  var settings = { enabled: true, stamina: true };
  try {
    var raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (raw && typeof raw.enabled === 'boolean') settings.enabled = raw.enabled;
    if (raw && typeof raw.stamina === 'boolean') settings.stamina = raw.stamina;
  } catch (e) { /* defaults */ }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ } }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var CSS = [
    '#nqr-root { position: fixed; inset: 0; pointer-events: none; z-index: 2147482000; font-family: "Trebuchet MS", system-ui, sans-serif; color: #fff; }',
    '.nqr-hud { position: fixed; left: 0; top: 0; display: flex; flex-direction: column; gap: 5px; transform-origin: left top; filter: var(--default-drop-shadow, drop-shadow(0 2px 2px rgba(0,0,0,.6))); }',
    '.nqr-row { height: 22px; display: flex; align-items: center; gap: 7px; }',
    '.nqr-row.sta .bar i { background: #ffd23b; }',
    '.nqr-row.sta.tired .bar i { background: #ff7a3b; }',
    '.nqr-row.sta.tired .ct { color: #ff7a3b; }',
    '.nqr-hud svg { width: 22px; height: 22px; flex: none; }',
    '.nqr-hud .ct { font-size: 20px; font-weight: 900; line-height: 1; min-width: 26px; text-shadow: 0 1px 0 rgba(0,0,0,.5); }',
    '.nqr-hud .bar { width: 80px; height: 8px; background: rgba(0,0,0,.45); border-radius: 4px; overflow: hidden; flex: none; }',
    '.nqr-hud .bar i { display: block; height: 100%; width: 0; background: #fff; }',
    '.nqr-row.wait .bar i { background: #9a9a9a; }',
    '.nqr-row.empty .ct { color: #ff5a4a; }',
    '.nqr-row.flash { animation: nqr-flash .35s; }',
    '.nqr-panel h3 { margin: 16px 0 4px; font-size: 18px; text-transform: uppercase; letter-spacing: 1.5px; }',
    '.nqr-panel td.st { font-size: 11px; opacity: .85; }',
    '@keyframes nqr-flash { 0%,100% { translate: 0 0; } 25% { translate: -6px 0; } 75% { translate: 6px 0; } }',
    '.nqr-out { position: fixed; left: 50%; top: 58%; transform: translateX(-50%); font-size: 22px; font-weight: 900; text-shadow: 0 2px 0 #000, 0 0 10px #000; animation: nqr-fade 1s ease-out forwards; }',
    '@keyframes nqr-fade { 0% { opacity: 1; } 70% { opacity: 1; } 100% { opacity: 0; } }',
    '.nqr-panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(720px, 94vw); max-height: 86vh; overflow-y: auto; background: #4a4a4a; border-radius: 8px; padding: 18px 22px; box-shadow: 0 10px 40px rgba(0,0,0,.7); pointer-events: auto; }',
    '.nqr-panel h2 { margin: 0 0 6px; font-size: 24px; text-transform: uppercase; letter-spacing: 2px; }',
    '.nqr-panel p { margin: 0 0 10px; font-size: 13px; opacity: .8; line-height: 1.35; }',
    '.nqr-panel table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 12px; }',
    '.nqr-panel th { text-align: left; font-size: 11px; opacity: .7; padding: 4px 6px; }',
    '.nqr-panel td { padding: 4px 6px; border-top: 1px solid rgba(255,255,255,.08); }',
    '.nqr-panel tr.me td { background: rgba(255,180,59,.22); font-weight: 700; }',
    '.nqr-panel .row { display: flex; justify-content: space-between; align-items: center; gap: 10px; }',
    '.nqr-btn { font: inherit; font-weight: 800; font-size: 14px; padding: 7px 16px; border: 0; border-radius: 6px; background: #ffb43b; color: #231a05; cursor: pointer; }'
  ].join('\n');

  /* ------------------------------------------------------------ game reads */

  function game() { return PAGE[MARK] || null; }
  function myPlayer() {
    var g = game();
    var ag = g && g.gameManager && g.gameManager.activeGame;
    if (!ag || !(ag.players instanceof Map)) return null;
    var me = null;
    ag.players.forEach(function (pl) { if (!me && pl && pl.hasOwnership === true) me = pl; });
    return me;
  }
  var quiverIds = null, quiverIdsSource = null;
  function allQuiverIds() {
    var g = game();
    var d = g && g.config && g.config.shopConfig && g.config.shopConfig.loadedConfigData;
    var items = d && d.purchasableItems;
    if (!items) return null;
    if (items !== quiverIdsSource) {
      quiverIdsSource = items;
      quiverIds = {};
      items.forEach(function (it) { if ((it.categories || []).indexOf('quiver') !== -1) quiverIds[it.id] = true; });
    }
    return quiverIds;
  }
  function equippedQuiverId(p) {
    var ids = p && p.equippedSkinData && p.equippedSkinData.equippedSkinIds;
    var all = allQuiverIds();
    if (!ids || !all) return 'none';
    for (var i = 0; i < ids.length; i++) if (all[ids[i]]) return ids[i];
    return 'none';
  }
  // The game's own stat names (from its stat class table).
  var STAT_NAMES = {
    shootingFocus: 'Focus', movementSpeed: 'Movement Speed', armorStrength: 'Damage Protection',
    healthRegenSpeed: 'Health Regen', bowAttackStrength: 'Attack Strength', arrowLoadingSpeed: 'Loading Speed',
    arrowFlySpeed: 'Travel Speed', arrowEnemyStun: 'Stun Enemy', meleeAttackStrength: 'Melee Strength',
    meleeAttackSpeed: 'Melee Speed', meleeAttackReach: 'Melee Reach', bloodlust: 'Bloodlust'
  };
  /** The quiver's normal stats as the shop defines them, e.g. ['Focus +2', 'Movement Speed +1']. */
  function gameStatsFor(id) {
    var g = game();
    var d = g && g.config && g.config.shopConfig && g.config.shopConfig.loadedConfigData;
    var items = (d && d.purchasableItems) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].id !== id) continue;
      var sc = items[i].statClasses || {};
      return Object.keys(sc).filter(function (k) { return sc[k]; }).map(function (k) {
        return (STAT_NAMES[k] || k) + ' ' + (sc[k] > 0 ? '+' : '') + sc[k];
      });
    }
    return [];
  }
  function healthBarShown() {
    var b = document.querySelector('.health-ui-bar-container');
    return !!(b && b.getClientRects().length > 0);
  }

  /* --------------------------------------------------------------- the ammo */

  var prof = profileFor('none');
  var arrows = prof.cap;
  var lastShotAt = 0;
  var trackedPlayer = null;
  var wasDead = false;
  var lastTick = Date.now();
  var patchedBows = typeof WeakSet !== 'undefined' ? new WeakSet() : null;

  function refill() { arrows = prof.cap; }

  function outOfArrows() {
    if (arwRow) { arwRow.classList.remove('flash'); void arwRow.offsetWidth; arwRow.classList.add('flash'); }
    var now = Date.now();
    if (now - lastOutMsgAt < 800) return;
    lastOutMsgAt = now;
    var m = el('div', 'nqr-out', 'Out of arrows!');
    root().appendChild(m);
    setTimeout(function () { m.remove(); }, 1000);
  }
  var lastOutMsgAt = 0;

  /** Wraps this bow's own shootArrow so every arrow fired is counted, and none fire when empty. */
  function patchBow(bw) {
    if (!bw || typeof bw.shootArrow !== 'function' || !patchedBows || patchedBows.has(bw)) return;
    patchedBows.add(bw);
    var orig = bw.shootArrow;
    bw.shootArrow = function () {
      if (settings.enabled && bw.player && bw.player.hasOwnership) {
        if (arrows < 1) { outOfArrows(); return undefined; }
        arrows -= 1;
        lastShotAt = Date.now();
      }
      return orig.apply(this, arguments);
    };
  }

  // When empty, don't even let the bow draw: your own left click is swallowed before the game sees it.
  // Only while the bow (not melee) is the active weapon.
  window.addEventListener('mousedown', function (e) {
    if (!e.isTrusted || e.button !== 0 || !settings.enabled || arrows >= 1) return;
    if (!document.pointerLockElement) return;
    var p = myPlayer();
    if (!p || !p.bowWeapon || p.activeWeapon !== p.bowWeapon) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    outOfArrows();
  }, true);

  /* --------------------------------------------------------------- stamina */

  var STAMINA_BASE_MAX = 100;
  var STAMINA_BASE_REGEN = 10;     // per second, while resting
  var STAMINA_DELAY = 1.0;         // seconds after spending before regen starts
  var COST_MOVE = 4;               // per second of walking on the ground
  var COST_JUMP = 4;               // per jump
  var COST_MELEE_START = 18;       // when you start charging a melee swing
  var COST_MELEE_HOLD = 10;        // per second while holding the charge
  var RECOVER_AT = 0.3;            // tired until back to 30%
  var TIRED_SPEED = 0.6;           // walk speed while tired

  function hashId(id) { var h = 0; for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h; }
  function prettyName(id) {
    return id.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/^./, function (c) { return c.toUpperCase(); });
  }
  var limbCache = {}, limbCacheSource = null;
  /** Every arm, glove, leg and shoe piece in the shop (tattoos don't count) with its own stamina numbers. */
  function limbPieces() {
    var g = game();
    var d = g && g.config && g.config.shopConfig && g.config.shopConfig.loadedConfigData;
    var items = d && d.purchasableItems;
    if (!items) return limbCache;
    if (items === limbCacheSource) return limbCache;
    limbCacheSource = items;
    limbCache = {};
    items.forEach(function (it) {
      var c = it.categories || [];
      // Gloves count with arms (cheaper melee), shoes with legs (cheaper moving).
      var slot = ['arms', 'hands', 'legs', 'feet'].filter(function (k) { return c.indexOf(k) !== -1; })[0];
      var arm = slot === 'arms' || slot === 'hands', leg = slot === 'legs' || slot === 'feet';
      if (!arm && !leg) return;
      var sc = it.statClasses || {};
      var ms = sc.movementSpeed || 0, ar = sc.armorStrength || 0, hr = sc.healthRegenSpeed || 0, bl = sc.bloodlust || 0;
      var h = hashId(it.id);
      var kind = arm ? 'arms' : 'legs';
      // Heavy armor holds more stamina, light/fast gear gets it back quicker; a small per-piece twist keeps each one unique.
      limbCache[it.id] = {
        id: it.id, name: prettyName(it.id), kind: kind, slot: slot,
        max: 6 + 4 * ar + 2 * hr + 2 * bl + (h % 5),
        regen: Math.round((0.5 + 0.8 * ms + 0.6 * hr + 0.5 * bl + ((h >>> 3) % 4) * 0.25) * 10) / 10,
        cut: Math.min(25, 4 + 3 * (kind === 'arms' ? ar + bl : ms) + ((h >>> 6) % 5))
      };
    });
    staProfKey = null;
    return limbCache;
  }
  var staProfKey = null, staProf = null;
  function staminaProfile(p) {
    var all = limbPieces();
    var ids = (p && p.equippedSkinData && p.equippedSkinData.equippedSkinIds) || [];
    var key = ids.join(',');
    if (key === staProfKey && staProf) return staProf;
    staProfKey = key;
    var sp = { max: STAMINA_BASE_MAX, regen: STAMINA_BASE_REGEN, meleeCut: 0, moveCut: 0, pieces: [] };
    ids.forEach(function (id) {
      var lp = all[id];
      if (!lp) return;
      sp.pieces.push(lp);
      sp.max += lp.max;
      sp.regen += lp.regen;
      if (lp.kind === 'arms') sp.meleeCut += lp.cut; else sp.moveCut += lp.cut;
    });
    sp.regen = Math.round(sp.regen * 10) / 10;
    sp.meleeCut = Math.min(60, sp.meleeCut);
    sp.moveCut = Math.min(60, sp.moveCut);
    staProf = sp;
    return sp;
  }

  var stamina = STAMINA_BASE_MAX, lastSpendAt = 0, tired = false, lastJumpSeen = null, wasCharging = false;
  var staFull = staminaProfile(null);

  function meleeCharging(p) {
    var mw = p.meleeWeapon;
    if (!mw || p.activeWeapon !== mw) return false;
    return p.weaponActionIsDown === true || mw.actionIsDown === true ||
      !!(mw.attackStartActivity && mw.attackStartActivity.active === true);
  }

  function tooTired(msg) {
    if (staRow) { staRow.classList.remove('flash'); void staRow.offsetWidth; staRow.classList.add('flash'); }
    var now = Date.now();
    if (now - lastTiredMsgAt < 800) return;
    lastTiredMsgAt = now;
    var m = el('div', 'nqr-out', msg);
    root().appendChild(m);
    setTimeout(function () { m.remove(); }, 1000);
  }
  var lastTiredMsgAt = 0;

  // Tired: your own melee charge and jump are swallowed before the game sees them.
  window.addEventListener('mousedown', function (e) {
    if (!e.isTrusted || e.button !== 0 || !settings.stamina || !document.pointerLockElement) return;
    var p = myPlayer();
    if (!p || p.dead || !p.meleeWeapon || p.activeWeapon !== p.meleeWeapon) return;
    var cost = COST_MELEE_START * (1 - staFull.meleeCut / 100);
    if (!tired && stamina >= cost) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    tooTired('Too tired to swing!');
  }, true);
  window.addEventListener('keydown', function (e) {
    if (!e.isTrusted || e.code !== 'Space' || !settings.stamina || !tired || !document.pointerLockElement) return;
    var p = myPlayer();
    if (!p || p.dead) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (!e.repeat) tooTired('Too tired to jump!');
  }, true);

  // Tired also means slower walking: your own weapons' walk-speed multiplier is scaled down (never up).
  var patchedWalk = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
  function patchWalk(w) {
    if (!w || typeof w.getWalkSpeedMultiplier !== 'function' || !patchedWalk || patchedWalk.has(w)) return;
    patchedWalk.add(w);
    var orig = w.getWalkSpeedMultiplier;
    w.getWalkSpeedMultiplier = function () {
      var m = orig.apply(this, arguments);
      return settings.stamina && tired ? m * TIRED_SPEED : m;
    };
  }

  function tickStamina(p, dt, now, newLife) {
    staFull = staminaProfile(p);
    if (newLife) { stamina = staFull.max; tired = false; lastJumpSeen = p.lastJumpTime; wasCharging = false; }
    if (stamina > staFull.max) stamina = staFull.max;
    if (!settings.stamina || p.dead) return;
    patchWalk(p.bowWeapon);
    patchWalk(p.meleeWeapon);
    var spend = 0;
    var rb = p.rigidBody, v = rb && rb.velocity;
    var moving = !!(rb && v && rb.isOnFloor && Math.sqrt(v.x * v.x + v.z * v.z) > 1);
    if (moving && !tired) spend += COST_MOVE * (1 - staFull.moveCut / 100) * dt;
    if (lastJumpSeen === null) lastJumpSeen = p.lastJumpTime;
    if (p.lastJumpTime !== lastJumpSeen) { lastJumpSeen = p.lastJumpTime; spend += COST_JUMP * (1 - staFull.moveCut / 100); }
    var charging = meleeCharging(p);
    var mc = 1 - staFull.meleeCut / 100;
    if (charging && !wasCharging) spend += COST_MELEE_START * mc;
    if (charging) spend += COST_MELEE_HOLD * mc * dt;
    wasCharging = charging;
    if (spend > 0) {
      stamina = Math.max(0, stamina - spend);
      lastSpendAt = now;
    } else if (now - lastSpendAt >= STAMINA_DELAY * 1000) {
      // Still walking while tired: it comes back at half speed. Standing still is faster.
      stamina = Math.min(staFull.max, stamina + staFull.regen * (moving ? 0.5 : 1) * dt);
    }
    if (stamina <= 0) tired = true;
    else if (tired && stamina >= staFull.max * RECOVER_AT) tired = false;
  }

  function tick() {
    if (rootEl) root();                       // keep the UI inside <body> (fullscreen)
    var now = Date.now();
    var dt = Math.min(now - lastTick, 1000) / 1000;
    lastTick = now;
    var p = myPlayer();
    if (p) {
      patchBow(p.bowWeapon);
      var qid = equippedQuiverId(p);
      var bid = bowIdOf(p);
      if (qid !== prof.id || bid !== (prof.bow || null)) { prof = withBow(profileFor(qid), bid); refill(); }
      var newLife = false;
      if (p !== trackedPlayer) { trackedPlayer = p; wasDead = !!p.dead; refill(); newLife = true; }
      var dead = !!p.dead;
      if (wasDead && !dead) { refill(); newLife = true; }   // a new life starts with a full quiver and full stamina
      wasDead = dead;
      tickStamina(p, dt, now, newLife);
      if (!dead && arrows < prof.cap && now - lastShotAt >= prof.delay * 1000) {
        arrows = Math.min(prof.cap, arrows + dt / prof.regen);
      }
    }
    renderHud(p);
    patchShopTooltip();
  }

  /* -------------------------------------------------------------------- UI */

  var rootEl = null, hudEl = null, hudCount = null, hudBar = null, panelEl = null;
  var arwRow = null, staRow = null, staCount = null, staBar = null;
  function root() {
    // Live inside <body>: the game's Full Screen button fullscreens the body, and anything outside it is hidden.
    if (rootEl && rootEl.isConnected) {
      if (document.body && rootEl.parentNode !== document.body) document.body.appendChild(rootEl);
      return rootEl;
    }
    rootEl = el('div');
    rootEl.id = 'nqr-root';
    (document.body || document.documentElement).appendChild(rootEl);
    return rootEl;
  }
  // A small white quiver: a slanted tube with three arrows sticking out.
  var QUIVER_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<g stroke="#fff" stroke-width="1.6" stroke-linecap="round" fill="none">' +
    '<path d="M9.5 9 L6.5 2.5"/><path d="M12.5 8.3 L12.5 1.5"/><path d="M15.5 7.8 L18 2"/></g>' +
    '<g fill="#fff"><path d="M6.5 2.5 l-1.6 1.2 l.4 -2.4 z"/><path d="M12.5 1.5 l-1.3 1.8 h2.6 z"/><path d="M18 2 l-.3 2.2 l1.8 -1.6 z"/>' +
    '<path d="M7.2 9.6 L16.6 7.6 L19 20 Q19.2 21.3 18 21.6 L11.4 23 Q10.2 23.2 9.9 22 Z"/></g>' +
    '<path d="M8.6 13 L17.6 11.1 M9.4 17 L18.3 15.1" stroke="rgba(0,0,0,.35)" stroke-width="1.2"/></svg>';
  // A small white lightning bolt for stamina.
  var BOLT_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M13.5 1.5 L4.5 13.5 H11 L9.5 22.5 L19.5 9.5 H13 Z"/></svg>';
  /* ------------------------------------------------- shop stat tooltip rows */

  // White icons in the same style as the game's own stat icons.
  function svgUrl(svg) { return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")'; }
  var ICON_ARROWS = svgUrl(QUIVER_SVG.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
  var ICON_REGEN = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M18.5 2.8v4.4h-4.4"/></svg>');
  var ICON_STAMINA = svgUrl(BOLT_SVG.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
  var ICON_DELAY = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M6 2.5h12M6 21.5h12"/><path d="M7.5 2.5c0 5 9 5 9 9.5s-9 4.5-9 9.5M16.5 2.5c0 5-9 5-9 9.5s9 4.5 9 9.5"/></svg>');

  /** Adds Arrows / Refill / Refill delay rows under the game's stats when hovering a quiver in the shop. */
  function addQuiverRows(item) {
    if (!item || !item.config) return;
    var rows = null;
    var lp = limbPieces()[item.config.id];
    if (settings.enabled && (item.config.categories || []).indexOf('quiver') !== -1) {
      var q = profileFor(item.config.id);
      rows = [[ICON_ARROWS, q.cap + ' Arrows'], [ICON_REGEN, '1 arrow / ' + q.regen + 's'], [ICON_DELAY, q.delay + 's Refill Delay']];
    } else if (settings.stamina && lp) {
      rows = [[ICON_STAMINA, '+' + lp.max + ' Max Stamina'], [ICON_REGEN, '+' + lp.regen + ' Stamina Regen'],
        [ICON_STAMINA, '-' + lp.cut + '% ' + (lp.kind === 'arms' ? 'Melee Stamina Cost' : 'Move Stamina Cost')]];
    }
    if (!rows) return;
    var tt = item.statsTooltip;
    var ul = tt && tt.el && tt.el.querySelector('ul');
    if (!ul || ul.querySelector('.nqr-stat')) return;
    rows.forEach(function (row) {
      var li = el('li', 'nqr-stat');
      var ic = el('span', 'stat-class-icon');
      ic.style.backgroundImage = row[0];
      li.appendChild(ic);
      li.appendChild(document.createTextNode(row[1]));
      ul.appendChild(li);
    });
    // The game placed the tooltip using its old height; redo that with the new rows.
    var r = item.el.getBoundingClientRect();
    tt.el.style.top = Math.max(r.top, tt.el.clientHeight) + 'px';
  }
  var shopPatched = false;
  function patchShopTooltip() {
    if (shopPatched) return;
    var g = game();
    var view = g && g.mainMenu && g.mainMenu.shopDialog && g.mainMenu.shopDialog.currentCustomizationView;
    var grids = view && view.createdGrids;
    if (!grids) return;
    var list = grids instanceof Map ? Array.from(grids.values()) : Object.keys(grids).map(function (k) { return grids[k]; });
    for (var i = 0; i < list.length; i++) {
      var items = list[i] && list[i].grid && list[i].grid.shopItems;
      // shopItems is a Map in the current game; take any one item to reach the shared class.
      var it = items && (typeof items.values === 'function' ? items.values().next().value : items[0]);
      var proto = it && Object.getPrototypeOf(it);
      if (!proto || typeof proto.addStatsTooltip !== 'function') continue;
      var orig = proto.addStatsTooltip;
      proto.addStatsTooltip = function () {
        var out = orig.apply(this, arguments);
        try { addQuiverRows(this); } catch (e) { /* never break the shop */ }
        return out;
      };
      shopPatched = true;
      return;
    }
  }

  function buildHud() {
    hudEl = el('div', 'nqr-hud');
    arwRow = el('div', 'nqr-row arw');
    arwRow.innerHTML = QUIVER_SVG;
    hudCount = el('div', 'ct');
    var bar = el('div', 'bar');
    hudBar = el('i');
    bar.appendChild(hudBar);
    arwRow.appendChild(hudCount); arwRow.appendChild(bar);
    staRow = el('div', 'nqr-row sta');
    staRow.innerHTML = BOLT_SVG;
    staCount = el('div', 'ct');
    var sbar = el('div', 'bar');
    staBar = el('i');
    sbar.appendChild(staBar);
    staRow.appendChild(staCount); staRow.appendChild(sbar);
    hudEl.appendChild(arwRow); hudEl.appendChild(staRow);
    root().appendChild(hudEl);
  }
  function renderHud(p) {
    if (!hudEl) return;
    var hb = document.querySelector('.health-ui-bar-container');
    var r = hb && hb.getBoundingClientRect();
    var show = (settings.enabled || settings.stamina) && !!p && !p.dead && !!r && r.width > 0;
    hudEl.style.display = show ? '' : 'none';
    if (!show) return;
    // Sit just right of the health bar, matching its size (the game shrinks it on small screens).
    var sc = r.height / 22 || 1;
    hudEl.style.left = Math.round(r.right + 12 * sc) + 'px';
    hudEl.style.top = Math.round(r.top) + 'px';
    hudEl.style.transform = 'scale(' + sc + ')';
    hudEl.style.transformOrigin = 'left top';
    arwRow.style.display = settings.enabled ? '' : 'none';
    var whole = Math.floor(arrows + 1e-6);
    var ct = String(whole);
    if (hudCount.textContent !== ct) hudCount.textContent = ct;
    var waiting = whole < prof.cap && Date.now() - lastShotAt < prof.delay * 1000;
    hudBar.style.width = (whole >= prof.cap ? 100 : Math.round((arrows - whole) * 100)) + '%';
    arwRow.classList.toggle('wait', waiting);
    arwRow.classList.toggle('empty', whole < 1);
    staRow.style.display = settings.stamina ? '' : 'none';
    var sct = String(Math.floor(stamina));
    if (staCount.textContent !== sct) staCount.textContent = sct;
    staBar.style.width = Math.round(stamina / staFull.max * 100) + '%';
    staRow.classList.toggle('tired', tired);
  }

  function togglePanel() {
    if (panelEl) { panelEl.remove(); panelEl = null; return; }
    if (document.pointerLockElement) { try { document.exitPointerLock(); } catch (e) { /* ignore */ } }
    panelEl = el('div', 'nqr-panel');
    panelEl.appendChild(el('h2', null, '🏹 Quiver Rework'));
    panelEl.appendChild(el('h3', null, '🏹 Arrows'));
    panelEl.appendChild(el('p', null, 'Arrows are limited. Your quiver sets how many you carry, how fast they come back, and how long they wait after a shot. You start every life full. Your quiver still gives its normal stats (last column), and damage is never changed.'));
    var t = el('table');
    var hr = el('tr');
    ['Quiver', 'Arrows', 'Sec / arrow', 'Delay after shot', 'Normal stats'].forEach(function (h) { hr.appendChild(el('th', null, h)); });
    t.appendChild(hr);
    var ids = Object.keys(QUIVERS);
    var live = allQuiverIds();
    if (live) Object.keys(live).forEach(function (id) { if (ids.indexOf(id) === -1) ids.push(id); });
    ids.forEach(function (id) {
      var q = profileFor(id);
      var tr = el('tr', id === prof.id ? 'me' : null);
      tr.appendChild(el('td', null, q.name + (id === prof.id ? '  (yours)' : '')));
      tr.appendChild(el('td', null, String(q.cap)));
      tr.appendChild(el('td', null, q.regen + 's'));
      tr.appendChild(el('td', null, q.delay + 's'));
      var gs = gameStatsFor(id);
      tr.appendChild(el('td', 'st', gs.length ? gs.join(', ') : '—'));
      t.appendChild(tr);
    });
    panelEl.appendChild(t);

    panelEl.appendChild(el('h3', null, '🎯 Bows'));
    panelEl.appendChild(el('p', null, 'Your bow changes your quiver\'s numbers (the quiver table above is before your bow). Yours right now: ' + prof.cap + ' arrows, ' + prof.regen + 's per arrow, ' + prof.delay + 's delay.'));
    var tb = el('table');
    var hb = el('tr');
    ['Bow', 'Arrows', 'Refill time', 'Delay after shot'].forEach(function (h) { hb.appendChild(el('th', null, h)); });
    tb.appendChild(hb);
    BOW_ORDER.forEach(function (id) {
      var b = BOWS[id];
      var tr = el('tr', id === prof.bow ? 'me' : null);
      tr.appendChild(el('td', null, b[0] + (id === prof.bow ? '  (yours)' : '')));
      tr.appendChild(el('td', null, pct(b[1])));
      tr.appendChild(el('td', null, pct(b[2])));
      tr.appendChild(el('td', null, secs(b[3])));
      tb.appendChild(tr);
    });
    panelEl.appendChild(tb);

    panelEl.appendChild(el('h3', null, '⚡ Stamina'));
    var sp = staminaProfile(myPlayer());
    panelEl.appendChild(el('p', null, 'Moving, jumping and charging melee use stamina. At 0 you are tired - slower, no jumping, no melee charge - until you are back to 30%. Every arm, glove, leg and shoe piece adds its own stamina; arms and gloves make melee cheaper, legs and shoes make moving cheaper.'));
    panelEl.appendChild(el('p', null, 'Yours: ' + sp.max + ' max stamina, ' + sp.regen + ' regen/sec, melee costs ' + sp.meleeCut + '% less, moving costs ' + sp.moveCut + '% less' +
      (sp.pieces.length ? ' (from ' + sp.pieces.map(function (x) { return x.name; }).join(', ') + ').' : ' (no arm, glove, leg or shoe pieces on).')));
    var t2 = el('table');
    var hr2 = el('tr');
    ['Piece', 'Slot', 'Max stamina', 'Regen / sec', 'Cost cut'].forEach(function (h) { hr2.appendChild(el('th', null, h)); });
    t2.appendChild(hr2);
    var mine = {};
    sp.pieces.forEach(function (x) { mine[x.id] = true; });
    var lps = limbPieces();
    Object.keys(lps).sort(function (a, b) { return lps[a].kind === lps[b].kind ? lps[a].name.localeCompare(lps[b].name) : lps[a].kind < lps[b].kind ? -1 : 1; }).forEach(function (id) {
      var x = lps[id];
      var tr = el('tr', mine[id] ? 'me' : null);
      tr.appendChild(el('td', null, x.name + (mine[id] ? '  (yours)' : '')));
      tr.appendChild(el('td', null, ({ arms: 'Arms', hands: 'Gloves', legs: 'Legs', feet: 'Shoes' })[x.slot]));
      tr.appendChild(el('td', null, '+' + x.max));
      tr.appendChild(el('td', null, '+' + x.regen));
      tr.appendChild(el('td', null, '-' + x.cut + '% ' + (x.kind === 'arms' ? 'melee' : 'move')));
      t2.appendChild(tr);
    });
    panelEl.appendChild(t2);

    var row = el('div', 'row');
    var lab = el('label');
    var cb = el('input');
    cb.type = 'checkbox';
    cb.checked = settings.enabled;
    cb.addEventListener('change', function () { settings.enabled = cb.checked; save(); if (cb.checked) refill(); });
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(' Limited arrows on'));
    row.appendChild(lab);
    var lab2 = el('label');
    var cb2 = el('input');
    cb2.type = 'checkbox';
    cb2.checked = settings.stamina;
    cb2.addEventListener('change', function () { settings.stamina = cb2.checked; save(); if (cb2.checked) { stamina = staFull.max; tired = false; } });
    lab2.appendChild(cb2);
    lab2.appendChild(document.createTextNode(' Stamina on'));
    row.appendChild(lab2);
    var close = el('button', 'nqr-btn', 'Close');
    close.type = 'button';
    close.addEventListener('click', togglePanel);
    row.appendChild(close);
    panelEl.appendChild(row);
    root().appendChild(panelEl);
  }

  window.addEventListener('keydown', function (e) {
    if (e.code === 'F7' && !e.repeat) { e.preventDefault(); togglePanel(); }
  }, true);

  function boot() {
    var s = el('style');
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
    buildHud();
    setInterval(tick, 100);
    // The patch only takes effect on the next load. If it isn't live yet, say so once.
    setTimeout(function () {
      if (game()) return;
      ensurePatched().then(function (r) {
        if (game()) return;
        var msg = r === 'patched' ? 'Quiver Rework is installed - reload the page once to turn it on.'
          : r === 'no-cache' ? 'Quiver Rework: play one round, then reload, to turn it on.'
          : r === 'already' ? '' : 'Quiver Rework could not hook into the game (' + r + ').';
        if (!msg) return;
        var m = el('div', 'nqr-out', msg);
        m.style.fontSize = '16px';
        m.style.animationDuration = '6s';
        root().appendChild(m);
        setTimeout(function () { m.remove(); }, 6000);
      });
    }, 4000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  ensurePatched();

  PAGE.NarrowQuiverRework = {
    arrows: function () { return Math.floor(arrows); },
    profile: function () { return prof; },
    refill: refill,
    stamina: function () { return { now: Math.floor(stamina), tired: tired, profile: staFull }; },
    table: function () { return Object.keys(QUIVERS).map(function (id) { var q = profileFor(id); return q.name + ': ' + q.cap + ' arrows, ' + q.regen + 's each, ' + q.delay + 's delay'; }); }
  };
})();
