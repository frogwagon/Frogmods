// ==UserScript==
// @name         Settings & Stats
// @namespace    narrowone-settings-stats
// @version      2.8.0
// @description  Widens FOV, sensitivity, crosshair offset, UI scale and quality right inside the game's own Settings dialog, adds K/D and a running session to your profile stats (click your name to see them), and shows live match stats while you hold Tab. No menu of its own.
// @author       Frogwagon
// @match        https://narrow.one/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

/*
 * Settings & Stats  -  Narrow One
 * ---------------------------------
 * No tab of its own. Everything lands where the game already has a spot
 * for it.
 *
 * 1. Settings. Every setting the game has already gets a slider in its own
 *    Settings dialog - there's nothing hidden to unlock. What IS true: the
 *    underlying setValue() stores whatever you give it with zero clamping,
 *    the slider's min/max is a UI decision, not a stored limit. So this
 *    widens the actual native sliders - FOV, mouse sensitivity, crosshair
 *    accuracy offset, UI scale, render quality - in place, the moment the
 *    Settings dialog opens. Same row, same listener, same everything -
 *    just a wider min/max attribute on the same <input>.
 *
 * 2. Stats, two places:
 *
 *    - Click your name. The corner profile you already click opens the
 *      game's own profile dialog with real lifetime stats from its server -
 *      games played, games won, flags, points, kills, deaths:
 *
 *        n("gamesPlayed","Games Played"), n("kills","Kills"), ...
 *        po().profileState.stats   // the numbers behind those rows
 *
 *      This adds a K/D row and a running session block (this browser
 *      session's kills/deaths/flags, carried across matches) right into
 *      that same panel, styled to match its existing rows.
 *
 *    - Hold Tab. That's the game's own key for the scoreboard - held down,
 *      via onPressedDown/onPressedUp on its own input binding. This hooks
 *      the exact same down/up events to show a small live panel (this
 *      match's kills/deaths/flags/K-D/ping/fps, plus the running session)
 *      for exactly as long as Tab is held, the same rhythm the scoreboard
 *      already uses.
 *
 * Reaching the settings manager, the profile state and your own player
 * object all need the same one-line bundle patch 1 Kill = 1 Stat Point
 * uses (see that mod's header for the full reasoning). Idempotent, so
 * it's safe alongside any other mod that also applies it. This one applies
 * itself automatically - once the cache exists (play one round), it
 * patches and reloads on its own, no button to press.
 */

