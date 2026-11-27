// Sign-in: node --test tests/auth.test.js
// Member creation, usernames, the verification mail and the providers, all
// through the site's own auth module, on in-memory SQLite.
import test from 'node:test';
import assert from 'node:assert/strict';

import { messageFor } from '../src/lib/auth-pages.js';
import { sendResetLink, signInOptions } from '../src/lib/auth.js';
import { authSchema } from '../src/lib/db/auth-schema.js';
import { resetMail } from '../src/lib/server/email-sender.js';
import { ORIGIN, arrives, errorsLogged, request, setup } from './auth-helpers.js';

const SENDER = { name: 'oulipo.party', email: 'noreply@oulipo.party' };
const MEMBER = {
    email: 'new.member@example.com',
    password: 'a-long-enough-password',
    name: 'New Member',
    username: 'new_member'
};
const cloudflare = (send) => ({ EMAIL: { send } });
// Letters, digits and underscores, 3 to 30 characters: the username plugin's rules.
const RULES = /^[a-z0-9_]{3,30}$/;

// ── Usernames ─────────────────────────────────────────────────────────

test('two members arriving with the same display name both get an account', async () => {
    const { internalAdapter, usernames } = await setup();
    const first = await arrives(internalAdapter, { name: 'Chef Tech', email: 'first@example.com' });
    const second = await arrives(internalAdapter, { name: 'Chef Tech', email: 'second@example.com' });
    assert.ok(first.user.id && second.user.id);
    assert.notEqual(first.user.id, second.user.id);
    assert.deepEqual(usernames(), ['first', 'second']);
});

test('the username is built from the address, and a taken one gets a suffix', async () => {
    const { internalAdapter, usernames } = await setup();
    await arrives(internalAdapter, { name: 'Dana Roe', email: 'dana.roe@example.com' });
    await arrives(internalAdapter, { name: 'Someone Else', email: 'dana.roe@other.example' });
    const [taken, suffixed] = usernames();
    assert.equal(taken, 'dana_roe');
    assert.match(suffixed, /^dana_roe_[a-z0-9]{3}$/);
});

test('a short address still yields a valid username', async () => {
    const { internalAdapter, usernames } = await setup();
    await arrives(internalAdapter, { name: 'Jo', email: 'jo@example.com' });
    assert.match(usernames()[0], RULES);
});

test('GitHub and Discord arrivals obey the same rules as Google ones', async () => {
    const { internalAdapter, usernames } = await setup();
    await arrives(internalAdapter, { name: 'Dana Roe', email: 'first@example.com' });
    await arrives(internalAdapter, { name: 'Dana Roe', email: 'second@example.com' }, 'github');
    await arrives(internalAdapter, { name: 'Dana Roe', email: 'third@example.com' }, 'discord');
    assert.equal(usernames().length, 3);
    for (const username of usernames()) assert.match(username, RULES);
});

test('a username the member chose is left alone', async () => {
    const { internalAdapter, member } = await setup();
    const user = await internalAdapter.createUser({
        email: 'chosen@example.com',
        name: 'Chosen One',
        emailVerified: false,
        username: 'chosen_one'
    });
    assert.equal(member(user.id).username, 'chosen_one');
});

test('a failed lookup never blocks the sign-in', async () => {
    const { internalAdapter, usernames, env } = await setup();
    const prepare = env.DB.prepare;
    env.DB.prepare = (query) => {
        if (query.includes('FROM "user" WHERE "username"')) throw new Error('database unavailable');
        return prepare(query);
    };
    await arrives(internalAdapter, { name: 'Dana Roe', email: 'dana.roe@example.com' });
    assert.match(usernames()[0], /^dana_roe_[a-z0-9]{6}$/);
});

// ── On the board ──────────────────────────────────────────────────────

test('a new member is on the board until they say otherwise', async () => {
    const { internalAdapter, member } = await setup();
    const { user } = await arrives(internalAdapter, { name: 'Dana Roe', email: 'dana@example.com' });
    assert.equal(member(user.id).show_in_scoreboard, 1);
    const chosen = await internalAdapter.createUser({
        email: 'quiet@example.com',
        name: 'Quiet One',
        emailVerified: false,
        username: 'quiet_one'
    });
    assert.equal(member(chosen.id).show_in_scoreboard, 1);
});

// ── The verification mail ─────────────────────────────────────────────

