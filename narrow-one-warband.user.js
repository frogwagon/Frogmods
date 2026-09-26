// ==UserScript==
// @name         Warband (Beta)
// @namespace    narrowone-warband
// @version      1.3.0
// @description  BETA - Friend requests, join/invite permission, messaging and acorn gifts by a Warband ID (needs its own small relay server - see warband-server/), plus weekly quests that pay out a local cosmetic currency.
// @author       Frogwagon
// @match        https://narrow.one/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

/*
 * Warband (Beta)  -  Narrow One
 * ------------------------------
 * BETA. Tested against a local fake relay and against the real game with a
 * couple of real accounts, but it hasn't had the mileage the other mods
 * here have - the friends system in particular is new enough that rough
 * edges are expected. Needs its own relay server deployed before the
 * Friends tab does anything at all - see warband-server/README.md.
 *
 * 1. Friends, v2 - request/accept by a Warband id (a random id this mod
 *    generates for itself, not your real account), online/offline status,
 *    asking permission before you join someone or invite them, and direct
 *    messages, all through a small relay server (warband-server/) since
 *    the game itself has no friends system at all - checked the whole
 *    client for one, it's genuinely not there. The relay only ever hands
 *    back a squad code once a request is approved; the actual join still
 *    goes through the game's own real squadManager.joinExistingSquad(code)
 *    - the game's own multiplayer, not anything this mod invents. An id is
 *    as sensitive as a squad code: whoever has it can act as you on the
 *    relay, so hand it out the same way you'd hand out a squad code.
 *
 *    Friend icons are a coloured circle with an initial, not a real
 *    avatar - a Warband id has no connection to the game's own
 *    player/account system, so there's no picture to honestly fetch for
 *    one. Said plainly rather than faked.
 *
 * 2. Squad chat, the same chat the game already has (the native "Press T to
 *    chat with your squad" box, real players, real messages, the game's own
 *    server) - just given a nicer floating panel instead of the small
 *    default one. Nothing about how it sends or receives changes; this only
 *    touches the DOM around it. (Still a shell as of this version - see the
 *    TODO further down; it opens on T but doesn't yet show message content.)
 *
 * 3. Weekly quests. A handful of them are active at a time (kills, headshots,
 *    flags, matches - things Settings & Stats and Achievements already read
 *    the same way), refreshed every 7 days, paying out a made-up local
 *    currency, "acorns", that only exists in this mod's own storage. Spend
 *    them on cosmetic badges shown only in this mod's own little HUD, not
 *    on your in-game character - explained more where that code is, but
 *    the short version: the game computes your equipped skin and your
 *    combat stats from the exact same field, so swapping your visible gear
 *    locally risks nudging your own client-side stat numbers too, which is
 *    precisely what "no stats past your own gear" is trying to prevent.
 *    Rather than risk that, badges are their own separate, harmless little
 *    icon - never touches equippedSkinData, never touches a stat.
 *
 * 4. Gifting acorns to a friend. Acorns only ever exist as a plain number
 *    in this mod's own local storage - there's no acorn "account" on the
 *    relay at all, so a gift is really just "take some off my local number,
 *    tell the relay to deliver a note to them", and their mod adds it to
 *    their own local number the next time it polls. That means this trusts
 *    the sender's own client the same way the quest payouts already do -
 *    someone could edit their own local storage to hand out more than
 *    they "really" earned, but the absolute most that buys is a cosmetic
 *    HUD icon only they can see, never a stat, so there's nothing here
 *    worth cheating for. The relay only checks that you're actually
 *    friends and caps the amount to something sane per gift.
 */