(function () {
  'use strict';

  var PAGE = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;

  var ENTRY_RE = /\/js\/index-[^/]*\.js$/;
  var PO_RE = /function ([A-Za-z_$][\w$]*)\(\)\{if\(!([A-Za-z_$][\w$]*)\)throw new Error\("Main instance is not initialized"\);return \2\}/;
  var CACHE_RE = /^narrowClient\d+$/;
  var MARK = '__NARROW';

  /* ================================================================== *
   * Part 1 - the same cache patch 1 Kill = 1 Stat Point uses.
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

  /** No button to press - once the cache exists, patch it and reload, once. */
  (function autoPatch() {
    var tries = 0;
    function attempt() {
      tries++;
      checkPatched().then(function (patched) {
        if (patched) return;
        if (!patchState.cacheName) {
          if (tries < 40) setTimeout(attempt, 3000);   // keep checking - ~2 minutes
          return;
        }
        enablePatch().then(function (result) {
          if (result === 'already patched') return;
          console.log('[Settings & Stats] patched the game - reloading once to connect.');
          location.reload();
        }).catch(function (e) {
          patchState.error = e.message;
          console.warn('[Settings & Stats] could not patch:', e.message);
        });
      });
    }
    attempt();
  })();

  function findGame() { return PAGE[MARK] || null; }

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
    if (PAGE.__narrowOneSettingsStats) return;
    PAGE.__narrowOneSettingsStats = true;

    var STORE_KEY = 'narrowone.settingsstats.v2';

    /* ---- finding your own player, same shape as 1 Kill = 1 Stat Point ---- */

    function collectMatching(root, predicate, limit) {
      var found = [];
      if (!root) return found;
      var seen = new Set();
      var queue = [{ o: root, d: 0 }];
      var visited = 0;

      while (queue.length && visited < 40000 && found.length < limit) {
        var cur = queue.shift();
        var o = cur.o;
        if (!o || typeof o !== 'object' || seen.has(o)) continue;
        seen.add(o);
        visited++;

        try { if (predicate(o)) found.push(o); } catch (e) {}
        if (cur.d >= 8) continue;

        var push = function (v) {
          if (!v || typeof v !== 'object') return;
          if (typeof Node !== 'undefined' && v instanceof Node) return;
          if (v instanceof Window) return;
          queue.push({ o: v, d: cur.d + 1 });
        };

        if (o instanceof Map) { o.forEach(push); continue; }
        if (o instanceof Set) { o.forEach(push); continue; }
        if (Array.isArray(o)) { o.forEach(push); continue; }
        var keys;
        try { keys = Object.keys(o); } catch (e) { continue; }
        for (var i = 0; i < keys.length && i < 200; i++) {
          var v;
          try { v = o[keys[i]]; } catch (e) { continue; }
          push(v);
        }
      }
      return found;
    }

    function hasScores(o) { return Object.prototype.hasOwnProperty.call(o, 'scoreKills'); }

    /**
     * The live match, and you in it - read straight off the path the game
     * itself uses, not searched for.
     *
     * An earlier version walked the whole game object graph looking for the
     * player flagged hasOwnership. In the real game that graph is huge (the
     * whole three.js scene hangs off it), and the walk gives up long before
     * it finds anyone - which is why "This match" and the session both sat
     * at nothing. The scoreboard reads this same Map:
     *
     *   this.players = new Map      // on gameManager.activeGame
     *   this.playersListDialog = new Ki(t, this.players, ...)
     */
    function currentGame() {
      var g = findGame();
      var ag = g && g.gameManager && g.gameManager.activeGame;
      return (ag && ag.players instanceof Map) ? ag : null;
    }

    /**
     * Which team id is the spectators'.
     *
     * The game gives a match three team ids - two real teams and a spectator
     * one - and marks a spectator only with flight, which the server turns on
     * for other people's players on its own schedule, so flight alone can miss
     * them (they then showed up tagged and listed as a third "team"). Two
     * things pin the team down properly:
     *
     *  - any player who IS flying tells you the team id outright, and
     *  - the scoreboard keeps a coloured element per team, indexed by team id
     *    (teamEls[id].containerEl carries --team-bg-color-light), and the
     *    spectator team is the green one.
     *
     * Once the id is known the whole team is excluded, flying or not.
     */
    var specCache = { game: null, at: 0, id: null };
    function spectatorTeamId() {
      var ag = currentGame();
      if (!ag) return null;
      var now = Date.now();
      if (specCache.game === ag && now - specCache.at < 1000) return specCache.id;

      var id = null;
      ag.players.forEach(function (pl) {
        if (id === null && pl && pl.rigidBody && pl.rigidBody.fly === true && !pl.noclip) id = pl.teamId;
      });
      if (id === null) {
        var colors = teamColorMap(ag);
        Object.keys(colors).forEach(function (k) {
          if (id === null && colorName(colors[k]) === 'Green') id = Number(k);
        });
      }
      specCache = { game: ag, at: now, id: id };
      return id;
    }

    function isSpectatorPlayer(pl) {
      if (!pl) return false;
      if (pl.rigidBody && pl.rigidBody.fly === true && !pl.noclip) return true;
      var id = spectatorTeamId();
      return id !== null && pl.teamId === id;
    }

    /** teamId -> [r,g,b], read from the scoreboard's own per-team elements. */
    function teamColorMap(ag) {
      var map = {};
      try {
        var els = ag.playersListDialog && ag.playersListDialog.teamEls;
        if (els && typeof els.forEach === 'function') {
          els.forEach(function (t, id) {
            var css = t && t.containerEl && t.containerEl.style &&
              t.containerEl.style.getPropertyValue('--team-bg-color-light');
            var rgb = parseRgb(String(css || '').trim());
            if (rgb) map[id] = rgb;
          });
        }
      } catch (e) {}
      return map;
    }

    function colorName(rgb) {
      var r = rgb[0], g = rgb[1], b = rgb[2];
      if (r > g * 1.15 && r > b * 1.15) return 'Red';
      if (b > r * 1.15 && b > g * 1.15) return 'Blue';
      if (g > r * 1.15 && g > b * 1.15) return 'Green';
      return null;
    }


    var player = null, playerGame = null;
    function findPlayer() {
      var ag = currentGame();
      if (!ag) { player = null; playerGame = null; return null; }
      if (player && playerGame === ag && player.hasOwnership) return player;
      var me = null;
      ag.players.forEach(function (pl) { if (!me && pl && pl.hasOwnership === true) me = pl; });
      player = me;
      playerGame = ag;
      return player;
    }

    /**
     * Every way a point can land, straight from the bundle's own score-type
     * table - the id the server tags each point event with, and the label
     * it already uses on its own end-of-round overview:
     *
     *   Xi.set(10, {text:"Headshot", overviewText:"Headshots", ...})
     *
     * so this can't drift out of sync with what the game actually calls
     * these, or miss one it adds later without me noticing.
     */
    var SCORE_TYPES = [
      [1, 'Kills'], [2, 'Assists'], [3, 'Carrier Kills'], [4, 'Flag Grabs'],
      [5, 'Flag Carry'], [6, 'Flag Captures'], [7, 'Carrier Assist'],
      [8, 'Win Bonus'], [9, 'Flag Return'], [10, 'Headshots'],
      [11, 'Long Range Hits'], [12, 'Capture Assists'], [13, 'On the Hill']
    ];

    /**
     * The live match object - not the player, not po() itself. Everything
     * below comes straight off it:
     *
     *   this.trackedMyPlayerScores = new Map   // id -> points earned so far
     *   this.gameEndReceivedCoins = 0          // set once the server sends
     *                                          // end-of-round rewards
     *
     * Both update on their own as the match (and the round-end handshake)
     * happen - nothing here has to poll the server itself.
     */
    function findActiveGame() {
      var g = findGame();
      var ag = g && g.gameManager && g.gameManager.activeGame;
      return (ag && ag.trackedMyPlayerScores instanceof Map) ? ag : null;
    }

    function pointBreakdown() {
      var ag = findActiveGame();
      if (!ag) return [];
      var rows = [];
      SCORE_TYPES.forEach(function (pair) {
        var pts = ag.trackedMyPlayerScores.get(pair[0]);
        if (pts) rows.push([pair[1], pts]);
      });
      return rows;
    }

    function coinsEarned() {
      var ag = findActiveGame();
      return ag ? (ag.gameEndReceivedCoins || 0) : 0;
    }

    /* ================================================================ *
     * 1. Widen the native settings sliders in place
     * ================================================================ */

    // label text -> wider [min, max], straight from the bundle's own
    // dialog config and defaultValues object for the "native" comparison.
    var WIDER = {
      'Field of view': { min: 20, max: 170, nativeMin: 40, nativeMax: 140 },
      'Mouse sensitivity': { min: 0.05, max: 10, nativeMin: 0.1, nativeMax: 5 },
      'Accuracy Offset': { min: 0, max: 10, nativeMin: 0, nativeMax: 4 },
      'UI scale': { min: 0.3, max: 3, nativeMin: 0.5, nativeMax: 2 },
      'Quality': { min: 0.1, max: 5, nativeMin: 0.1, nativeMax: 3 }
    };

    function widenSettingsDialog(dialog) {
      var rows = dialog.querySelectorAll('.settings-item');
      rows.forEach(function (row) {
        var textEl = row.querySelector('.settings-item-text');
        if (!textEl) return;
        var wider = WIDER[textEl.textContent.trim()];
        if (!wider) return;
        var input = row.querySelector('input[type="range"]');
        if (!input || input.dataset.nssWidened) return;
        input.min = wider.min;
        input.max = wider.max;
        input.dataset.nssWidened = '1';
        input.title = 'Native range: ' + wider.nativeMin + '–' + wider.nativeMax;
      });
    }

    /* ================================================================ *
     * 2a. Add K/D + session rows into the native profile dialog
     * ================================================================ */

    function profileStatRow(iconKey, label) {
      var n = document.createElement('div');
      n.classList.add('wrinkledPaper', 'profile-stat', 'nss-added-stat');
      n.style.setProperty('--wrinkled-paper-seed', String(Math.floor(Math.random() * 99999)));
      var icon = document.createElement('div');
      icon.classList.add('profile-stat-icon');
      n.appendChild(icon);
      var a = document.createElement('div');
      a.textContent = label;
      n.appendChild(a);
      var r = document.createElement('div');
      r.textContent = '-';
      n.appendChild(r);
      return { el: n, valueEl: r };
    }

    function ratio(kills, deaths) {
      return deaths > 0 ? (kills / deaths).toFixed(2) : (kills > 0 ? kills.toFixed(2) : '0.00');
    }

    /**
     * Rows get built once, then kept live for as long as the dialog stays
     * open - two separate reasons the old one-shot version went stale:
     *
     *  - the game kicks off profileState.fetchCurrentData() in this same
     *    dialog's own constructor, and that fetch is still in flight the
     *    instant our MutationObserver callback runs, so reading
     *    profileState.stats immediately mostly caught it before the real
     *    numbers had arrived.
     *  - the session totals are genuinely live and meant to move while you
     *    watch, particularly if this got opened mid-match.
     */
    function enrichProfileDialog(dialog) {
      var statsEl = dialog.querySelector('.profile-stats');
      if (!statsEl || statsEl.dataset.nssEnriched) return;
      statsEl.dataset.nssEnriched = '1';

      var kdRow = profileStatRow('kills', 'K/D');
      statsEl.appendChild(kdRow.el);

      var sessionRows = {
        kills: profileStatRow('kills', 'Session Kills'),
        deaths: profileStatRow('kills', 'Session Deaths'),
        flags: profileStatRow('flagsCaptured', 'Session Flags'),
        kd: profileStatRow('kills', 'Session K/D')
      };
      Object.keys(sessionRows).forEach(function (k) { statsEl.appendChild(sessionRows[k].el); });

      // The session otherwise runs on across matches and reloads, so give it an end.
      var endBtn = document.createElement('button');
      endBtn.type = 'button';
      endBtn.tabIndex = -1;
      endBtn.textContent = 'End session (reset to 0)';
      endBtn.style.cssText = 'grid-column:1/-1;margin-top:6px;padding:6px 10px;cursor:pointer;font:inherit;' +
        'color:inherit;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.35);border-radius:6px;';
      endBtn.addEventListener('click', function () { endSession(); update(); });
      statsEl.appendChild(endBtn);

      function update() {
        if (!statsEl.isConnected) { clearInterval(timer); return; }

        var g = findGame();
        var stats = (g && g.profileState && g.profileState.stats) || {};
        kdRow.valueEl.textContent = ratio(Number(stats.kills) || 0, Number(stats.deaths) || 0);

        var totals = liveSessionTotals();
        sessionRows.kills.valueEl.textContent = totals.kills;
        sessionRows.deaths.valueEl.textContent = totals.deaths;
        sessionRows.flags.valueEl.textContent = totals.flags;
        sessionRows.kd.valueEl.textContent = ratio(totals.kills, totals.deaths);
      }
      update();
      var timer = setInterval(update, 500);
    }

    /* ================================================================ *
     * Watch for the game's own dialogs and hook into the two we care
     * about, the moment they open. Same pattern Crosshair Customizer uses
     * to strip its own group out of this exact dialog.
     * ================================================================ */

    /* ================================================================ *
     * Name tags above teammates - a setting in the native Settings dialog
     *
     * The game has no in-world name tags at all (playerName only ever
     * feeds the scoreboard and squad lists), so this draws its own: a small
     * label per teammate, placed by projecting their world position through
     * the game's own camera.
     *
     * Enemies get one too, but ONLY while you can actually see them. A label
     * is a DOM element and DOM elements ignore walls - drawn naively it
     * would show you exactly where an enemy is through solid geometry, which
     * is a wallhack however it's dressed up. So every enemy tag is gated on
     * a line-of-sight test using the game's own wall raycast, the same one
     * it uses to stop arrows:
     *
     *   physics.getRayCastCache(from, to)          // build the ray
     *   physics.rayCastMapColliders(ray, filter)   // first wall it hits
     *
     * If anything solid is between your eye and them, no tag. If the test
     * can't run at all (no physics, no camera), the tag stays hidden rather
     * than guessing - it fails closed. Teammates are always tagged.
     * ================================================================ */

    var TAGS_KEY = 'narrowone.settingsstats.nametags';
    function tagsOn() {
      try { return localStorage.getItem(TAGS_KEY) === '1'; } catch (e) { return false; }
    }
    function setTags(on) {
      try { localStorage.setItem(TAGS_KEY, on ? '1' : '0'); } catch (e) {}
    }

    /** A native-looking toggle row, added under "Show ping and fps". */
    function addNameTagOption(dialog) {
      var rows = dialog.querySelectorAll('.settings-item');
      var anchor = null;
      rows.forEach(function (row) {
        var t = row.querySelector('.settings-item-text');
        if (t && t.textContent.trim() === 'Show ping and fps') anchor = row;
      });
      if (!anchor || dialog.querySelector('[data-nss-tags]')) return;

      var row = document.createElement('label');
      row.className = 'settings-item';
      row.dataset.nssTags = '1';
      var text = document.createElement('div');
      text.className = 'settings-item-text';
      text.textContent = 'Name tags above players';
      row.appendChild(text);
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'dialog-checkbox-input wrinkledPaper';
      box.style.setProperty('--wrinkled-paper-seed', String(Math.floor(Math.random() * 99999)));
      box.checked = tagsOn();
      box.addEventListener('change', function () { setTags(box.checked); });
      row.appendChild(box);
      anchor.parentNode.insertBefore(row, anchor.nextSibling);
    }

    /* ================================================================ *
     * Kill feed and bow charge - two more native Settings options
     *
     * Both are off by default, both read only what the game already holds
     * for your own client, and neither shows anything about a player you
     * couldn't already see on the scoreboard.
     * ================================================================ */

    var FEED_KEY = 'narrowone.settingsstats.killfeed';
    var CHARGE_KEY = 'narrowone.settingsstats.bowcharge';
    function flagOn(key) {
      try { return localStorage.getItem(key) === '1'; } catch (e) { return false; }
    }
    function setFlag(key, on) {
      try { localStorage.setItem(key, on ? '1' : '0'); } catch (e) {}
    }

    /** Generic native-looking checkbox row, slotted in under the last of our rows (or "Show ping and fps"). */
    function addToggleRow(dialog, marker, label, key) {
      if (dialog.querySelector('[data-' + marker + ']')) return;
      var anchor = null, last = null;
      dialog.querySelectorAll('.settings-item').forEach(function (row) {
        var t = row.querySelector('.settings-item-text');
        if (t && t.textContent.trim() === 'Show ping and fps') anchor = row;
        if (row.dataset.nssTags || row.dataset.nssFeed || row.dataset.nssCharge) last = row;
      });
      anchor = last || anchor;
      if (!anchor) return;

      var row = document.createElement('label');
      row.className = 'settings-item';
      row.setAttribute('data-' + marker, '1');
      var text = document.createElement('div');
      text.className = 'settings-item-text';
      text.textContent = label;
      row.appendChild(text);
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.tabIndex = -1;
      box.className = 'dialog-checkbox-input wrinkledPaper';
      box.style.setProperty('--wrinkled-paper-seed', String(Math.floor(Math.random() * 99999)));
      box.checked = flagOn(key);
      box.addEventListener('change', function () { setFlag(key, box.checked); });
      row.appendChild(box);
      anchor.parentNode.insertBefore(row, anchor.nextSibling);
    }
    function addFeedAndChargeOptions(dialog) {
      addToggleRow(dialog, 'nss-feed', 'Kill feed', FEED_KEY);
      addToggleRow(dialog, 'nss-charge', 'Bow charge under crosshair', CHARGE_KEY);
    }

    /* ---- bow charge ---- */

    /**
     * Each of the game's six bows works differently, so each gets its own
     * readout under the crosshair. They are told apart by the bow's own
     * bowWeaponTypeId:
     *
     *   smallBow          (B1)  bar = draw, three circles = stacked arrows
     *   mediumBow         (B2)  one circle, fills as you draw, green when full
     *   largeBow          (B3)  same single circle
     *   smallCrossbow     (B4)  bar + one circle = reload after each shot
     *   repeatingCrossbow (B5)  bar = reloading; once it is full, one circle
     *                           per arrow in the box (10), and they drop away
     *                           as you fire
     *   largeCrossbow     (B6)  bar + one circle = reload, both full when loaded
     *
     * State comes from the bow object itself: fireAmount01 / arrowCount /
     * nextArrowTimer, lastFireTime + getArrowReadyMs(), loadedArrowCount +
     * loadingOrShootingState, loadAmount01. Only shown while you are alive
     * and not a spectator.
     */
    var GREEN = '#7dff7d', DIM = 'rgba(255,255,255,.25)';
    var chargeEl = null, chargeBar = null, chargeFill = null, chargePips = null, pipEls = [];
    function ensureChargeEl() {
      if (chargeEl && chargeEl.isConnected) return;
      chargeEl = document.createElement('div');
      chargeEl.style.cssText = 'position:fixed;left:50%;top:calc(50% + 34px);width:64px;transform:translateX(-50%);' +
        'display:none;flex-direction:column;align-items:center;gap:4px;pointer-events:none;z-index:150;';
      chargeBar = document.createElement('div');
      chargeBar.style.cssText = 'width:64px;height:6px;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.55);border-radius:4px;';
      chargeFill = document.createElement('div');
      chargeFill.style.cssText = 'height:100%;width:0;background:#fff;border-radius:3px;';
      chargeBar.appendChild(chargeFill);
      chargePips = document.createElement('div');
      chargePips.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:center;gap:4px;width:110px;';
      chargeEl.appendChild(chargeBar); chargeEl.appendChild(chargePips);
      document.body.appendChild(chargeEl);
      pipEls = [];
    }
    function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

    /** view = { bar: 0..1 | null, pips: n, lit: whole pips lit, part: 0..1 fill of the next pip } */
    function drawCharge(view) {
      ensureChargeEl();
      chargeBar.style.display = view.bar === null ? 'none' : 'block';
      if (view.bar !== null) {
        chargeFill.style.width = clamp01(view.bar) * 100 + '%';
        chargeFill.style.background = view.bar >= 0.999 ? GREEN : '#fff';
      }
      while (pipEls.length < view.pips) {
        var p = document.createElement('div');
        p.style.cssText = 'width:10px;height:10px;border-radius:50%;border:1px solid rgba(255,255,255,.7);';
        chargePips.appendChild(p); pipEls.push(p);
      }
      while (pipEls.length > view.pips) chargePips.removeChild(pipEls.pop());
      for (var i = 0; i < pipEls.length; i++) {
        var f = i < view.lit ? 1 : (i === view.lit ? clamp01(view.part) : 0);
        pipEls[i].style.background = f >= 0.999 ? GREEN :
          (f > 0 ? 'conic-gradient(' + GREEN + ' ' + f * 360 + 'deg,' + DIM + ' 0)' : DIM);
      }
      chargeEl.style.display = 'flex';
    }

    function chargeView(w) {
      var type = w.bowWeaponTypeId;
      var g = findGame(), now = g && g.now;
      switch (type) {
        case 'mediumBow': case 'largeBow':
          if (typeof w.fireAmount01 !== 'number' || w.fireAmount01 <= 0.001) return null;
          return { bar: null, pips: 1, lit: 0, part: w.fireAmount01 };

        case 'smallCrossbow': {
          if (typeof w.getArrowReadyMs !== 'function' || typeof now !== 'number') return null;
          var ready = w.getArrowReadyMs(), since = now - w.lastFireTime;
          if (!(since >= 0 && since < ready)) return null;
          return { bar: since / ready, pips: 1, lit: 0, part: 0, reload: 1 };
        }

        case 'largeCrossbow': {
          if (typeof w.loadAmount01 !== 'number' || w.loadAmount01 >= 1) return null;
          return { bar: w.loadAmount01, pips: 1, lit: 0, part: 0, reload: 1 };
        }

        case 'repeatingCrossbow': {
          var n = Number(w.loadedArrowCount);
          if (!(n >= 0)) return null;
          if (w.loadingOrShootingState) return { bar: n / 10, pips: 0, lit: 0, part: 0 };
          if (n >= 10 && !w.actionIsDown) return null;
          return { bar: null, pips: 10, lit: n, part: 0 };
        }

        default:   // smallBow, or a bow added later that draws the same way
          if (typeof w.fireAmount01 !== 'number') return null;
          var c = Number(w.arrowCount) || 0;
          if (w.fireAmount01 <= 0.001 && c <= 1) return null;
          var full = w.fireAmount01 >= 0.999;
          return { bar: w.fireAmount01, pips: 3, lit: full ? c : 0, part: full ? w.nextArrowTimer : 0 };
      }
    }

    var lingerUntil = 0;
    function chargeTick() {
      var view = null;
      try {
        if (flagOn(CHARGE_KEY)) {
          var me = findPlayer();
          var w = me && !me.dead && !isSpectatorPlayer(me) ? me.activeWeapon : null;
          if (w) view = chargeView(w);
        }
      } catch (e) { view = null; }
      var t = Date.now();
      if (view && view.reload) lingerUntil = t + 350;
      else if (!view && t < lingerUntil) view = { bar: 1, pips: 1, lit: 1, part: 0 };   // crossbow just finished loading: show it full for a moment
      if (view) { try { drawCharge(view); } catch (e) {} }
      else if (chargeEl) chargeEl.style.display = 'none';
    }
    (function chargeLoop() {
      chargeTick();
      requestAnimationFrame(chargeLoop);
    })();

    /* ---- kill feed ---- */

    /**
     * The game hands the client no "X killed Y" event (player.die() takes no
     * killer), so this infers it from the scoreboard's own numbers: a player
     * going dead, paired with whoever's kill count went up around the same
     * moment. If nobody's count moved in time it reads "X died".
     */
    var feedEl = null;
    var feedState = { game: null, seen: new Map(), deaths: [], kills: [] };
    function ensureFeedEl() {
      if (feedEl && feedEl.isConnected) return;
      feedEl = document.createElement('div');
      feedEl.style.cssText = 'position:fixed;right:12px;top:45%;display:flex;flex-direction:column;' +
        'align-items:flex-end;gap:4px;pointer-events:none;z-index:150;font:600 14px sans-serif;';
      document.body.appendChild(feedEl);
    }
    function nameSpan(pl, colors) {
      var s = document.createElement('span');
      s.textContent = String(pl.playerName || 'Player');
      var c = colors[pl.teamId];
      s.style.color = c ? 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')' : '#fff';
      if (pl.hasOwnership) s.style.textDecoration = 'underline';
      return s;
    }
    function pushFeed(killer, victim, colors) {
      ensureFeedEl();
      var line = document.createElement('div');
      line.style.cssText = 'background:rgba(0,0,0,.5);color:#fff;padding:3px 8px;border-radius:5px;' +
        'text-shadow:0 1px 2px #000;transition:opacity .5s;';
      if (killer) {
        line.appendChild(nameSpan(killer, colors));
        line.appendChild(document.createTextNode(' → '));
      }
      line.appendChild(nameSpan(victim, colors));
      if (!killer) line.appendChild(document.createTextNode(' died'));
      feedEl.appendChild(line);
      while (feedEl.children.length > 5) feedEl.removeChild(feedEl.firstChild);
      setTimeout(function () { line.style.opacity = '0'; }, 6000);
      setTimeout(function () { if (line.parentNode) line.parentNode.removeChild(line); }, 6600);
    }

    function feedTick() {
      var ag = currentGame();
      if (!flagOn(FEED_KEY) || !ag) {
        feedState.game = null;
        if (feedEl) feedEl.style.display = 'none';
        return;
      }
      if (feedEl) feedEl.style.display = 'flex';
      var now = Date.now();
      if (feedState.game !== ag) feedState = { game: ag, seen: new Map(), deaths: [], kills: [] };

      ag.players.forEach(function (pl) {
        if (!pl || isSpectatorPlayer(pl)) return;
        var prev = feedState.seen.get(pl);
        var k = Number(pl.scoreKills) || 0, dead = !!pl.dead;
        if (prev) {
          if (!prev.dead && dead) feedState.deaths.push({ pl: pl, at: now });
          if (k > prev.kills) feedState.kills.push({ pl: pl, at: now });
        }
        feedState.seen.set(pl, { dead: dead, kills: k });
      });

      var colors = teamColorMap(ag);
      var st = feedState;
      st.deaths = st.deaths.filter(function (d) {
        var i = -1;
        for (var j = 0; j < st.kills.length; j++) { if (st.kills[j].pl !== d.pl) { i = j; break; } }
        if (i >= 0) { pushFeed(st.kills[i].pl, d.pl, colors); st.kills.splice(i, 1); return false; }
        if (now - d.at > 1500) { pushFeed(null, d.pl, colors); return false; }
        return true;
      });
      st.kills = st.kills.filter(function (x) { return now - x.at < 3000; });
    }
    setInterval(function () { try { feedTick(); } catch (e) {} }, 250);

    var camera = null, cameraTriedAt = 0;
    function findCamera() {
      if (camera && camera.projectionMatrix && camera.matrixWorldInverse) return camera;
      var now = Date.now();
      if (now - cameraTriedAt < 2000) return null;
      cameraTriedAt = now;
      var g = findGame();
      if (!g) return null;
      // the game's own camera first - po().cam.cam, the one named "cam" - and only
      // then fall back to hunting for any perspective camera (there is also a
      // small preview one that is not the view you are looking through)
      var direct = g.cam && g.cam.cam;
      if (direct && direct.isPerspectiveCamera === true) { camera = direct; return camera; }
      var hits = collectMatching(g, function (o) { return o.isPerspectiveCamera === true && (o.far || 0) > 100; }, 1);
      camera = hits.length ? hits[0] : null;
      return camera;
    }

    var tagsEl = null, tagEls = new Map();
    function tagLayer() {
      if (tagsEl && tagsEl.isConnected) return tagsEl;
      tagsEl = document.createElement('div');
      tagsEl.id = 'nss-tags';
      tagsEl.style.cssText = 'position:fixed; left:0; top:0; width:100%; height:100%; ' +
        'pointer-events:none; z-index:60; overflow:hidden;';
      document.body.appendChild(tagsEl);
      return tagsEl;
    }
    function hideAllTags() {
      tagEls.forEach(function (el) { el.style.display = 'none'; });
    }

    /** World position -> screen pixels, or null if it's behind the camera. */
    function toScreen(worldPos, cam, yOffset) {
      if (!worldPos || typeof worldPos.clone !== 'function') return null;
      var v = worldPos.clone();
      v.y += yOffset;
      v.project(cam);
      if (!(v.z > -1 && v.z < 1)) return null;
      if (Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) return null;
      return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight };
    }

    var TAG_HEIGHT = 2.2;   // roughly a head above where a player's position sits
    var SIGHT_POINTS = [1.7, 0.9];   // head and chest: seeing either one is seeing them

    /** Which walls stop an arrow - the game's own filter, so they stop sight too. */
    function blocksSight(hit) {
      var c = hit && hit.collider;
      return !!c && !c.ignoreArrows && !(c.excludeTeamId >= 0) &&
        !(typeof c.isTriggerCollider === 'function' && c.isTriggerCollider());
    }

    /** Clear line from your eye to the player? Fails closed if it can't tell. */
    function canSee(ag, cam, pl) {
      try {
        var physics = ag.physics;
        if (!physics || typeof physics.getRayCastCache !== 'function' ||
            typeof physics.rayCastMapColliders !== 'function') return false;
        if (!pl.pos || typeof pl.pos.clone !== 'function' || !cam.position) return false;

        var eye = cam.position.clone();
        if (typeof cam.getWorldPosition === 'function') cam.getWorldPosition(eye);

        for (var i = 0; i < SIGHT_POINTS.length; i++) {
          var target = pl.pos.clone();
          target.y += SIGHT_POINTS[i];
          var ray = physics.getRayCastCache(eye, target);
          if (!ray) return true;   // eye and target coincide - nothing between
          if (!physics.rayCastMapColliders(ray, blocksSight)) return true;
        }
        return false;
      } catch (e) { return false; }
    }

    (function tagLoop() {
      requestAnimationFrame(tagLoop);
      if (!tagsOn()) { if (tagsEl) hideAllTags(); return; }

      var ag = currentGame(), me = findPlayer(), cam = findCamera();
      if (!ag || !me || !cam) { hideAllTags(); return; }

      var layer = tagLayer();
      var seen = new Set();
      ag.players.forEach(function (pl) {
        if (!pl || pl === me || pl.dead || isSpectatorPlayer(pl)) return;
        var mate = pl.teamId === me.teamId;
        var pt = toScreen(pl.pos, cam, TAG_HEIGHT);
        if (!pt) return;
        if (!mate && !canSee(ag, cam, pl)) return;   // enemies only while actually visible
        seen.add(pl);
        var el = tagEls.get(pl);
        if (!el) {
          el = document.createElement('div');
          el.style.cssText = 'position:absolute; transform:translate(-50%,-100%); white-space:nowrap; ' +
            'font:700 13px system-ui,sans-serif; color:#fff; padding:1px 6px; border-radius:6px; ' +
            'background:' + (mate ? 'rgba(0,0,0,.35)' : 'rgba(150,20,20,.5)') + '; ' +
            'text-shadow:0 0 3px #000, 0 0 3px #000;';
          layer.appendChild(el);
          tagEls.set(pl, el);
        }
        if (el.textContent !== (pl.playerName || '')) el.textContent = pl.playerName || '';
        el.style.display = 'block';
        el.style.left = pt.x + 'px';
        el.style.top = pt.y + 'px';
      });
      tagEls.forEach(function (el, pl) {
        if (!seen.has(pl)) el.style.display = 'none';
      });
    })();

    /* ================================================================ *
     * FPS limit - a slider in the native Settings dialog
     *
     * The game paces itself off the browser's frame callback:
     *
     *   vsyncLoop() {
     *     if (this.frameCount++, this.frameCount % this.frameCap == 0) { this.loop() }
     *     window.requestAnimationFrame(this.boundLoop)
     *   }
     *
     * frameCap is a plain integer, 1 by default (it even reads a hidden
     * localStorage "frameCap" at startup). 1 means a game frame on every
     * browser frame; 2 means every other one, and so on - so a limit is that
     * divisor, and it can be changed live without a reload.
     *
     * "Uncapped" therefore means "as fast as your display refreshes" - the
     * browser hands out frames at the monitor's rate and nothing a page does
     * can produce more of them, so 60 Hz tops out at 60 and 144 Hz at 144.
     * ================================================================ */

    var CAP_KEY = 'narrowone.settingsstats.framecap';
    var MAX_DIVISOR = 8;
    function wantedCap() {
      try {
        var n = parseInt(localStorage.getItem(CAP_KEY), 10);
        return n >= 1 && n <= MAX_DIVISOR ? n : 1;
      } catch (e) { return 1; }
    }
    function saveCap(n) {
      try { localStorage.setItem(CAP_KEY, String(n)); } catch (e) {}
      applyCap();
    }

    /** Push the chosen divisor into the running game. Cheap, so also polled. */
    function applyCap() {
      var g = findGame();
      var n = wantedCap();
      if (g && typeof g.frameCap === 'number' && g.frameCap !== n) g.frameCap = n;
    }
    setInterval(applyCap, 1000);

    /**
     * The display's refresh rate, worked out from how fast the browser is
     * actually handing out frames - the best rate ever seen, since a busy
     * frame only ever makes it look slower, then snapped to the usual
     * monitor rates so a hiccup doesn't turn 60 into 57.
     */
    var peakFps = 0;
    var COMMON_HZ = [30, 48, 50, 60, 75, 90, 100, 120, 144, 165, 180, 240, 360];
    function refreshHz() {
      var best = peakFps || 60;
      var pick = best;
      COMMON_HZ.forEach(function (hz) {
        if (Math.abs(hz - best) / hz < 0.06) pick = hz;
      });
      return pick;
    }

    function capLabel(n) {
      var hz = refreshHz();
      return n === 1 ? 'Uncapped (' + hz + ' fps, your display\'s rate)' : Math.round(hz / n) + ' fps';
    }

    /** A native-looking slider row, added under "Quality". Right end = uncapped. */
    function addFpsOption(dialog) {
      if (dialog.querySelector('[data-nss-fps]')) return;
      var anchor = null;
      dialog.querySelectorAll('.settings-item').forEach(function (row) {
        var t = row.querySelector('.settings-item-text');
        if (t && t.textContent.trim() === 'Quality') anchor = row;
      });
      if (!anchor) return;

      var row = document.createElement('label');
      row.className = 'settings-item';
      row.dataset.nssFps = '1';
      var text = document.createElement('div');
      text.className = 'settings-item-text';
      text.textContent = 'FPS limit';
      row.appendChild(text);

      var wrap = document.createElement('div');
      wrap.className = 'settings-item-slider';
      var input = document.createElement('input');
      input.className = 'dialog-range-input';
      input.type = 'range'; input.min = 1; input.max = MAX_DIVISOR; input.step = 1;
      // slider position 1..8 <-> divisor 8..1, so dragging right raises the limit
      input.value = MAX_DIVISOR + 1 - wantedCap();
      var val = document.createElement('div');
      val.className = 'settings-item-slider-value';
      val.textContent = capLabel(wantedCap());
      input.addEventListener('input', function () {
        var n = MAX_DIVISOR + 1 - Number(input.value);
        val.textContent = capLabel(n);
        saveCap(n);
      });
      wrap.appendChild(input); wrap.appendChild(val); row.appendChild(wrap);
      anchor.parentNode.insertBefore(row, anchor.nextSibling);
    }

    var dialogWatcher = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        Array.prototype.forEach.call(m.addedNodes, function (node) {
          if (!node || node.nodeType !== 1 || !node.classList || !node.classList.contains('dialog')) return;
          // Settle a tick - some dialogs finish building their rows just after insertion.
          setTimeout(function () {
            widenSettingsDialog(node);
            addNameTagOption(node);
            addFeedAndChargeOptions(node);
            addFpsOption(node);
            enrichProfileDialog(node);
          }, 0);
        });
      });
    });

    function watchGameDialogs() {
      var host = document.getElementById('gameWrapper') || document.body;
      dialogWatcher.observe(host, { childList: true });
    }

    /* ================================================================ *
     * 2b. Session totals, carried across matches
     * ================================================================ */

    var session = { kills: 0, deaths: 0, flags: 0, matches: 1 };
    var baseline = null;
    var sawHealthBar = !!document.querySelector('.health-ui-bar-container');

    function loadSession() {
      try {
        var raw = localStorage.getItem(STORE_KEY);
        if (raw) {
          var saved = JSON.parse(raw);
          if (saved && typeof saved === 'object') session = saved;
        }
      } catch (e) {}
    }
    function saveSession() {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(session)); } catch (e) {}
    }
    loadSession();
    var SESSION_IDLE_MS = 2 * 3600 * 1000;   // untouched this long = a new session
    if (session.last && Date.now() - session.last > SESSION_IDLE_MS) {
      session = { kills: 0, deaths: 0, flags: 0, matches: 1 };
      saveSession();
    }
    function endSession() {
      session = { kills: 0, deaths: 0, flags: 0, matches: 1, last: Date.now() };
      baseline = null;
      saveSession();
    }

    function bankCurrentMatch() {
      var p = findPlayer();
      if (!p || !baseline) return;
      session.kills += Math.max(0, (p.scoreKills || 0) - baseline.kills);
      session.deaths += Math.max(0, (p.scoreDeaths || 0) - baseline.deaths);
      session.flags += Math.max(0, (p.scoreFlags || 0) - baseline.flags);
      saveSession();
    }

    function liveSessionTotals() {
      var p = findPlayer();
      var mk = 0, md = 0, mf = 0;
      if (p && baseline) {
        mk = Math.max(0, (p.scoreKills || 0) - baseline.kills);
        md = Math.max(0, (p.scoreDeaths || 0) - baseline.deaths);
        mf = Math.max(0, (p.scoreFlags || 0) - baseline.flags);
      }
      return { kills: session.kills + mk, deaths: session.deaths + md, flags: session.flags + mf };
    }

    /**
     * A new match is a new game object, so that - not a CSS class showing up
     * in the page - is what marks the boundary. Each tick remembers your last
     * seen score; when the game object changes, that last score (minus where
     * you started) is banked into the session before anything resets.
     */
    var trackedGame = null;
    var lastSeen = null;
    setInterval(function () {
      var ag = currentGame();
      var p = findPlayer();

      if (ag !== trackedGame) {
        if (trackedGame && baseline && lastSeen) {
          session.kills += Math.max(0, lastSeen.kills - baseline.kills);
          session.deaths += Math.max(0, lastSeen.deaths - baseline.deaths);
          session.flags += Math.max(0, lastSeen.flags - baseline.flags);
          if (ag) session.matches++;
          saveSession();
        }
        trackedGame = ag;
        baseline = null;
        lastSeen = null;
      }

      if (p) {
        var now = { kills: p.scoreKills || 0, deaths: p.scoreDeaths || 0, flags: p.scoreFlags || 0 };
        if (!baseline) baseline = now;
        lastSeen = now;
        if (Date.now() - (session.last || 0) > 60000) { session.last = Date.now(); saveSession(); }
      }
    }, 500);

    /* ================================================================ *
     * 2c. Hold Tab -> a small live-stats panel, exactly as long as the
     * scoreboard itself is up.
     * ================================================================ */

    var fps = 0;
    /** Frames the GAME actually runs: the browser's rate divided by the cap. */
    function gameFps() {
      var g = findGame();
      var cap = g && typeof g.frameCap === 'number' && g.frameCap > 0 ? g.frameCap : 1;
      return Math.round(fps / cap);
    }
    (function fpsLoop() {
      var windowStart = performance.now(), frames = 0;
      function tick(now) {
        requestAnimationFrame(tick);
        frames++;
        if (now - windowStart >= 500) {
          fps = Math.round((frames * 1000) / (now - windowStart));
          if (fps > peakFps) peakFps = fps;
          frames = 0; windowStart = now;
        }
      }
      requestAnimationFrame(tick);
    })();

    var panelEl = null;

    var CSS = [
      // The game's own HUD/dialogs run up to z-index 110 (its topmost menu
      // toggle) - this has to clear all of that or it renders invisibly
      // behind it.
      '#nss-panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 200; ' +
        'display: flex; gap: 22px; align-items: flex-start; ' +
        'background: rgba(15,15,20,.72); color: #fff; padding: 14px 20px; border-radius: 12px; ' +
        'font: 600 13px system-ui, sans-serif; pointer-events: none; max-height: 90vh; overflow: hidden; }',
      '#nss-panel .nss-col { min-width: 170px; }',
      '#nss-panel .nss-players { min-width: 340px; }',
      '#nss-panel .nss-row { display:flex; justify-content:space-between; gap: 16px; padding: 2px 0; }',
      '#nss-panel .nss-row span { opacity: .6; font-weight: 400; }',
      '#nss-panel .nss-head { opacity: .5; font-size: 11px; text-transform: uppercase; ' +
        'letter-spacing: .04em; margin: 8px 0 2px; }',
      '#nss-panel .nss-head:first-child { margin-top: 0; }',
      '#nss-panel table { border-collapse: collapse; width: 100%; }',
      '#nss-panel th { opacity: .5; font-weight: 400; font-size: 11px; text-align: right; padding: 2px 6px; }',
      '#nss-panel th:first-child, #nss-panel td:first-child { text-align: left; }',
      '#nss-panel td { text-align: right; padding: 2px 6px; }',
      '#nss-panel tr.nss-me td { background: rgba(255,255,255,.14); }',
      '#nss-panel .nss-av { display:inline-block; width:22px; height:22px; margin-right:8px; ' +
        'vertical-align:middle; border-radius:50%; background: rgba(255,255,255,.15) center/cover no-repeat; }',
      '#nss-panel tr.nss-team td { opacity: .5; font-size: 11px; text-transform: uppercase; ' +
        'letter-spacing: .04em; text-align: left; padding-top: 8px; }',
      // While this panel is up it stands in for the game's own scoreboard.
      'body.nss-replacing .dialog:has(.playersListContainer) { display: none !important; }'
    ].join('\n');

    /**
     * Every grey panel in the game - dialogs, profile rows, the health
     * bar's backing - is a .wrinkledPaper whose fill comes from one CSS
     * variable, and the theme just swaps that variable's value:
     *
     *   html.theme-dark  { --default-ui-bg-color: #454545; ... }
     *   (light)          { --default-ui-bg-color: white;   ... }
     *
     * so swapping it and its two siblings for a half-strength dark tint (visible, not black - the game still shows through) tints them all at once,
     * borders and all left alone so panels still read as panels. Text is
     * forced white with a dark halo since it now sits on the raw game view.
     * Sliders, checkboxes and text boxes are also .wrinkledPaper and would
     * vanish entirely, so they keep a faint fill.
     */
    var TRANSPARENT_CSS = [
      'html, html.theme-dark, html.theme-light, :root {',
      '  --default-ui-bg-color: rgba(22,22,28,.5) !important;',
      '  --secondary-ui-bg-color: rgba(40,40,48,.5) !important;',
      '  --container-ui-bg-color: rgba(55,55,64,.5) !important;',
      '  --default-text-color: #fff !important;',
      '}',
      '.dialog, .dialog * { text-shadow: 0 0 3px rgba(0,0,0,.95), 0 0 6px rgba(0,0,0,.7); }',
      // The weapon-switch bar is in-match gameplay UI, not a menu - it keeps
      // the game's own colours (the values the theme would have set).
      'html.theme-dark .weapon-selection-dialog {',
      '  --default-ui-bg-color: #454545 !important; --secondary-ui-bg-color: #5d5d5d !important;',
      '  --container-ui-bg-color: #646464 !important; --default-text-color: #fff !important;',
      '}',
      'html:not(.theme-dark) .weapon-selection-dialog {',
      '  --default-ui-bg-color: #fff !important; --secondary-ui-bg-color: #e1e1e1 !important;',
      '  --container-ui-bg-color: #f1f1f1 !important; --default-text-color: #000 !important;',
      '}',
      '.weapon-selection-dialog, .weapon-selection-dialog * { text-shadow: none !important; }',
      'input.dialog-range-input[type=range], input.dialog-range-input[type=range]::-webkit-slider-thumb,',
      '.dialog-text-input, .dialog-checkbox-input {',
      '  --wrinkled-paper-color: rgba(140,140,140,.55) !important;',
      '}'
    ].join('\n');

    (function injectStyle() {
      if (document.getElementById('nss-style')) return;
      var el = document.createElement('style');
      el.id = 'nss-style';
      el.textContent = CSS;
      (document.head || document.documentElement).appendChild(el);
    })();

    var TRANSPARENT_KEY = 'narrowone.settingsstats.transparent';
    function transparentUiWanted() {
      try { return localStorage.getItem(TRANSPARENT_KEY) !== '0'; } catch (e) { return true; }
    }
    function setTransparentUi(on) {
      try { localStorage.setItem(TRANSPARENT_KEY, on ? '1' : '0'); } catch (e) {}
      var el = document.getElementById('nss-transparent-style');
      if (on && !el) {
        el = document.createElement('style');
        el.id = 'nss-transparent-style';
        el.textContent = TRANSPARENT_CSS;
        (document.head || document.documentElement).appendChild(el);
      } else if (!on && el) {
        el.remove();
      }
    }
    setTransparentUi(transparentUiWanted());

    function panelRow(label, value) {
      return '<div class="nss-row"><span>' + label + '</span><b>' + value + '</b></div>';
    }
    function esc(s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }

    function showPanel() {
      if (panelEl) return;
      panelEl = document.createElement('div');
      panelEl.id = 'nss-panel';
      document.body.appendChild(panelEl);
      document.body.classList.add('nss-replacing');
      renderPanel();
    }
    function hidePanel() {
      document.body.classList.remove('nss-replacing');
      if (panelEl) { panelEl.remove(); panelEl = null; }
    }

    /** The scoreboard's own job, so hiding the native one loses nothing. */
    /**
     * Team ids are just numbers; the game's own table of team colours is a
     * module constant that isn't reachable. What IS reachable is the colour
     * of YOUR team:
     *
     *   getMyTeamColor() { ... return { colors: A[teamId], myTeamId } }
     *
     * so your team is named from that colour (more red than blue -> Red),
     * and in a two-team game the other one is simply the opposite. With any
     * other number of teams there's nothing to infer, so it stays "Team N".
     */
    function parseRgb(css) {
      css = String(css || '').trim();
      var m = /^#([0-9a-f]{6})$/i.exec(css);
      if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
      m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(css);
      if (m) return [+m[1], +m[2], +m[3]];
      m = /hsla?\(\s*([\d.]+)[ ,]+([\d.]+)%[ ,]+([\d.]+)%/i.exec(css);
      if (m) {
        var h = (+m[1] % 360) / 360, s = +m[2] / 100, l = +m[3] / 100;
        var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
        var f = function (t) {
          t = (t + 1) % 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
        };
        return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
      }
      return null;
    }

    /**
     * Name each team from its real colour - the scoreboard's own per-team
     * elements carry it, so this works for red/blue/green alike and for any
     * number of teams. If those can't be read it falls back to naming your
     * own team from getMyTeamColor() and calling the other one the opposite.
     */
    function teamNamer(teamIds) {
      var names = {};
      try {
        var ag = currentGame();
        var colors = ag ? teamColorMap(ag) : {};
        teamIds.forEach(function (id) {
          var n = colors[id] && colorName(colors[id]);
          if (n) names[id] = n + ' team';
        });

        if (teamIds.some(function (id) { return !names[id]; }) && teamIds.length === 2) {
          var g = findGame();
          var mine = g && g.gameManager && g.gameManager.getMyTeamColor && g.gameManager.getMyTeamColor();
          var rgb = mine && mine.colors && parseRgb(mine.colors.cssColor);
          if (rgb) {
            var myName = rgb[0] > rgb[2] ? 'Red team' : 'Blue team';
            var other = myName === 'Red team' ? 'Blue team' : 'Red team';
            teamIds.forEach(function (id) { names[id] = (id === mine.myTeamId) ? myName : other; });
          }
        }
      } catch (e) {}
      return function (id) { return names[id] || ('Team ' + id); };
    }

    /**
     * Each player's small avatar, the same picture the scoreboard shows:
     *
     *   e.getSmallAvatar().getBlobUrlReference()  ->  .getBlobUrl()  (async)
     *
     * The url is only good while its reference is alive, so references are
     * kept per player rather than released after one render.
     */
    var AVATAR_REFRESH_MS = 7000;   // re-fetched this often while the panel is up
    var avatarCache = new WeakMap();

    /**
     * Fetching once and keeping it forever meant a picture that hadn't loaded
     * yet, or that a player later changed, never changed on the scoreboard.
     * Now each entry is re-fetched once it's a few seconds old - on demand,
     * only while the panel is actually showing, so there's no background
     * work. The new picture is swapped in only once it has loaded (no flash
     * of blank), and the old reference is released afterwards, the way the
     * game's own scoreboard releases its own.
     */
    function loadAvatar(pl, entry) {
      entry.fetchedAt = Date.now();
      try {
        var fresh = pl.getSmallAvatar().getBlobUrlReference();
        Promise.resolve(fresh.getBlobUrl()).then(function (u) {
          var old = entry.ref;
          entry.url = u;
          entry.ref = fresh;
          if (old && old !== fresh && typeof old.destructor === 'function') {
            try { old.destructor(); } catch (e) {}
          }
        }).catch(function () {});
      } catch (e) {}
    }

    function avatarStyle(pl) {
      var entry = avatarCache.get(pl);
      if (!entry) {
        entry = { url: null, ref: null, fetchedAt: 0 };
        avatarCache.set(pl, entry);
        loadAvatar(pl, entry);
      } else if (Date.now() - entry.fetchedAt > AVATAR_REFRESH_MS) {
        loadAvatar(pl, entry);
      }
      return entry.url ? ' style="background-image:url(&quot;' + entry.url + '&quot;)"' : '';
    }

    function playersTable() {
      var ag = currentGame();
      if (!ag) return '<div class="nss-row"><span>No players yet</span></div>';

      var list = [];
      ag.players.forEach(function (pl) { if (pl && typeof pl === 'object') list.push(pl); });
      list.sort(function (a, b) {
        return (isSpectatorPlayer(a) - isSpectatorPlayer(b)) ||   // spectators last
          (a.teamId - b.teamId) || ((b.scoreTotal || 0) - (a.scoreTotal || 0));
      });
      var ids = [];
      list.forEach(function (pl) {
        if (!isSpectatorPlayer(pl) && ids.indexOf(pl.teamId) === -1) ids.push(pl.teamId);
      });
      var nameOf = teamNamer(ids);

      var html = '<table><tr><th>Player</th><th>Kills</th><th>Deaths</th><th>K/D</th><th>Flags</th><th>Score</th></tr>';
      var lastGroup = null;
      list.forEach(function (pl) {
        var spec = isSpectatorPlayer(pl);
        var group = spec ? 'spectators' : 't' + pl.teamId;
        if (group !== lastGroup) {
          lastGroup = group;
          html += '<tr class="nss-team"><td colspan="6">' + esc(spec ? 'Spectators' : nameOf(pl.teamId)) + '</td></tr>';
        }
        var k = pl.scoreKills || 0, d = pl.scoreDeaths || 0;
        html += '<tr' + (pl.hasOwnership ? ' class="nss-me"' : '') +
          '><td><span class="nss-av"' + avatarStyle(pl) + '></span>' + esc(pl.playerName || '-') +
          '</td><td>' + k + '</td><td>' + d + '</td><td>' + (d > 0 ? (k / d).toFixed(2) : k.toFixed(2)) +
          '</td><td>' + (pl.scoreFlags || 0) + '</td><td>' + (pl.scoreTotal || 0) + '</td></tr>';
      });
      return html + '</table>';
    }

    function renderPanel() {
      if (!panelEl) return;
      var p = findPlayer();
      var html = '<div class="nss-col nss-players"><div class="nss-head">Players</div>' + playersTable() + '</div>';

      html += '<div class="nss-col">';
      if (p) {
        var kills = p.scoreKills || 0, deaths = p.scoreDeaths || 0;
        var kd = deaths > 0 ? (kills / deaths).toFixed(2) : (kills > 0 ? kills.toFixed(2) : '0.00');
        html += '<div class="nss-head">This match</div>';
        html += panelRow('Kills', kills) + panelRow('Deaths', deaths) +
          panelRow('Flags', p.scoreFlags || 0) + panelRow('K/D', kd) +
          panelRow('Ping', Math.round(p.ping || 0) + 'ms') + panelRow('FPS', gameFps());
      } else {
        html += '<div class="nss-head">This match</div><div class="nss-row"><span>Not in a match</span></div>';
      }

      var breakdown = pointBreakdown();
      if (breakdown.length) {
        html += '<div class="nss-head">Points</div>';
        breakdown.forEach(function (row) { html += panelRow(row[0], row[1]); });
      }

      var totals = liveSessionTotals();
      var sKd = totals.deaths > 0 ? (totals.kills / totals.deaths).toFixed(2) :
        (totals.kills > 0 ? totals.kills.toFixed(2) : '0.00');
      html += '<div class="nss-head">Session (' + session.matches + ' match' +
        (session.matches === 1 ? '' : 'es') + ')</div>';
      html += panelRow('Kills', totals.kills) + panelRow('Deaths', totals.deaths) +
        panelRow('K/D', sKd);

      // Zero/blank until the server actually sends round-end rewards - a
      // number here before then would just be last round's, or made up.
      var coins = coinsEarned();
      html += '<div class="nss-head">Coins</div>' +
        panelRow('This round', coins > 0 ? coins : '-');
      html += '</div>';

      panelEl.innerHTML = html;
    }
    setInterval(function () { if (panelEl) renderPanel(); }, 400);

    /** Hook the game's own Tab binding the moment the game exists. */
    var hooked = false;
    function hookTabPanel() {
      if (hooked) return;
      var g = findGame();
      var key = g && g.input && typeof g.input.getKey === 'function' ? g.input.getKey('playerList') : null;
      if (!key) return;
      key.onPressedDown(showPanel);
      key.onPressedUp(hidePanel);
      hooked = true;
    }
    setInterval(hookTabPanel, 500);

    watchGameDialogs();

    PAGE.NarrowSettingsStats = window.NarrowSettingsStats = {
      get player() { return findPlayer(); },
      get session() { return session; },
      resetSession: function () { endSession(); },
      transparentUi: setTransparentUi,
      patchState: patchState
    };

    console.log('[Settings & Stats] ready. Patched copy in cache:', patchState.patched);
  });
})();
