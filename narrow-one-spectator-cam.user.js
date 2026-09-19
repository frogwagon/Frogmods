// ==UserScript==
// @name         Spectator Cam
// @namespace    narrowone-spectator-cam
// @version      1.0.0
// @description  While you're spectating a Narrow One match: lock onto a player (chase or first person) and ride their arrows, on top of the game's own free fly. Does nothing while you're playing.
// @author       Frogwagon
// @match        https://narrow.one/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

/*
 * Spectator Cam  -  Narrow One
 * -----------------------------
 * The game already has a spectator role. A spectator can't shoot, and gets
 * free flight:
 *
 *   updateFly() {
 *     t = this.hasOwnership ? settings.flyInSpectateTeam : this.serverFlyEnabled;
 *     this.rigidBody.fly = t && this.teamId == E && this.game.gameStarted || this.noclip
 *   }
 *
 * where E is the spectator team. This adds camera tools on top of that
 * flight: lock onto a player in chase or first-person view, and follow the
 * arrows they fire.
 *
 * Only ever active while you are a spectator, and it decides that the same
 * way the game does - rigidBody.fly is true on your own player. If that isn't
 * true (you're playing, or "Fly when spectating" is off), every key here is
 * ignored and the camera is left completely alone. Spectators see the whole
 * match by design, so this shows nothing the game wasn't already willing to
 * show you; a player can't use it to scout a round they're in.
 *
 * Camera: po().cam is the camera controller, and po().cam.cam is the
 * three.js camera. The controller's loop() runs once a frame before
 * rendering; this wraps it and, when locked on, overwrites the camera's
 * position and rotation right after the game has set them.
 *
 * Reaching po() needs the same one-line bundle patch 1 Kill = 1 Stat Point
 * uses (see its header). Idempotent, so safe alongside other mods that
 * apply it; this one applies itself automatically once the game's cache
 * exists.
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

  (function autoPatch() {
    var tries = 0;
    function attempt() {
      tries++;
      checkPatched().then(function (patched) {
        if (patched) return;
        if (!patchState.cacheName) {
          if (tries < 40) setTimeout(attempt, 3000);
          return;
        }
        enablePatch().then(function (result) {
          if (result === 'already patched') return;
          console.log('[Spectator Cam] patched the game - reloading once to connect.');
          location.reload();
        }).catch(function (e) {
          patchState.error = e.message;
          console.warn('[Spectator Cam] could not patch:', e.message);
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
    if (PAGE.__narrowOneSpectatorCam) return;
    PAGE.__narrowOneSpectatorCam = true;

    /** Shared with Hotkey Editor: a missing entry is the default, null is off. */
    function hotkeyFor(actionId, fallback) {
      try {
        var raw = localStorage.getItem('narrowone.hotkeys.v1');
        if (!raw) return fallback;
        var map = JSON.parse(raw);
        return Object.prototype.hasOwnProperty.call(map, actionId) ? map[actionId] : fallback;
      } catch (e) { return fallback; }
    }
    function keyLabel(code) {
      if (!code) return 'unbound';
      if (/^Key[A-Z]$/.test(code)) return code.slice(3);
      if (/^Digit[0-9]$/.test(code)) return code.slice(5);
      return code;
    }

    var KEYS = {
      prev: ['spectate.prev', 'KeyZ'],
      next: ['spectate.next', 'KeyX'],
      mode: ['spectate.mode', 'KeyC'],
      release: ['spectate.release', 'KeyV']
    };
    function keyFor(name) { return hotkeyFor(KEYS[name][0], KEYS[name][1]); }

    var MODES = ['Chase', 'First person', 'Arrow cam'];

    /* ---- what the game is showing right now ---- */

    function currentGame() {
      var g = findGame();
      var ag = g && g.gameManager && g.gameManager.activeGame;
      return (ag && ag.players instanceof Map) ? ag : null;
    }

    function me() {
      var ag = currentGame(), found = null;
      if (!ag) return null;
      ag.players.forEach(function (pl) { if (!found && pl && pl.hasOwnership === true) found = pl; });
      return found;
    }

    /**
     * Are you spectating? The game's own definition: a spectator is who
     * updateFly() turns flight on for. Nothing else in the game sets
     * rigidBody.fly except the dev-only noclip, which is excluded.
     */
    function isSpectator(p) {
      return !!(p && p.rigidBody && p.rigidBody.fly === true && !p.noclip);
    }

    /** Everyone worth watching: living, not a fellow spectator, not you. */
    function targets() {
      var ag = currentGame(), self = me(), list = [];
      if (!ag || !self) return list;
      ag.players.forEach(function (pl) {
        // You're a spectator here, so your own team id IS the spectator team:
        // anyone sharing it is another spectator, flying or not.
        if (!pl || pl === self || pl.dead || isSpectator(pl) || pl.teamId === self.teamId || !pl.pos) return;
        list.push(pl);
      });
      list.sort(function (a, b) {
        return (a.teamId - b.teamId) || String(a.playerName || '').localeCompare(String(b.playerName || ''));
      });
      return list;
    }

    /* ---- camera maths, on plain numbers so it needs nothing from three.js ---- */

    /** Rotate (0,0,-1) - the way a camera looks - by quaternion q. */
    function forwardOf(q) {
      var x = q.x, y = q.y, z = q.z, w = q.w;
      // q * (0,0,-1) * q^-1, expanded
      return {
        x: -(2 * (x * z + w * y)),
        y: -(2 * (y * z - w * x)),
        z: -(1 - 2 * (x * x + y * y))
      };
    }

    function eyeOf(pl) {
      try {
        if (typeof pl.getCamPos === 'function') {
          var c = pl.getCamPos();
          if (c && typeof c.x === 'number') return { x: c.x, y: c.y, z: c.z };
        }
      } catch (e) {}
      return { x: pl.pos.x, y: pl.pos.y + 1.6, z: pl.pos.z };
    }

    function viewQuat(pl) {
      try {
        var q = typeof pl.getCamRot === 'function' ? pl.getCamRot() : null;
        if (q && typeof q.w === 'number') return q;
      } catch (e) {}
      return null;
    }

    /** Where an arrow is right now: the head of its recorded flight path. */
    function arrowPos(a) {
      var trail = a && a.travelledPositions;
      var p = (a && a.pos) || (trail && trail.length ? trail[trail.length - 1] : null) || (a && a.prevPos) || (a && a.startPos);
      return p && typeof p.x === 'number' ? { x: p.x, y: p.y, z: p.z } : null;
    }

    /** The newest arrow this player has in the air. */
    function latestArrowOf(pl) {
      var ag = currentGame();
      var arrows = ag && ag.arrowManager && ag.arrowManager.arrows;
      if (!(arrows instanceof Map)) return null;
      var best = null;
      arrows.forEach(function (a) {
        if (a && a.shotBy === pl && !a.consumed) best = a;
      });
      return best;
    }

    /* ---- state ---- */

    var state = { target: null, mode: 0, lastArrow: null, lastArrowAt: 0 };
    var ARROW_LINGER_MS = 1500;   // keep riding an arrow a moment after it lands

    function release() { state.target = null; state.lastArrow = null; }

    function cycle(dir) {
      var list = targets();
      if (!list.length) { release(); return; }
      var i = list.indexOf(state.target);
      i = i === -1 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
      state.target = list[i];
      state.lastArrow = null;
    }

    /**
     * Work out where the camera should be, or null to leave the game's own
     * camera alone. Pure: takes the state, returns numbers.
     */
    function computeShot(now) {
      var pl = state.target;
      if (!pl || pl.dead || !pl.pos) return null;

      var mode = MODES[state.mode];

      if (mode === 'Arrow cam') {
        var a = latestArrowOf(pl);
        if (a) { state.lastArrow = a; state.lastArrowAt = now; }
        var arrow = a || (state.lastArrow && now - state.lastArrowAt < ARROW_LINGER_MS ? state.lastArrow : null);
        var ap = arrow && arrowPos(arrow);
        if (ap && arrow.dir) {
          var d = arrow.dir, len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z) || 1;
          var dx = d.x / len, dy = d.y / len, dz = d.z / len;
          return {
            pos: { x: ap.x - dx * 2.5, y: ap.y - dy * 2.5 + 0.6, z: ap.z - dz * 2.5 },
            look: { x: ap.x + dx * 8, y: ap.y + dy * 8, z: ap.z + dz * 8 }
          };
        }
        mode = 'Chase';   // nothing in the air - watch the shooter until they fire
      }

      if (mode === 'First person') {
        var q = viewQuat(pl);
        if (q) return { pos: eyeOf(pl), quat: q };
        mode = 'Chase';
      }

      // Chase: behind and above, looking at their head, along where they face.
      var eye = eyeOf(pl);
      var vq = viewQuat(pl);
      var f = vq ? forwardOf(vq) : { x: 0, y: 0, z: -1 };
      var fl = Math.sqrt(f.x * f.x + f.z * f.z) || 1;   // stay level - don't dive with their pitch
      return {
        pos: { x: eye.x - (f.x / fl) * 4, y: eye.y + 1.4, z: eye.z - (f.z / fl) * 4 },
        look: eye
      };
    }

    /** Overwrite the three.js camera with a computed shot. */
    function applyShot(cam, shot) {
      cam.position.set(shot.pos.x, shot.pos.y, shot.pos.z);
      if (shot.quat) cam.quaternion.copy(shot.quat);
      else cam.lookAt(shot.look.x, shot.look.y, shot.look.z);
      if (typeof cam.updateMatrixWorld === 'function') cam.updateMatrixWorld();
    }

    /* ---- hooking the game's camera ---- */

    var hookedCtl = null;
    function hookCamera() {
      var g = findGame();
      var ctl = g && g.cam;
      if (!ctl || typeof ctl.loop !== 'function' || !ctl.cam || ctl === hookedCtl) return;
      var original = ctl.loop;
      ctl.loop = function () {
        var result = original.apply(this, arguments);
        try {
          var self = me();
          if (state.target && !isSpectator(self)) release();   // no longer spectating
          if (state.target) {
            var shot = computeShot(Date.now());
            if (shot) applyShot(ctl.cam, shot);
            else release();                                    // target died or left
          }
        } catch (e) {}
        return result;
      };
      hookedCtl = ctl;
    }
    setInterval(hookCamera, 500);

    /* ---- keys ---- */

    function typingElsewhere(e) {
      var t = e.target;
      if (!t || !t.tagName) return false;
      var tag = t.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || t.isContentEditable;
    }

    window.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.altKey || e.metaKey || typingElsewhere(e)) return;
      if (!isSpectator(me())) return;                          // playing: not our business

      var name = null;
      Object.keys(KEYS).forEach(function (k) { if (keyFor(k) && e.code === keyFor(k)) name = k; });
      if (!name) return;

      e.preventDefault(); e.stopPropagation();
      if (name === 'prev') cycle(-1);
      else if (name === 'next') cycle(1);
      else if (name === 'release') release();
      else if (name === 'mode') {
        state.mode = (state.mode + 1) % MODES.length;
        if (!state.target) cycle(1);
      }
      renderHud();
    }, true);

    /* ---- a small HUD so you know what you're locked onto ---- */

    var hudEl = null;
    function renderHud() {
      var show = isSpectator(me());
      if (!show) { if (hudEl) { hudEl.remove(); hudEl = null; } return; }
      if (!hudEl) {
        hudEl = document.createElement('div');
        hudEl.id = 'nsc-hud';
        hudEl.style.cssText = 'position:fixed; left:50%; bottom:22px; transform:translateX(-50%); ' +
          'z-index:200; padding:6px 14px; border-radius:10px; background:rgba(15,15,20,.7); ' +
          'color:#fff; font:600 13px system-ui,sans-serif; pointer-events:none; white-space:nowrap;';
        document.body.appendChild(hudEl);
      }
      var k = function (n) { return keyLabel(keyFor(n)); };
      hudEl.textContent = state.target
        ? 'Watching ' + (state.target.playerName || 'player') + ' · ' + MODES[state.mode] +
          '   [' + k('prev') + '/' + k('next') + '] switch  [' + k('mode') + '] view  [' + k('release') + '] free'
        : 'Spectating - [' + k('next') + '] lock onto a player  [' + k('mode') + '] choose a view';
    }
    setInterval(renderHud, 300);

    PAGE.NarrowSpectatorCam = window.NarrowSpectatorCam = {
      get state() { return state; },
      get isSpectating() { return isSpectator(me()); },
      targets: targets,
      cycle: cycle,
      release: release,
      computeShot: computeShot,
      patchState: patchState
    };

    console.log('[Spectator Cam] ready. Patched copy in cache:', patchState.patched);
  });
})();
