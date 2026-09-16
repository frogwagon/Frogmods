// ==UserScript==
// @name         One Kill = One Stat Point
// @namespace    narrowone One Kill = One Stat Point
// @version      2.9.0
// @description  Keep your gear, lose your stats. Earn them back with kills, up to the caps your own gear set gives you.
// @author       Frogwagon
// @match        https://narrow.one/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

/*
 * Underdog  -  Narrow One
 * -----------------------
 * You keep the gear you are wearing - same look, same bow, same melee, so a
 * poking stick still pokes - but you start the match with your stats at zero.
 * Every N kills earns a stat point, and each stat can be bought back up to
 * exactly what your own gear set provides. If your set gives 8 regen, 6
 * defence and 5 speed, that is your ceiling; you can never exceed the loadout
 * you actually own.
 *
 * It is a handicap. You spend most of a match below where you would otherwise
 * have started and, at best, end up where you began.
 *
 *
 * How it reaches the stats
 * ------------------------
 * The game keeps everything inside a closed ES module. Nothing is on `window`
 * except build flags, and the entry bundle exports nothing, so there is no
 * ordinary way in.
 *
 * There is exactly one seam. The bundle has a singleton accessor:
 *
 *     function po(){if(!uo)throw new Error("Main instance is not initialized");return uo}
 *
 * One statement added to that function publishes the instance:
 *
 *     function po(){ ... ; window.__NARROW = uo; return uo }
 *
 * Getting that edit into the running game took three attempts. Replacing the
 * <script> tag does not work: Chrome prepares a parser-inserted script in the
 * same task it inserts it, and a MutationObserver callback runs afterwards, so
 * a userscript is always a step late. Removing the tag does not cancel a load
 * already in flight either - the original ran anyway, and the patched copy ran
 * as well. Two games in one tab, two connections.
 *
 * What does work is the game's own service worker. It is cache-first over
 * /js/ and precaches the bundle, so writing the patched source into that cache
 * makes the service worker serve it at the real URL on the next load. No race,
 * no second instance, and because it is served from the correct address the
 * relative imports and `import.meta.url` resolve normally - so the patch is
 * just the one statement above.
 *
 * The patch is anchored on the error string "Main instance is not initialized"
 * rather than the minified names `po`/`uo`, so a rebuild that renames them does
 * not break it.
 *
 * Reversible: "Undo" in the tab deletes the cache entry and the service worker
 * refetches the untouched original. Nothing on disk is modified.
 *
 *
 * What it does NOT do
 * -------------------
 * It never raises a stat above what your own equipped gear gives, never
 * equips anything you do not own, and never changes your weapons - only the
 * numbers attached to them.
 */

