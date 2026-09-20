// ==UserScript==
// @name         Spectator Cam
// @namespace    narrowone-spectator-cam
// @version      1.2.0
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
 * First person also hides the watched player's body (keeping the weapon they
 * are holding, so you see their bow or melee weapon) and hides your own
 * weapon, which the game would otherwise draw in front of the camera.
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

    /**
     * Where an arrow is right now. Each frame the arrow appends its current
     * point to travelledPositions, so the last entry is where it is; prevPos
     * and startPos are only fallbacks for its very first frame.
     */
    function arrowPos(a) {
      var trail = a && a.travelledPositions;
      var p = (trail && trail.length ? trail[trail.length - 1] : null) || (a && a.prevPos) || (a && a.startPos);
      return p && typeof p.x === 'number' ? { x: p.x, y: p.y, z: p.z } : null;
    }

    /** Which way it's travelling: lookDirection is updated every frame (dir is only the launch direction). */
    function arrowDir(a) {
      var d = (a && a.lookDirection && (a.lookDirection.x || a.lookDirection.y || a.lookDirection.z)) ? a.lookDirection : (a && a.dir);
      return d && typeof d.x === 'number' ? d : null;
    }

    /**
     * The newest arrow this player has in flight.
     *
     * The arrow manager keeps arrows as a Map OF Maps - one inner Map per
     * shooter - not a flat Map:
     *
     *   destructor() { for (const t of this.arrows.values()) for (const e of t.values()) e.d... }
     *
     * The first version treated it as flat, matched nothing, and the arrow
     * view never engaged. A flat Map is still handled in case that changes.
     * Landed arrows carry didHitWorld / didHitPlayer, so those, not a made-up
     * flag, say whether one is still flying.
     */
    function eachArrow(cb) {
      var ag = currentGame();
      var arrows = ag && ag.arrowManager && ag.arrowManager.arrows;
      if (!(arrows instanceof Map)) return;
      arrows.forEach(function (v) {
        if (v instanceof Map) v.forEach(cb);
        else cb(v);
      });
    }

    function latestArrowOf(pl) {
      var best = null;
      eachArrow(function (a) {
        if (a && a.shotBy === pl && !a.didHitWorld && !a.didHitPlayer && !a.consumed) best = a;
      });
      return best;
    }

    /* ---- state ---- */

    var state = { target: null, mode: 0, lastArrow: null, lastArrowAt: 0 };
    var orbit = { yaw: 0, pitch: 0, zoom: 1 };     // your mouse's offset from the default view
    function resetOrbit(keepZoom) { orbit.yaw = 0; orbit.pitch = 0; if (!keepZoom) orbit.zoom = 1; }
    var ARROW_LINGER_MS = 1500;   // keep riding an arrow a moment after it lands

    function release() { state.target = null; state.lastArrow = null; resetOrbit(); restoreVisuals(); }

    function cycle(dir) {
      var list = targets();
      if (!list.length) { release(); return; }
      var i = list.indexOf(state.target);
      i = i === -1 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
      state.target = list[i];
      resetOrbit(true);                // new subject: back behind them, keep your zoom
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
        var d = arrow && arrowDir(arrow);
        if (ap && d) {
          var len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z) || 1;
          var dx = d.x / len, dy = d.y / len, dz = d.z / len;
          // Sit behind it along its own line of flight, a little above, then
          // let the mouse swing round it from there. Aim at the arrow itself
          // so it stays centred whatever angle you pick.
          return orbitShot(ap, { x: -dx, y: 0, z: -dz }, Math.asin(-dy) + 0.24, ARROW_DIST);
        }
        mode = 'Chase';   // nothing in the air - watch the shooter until they fire
      }

      if (mode === 'First person') {
        var q = viewQuat(pl);
        if (q) return { pos: eyeOf(pl), quat: q, firstPerson: true };
        mode = 'Chase';
      }

      // Chase: behind and above, looking at their head, along where they face.
      var eye = eyeOf(pl);
      var vq = viewQuat(pl);
      var f = vq ? forwardOf(vq) : { x: 0, y: 0, z: -1 };
      // stay level - don't dive with their pitch
      return orbitShot(eye, { x: -f.x, y: 0, z: -f.z }, CHASE_PITCH, CHASE_DIST);
    }

    /* ---- orbit and zoom ---- */

    var CHASE_DIST = 4.2, CHASE_PITCH = 0.34;   // the old fixed 4 back / 1.4 up
    var ARROW_DIST = 2.6;
    var ZOOM_MIN = 0.35, ZOOM_MAX = 14;

    /**
     * Put the camera on a sphere around `center` and aim it at the centre.
     *
     * `behind` is the direction that counts as "behind" (only its horizontal
     * part is used), `basePitch` how far up from level the default view sits.
     * The mouse adds to both - orbit.yaw swings round, orbit.pitch tilts up
     * and down - and orbit.zoom multiplies the distance, so the default view is
     * exactly what you had before until you touch anything.
     */
    function orbitShot(center, behind, basePitch, baseDist) {
      var hl = Math.sqrt(behind.x * behind.x + behind.z * behind.z);
      var theta = (hl > 1e-6 ? Math.atan2(behind.x, behind.z) : 0) + orbit.yaw;
      var pitch = Math.max(-1.25, Math.min(1.45, basePitch + orbit.pitch));
      var dist = baseDist * orbit.zoom;
      var cp = Math.cos(pitch);
      var dir = { x: Math.sin(theta) * cp, y: Math.sin(pitch), z: Math.cos(theta) * cp };
      var pos = pullInFromWalls(center, dir, dist);
      return { pos: pos, look: center };
    }

    /**
     * Stop the camera ending up inside a wall when you swing round behind
     * geometry: cast from the target out toward the camera with the game's
     * own wall raycast and stop just short of whatever it hits. Skipped
     * quietly if the game's physics isn't reachable.
     */
    function pullInFromWalls(center, dir, dist) {
      var far = { x: center.x + dir.x * dist, y: center.y + dir.y * dist, z: center.z + dir.z * dist };
      try {
        var ag = currentGame(), physics = ag && ag.physics;
        var proto = ag && ag.players && (function () { var v = null; ag.players.forEach(function (p) { if (!v && p && p.pos) v = p.pos; }); return v; })();
        if (!physics || !proto || typeof proto.clone !== 'function' ||
            typeof physics.getRayCastCache !== 'function' || typeof physics.rayCastMapColliders !== 'function') return far;
        var a = proto.clone(); a.x = center.x; a.y = center.y; a.z = center.z;
        var b = proto.clone(); b.x = far.x; b.y = far.y; b.z = far.z;
        var ray = physics.getRayCastCache(a, b);
        var hit = ray && physics.rayCastMapColliders(ray, blocksWall);
        if (hit && typeof hit.dist === 'number') {
          var d = Math.max(0.6, hit.dist - 0.35);
          return { x: center.x + dir.x * d, y: center.y + dir.y * d, z: center.z + dir.z * d };
        }
      } catch (e) {}
      return far;
    }

    /** Solid walls only - the same test the game uses for what stops an arrow. */
    function blocksWall(hit) {
      var c = hit && hit.collider;
      return !!c && !c.ignoreArrows && !(c.excludeTeamId >= 0) &&
        !(typeof c.isTriggerCollider === 'function' && c.isTriggerCollider());
    }

    /** Overwrite the three.js camera with a computed shot. */
    function applyShot(cam, shot) {
      cam.position.set(shot.pos.x, shot.pos.y, shot.pos.z);
      if (shot.quat) cam.quaternion.copy(shot.quat);
      else cam.lookAt(shot.look.x, shot.look.y, shot.look.z);
      if (typeof cam.updateMatrixWorld === 'function') cam.updateMatrixWorld();
    }

    /* ---- what you see of the players ---- */

    /**
     * Two things to fix on top of moving the camera.
     *
     * 1. In first person you're looking out of their head, so their own body
     *    was in the way. The player's model hangs off `obj` (the game itself
     *    switches obj.visible for the local player in first person), and what
     *    they're holding is separate - each weapon is a "holding handler"
     *    with its own holdingObject, parented to a hand bone. Hiding the whole
     *    of `obj` would take the weapon with it, so instead every mesh that is
     *    NOT inside a holdingObject is hidden and the weapon is left alone -
     *    which is what shows you their bow or melee weapon, the real one they
     *    have out, rather than yours.
     *
     * 2. Your own weapon. In first person the game draws yours in front of
     *    the camera, so it sat on top of the view. A weapon's placement is
     *    decided by player.useFirstPersonHoldingHandlers (camera when true,
     *    hand bone when false), re-applied by handler.useFirstPersonUpdated().
     *    Your own model is hidden in first person, so a weapon put back on
     *    your hand bone is invisible. The game recalculates that flag on
     *    certain events, so it's re-checked every frame while you're watching
     *    someone, and handed back to the game's own updateUseFirstPerson-
     *    HoldingHandlers() when you stop.
     */
    var hidden = { target: null, meshes: [] };   // meshes: [mesh, wasVisible]
    var ownWeaponHidden = null;                  // the player whose weapon we moved

    function handlersOf(pl) {
      var h = pl && pl.holdingHandlers;
      return h && typeof h[Symbol.iterator] === 'function' ? Array.from(h) : [];
    }

    function insideAny(node, roots) {
      for (var n = node; n; n = n.parent) if (roots.indexOf(n) !== -1) return true;
      return false;
    }

    function hideBody(pl) {
      if (hidden.target === pl) return;
      restoreBody();
      if (!pl || !pl.obj || typeof pl.obj.traverse !== 'function') return;

      var weapons = handlersOf(pl).map(function (h) { return h.holdingObject; }).filter(Boolean);
      var saved = [];
      pl.obj.traverse(function (node) {
        if ((node.isMesh || node.isSkinnedMesh) && !insideAny(node, weapons)) {
          saved.push([node, node.visible]);
          node.visible = false;
        }
      });
      hidden = { target: pl, meshes: saved };
    }

    function restoreBody() {
      hidden.meshes.forEach(function (pair) { pair[0].visible = pair[1]; });
      hidden = { target: null, meshes: [] };
    }

    function hideOwnWeapon(self) {
      if (!self) return;
      if (self.useFirstPersonHoldingHandlers) {
        self.useFirstPersonHoldingHandlers = false;
        handlersOf(self).forEach(function (h) {
          if (typeof h.useFirstPersonUpdated === 'function') h.useFirstPersonUpdated();
        });
      }
      ownWeaponHidden = self;
    }

    function restoreOwnWeapon() {
      var self = ownWeaponHidden;
      ownWeaponHidden = null;
      if (self && typeof self.updateUseFirstPersonHoldingHandlers === 'function') {
        try { self.updateUseFirstPersonHoldingHandlers(); } catch (e) {}
      }
    }

    function restoreVisuals() {
      if (hidden.target) restoreBody();
      if (ownWeaponHidden) restoreOwnWeapon();
    }

    /** Called every frame while locked on. `shot` says whether this is true first person. */
    function syncVisuals(self, shot) {
      hideOwnWeapon(self);
      if (shot && shot.firstPerson) hideBody(state.target);
      else restoreBody();
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
            if (shot) { applyShot(ctl.cam, shot); syncVisuals(self, shot); }
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
        resetOrbit(true);                                      // new view: back to its default angle
        if (!state.target) cycle(1);
      }
      renderHud();
    }, true);

    /* ---- mouse: swing round the subject, wheel to zoom ---- */

    /** Only the views that orbit a point - first person is fixed to their eyes. */
    function orbiting() {
      return !!state.target && MODES[state.mode] !== 'First person' && isSpectator(me());
    }

    var ORBIT_SPEED = 0.005;   // radians per pixel of mouse movement

    window.addEventListener('mousemove', function (e) {
      if (!orbiting()) return;
      // Pointer locked (the normal in-game state) reports raw movement; with a
      // free cursor only orbit while the left button is held, so clicking
      // around a dialog doesn't spin the view.
      if (!document.pointerLockElement && !(e.buttons & 1)) return;
      orbit.yaw -= (e.movementX || 0) * ORBIT_SPEED;
      orbit.pitch += (e.movementY || 0) * ORBIT_SPEED;
    }, true);

    window.addEventListener('wheel', function (e) {
      if (!orbiting()) return;
      // Swallow it: while spectating the game uses the wheel for fly speed, and
      // scrolling to zoom shouldn't also make you faster.
      e.preventDefault(); e.stopPropagation();
      orbit.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, orbit.zoom * (e.deltaY > 0 ? 1.12 : 1 / 1.12)));
    }, { capture: true, passive: false });

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
          '   [' + k('prev') + '/' + k('next') + '] switch  [' + k('mode') + '] view  [' + k('release') + '] free' +
          (MODES[state.mode] === 'First person' ? '' : '   mouse: orbit  wheel: zoom')
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
