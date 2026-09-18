// ==UserScript==
// @name         Settings & Stats
// @namespace    narrowone-settings-stats
// @version      2.0.1
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

    var player = null;
    function findPlayer() {
      if (player && player.hasOwnership) return player;
      var g = findGame();
      if (!g) return null;
      var hits = collectMatching(g, function (o) { return hasScores(o) && o.hasOwnership === true; }, 1);
      player = hits.length ? hits[0] : null;
      return player;
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

    var dialogWatcher = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        Array.prototype.forEach.call(m.addedNodes, function (node) {
          if (!node || node.nodeType !== 1 || !node.classList || !node.classList.contains('dialog')) return;
          // Settle a tick - some dialogs finish building their rows just after insertion.
          setTimeout(function () {
            widenSettingsDialog(node);
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

    setInterval(function () {
      var inMatch = !!document.querySelector('.health-ui-bar-container');
      if (inMatch && !sawHealthBar) {
        bankCurrentMatch();
        session.matches++;
        player = null;
        baseline = null;
        saveSession();
      }
      sawHealthBar = inMatch;

      if (inMatch && !baseline) {
        var p = findPlayer();
        if (p) baseline = { kills: p.scoreKills || 0, deaths: p.scoreDeaths || 0, flags: p.scoreFlags || 0 };
      }
    }, 500);

    /* ================================================================ *
     * 2c. Hold Tab -> a small live-stats panel, exactly as long as the
     * scoreboard itself is up.
     * ================================================================ */

    var fps = 0;
    (function fpsLoop() {
      var windowStart = performance.now(), frames = 0;
      function tick(now) {
        requestAnimationFrame(tick);
        frames++;
        if (now - windowStart >= 500) {
          fps = Math.round((frames * 1000) / (now - windowStart));
          frames = 0; windowStart = now;
        }
      }
      requestAnimationFrame(tick);
    })();

    var panelEl = null;

    var CSS = [
      '#nss-panel { position: fixed; top: 16px; right: 16px; z-index: 60; ' +
        'background: rgba(15,15,20,.72); color: #fff; padding: 10px 16px; border-radius: 10px; ' +
        'font: 600 13px system-ui, sans-serif; pointer-events: none; min-width: 150px; }',
      '#nss-panel .nss-row { display:flex; justify-content:space-between; gap: 16px; padding: 2px 0; }',
      '#nss-panel .nss-row span { opacity: .6; font-weight: 400; }',
      '#nss-panel .nss-head { opacity: .5; font-size: 11px; text-transform: uppercase; ' +
        'letter-spacing: .04em; margin: 6px 0 2px; }',
      '#nss-panel .nss-head:first-child { margin-top: 0; }'
    ].join('\n');

    (function injectStyle() {
      if (document.getElementById('nss-style')) return;
      var el = document.createElement('style');
      el.id = 'nss-style';
      el.textContent = CSS;
      (document.head || document.documentElement).appendChild(el);
    })();

    function panelRow(label, value) {
      return '<div class="nss-row"><span>' + label + '</span><b>' + value + '</b></div>';
    }

    function showPanel() {
      if (panelEl) return;
      panelEl = document.createElement('div');
      panelEl.id = 'nss-panel';
      document.body.appendChild(panelEl);
      renderPanel();
    }
    function hidePanel() {
      if (panelEl) { panelEl.remove(); panelEl = null; }
    }
    function renderPanel() {
      if (!panelEl) return;
      var p = findPlayer();
      var html = '';
      if (p) {
        var kills = p.scoreKills || 0, deaths = p.scoreDeaths || 0;
        var kd = deaths > 0 ? (kills / deaths).toFixed(2) : (kills > 0 ? kills.toFixed(2) : '0.00');
        html += '<div class="nss-head">This match</div>';
        html += panelRow('Kills', kills) + panelRow('Deaths', deaths) +
          panelRow('Flags', p.scoreFlags || 0) + panelRow('K/D', kd) +
          panelRow('Ping', Math.round(p.ping || 0) + 'ms') + panelRow('FPS', fps);
      } else {
        html += '<div class="nss-head">This match</div><div class="nss-row"><span>Not in a match</span></div>';
      }
      var totals = liveSessionTotals();
      var sKd = totals.deaths > 0 ? (totals.kills / totals.deaths).toFixed(2) :
        (totals.kills > 0 ? totals.kills.toFixed(2) : '0.00');
      html += '<div class="nss-head">Session (' + session.matches + ' match' +
        (session.matches === 1 ? '' : 'es') + ')</div>';
      html += panelRow('Kills', totals.kills) + panelRow('Deaths', totals.deaths) +
        panelRow('K/D', sKd);
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
      resetSession: function () {
        session = { kills: 0, deaths: 0, flags: 0, matches: 1 };
        baseline = null;
        saveSession();
      },
      patchState: patchState
    };

    console.log('[Settings & Stats] ready. Patched copy in cache:', patchState.patched);
  });
})();