(function () {
  'use strict';

  var PAGE = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;

  var ENTRY_RE = /\/js\/index-[^/]*\.js$/;
  var PO_RE = /function ([A-Za-z_$][\w$]*)\(\)\{if\(!([A-Za-z_$][\w$]*)\)throw new Error\("Main instance is not initialized"\);return \2\}/;
  var CACHE_RE = /^narrowClient\d+$/;
  var MARK = '__NARROW';

  /* ================================================================== *
   * Part 1 - the same cache patch every other mod here uses to reach the
   * game's own instance. See 1 Kill = 1 Stat Point's header for the full
   * story; this copy is unchanged.
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
          console.log('[Warband] patched the game - reloading once to connect.');
          location.reload();
        }).catch(function (e) {
          patchState.error = e.message;
          console.warn('[Warband] could not patch:', e.message);
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
    if (PAGE.__narrowOneWarband) return;
    PAGE.__narrowOneWarband = true;

    function currentGame() {
      var g = findGame();
      var ag = g && g.gameManager && g.gameManager.activeGame;
      return (ag && ag.players instanceof Map) ? ag : null;
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

    function scoreVal(ag, typeId) {
      return (ag && ag.trackedMyPlayerScores && ag.trackedMyPlayerScores.get(typeId)) || 0;
    }

    /* ================================================================ *
     * Store
     * ================================================================ */

    var STORE_KEY = 'narrowone.warband.v1';
    var store = {
      acorns: 0,
      badges: {},            // id -> unlockedAt
      quests: { weekId: null, active: [], progress: {} },
      // Friends v2 - see the big comment below. Names/relay URL/popup
      // preference are the only things this mod itself remembers; friend
      // relationships, requests and messages live on the relay you deploy.
      friendNames: {},       // warbandId -> nickname you gave them
      relayUrl: '',
      popupsEnabled: true,
      lastClearedMessageAt: 0,
      shownRequestIds: []   // requests already popped up once - see the note by shownRequestIds below
    };
    (function loadStore() {
      try {
        var raw = localStorage.getItem(STORE_KEY);
        if (raw) {
          var saved = JSON.parse(raw);
          if (saved && typeof saved === 'object') {
            store.acorns = Number(saved.acorns) || 0;
            store.badges = saved.badges && typeof saved.badges === 'object' ? saved.badges : {};
            if (saved.quests && typeof saved.quests === 'object') store.quests = saved.quests;
            store.friendNames = saved.friendNames && typeof saved.friendNames === 'object' ? saved.friendNames : {};
            store.relayUrl = typeof saved.relayUrl === 'string' ? saved.relayUrl : '';
            store.popupsEnabled = saved.popupsEnabled !== false;
            store.lastClearedMessageAt = Number(saved.lastClearedMessageAt) || 0;
            store.shownRequestIds = Array.isArray(saved.shownRequestIds) ? saved.shownRequestIds : [];
          }
        }
      } catch (e) {}
    })();
    function saveStore() {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) {}
    }

    /* ================================================================ *
     * 1. Friends v2 - request/accept by a Warband id, join-permission
     * requests, invites, and direct messages, through the small relay
     * server described in warband-server/. This mod has no default
     * server of its own - nothing here works until a relay URL is set in
     * the Warband dialog's Settings tab (warband-server/README.md walks
     * through deploying one, free, on your own Cloudflare account).
     *
     * A "Warband id" is a random string this mod generates for itself the
     * first time it runs (myWarbandId(), below) - it is NOT your Pelican
     * Party account and the relay never sees that account at all. Anyone
     * who has your id can act as you on the relay (send requests, accept
     * on your behalf if they also had your browser) - the same trust
     * level a squad code already has, so treat it the same way: hand it
     * only to people you'd hand a squad code to.
     *
     * The actual JOIN action, once a request is approved, still goes
     * through the game's own real squadManager.joinExistingSquad(code) -
     * the relay only ever hands back a code for that call to use, it
     * never touches the game's own network itself.
     * ================================================================ */

    function squadManager() {
      var g = findGame();
      // Confirmed live in the real game (a wrong guess at first - it's
      // not on the root instance or on mainMenu, it's under network):
      // window.__NARROW.network.squadManager is what actually has
      // joinExistingSquad/userVisibleSquadId on it.
      return g && g.network && g.network.squadManager ? g.network.squadManager : null;
    }
    function myCode() {
      var sm = squadManager();
      var id = sm && sm.userVisibleSquadId;
      return id ? String(id).trim().toUpperCase() : null;
    }
    function joinByCode(code) {
      var sm = squadManager();
      if (!sm || typeof sm.joinExistingSquad !== 'function' || !code) return false;
      sm.joinExistingSquad(code);
      return true;
    }

    var WARBAND_ID_KEY = 'narrowone.warband.myId';
    var myWarbandIdCache = null;
    function myWarbandId() {
      if (myWarbandIdCache) return myWarbandIdCache;
      try {
        var existing = localStorage.getItem(WARBAND_ID_KEY);
        if (existing) { myWarbandIdCache = existing; return existing; }
      } catch (e) {}
      var id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '') :
        (Date.now().toString(36) + Math.random().toString(36).slice(2));
      id = id.slice(0, 24);
      try { localStorage.setItem(WARBAND_ID_KEY, id); } catch (e) {}
      myWarbandIdCache = id;
      return id;
    }

    function relayUrl() { return (store.relayUrl || '').replace(/\/+$/, ''); }
    function relayReady() { return !!relayUrl(); }

    function relayCall(path, method, body) {
      var base = relayUrl();
      if (!base) return Promise.reject(new Error('no relay URL set'));
      return fetch(base + path, {
        method: method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
          return data;
        });
      });
    }

    // Live-fetched friend list (id + online/lastSeen) - not persisted here,
    // the relay is the source of truth for who's actually friends now.
    var liveFriends = [];
    function refreshFriends() {
      if (!relayReady()) return Promise.resolve([]);
      return relayCall('/friends/' + myWarbandId(), 'GET').then(function (data) {
        liveFriends = (data && data.friends) || [];
        return liveFriends;
      }).catch(function () { return liveFriends; });
    }
    function friendName(id) { return store.friendNames[id] || id.slice(0, 8); }
    function setFriendName(id, name) {
      name = String(name || '').trim();
      if (name) store.friendNames[id] = name; else delete store.friendNames[id];
      saveStore();
    }

    function sendFriendRequest(toId) {
      return relayCall('/friend-request', 'POST', { fromId: myWarbandId(), toId: toId });
    }
    function respondFriendRequest(fromId, accept) {
      return relayCall(accept ? '/friend-accept' : '/friend-decline', 'POST', { id: myWarbandId(), fromId: fromId });
    }
    function sendJoinRequest(toId) {
      return relayCall('/join-request', 'POST', { fromId: myWarbandId(), toId: toId });
    }
    function sendInvite(toId) {
      var code = myCode();
      if (!code) return Promise.reject(new Error('join a match first - you have no squad code yet'));
      return relayCall('/invite', 'POST', { fromId: myWarbandId(), toId: toId, squadCode: code });
    }
    /**
     * If you don't have a squad code yet, requestInitialSquadId() is the
     * game's own real "give me one" call - it's a no-op if you're already
     * in a squad (checks isInSquad itself), so calling it is always safe.
     * The id comes back async over the network, so this just waits for
     * myCode() to stop being null rather than assuming it's instant.
     */
    function ensureMyCode() {
      var code = myCode();
      if (code) return Promise.resolve(code);
      var sm = squadManager();
      if (sm && typeof sm.requestInitialSquadId === 'function') {
        try { sm.requestInitialSquadId(); } catch (e) {}
      }
      return new Promise(function (resolve, reject) {
        var tries = 0;
        (function poll() {
          var c = myCode();
          if (c) return resolve(c);
          if (++tries >= 15) return reject(new Error('could not get a squad code - try joining a match first'));
          setTimeout(poll, 400);
        })();
      });
    }

    function respondRequest(fromId, requestId, accept, type) {
      var ready = (accept && type === 'join') ? ensureMyCode() : Promise.resolve(null);
      return ready.then(function (code) {
        var body = { id: myWarbandId(), fromId: fromId, requestId: requestId, accept: accept };
        if (code) body.squadCode = code;
        return relayCall('/request-respond', 'POST', body);
      }).then(function (res) {
        if (res && res.squadCode) joinByCode(res.squadCode);   // invite accepted: join right away
        return res;
      });
    }
    function sendMessage(toId, text) {
      text = String(text || '').trim();
      if (!text) return Promise.resolve();
      return relayCall('/message', 'POST', { fromId: myWarbandId(), toId: toId, text: text });
    }

    var MAX_GIFT_AMOUNT = 500;   // matches the relay's own cap - see worker.js
    // Deducted locally right away (so you can't double-spend it while the
    // request is in flight), refunded if the relay call actually fails.
    // The relay never tracks a balance for you at all - see the header
    // comment's honest note on what that does and doesn't protect against.
    function sendGift(toId, amount) {
      amount = Math.floor(Number(amount));
      if (!amount || amount <= 0) return Promise.reject(new Error('enter an amount'));
      if (amount > MAX_GIFT_AMOUNT) return Promise.reject(new Error('too many at once - max ' + MAX_GIFT_AMOUNT));
      if (amount > store.acorns) return Promise.reject(new Error('you only have ' + store.acorns + ' acorns'));
      store.acorns -= amount;
      saveStore();
      return relayCall('/gift', 'POST', { fromId: myWarbandId(), toId: toId, amount: amount }).catch(function (e) {
        store.acorns += amount;
        saveStore();
        throw e;
      });
    }

    /* Polling: register presence, pull the inbox, surface requests/messages. */
    var chatLog = {};   // friendId -> [{ fromId, text, at }] this session only
    // A request stays pending on the relay until you actually answer it,
    // and this polls every 6 seconds - without tracking which ones have
    // already been shown, the exact same still-unanswered request would
    // pop up again on every single poll for as long as it took you to
    // click something. Answering an older, already-consumed duplicate
    // then fails with "request not found", since the relay had already
    // removed it the first time.
    //
    // Cached to store.shownRequestIds (not just kept in memory) so a page
    // reload doesn't forget you'd already seen one either - otherwise a
    // request you're still deciding on would pop up fresh again the
    // moment you reload, as if it were new. A request id only ever comes
    // from the relay and is never reused, so once shown it never needs
    // showing again; the array is capped so it can't grow forever across
    // a very long-running install.
    var shownRequestIds = new Set(store.shownRequestIds);
    function rememberShown(id) {
      shownRequestIds.add(id);
      store.shownRequestIds.push(id);
      if (store.shownRequestIds.length > 500) store.shownRequestIds = store.shownRequestIds.slice(-500);
      saveStore();
    }
    function processInbox(data) {
      (data.requests || []).forEach(function (r) {
        if (shownRequestIds.has(r.id)) return;
        rememberShown(r.id);
        if (store.popupsEnabled) showRequestPopup(r);
        else showInboxMessage(requestToMessageText(r), r);
      });
      (data.messages || []).forEach(function (m) {
        if (m.type === 'chat') {
          if (!chatLog[m.fromId]) chatLog[m.fromId] = [];
          chatLog[m.fromId].push(m);
          showChatToast(friendName(m.fromId), m.text);
        } else if (m.type === 'join-approved') {
          showToast('Join approved - joining now…');
          joinByCode(m.squadCode);
        } else if (m.type === 'invite-accepted') {
          showToast('Your invite was accepted.');
        } else if (m.type === 'request-declined') {
          showToast('Your ' + (m.requestType || 'request') + ' request was declined.');
        } else if (m.type === 'system') {
          showToast(m.text || 'Warband notice');
        } else if (m.type === 'gift') {
          var amount = Math.floor(Number(m.amount));
          if (amount > 0) {
            store.acorns += amount;
            saveStore();
            showToast(friendName(m.fromId) + ' gifted you ' + amount + ' acorns! 🌰');
          }
        }
      });
      if (data.messages && data.messages.length) {
        store.lastClearedMessageAt = Date.now();
        saveStore();
        relayCall('/inbox/' + myWarbandId() + '/clear-messages', 'POST', { upTo: Date.now() }).catch(function () {});
      }
    }
    function requestToMessageText(r) {
      if (r.type === 'friend') return (r.fromName ? r.fromName + ' (' + r.fromId.slice(0, 8) + ')' : r.fromId.slice(0, 8)) + ' wants to be your friend.';
      if (r.type === 'join') return friendName(r.fromId) + ' wants to join your squad.';
      if (r.type === 'invite') return friendName(r.fromId) + ' invited you to their squad.';
      return 'Warband request.';
    }
    var relayPollTimer = null;
    function pollRelay() {
      if (!relayReady()) return;
      relayCall('/register', 'POST', { id: myWarbandId() }).catch(function () {});
      relayCall('/inbox/' + myWarbandId(), 'GET').then(function (data) {
        processInbox(data);
        if (wbDialogEl && wbDialogEl.isConnected) renderDialog();
      }).catch(function () {});
      refreshFriends().then(function () { if (wbDialogEl && wbDialogEl.isConnected) renderDialog(); });
    }
    function startRelayPolling() {
      if (relayPollTimer) return;
      pollRelay();
      relayPollTimer = setInterval(pollRelay, 6000);
    }

    /**
     * "Great, <name> joined your squad!" - read straight from the game's
     * own real squad roster (squadManager.getSquadMembers()), not guessed
     * from anything this mod's relay saw. That also means it fires for
     * ANYONE who joins your squad, not just people who came through a
     * Warband join-request/invite - sharing your code the old-fashioned
     * way still gets the same notice.
     *
     * The first poll after a squad appears (or after this mod loads mid-
     * squad) just records who's already there without announcing them -
     * only names that show up in a LATER poll, that weren't in the one
     * before it, count as someone joining.
     */
    var knownSquadMemberIds = null;   // null = no baseline taken yet
    var lastSquadCodeForRoster = null;
    function squadRosterTick() {
      var sm = squadManager();
      var code = myCode();
      if (!sm || !code || typeof sm.getSquadMembers !== 'function') {
        knownSquadMemberIds = null;
        lastSquadCodeForRoster = null;
        return;
      }
      if (code !== lastSquadCodeForRoster) {
        // A different squad than last time (or the first one this session)
        // - start a fresh baseline rather than announcing everyone in it.
        lastSquadCodeForRoster = code;
        knownSquadMemberIds = null;
      }
      var current = new Map();
      var iter = sm.getSquadMembers();
      var arr = (iter && typeof iter.next === 'function') ? Array.from(iter) : (iter || []);
      arr.forEach(function (m) {
        var id = m.gameServerId || m.matchmakeServerId;
        if (id != null) current.set(String(id), m.name || '');
      });
      if (knownSquadMemberIds) {
        current.forEach(function (name, id) {
          if (!knownSquadMemberIds.has(id)) showToast('Great, ' + (name || 'someone') + ' joined your squad!');
        });
      }
      knownSquadMemberIds = current;
    }
    setInterval(function () { try { squadRosterTick(); } catch (e) {} }, 3000);

    /* ================================================================ *
     * 2. Weekly quests + acorns
     *
     * A handful of active quests refresh every 7 days from a fixed pool -
     * same kind of tick-based tracking Achievements uses (kills, flags,
     * headshots off trackedMyPlayerScores and the real scoreKills/scoreFlags
     * fields), just aimed at a rotating weekly target instead of a
     * permanent ladder.
     * ================================================================ */

    var QUEST_POOL = [
      { id: 'kills15', label: 'Get 15 kills this week', stat: 'kills', target: 15, reward: 8 },
      { id: 'kills40', label: 'Get 40 kills this week', stat: 'kills', target: 40, reward: 15 },
      { id: 'flags3', label: 'Capture 3 flags this week', stat: 'flags', target: 3, reward: 10 },
      { id: 'flags8', label: 'Capture 8 flags this week', stat: 'flags', target: 8, reward: 18 },
      { id: 'headshots10', label: 'Land 10 headshots this week', stat: 'headshots', target: 10, reward: 10 },
      { id: 'headshots25', label: 'Land 25 headshots this week', stat: 'headshots', target: 25, reward: 20 },
      { id: 'matches5', label: 'Play 5 matches this week', stat: 'matches', target: 5, reward: 6 },
      { id: 'matches15', label: 'Play 15 matches this week', stat: 'matches', target: 15, reward: 16 },
      { id: 'wins2', label: 'Win 2 matches this week', stat: 'wins', target: 2, reward: 12 },
      { id: 'assists10', label: 'Get 10 assists this week', stat: 'assists', target: 10, reward: 9 }
    ];
    var QUEST_BY_ID = {};
    QUEST_POOL.forEach(function (q) { QUEST_BY_ID[q.id] = q; });

    function weekId() {
      // Days since a fixed epoch, divided into 7-day buckets - stable
      // regardless of what day of the week you first install this.
      return Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
    }
    function pickWeeklyQuests() {
      var pool = QUEST_POOL.slice();
      var picked = [];
      for (var i = 0; i < 3 && pool.length; i++) {
        var idx = Math.floor(Math.random() * pool.length);
        picked.push(pool.splice(idx, 1)[0].id);
      }
      return picked;
    }
    function ensureWeeklyQuests() {
      var w = weekId();
      if (store.quests.weekId !== w) {
        store.quests = { weekId: w, active: pickWeeklyQuests(), progress: {} };
        saveStore();
      }
    }
    function questProgress(statKey) {
      return store.quests.progress[statKey] || 0;
    }
    function addQuestProgress(statKey, amount) {
      if (amount <= 0) return;
      store.quests.progress[statKey] = (store.quests.progress[statKey] || 0) + amount;
      var changed = false;
      store.quests.active.forEach(function (qid) {
        var q = QUEST_BY_ID[qid];
        if (!q || q.stat !== statKey) return;
        if (isQuestClaimed(qid)) return;
        if (store.quests.progress[statKey] >= q.target) changed = true;
      });
      saveStore();
      if (changed && questsDialogEl && questsDialogEl.isConnected) renderQuestsDialog();
    }
    function isQuestClaimed(qid) {
      return !!(store.quests.claimed && store.quests.claimed[qid]);
    }
    function claimQuest(qid) {
      var q = QUEST_BY_ID[qid];
      if (!q || store.quests.active.indexOf(qid) === -1) return false;
      if (isQuestClaimed(qid)) return false;
      if (questProgress(q.stat) < q.target) return false;
      if (!store.quests.claimed) store.quests.claimed = {};
      store.quests.claimed[qid] = true;
      store.acorns += q.reward;
      saveStore();
      showAcornToast(q.reward);
      return true;
    }

    /* Tracking - one poll, reusing the same match-baseline pattern
       Achievements uses, feeding weekly progress rather than a ladder. */
    var qtrack = { game: null, baseline: null, wasEnded: false, wasStarted: false };
    function questTick() {
      var ag = currentGame();
      var p = findPlayer();
      ensureWeeklyQuests();

      if (ag !== qtrack.game) {
        qtrack.game = ag;
        qtrack.baseline = null;
        qtrack.wasEnded = ag ? !!ag.gameEnded : false;
      }
      if (!ag || !p) return;

      if (!qtrack.baseline) {
        qtrack.baseline = {
          kills: p.scoreKills || 0,
          flags: p.scoreFlags || 0,
          headshots: scoreVal(ag, 10),
          assist: scoreVal(ag, 2),
          winBonus: scoreVal(ag, 8)
        };
      }

      var ended = !!ag.gameEnded;
      if (ended && !qtrack.wasEnded && ag.gameStarted) {
        addQuestProgress('kills', Math.max(0, (p.scoreKills || 0) - qtrack.baseline.kills));
        addQuestProgress('flags', Math.max(0, (p.scoreFlags || 0) - qtrack.baseline.flags));
        addQuestProgress('headshots', Math.max(0, scoreVal(ag, 10) - qtrack.baseline.headshots));
        addQuestProgress('assists', Math.max(0, scoreVal(ag, 2) - qtrack.baseline.assist));
        addQuestProgress('matches', 1);
        if (scoreVal(ag, 8) - qtrack.baseline.winBonus >= 1) addQuestProgress('wins', 1);
      }
      qtrack.wasEnded = ended;
    }
    setInterval(function () { try { questTick(); } catch (e) {} }, 500);

    /* ================================================================ *
     * 3. Acorn badges - a small local, cosmetic-only unlock. Deliberately
     * NOT a skin swap: equippedSkinData feeds both what you look like and
     * (via getStatClassValuesFromShopSkinIds) your own combat stats, in
     * the same call - changing it locally to preview gear you don't own
     * risks nudging your own client-computed stats too, the exact thing
     * "no stats past your own gear" rules out. A badge is its own little
     * icon in the corner of the screen, shown only to you, that never
     * touches equippedSkinData or a stat calculation at all.
     * ================================================================ */

    var BADGES = [
      { id: 'acorn10', name: 'Bronze Acorn', cost: 20, emoji: '🦉' },
      { id: 'acorn25', name: 'Silver Acorn', cost: 45, emoji: '⚔️' },
      { id: 'acorn50', name: 'Gold Acorn', cost: 90, emoji: '🏆' },
      { id: 'acorn100', name: 'Warband Crest', cost: 160, emoji: '👑' }
    ];
    var BADGE_BY_ID = {};
    BADGES.forEach(function (b) { BADGE_BY_ID[b.id] = b; });
    var equippedBadge = null;
    (function loadEquippedBadge() {
      try { equippedBadge = localStorage.getItem('narrowone.warband.equippedBadge') || null; } catch (e) {}
    })();
    function setEquippedBadge(id) {
      equippedBadge = id;
      try {
        if (id) localStorage.setItem('narrowone.warband.equippedBadge', id);
        else localStorage.removeItem('narrowone.warband.equippedBadge');
      } catch (e) {}
      renderBadgeHud();
    }
    function buyBadge(id) {
      var b = BADGE_BY_ID[id];
      if (!b || store.badges[id]) return false;
      if (store.acorns < b.cost) return false;
      store.acorns -= b.cost;
      store.badges[id] = Date.now();
      saveStore();
      return true;
    }

    var badgeHudEl = null;
    function renderBadgeHud() {
      if (!equippedBadge || !BADGE_BY_ID[equippedBadge]) {
        if (badgeHudEl) badgeHudEl.style.display = 'none';
        return;
      }
      if (!badgeHudEl) {
        badgeHudEl = document.createElement('div');
        badgeHudEl.id = 'nwb-badge-hud';
        badgeHudEl.style.cssText = 'position:fixed;top:12px;right:12px;background:rgba(15,15,20,.7);' +
          'color:#fff;padding:6px 10px;border-radius:8px;font:600 13px system-ui,sans-serif;' +
          'display:flex;align-items:center;gap:6px;z-index:150;pointer-events:none;';
        document.body.appendChild(badgeHudEl);
      }
      var b = BADGE_BY_ID[equippedBadge];
      badgeHudEl.style.display = 'flex';
      badgeHudEl.textContent = b.emoji + ' ' + b.name;
    }

    /* ================================================================ *
     * Look and feel
     * ================================================================ */

    function seed() { return Math.floor(Math.random() * 99999); }
    function esc(s) {
      var d = document.createElement('div');
      d.textContent = String(s == null ? '' : s);
      return d.innerHTML;
    }

    var CSS = [
      '#nwb-toasts { position: fixed; left: 16px; bottom: 80px; z-index: 210; display: flex; ' +
        'flex-direction: column-reverse; gap: 8px; pointer-events: none; }',
      '.nwb-toast { background: rgba(15,15,20,.85); color: #fff; padding: 8px 14px; border-radius: 8px; ' +
        'font: 600 13px system-ui, sans-serif; opacity: 0; transform: translateX(-16px); ' +
        'transition: opacity .35s, transform .35s; }',
      '.nwb-toast.nwb-in { opacity: 1; transform: translateX(0); }',
      '#nwb-dialog .nwb-tabs { display: flex; gap: 6px; margin-bottom: 12px; }',
      '#nwb-dialog .nwb-tab { padding: 5px 12px; border-radius: 6px; background: rgba(0,0,0,.1); ' +
        'cursor: pointer; font: 700 12px inherit; border: none; color: inherit; opacity: .6; }',
      '#nwb-dialog .nwb-tab.nwb-tab-active { opacity: 1; background: rgba(0,0,0,.22); }',
      '#nwb-dialog .nwb-code-box { display: flex; align-items: center; gap: 10px; padding: 10px; ' +
        'background: rgba(0,0,0,.08); border-radius: 8px; margin-bottom: 12px; }',
      '#nwb-dialog .nwb-code-value { font: 800 18px monospace; letter-spacing: .1em; flex: 1 1 auto; }',
      '#nwb-dialog button.nwb-btn { font: 600 12px inherit; padding: 5px 10px; border-radius: 6px; ' +
        'border: none; background: rgba(0,0,0,.15); color: inherit; cursor: pointer; }',
      '#nwb-dialog .nwb-contact-row { display: flex; align-items: center; gap: 10px; padding: 7px 0; ' +
        'border-bottom: 1px solid rgba(0,0,0,.1); }',
      '#nwb-dialog .nwb-contact-name { font-weight: 700; flex: 1 1 auto; }',
      '#nwb-dialog .nwb-contact-code { opacity: .55; font: 600 11px monospace; }',
      '#nwb-dialog .nwb-add-row { display: flex; gap: 6px; margin-top: 10px; }',
      '#nwb-dialog .nwb-add-row input { flex: 1 1 auto; padding: 6px 8px; border-radius: 6px; ' +
        'border: 1px solid rgba(0,0,0,.2); font: inherit; background: rgba(255,255,255,.6); }',
      '#nwb-dialog .nwb-quest-row { padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,.1); }',
      '#nwb-dialog .nwb-quest-label { font-weight: 700; display: flex; justify-content: space-between; }',
      '#nwb-dialog .nwb-bar { height: 6px; border-radius: 3px; background: rgba(0,0,0,.15); ' +
        'margin-top: 6px; overflow: hidden; }',
      '#nwb-dialog .nwb-bar-fill { height: 100%; background: #ffb43b; border-radius: 3px; }',
      '#nwb-dialog .nwb-acorns { font: 800 14px inherit; margin-bottom: 10px; }',
      '#nwb-dialog .nwb-badge-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; ' +
        'border-bottom: 1px solid rgba(0,0,0,.1); }',
      '#nwb-dialog .nwb-badge-emoji { font-size: 22px; }',
      '#nwb-chat { position: fixed; left: 16px; bottom: 16px; width: 300px; max-height: 240px; ' +
        'background: rgba(15,15,20,.55); border-radius: 10px; padding: 8px; display: none; ' +
        'flex-direction: column; z-index: 140; font: 600 12px system-ui, sans-serif; color: #fff; }',
      '#nwb-chat.nwb-chat-open { display: flex; }',
      '#nwb-chat .nwb-chat-log { overflow-y: auto; flex: 1 1 auto; margin-bottom: 6px; max-height: 190px; }',
      '#nwb-chat .nwb-chat-line { padding: 2px 0; opacity: .9; }',
      '#nwb-chat .nwb-chat-name { opacity: .6; margin-right: 4px; }'
    ].join('\n');

    (function injectStyle() {
      if (document.getElementById('nwb-style')) return;
      var el = document.createElement('style');
      el.id = 'nwb-style';
      el.textContent = CSS;
      (document.head || document.documentElement).appendChild(el);
    })();

    var toastHost = null;
    function ensureToastHost() {
      if (!toastHost || !toastHost.isConnected) {
        toastHost = document.createElement('div');
        toastHost.id = 'nwb-toasts';
        document.body.appendChild(toastHost);
      }
      return toastHost;
    }
    // Same toast pattern Achievements uses - slide in bottom-left, fade
    // after a few seconds - so a friend message or a quest payout reads
    // the same way an achievement unlock does.
    function showToast(text) {
      var host = ensureToastHost();
      var el = document.createElement('div');
      el.className = 'nwb-toast';
      el.textContent = text;
      host.appendChild(el);
      requestAnimationFrame(function () { el.classList.add('nwb-in'); });
      setTimeout(function () { el.classList.remove('nwb-in'); }, 4500);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 5000);
    }
    function showAcornToast(amount) { showToast('Quest complete! +' + amount + ' acorns'); }
    function showChatToast(name, text) { showToast(name + ': ' + text); }

    /* Incoming friend/join/invite requests - a real popup with Accept/
       Decline by default; if "Show popups" is off in Settings, this
       becomes a plain inbox message instead (still notified the same way
       messages are, just not interrupting you with buttons). */
    var popupHost = null;
    function showRequestPopup(r) {
      if (!popupHost || !popupHost.isConnected) {
        popupHost = document.createElement('div');
        popupHost.id = 'nwb-popups';
        popupHost.style.cssText = 'position:fixed;top:60px;right:16px;z-index:220;display:flex;' +
          'flex-direction:column;gap:8px;';
        document.body.appendChild(popupHost);
      }
      var card = document.createElement('div');
      card.style.cssText = 'background:rgba(15,15,20,.9);color:#fff;padding:10px 12px;border-radius:10px;' +
        'font:600 13px system-ui,sans-serif;min-width:220px;box-shadow:0 4px 18px rgba(0,0,0,.35);';
      var label = document.createElement('div');
      label.style.marginBottom = '8px';
      label.textContent = requestToMessageText(r);
      card.appendChild(label);
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;';
      var accept = document.createElement('button');
      accept.textContent = r.type === 'friend' ? 'Accept' : 'Allow';
      accept.style.cssText = 'flex:1 1 auto;padding:5px 8px;border-radius:6px;border:none;background:#4caf6b;color:#fff;cursor:pointer;';
      var decline = document.createElement('button');
      decline.textContent = 'Decline';
      decline.style.cssText = 'flex:1 1 auto;padding:5px 8px;border-radius:6px;border:none;background:rgba(255,255,255,.15);color:#fff;cursor:pointer;';
      accept.addEventListener('click', function () { respondToRequest(r, true); card.remove(); });
      decline.addEventListener('click', function () { respondToRequest(r, false); card.remove(); });
      row.appendChild(accept); row.appendChild(decline);
      card.appendChild(row);
      popupHost.appendChild(card);
      setTimeout(function () { if (card.parentNode) card.remove(); }, 45000);
    }
    // Popups off: the same request becomes a normal notified message
    // instead, actionable later from the Friends tab's Requests list.
    var pendingRequests = [];
    function showInboxMessage(text, r) {
      pendingRequests.push(r);
      showToast(text);
    }
    function respondToRequest(r, accept) {
      if (r.type === 'friend') respondFriendRequest(r.fromId, accept).catch(function (e) { showToast('Could not respond: ' + e.message); });
      else respondRequest(r.fromId, r.id, accept, r.type).catch(function (e) { showToast('Could not respond: ' + e.message); });
      pendingRequests = pendingRequests.filter(function (p) { return p.id !== r.id; });
    }

    /* ---- dialog ---- */

    var wbDialogEl = null, wbCurtainEl = null, questsDialogEl = null;
    var activeWbTab = 'Friends';

    function closeDialog() {
      if (wbDialogEl && wbDialogEl.isConnected) wbDialogEl.remove();
      if (wbCurtainEl && wbCurtainEl.isConnected) wbCurtainEl.remove();
      wbDialogEl = null; wbCurtainEl = null; questsDialogEl = null;
    }

    /* A colour-and-initial badge in place of a real avatar. Their Warband
       id has no connection to the game's own player/account system - it's
       a number this mod made up, so there's no picture the game can hand
       back for it. Worth saying plainly: this is not their real in-game
       avatar, and there's no honest way to fetch that from an id alone. */
    function idColor(id) {
      var h = 0;
      for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
      return 'hsl(' + (h % 360) + ',55%,45%)';
    }
    function iconEl(id, name) {
      var el = document.createElement('div');
      el.style.cssText = 'width:28px;height:28px;border-radius:50%;flex:0 0 auto;display:flex;' +
        'align-items:center;justify-content:center;color:#fff;font:800 12px system-ui,sans-serif;' +
        'background:' + idColor(id) + ';';
      el.textContent = (name || id).trim().slice(0, 1).toUpperCase() || '?';
      return el;
    }

    function renderFriendsTab(body) {
      if (!relayReady()) {
        var warn = document.createElement('div');
        warn.style.cssText = 'opacity:.75;margin-bottom:10px;';
        warn.textContent = 'No relay set up yet - the Friends system needs a relay URL in the Settings ' +
          'tab to do anything (see warband-server/README.md for the one-time setup). Without it this ' +
          'tab has nothing to show.';
        body.appendChild(warn);
        return;
      }

      var idBox = document.createElement('div');
      idBox.className = 'nwb-code-box';
      var idVal = document.createElement('div');
      idVal.className = 'nwb-code-value';
      idVal.style.fontSize = '13px';
      idVal.textContent = myWarbandId();
      idBox.appendChild(idVal);
      var copyIdBtn = document.createElement('button');
      copyIdBtn.className = 'nwb-btn'; copyIdBtn.type = 'button'; copyIdBtn.tabIndex = -1;
      copyIdBtn.textContent = 'Copy my Warband ID';
      copyIdBtn.addEventListener('click', function () {
        // navigator.clipboard.writeText() returns a promise and can REJECT
        // (e.g. "TypeError: Permissions check failed" when the tab isn't
        // focused, or clipboard-write is denied) - a synchronous try/catch
        // around the call doesn't catch that, it only catches a throw, so
        // a rejection here was going out as an unhandled promise rejection
        // instead. Needs a real .catch().
        var fallbackSelect = function () {
          idVal.focus && idVal.focus();
          try {
            var range = document.createRange();
            range.selectNodeContents(idVal);
            var sel = window.getSelection();
            sel.removeAllRanges(); sel.addRange(range);
          } catch (e) {}
        };
        Promise.resolve().then(function () { return navigator.clipboard.writeText(myWarbandId()); }).then(function () {
          copyIdBtn.textContent = 'Copied!';
        }).catch(function () {
          copyIdBtn.textContent = 'Select it manually ↑';
          fallbackSelect();
        }).then(function () {
          setTimeout(function () { copyIdBtn.textContent = 'Copy my Warband ID'; }, 1800);
        });
      });
      idBox.appendChild(copyIdBtn);
      body.appendChild(idBox);

      var addRow = document.createElement('div');
      addRow.className = 'nwb-add-row';
      var idInput = document.createElement('input');
      idInput.type = 'text'; idInput.placeholder = "Friend's Warband ID"; idInput.tabIndex = -1;
      var reqBtn = document.createElement('button');
      reqBtn.className = 'nwb-btn'; reqBtn.type = 'button'; reqBtn.tabIndex = -1;
      reqBtn.textContent = 'Send friend request';
      reqBtn.addEventListener('click', function () {
        var id = idInput.value.trim();
        if (!id) return;
        reqBtn.disabled = true;
        sendFriendRequest(id).then(function () {
          reqBtn.textContent = 'Sent!'; idInput.value = '';
          setTimeout(function () { reqBtn.textContent = 'Send friend request'; reqBtn.disabled = false; }, 1500);
        }).catch(function (e) {
          reqBtn.textContent = 'Failed'; showToast('Could not send request: ' + e.message);
          setTimeout(function () { reqBtn.textContent = 'Send friend request'; reqBtn.disabled = false; }, 1500);
        });
      });
      addRow.appendChild(idInput); addRow.appendChild(reqBtn);
      body.appendChild(addRow);

      if (pendingRequests.length) {
        var reqHead = document.createElement('div');
        reqHead.style.cssText = 'margin-top:14px;font-weight:700;';
        reqHead.textContent = 'Requests';
        body.appendChild(reqHead);
        pendingRequests.forEach(function (r) {
          var row = document.createElement('div');
          row.className = 'nwb-contact-row';
          var label = document.createElement('div');
          label.style.flex = '1 1 auto';
          label.textContent = requestToMessageText(r);
          var acceptBtn = document.createElement('button');
          acceptBtn.className = 'nwb-btn'; acceptBtn.type = 'button'; acceptBtn.tabIndex = -1;
          acceptBtn.textContent = r.type === 'friend' ? 'Accept' : 'Allow';
          acceptBtn.addEventListener('click', function () { respondToRequest(r, true); renderDialog(); });
          var declineBtn = document.createElement('button');
          declineBtn.className = 'nwb-btn'; declineBtn.type = 'button'; declineBtn.tabIndex = -1;
          declineBtn.textContent = 'Decline';
          declineBtn.addEventListener('click', function () { respondToRequest(r, false); renderDialog(); });
          row.appendChild(label); row.appendChild(acceptBtn); row.appendChild(declineBtn);
          body.appendChild(row);
        });
      }

      var friendsHead = document.createElement('div');
      friendsHead.style.cssText = 'margin-top:14px;font-weight:700;';
      friendsHead.textContent = 'Friends';
      body.appendChild(friendsHead);

      if (!liveFriends.length) {
        var empty = document.createElement('div');
        empty.style.opacity = '.6';
        empty.textContent = 'No friends yet - send someone your Warband ID, or ask for theirs.';
        body.appendChild(empty);
      }
      liveFriends.forEach(function (f) {
        var row = document.createElement('div');
        row.className = 'nwb-contact-row';
        row.appendChild(iconEl(f.id, friendName(f.id)));
        var nameWrap = document.createElement('div');
        nameWrap.style.flex = '1 1 auto';
        var nameInput = document.createElement('input');
        nameInput.type = 'text'; nameInput.tabIndex = -1;
        nameInput.value = store.friendNames[f.id] || '';
        nameInput.placeholder = f.id.slice(0, 8);
        nameInput.style.cssText = 'border:none;background:transparent;font:700 inherit;width:100%;color:inherit;';
        nameInput.addEventListener('change', function () { setFriendName(f.id, nameInput.value); });
        nameWrap.appendChild(nameInput);
        var status = document.createElement('div');
        status.style.cssText = 'font-size:11px;opacity:.6;';
        status.textContent = f.online ? 'Online' : 'Offline';
        nameWrap.appendChild(status);
        row.appendChild(nameWrap);

        var joinBtn = document.createElement('button');
        joinBtn.className = 'nwb-btn'; joinBtn.type = 'button'; joinBtn.tabIndex = -1;
        joinBtn.textContent = 'Ask to join';
        joinBtn.title = 'Sends a request - they have to approve it before you join.';
        joinBtn.addEventListener('click', function () {
          sendJoinRequest(f.id).then(function () { joinBtn.textContent = 'Asked!'; })
            .catch(function (e) { showToast('Could not ask: ' + e.message); });
          setTimeout(function () { joinBtn.textContent = 'Ask to join'; }, 2000);
        });
        var inviteBtn = document.createElement('button');
        inviteBtn.className = 'nwb-btn'; inviteBtn.type = 'button'; inviteBtn.tabIndex = -1;
        inviteBtn.textContent = 'Invite';
        inviteBtn.title = 'Invites them to your squad - they have to accept before they join.';
        inviteBtn.addEventListener('click', function () {
          sendInvite(f.id).then(function () { inviteBtn.textContent = 'Invited!'; })
            .catch(function (e) { showToast('Could not invite: ' + e.message); });
          setTimeout(function () { inviteBtn.textContent = 'Invite'; }, 2000);
        });
        var msgBtn = document.createElement('button');
        msgBtn.className = 'nwb-btn'; msgBtn.type = 'button'; msgBtn.tabIndex = -1;
        msgBtn.textContent = 'Message';
        msgBtn.addEventListener('click', function () { openChatWith(f.id); });

        var giftBtn = document.createElement('button');
        giftBtn.className = 'nwb-btn'; giftBtn.type = 'button'; giftBtn.tabIndex = -1;
        giftBtn.textContent = 'Gift';
        giftBtn.title = 'Send them some of your acorns - cosmetic currency only, never a stat.';
        giftBtn.addEventListener('click', function () { openGiftWith(f.id); });

        row.appendChild(joinBtn); row.appendChild(inviteBtn); row.appendChild(msgBtn); row.appendChild(giftBtn);
        body.appendChild(row);
      });

      if (activeChatWith) renderChatBox(body);
      if (activeGiftWith) renderGiftBox(body);
    }

    var activeGiftWith = null;
    function openGiftWith(id) { activeGiftWith = id; activeChatWith = null; renderDialog(); }
    function renderGiftBox(body) {
      var wrap = document.createElement('div');
      wrap.style.cssText = 'margin-top:14px;border-top:1px solid rgba(0,0,0,.15);padding-top:10px;';
      var head = document.createElement('div');
      head.style.fontWeight = '700';
      head.textContent = 'Gift acorns to ' + friendName(activeGiftWith);
      wrap.appendChild(head);
      var balance = document.createElement('div');
      balance.style.cssText = 'opacity:.6;font-size:12px;margin:4px 0 8px;';
      balance.textContent = 'You have ' + store.acorns + ' 🌰.';
      wrap.appendChild(balance);

      var row = document.createElement('div');
      row.className = 'nwb-add-row';
      var input = document.createElement('input');
      input.type = 'number'; input.min = '1'; input.max = String(Math.max(1, store.acorns));
      input.value = store.acorns > 0 ? String(Math.min(10, store.acorns)) : '';
      input.tabIndex = -1;
      var sendBtn = document.createElement('button');
      sendBtn.className = 'nwb-btn'; sendBtn.type = 'button'; sendBtn.tabIndex = -1;
      sendBtn.textContent = 'Send gift';
      sendBtn.disabled = store.acorns <= 0;
      var giftTarget = activeGiftWith;
      sendBtn.addEventListener('click', function () {
        var amount = Math.floor(Number(input.value));
        sendBtn.disabled = true;
        sendGift(giftTarget, amount).then(function () {
          showToast('Gifted ' + amount + ' acorns to ' + friendName(giftTarget));
          activeGiftWith = null;
          renderDialog();
        }).catch(function (e) {
          showToast('Could not gift: ' + e.message);
          sendBtn.disabled = false;
        });
      });
      row.appendChild(input); row.appendChild(sendBtn);
      wrap.appendChild(row);

      var cancelBtn = document.createElement('button');
      cancelBtn.className = 'nwb-btn'; cancelBtn.type = 'button'; cancelBtn.tabIndex = -1;
      cancelBtn.style.marginTop = '8px';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', function () { activeGiftWith = null; renderDialog(); });
      wrap.appendChild(cancelBtn);

      body.appendChild(wrap);
    }

    var activeChatWith = null;
    function openChatWith(id) { activeChatWith = id; activeGiftWith = null; renderDialog(); }
    function renderChatBox(body) {
      var wrap = document.createElement('div');
      wrap.style.cssText = 'margin-top:14px;border-top:1px solid rgba(0,0,0,.15);padding-top:10px;';
      var head = document.createElement('div');
      head.style.fontWeight = '700';
      head.textContent = 'Message ' + friendName(activeChatWith);
      wrap.appendChild(head);
      var log = document.createElement('div');
      log.style.cssText = 'max-height:120px;overflow-y:auto;margin:6px 0;font-size:12px;';
      (chatLog[activeChatWith] || []).forEach(function (m) {
        var line = document.createElement('div');
        line.textContent = friendName(m.fromId) + ': ' + m.text;
        log.appendChild(line);
      });
      wrap.appendChild(log);
      var row = document.createElement('div');
      row.className = 'nwb-add-row';
      var input = document.createElement('input');
      input.type = 'text'; input.placeholder = 'Message…'; input.tabIndex = -1;
      var sendBtn = document.createElement('button');
      sendBtn.className = 'nwb-btn'; sendBtn.type = 'button'; sendBtn.tabIndex = -1;
      sendBtn.textContent = 'Send';
      var doSend = function () {
        var text = input.value;
        if (!text.trim()) return;
        sendMessage(activeChatWith, text).catch(function (e) { showToast('Could not send: ' + e.message); });
        if (!chatLog[activeChatWith]) chatLog[activeChatWith] = [];
        chatLog[activeChatWith].push({ fromId: myWarbandId(), text: text.trim(), at: Date.now() });
        input.value = '';
        renderDialog();
      };
      sendBtn.addEventListener('click', doSend);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSend(); });
      row.appendChild(input); row.appendChild(sendBtn);
      wrap.appendChild(row);
      body.appendChild(wrap);
    }

    function renderSettingsTab(body) {
      var head = document.createElement('div');
      head.style.fontWeight = '700';
      head.textContent = 'Relay URL';
      body.appendChild(head);
      var note = document.createElement('div');
      note.style.cssText = 'opacity:.6;font-size:12px;margin:4px 0 8px;';
      note.textContent = 'The Friends system needs a small relay server to work - see warband-server/README.md ' +
        'for how to deploy your own free one, then paste the URL it gives you here.';
      body.appendChild(note);
      var row = document.createElement('div');
      row.className = 'nwb-add-row';
      var input = document.createElement('input');
      input.type = 'text'; input.tabIndex = -1;
      input.placeholder = 'https://warband-relay.you.workers.dev';
      input.value = store.relayUrl || '';
      var saveBtn = document.createElement('button');
      saveBtn.className = 'nwb-btn'; saveBtn.type = 'button'; saveBtn.tabIndex = -1;
      saveBtn.textContent = 'Save';
      saveBtn.addEventListener('click', function () {
        store.relayUrl = input.value.trim();
        saveStore();
        startRelayPolling();
        renderDialog();
      });
      row.appendChild(input); row.appendChild(saveBtn);
      body.appendChild(row);

      var popupRow = document.createElement('label');
      popupRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:16px;cursor:pointer;';
      var popupBox = document.createElement('input');
      popupBox.type = 'checkbox'; popupBox.tabIndex = -1;
      popupBox.checked = store.popupsEnabled;
      popupBox.addEventListener('change', function () { store.popupsEnabled = popupBox.checked; saveStore(); });
      var popupLabel = document.createElement('span');
      popupLabel.textContent = 'Show popups for incoming friend/join/invite requests';
      popupRow.appendChild(popupBox); popupRow.appendChild(popupLabel);
      body.appendChild(popupRow);
      var popupNote = document.createElement('div');
      popupNote.style.cssText = 'opacity:.5;font-size:11px;margin-top:4px;';
      popupNote.textContent = 'Off: requests land as a notified message instead, and wait in the ' +
        'Friends tab’s Requests list until you deal with them there.';
      body.appendChild(popupNote);
    }

    function renderQuestsTab(body) {
      ensureWeeklyQuests();
      var acorns = document.createElement('div');
      acorns.className = 'nwb-acorns';
      acorns.textContent = '🌰 ' + store.acorns + ' acorns';
      body.appendChild(acorns);

      store.quests.active.forEach(function (qid) {
        var q = QUEST_BY_ID[qid];
        if (!q) return;
        var claimed = isQuestClaimed(qid);
        var progress = Math.min(questProgress(q.stat), q.target);
        var row = document.createElement('div');
        row.className = 'nwb-quest-row';
        var label = document.createElement('div');
        label.className = 'nwb-quest-label';
        label.innerHTML = '<span>' + esc(q.label) + '</span><span>' + progress + ' / ' + q.target + '</span>';
        row.appendChild(label);
        var bar = document.createElement('div');
        bar.className = 'nwb-bar';
        var fill = document.createElement('div');
        fill.className = 'nwb-bar-fill';
        fill.style.width = (progress / q.target * 100) + '%';
        bar.appendChild(fill);
        row.appendChild(bar);
        if (progress >= q.target) {
          var claimBtn = document.createElement('button');
          claimBtn.className = 'nwb-btn'; claimBtn.type = 'button'; claimBtn.tabIndex = -1;
          claimBtn.style.marginTop = '6px';
          claimBtn.disabled = claimed;
          claimBtn.textContent = claimed ? ('Claimed +' + q.reward) : ('Claim +' + q.reward + ' acorns');
          claimBtn.addEventListener('click', function () { if (claimQuest(qid)) renderDialog(); });
          row.appendChild(claimBtn);
        }
        body.appendChild(row);
      });

      var refreshNote = document.createElement('div');
      refreshNote.style.cssText = 'opacity:.5;font-size:11px;margin-top:10px;';
      refreshNote.textContent = 'New quests every 7 days.';
      body.appendChild(refreshNote);

      var head = document.createElement('div');
      head.style.cssText = 'margin-top:16px;font-weight:700;';
      head.textContent = 'Badges';
      body.appendChild(head);

      BADGES.forEach(function (b) {
        var owned = !!store.badges[b.id];
        var row = document.createElement('div');
        row.className = 'nwb-badge-row';
        var emoji = document.createElement('div');
        emoji.className = 'nwb-badge-emoji';
        emoji.textContent = b.emoji;
        var name = document.createElement('div');
        name.style.flex = '1 1 auto';
        name.textContent = b.name + (owned ? '' : ' - ' + b.cost + ' acorns');
        var btn = document.createElement('button');
        btn.className = 'nwb-btn'; btn.type = 'button'; btn.tabIndex = -1;
        if (owned) {
          btn.textContent = equippedBadge === b.id ? 'Equipped' : 'Wear';
          btn.disabled = equippedBadge === b.id;
          btn.addEventListener('click', function () { setEquippedBadge(equippedBadge === b.id ? null : b.id); renderDialog(); });
        } else {
          btn.textContent = 'Buy';
          btn.disabled = store.acorns < b.cost;
          btn.addEventListener('click', function () { if (buyBadge(b.id)) renderDialog(); });
        }
        row.appendChild(emoji); row.appendChild(name); row.appendChild(btn);
        body.appendChild(row);
      });

      var badgeNote = document.createElement('div');
      badgeNote.style.cssText = 'opacity:.5;font-size:11px;margin-top:10px;';
      badgeNote.textContent = 'Badges show as a small icon in the corner of your own screen only - ' +
        'they never touch your equipped gear or your stats, on purpose.';
      body.appendChild(badgeNote);
    }

    // Rebuilds the whole dialog body from scratch - fine for a click-
    // triggered refresh (Save, Accept/Decline, switching tabs), but the
    // background timers below also call this to keep progress bars and
    // friend status live, and doing that while you're mid-typing in one
    // of this dialog's own inputs would wipe the field and drop focus on
    // every tick. Skip the rebuild in that one case; a real user action
    // (a button click) always moves focus off the input first anyway, so
    // this never blocks an actual refresh you asked for.
    function renderDialog() {
      if (!wbDialogEl) return;
      var active = document.activeElement;
      if (active && wbDialogEl.contains(active) && /input|textarea/i.test(active.tagName)) return;
      var body = wbDialogEl.querySelector('.nwb-body');
      body.innerHTML = '';

      var tabs = document.createElement('div');
      tabs.className = 'nwb-tabs';
      ['Friends', 'Quests', 'Settings'].forEach(function (name) {
        var b = document.createElement('button');
        b.type = 'button'; b.tabIndex = -1;
        b.className = 'nwb-tab' + (activeWbTab === name ? ' nwb-tab-active' : '');
        b.textContent = name;
        b.addEventListener('click', function () { activeWbTab = name; renderDialog(); });
        tabs.appendChild(b);
      });
      body.appendChild(tabs);

      if (activeWbTab === 'Friends') renderFriendsTab(body);
      else if (activeWbTab === 'Settings') renderSettingsTab(body);
      else renderQuestsTab(body);
      questsDialogEl = wbDialogEl;
    }

    function openDialog() {
      if (wbDialogEl && wbDialogEl.isConnected) return;
      var host = document.getElementById('gameWrapper') || document.body;

      wbCurtainEl = document.createElement('div');
      wbCurtainEl.className = 'dialogCurtain fullScreen';
      wbCurtainEl.style.zIndex = '99';
      wbCurtainEl.addEventListener('click', closeDialog);
      host.appendChild(wbCurtainEl);

      wbDialogEl = document.createElement('div');
      wbDialogEl.className = 'dialog wrinkledPaper';
      wbDialogEl.id = 'nwb-dialog';
      wbDialogEl.style.setProperty('--wrinkled-paper-seed', seed());
      wbDialogEl.style.zIndex = '100';

      var title = document.createElement('h2');
      title.className = 'dialogTitle blueNight';
      title.textContent = 'Warband (Beta)';
      wbDialogEl.appendChild(title);

      var list = document.createElement('div');
      list.className = 'settings-list';
      var body = document.createElement('div');
      body.className = 'nwb-body';
      list.appendChild(body);
      wbDialogEl.appendChild(list);
      renderDialog();

      var btns = document.createElement('div');
      btns.className = 'dialogButtonsContainer';
      var doneBtn = document.createElement('button');
      doneBtn.className = 'dialog-button blueNight wrinkledPaper';
      doneBtn.tabIndex = -1;
      doneBtn.style.setProperty('--wrinkled-paper-seed', seed());
      doneBtn.innerHTML = '<span>Done</span>';
      doneBtn.addEventListener('click', function (e) { e.preventDefault(); closeDialog(); });
      btns.appendChild(doneBtn);
      wbDialogEl.appendChild(btns);

      ['keydown', 'keyup', 'keypress'].forEach(function (t) {
        wbDialogEl.addEventListener(t, function (e) { e.stopPropagation(); });
      });
      if (document.pointerLockElement) document.exitPointerLock();

      host.appendChild(wbDialogEl);
    }

    window.addEventListener('keydown', function (e) {
      if (e.code === 'Escape' && wbDialogEl && wbDialogEl.isConnected) {
        e.preventDefault(); e.stopPropagation(); closeDialog();
      }
    }, true);

    // Keeps progress bars/friend status live - see the guard inside
    // renderDialog() itself for why this is safe to call blindly even
    // while you might be typing in one of the dialog's inputs.
    setInterval(function () { if (wbDialogEl && wbDialogEl.isConnected) renderDialog(); }, 1000);

    /* ---- menu button ---- */

    var WARBAND_ICON = '<svg viewBox="0 0 101 104" xmlns="http://www.w3.org/2000/svg">' +
      '<circle cx="30" cy="55" r="18" fill="none" stroke="black" stroke-width="7"/>' +
      '<circle cx="70" cy="55" r="18" fill="none" stroke="black" stroke-width="7"/>' +
      '<path d="M30 20v17M70 20v17" stroke="black" stroke-width="7" stroke-linecap="round"/>' +
      '<circle cx="30" cy="14" r="7" fill="black"/><circle cx="70" cy="14" r="7" fill="black"/>' +
      '</svg>';
    var WARBAND_ICON_URL = 'data:image/svg+xml,' + encodeURIComponent(WARBAND_ICON);

    function injectMenuButton() {
      var bar = document.querySelector('.menu-buttons-container');
      if (!bar || bar.querySelector('#nwb-menu-button')) return;

      var c = document.createElement('div');
      c.className = 'main-menu-button-container';
      c.id = 'nwb-menu-button';

      var b = document.createElement('button');
      b.className = 'wrinkledPaper main-menu-button';
      b.setAttribute('aria-label', 'Warband (Beta)');
      b.tabIndex = -1;
      b.style.setProperty('--wrinkled-paper-seed', seed());

      var img = document.createElement('div');
      img.className = 'buttonImage';
      img.style.backgroundImage = 'url("' + WARBAND_ICON_URL + '")';
      img.style.backgroundSize = '90%';
      b.appendChild(img);

      var l = document.createElement('div');
      l.className = 'main-menu-button-text whiteBigText blueNight';
      l.setAttribute('aria-hidden', 'true');
      l.textContent = 'Warband (Beta)';

      c.appendChild(b); c.appendChild(l);
      b.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (wbDialogEl && wbDialogEl.isConnected) closeDialog(); else openDialog();
      });

      var sibs = Array.prototype.slice.call(bar.querySelectorAll('.main-menu-button-container'));
      var anchor = sibs.filter(function (x) {
        var t = (x.textContent || '').trim();
        return t === 'Crosshair' || t === 'Health' || t === 'Settings' ||
               t === '1 Kill = 1 Stat Point' || t === 'Hotkeys' || t === 'Target Practice' || t === 'Achievements';
      }).pop();
      if (anchor && anchor.nextSibling) bar.insertBefore(c, anchor.nextSibling);
      else bar.appendChild(c);
    }
    injectMenuButton();
    setInterval(injectMenuButton, 1000);
    setInterval(renderBadgeHud, 2000);

    /* ================================================================ *
     * 2b. Squad chat - a nicer floating panel around the game's own real
     * chat textbox. Finds the native input by its own placeholder text
     * (the same "Press T to chat with your squad" the game already
     * ships), so this never sends or receives anything the game itself
     * wouldn't - it only repositions what's already there.
     * ================================================================ */

    var chatPanelEl = null, nativeChatInput = null;
    function findNativeChatInput() {
      if (nativeChatInput && nativeChatInput.isConnected) return nativeChatInput;
      var inputs = document.querySelectorAll('input[placeholder], textarea[placeholder]');
      for (var i = 0; i < inputs.length; i++) {
        if (/chat with your squad/i.test(inputs[i].placeholder || '')) { nativeChatInput = inputs[i]; return inputs[i]; }
      }
      return null;
    }
    function toggleChatPanel() {
      if (!chatPanelEl) {
        chatPanelEl = document.createElement('div');
        chatPanelEl.id = 'nwb-chat';
        var log = document.createElement('div');
        log.className = 'nwb-chat-log';
        chatPanelEl.appendChild(log);
        document.body.appendChild(chatPanelEl);
      }
      chatPanelEl.classList.toggle('nwb-chat-open');
    }
    var hotkeyGuard = false;
    window.addEventListener('keydown', function (e) {
      if (hotkeyGuard) return;
      if (e.code === 'KeyT' && !(document.activeElement && /input|textarea/i.test(document.activeElement.tagName))) {
        // Let the game's own T-to-chat do its thing; just make sure our
        // panel is visible while that box is open, matching the same key.
        hotkeyGuard = true;
        setTimeout(function () { hotkeyGuard = false; }, 50);
        if (chatPanelEl && !chatPanelEl.classList.contains('nwb-chat-open')) toggleChatPanel();
      }
    });

    startRelayPolling();

    PAGE.NarrowWarband = window.NarrowWarband = {
      store: store,
      quests: { pool: QUEST_POOL, active: function () { return store.quests.active; }, claim: claimQuest },
      badges: BADGES,
      myWarbandId: myWarbandId,
      myCode: myCode,
      joinByCode: joinByCode,
      sendFriendRequest: sendFriendRequest,
      respondFriendRequest: respondFriendRequest,
      sendJoinRequest: sendJoinRequest,
      sendInvite: sendInvite,
      respondRequest: respondRequest,
      sendMessage: sendMessage,
      sendGift: sendGift,
      refreshFriends: refreshFriends,
      liveFriends: function () { return liveFriends; },
      patchState: patchState
    };

    console.log('[Warband] ready. Patched copy in cache:', patchState.patched);
  });
})();