test('a verification mail Cloudflare refuses never costs the member the account', async () => {
    const tried = [];
    const { auth, member } = await setup(
        cloudflare(async (message) => {
            tried.push(message);
            throw Object.assign(new Error('destination address is not a verified address'), {
                code: 'E_RECIPIENT_NOT_ALLOWED'
            });
        })
    );
    let signedUp;
    const logged = await errorsLogged(async () => {
        signedUp = await request(auth, 'POST', '/api/auth/sign-up/email', MEMBER);
    });
    assert.equal(signedUp.status, 200);
    assert.equal(member(signedUp.json.user.id).username, 'new_member');
    assert.equal(tried.length, 1);
    assert.equal(tried[0].to, MEMBER.email);
    assert.deepEqual(tried[0].from, SENDER);
    assert.match(tried[0].html, /verify-email\?token=/);
    assert.ok(
        logged.some((line) => line.includes('E_RECIPIENT_NOT_ALLOWED') && line.includes('not a verified address')),
        'the refusal code and its message are logged'
    );
});

test('when Cloudflare accepts, the mail leaves with the sign-up and nothing is logged', async () => {
    const sent = [];
    const { auth, member } = await setup(cloudflare(async (message) => void sent.push(message)));
    let signedUp;
    const logged = await errorsLogged(async () => {
        signedUp = await request(auth, 'POST', '/api/auth/sign-up/email', MEMBER);
    });
    assert.equal(signedUp.status, 200);
    assert.equal(member(signedUp.json.user.id).username, 'new_member');
    assert.equal(sent.length, 1);
    assert.deepEqual(logged, []);
});

test('a member who asks for the link again is not told it left when it did not', async () => {
    const refused = () => {
        throw Object.assign(new Error('destination address is not a verified address'), {
            code: 'E_RECIPIENT_NOT_ALLOWED'
        });
    };
    const { auth } = await setup(cloudflare(async () => refused()));
    await errorsLogged(async () => {
        await request(auth, 'POST', '/api/auth/sign-up/email', MEMBER);
    });
    let again;
    await errorsLogged(async () => {
        again = await request(auth, 'POST', '/api/auth/send-verification-email', { email: MEMBER.email, callbackURL: '/' });
    });
    assert.notEqual(again.status, 200, 'the answer is not a yes');
    assert.equal(messageFor(again.json), 'error.generic', 'which the account page reads as "could not be sent"');
});

test('nor with no mail service on the Worker at all', async () => {
    const { auth } = await setup();
    await request(auth, 'POST', '/api/auth/sign-up/email', MEMBER);
    const again = await request(auth, 'POST', '/api/auth/send-verification-email', { email: MEMBER.email, callbackURL: '/' });
    assert.notEqual(again.status, 200);
});

test('and is told it left when it did', async () => {
    const sent = [];
    const { auth } = await setup(cloudflare(async (message) => void sent.push(message)));
    await request(auth, 'POST', '/api/auth/sign-up/email', MEMBER);
    const again = await request(auth, 'POST', '/api/auth/send-verification-email', { email: MEMBER.email, callbackURL: '/' });
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.equal(sent.length, 2, 'one with the sign-up, one for the asking');
    assert.equal(sent[1].to, MEMBER.email);
});

// ── The password-reset link ───────────────────────────────────────────

/** A mail Cloudflare refuses on the Free plan, to an address it has not verified. */
const REFUSED = () => {
    throw Object.assign(new Error('destination address is not a verified address'), { code: 'E_RECIPIENT_NOT_ALLOWED' });
};
const MEMBER_HEADERS = new Headers({ origin: ORIGIN, 'cf-connecting-ip': '203.0.113.7', 'accept-language': 'fr' });
const resetLink = (env, email) => sendResetLink(env, email, `${ORIGIN}/reset-password`, MEMBER_HEADERS);

test('a reset mail that could not be sent is not reported as sent', async () => {
    const { auth, env } = await setup(cloudflare(async () => REFUSED()));
    await errorsLogged(async () => {
        await request(auth, 'POST', '/api/auth/sign-up/email', MEMBER);
    });
    // Why the page does not ask the library directly.
    const library = await request(auth, 'POST', '/api/auth/request-password-reset', { email: MEMBER.email, redirectTo: `${ORIGIN}/reset-password` });
    assert.equal(library.status, 200, 'the library says yes before the mail is sent');
    const logged = await errorsLogged(async () => {
        assert.deepEqual(await resetLink(env, MEMBER.email), { sent: false, tooMany: false });
    });
    assert.ok(logged.some((line) => line.includes('not a verified address')), 'the refusal is still in the log');
});

