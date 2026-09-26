/**
 * Warband relay - Cloudflare Worker
 * ---------------------------------
 * The small backend Warband's friend system needs, because the game
 * itself has none: no friends list, no join-request approval, no presence,
 * checked directly in its code. This is what makes "friend someone by ID,
 * get asked before they can join you, message them, get notified" actually
 * possible - none of it can happen with two browsers talking only to each
 * other with nothing in between.
 *
 * Deliberately tiny and stateless-per-request: every request carries the
 * caller's own Warband ID (a random id the mod generates for itself, NOT
 * your real Pelican Party account - this server never sees that), and all
 * state lives in one Cloudflare KV namespace. No accounts, no passwords,
 * no email - an id is just a random string; anyone who has it can act as
 * that id, the same trust model as a squad code already has in the game
 * itself. Don't hand your id to someone you wouldn't hand a squad code to.
 *
 * Storage note (v2): each pending request, each unread message, and each
 * friendship is its OWN KV key (req:<owner>:<id>, msg:<owner>:<id>,
 * friend:<owner>:<friendId>), listed by prefix rather than kept as one
 * JSON array per user. v1 kept one array per user and did a read-modify-
 * write on it for every single change - fine under a light, spaced-out
 * load, but Cloudflare KV makes no promise that two writes to the same
 * key close together apply in order or are both visible to a read in
 * between. Firing off several requests in quick succession (exactly what
 * testing this looked like) could have one call's read miss the write
 * from a moment earlier, and silently overwrite it with a version that
 * doesn't have it - the request or message that got lost never
 * reappears, no error anywhere. Real pending requests going missing
 * during testing is what actually surfaced this. Giving every item its
 * own key means every write only ever touches that one item - there's no
 * shared value for two changes to race over.
 *
 * Setup (you'll need your own free Cloudflare account - this file can't
 * run anywhere on its own):
 *   1. npm install -g wrangler
 *   2. wrangler login
 *   3. wrangler kv namespace create WARBAND_KV
 *      (paste the id it prints into wrangler.toml)
 *   4. wrangler deploy
 *   5. Wrangler prints a URL like https://warband-relay.<you>.workers.dev -
 *      put that into the Warband mod's Settings as the relay URL.
 *
 * Endpoints (all POST unless noted, all JSON in/out):
 *   /register            {id}                          - heartbeat / first-seen
 *   /friend-request       {fromId, toId}                 - request to add a friend
 *   /friend-accept         {id, fromId}                    - accept an incoming friend request
 *   /friend-decline        {id, fromId}                    - decline / cancel
 *   /friends/:id           GET                             - your friend list with presence
 *   /join-request          {fromId, toId, squadCode}       - "let me join your squad"
 *   /invite                {fromId, toId, squadCode}       - "join my squad"
 *   /request-respond       {id, fromId, requestId, accept} - answer a join/invite
 *   /message               {fromId, toId, text}            - a DM
 *   /gift                  {fromId, toId, amount}           - send acorns to a friend
 *   /inbox/:id              GET                             - pending requests + unread messages
 *   /inbox/:id/clear-messages POST {upTo}                  - mark messages read
 */

const PRESENCE_WINDOW_MS = 2 * 60 * 1000;   // "online" = seen in the last 2 minutes
const MAX_TEXT_LEN = 300;
const MAX_GIFT_AMOUNT = 500;   // acorns are a made-up client-side currency with
  // no balance tracked here at all - this cap only guards against someone
  // hitting this endpoint directly and crediting an absurd number, not
  // against spending more than you "really" have, since this server has no
  // idea what that is. Harmless either way: acorns only ever buy a cosmetic
  // HUD icon nobody else can see, never a stat.
const LIST_LIMIT = 200;   // per user - well past any real inbox size

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
function bad(msg, status = 400) { return json({ error: msg }, status); }

function isId(x) { return typeof x === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(x); }
function isText(x) { return typeof x === 'string' && x.length > 0 && x.length <= MAX_TEXT_LEN; }

async function getJSON(kv, key, fallback) {
  const v = await kv.get(key, 'json');
  return v == null ? fallback : v;
}
async function putJSON(kv, key, value) {
  await kv.put(key, JSON.stringify(value));
}

/** Every value under this prefix, as {key, value} pairs - one KV read per
 * item, but each item is independent, so nothing here can race with a
 * write to any other item (or to this same one from another request). */
async function listPrefixed(kv, prefix) {
  const listed = await kv.list({ prefix, limit: LIST_LIMIT });
  const out = [];
  for (const k of listed.keys) {
    const v = await kv.get(k.name, 'json');
    if (v != null) out.push({ key: k.name, value: v });
  }
  return out;
}

