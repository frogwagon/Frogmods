# Warband relay

The small backend Warband's friend system needs, because Narrow One itself
has none - no friends list, no join-request approval, no presence. Checked
directly in the game's own code before building this; it's genuinely not
there. Two browsers can't reach each other with nothing in between, so this
is that in-between - and only that. It never touches Narrow One's own
servers or sends anything the game itself doesn't already send; it just
relays friend requests, join/invite requests, messages and acorn gifts
between people running the Warband mod.

**This is real infrastructure, not a toy.** Once it's deployed, it's a small
messaging service between real people, and you're the one who can see what
passes through it (who's friends with whom, message text) and the one
responsible for it staying up. Read that as a genuine "are you sure" before
deploying, not a formality.

## What it stores

Cloudflare KV, nothing else - no database to manage, no server process to
keep alive. Each pending request, each unread message, and each friendship
is its own key (rather than one shared array per person) so that two
things happening close together can never race and silently overwrite
each other:

- `player:<id>` - last-seen time, for online/offline presence.
- `friend:<id>:<friendId>` - one accepted friendship, one key per side.
- `req:<id>:<requestId>` - one pending friend/join/invite request.
- `msg:<id>:<messageId>` - one unread direct message, acorn gift, or system
  notice (a friend request was accepted, a join request was
  approved/declined).

An "id" is a random string the Warband mod generates for itself on first
run - not your Pelican Party account, not anything Narrow One knows about.
Anyone who has someone's id can act as if they were that person, the same
trust model a squad code already has - don't hand yours to someone you
wouldn't hand a squad code to.

## Deploy it (free, your own Cloudflare account)

1. `npm install -g wrangler`
2. `wrangler login` - opens a browser to sign into (or create) a free
   Cloudflare account.
3. `wrangler kv namespace create WARBAND_KV` - prints an id; paste it into
   `wrangler.toml` in place of the id already there (that one belongs to
   this project's own deployment, not yours - it won't work for you).
4. `wrangler deploy`
5. It prints a URL like `https://warband-relay.<you>.workers.dev`. Paste
   that into the Warband mod's Settings tab as the relay URL - nothing
   works until you do this, the mod has no default server of its own.

Free tier is generous (100,000 requests/day) and there's no dyno to sleep -
Workers run on demand. If it ever needs to scale past that, Cloudflare's
paid tier starts around $5/month.

## Turning it off

`wrangler delete` removes the Worker. The KV namespace (and everything
stored in it) needs deleting separately, from the Cloudflare dashboard or
`wrangler kv namespace delete`, if you want the data gone too.
