# oulipo.party

A daily game for writers, in English, Spanish and French. Gulliver, the
traveller and teller of tales, has written a hidden piece for today's prompt. Write one of your
own, send a wager of its words against hers — the fewer you send, the more
each hit pays. Then he rewrites his piece without a single word you sent.

The game was born in the writing community at [patrouch.ca](https://patrouch.ca)
and became its own site here.

## How a duel goes

1. The day's prompt is one per language. A **round** is: prepare — Gulliver
   writes a fresh hidden piece against it — then you write and send. No limit
   but a safeguard: twelve locked rounds a day. Every round's piece is new;
   the board ranks each member's best round of the day.
2. You write a piece of your own (30 to 300 words; a longer piece counts up to 300) and send some of its words.
3. Only your own words can be sent — the ones the prompt gave him sit greyed
   out, and the editor checks your spelling before anything is sent (unknown
   words are named; sending anyway is one press away). Hits only: a miss
   costs nothing but its slot. Small words never count, in any of the three languages.
4. Two layers of judgement. **The pot is your writing**: one point per fifteen
   words written, so a 300-word piece plays for 20 and a 30-word piece for 2.
   A hit pays the pot divided by the words sent — fewer words, more per hit,
   and a perfect round scores the pot. **The craft grade**: at lock, Gulliver
   reads the whole piece and grades it ✦–✦✦✦✦ (plain ×0.75 to remarkable
   ×1.5), multiplying the score. The numbers are in
   `src/lib/oulipo/duel-rules.js`, retuned on the ledger (`duel_ledger`) as real play accumulates.
5. The score banks to your **purse** (new members start with 10). Before
   locking you can stake purse points on your own round's hidden piece —
   "he uses it" (×12) or "he never uses it" (×1.5), three stakes a round —
   settled by the piece itself when you lock. If he smuggles one of your hit
   words back into his rewrite, the jailbreak dividend pays +2 a word.
6. After the lock, he rewrites his piece without your words.

## Run it

```sh
pnpm install
pnpm dev        # the site on a local port
pnpm test       # node --test: the word engine, the duel's flow, sign-in and mail
pnpm check      # svelte-check, with zero errors as the rule
pnpm build
```

The tests need no account and no network: they run against in-memory SQLite
and a scripted stand-in for the model.

## How a siege goes

1. One member starts a room and gets a five-character code; up to eight share
   it. The code keeps working every day: each day the room has a new round, on
   the day's prompt, with a hidden piece of Gulliver's that is the room's own.
2. Whoever opens the room that day is counted in until they lock, sit out, or
   the day ends. Each writes a piece and locks words exactly as in the Duel.
3. The round resolves the moment the last of them locks — or when the day is
   over, with those who did. Fewer than two locked, and it lapses.
4. Everyone's words are judged against the same piece. A hit is +1 and a miss
   −1. A hit only one player found earns +1 more; a hit every player found
   earns +1 per player; a word among the prompt's own words earns neither.
   The numbers are in `src/lib/oulipo/siege-rules.js`.
5. He then rewrites his piece without a word any of them sent.

The result of an earlier day is at `/siege/CODE/DATE`.

## Where things are

- `src/lib/oulipo/` — the word engine. Pure, isomorphic, one configuration per
  language (`langs/`), never importing the runtime.
- `src/lib/server/oulipo-duel.js` — the duel's rules and flow, taking `db` and
  `ai` as arguments.
- `src/lib/server/daily-prompt.js` — the day's prompt, one per language.
- `src/lib/server/sappho-persona.js`, `oulipo-sappho.js` — how Gulliver is asked
  to write, and how his rewrite is checked.
- `src/lib/auth.js` — members: email with a password, or Google, GitHub or
  Discord. Mail goes through Cloudflare's Email Sending
  (`src/lib/server/email-sender.js`).
- `src/routes/+page.svelte` — the landing page: today's games.
- `src/routes/duel/+page.svelte` — the solitaire duel.
- `src/routes/siege/` — the Siege: its door, a room (`[code]`), and an earlier
  day of a room (`[code]/[date]`).
- `src/lib/oulipo/siege-rules.js`, `src/lib/server/siege.js` — the Siege's
  rules and its flow, taking `db` and `ai` as the Duel's do.
- `src/lib/components/` — the pieces a game page is built from: the writing
  space, the word picker, his rewrite. Their look is in `src/app.css`, under
  `.game-page`.
- `src/lib/piece.js` — what a game takes from a piece: the part that counts,
  and the words there are to send.
- `migrations/` — the database, in order.

## Deploy

Two Workers in one configuration: production on `oulipo.party`, staging on
`staging.oulipo.party`, each with its own D1 database.

```sh
# a migration, once per database
wrangler d1 execute oulipo-party-staging --remote --file migrations/0001_auth.sql
wrangler d1 execute oulipo-party          --remote --file migrations/0001_auth.sql

# the session secret, once per Worker
wrangler secret put BETTER_AUTH_SECRET --env staging
wrangler secret put BETTER_AUTH_SECRET

# the social providers' ids and secrets: one guided command
bash scripts/signin-setup.sh

# the site
wrangler deploy --env staging
wrangler deploy
```

A migration is applied to a database **before** any code that reads it is
deployed there. For `0004_rate_limit.sql` this is not a formality: the
sign-in library reads that table on every sign-in request, and without it
every such request fails.

A deploy runs the build itself. Pushing to `main` deploys nothing until the
repository is connected to Workers Builds.

### Secrets

| Name | What it is |
| --- | --- |
| `BETTER_AUTH_SECRET` | Signs sessions and tokens. Required. |
| `GOOGLE_CLIENT_SECRET` | With `GOOGLE_CLIENT_ID`, offers Google sign-in. |
| `GITHUB_CLIENT_SECRET` | With `GITHUB_CLIENT_ID`, offers GitHub sign-in. |
| `DISCORD_CLIENT_SECRET` | With `DISCORD_CLIENT_ID`, offers Discord sign-in. |

A social provider is offered only when its id and its secret are both set.
`scripts/signin-setup.sh` writes the ids into `wrangler.jsonc` and puts the
secrets on both Workers; it takes each value from an environment variable of
its name or asks for it, and skips any you leave out (`--dry-run` shows the
plan).

Each provider's application must list this site's return addresses:

- `https://oulipo.party/api/auth/callback/google`, `github`, `discord`
- `https://staging.oulipo.party/api/auth/callback/google`, `github`, `discord`

A Google project and a Discord application each take several return
addresses, so this site can share an existing one once the two addresses above
are added to it. A GitHub OAuth application takes exactly one, so GitHub needs
an application of this site's own: one for each address.

### Mail

Sign-up verification and password reset go through Cloudflare's Email
Sending: the `EMAIL` binding in `wrangler.jsonc` is the credential, and
`EMAIL_FROM` names the sender. The domain must be onboarded for Email Sending
once, in the dashboard (Compute → Email Service → Email Sending). On the
Workers Free plan it only reaches addresses verified on the account; writing to
anyone else needs Workers Paid.

Until mail can leave, the site says what is true rather than what was hoped:
a sign-up succeeds and the member plays, the account page answers a request
for the verification link with "could not be sent", and a password reset is
not reported as on its way. (The library's own reset endpoint answers before
the mail is sent, which is why the page asks `POST /api/reset-link` instead.)

### Attempts

The sign-in library's limits on attempts are kept in the database (`rate_limit`):
three sign-in attempts in ten seconds, three reset or verification requests in
a minute, per address. The library's defaults would switch them off here: it
keeps its count in memory, and this site builds an instance for each request.

## Members and the board

Accounts are this site's own. A member chooses a username and may hide their
name from the day's board (`showInScoreboard`, their choice alone). Deleting a
member is not offered yet.