test('a reset mail that leaves is reported as sent, to the member, with a link', async () => {
    const sent = [];
    const { auth, env } = await setup(cloudflare(async (message) => void sent.push(message)));
    await request(auth, 'POST', '/api/auth/sign-up/email', MEMBER);
    const before = sent.length;
    assert.deepEqual(await resetLink(env, '  New.Member@Example.com '), { sent: true, tooMany: false });
    assert.equal(sent.length, before + 1);
    assert.equal(sent[before].to, MEMBER.email, 'the address is trimmed and lower-cased, as the library stores it');
    assert.match(sent[before].html, /reset-password\?token=[A-Za-z0-9]+/);
    // The member's own language travels with the request.
    assert.equal(sent[before].subject, resetMail('fr', '').subject);
    assert.equal(sent[before].html.split('\n')[0], resetMail('fr', '').html.split('\n')[0]);
});

test('an address with no account is answered like any other, and is sent nothing', async () => {
    const sent = [];
    const { env } = await setup(cloudflare(async (message) => void sent.push(message)));
    assert.deepEqual(await resetLink(env, 'nobody@example.com'), { sent: true, tooMany: false });
    assert.deepEqual(sent, []);
});

test('a Worker with no mail service cannot send it, and says so', async () => {
    const { auth, env } = await setup();
    await request(auth, 'POST', '/api/auth/sign-up/email', MEMBER);
    assert.deepEqual(await resetLink(env, MEMBER.email), { sent: false, tooMany: false });
});

test('asking again and again is cut off at three a minute', async () => {
    const sent = [];
    const { env } = await setup(cloudflare(async (message) => void sent.push(message)));
    const answers = [];
    for (let asking = 0; asking < 5; asking++) {
        await errorsLogged(async () => {
            answers.push(await resetLink(env, 'someone@example.com'));
        });
    }
    assert.deepEqual(
        answers.map((answer) => answer.tooMany),
        [false, false, false, true, true]
    );
    assert.deepEqual(sent, [], 'nobody has that address, so nothing is sent either way');
});

// ── The limit on attempts ─────────────────────────────────────────────

test('wrong passwords are cut off: the fourth within ten seconds is not even looked at', async () => {
    const { auth } = await setup();
    await request(auth, 'POST', '/api/auth/sign-up/email', MEMBER);
    const statuses = [];
    for (let attempt = 0; attempt < 5; attempt++) {
        statuses.push(
            (
                await request(
                    auth,
                    'POST',
                    '/api/auth/sign-in/email',
                    { email: MEMBER.email, password: 'not-the-password' },
                    { origin: ORIGIN, 'cf-connecting-ip': '203.0.113.9' }
                )
            ).status
        );
    }
    assert.deepEqual(statuses, [401, 401, 401, 429, 429]);
    // The refusal reads like any other failure: what the site is doing to
    // throttle a guesser is not something it tells the guesser.
    assert.equal(messageFor({ status: 429 }), 'error.generic', 'which the sign-in page tells the member');
    assert.notEqual(messageFor({ code: 'INVALID_EMAIL_OR_PASSWORD' }), 'error.generic', 'a wrong password keeps its own words');
});

test('the count is kept per address, so one guesser does not lock a neighbour out', async () => {
    const { auth } = await setup();
    await request(auth, 'POST', '/api/auth/sign-up/email', MEMBER);
    for (let attempt = 0; attempt < 4; attempt++) {
        await request(
            auth,
            'POST',
            '/api/auth/sign-in/email',
            { email: MEMBER.email, password: 'not-the-password' },
            { origin: ORIGIN, 'cf-connecting-ip': '203.0.113.9' }
        );
    }
    const elsewhere = await request(
        auth,
        'POST',
        '/api/auth/sign-in/email',
        { email: MEMBER.email, password: MEMBER.password },
        { origin: ORIGIN, 'cf-connecting-ip': '203.0.113.10' }
    );
    assert.equal(elsewhere.status, 200, 'the right password, from another address, signs in');
});

test('without the limit table a sign-in request fails outright: the migration comes before the code', async () => {
    // What the order of deploying rests on. The library does not step over a
    // missing table, so migrations/0004_rate_limit.sql is applied to a
    // database before any code that reads it is deployed there.
    const { auth } = await setup({}, [authSchema.user, authSchema.session, authSchema.account, authSchema.verification]);
    await assert.rejects(
        request(auth, 'POST', '/api/auth/sign-up/email', MEMBER, { origin: ORIGIN, 'cf-connecting-ip': '203.0.113.11' }),
        /no such table: rate_limit/
    );
});

