// ==UserScript==
// @name         Achievements
// @namespace    narrowone-achievements
// @version      1.8.1
// @description  The game's own Steam achievements, working in the browser, plus a tiered set of new ones - a trophy button in the main menu, with toast pop-ups and progress bars.
// @author       Frogwagon
// @match        https://narrow.one/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

/*
 * Achievements  -  Narrow One
 * ---------------------------
 * Two sets of achievements:
 *
 * 1. The game's own Steam achievements. The client already has every one of
 *    their unlock conditions built in and already runs them during ordinary
 *    play - they just go nowhere in a browser. Every place the game decides
 *    you've earned one, it calls one function:
 *
 *        function Lt(t){ "steamworks" in globalThis && steamworks.achievement.activate(t) }   // (shown with spaces for readability - the real minified text has none)
 *
 *    which is a no-op unless something named `steamworks` exists on the
 *    page (that's only true inside the Steam build's own wrapper).
 *
 *    v1.6.0 and earlier gave the page a fake `steamworks` object to satisfy
 *    that check - which worked, but was wrong: `"steamworks"in globalThis`
 *    isn't only read here. Making the browser look like the Steam build
 *    made the game skip its own Pelican Party+ perk handling too, since
 *    that's normally the Steam build's job to skip (Steam has its own
 *    entitlements). That's almost certainly what broke people's perks, and
 *    it's fixed since 1.6.1 by never touching `steamworks`/`globalThis` at
 *    all - the game is left thinking it's exactly the ordinary browser
 *    build it is.
 *
 *    Instead, this patches Lt() itself (the same one-line, cache-rewrite
 *    technique every mod here uses for po() - see 1 Kill = 1 Stat Point's
 *    header) to also call this mod's own hook, alongside its original body,
 *    completely unchanged:
 *
 *        function Lt(t){"steamworks"in globalThis&&steamworks.achievement.activate(t);
 *          window.__NARROW_ACH_TRIGGER&&window.__NARROW_ACH_TRIGGER(t)}
 *
 *    Same conditions, same moment, same seventeen ids the game already
 *    decides on its own - this only catches the call. Reversible by
 *    removing this script; nothing about the game itself is changed.
 *
 *    The ids are real (grepped straight out of the bundle), but Steam's own
 *    achievement names and descriptions live on Steam's servers, not in the
 *    client - the browser build never sees them. So the name and
 *    description for each one below is this mod's own guess at what the id
 *    and its surrounding code are going for, not the official text.
 *
 * 2. A tiered set of new ones this mod tracks itself, plus a handful of
 *    one-off "Special" achievements that don't fit a numeric ladder -
 *    nothing here reaches further into the game than Settings & Stats
 *    already does (score, kills, matches) or the hit-hook described below.
 *
 *    v1.7.0 restructured every countable stat (kills, headshots, long-range
 *    hits, flag captures, assists, wins, matches) into five-tier ladders,
 *    each with three flavours where they make sense:
 *      - Plain  - an all-time running total, carried across every session.
 *      - Game   - the most you've done in one single match.
 *      - Streak - in a row, without breaking it.
 *    Reaching a high tier in one jump (e.g. a 22-headshot streak, skipping
 *    past the row's own T2 and T3) unlocks every lower tier in that SAME
 *    row too, since you plainly passed through them - but never unlocks
 *    anything in a different row. Tabs at the top of the dialog (T1-T5,
 *    Specials) split all of it up; each tiered row gets a progress bar.
 *
 * Both sets need the same one-off cache patch 1 Kill = 1 Stat Point uses
 * (see that mod's header for the full reasoning) - applied automatically
 * here too, no button, one reload the first time.
 */

