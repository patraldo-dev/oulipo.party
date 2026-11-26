# oulipo.party

A daily game for writers, in English, Spanish and French. Sappho, the
storyteller, has written a hidden piece for today's prompt. Write one of your
own, send some of its words against hers, and score the ones her draft used.
Then she rewrites her piece without a single word you sent.

The game was born in the writing community at [patrouch.ca](https://patrouch.ca)
and became its own site here.

## How a duel goes

1. Sappho drafts one hidden piece per language per day, against the day's prompt.
2. You write a piece of your own (30 to 300 words) and send some of its words.
3. A word she used is a hit (+1); a word she did not is a miss (−1). Small words
   never count, in any of the three languages.
4. One duel a day. After you lock it, she rewrites her piece without your words.

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

## Where things are

- `src/lib/oulipo/` — the word engine. Pure, isomorphic, one configuration per
  language (`langs/`), never importing the runtime.
- `src/lib/server/oulipo-duel.js` — the duel's rules and flow, taking `db` and
  `ai` as arguments.
- `src/lib/server/daily-prompt.js` — the day's prompt, one per language.
- `src/lib/server/sappho-persona.js`, `oulipo-sappho.js` — how Sappho is asked
  to write, and how her rewrite is checked.
- `src/lib/auth.js` — members: email with a password, or Google, GitHub or
  Discord. Mail goes through Cloudflare's Email Sending
  (`src/lib/server/email-sender.js`).
- `src/routes/+page.svelte` — the home page is the duel.
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
