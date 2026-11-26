// src/lib/auth.js — Better Auth on Cloudflare D1 for oulipo.party.
//
// Three ways in: an email address with a password, or one of the social
// providers whose id and secret are both set (Google, GitHub, Discord).
// Mail goes through Cloudflare's Email Sending (server/email-sender.js).
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/d1';
import { username } from 'better-auth/plugins';
import { authSchema } from './db/auth-schema.js';
import {
    emailConfigured,
    languageOf,
    resetMail,
    sendEmail,
    verificationMail
} from './server/email-sender.js';

/** @typedef {Cloudflare.Env} Env */

// PBKDF2 through WebCrypto, which does not count against a Worker's CPU time.
// Format: pbkdf2:iterations:salt_base64:hash_base64
const PBKDF2_ITERATIONS = 100000;
const HASH_LENGTH = 32; // 256 bits

/** @param {string} password */
export async function hashPassword(password) {
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        keyMaterial,
        HASH_LENGTH * 8
    );
    const hashB64 = btoa(String.fromCharCode(...new Uint8Array(bits)));
    const saltB64 = btoa(String.fromCharCode(...salt));
    return `pbkdf2:${PBKDF2_ITERATIONS}:${saltB64}:${hashB64}`;
}

/** @param {string} hash @param {string} password */
async function verifyPassword(hash, password) {
    const [scheme, iterations, saltB64, hashB64] = hash.split(':');
    if (scheme !== 'pbkdf2' || !iterations || !saltB64 || !hashB64) return false;
    const enc = new TextEncoder();
    const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
    const expected = Uint8Array.from(atob(hashB64), (c) => c.charCodeAt(0));
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: parseInt(iterations, 10), hash: 'SHA-256' },
        keyMaterial,
        expected.length * 8
    );
    const derived = new Uint8Array(bits);
    return derived.length === expected.length && derived.every((byte, i) => byte === expected[i]);
}

/**
 * A username nobody holds yet, for members who arrive without one (a social
 * sign-in): the part of the address before the @ when that is free, otherwise
 * the same with a short suffix. Letters, digits and underscores only, 3 to 30
 * characters, as the username plugin requires.
 * @param {D1Database} db
 * @param {string} email
 */
async function freeUsername(db, email) {
    const base =
        String(email || '')
            .split('@')[0]
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 24) || 'member';
    const suffixed = (/** @type {number} */ length) =>
        `${base.slice(0, 29 - length)}_${Math.random().toString(36).slice(2, 2 + length)}`;
    // The library calls this hook without a context on this path, so the
    // lookup goes to the database binding directly. When the lookup fails, or
    // every try is taken, a longer suffix makes a collision vanishingly rare.
    if (!db) return suffixed(6);
    let candidate = base.length >= 3 ? base : suffixed(3);
    try {
        for (let attempt = 0; attempt < 10; attempt++) {
            const held = await db.prepare('SELECT 1 FROM "user" WHERE "username" = ?').bind(candidate).first();
            if (!held) return candidate;
            candidate = suffixed(3);
        }
    } catch {
        // fall through to the longer suffix
    }
    return suffixed(6);
}

/** The social providers this Worker is set up for: an id and a secret each. @param {Env} env */
export function socialProviders(env) {
    /** @type {Partial<Record<'google' | 'github' | 'discord', { clientId: string, clientSecret: string }>>} */
    const providers = {};
    const ids = /** @type {const} */ ({ google: env.GOOGLE_CLIENT_ID, github: env.GITHUB_CLIENT_ID, discord: env.DISCORD_CLIENT_ID });
    for (const name of /** @type {('google' | 'github' | 'discord')[]} */ (Object.keys(ids))) {
        const id = ids[name];
        const secret = env[/** @type {'GOOGLE_CLIENT_SECRET' | 'GITHUB_CLIENT_SECRET' | 'DISCORD_CLIENT_SECRET'} */ (`${name.toUpperCase()}_CLIENT_SECRET`)];
        if (id && secret) providers[name] = { clientId: id, clientSecret: secret };
    }
    return providers;
}

/** Whether a request is the one that opens an account with an address and a password.
 *  The library may hand over no request at all; that is not a sign-up.
 *  @param {Request | undefined} request */
const atSignUp = (request) =>
    Boolean(request && new URL(request.url).pathname.endsWith('/sign-up/email'));

/**
 * A Better Auth instance for one request, and the one thing about it that
 * has to outlive an answer: whether the last password-reset mail left.
 * @param {Env} env
 */