(function () {
  'use strict';

  var PAGE = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;

  /* ================================================================== *
   * Part 0 - the Steam achievement bridge. Never touches
   * `steamworks`/`globalThis` - it only has to exist before the patched
   * Lt() could possibly call it, which is never before document-start
   * finishes running this script.
   * ================================================================== */

  var pendingSteamIds = [];
  var steamUnlock = function (id) { pendingSteamIds.push(id); };   // replaced once Part 2 is ready
  PAGE.__NARROW_ACH_TRIGGER = function (id) { steamUnlock(id); };

  var ENTRY_RE = /\/js\/index-[^/]*\.js$/;
  var PO_RE = /function ([A-Za-z_$][\w$]*)\(\)\{if\(!([A-Za-z_$][\w$]*)\)throw new Error\("Main instance is not initialized"\);return \2\}/;
  var LT_RE = /function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\{"steamworks"in globalThis&&steamworks\.achievement\.activate\(\2\)\}/;
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

    // Best-effort: the Steam-achievement hook. Never touches steamworks or
    // globalThis itself - only adds a second, unconditional call alongside
    // the original body, so the game's own Steam-detection is untouched
    // either way. If the game's code has changed and this no longer
    // matches, the po() patch above still applies - achievements simply
    // fall back to only the custom, self-tracked ones.
    var withLt = out.replace(LT_RE,
      'function $1($2){"steamworks"in globalThis&&steamworks.achievement.activate($2);' +
      'window.__NARROW_ACH_TRIGGER&&window.__NARROW_ACH_TRIGGER($2)}');
    if (withLt === out) {
      console.warn('[Achievements] could not find the Steam achievement trigger function - the seventeen Steam-mirrored achievements will not fire, but the custom ones are unaffected.');
    }
    return withLt;
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
          console.log('[Achievements] patched the game - reloading once to connect.');
          location.reload();
        }).catch(function (e) {
          patchState.error = e.message;
          console.warn('[Achievements] could not patch:', e.message);
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
    if (PAGE.__narrowOneAchievements) return;
    PAGE.__narrowOneAchievements = true;

    /* ================================================================ *
     * Ladders - the tiered achievements. One entry per stat; each `types`
     * key (plain/game/streak) that exists gets its own row of 5 tiers.
     * Tier thresholds and names are this mod's own design, not the game's.
     * ================================================================ */

    var LADDERS = [
      { key: 'kills', label: 'Kills', types: {
        plain:  { label: 'Kills (all-time)',      tiers: [100, 500, 1500, 5000, 15000],
          names: ['Blooded', 'Killer', 'Slayer', 'Executioner', 'Reaper'] },
        game:   { label: 'Kills (one match)',      tiers: [5, 10, 20, 35, 60],
          names: ['Warmed Up', 'Kill Count', 'Rampager', 'Juggernaut', 'Unkillable'] },
        streak: { label: 'Kill streak',            tiers: [5, 15, 35, 75, 150],
          names: ['First Streak', 'Rampage', 'Unstoppable', 'Godlike', 'Legendary'] }
      }},
      { key: 'headshots', label: 'Headshots', types: {
        plain:  { label: 'Headshots (all-time)',   tiers: [10, 50, 150, 400, 1000],
          names: ['Point and Click', 'Fifty Skulls', 'Headshot Habit', 'Cranial Specialist', 'Headshot Legend'] },
        game:   { label: 'Headshots (one match)',  tiers: [3, 10, 20, 35, 50],
          names: ['Getting Started', 'Headhunter', 'Skull Farmer', 'Cranium Collector', 'Head Case'] },
        streak: { label: 'Headshot streak',        tiers: [3, 8, 15, 22, 30],
          names: ['Warm Up', 'Marksman', 'Sharpshooter', 'Cranial Cascade', 'Skullstorm'] }
      }},
      { key: 'longRange', label: 'Long Range', types: {
        plain:  { label: 'Long-range hits (all-time)', tiers: [10, 50, 150, 400, 1000],
          names: ['First Steps Back', 'Distance Runner', 'Long Game', 'Horizon Chaser', 'Sniper Legend'] },
        game:   { label: 'Long-range hits (one match)', tiers: [3, 10, 20, 35, 50],
          names: ['Reaching Out', 'Long Range Ace', 'Far Shot Fanatic', 'Horizon Hunter', 'Beyond the Veil'] },
        streak: { label: 'Long-range streak',      tiers: [3, 8, 15, 25, 50],
          names: ['Ranging', 'Distance Shooter', 'Longshot', 'Eagle Eye', 'Sniper'] }
      }},
      { key: 'flags', label: 'Flag Captures', types: {
        plain: { label: 'Flag captures (all-time)', tiers: [5, 20, 60, 150, 400],
          names: ['First Flag', 'Flag Collector', 'Flag Hoarder', 'Capture Veteran', 'Flag Legend'] },
        game:  { label: 'Flag captures (one match)', tiers: [1, 5, 15, 40, 100],
          names: ['Flag Bearer', 'Flag Runner', 'Flag Fanatic', 'Capture Specialist', "Match's Flag Legend"] }
      }},
      { key: 'assists', label: 'Assists', types: {
        plain: { label: 'Assists (all-time)',      tiers: [15, 75, 250, 600, 1500],
          names: ['Helper', 'Support Main', 'Assist Veteran', 'Team Backbone', 'Assist Legend'] },
        game:  { label: 'Assists (one match)',     tiers: [3, 8, 12, 18, 25],
          names: ['Helping Hand', 'Assist Artist', 'Support Specialist', 'Team Carry', 'Playmaker'] }
      }},
      { key: 'wins', label: 'Wins', types: {
        plain: { label: 'Wins (all-time)',         tiers: [1, 5, 15, 30, 60],
          names: ['First Victory', 'Regular Winner', 'Veteran Winner', 'Champion', 'Legend of the Arena'] }
      }},
      { key: 'matchesSession', label: 'Matches (this session)', types: {
        plain: { label: 'Matches this session',    tiers: [5, 10, 20, 40, 80],
          names: ['Warming Up', 'Regular', 'Grinding', 'Marathoner', 'Session Grinder'] }
      }},
      { key: 'matchesAllTime', label: 'Matches (all-time)', types: {
        plain: { label: 'Matches all-time',        tiers: [10, 25, 50, 100, 250],
          names: ['Newcomer', 'Regular', 'Veteran', 'Elite', 'All-Time Legend'] }
      }}
    ];

    function tierId(key, type, tierNum) { return 't_' + key + '_' + type + '_' + tierNum; }

    var LADDERS_BY_KEY = {};
    LADDERS.forEach(function (l) { LADDERS_BY_KEY[l.key] = l; });

    /* ================================================================ *
     * Achievement definitions - the tier ladders above, generated, plus
     * the Steam-mirrored set and a handful of one-off Specials that don't
     * reduce to a single number (combos, timing, weapon-specific, etc.)
     *
     * source: 'steam'  - the game's own condition, caught via the bridge
     *                    above; this mod does not decide when these fire.
     *         'custom' - tracked by this mod, from data Settings & Stats
     *                    already reads the same way (score, kills, matches),
     *                    plus the hit-hook described further down.
     * tier:    1-5 for a ladder rung, absent for Steam and Special ones.
     * ================================================================ */

    var ACHIEVEMENTS = [];

    LADDERS.forEach(function (ladder) {
      Object.keys(ladder.types).forEach(function (type) {
        var t = ladder.types[type];
        for (var i = 0; i < 5; i++) {
          var tierNum = i + 1;
          var typeWord = type === 'plain' ? 'total' : type === 'game' ? 'in a single match' : 'in a row';
          ACHIEVEMENTS.push({
            id: tierId(ladder.key, type, tierNum),
            source: 'custom',
            tier: tierNum,
            ladderKey: ladder.key,
            ladderType: type,
            threshold: t.tiers[i],
            name: t.names[i],
            desc: (i === 0 ? 'Reach ' : 'Reach ') + t.tiers[i] + ' ' + ladder.label.toLowerCase() + ' ' + typeWord + '.'
          });
        }
      });
    });

    // --- Steam, mirrored (ids straight from the bundle; names/text are
    // this mod's own best reading of the surrounding code, not Steam's
    // official text, which the browser client never receives) ---
    ACHIEVEMENTS.push(
      { id: 'absorbTenArrows', source: 'steam', name: 'Walking Pincushion',
        desc: 'Take 10 armored arrow hits in one life without dying.' },
      { id: 'allPointTypesCtf', source: 'steam', name: 'Renaissance Player',
        desc: 'Score every kind of point in a single Capture the Flag match.' },
      { id: 'captureFlagAfterThree', source: 'steam', name: "Fourth Time's the Charm",
        desc: 'Capture the flag after it has changed hands three times since it was last returned.' },
      { id: 'dropFlagTwenty', source: 'steam', name: 'Butterfingers',
        desc: 'Drop the flag as its carrier 20 times.' },
      { id: 'fryingPanDeath', source: 'steam', name: 'Well Done',
        desc: 'Die to a frying pan.' },
      { id: 'headshotBeforeFallDeath', source: 'steam', name: 'Domino Effect',
        desc: 'Fall to your death moments after landing a headshot kill. (Best-guess reading - the exact trigger is unclear from the code.)' },
      { id: 'headshotTenNoMisses', source: 'steam', name: 'Perfect Aim',
        desc: 'Land 10 headshot kills in a row without a headshot miss in between.' },
      { id: 'hundredKillsNoDying', source: 'steam', name: 'Immortal Legend',
        desc: 'Get 100 kills in one life without dying.' },
      { id: 'killWithFork', source: 'steam', name: 'Fork This',
        desc: 'Kill with a fully charged fork.' },
      { id: 'killedByMeleeSpammer', source: 'steam', name: 'Skewered',
        desc: 'Get killed by a melee spammer.' },
      { id: 'ownTwoHundredItems', source: 'steam', name: 'Collector',
        desc: 'Own 200 shop items.' },
      { id: 'stunAndSmallCrossbowKill', source: 'steam', name: 'One-Two Punch',
        desc: 'Stun a player with heavy melee, then finish them with the small crossbow.' },
      { id: 'thirtyMinuteMatch', source: 'steam', name: 'Marathon',
        desc: 'Finish a match that ran 30 minutes or longer.' },
      { id: 'thousandCoinsOneGame', source: 'steam', name: 'Jackpot',
        desc: 'Earn 1,000 coins in a single game.' },
      { id: 'twelvePlayerSquad', source: 'steam', name: 'Full Squad',
        desc: 'Get 12 players into your squad at once.' },
      { id: 'ultraLongRange', source: 'steam', name: 'Ultra Long Range',
        desc: 'Land a hit from ultra long range.' },
      { id: 'winAllMapsAsMonk', source: 'steam', name: 'Pilgrim',
        desc: "Win a match on every map in the game while wearing the Monk skin. Confirmed straight from the bundle - the win check and the equippedSkinData.equippedSkinIds.includes(\"monkArms\") check are both right there in the code, so unlike some of the others above, this one isn't a guess." }
    );

    // --- Custom Specials - don't reduce to a single ladder number ---
    ACHIEVEMENTS.push(
      { id: 'firstBlood', source: 'custom', name: 'First Blood',
        desc: 'Get a kill within 8 seconds of the match starting.' },
      { id: 'comeback', source: 'custom', name: 'Comeback',
        desc: 'Get a kill within 5 seconds of respawning.' },
      { id: 'flawless', source: 'custom', name: 'Flawless',
        desc: 'Get 8 or more kills in a match without dying once.' },
      { id: 'highRoller', source: 'custom', name: 'High Roller',
        desc: 'Earn an estimated 500 coins in a single match (1 coin per 10 points, rounded up).' },
      { id: 'teamPlayer', source: 'custom', name: 'Team Player',
        desc: 'Rack up 15 assists, carrier assists and capture assists combined in a single match.' },
      { id: 'carrierKiller', source: 'custom', name: 'Carrier Killer',
        desc: 'Kill the flag carrier 8 times in a single match.' },
      { id: 'grabAndGo', source: 'custom', name: 'Grab and Go',
        desc: 'Grab the flag 20 times in a single match.' },
      { id: 'returnToSender', source: 'custom', name: 'Return to Sender',
        desc: "Return your team's flag 12 times in a single match." },
      { id: 'denialAndDelivery', source: 'custom', name: 'Denial and Delivery',
        desc: "Return your team's flag and capture the enemy's, in the same match." },
      { id: 'onTheHill', source: 'custom', name: 'King of the Hill',
        desc: 'Score the On the Hill point 12 times in a single match.' },
      { id: 'allHeadshots', source: 'custom', name: 'All Headshots',
        desc: 'Get 8 or more kills in a match where every single one was a headshot.' },
      { id: 'porcupine', source: 'custom', name: 'Porcupine',
        desc: 'Take 20 hits in one life without dying. (Tracked from your own health dropping, so a melee hit counts too, not only arrows - the game\'s own "10 armored arrow hits" check above is arrow-only, but reads a private counter this mod can\'t reach.)' },
      { id: 'nomad', source: 'custom', name: 'Nomad',
        desc: "Win a match on every map while wearing the Monk skin - this mod's own count toward the same goal as the Steam Pilgrim achievement above, tracked separately by map, so you can watch it add up (NarrowAchievements.store.nomadMaps in the console). Needs the map list to have loaded to know when it's complete." },
      { id: 'perfectGame', source: 'custom', name: 'The Perfect Game',
        desc: "In one match: 20+ kills, 3+ flag captures, 20+ assists, 25+ headshot hits, 25+ long-range hits, and fewer than 5 deaths. The headshot and long-range counts here are real hits landed, not kills - read off the same public hit-processing method as \"There Was Nothing In There Anyway\" below, so a non-lethal headshot or a long-range hit that didn't finish anyone off still counts." },
      { id: 'masterBowsman', source: 'custom', name: 'Master Bowsman',
        desc: "Get 10 kills with each of the game's six bows, in a single match (60 kills total). Kills are credited to whichever bow is equipped the instant this mod notices the kill (about twice a second) - the client has no per-kill weapon log, so swapping bows in that split second right after a kill could rarely credit the wrong one." },
      { id: 'runnerStreak10', source: 'custom', name: "Runner's High",
        desc: 'Get a 10-kill streak using the small crossbow with its "Runner" skin equipped - dying, switching bows, or a kill landed on anything else resets it to zero. Same weapon-at-kill-time approximation as Master Bowsman.' },
      { id: 'thereWasNothingInThereAnyway', source: 'custom', name: 'There Was Nothing In There Anyway',
        desc: "Take 15 hits to the head in one life without dying - regenerating health doesn't reset the count, only dying does. This one isn't an approximation: the game computes the exact hit location on every valid arrow hit, lethal or not, in a plain method on the player class (markValidArrowHit) that isn't hidden behind a private field like the counters some of the Steam ones use - so this mod wraps that method directly and reads the real thing, both for this and for the headshot/long-range hit counts in The Perfect Game above." }
    );

    var BY_ID = {};
    ACHIEVEMENTS.forEach(function (a) { BY_ID[a.id] = a; });

    /* ================================================================ *
     * Store - unlock timestamps, all-time lifetime totals for the "plain"
     * ladders, and the small amount of other persistent progress a couple
     * of the Special achievements need.
     * ================================================================ */

    var STORE_KEY = 'narrowone.achievements.v2';
    var store = {
      unlocked: {},
      allTimeMatches: 0,
      nomadMaps: [],
      lifetime: { kills: 0, headshots: 0, longRange: 0, flags: 0, assists: 0, wins: 0 }
    };
    (function loadStore() {
      try {
        var raw = localStorage.getItem(STORE_KEY);
        var old = !raw && localStorage.getItem('narrowone.achievements.v1');   // v1.6.x and earlier
        if (raw || old) {
          var saved = JSON.parse(raw || old);
          if (saved && typeof saved === 'object') {
            store.unlocked = saved.unlocked && typeof saved.unlocked === 'object' ? saved.unlocked : {};
            store.allTimeMatches = Number(saved.allTimeMatches) || 0;
            store.nomadMaps = Array.isArray(saved.nomadMaps) ? saved.nomadMaps : [];
            if (saved.lifetime && typeof saved.lifetime === 'object') {
              ['kills', 'headshots', 'longRange', 'flags', 'assists', 'wins'].forEach(function (k) {
                store.lifetime[k] = Number(saved.lifetime[k]) || 0;
              });
            }
            // Achievement ids changed shape in v2 (tiered ladders replaced
            // several old single-tier ones) - drop any unlock that no
            // longer matches a real id, rather than keep dead keys forever.
            Object.keys(store.unlocked).forEach(function (id) {
              if (!BY_ID[id]) delete store.unlocked[id];
            });
          }
        }
      } catch (e) {}
    })();
    function saveStore() {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) {}
    }

    function isUnlocked(id) { return !!store.unlocked[id]; }

    function unlock(id) {
      if (!BY_ID[id] || isUnlocked(id)) return;
      store.unlocked[id] = Date.now();
      saveStore();
      showToast(BY_ID[id]);
      if (achDialogEl && achDialogEl.isConnected) renderDialog();
    }

    /**
     * Checks every tier of one ladder row (one stat + one type) against a
     * current value and unlocks every tier at or below it - scoped to this
     * exact key+type only, never touching any other row. Tiers ascend, so
     * a value under tier N is also under every tier after it; the loop
     * stops there rather than checking further for nothing.
     */
    function checkLadder(key, type, value) {
      var ladder = LADDERS_BY_KEY[key];
      var t = ladder && ladder.types[type];
      if (!t) return;
      for (var i = 0; i < t.tiers.length; i++) {
        if (value >= t.tiers[i]) unlock(tierId(key, type, i + 1));
        else break;
      }
    }
    function ladderThreshold(key, type, tierNum) {
      var t = LADDERS_BY_KEY[key] && LADDERS_BY_KEY[key].types[type];
      return t ? t.tiers[tierNum - 1] : null;
    }

    // Drain anything the game already called before this ran, then hand the
    // bridge straight to unlock() from here on.
    pendingSteamIds.forEach(unlock);
    pendingSteamIds = [];
    steamUnlock = unlock;

    /* ================================================================ *
     * Reading your own player and match, same shape every other mod here
     * uses - a shallow BFS from window looking for a Map of players with a
     * hasOwnership flag, cached per game object.
     * ================================================================ */

    function collectMatching(root, predicate, limit) {
      var found = [];
      if (!root) return found;
      var seen = new Set();
      var queue = [{ obj: root, depth: 0 }];
      while (queue.length && found.length < limit) {
        var item = queue.shift();
        var obj = item.obj, depth = item.depth;
        if (!obj || typeof obj !== 'object' || seen.has(obj) || depth > 4) continue;
        seen.add(obj);
        if (predicate(obj)) found.push(obj);
        var keys;
        try { keys = Object.keys(obj); } catch (e) { continue; }
        for (var i = 0; i < keys.length && found.length < limit; i++) {
          var v;
          try { v = obj[keys[i]]; } catch (e) { continue; }
          if (v && typeof v === 'object') queue.push({ obj: v, depth: depth + 1 });
        }
      }
      return found;
    }

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

    /* ================================================================ *
     * Custom achievement tracking - one poll, cheap checks, each guarded
     * so a missing field just skips that check rather than throwing.
     * ================================================================ */

    var track = {
      game: null,
      baseline: null,       // { kills, deaths, headshots, longRange, flags, ... } at match start
      wasDead: false,
      streak: 0,             // kill streak
      hsStreak: 0,            // headshot streak
      lrStreak: 0,            // long-range streak
      respawnedAt: 0,
      gameEndedSeen: false,
      matchesThisSession: 0,
      hitsAbsorbed: 0,
      lastHealth: null,
      bowKills: { smallBow: 0, mediumBow: 0, largeBow: 0, smallCrossbow: 0, repeatingCrossbow: 0, largeCrossbow: 0 },
      runnerStreak: 0,
      headshotHitsLanded: 0,   // this match - also "Headshots (one match)" ladder value
      longRangeHitsLanded: 0,  // this match - also "Long-range hits (one match)" ladder value
      headHitsTaken: 0,
      matchKills: 0,
      matchFlags: 0,
      matchAssists: 0
    };
    var BOW_TYPES = ['smallBow', 'mediumBow', 'largeBow', 'smallCrossbow', 'repeatingCrossbow', 'largeCrossbow'];

    function scoreVal(ag, typeId) {
      return (ag && ag.trackedMyPlayerScores && ag.trackedMyPlayerScores.get(typeId)) || 0;
    }

    /* ================================================================ *
     * Real hits, not kills - by patching a public method.
     *
     * The Headshot and Long Range score points (used above) only ever land
     * on a KILL - they're computed as the death cause, not a per-hit event,
     * confirmed straight from the code. But the check that produces that
     * cause runs on every VALID hit, lethal or not:
     *
     *   markValidArrowHit(t, e, i) {              // t = attacker, i.bodyPart = hit location
     *     ...
     *     t.hasOwnership && ("head" == i.bodyPart && (a = "headshotByOwnedPlayer"),
     *       t.pos.distanceTo(this.pos) > 420 && (a = "ultraLongRangeOwner")), ...
     *     if (this.applyDamage(n, o, a)) { ... }
     *   }
     *
     * Unlike the private counters elsewhere in this file, this one is a
     * plain method - no # - sitting on the player class's own prototype, so
     * it can be wrapped like any normal method. Once patched, every hit
     * anyone lands on anyone calls this first, before the original runs, so
     * it sees hits you take as well as hits you land, kill or not - which is
     * exactly what "There Was Nothing In There Anyway" needed and the
     * "Headshot"/"Long Range" score points can't provide on their own.
     */
    var hitHookInstalled = false;
    function installHitHook(ag) {
      if (hitHookInstalled || !ag || !(ag.players instanceof Map) || ag.players.size === 0) return;
      var sample = null;
      ag.players.forEach(function (pl) { if (!sample) sample = pl; });
      var proto = sample && Object.getPrototypeOf(sample);
      var orig = proto && proto.markValidArrowHit;
      if (typeof orig !== 'function' || proto.__nachHitHooked) { if (proto) hitHookInstalled = !!proto.__nachHitHooked; return; }
      proto.__nachHitHooked = true;
      proto.markValidArrowHit = function (attacker, arrow, opts) {
        try { onValidArrowHit(this, attacker, opts); } catch (e) {}
        return orig.call(this, attacker, arrow, opts);
      };
      hitHookInstalled = true;
    }
    function onValidArrowHit(victim, attacker, opts) {
      var bodyPart = opts && opts.bodyPart;
      if (attacker && attacker.hasOwnership) {
        if (bodyPart === 'head') {
          track.headshotHitsLanded = (track.headshotHitsLanded || 0) + 1;
          checkLadder('headshots', 'game', track.headshotHitsLanded);
        }
        if (attacker.pos && victim && victim.pos && typeof attacker.pos.distanceTo === 'function' &&
            attacker.pos.distanceTo(victim.pos) > 420) {
          track.longRangeHitsLanded = (track.longRangeHitsLanded || 0) + 1;
          checkLadder('longRange', 'game', track.longRangeHitsLanded);
        }
      }
      if (victim && victim.hasOwnership && bodyPart === 'head') {
        track.headHitsTaken = (track.headHitsTaken || 0) + 1;
        if (track.headHitsTaken >= 15) unlock('thereWasNothingInThereAnyway');
      }
    }

    function achievementTick() {
      var ag = currentGame();
      var p = findPlayer();
      installHitHook(ag);

      if (ag !== track.game) {
        track.game = ag;
        track.baseline = null;
        track.wasDead = false;
        track.streak = 0;
        track.respawnedAt = 0;
        track.gameEndedSeen = ag ? !!ag.gameEnded : false;
        track.hitsAbsorbed = 0;
        track.lastHealth = null;
        track.bowKills = { smallBow: 0, mediumBow: 0, largeBow: 0, smallCrossbow: 0, repeatingCrossbow: 0, largeCrossbow: 0 };
        track._lastKillsBow = null;
        track.headshotHitsLanded = 0;
        track.longRangeHitsLanded = 0;
        track.headHitsTaken = 0;
        track.matchKills = 0;
        track.matchFlags = 0;
        track.matchAssists = 0;
      }
      if (!ag || !p) return;

      /**
       * Bug fixed here: flags used to read scoreVal(ag, 6) - the "Flag
       * Captures" entry in trackedMyPlayerScores - which turned out to be
       * POINTS awarded for a capture, not a count of captures (a single
       * capture can be worth well more than 1 point). That's why one real
       * capture was cascading through every tier of the Flags ladder at
       * once. scoreKills/scoreDeaths were already safe from this because
       * they read the player's own dedicated count fields instead of the
       * points map; scoreFlags is that same kind of field for flags, and
       * kills is the only other ladder here that already used its safe
       * field - everything else driven by scoreVal() (assists, carrier
       * kills, flag grabs/returns, on-the-hill) has no equivalent count
       * field to fall back to, so it's still reading points there. If any
       * of those turn out to have the same problem, they'd need the same
       * kind of fix, once there's a real count field to switch to.
       */
      if (!track.baseline) {
        track.baseline = {
          kills: p.scoreKills || 0,
          headshots: scoreVal(ag, 10),
          longRange: scoreVal(ag, 11),
          flags: p.scoreFlags || 0,
          assist: scoreVal(ag, 2),
          carrierKill: scoreVal(ag, 3),
          flagGrab: scoreVal(ag, 4),
          carrierAssist: scoreVal(ag, 7),
          winBonus: scoreVal(ag, 8),
          flagReturn: scoreVal(ag, 9),
          captureAssist: scoreVal(ag, 12),
          onHill: scoreVal(ag, 13),
          deaths: p.scoreDeaths || 0
        };
      }

      var kills = p.scoreKills || 0, dead = !!p.dead;
      var headshots = scoreVal(ag, 10), longRange = scoreVal(ag, 11), flags = p.scoreFlags || 0;
      var assist = scoreVal(ag, 2), carrierKill = scoreVal(ag, 3), flagGrab = scoreVal(ag, 4),
          carrierAssist = scoreVal(ag, 7), winBonus = scoreVal(ag, 8), flagReturn = scoreVal(ag, 9),
          captureAssist = scoreVal(ag, 12), onHill = scoreVal(ag, 13);

      var killsThisMatch = kills - track.baseline.kills;
      track.matchKills = killsThisMatch;
      track.matchFlags = flags - track.baseline.flags;
      track.matchAssists = assist - track.baseline.assist;

      // The "game" ladders - live thresholds this match.
      checkLadder('kills', 'game', track.matchKills);
      checkLadder('flags', 'game', track.matchFlags);
      checkLadder('assists', 'game', track.matchAssists);
      // headshots/game and longRange/game are checked from the hit-hook
      // above, the instant a real hit lands, not on this poll.

      // "Plain" (all-time) ladders, live - this match's own progress counts
      // toward them immediately, not just once the match ends and gets
      // banked below. Banking still happens at match end so the total
      // persists even if you never reopen the dialog mid-match.
      checkLadder('kills', 'plain', livePlain(store.lifetime.kills, track.matchKills));
      checkLadder('headshots', 'plain', livePlain(store.lifetime.headshots, track.headshotHitsLanded));
      checkLadder('longRange', 'plain', livePlain(store.lifetime.longRange, track.longRangeHitsLanded));
      checkLadder('flags', 'plain', livePlain(store.lifetime.flags, track.matchFlags));
      checkLadder('assists', 'plain', livePlain(store.lifetime.assists, track.matchAssists));

      // First Blood - a kill within 8s of the match clock starting. Falls
      // back to never firing (fails closed) if the game doesn't expose a
      // usable gameTime on this build.
      if (killsThisMatch >= 1 && typeof ag.gameTime === 'number' && ag.gameTime > 0 && ag.gameTime < 8000) {
        unlock('firstBlood');
      }

      // Victory - the game only ever awards its own Win Bonus point to the winning team.
      var wonThisMatch = winBonus - track.baseline.winBonus >= 1;

      if (assist - track.baseline.assist + (carrierAssist - track.baseline.carrierAssist) +
          (captureAssist - track.baseline.captureAssist) >= 15) unlock('teamPlayer');
      if (carrierKill - track.baseline.carrierKill >= 8) unlock('carrierKiller');
      if (flagGrab - track.baseline.flagGrab >= 20) unlock('grabAndGo');
      if (flagReturn - track.baseline.flagReturn >= 12) unlock('returnToSender');
      if (flagReturn - track.baseline.flagReturn >= 1 && track.matchFlags >= 1) unlock('denialAndDelivery');
      if (onHill - track.baseline.onHill >= 12) unlock('onTheHill');

      // All Headshots - every kill this match landed as a headshot, 8+ of them.
      var headshotsThisMatch = headshots - track.baseline.headshots;
      if (killsThisMatch >= 8 && headshotsThisMatch >= killsThisMatch) unlock('allHeadshots');

      // Headshot / long-range KILL streaks feed the "streak" ladders. Read
      // off raw per-tick deltas rather than the baseline (which is
      // per-match), so a streak survives a match boundary - the tick that
      // crosses it sees a negative delta from the new match's counters
      // dropping to 0, which the ">0" guards below simply ignore rather
      // than mistaking it for a broken streak.
      (function () {
        var lastK = track._lastKillsHS != null ? track._lastKillsHS : kills;
        var lastH = track._lastHeadshotsHS != null ? track._lastHeadshotsHS : headshots;
        var lastL = track._lastLongRangeHS != null ? track._lastLongRangeHS : longRange;
        var dKills = kills - lastK, dHeadshots = headshots - lastH, dLongRange = longRange - lastL;
        if (dKills > 0) {
          track.hsStreak = dHeadshots >= dKills ? (track.hsStreak || 0) + dKills : 0;
          checkLadder('headshots', 'streak', track.hsStreak);
          track.lrStreak = dLongRange >= dKills ? (track.lrStreak || 0) + dKills : 0;
          checkLadder('longRange', 'streak', track.lrStreak);
        }
        track._lastKillsHS = kills;
        track._lastHeadshotsHS = headshots;
        track._lastLongRangeHS = longRange;
      })();

      // The Perfect Game - every one of these at once, in a single match.
      // Headshots/long-range here are real HITS landed (from the hook
      // above), not the kill-locked score points used elsewhere.
      if (killsThisMatch >= 20 && track.matchFlags >= 3 &&
          track.matchAssists >= 20 && track.headshotHitsLanded >= 25 &&
          track.longRangeHitsLanded >= 25 &&
          ((p.scoreDeaths || 0) - track.baseline.deaths) < 5) {
        unlock('perfectGame');
      }

      // High Roller - 500 estimated coins this match (see Settings & Stats'
      // own coin readout for the same 1-per-10-points, rounded-up formula).
      if (Math.ceil((p.scoreTotal || 0) / 10) >= 500) unlock('highRoller');

      // Kill streak - kills since your last death, this life. Feeds the
      // "streak" ladder for Kills.
      if (!track.wasDead && dead) {
        track.streak = 0;
      } else if (kills > (track._lastKills || track.baseline.kills)) {
        track.streak += kills - (track._lastKills || track.baseline.kills);
        checkLadder('kills', 'streak', track.streak);
      }
      track._lastKills = kills;

      // Comeback - a kill within 5s of respawning.
      if (track.wasDead && !dead) track.respawnedAt = Date.now();
      if (!dead && track.respawnedAt && Date.now() - track.respawnedAt < 5000 &&
          kills > (track._lastKillsForRespawn || kills)) {
        unlock('comeback');
      }
      track._lastKillsForRespawn = kills;

      // Porcupine - hits absorbed this life, read off your own health
      // dropping. The game's own "10 armored arrow hits" check (above,
      // mirrored from Steam) lives behind a private field on an internal
      // notifications class - genuinely unreachable from outside, private
      // class fields are not just hidden by convention, the language
      // itself refuses external access. Health is a public getter, so
      // this counts every drop instead - arrows and melee both, which is
      // why it's a different, new achievement rather than a fixed version
      // of the Steam one.
      var health = typeof p.health === 'number' ? p.health : null;
      if (health !== null) {
        if (!track.wasDead && dead) {
          track.hitsAbsorbed = 0;
          track.headHitsTaken = 0;   // regen doesn't reset this one - only dying does
        } else if (!dead && track.lastHealth !== null && health < track.lastHealth - 0.001) {
          track.hitsAbsorbed = (track.hitsAbsorbed || 0) + 1;
          if (track.hitsAbsorbed >= 20) unlock('porcupine');
        }
        track.lastHealth = health;
      }

      // Master Bowsman - 10 kills with each of the game's six bows, in one
      // match. Attribution is a snapshot of whichever bow is equipped the
      // moment a kill is detected (polled roughly twice a second), so
      // switching bows in the instant right after a kill lands could very
      // occasionally credit the wrong one - the same kind of approximation
      // Porcupine already uses, since the client has no per-kill weapon log.
      (function () {
        var dK = kills - (track._lastKillsBow != null ? track._lastKillsBow : kills);
        if (dK > 0) {
          var w = p.activeWeapon;
          var bt = w && w.bowWeaponTypeId;
          if (bt && Object.prototype.hasOwnProperty.call(track.bowKills, bt)) {
            track.bowKills[bt] += dK;
            if (BOW_TYPES.every(function (b) { return track.bowKills[b] >= 10; })) unlock('masterBowsman');
          }
        }
        track._lastKillsBow = kills;
      })();

      // Runner's High - a 10-kill streak with the small crossbow wearing its
      // "Runner" skin specifically (id "runner" in equippedSkinIds - the
      // bundle's own shop config for it: {id:"runner", uiName:"Runner",
      // bowId:"smallCrossbow"}). Dying, or a kill landed on anything else,
      // resets it to zero. Same weapon-at-kill-time approximation as above.
      (function () {
        var dK = kills - (track._lastKillsRunner != null ? track._lastKillsRunner : kills);
        if (!track.wasDead && dead) {
          track.runnerStreak = 0;
        } else if (dK > 0) {
          var w = p.activeWeapon;
          var skinIds = p.equippedSkinData && p.equippedSkinData.equippedSkinIds;
          var usingRunner = w && w.bowWeaponTypeId === 'smallCrossbow' && skinIds && skinIds.indexOf('runner') !== -1;
          track.runnerStreak = usingRunner ? (track.runnerStreak || 0) + dK : 0;
          if (track.runnerStreak >= 10) unlock('runnerStreak10');
        }
        track._lastKillsRunner = kills;
      })();

      track.wasDead = dead;

      // Match finished - Flawless, Nomad, the lifetime/"plain" ladders, and
      // the two match-count ladders.
      var ended = !!ag.gameEnded;
      if (ended && !track.gameEndedSeen && ag.gameStarted) {
        if ((p.scoreDeaths || 0) === 0 && killsThisMatch >= 8) unlock('flawless');

        // Nomad - this mod's own tally toward "win every map as Monk",
        // tracked by currentLoadedMapHash rather than the game's private
        // per-map asset-name set. Only unlocks once the map list itself is
        // known, so it never claims "complete" on a guess.
        if (wonThisMatch) {
          var mapKey = ag.currentLoadedMapHash;
          var skinIds2 = p.equippedSkinData && p.equippedSkinData.equippedSkinIds;
          if (mapKey && skinIds2 && skinIds2.indexOf('monkArms') !== -1) {
            if (store.nomadMaps.indexOf(mapKey) === -1) {
              store.nomadMaps.push(mapKey);
              saveStore();
            }
            var g = findGame();
            var mapsCfg = g && g.configManager && g.configManager.mapsConfig;
            var totalMaps = mapsCfg && mapsCfg.loadedConfigData && Array.isArray(mapsCfg.loadedConfigData.maps)
              ? mapsCfg.loadedConfigData.maps.length : 0;
            if (totalMaps > 0 && store.nomadMaps.length >= totalMaps) unlock('nomad');
          }
        }

        // Bank this match into the lifetime "plain" ladders.
        store.lifetime.kills += Math.max(0, killsThisMatch);
        store.lifetime.headshots += Math.max(0, track.headshotHitsLanded);
        store.lifetime.longRange += Math.max(0, track.longRangeHitsLanded);
        store.lifetime.flags += Math.max(0, track.matchFlags);
        store.lifetime.assists += Math.max(0, track.matchAssists);
        if (wonThisMatch) store.lifetime.wins += 1;
        store.allTimeMatches++;
        saveStore();

        checkLadder('kills', 'plain', store.lifetime.kills);
        checkLadder('headshots', 'plain', store.lifetime.headshots);
        checkLadder('longRange', 'plain', store.lifetime.longRange);
        checkLadder('flags', 'plain', store.lifetime.flags);
        checkLadder('assists', 'plain', store.lifetime.assists);
        checkLadder('wins', 'plain', store.lifetime.wins);
        checkLadder('matchesAllTime', 'plain', store.allTimeMatches);

        track.matchesThisSession++;
        checkLadder('matchesSession', 'plain', track.matchesThisSession);
      }
      track.gameEndedSeen = ended;
    }
    setInterval(function () { try { achievementTick(); } catch (e) {} }, 500);

    /* ================================================================ *
     * Look and feel
     * ================================================================ */

    var TROPHY = '<svg viewBox="0 0 101 104" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M30 8h41v20c0 15-9 26-20.5 26S30 43 30 28V8z" fill="none" stroke="black" stroke-width="7"/>' +
      '<path d="M30 14H14c0 16 8 24 18 25" fill="none" stroke="black" stroke-width="7"/>' +
      '<path d="M71 14h16c0 16-8 24-18 25" fill="none" stroke="black" stroke-width="7"/>' +
      '<rect x="45" y="54" width="11" height="16" fill="black"/>' +
      '<rect x="28" y="78" width="45" height="9" rx="3" fill="black"/>' +
      '<path d="M35 70h31l4 8H31z" fill="black"/></svg>';
    var TROPHY_URL = 'data:image/svg+xml,' + encodeURIComponent(TROPHY);

    function seed() { return Math.floor(Math.random() * 99999); }

    var CSS = [
      '#nach-toasts { position: fixed; left: 16px; bottom: 16px; z-index: 210; display: flex; ' +
        'flex-direction: column-reverse; gap: 8px; pointer-events: none; }',
      '.nach-toast { display: flex; align-items: center; gap: 10px; background: rgba(15,15,20,.85); ' +
        'color: #fff; padding: 10px 16px 10px 10px; border-radius: 10px; min-width: 220px; max-width: 320px; ' +
        'box-shadow: 0 4px 18px rgba(0,0,0,.35); opacity: 0; transform: translateX(-16px); ' +
        'transition: opacity .35s, transform .35s; font: 600 13px system-ui, sans-serif; }',
      '.nach-toast.nach-in { opacity: 1; transform: translateX(0); }',
      '.nach-toast .nach-icon { width: 34px; height: 34px; flex: 0 0 auto; background: #ffb43b; ' +
        'border-radius: 50%; display: flex; align-items: center; justify-content: center; }',
      '.nach-toast .nach-icon img { width: 20px; height: 20px; filter: invert(1); }',
      '.nach-toast .nach-head { opacity: .6; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }',
      '.nach-toast .nach-name { font-size: 14px; }',
      '#nach-dialog .nach-progress { opacity: .6; margin: -4px 0 10px; font-size: 13px; }',
      '#nach-dialog .nach-tabs { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }',
      '#nach-dialog .nach-tab { padding: 5px 12px; border-radius: 6px; background: rgba(0,0,0,.1); ' +
        'cursor: pointer; font: 700 12px inherit; border: none; color: inherit; opacity: .6; }',
      '#nach-dialog .nach-tab.nach-tab-active { opacity: 1; background: rgba(0,0,0,.22); }',
      '#nach-dialog .nach-group-head { opacity: .5; font-size: 11px; text-transform: uppercase; ' +
        'letter-spacing: .04em; margin: 14px 0 4px; }',
      '#nach-dialog .nach-group-head:first-of-type { margin-top: 0; }',
      '#nach-dialog .nach-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; ' +
        'border-bottom: 1px solid rgba(0,0,0,.12); }',
      '#nach-dialog .nach-row:last-child { border-bottom: none; }',
      '#nach-dialog .nach-row-icon { width: 30px; height: 30px; flex: 0 0 auto; border-radius: 50%; ' +
        'display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.12); }',
      '#nach-dialog .nach-row.nach-locked .nach-row-icon { opacity: .35; }',
      '#nach-dialog .nach-row.nach-locked .nach-row-name { opacity: .5; }',
      '#nach-dialog .nach-row-icon img { width: 17px; height: 17px; filter: invert(1); opacity: .8; }',
      '#nach-dialog .nach-row-body { flex: 1 1 auto; min-width: 0; }',
      '#nach-dialog .nach-row-name { font-weight: 700; }',
      '#nach-dialog .nach-row-desc { opacity: .65; font-size: 12px; margin-top: 1px; }',
      '#nach-dialog .nach-row-date { opacity: .45; font-size: 11px; flex: 0 0 auto; text-align: right; }',
      '#nach-dialog .nach-bar { height: 6px; border-radius: 3px; background: rgba(0,0,0,.15); ' +
        'margin-top: 6px; overflow: hidden; }',
      '#nach-dialog .nach-bar-fill { height: 100%; background: #ffb43b; border-radius: 3px; }',
      '#nach-dialog .nach-row.nach-locked .nach-bar-fill { background: rgba(0,0,0,.35); }',
      '#nach-dialog .nach-bar-text { font-size: 11px; opacity: .55; margin-top: 2px; }',
      '#nach-dialog .nach-reset { margin-top: 12px; opacity: .55; font-size: 12px; cursor: pointer; ' +
        'text-decoration: underline; display: inline-block; }'
    ].join('\n');

    (function injectStyle() {
      if (document.getElementById('nach-style')) return;
      var el = document.createElement('style');
      el.id = 'nach-style';
      el.textContent = CSS;
      (document.head || document.documentElement).appendChild(el);
    })();

    function esc(s) {
      var d = document.createElement('div');
      d.textContent = String(s == null ? '' : s);
      return d.innerHTML;
    }

    /* ---- toasts ---- */

    var toastHost = null;
    function ensureToastHost() {
      if (toastHost && toastHost.isConnected) return toastHost;
      toastHost = document.createElement('div');
      toastHost.id = 'nach-toasts';
      document.body.appendChild(toastHost);
      return toastHost;
    }

    function showToast(def) {
      var host = ensureToastHost();
      var el = document.createElement('div');
      el.className = 'nach-toast';
      el.innerHTML =
        '<div class="nach-icon"><img src="' + TROPHY_URL + '" alt=""></div>' +
        '<div><div class="nach-head">Achievement unlocked' + (def.tier ? ' · Tier ' + def.tier : '') + '</div>' +
        '<div class="nach-name">' + esc(def.name) + '</div></div>';
      host.appendChild(el);
      requestAnimationFrame(function () { el.classList.add('nach-in'); });
      setTimeout(function () { el.classList.remove('nach-in'); }, 6000);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 6500);
    }

    /* ---- dialog ---- */

    var achDialogEl = null, achCurtainEl = null;
    var activeTab = 'T1';

    function closeDialog() {
      if (achDialogEl && achDialogEl.isConnected) achDialogEl.remove();
      if (achCurtainEl && achCurtainEl.isConnected) achCurtainEl.remove();
      achDialogEl = null; achCurtainEl = null;
    }

    /** Live current value for a tiered achievement's ladder row. */
    // "Plain" (all-time) values only got banked into store.lifetime once a
    // match fully ended, so the bar looked frozen at last match's total for
    // as long as you were still playing - livePlain() adds this match's own
    // progress on top of the banked total, the same live number
    // checkLadder() below now also unlocks against mid-match.
    function livePlain(bankedTotal, thisMatchSoFar) {
      return bankedTotal + Math.max(0, thisMatchSoFar || 0);
    }
    function ladderCurrentValue(def) {
      switch (def.ladderKey + ':' + def.ladderType) {
        case 'kills:plain': return livePlain(store.lifetime.kills, track.matchKills);
        case 'kills:game': return track.matchKills;
        case 'kills:streak': return track.streak;
        case 'headshots:plain': return livePlain(store.lifetime.headshots, track.headshotHitsLanded);
        case 'headshots:game': return track.headshotHitsLanded;
        case 'headshots:streak': return track.hsStreak;
        case 'longRange:plain': return livePlain(store.lifetime.longRange, track.longRangeHitsLanded);
        case 'longRange:game': return track.longRangeHitsLanded;
        case 'longRange:streak': return track.lrStreak;
        case 'flags:plain': return livePlain(store.lifetime.flags, track.matchFlags);
        case 'flags:game': return track.matchFlags;
        case 'assists:plain': return livePlain(store.lifetime.assists, track.matchAssists);
        case 'assists:game': return track.matchAssists;
        case 'wins:plain': return store.lifetime.wins;   // a win only exists once the match ends
        case 'matchesSession:plain': return track.matchesThisSession;
        case 'matchesAllTime:plain': return store.allTimeMatches;
        default: return 0;
      }
    }

    function achRow(def) {
      var unlockedAt = store.unlocked[def.id];
      var row = document.createElement('div');
      row.className = 'nach-row' + (unlockedAt ? '' : ' nach-locked');
      var icon = document.createElement('div');
      icon.className = 'nach-row-icon';
      icon.innerHTML = '<img src="' + TROPHY_URL + '" alt="">';
      var body = document.createElement('div');
      body.className = 'nach-row-body';
      body.innerHTML = '<div class="nach-row-name">' + esc(def.name) + '</div>' +
        '<div class="nach-row-desc">' + esc(def.desc) + '</div>';

      if (def.tier) {
        var value = Math.max(0, ladderCurrentValue(def));
        var pct = Math.max(0, Math.min(100, (value / def.threshold) * 100));
        var bar = document.createElement('div');
        bar.className = 'nach-bar';
        var fill = document.createElement('div');
        fill.className = 'nach-bar-fill';
        fill.style.width = (unlockedAt ? 100 : pct) + '%';
        bar.appendChild(fill);
        body.appendChild(bar);
        var barText = document.createElement('div');
        barText.className = 'nach-bar-text';
        barText.textContent = Math.min(value, def.threshold) + ' / ' + def.threshold;
        body.appendChild(barText);
      }

      var date = document.createElement('div');
      date.className = 'nach-row-date';
      date.textContent = unlockedAt ? new Date(unlockedAt).toLocaleDateString() : 'Locked';
      row.appendChild(icon); row.appendChild(body); row.appendChild(date);
      return row;
    }

    var CATEGORY_ORDER = ['kills', 'headshots', 'longRange', 'flags', 'assists', 'wins', 'matchesSession', 'matchesAllTime'];

    function renderDialog() {
      if (!achDialogEl) return;
      var body = achDialogEl.querySelector('.nach-body');
      body.innerHTML = '';

      var total = ACHIEVEMENTS.length;
      var got = ACHIEVEMENTS.filter(function (a) { return isUnlocked(a.id); }).length;
      var progress = document.createElement('div');
      progress.className = 'nach-progress';
      progress.textContent = got + ' / ' + total + ' unlocked';
      body.appendChild(progress);

      var tabs = document.createElement('div');
      tabs.className = 'nach-tabs';
      ['T1', 'T2', 'T3', 'T4', 'T5', 'Secret'].forEach(function (tabName) {
        var b = document.createElement('button');
        b.type = 'button';
        b.tabIndex = -1;
        b.className = 'nach-tab' + (activeTab === tabName ? ' nach-tab-active' : '');
        b.textContent = tabName;
        b.addEventListener('click', function () { activeTab = tabName; renderDialog(); });
        tabs.appendChild(b);
      });
      body.appendChild(tabs);

      if (activeTab === 'Secret') {
        // No progress bar on these (they're combos/timing/weapon-specific,
        // not a single ladder number), so a locked row is just "Locked"
        // with nothing to show for it - only the ones you've actually
        // earned are worth listing here. Steam-mirrored and custom ones
        // are no longer split into separate sections - the Steam ones
        // still unlock and still show up here once earned, just alongside
        // everything else rather than under their own heading.
        var group = ACHIEVEMENTS.filter(function (a) { return !a.tier && isUnlocked(a.id); });
        if (group.length) {
          var head = document.createElement('div');
          head.className = 'nach-group-head';
          head.textContent = 'Secret achievements';
          body.appendChild(head);
          group.forEach(function (def) { body.appendChild(achRow(def)); });
        }
        if (!group.length) {
          var empty = document.createElement('div');
          empty.className = 'nach-row-desc';
          empty.textContent = "No secret achievements unlocked yet - these are one-off achievements (combos, timing, specific weapons), so they stay hidden until you've actually earned one.";
          body.appendChild(empty);
        }
      } else {
        // Progressive reveal: a tier only shows up once the tier before it
        // in that exact same row is unlocked - T1 has no prerequisite, so
        // it's always visible. Getting Killer (kills/plain T2) is what
        // reveals Slayer (T3), and so on, for every stat and every type,
        // all the way up. A ladder that hasn't been touched yet just won't
        // appear at all past T1.
        var tierNum = Number(activeTab.slice(1));
        CATEGORY_ORDER.forEach(function (key) {
          var ladder = LADDERS_BY_KEY[key];
          var group = ACHIEVEMENTS.filter(function (a) { return a.ladderKey === key && a.tier === tierNum; });
          if (!group.length) return;
          var rows = [];
          // Plain, then Game, then Streak, for a consistent order.
          ['plain', 'game', 'streak'].forEach(function (type) {
            var def = group.filter(function (a) { return a.ladderType === type; })[0];
            if (!def) return;
            var revealed = tierNum === 1 || isUnlocked(tierId(key, type, tierNum - 1));
            if (revealed) rows.push(def);
          });
          if (!rows.length) return;
          var head = document.createElement('div');
          head.className = 'nach-group-head';
          head.textContent = ladder.label;
          body.appendChild(head);
          rows.forEach(function (def) { body.appendChild(achRow(def)); });
        });
      }

      var reset = document.createElement('span');
      reset.className = 'nach-reset';
      reset.textContent = 'Reset all achievements';
      reset.tabIndex = -1;
      reset.addEventListener('click', function () {
        if (!confirm('Reset every achievement back to locked? This cannot be undone.')) return;
        store.unlocked = {};
        store.allTimeMatches = 0;
        store.nomadMaps = [];
        store.lifetime = { kills: 0, headshots: 0, longRange: 0, flags: 0, assists: 0, wins: 0 };
        saveStore();
        renderDialog();
      });
      body.appendChild(reset);
    }

    function openDialog() {
      if (achDialogEl && achDialogEl.isConnected) return;
      var host = document.getElementById('gameWrapper') || document.body;

      achCurtainEl = document.createElement('div');
      achCurtainEl.className = 'dialogCurtain fullScreen';
      achCurtainEl.style.zIndex = '99';
      achCurtainEl.addEventListener('click', closeDialog);
      host.appendChild(achCurtainEl);

      achDialogEl = document.createElement('div');
      achDialogEl.className = 'dialog wrinkledPaper';
      achDialogEl.id = 'nach-dialog';
      achDialogEl.style.setProperty('--wrinkled-paper-seed', seed());
      achDialogEl.style.zIndex = '100';

      var title = document.createElement('h2');
      title.className = 'dialogTitle blueNight';
      title.textContent = 'Achievements';
      achDialogEl.appendChild(title);

      var list = document.createElement('div');
      list.className = 'settings-list';
      var body = document.createElement('div');
      body.className = 'nach-body';
      list.appendChild(body);
      achDialogEl.appendChild(list);
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
      achDialogEl.appendChild(btns);

      ['keydown', 'keyup', 'keypress'].forEach(function (t) {
        achDialogEl.addEventListener(t, function (e) { e.stopPropagation(); });
      });
      if (document.pointerLockElement) document.exitPointerLock();

      host.appendChild(achDialogEl);
    }

    window.addEventListener('keydown', function (e) {
      if (e.code === 'Escape' && achDialogEl && achDialogEl.isConnected) {
        e.preventDefault(); e.stopPropagation(); closeDialog();
      }
    }, true);

    // Keep progress bars live while the dialog is open.
    setInterval(function () { if (achDialogEl && achDialogEl.isConnected) renderDialog(); }, 1000);

    /* ---- menu button ---- */

    function injectMenuButton() {
      var bar = document.querySelector('.menu-buttons-container');
      if (!bar || bar.querySelector('#nach-menu-button')) return;

      var c = document.createElement('div');
      c.className = 'main-menu-button-container';
      c.id = 'nach-menu-button';

      var b = document.createElement('button');
      b.className = 'wrinkledPaper main-menu-button';
      b.setAttribute('aria-label', 'Achievements');
      b.tabIndex = -1;   // never a Tab-focus stop - see Hotkey Editor's own note on this
      b.style.setProperty('--wrinkled-paper-seed', seed());

      var img = document.createElement('div');
      img.className = 'buttonImage';
      img.style.backgroundImage = 'url("' + TROPHY_URL + '")';
      img.style.backgroundSize = '90%';
      b.appendChild(img);

      var l = document.createElement('div');
      l.className = 'main-menu-button-text whiteBigText blueNight';
      l.setAttribute('aria-hidden', 'true');
      l.textContent = 'Achievements';

      c.appendChild(b); c.appendChild(l);
      b.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (achDialogEl && achDialogEl.isConnected) closeDialog(); else openDialog();
      });

      var sibs = Array.prototype.slice.call(bar.querySelectorAll('.main-menu-button-container'));
      var anchor = sibs.filter(function (x) {
        var t = (x.textContent || '').trim();
        return t === 'Crosshair' || t === 'Health' || t === 'Settings' ||
               t === '1 Kill = 1 Stat Point' || t === 'Hotkeys' || t === 'Target Practice';
      }).pop();
      if (anchor && anchor.nextSibling) bar.insertBefore(c, anchor.nextSibling);
      else bar.appendChild(c);
    }
    injectMenuButton();
    setInterval(injectMenuButton, 1000);

    PAGE.NarrowAchievements = window.NarrowAchievements = {
      list: ACHIEVEMENTS,
      ladders: LADDERS,
      isUnlocked: isUnlocked,
      unlock: unlock,   // console testing: NarrowAchievements.unlock('t_headshots_streak_3')
      checkLadder: checkLadder,
      store: store,
      track: track,     // live progress - e.g. NarrowAchievements.track.bowKills, .runnerStreak
      patchState: patchState
    };

    console.log('[Achievements] ready. Patched copy in cache:', patchState.patched);
  });
})();
