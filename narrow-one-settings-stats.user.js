// ==UserScript==
// @name         Settings & Stats
// @namespace    narrowone-settings-stats
// @version      1.0.0
// @description  Wider ranges on FOV, sensitivity, crosshair offset, UI scale and quality than the native sliders allow, plus a live stats panel (K/D, flags, elo, ping, fps) that carries totals across matches. Adds a Settings & Stats tab to the main menu.
// @author       Frogwagon
// @match        https://narrow.one/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

/*
 * Settings & Stats  -  Narrow One
 * ---------------------------------
 * Two things that don't share a mechanism, sharing a tab because they're
 * both "more of what the game already has".
 *
 * 1. Extended settings. Every setting the game has already gets a slider in
 *    its own Settings dialog - there is nothing hidden to unlock. What IS
 *    true is that the dialog's sliders cap out well short of what the
 *    underlying value will actually accept:
 *
 *      setValue(id, value) {
 *        this.currentValues.set(id, value);
 *        this.fireValueChange(id, value);
 *        this.saveSettings();
 *      }
 *
 *    No clamping at all - the slider's min/max is a UI decision, not a
 *    stored limit. FOV, mouse sensitivity, crosshair accuracy offset, UI
 *    scale and render quality all get a second slider here with a wider
 *    range, writing through that exact same call. Same setting, same
 *    storage, same persistence - just more room on the dial.
 *
 * 2. Stats. The game shows one line - ping and fps - behind a single
 *    toggle. Your player object already carries more than that every
 *    match (from the server's own score updates):
 *
 *      setScores({scores: t, elo: e}) {
 *        const {flags, kills, deaths, total} = t;
 *        this.scoreFlags = flags; this.scoreKills = kills;
 *        this.scoreDeaths = deaths; this.scoreTotal = total;
 *        this.elo = e;
 *      }
 *
 *    This tab shows all of it live, plus a running total that carries
 *    across matches until you reset it - the same "a run outlives a match"
 *    approach 1 Kill = 1 Stat Point uses for kills.
 *
 * Reaching the settings manager and your player object both need the same
 * one-line bundle patch 1 Kill = 1 Stat Point uses. See that mod's header
 * for the full reasoning. The patch is idempotent, so it's safe to have
 * multiple mods apply it - whichever loads first does the actual write.
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
   * po().settingsManager and your own player object.
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

    var STORE_KEY = 'narrowone.settingsstats.v1';

    /* ---- finding your own player, same shape as 1 Kill = 1 Stat Point ---- */

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

    function hasScores(o) { return Object.prototype.hasOwnProperty.call(o, 'scoreKills'); }

    var player = null;

    function findPlayer() {
      if (player && player.hasOwnership) return player;
      var g = findGame();
      if (!g) return null;
      var hits = collectMatching(g, function (o) {
        return hasScores(o) && o.hasOwnership === true;
      }, 1);
      player = hits.length ? hits[0].o : null;
      return player;
    }

    function findSettings() {
      var g = findGame();
      return (g && g.settingsManager && typeof g.settingsManager.getValue === 'function')
        ? g.settingsManager : null;
    }

    /* ---- extended settings ---- */

    // Real native min/max/default, straight from the bundle's own dialog
    // and defaultValues object - the "native" figures shown under each
    // slider here, not a guess.
    var SETTINGS = [
      { id: 'fov', label: 'Field of view', def: 90, nativeMin: 40, nativeMax: 140, min: 20, max: 170, step: 1 },
      { id: 'mouseSensitivity', label: 'Mouse sensitivity', def: 1, nativeMin: 0.1, nativeMax: 5, min: 0.05, max: 10, step: 0.01 },
      { id: 'crosshairAccuracyOffset', label: 'Crosshair accuracy offset', def: 1, nativeMin: 0, nativeMax: 4, min: 0, max: 10, step: 0.1 },
      { id: 'uiScale', label: 'UI scale', def: 1, nativeMin: 0.5, nativeMax: 2, min: 0.3, max: 3, step: 0.05 },
      { id: 'quality', label: 'Render quality', def: 1, nativeMin: 0.1, nativeMax: 3, min: 0.1, max: 5, step: 0.1 }
    ];

    /* ---- stats - live plus a run that carries across matches ---- */

    var session = { kills: 0, deaths: 0, flags: 0, matches: 1 };
    var baseline = null;   // {kills, deaths, flags} at the start of the current match
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

    function resetSession() {
      session = { kills: 0, deaths: 0, flags: 0, matches: 1 };
      baseline = null;
      saveSession();
    }

    /** Bank whatever the match-in-progress contributed, ready for a new one. */
    function bankCurrentMatch() {
      var p = findPlayer();
      if (!p || !baseline) return;
      session.kills += Math.max(0, (p.scoreKills || 0) - baseline.kills);
      session.deaths += Math.max(0, (p.scoreDeaths || 0) - baseline.deaths);
      session.flags += Math.max(0, (p.scoreFlags || 0) - baseline.flags);
      saveSession();
    }

    setInterval(function () {
      var inMatch = !!document.querySelector('.health-ui-bar-container');
      if (inMatch && !sawHealthBar) {
        bankCurrentMatch();
        session.matches++;
        player = null;               // last match's player object is stale
        baseline = null;
        saveSession();
      }
      sawHealthBar = inMatch;

      if (inMatch && !baseline) {
        var p = findPlayer();
        if (p) baseline = { kills: p.scoreKills || 0, deaths: p.scoreDeaths || 0, flags: p.scoreFlags || 0 };
      }
    }, 500);

    /** This match's contribution on top of the banked session total. */
    function liveTotals() {
      var p = findPlayer();
      var matchKills = 0, matchDeaths = 0, matchFlags = 0;
      if (p && baseline) {
        matchKills = Math.max(0, (p.scoreKills || 0) - baseline.kills);
        matchDeaths = Math.max(0, (p.scoreDeaths || 0) - baseline.deaths);
        matchFlags = Math.max(0, (p.scoreFlags || 0) - baseline.flags);
      }
      return {
        kills: session.kills + matchKills,
        deaths: session.deaths + matchDeaths,
        flags: session.flags + matchFlags
      };
    }

    /* ---- fps, computed locally - not something the bundle exposes as a number ---- */

    var fps = 0;
    (function fpsLoop() {
      var last = performance.now(), frames = 0, windowStart = last;
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

    /* ================================================================ *
     * Look and feel
     * ================================================================ */

    var ICON = '<svg viewBox="0 0 101 104" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M50 6 L90 26 L90 58 C90 80 72 92 50 98 C28 92 10 80 10 58 L10 26 Z" ' +
      'fill="none" stroke="black" stroke-width="7"/>' +
      '<path d="M32 52 L45 65 L70 38" fill="none" stroke="black" stroke-width="8" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var ICON_URL = 'data:image/svg+xml,' + encodeURIComponent(ICON);

    function seed() { return Math.floor(Math.random() * 99999); }

    var CSS = [
      '#nss-dialog .nss-note { opacity: .6; margin: 2px 0 10px; }',
      '#nss-dialog .nss-native { opacity: .45; font-size: 11px; }',
      '#nss-dialog .nss-stat { display:flex; justify-content:space-between; gap:10px; ' +
        'padding:6px 0; border-bottom:1px solid rgba(0,0,0,.12); }',
      '#nss-dialog .nss-stat:last-child { border-bottom:none; }',
      '#nss-dialog .nss-stat b { font-size:16px; }',
      '#nss-dialog .nss-setup-row { display:flex; gap:8px; margin: 6px 0 4px; }'
    ].join('\n');

    (function injectStyle() {
      if (document.getElementById('nss-style')) return;
      var el = document.createElement('style');
      el.id = 'nss-style';
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
      d.className = 'nss-note';
      d.textContent = t;
      return d;
    }
    function button(label, onClick, disabled) {
      var b = document.createElement('button');
      b.className = 'dialog-button blueNight wrinkledPaper';
      b.tabIndex = -1;   // Tab landing on this would stop every in-game control - see Hotkey Editor
      b.style.setProperty('--wrinkled-paper-seed', seed());
      b.innerHTML = '<span>' + label + '</span>';
      if (disabled) b.disabled = true;
      else b.addEventListener('click', function (e) { e.preventDefault(); onClick(); });
      return b;
    }

    function statRow(label, value) {
      var r = document.createElement('div');
      r.className = 'nss-stat';
      r.innerHTML = '<span>' + label + '</span><b>' + value + '</b>';
      return r;
    }

    function settingRow(s, settings) {
      var current = settings.getValue(s.id);
      if (typeof current !== 'number' || isNaN(current)) current = s.def;

      var kr = document.createElement('label');
      kr.className = 'settings-item';
      var kt = document.createElement('div');
      kt.className = 'settings-item-text';
      kt.textContent = s.label;
      kr.appendChild(kt);

      var sl = document.createElement('div');
      sl.className = 'settings-item-slider';
      var si = document.createElement('input');
      si.className = 'dialog-range-input';
      si.tabIndex = -1;
      si.type = 'range'; si.min = s.min; si.max = s.max; si.step = s.step; si.value = current;
      var sv = document.createElement('div');
      sv.className = 'settings-item-slider-value';
      sv.textContent = round(current, s.step);
      si.addEventListener('input', function () {
        var v = Number(si.value);
        settings.setValue(s.id, v);
        sv.textContent = round(v, s.step);
      });
      sl.appendChild(si); sl.appendChild(sv); kr.appendChild(sl);

      var wrap = document.createElement('div');
      wrap.appendChild(kr);
      var native = document.createElement('div');
      native.className = 'nss-native';
      native.textContent = 'Native slider goes ' + s.nativeMin + '–' + s.nativeMax +
        '. Default ' + s.def + '.';
      wrap.appendChild(native);
      return wrap;
    }

    function round(v, step) {
      var decimals = (String(step).split('.')[1] || '').length;
      return Number(v).toFixed(decimals);
    }

    function fill(inner) {
      inner.textContent = '';

      var settings = findSettings();
      var g = findGame();

      if (!g) {
        inner.appendChild(h3('Set-up'));
        if (patchState.patched) {
          inner.appendChild(note('The patched game is in place but has not loaded yet. ' +
            'Reload the page (Ctrl+Shift+R) and this will connect.'));
        } else {
          inner.appendChild(note(
            'This needs the same one-off set-up as 1 Kill = 1 Stat Point - it writes a ' +
            'patched copy of the game into the game\'s own cache so this mod can reach your ' +
            'settings and stats. The page reloads once, then it is connected every time.' +
            (patchState.cacheName ? '' : '\n\nThe cache is not there yet - load a match once, then come back.')));
        }
        if (patchState.error) inner.appendChild(note('Last attempt: ' + patchState.error));

        var setupRow = document.createElement('div');
        setupRow.className = 'nss-setup-row';
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
        return;
      }

      if (settings) {
        inner.appendChild(h3('Extended Settings'));
        inner.appendChild(note('Same settings the game already has - just a wider dial. ' +
          'Writes straight through the game\'s own settings, so they stick like any other change.'));
        SETTINGS.forEach(function (s) { inner.appendChild(settingRow(s, settings)); });
      }

      inner.appendChild(h3('Stats'));
      var p = findPlayer();
      if (!p) {
        inner.appendChild(note('No player found yet - spawn into a match.'));
      } else {
        var kills = p.scoreKills || 0, deaths = p.scoreDeaths || 0, flags = p.scoreFlags || 0;
        var kd = deaths > 0 ? (kills / deaths).toFixed(2) : (kills > 0 ? kills.toFixed(2) : '0.00');
        inner.appendChild(note('This match'));
        inner.appendChild(statRow('Kills', kills));
        inner.appendChild(statRow('Deaths', deaths));
        inner.appendChild(statRow('Flags', flags));
        inner.appendChild(statRow('K/D', kd));
        inner.appendChild(statRow('Score', p.scoreTotal || 0));
        if (typeof p.elo === 'number') inner.appendChild(statRow('Elo', Math.round(p.elo)));
        inner.appendChild(statRow('Ping', Math.round(p.ping || 0) + 'ms'));
        inner.appendChild(statRow('FPS', fps));
      }

      var totals = liveTotals();
      var totalKD = totals.deaths > 0 ? (totals.kills / totals.deaths).toFixed(2) :
        (totals.kills > 0 ? totals.kills.toFixed(2) : '0.00');
      inner.appendChild(note('This session - ' + session.matches + ' match' +
        (session.matches === 1 ? '' : 'es') + ' so far'));
      inner.appendChild(statRow('Kills', totals.kills));
      inner.appendChild(statRow('Deaths', totals.deaths));
      inner.appendChild(statRow('Flags', totals.flags));
      inner.appendChild(statRow('K/D', totalKD));

      var resetRow = document.createElement('div');
      resetRow.style.cssText = 'display:flex; gap:8px; margin-top:8px;';
      resetRow.appendChild(button('Reset session', function () {
        resetSession();
        refresh();
      }));
      inner.appendChild(resetRow);
    }

    var dialogEl = null, curtainEl = null, bodyEl = null;

    function refresh() {
      if (!bodyEl) return;
      fill(bodyEl);
      bodyEl.querySelectorAll('button, input, select').forEach(function (el) { el.tabIndex = -1; });
    }
    setInterval(refresh, 1000);   // keep stats/fps live while the tab is open

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
      dialogEl.id = 'nss-dialog';
      dialogEl.style.setProperty('--wrinkled-paper-seed', seed());
      dialogEl.style.zIndex = '100';

      var title = document.createElement('h2');
      title.className = 'dialogTitle blueNight';
      title.textContent = 'Settings & Stats';
      dialogEl.appendChild(title);

      var list = document.createElement('div');
      list.className = 'settings-list';
      bodyEl = document.createElement('div');
      fill(bodyEl);
      bodyEl.querySelectorAll('button, input, select').forEach(function (el) { el.tabIndex = -1; });
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
      if (!bar || bar.querySelector('#nss-menu-button')) return;

      var c = document.createElement('div');
      c.className = 'main-menu-button-container';
      c.id = 'nss-menu-button';

      var b = document.createElement('button');
      b.className = 'wrinkledPaper main-menu-button';
      b.setAttribute('aria-label', 'Settings & Stats');
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
      l.textContent = 'Settings & Stats';

      c.appendChild(b); c.appendChild(l);
      b.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (dialogEl && dialogEl.isConnected) closeDialog(); else openDialog();
      });

      var sibs = Array.prototype.slice.call(bar.querySelectorAll('.main-menu-button-container'));
      var anchor = sibs.filter(function (x) {
        var t = (x.textContent || '').trim();
        return t === 'Crosshair' || t === 'Health' || t === 'Settings' || t === 'Hotkeys' ||
               t === '1 Kill = 1 Stat Point' || t === 'Target Practice';
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

    PAGE.NarrowSettingsStats = window.NarrowSettingsStats = {
      open: openDialog,
      get player() { return findPlayer(); },
      get settings() { return findSettings(); },
      get session() { return session; },
      resetSession: resetSession,
      patchState: patchState,
      enable: enablePatch,
      disable: disablePatch,
      check: checkPatched
    };

    console.log('[Settings & Stats] ready. Patched copy in cache:', patchState.patched);
  });
})();