function buildAuth(env) {
    const baseURL = env.BETTER_AUTH_URL || 'https://oulipo.party';
    /** @type {{ sent: boolean } | null} */
    let resetSent = null;
    const auth = betterAuth({
        secret: env.BETTER_AUTH_SECRET,
        baseURL,
        rateLimit: {
            // The library keeps its count in memory unless told otherwise, and
            // switches itself on only when it believes it runs in production.
            // An instance here lives for one request, so memory starts empty
            // every time, and nothing tells a Worker what it runs as: the
            // limits would never hold. In the database they hold for the site.
            enabled: true,
            storage: 'database'
        },
        advanced: {
            ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] }
        },
        database: drizzleAdapter(drizzle(env.DB), { provider: 'sqlite', schema: authSchema }),
        emailAndPassword: {
            enabled: true,
            minPasswordLength: 8,
            autoSignIn: true,
            password: {
                hash: hashPassword,
                verify: ({ hash, password }) => verifyPassword(hash, password)
            },
            // The library answers a reset request before this has run, and
            // keeps a refusal to its log. The outcome is kept here for the
            // member to hear it (sendResetLink below), or they would wait for
            // a link that is never coming.
            sendResetPassword: async ({ user, token }, request) => {
                try {
                    if (!emailConfigured(env)) throw new Error('No email service is configured');
                    const link = `${baseURL}/reset-password?token=${token}`;
                    await sendEmail(env, { to: user.email, ...resetMail(languageOf(request), link) });
                    resetSent = { sent: true };
                } catch (error) {
                    resetSent = { sent: false };
                    throw error;
                }
            },
            // The page sends the member on to sign in itself; a redirect
            // answered to a request made from a page would only confuse it.
            onPasswordReset: async () => {}
        },
        emailVerification: {
            sendOnSignUp: true,
            autoSignInAfterVerification: true,
            // Nor may a refused or failed verification mail fail the sign-up:
            // the member keeps the account and can ask for the link again.
            // A member who does ask is answered the truth of it, though.
            sendVerificationEmail: async ({ user, url }, request) => {
                const asked = !atSignUp(request);
                if (!emailConfigured(env)) {
                    console.warn('[sendVerificationEmail] no email service configured; not sent');
                    if (asked) throw new Error('No email service is configured');
                    return;
                }
                const link = url.replace(/callbackURL=[^&]*/, 'callbackURL=%2F');
                try {
                    await sendEmail(env, { to: user.email, ...verificationMail(languageOf(request), link) });
                } catch (error) {
                    if (asked) throw error;
                    /** @type {{ code?: string, message?: string } | null} */
                    const refused = /** @type {any} */ (error);
                    console.error('[sendVerificationEmail] not sent:', refused?.code ?? refused, refused?.message ?? '');
                }
            }
        },
        socialProviders: /** @type {any} */ (socialProviders(env)),
        session: {
            expiresIn: 60 * 60 * 24 * 30, // 30 days
            updateAge: 60 * 60 * 24
        },
        user: {
            additionalFields: {
                // Whether the member appears on the day's board. Their choice.
                showInScoreboard: { type: 'boolean', defaultValue: true, input: true }
            }
        },
        databaseHooks: {
            user: {
                create: {
                    before: async (userData) => {
                        // A social sign-in brings a display name but no
                        // username. The name is neither unique nor always a
                        // valid username, and the column is unique: a second
                        // member arriving with the same display name would
                        // collide there and the whole sign-in would fail.
                        if (!userData.username) userData.username = await freeUsername(env.DB, userData.email);
                        return { data: userData };
                    }
                }
            }
        },
        trustedOrigins: [baseURL, 'https://*.chef-tech.workers.dev', 'http://localhost:5173'],
        plugins: [username({ minUsernameLength: 3, maxUsernameLength: 30 })]
    });
    return { auth, resetSent: () => resetSent };
}

/** A Better Auth instance for one request. @param {Env} env */
export function createAuth(env) {
    return buildAuth(env).auth;
}

/** The headers of a member's request that the library's own checks read:
 *  where the request came from, who made it, and which language to write in.
 *  @param {Headers} headers
 *  @returns {Record<string, string>} */
function carried(headers) {
    /** @type {Record<string, string>} */
    const out = {};
    for (const name of ['origin', 'referer', 'cf-connecting-ip', 'x-forwarded-for', 'accept-language', 'user-agent']) {
        const value = headers.get(name);
        if (value) out[name] = value;
    }
    return out;
}

/**
 * Ask for a password-reset link, and wait to learn whether its mail left.
 * The request goes through the library's own endpoint, so that its checks on
 * the origin and its limit on asking hold, on an instance that remembers how
 * the mail ended. An address with no account is sent nothing and answers
 * like any other, so nothing is told about who is a member.
 * @param {Env} env
 * @param {string} email
 * @param {string} redirectTo
 * @param {Headers} headers the member's own request headers
 * @returns {Promise<{ sent: boolean, tooMany: boolean }>}
 */
export async function sendResetLink(env, email, redirectTo, headers) {
    const baseURL = env.BETTER_AUTH_URL || 'https://oulipo.party';
    const { auth, resetSent } = buildAuth(env);
    // Addresses are stored in lower case, and compared as they are stored.
    const address = email.trim().toLowerCase();
    const answer = await auth.handler(
        new Request(`${baseURL}/api/auth/request-password-reset`, {
            method: 'POST',
            headers: { ...carried(headers), 'content-type': 'application/json' },
            body: JSON.stringify({ email: address, redirectTo })
        })
    );
    return { sent: answer.ok ? (resetSent()?.sent ?? true) : false, tooMany: answer.status === 429 };
}

/** What the sign-in pages need to know: which ways in are open. @param {Env} env */
export const signInOptions = (env) => Object.keys(socialProviders(env));