test('a Worker with no mail service still signs members up and sends nothing', async () => {
    const { auth, member } = await setup();
    const signedUp = await request(auth, 'POST', '/api/auth/sign-up/email', MEMBER);
    assert.equal(signedUp.status, 200);
    assert.equal(member(signedUp.json.user.id).email_verified, 0, 'the address is simply not verified yet');
});

// ── The providers ─────────────────────────────────────────────────────

test('a provider is offered only when it has both an id and a secret', () => {
    assert.deepEqual(signInOptions({}), []);
    assert.deepEqual(signInOptions({ GOOGLE_CLIENT_ID: 'id' }), [], 'an id without its secret is not enough');
    assert.deepEqual(signInOptions({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }), ['google']);
    assert.deepEqual(
        signInOptions({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', DISCORD_CLIENT_ID: 'd', DISCORD_CLIENT_SECRET: 's' }).sort(),
        ['discord', 'google']
    );
});

test('Google, GitHub and Discord sign-in each start, and come back to this site', async () => {
    const { auth } = await setup({
        GOOGLE_CLIENT_ID: 'g',
        GOOGLE_CLIENT_SECRET: 'gs',
        GITHUB_CLIENT_ID: 'h',
        GITHUB_CLIENT_SECRET: 'hs',
        DISCORD_CLIENT_ID: 'd',
        DISCORD_CLIENT_SECRET: 'ds'
    });
    const providers = [
        ['google', 'https://accounts.google.com/o/oauth2/v2/auth'],
        ['github', 'https://github.com/login/oauth/authorize'],
        ['discord', 'https://discord.com/api/oauth2/authorize?scope=identify+email']
    ];
    for (const [provider, startsWith] of providers) {
        const started = await request(auth, 'POST', '/api/auth/sign-in/social', { provider, callbackURL: '/' });
        assert.equal(started.status, 200, provider);
        assert.ok(started.json.url.startsWith(startsWith), `${provider}: ${started.json.url}`);
        assert.ok(decodeURIComponent(started.json.url).includes(`${ORIGIN}/api/auth/callback/${provider}`), `${provider} returns here`);
    }
    // From another address: the limit above allows three sign-in attempts in ten seconds.
    assert.equal(
        (
            await request(auth, 'POST', '/api/auth/sign-in/social', { provider: 'nope' }, { 'cf-connecting-ip': '203.0.113.5' })
        ).status,
        404
    );
});

test('a provider that is not set up is not offered at all', async () => {
    const { auth } = await setup({ GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 'gs' });
    assert.equal((await request(auth, 'POST', '/api/auth/sign-in/social', { provider: 'google' })).status, 200);
    assert.equal((await request(auth, 'POST', '/api/auth/sign-in/social', { provider: 'discord' })).status, 404);
});

// ── The whole flow ────────────────────────────────────────────────────

test('a member signs up, is signed in, signs out, and signs back in', async () => {
    const { auth } = await setup();
    const signedUp = await request(auth, 'POST', '/api/auth/sign-up/email', MEMBER);
    assert.equal(signedUp.status, 200);
    assert.ok(signedUp.cookie, 'signed in from the start');
    assert.equal(signedUp.json.user.username, 'new_member');

    const session = async (cookie) => (await request(auth, 'GET', '/api/auth/get-session', undefined, cookie ? { cookie } : {})).json;
    assert.equal((await session(signedUp.cookie))?.user?.email, MEMBER.email);
    assert.equal((await session())?.user ?? null, null, 'nobody else is signed in');

    await request(auth, 'POST', '/api/auth/sign-out', {}, { cookie: signedUp.cookie });
    assert.equal((await session(signedUp.cookie))?.user ?? null, null, 'the session is gone, not just the cookie');

    const wrong = await request(auth, 'POST', '/api/auth/sign-in/email', { email: MEMBER.email, password: 'wrong-password' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.cookie, undefined, 'and no session cookie is left behind');
    const right = await request(auth, 'POST', '/api/auth/sign-in/email', { email: MEMBER.email, password: MEMBER.password });
    assert.equal(right.status, 200);
    assert.ok(right.cookie);
    assert.equal((await session(right.cookie))?.user?.email, MEMBER.email);

    const forged = await request(
        auth,
        'POST',
        '/api/auth/sign-in/email',
        { email: MEMBER.email, password: MEMBER.password },
        { origin: 'https://evil.example' }
    );
    assert.equal(forged.status, 403);
});