(function () {
  'use strict';

  /**
   * The page's own window, which is not the same object this script sees.
   *
   * Granting anything (rather than `@grant none`) puts this script in the
   * extension's own context instead of injecting it into the page. The cost is
   * that `window` here is a sandbox: the DOM is shared, but anything the page
   * itself sets - `__NARROW` from the patch - lives on `unsafeWindow`.
   */
  var PAGE = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;

  var ENTRY_RE = /\/js\/index-[^/]*\.js$/;
  var PO_RE = /function ([A-Za-z_$][\w$]*)\(\)\{if\(!([A-Za-z_$][\w$]*)\)throw new Error\("Main instance is not initialized"\);return \2\}/;
  var CACHE_RE = /^narrowClient\d+$/;
  var MARK = '__NARROW';

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

  /** A settings-note line that always names whatever key is actually bound. */
  function keyHintText(actionId, fallbackKey, does) {
    var key = hotkeyFor(actionId, fallbackKey);
    if (key === null) return 'No key is bound to ' + does + ' - set one in the Hotkey Editor.';
    return 'Press ' + keyLabel(key) + ' to ' + does + '.';
  }

  /* ================================================================== *
   * Part 1 - get the patched bundle in through the game's own cache
   *
   * An earlier approach tried to intercept the entry <script> and replace it.
   * That cannot be made reliable: Chrome prepares a parser-inserted script in
   * the same task it inserts it, while a MutationObserver callback runs
   * afterwards, so a userscript is always a step late. Removing the tag does
   * not cancel a load already under way - the original ran regardless, and the
   * patched copy ran too. Two games in one tab.
   *
   * The game ships its own service worker, and it is cache-first over /js/:
   *
   *     const hit = await cache.match(request, { ignoreSearch: true });
   *     if (hit) return hit;
   *
   * with the bundle precached by name in "narrowClient<digits>". So rather than
   * racing the parser, the patched source is written into that cache. The
   * service worker then serves it at the real URL on the next load.
   *
   * That removes every problem the other approach had: no race, so no double
   * execution; served from the correct address, so `import.meta.url` and the
   * relative ./colors-*.js import resolve normally and need no rewriting. The
   * patch shrinks to the single statement that publishes the instance.
   *
   * It is reversible: delete the cache entry and the service worker falls back
   * to the network, which is the untouched original.
   * ================================================================== */

  var patchState = { ok: false, error: null, cacheName: null, entryUrl: null, patched: false };

  /**
   * Tidy up after an earlier version that ran the bundle from a blob URL. The
   * game then registered its service worker from a blob: address, and those
   * registrations survive reloads while sitting in front of every request.
   */
  (function removeStaleBlobServiceWorkers() {
    if (!navigator.serviceWorker || !navigator.serviceWorker.getRegistrations) return;
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (reg) {
        var w = reg.active || reg.waiting || reg.installing;
        var url = w && w.scriptURL ? w.scriptURL : '';
        if (url.indexOf('blob:') === 0) {
          reg.unregister();
          console.warn('[Underdog] removed a stale service worker registered from a blob URL:', url);
        }
      });
    }).catch(function () {});
  })();

  /** The one edit: publish the singleton so the mod can reach the stats. */
  function patchSource(src) {
    var out = src.replace(PO_RE,
      'function $1(){if(!$2)throw new Error("Main instance is not initialized");' +
      'window.' + MARK + '=$2;return $2}');
    if (out === src) {
      throw new Error('could not find the singleton accessor - the game may have changed');
    }
    return out;
  }

  function findCacheName() {
    if (!window.caches) return Promise.resolve(null);
    return caches.keys().then(function (keys) {
      var hit = keys.filter(function (k) { return CACHE_RE.test(k); });
      return hit.length ? hit[hit.length - 1] : null;
    }).catch(function () { return null; });
  }

  /** Which file is the entry bundle - from the page if possible, else the cache. */
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

  /** Write the patched bundle into the game's cache. Takes effect on reload. */
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

  /** Drop the entry from the cache; the service worker refetches the original. */
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

  /** Is the copy the service worker would serve already patched? */
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
            return res.text().then(function (t) {
              return t.indexOf('window.' + MARK + '=') !== -1;
            });
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

  /* ================================================================== *
   * Part 2 - the mod proper, once the page and the game are up
   * ================================================================== */

  function whenReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  whenReady(function () {
    if (PAGE.__narrowOneUnderdog) return;
    PAGE.__narrowOneUnderdog = true;

    var STORE_KEY = 'narrowone.underdog.v2';
    var VERSION = '2.9.0';

    /* ---- the game's stat table, lifted from the bundle ---- */
    // Grouped the same way the game itself groups them - each stat's own
    // tooltipCategories in the bundle say "armor", "bow", "arrow" or "melee".
    // Arrow is folded into Bow here, since arrows aren't a build of their own.
    // Bloodlust is tagged with all four - it isn't tied to one weapon type -
    // so it gets its own group rather than an arbitrary pick of the four.
    var GROUPS = {
      armor:  'Armour',
      bow:    'Bow',
      melee:  'Melee',
      shared: 'Shared'
    };

    var STATS = [
      { key: 'armorStrength',       name: 'Damage Protection', max: 20, group: 'armor'  },
      { key: 'movementSpeed',       name: 'Movement Speed',    max: 20, group: 'armor'  },
      { key: 'healthRegenSpeed',    name: 'Health Regen Speed',max: 20, group: 'armor'  },
      { key: 'shootingFocus',       name: 'Focus',             max: 10, group: 'bow'    },
      { key: 'bowAttackStrength',   name: 'Attack Strength',   max: 10, group: 'bow'    },
      { key: 'arrowLoadingSpeed',   name: 'Loading Speed',     max: 5,  group: 'bow'    },
      { key: 'arrowFlySpeed',       name: 'Travel Speed',      max: 5,  group: 'bow'    },
      { key: 'arrowEnemyStun',      name: 'Stun Enemy',        max: 5,  group: 'bow'    },
      { key: 'meleeAttackStrength', name: 'Strength',          max: 5,  group: 'melee'  },
      { key: 'meleeAttackSpeed',    name: 'Speed',             max: 5,  group: 'melee'  },
      { key: 'meleeAttackReach',    name: 'Reach',             max: 5,  group: 'melee'  },
      { key: 'bloodlust',           name: 'Bloodlust',         max: 11, group: 'shared' }
    ];

    var DEFAULTS = { killsPerPoint: 1, autoOpen: false, rateOne: false, quiet: false };

    var cfg = (function () {
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
      } catch (e) {}
      return out;
    })();

    function save() {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (e) {}
    }

    // One kill, one stat point. Installs from before that rule carry over
    // once, and the slider still works if you want it harder.
    if (!cfg.rateOne) { cfg.killsPerPoint = 1; cfg.rateOne = true; save(); }

    // It used to open itself the moment a point was available, mid-fight.
    // Now it stays out of the way and waits for F.
    if (!cfg.quiet) { cfg.autoOpen = false; cfg.quiet = true; save(); }

    /* ================================================================ *
     * Finding *your* player inside the game instance
     *
     * The property names are minified, so objects are found by shape: one
     * that owns a `statClassValues`. Every player in the match owns one, so
     * shape alone is not enough - the walk collects them all and they are
     * then judged on evidence of being yours. Bounded so a stray three.js
     * graph cannot turn this into a long walk.
     * ================================================================ */

    /**
     * Walk the game graph and collect every object the predicate likes, with a
     * readable path to each.
     *
     * Two things this has to do that a naive walk does not:
     *
     *  - follow Map and Set contents. Object.keys() of a Map is empty, so a
     *    players-by-id Map is a dead end unless its values are visited.
     *  - keep the path. When the automatic pick is wrong, the path is the only
     *    thing that says where the right object actually lives.
     */
    function collectMatching(root, predicate, limit) {
      var found = [];
      if (!root) return found;

      var seen = new Set();
      var queue = [{ o: root, d: 0, p: 'game' }];
      var visited = 0;

      while (queue.length && visited < 40000 && found.length < limit) {
        var cur = queue.shift();
        var o = cur.o;
        if (!o || typeof o !== 'object' || seen.has(o)) continue;
        seen.add(o);
        visited++;

        try { if (predicate(o)) found.push({ o: o, path: cur.p, depth: cur.d }); } catch (e) {}

        if (cur.d >= 8) continue;

        var push = (function (c) {
          return function (v, label) {
            if (!v || typeof v !== 'object') return;
            if (typeof Node !== 'undefined' && v instanceof Node) return;
            if (v instanceof Window) return;
            queue.push({ o: v, d: c.d + 1, p: c.p.length < 120 ? c.p + label : c.p });
          };
        })(cur);

        if (o instanceof Map) {
          var mi = 0;
          o.forEach(function (v, k) { if (mi++ < 64) push(v, '.get(' + String(k).slice(0, 12) + ')'); });
          continue;
        }
        if (o instanceof Set) {
          var si = 0;
          o.forEach(function (v) { push(v, '[set#' + (si++) + ']'); });
          continue;
        }
        if (Array.isArray(o)) {
          for (var a = 0; a < o.length && a < 200; a++) push(o[a], '[' + a + ']');
          continue;
        }

        var keys;
        try { keys = Object.keys(o); } catch (e) { continue; }
        for (var i = 0; i < keys.length && i < 200; i++) {
          var v;
          try { v = o[keys[i]]; } catch (e) { continue; }
          push(v, '.' + keys[i]);
        }
      }
      return found;
    }

    /** First match only, for the places that just want the object. */
    function findMatching(root, predicate) {
      var hits = collectMatching(root, predicate, 1);
      return hits.length ? hits[0].o : null;
    }

    function hasStats(o) {
      return Object.prototype.hasOwnProperty.call(o, 'statClassValues');
    }
    function mapUsable(m) { return !!m && typeof m.get === 'function'; }

    /* ---- telling your player apart from everybody else's ---- */

    /**
     * Flags a build might use to mean "this one is you". `hasOwnership` is the
     * one the source shows, guarding the class-change packet:
     *
     *     this.hasOwnership && po().network.sendChangeSelectedClass(this.id, t)
     *
     * The rest are cheap insurance. Being wrong here means quietly editing a
     * stranger's stats, so a candidate with none of them is not accepted.
     */
    var OWN_FLAGS = ['hasOwnership', 'isLocalPlayer', 'isLocal', 'isMine', 'isMe',
                     'isSelf', 'isOwner', 'isControlled', 'local', 'owned'];

    var NAME_KEYS = ['username', 'userName', 'name', 'playerName', 'displayName', 'nick'];

    function ownFlagOn(o) {
      for (var i = 0; i < OWN_FLAGS.length; i++) {
        var v;
        try { v = o[OWN_FLAGS[i]]; } catch (e) { continue; }
        if (v === true) return OWN_FLAGS[i];
      }
      return null;
    }

    function nameOn(o) {
      for (var i = 0; i < NAME_KEYS.length; i++) {
        var v;
        try { v = o[NAME_KEYS[i]]; } catch (e) { continue; }
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
      return null;
    }

    /**
     * How sure are we that this candidate is you?
     *
     * Two independent kinds of evidence: a flag the game sets on the local
     * player, and the name matching the one in your own menu. Either is enough
     * on its own; with neither, we do not guess.
     */
    function scoreCandidate(c) {
      var o = c.o, s = 0;

      var flag = ownFlagOn(o);
      if (flag) { s += 100; c.flag = flag; }

      var me = looseName(myName());
      var n = nameOn(o);
      c.name = n;
      if (me && n && looseName(n) === me) { s += 80; c.nameMatch = true; }

      if (mapUsable(o.statClassValues)) s += 10;
      c.score = s;
      return s;
    }

    function playerCandidates() {
      var g = findGame();
      if (!g) return [];
      var list = collectMatching(g, hasStats, 32);
      list.forEach(scoreCandidate);
      list.sort(function (a, b) { return b.score - a.score; });
      lastCandidates = list;
      return list;
    }

    var game = null;          // PAGE.__NARROW, set by the patch
    var statOwner = null;     // your player, once identified
    var pickedPath = null;    // where the hand-picked one was found
    var pickedName = null;    // and what it was called - the part that survives a new match
    var caps = null;          // {key: value} from your gear, captured on Start
    var chosen = null;        // {key: value} what you have bought back
    var running = false;
    var lastCandidates = [];  // what the last search saw, for the report

    /**
     * The published instance, re-read every time.
     *
     * Caching it once looks harmless and is not: if the page ever hands us a
     * new instance, a cached one leaves the whole search walking a graph full
     * of last match's players.
     */
    function findGame() {
      if (PAGE.__NARROW) game = PAGE.__NARROW;
      return game;
    }

    /**
     * Find *your* player, not just any player.
     *
     * Every player in the match carries a statClassValues map, so the first one
     * a search reaches is usually somebody else. A candidate is only accepted
     * with evidence behind it - an ownership flag, or your own username - and
     * if nothing scores, this returns null rather than picking at random. You
     * can then choose from the list yourself in Diagnostics.
     */
    function findStatOwner() {
      if (statOwner && mapUsable(statOwner.statClassValues)) return statOwner;
      if (statOwner) statOwner = null;        // its map went away: it is stale

      var list = playerCandidates();

      // A hand-pick has to survive the next match, and the path will not - it
      // has the old match's ids in it. The name does survive, so that is what
      // is remembered and matched first.
      if (pickedName) {
        for (var i = 0; i < list.length; i++) {
          if (looseName(list[i].name) === looseName(pickedName)) {
            statOwner = list[i].o;
            pickedPath = list[i].path;
            return statOwner;
          }
        }
      }

      if (pickedPath) {
        for (var j = 0; j < list.length; j++) {
          if (list[j].path === pickedPath) { statOwner = list[j].o; return statOwner; }
        }
      }

      if (list.length && list[0].score >= 80) statOwner = list[0].o;
      return statOwner;
    }

    /** Use this candidate, on your say-so, and stop guessing. */
    function pickCandidate(c) {
      statOwner = c.o;
      pickedPath = c.path;
      pickedName = c.name || null;
      appliedTo = null;        // re-read the ceiling from the one you chose
      return statOwner;
    }

    /** A new match built new player objects: look again, but keep the choice. */
    function releaseOwner() {
      statOwner = null;
      pickedPath = null;
    }

    /** You said it had the wrong player: drop everything and start over. */
    function forgetOwner() {
      statOwner = null;
      pickedPath = null;
      pickedName = null;
      appliedTo = null;
    }

    /** Plain-English account of how far the hook got, for the UI and console. */
    function diagnose() {
      var g = findGame();
      if (!g) return { ok: false, why: 'the patched game has not published itself yet' };

      var owner = findStatOwner();
      if (!owner) {
        var n = lastCandidates.length;
        if (!n) {
          return { ok: false, why: 'found the game, but no player objects yet - spawn into a match first' };
        }
        return { ok: false, players: n,
                 why: 'found ' + n + ' player' + (n === 1 ? '' : 's') + ', but none of them says it is you - ' +
                      'open Diagnostics below and pick yours from the list' };
      }

      if (!mapUsable(owner.statClassValues)) {
        return { ok: false, owner: true,
                 why: 'found your player, but its stats have not been filled in yet - ' +
                      'spawn in, then press Start' };
      }
      return { ok: true, owner: true };
    }

    /** Read the stat map as a plain object. */
    function readStats() {
      var owner = findStatOwner();
      if (!owner) return null;
      var m = owner.statClassValues;
      if (!m || typeof m.get !== 'function') return null;
      var out = {};
      STATS.forEach(function (s) {
        var v = m.get(s.key);
        out[s.key] = typeof v === 'number' ? v : 0;
      });
      return out;
    }
    /* ================================================================ *
     * The run - kept across matches and across reloads
     *
     * A run is not a match. It carries on until you stop it, through map
     * changes, disconnects and page reloads, and the kills add up the whole
     * way.
     *
     * Two things reset underneath it and have to be absorbed rather than
     * fought:
     *
     *  - scoreKills goes back to 0 when a new match starts. Whatever the last
     *    match contributed is banked into carriedKills before the counter is
     *    allowed to drop, so the run total only ever goes up.
     *  - the game builds new player objects. The cached one is dropped and the
     *    search runs again, keeping your hand-pick by name.
     *
     * The ceiling is re-read from each new player object before anything is
     * written to it, which keeps the promise that you can never hold more than
     * your own equipped gear gives you - swap to weaker gear between matches
     * and what you have bought comes down with it.
     * ================================================================ */

    var RUN_KEY = 'narrowone.underdog.run';

    var kills = 0;            // scoreKills in the match on screen
    var baselineKills = 0;    // what it read when this run started
    var carriedKills = 0;     // banked from matches already finished
    var spentPoints = 0;
    var matches = 1;          // matches this run has spanned
    var appliedTo = null;     // the player object we are currently writing to
    var lastRead = { rows: 0, matched: false, names: [], source: '-' };

    function runKills() { return carriedKills + Math.max(0, kills - baselineKills); }
    function pointsEarned() { return Math.floor(runKills() / Math.max(1, cfg.killsPerPoint)); }
    function pointsLeft() { return Math.max(0, pointsEarned() - spentPoints); }

    function saveRun() {
      try {
        localStorage.setItem(RUN_KEY, JSON.stringify({
          running: running,
          caps: caps,
          chosen: chosen,
          kills: kills,
          baselineKills: baselineKills,
          carriedKills: carriedKills,
          spentPoints: spentPoints,
          matches: matches,
          pickedName: pickedName
        }));
      } catch (e) {}
    }

    function loadRun() {
      var raw;
      try { raw = localStorage.getItem(RUN_KEY); } catch (e) { return; }
      if (!raw) return;
      var s;
      try { s = JSON.parse(raw); } catch (e) { return; }
      if (!s || !s.running || !s.caps || !s.chosen) return;

      running = true;
      caps = s.caps;
      chosen = s.chosen;
      kills = s.kills || 0;
      baselineKills = s.baselineKills || 0;
      carriedKills = s.carriedKills || 0;
      spentPoints = s.spentPoints || 0;
      matches = s.matches || 1;
      pickedName = s.pickedName || null;
    }

    function clearRun() {
      try { localStorage.removeItem(RUN_KEY); } catch (e) {}
    }

    loadRun();

    /** Keep `chosen` inside whatever the current gear actually allows. */
    function clampChosen() {
      if (!caps || !chosen) return;
      var spent = 0;
      STATS.forEach(function (s) {
        var cap = caps[s.key] || 0;
        if ((chosen[s.key] || 0) > cap) chosen[s.key] = cap;
        spent += chosen[s.key] || 0;
      });
      // Points follow the stats: anything clamped away is handed back.
      if (spent < spentPoints) spentPoints = spent;
    }

    function sumStats(o) {
      var t = 0;
      STATS.forEach(function (s) { t += o[s.key] || 0; });
      return t;
    }

    /**
     * Write our chosen values into the game's map.
     *
     * When the player object is a new one - first spawn, or a new match - its
     * map still holds the untouched gear values. That is the only moment they
     * can be read, so the ceiling is taken there, before the first write.
     */
    function applyStats() {
      if (!running || !chosen) return;

      var owner = findStatOwner();
      if (!owner) return;
      var m = owner.statClassValues;
      if (!m || typeof m.set !== 'function') return;

      if (owner !== appliedTo) {
        var natural = readStats();
        // Zeroes mean the gear stats have not landed yet - wait rather than
        // freeze a ceiling of nothing.
        if (!natural || !sumStats(natural)) return;
        caps = natural;
        clampChosen();
        appliedTo = owner;
        saveRun();
      }

      STATS.forEach(function (s) { m.set(s.key, chosen[s.key] || 0); });
    }

    // The game recomputes the map whenever gear or weapon changes, so hold our
    // values down rather than setting them once.
    setInterval(applyStats, 400);

    function myName() {
      var el = document.querySelector('.main-menu-username');
      return el ? (el.textContent || '').trim() : null;
    }

    function looseName(s) {
      return (s || '').replace(/Squad$/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    /**
     * Kills, straight off your player object.
     *
     * The server pushes them in as they happen:
     *
     *     setScores({ scores: t, elo: e }) {
     *       const { flags: i, kills: s, deaths: n, total: o } = t;
     *       this.scoreFlags = i, this.scoreKills = s, ...
     *
     * so `scoreKills` is live. The scoreboard was the only source before, and
     * it only exists in the DOM while Tab is held - which is why the count
     * always arrived late, in a lump, whenever you happened to look at it.
     *
     * The scoreboard reader stays as a fallback for the case where the player
     * object has not been identified yet.
     */
    function readMyKills() {
      var owner = findStatOwner();
      if (owner && typeof owner.scoreKills === 'number') {
        lastRead.source = 'player object';
        lastRead.matched = true;
        return owner.scoreKills;
      }

      lastRead.source = 'scoreboard';

      // Columns are Flags, Kills, Deaths, Score - kills is cell [1].
      var rows = Array.prototype.slice.call(document.querySelectorAll('.playersListItem'));
      lastRead.rows = rows.length;
      lastRead.matched = false;
      lastRead.names = [];
      if (!rows.length) return null;

      var me = looseName(myName());
      if (!me) return null;

      for (var i = 0; i < rows.length; i++) {
        var cell = rows[i].querySelector('.players-list-item-username');
        var nm = looseName(cell ? cell.textContent : rows[i].textContent);
        if (nm) lastRead.names.push(nm);
        var hit = nm === me ||
          (nm.length > 2 && me.indexOf(nm) !== -1) ||
          (me.length > 2 && nm.indexOf(me) !== -1);
        if (!hit) continue;
        var cells = rows[i].querySelectorAll('.playersListItemScore');
        if (cells.length < 2) continue;
        var n = parseInt((cells[1].textContent || '').replace(/\D+/g, ''), 10);
        if (isNaN(n)) continue;
        lastRead.matched = true;
        return n;
      }
      return null;
    }

    /* ---- kills ---- */

    // Seeded from the page: loading straight into a match is not a new match,
    // it is the one you are already in.
    var sawHealthBar = !!document.querySelector('.health-ui-bar-container');

    /**
     * One tick: notice a new match, bank what the old one gave, and read the
     * counter.
     *
     * The health bar appearing is the signal that a match has begun. It is a
     * better one than the kill counter, because the counter is read off the
     * player object - and on a new match that object is stale, so it would sit
     * there reporting the old number forever.
     */
    function tick() {
      var inMatch = !!document.querySelector('.health-ui-bar-container');

      if (inMatch && !sawHealthBar) {
        // Bank what the last match gave, and take whatever the counter reads
        // right now as the new baseline. The old player object can go on
        // reporting its final score for a tick or two before the search
        // finds the new one - with a baseline of zero that score would be
        // counted a second time.
        carriedKills = runKills();
        baselineKills = kills;
        if (running) matches++;
        releaseOwner();
        appliedTo = null;
        saveRun();
        refresh();
      }
      sawHealthBar = inMatch;

      var k = readMyKills();
      if (k === null) return;

      // A drop with no gap in the health bar - a reconnect, say. Bank it too.
      if (k < kills) {
        carriedKills = runKills();
        baselineKills = 0;
      }
      if (k === kills) return;

      kills = k;
      if (running) saveRun();
      if (running && cfg.autoOpen && pointsLeft() > 0 && canUpgradeAnything()) openDialog();
      refresh();
    }

    setInterval(tick, 400);

    function canUpgradeAnything() {
      if (!caps || !chosen) return false;
      return STATS.some(function (s) { return (chosen[s.key] || 0) < (caps[s.key] || 0); });
    }

    /* ---- starting and stopping a run ---- */

    function startRun() {
      var d = diagnose();
      if (!d.ok) return 'Cannot start: ' + d.why + '.';

      var current = readStats();
      if (!current) return 'Cannot start: your player was found but the stat map could not be read.';

      if (!sumStats(current)) {
        return 'Your gear shows no stats right now, so there would be nothing to earn back. ' +
               'Make sure your gear is equipped, then Start.';
      }

      caps = current;                       // your gear set IS the ceiling
      chosen = {};
      STATS.forEach(function (s) { chosen[s.key] = 0; });
      baselineKills = kills;
      carriedKills = 0;
      spentPoints = 0;
      matches = 1;
      appliedTo = null;
      running = true;
      applyStats();
      saveRun();
      return null;
    }

    function stopRun() {
      running = false;
      // Hand the real values back.
      var owner = findStatOwner();
      if (owner && caps && owner.statClassValues && owner.statClassValues.set) {
        STATS.forEach(function (s) { owner.statClassValues.set(s.key, caps[s.key] || 0); });
      }
      carriedKills = 0;
      matches = 1;
      appliedTo = null;
      clearRun();
      refresh();
    }

    function upgrade(stat) {
      if (!running || !caps || !chosen) return;
      if (pointsLeft() < 1) return;
      if ((chosen[stat.key] || 0) >= (caps[stat.key] || 0)) return;
      chosen[stat.key] = (chosen[stat.key] || 0) + 1;
      spentPoints += 1;
      applyStats();
      saveRun();
      refresh();
    }

    /* ================================================================ *
     * UI - a tab in the game's own menu
     * ================================================================ */

    var ICON = '<svg viewBox="0 0 101 104" xmlns="http://www.w3.org/2000/svg">' +
      '<g fill="black">' +
      '<rect x="10" y="70" width="17" height="24" rx="3"/>' +
      '<rect x="34" y="55" width="17" height="39" rx="3"/>' +
      '<rect x="58" y="38" width="17" height="56" rx="3"/></g>' +
      '<g stroke="black" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" fill="black">' +
      '<path d="M20 40 L86 14"/><path d="M90 12 L66 10 L78 30 Z"/></g></svg>';
    var ICON_URL = 'data:image/svg+xml,' + encodeURIComponent(ICON);

    function seed() { return Math.floor(Math.random() * 99999); }

    var CSS = [
      '#nud-dialog .nud-note { opacity: .6; margin: 2px 0 10px; }',
      '#nud-dialog .nud-points { display:flex; gap:18px; align-items:baseline; margin:6px 0 10px; font-size:20px; }',
      '#nud-dialog .nud-points b { font-size:30px; }',
      '#nud-dialog .nud-row { display:flex; align-items:center; gap:10px; }',
      '#nud-dialog .nud-name { flex:1 1 auto; }',
      '#nud-dialog .nud-val { min-width:70px; text-align:right; opacity:.75; }',
      '#nud-dialog .nud-btn { margin:0; padding:0 12px; min-width:0; flex:0 0 auto; }',
      '#nud-dialog .nud-btn:disabled { opacity:.3; cursor:default; }',
      '#nud-dialog .nud-maxed { opacity:.45; }',
      '#nud-dialog .nud-copy { margin: 4px 0 10px; }',
      '#nud-dialog .nud-copy textarea { display:block; width:100%; box-sizing:border-box; resize:vertical; font:inherit; font-size:13px; line-height:1.4; padding:6px 8px; border-radius:6px; border:1px solid rgba(0,0,0,.3); background:rgba(255,255,255,.55); color:inherit; user-select:text; -webkit-user-select:text; }',
      '#nud-dialog .nud-copy-bar { display:flex; justify-content:flex-end; margin-top:4px; }',
      '#nud-dialog .nud-sub { opacity:.4; font-size:11px; margin:-4px 0 8px; word-break:break-all; }',
      '#nud-dialog .nud-cand-stats { min-width:0; flex:1 1 auto; text-align:right; font-size:12px; }',
      '#nud-dialog .nud-picked { outline:2px solid rgba(0,0,0,.35); border-radius:6px; }',
      '#nud-dialog .nud-group { opacity:.55; font-size:12px; text-transform:uppercase; letter-spacing:.04em; margin:10px 0 2px; }',
      '#nud-dialog .nud-group:first-of-type { margin-top:2px; }',
      /* the name is long for a menu button - let it wrap under the icon */
      '#nud-menu-button .main-menu-button-text { font-size:11px; line-height:1.1; white-space:normal; max-width:96px; text-align:center; }'
    ].join('\n');

    (function injectStyle() {
      if (document.getElementById('nud-style')) return;
      var el = document.createElement('style');
      el.id = 'nud-style';
      el.textContent = CSS;
      (document.head || document.documentElement).appendChild(el);
    })();

    var dialogEl = null, curtainEl = null, bodyEl = null, notice = null, showReport = false;

    function refresh() { if (bodyEl) fill(bodyEl); }

    function h3(t) {
      var h = document.createElement('h3');
      h.className = 'settings-group-header';
      h.textContent = t;
      return h;
    }

    function note(t) {
      var d = document.createElement('div');
      d.className = 'nud-note';
      d.textContent = t;
      return d;
    }

    /** Roughly how tall a box has to be to show this text without scrolling. */
    function fitRows(text) {
      var lines = String(text).split('\n');
      var n = 0;
      for (var i = 0; i < lines.length; i++) n += Math.max(1, Math.ceil(lines[i].length / 54));
      return Math.max(2, Math.min(14, n));
    }

    /**
     * A message you can actually get out of the page.
     *
     * The game sets user-select:none document-wide, so a plain div cannot be
     * swiped with the mouse - which made every error read-only in the worst
     * sense of the phrase. A read-only textarea is a form control with its own
     * selection, so it can be dragged over and Ctrl+A'd, and it gives the Copy
     * button something to select when the clipboard API refuses: that API wants
     * a focused document, and the game spends most of its life holding the
     * pointer.
     */
    function copyable(text, label) {
      label = label || 'Copy';

      var wrap = document.createElement('div');
      wrap.className = 'nud-copy';

      var ta = document.createElement('textarea');
      ta.readOnly = true;
      ta.spellcheck = false;
      ta.rows = fitRows(text);
      ta.value = text;
      ta.addEventListener('focus', function () { ta.select(); });
      wrap.appendChild(ta);

      var bar = document.createElement('div');
      bar.className = 'nud-copy-bar';
      var btn = button(label, function () { copyText(ta, btn, label); });
      btn.className += ' nud-btn';
      bar.appendChild(btn);
      wrap.appendChild(bar);

      return wrap;
    }

    /** Copy the box, and say on the button itself whether it worked. */
    function copyText(ta, btn, label) {
      var span = btn.querySelector('span');
      function say(msg) {
        span.textContent = msg;
        setTimeout(function () { if (span.isConnected) span.textContent = label; }, 1500);
      }

      ta.focus();
      ta.select();
      try { ta.setSelectionRange(0, ta.value.length); } catch (e) {}

      function viaExec() {
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) {}
        // Either way the text is selected, so Ctrl+C is always the way out.
        say(ok ? 'Copied' : 'Press Ctrl+C');
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ta.value).then(function () { say('Copied'); }, viaExec);
      } else {
        viaExec();
      }
    }

    /** A candidate's stats in a few words - the easiest way to recognise yourself. */
    function statSummary(o) {
      var m = o.statClassValues;
      if (!mapUsable(m)) return 'no stats yet';
      var parts = [];
      STATS.forEach(function (s) {
        var v;
        try { v = m.get(s.key); } catch (e) { return; }
        if (v) parts.push(s.name.toLowerCase() + ' ' + v);
      });
      return parts.length ? parts.join(', ') : 'all zero';
    }

    /** Everything worth knowing when something is wrong, in one pasteable block. */
    function report() {
      var d;
      try { d = diagnose(); } catch (e) { d = { ok: false, why: 'diagnose() threw: ' + e.message }; }
      var stats = null;
      try { stats = readStats(); } catch (e) {}

      var head = [
        'Underdog ' + VERSION,
        'page: ' + location.href,
        'browser: ' + navigator.userAgent,
        '',
        'patched copy in cache: ' + patchState.patched,
        'cache name: ' + (patchState.cacheName || '-'),
        'entry: ' + (patchState.entryUrl || '-'),
        'set-up error: ' + (patchState.error || 'none'),
        'game published: ' + (findGame() ? 'yes' : 'no'),
        'diagnose: ' + (d.ok ? 'ok' : d.why),
        '',
        'running: ' + running,
        'your name: ' + (myName() || '?'),
        'kills read from: ' + lastRead.source,
        'scoreboard rows: ' + lastRead.rows + ' (matched: ' + lastRead.matched + ')',
        'scoreKills: ' + (statOwner ? statOwner.scoreKills : '-'),
        'names seen: ' + (lastRead.names.slice(0, 8).join(', ') || '-'),
        'kills this run: ' + runKills() + '   points left: ' + pointsLeft() + '   spent: ' + spentPoints,
        'carried: ' + carriedKills + '   match counter: ' + kills + '   baseline: ' + baselineKills + '   matches: ' + matches,
        '',
        'gear ceiling: ' + JSON.stringify(caps),
        'bought back: ' + JSON.stringify(chosen),
        'live stats: ' + JSON.stringify(stats),
        '',
        'picked by hand: ' + (pickedPath || 'no')
      ];

      var list = [];
      try { list = playerCandidates(); } catch (e) {}
      head.push('players found: ' + list.length);
      list.slice(0, 12).forEach(function (c, i) {
        // Own keys too: if none of the flags we know about is there, the real
        // one is somewhere in this list.
        var keys = [];
        try { keys = Object.keys(c.o).slice(0, 40); } catch (e) {}
        head.push('  #' + i + ' score=' + c.score +
                  ' flag=' + (c.flag || '-') +
                  ' name=' + (c.name || '-') +
                  ' [' + statSummary(c.o) + ']');
        head.push('      at ' + c.path);
        head.push('      keys: ' + keys.join(' '));
      });

      return head.join('\n');
    }

    /**
     * Diagnostics: the report, and - when the mod cannot tell which player is
     * you - the list of everything it found, so you can say which one.
     */
    function addDiagnostics(inner) {
      inner.appendChild(h3('Diagnostics'));

      if (findGame()) {
        var list = [];
        try { list = playerCandidates(); } catch (e) {}

        if (list.length) {
          inner.appendChild(note(list.length + ' player object' + (list.length === 1 ? '' : 's') +
            ' in this match. ' + (statOwner
              ? 'Yours is the highlighted one.'
              : 'None of them identified itself as yours - pick the one with your stats.')));

          list.slice(0, 12).forEach(function (c) {
            var picked = c.o === statOwner;

            var r = document.createElement('div');
            r.className = 'settings-item nud-row' + (picked ? ' nud-picked' : '');

            var n = document.createElement('div');
            n.className = 'nud-name';
            n.textContent = (c.name || 'unnamed') +
              (c.flag ? '  · ' + c.flag : '') +
              (c.nameMatch ? '  · your name' : '');
            r.appendChild(n);

            var v = document.createElement('div');
            v.className = 'nud-val nud-cand-stats';
            v.textContent = statSummary(c.o);
            r.appendChild(v);

            var b = picked
              ? button('Clear', function () { forgetOwner(); refresh(); })
              : button('This is me', function () { pickCandidate(c); refresh(); });
            b.className += ' nud-btn';
            r.appendChild(b);

            inner.appendChild(r);

            var sub = document.createElement('div');
            sub.className = 'nud-sub';
            sub.textContent = c.path;
            inner.appendChild(sub);
          });
        }
      }

      var row = document.createElement('div');
      row.style.cssText = 'display:flex; gap:8px; margin:6px 0 4px;';
      row.appendChild(button(showReport ? 'Hide report' : 'Show report', function () {
        showReport = !showReport;
        refresh();
      }));
      inner.appendChild(row);

      if (showReport) {
        inner.appendChild(note('Everything the mod knows about its own state. Copy it and send it on.'));
        inner.appendChild(copyable(report(), 'Copy report'));
      }
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

    function fill(inner) {
      inner.textContent = '';

      // --- state of the hook ---
      if (!findGame()) {
        inner.appendChild(h3('Set-up'));

        if (patchState.patched) {
          inner.appendChild(note('The patched game is in place but has not loaded yet. ' +
            'Reload the page (Ctrl+Shift+R) and this will connect.'));
        } else {
          inner.appendChild(note(
            'Underdog needs one-off set-up. It writes a patched copy of the game into ' +
            'the game\'s own cache, which is how it can reach your stats at all. ' +
            'The page reloads once, then it is connected every time.' +
            (patchState.cacheName ? '' : '\n\nThe cache is not there yet - load a match once, then come back.')));
        }

        if (patchState.error) {
          inner.appendChild(copyable('Last attempt: ' + patchState.error, 'Copy error'));
        }

        var setupRow = document.createElement('div');
        setupRow.style.cssText = 'display:flex; gap:8px; margin:6px 0 4px;';

        setupRow.appendChild(button(patchState.patched ? 'Reload now' : 'Enable', function () {
          if (patchState.patched) { location.reload(); return; }
          enablePatch().then(function (result) {
            patchState.error = null;
            console.log('[Underdog] ' + result + ' - reloading.');
            location.reload();
          }).catch(function (e) {
            patchState.error = e.message;
            refresh();
          });
        }));

        setupRow.appendChild(button('Undo', function () {
          disablePatch().then(function (result) {
            console.log('[Underdog] ' + result + ' - reloading.');
            location.reload();
          }).catch(function (e) {
            patchState.error = e.message;
            refresh();
          });
        }));

        inner.appendChild(setupRow);

        inner.appendChild(note('Undo removes the patched copy and puts the untouched game back. ' +
          'Nothing on your computer is modified either way.'));

        addDiagnostics(inner);
        return;
      }

      inner.appendChild(h3('Progress'));
      var pts = document.createElement('div');
      pts.className = 'nud-points';
      pts.innerHTML = '<div><b>' + runKills() + '</b> kills</div>' +
                      '<div><b>' + pointsLeft() + '</b> points</div>';
      inner.appendChild(pts);

      if (running && carriedKills > 0) {
        inner.appendChild(note(carriedKills + ' of those carried over from ' +
          (matches - 1) + ' earlier match' + (matches === 2 ? '' : 'es') + '. ' +
          'The run keeps going until you press Stop.'));
      }

      if (!document.querySelector('.health-ui-bar-container')) {
        inner.appendChild(note('Join a match to begin.'));
      } else if (lastRead.source === 'scoreboard' && !lastRead.rows) {
        inner.appendChild(note('Hold Tab for a moment to sync your kills.'));
      } else if (lastRead.source === 'scoreboard' && !lastRead.matched) {
        inner.appendChild(copyable('Saw ' + lastRead.rows + ' scoreboard rows but none matched "' +
          (myName() || '?') + '". Names seen: ' + lastRead.names.slice(0, 5).join(', '), 'Copy'));
      }

      // --- run controls ---
      var row = document.createElement('div');
      row.style.cssText = 'display:flex; gap:8px; margin:6px 0 10px;';
      row.appendChild(button(running ? 'Restart' : 'Start', function () {
        var err = startRun();
        notice = err;
        refresh();
      }));
      row.appendChild(button('Stop', function () { stopRun(); }, !running));
      inner.appendChild(row);

      if (notice) inner.appendChild(copyable(notice, 'Copy error'));

      // --- the stats ---
      if (running && caps && chosen) {
        inner.appendChild(h3('Your stats'));
        inner.appendChild(note('Capped at what your own gear set gives. Your gear and weapons are untouched.'));

        var any = false;
        // Bow, Armour, Melee, then Bloodlust last - it isn't tied to a
        // weapon type, so it doesn't belong ahead of the ones that are.
        ['bow', 'armor', 'melee', 'shared'].forEach(function (groupKey) {
          var inGroup = STATS.filter(function (s) { return s.group === groupKey && (caps[s.key] || 0); });
          if (!inGroup.length) return;
          any = true;

          var gh = document.createElement('div');
          gh.className = 'nud-group';
          gh.textContent = GROUPS[groupKey];
          inner.appendChild(gh);

          inGroup.forEach(function (s) {
            var cap = caps[s.key] || 0;
            var have = chosen[s.key] || 0;
            var maxed = have >= cap;

            var r = document.createElement('div');
            r.className = 'settings-item nud-row' + (maxed ? ' nud-maxed' : '');

            var n = document.createElement('div');
            n.className = 'nud-name';
            n.textContent = s.name;
            r.appendChild(n);

            var v = document.createElement('div');
            v.className = 'nud-val';
            v.textContent = have + ' / ' + cap;
            r.appendChild(v);

            var b;
            if (maxed) b = button('Maxed', null, true);
            else if (pointsLeft() < 1) b = button('Need 1', null, true);
            else b = button('Upgrade', function () { upgrade(s); });
            b.className += ' nud-btn';
            r.appendChild(b);

            inner.appendChild(r);
          });
        });

        if (!any) inner.appendChild(note('Your gear set provides no stats at all.'));
      }

      // --- rules ---
      inner.appendChild(h3('Rules'));

      function rateText() {
        return cfg.killsPerPoint === 1
          ? '1 kill = 1 stat point.'
          : cfg.killsPerPoint + ' kills = 1 stat point.';
      }

      var kr = document.createElement('label');
      kr.className = 'settings-item';
      var kt = document.createElement('div');
      kt.className = 'settings-item-text';
      kt.textContent = 'Kills per point';
      kr.appendChild(kt);
      var sl = document.createElement('div');
      sl.className = 'settings-item-slider';
      var si = document.createElement('input');
      si.className = 'dialog-range-input';
      si.type = 'range'; si.min = 1; si.max = 10; si.step = 1; si.value = cfg.killsPerPoint;
      var sv = document.createElement('div');
      sv.className = 'settings-item-slider-value';
      sv.textContent = cfg.killsPerPoint;
      var kn = note(rateText());
      si.addEventListener('input', function () {
        cfg.killsPerPoint = Number(si.value);
        sv.textContent = si.value;
        // Update the line in place - a full rebuild would pull the slider out
        // from under your thumb mid-drag.
        kn.textContent = rateText();
        save();
      });
      sl.appendChild(si); sl.appendChild(sv); kr.appendChild(sl);
      inner.appendChild(kr);
      inner.appendChild(kn);

      var ar = document.createElement('label');
      ar.className = 'settings-item';
      var at = document.createElement('div');
      at.className = 'settings-item-text';
      at.textContent = 'Open it automatically on a new point';
      ar.appendChild(at);
      var ab = document.createElement('input');
      ab.type = 'checkbox';
      ab.className = 'dialog-checkbox-input wrinkledPaper';
      ab.style.setProperty('--wrinkled-paper-seed', seed());
      ab.checked = !!cfg.autoOpen;
      ab.addEventListener('change', function () { cfg.autoOpen = ab.checked; save(); });
      ar.appendChild(ab);
      inner.appendChild(ar);
      inner.appendChild(note(keyHintText('underdog.toggle', 'KeyF', 'open or close this window')));

      addDiagnostics(inner);
    }

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
      dialogEl.id = 'nud-dialog';
      dialogEl.style.setProperty('--wrinkled-paper-seed', seed());
      dialogEl.style.zIndex = '100';

      var title = document.createElement('h2');
      title.className = 'dialogTitle blueNight';
      title.textContent = '1 Kill = 1 Stat Point';
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

    function injectMenuButton() {
      var bar = document.querySelector('.menu-buttons-container');
      if (!bar || bar.querySelector('#nud-menu-button')) return;

      var c = document.createElement('div');
      c.className = 'main-menu-button-container';
      c.id = 'nud-menu-button';

      var b = document.createElement('button');
      b.className = 'wrinkledPaper main-menu-button';
      b.setAttribute('aria-label', '1 Kill = 1 Stat Point');
      b.style.setProperty('--wrinkled-paper-seed', seed());

      var img = document.createElement('div');
      img.className = 'buttonImage';
      img.style.backgroundImage = 'url("' + ICON_URL + '")';
      img.style.backgroundSize = '90%';
      b.appendChild(img);

      var l = document.createElement('div');
      l.className = 'main-menu-button-text whiteBigText blueNight';
      l.setAttribute('aria-hidden', 'true');
      l.textContent = '1 Kill = 1 Stat Point';

      c.appendChild(b); c.appendChild(l);
      b.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (dialogEl && dialogEl.isConnected) closeDialog(); else openDialog();
      });

      var sibs = Array.prototype.slice.call(bar.querySelectorAll('.main-menu-button-container'));
      var anchor = sibs.filter(function (x) {
        var t = (x.textContent || '').trim();
        return t === 'Crosshair' || t === 'Health' || t === 'Settings';
      }).pop();
      if (anchor && anchor.nextSibling) bar.insertBefore(c, anchor.nextSibling);
      else bar.appendChild(c);
    }

    injectMenuButton();
    setInterval(injectMenuButton, 1000);

    /**
     * Keys.
     *
     * The toggle key defaults to F but can be rebound (or turned off) with
     * the Hotkey Editor mod - hotkeyFor() reads whatever it last saved.
     * Whichever key it is, it is taken in the capture phase and stopped
     * there, so the game never sees that press - otherwise opening the
     * manager would also fire whatever that key does in game.
     *
     * Neither key fires while you are typing in the report box, which is a
     * real textarea and would otherwise swallow the keystroke and close on
     * it.
     */
    function typingInDialog(e) {
      var t = e.target;
      if (!t || !t.tagName) return false;
      var tag = t.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || t.isContentEditable;
    }

    window.addEventListener('keydown', function (e) {
      var open = !!(dialogEl && dialogEl.isConnected);

      if (e.code === 'Escape' && open) {
        e.preventDefault(); e.stopPropagation();
        closeDialog();
        return;
      }

      var key = hotkeyFor('underdog.toggle', 'KeyF');
      if (key === null || e.code !== key) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;   // leave Ctrl+<key> alone
      if (typingInDialog(e)) return;

      e.preventDefault(); e.stopPropagation();
      if (open) closeDialog(); else openDialog();
    }, true);

    PAGE.NarrowUnderdog = window.NarrowUnderdog = {
      get game() { return findGame(); },
      get statOwner() { return findStatOwner(); },
      readStats: readStats,
      get caps() { return caps; },
      get chosen() { return chosen; },
      get points() { return pointsLeft(); },
      open: openDialog,
      start: startRun,
      stop: stopRun,
      patchState: patchState,
      diagnose: diagnose,
      enable: enablePatch,
      disable: disablePatch,
      check: checkPatched,
      report: report,
      get candidates() { return playerCandidates(); },
      /** Pick the Nth candidate from .candidates as you. */
      pick: function (i) { var l = playerCandidates(); return l[i] ? pickCandidate(l[i]) : null; },
      forget: forgetOwner,
      /** Pretend you have N kills this run, to try the menu without playing. */
      simulateKills: function (n) {
        kills = baselineKills + Math.max(0, n | 0);
        refresh();
        return runKills() + ' kills, ' + pointsLeft() + ' points';
      }
    };

    console.log('[Underdog] ready. Patched copy in cache:', patchState.patched);
  });
})();