async function touchPlayer(kv, id) {
  await putJSON(kv, 'player:' + id, { id, lastSeen: Date.now() });
}
async function getPresence(kv, id) {
  const p = await getJSON(kv, 'player:' + id, null);
  if (!p) return { online: false, lastSeen: null };
  return { online: Date.now() - p.lastSeen < PRESENCE_WINDOW_MS, lastSeen: p.lastSeen };
}

/** Join/invite requests get a random id - you can have more than one
 * pending at once (e.g. two different friends both asking to join you).
 * Friend requests use a deterministic id per sender instead, so sending
 * one twice just refreshes the same pending entry rather than stacking
 * duplicate popups for the same person. */
async function addRequest(kv, toId, req) {
  req.id = crypto.randomUUID();
  req.at = Date.now();
  await putJSON(kv, `req:${toId}:${req.id}`, req);
  return req;
}
async function addFriendRequest(kv, toId, fromId, fromName) {
  const req = { type: 'friend', fromId, fromName: String(fromName || '').slice(0, 40), id: 'friend-' + fromId, at: Date.now() };
  await putJSON(kv, `req:${toId}:${req.id}`, req);
  return req;
}
async function addMessage(kv, toId, msg) {
  msg.id = crypto.randomUUID();
  msg.at = Date.now();
  await putJSON(kv, `msg:${toId}:${msg.id}`, msg);
  return msg;
}

async function handleRegister(req, kv) {
  const body = await req.json().catch(() => null);
  if (!body || !isId(body.id)) return bad('invalid id');
  await touchPlayer(kv, body.id);
  return json({ ok: true });
}

async function handleFriendRequest(req, kv) {
  const body = await req.json().catch(() => null);
  if (!body || !isId(body.fromId) || !isId(body.toId)) return bad('invalid ids');
  if (body.fromId === body.toId) return bad('cannot friend yourself');
  await touchPlayer(kv, body.fromId);
  await addFriendRequest(kv, body.toId, body.fromId, body.fromName);
  return json({ ok: true });
}

async function handleFriendAccept(req, kv, decline) {
  const body = await req.json().catch(() => null);
  if (!body || !isId(body.id) || !isId(body.fromId)) return bad('invalid ids');
  // Deterministic id (see addFriendRequest) - a direct delete, not a
  // read-modify-write of a shared list.
  await kv.delete(`req:${body.id}:friend-${body.fromId}`);
  if (!decline) {
    // Each side of the friendship is its own key - both writes are
    // independent of each other and of anything else touching either id.
    await putJSON(kv, `friend:${body.id}:${body.fromId}`, { id: body.fromId, addedAt: Date.now() });
    await putJSON(kv, `friend:${body.fromId}:${body.id}`, { id: body.id, addedAt: Date.now() });
    await addMessage(kv, body.fromId, { type: 'system', text: 'Your friend request was accepted.' });
  }
  return json({ ok: true });
}

async function handleFriendsList(id, kv) {
  if (!isId(id)) return bad('invalid id');
  const items = await listPrefixed(kv, `friend:${id}:`);
  const out = [];
  for (const item of items) {
    const f = item.value;
    const presence = await getPresence(kv, f.id);
    out.push({ id: f.id, addedAt: f.addedAt, online: presence.online, lastSeen: presence.lastSeen });
  }
  return json({ friends: out });
}

async function handleJoinOrInvite(req, kv, type) {
  const body = await req.json().catch(() => null);
  if (!body || !isId(body.fromId) || !isId(body.toId)) return bad('invalid body');
  // 'invite': the inviter already knows their own code, and includes it now
  // - if accepted, it goes straight to the invitee. 'join': the requester
  // doesn't have a code yet (that's the whole point of asking) - the
  // target supplies their own, fresh, only at the moment they accept.
  let code = null;
  if (type === 'invite') {
    if (typeof body.squadCode !== 'string') return bad('squadCode required to invite');
    code = body.squadCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(code)) return bad('invalid squad code');
  }
  await touchPlayer(kv, body.fromId);
  const r = await addRequest(kv, body.toId, { type, fromId: body.fromId, squadCode: code });
  return json({ ok: true, requestId: r.id });
}

async function handleRequestRespond(req, kv) {
  const body = await req.json().catch(() => null);
  if (!body || !isId(body.id) || !body.requestId) return bad('invalid body');
  const key = `req:${body.id}:${body.requestId}`;
  const found = await getJSON(kv, key, null);
  if (!found) return bad('request not found', 404);
  await kv.delete(key);   // this exact request only - no shared list involved

  if (!body.accept) {
    await addMessage(kv, found.fromId, { type: 'request-declined', requestType: found.type });
    return json({ ok: true, accepted: false });
  }

  if (found.type === 'join') {
    // found.fromId asked to join body.id (this responder)'s squad - the
    // responder hands over their OWN current code now, since it may have
    // changed since the request went out. Delivered async, since the
    // requester isn't part of this HTTP call.
    if (typeof body.squadCode !== 'string') return bad('squadCode required to accept a join request');
    const code = body.squadCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(code)) return bad('invalid squad code');
    await addMessage(kv, found.fromId, { type: 'join-approved', squadCode: code });
    return json({ ok: true, accepted: true });
  }

  if (found.type === 'invite') {
    // This responder (body.id) is the invitee - they're the one joining,
    // and they're the one making this exact call, so the code goes
    // straight back in the response instead of round-tripping through
    // their own inbox. The original inviter just gets a courtesy notice.
    await addMessage(kv, found.fromId, { type: 'invite-accepted' });
    return json({ ok: true, accepted: true, squadCode: found.squadCode });
  }

  return bad('unknown request type', 400);
}

async function handleMessage(req, kv) {
  const body = await req.json().catch(() => null);
  if (!body || !isId(body.fromId) || !isId(body.toId) || !isText(body.text)) return bad('invalid body');
  const friendship = await getJSON(kv, `friend:${body.toId}:${body.fromId}`, null);
  if (!friendship) return bad('not friends', 403);
  await touchPlayer(kv, body.fromId);
  await addMessage(kv, body.toId, { type: 'chat', fromId: body.fromId, text: body.text.slice(0, MAX_TEXT_LEN) });
  return json({ ok: true });
}

async function handleGift(req, kv) {
  const body = await req.json().catch(() => null);
  if (!body || !isId(body.fromId) || !isId(body.toId)) return bad('invalid ids');
  const amount = Math.floor(Number(body.amount));
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_GIFT_AMOUNT) return bad('invalid amount');
  const friendship = await getJSON(kv, `friend:${body.toId}:${body.fromId}`, null);
  if (!friendship) return bad('not friends', 403);
  await touchPlayer(kv, body.fromId);
  await addMessage(kv, body.toId, { type: 'gift', fromId: body.fromId, amount });
  return json({ ok: true });
}

async function handleInbox(id, kv) {
  if (!isId(id)) return bad('invalid id');
  await touchPlayer(kv, id);
  const reqItems = await listPrefixed(kv, `req:${id}:`);
  const msgItems = await listPrefixed(kv, `msg:${id}:`);
  const requests = reqItems.map((i) => i.value).sort((a, b) => a.at - b.at);
  const messages = msgItems.map((i) => i.value).sort((a, b) => a.at - b.at);
  return json({ requests, messages });
}

async function handleClearMessages(id, req, kv) {
  if (!isId(id)) return bad('invalid id');
  const body = await req.json().catch(() => ({}));
  const upTo = Number(body.upTo) || Date.now();
  const items = await listPrefixed(kv, `msg:${id}:`);
  for (const item of items) {
    if (item.value.at <= upTo) await kv.delete(item.key);   // only this one message's key
  }
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const kv = env.WARBAND_KV;
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      } });
    }
    try {
      if (path === '/register' && request.method === 'POST') return await handleRegister(request, kv);
      if (path === '/friend-request' && request.method === 'POST') return await handleFriendRequest(request, kv);
      if (path === '/friend-accept' && request.method === 'POST') return await handleFriendAccept(request, kv, false);
      if (path === '/friend-decline' && request.method === 'POST') return await handleFriendAccept(request, kv, true);
      if (path.startsWith('/friends/') && request.method === 'GET') return await handleFriendsList(path.slice(9), kv);
      if (path === '/join-request' && request.method === 'POST') return await handleJoinOrInvite(request, kv, 'join');
      if (path === '/invite' && request.method === 'POST') return await handleJoinOrInvite(request, kv, 'invite');
      if (path === '/request-respond' && request.method === 'POST') return await handleRequestRespond(request, kv);
      if (path === '/message' && request.method === 'POST') return await handleMessage(request, kv);
      if (path === '/gift' && request.method === 'POST') return await handleGift(request, kv);
      if (path.startsWith('/inbox/') && path.endsWith('/clear-messages') && request.method === 'POST') {
        return await handleClearMessages(path.slice(7, -'/clear-messages'.length), request, kv);
      }
      if (path.startsWith('/inbox/') && request.method === 'GET') return await handleInbox(path.slice(7), kv);
      return bad('not found', 404);
    } catch (e) {
      return bad('server error: ' + (e && e.message), 500);
    }
  }
};
