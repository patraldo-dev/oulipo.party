// src/hooks.server.js
// Every request: the database, the member's language, and who is signed in.
// The sign-in library's own endpoints under /api/auth are handed to it first.
import { building } from '$app/env';
import { redirect } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { createAuth } from '#lib/auth.js';

/** @type {readonly ('en' | 'es' | 'fr')[]} */
const LANGUAGES = ['en', 'es', 'fr'];

/** @type {import('@sveltejs/kit/hooks').Handle} */
export async function handle({ event, resolve }) {
    if (building) return resolve(event);

    if (!env.DB) throw new Error('The DB binding is missing: the Worker has no database.');

    event.locals.db = env.DB;

    // A link may name the language to arrive in (patrouch.ca sends people on
    // in the language they were reading). It becomes the remembered choice,
    // and the address loses it: left there, a reload would keep overriding
    // the chips.
    const named = event.url.searchParams.get('lang');
    if (named && LANGUAGES.includes(/** @type {'en' | 'es' | 'fr'} */ (named)) && !event.url.pathname.startsWith('/api/')) {
        // Not HttpOnly: the chips on every page change this cookie from script,
        // and a browser refuses to let script overwrite an HttpOnly one.
        event.cookies.set('preferredLanguage', named, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', httpOnly: false });
        const clean = new URL(event.url);
        clean.searchParams.delete('lang');
        redirect(302, `${clean.pathname}${clean.search}${clean.hash}`);
    }

    // The cookie first, then what the browser asks for, then English.
    const cookie = event.cookies.get('preferredLanguage');
    const accepted = event.request.headers.get('accept-language')?.toLowerCase().match(/^[a-z]{2}/)?.[0];
    event.locals.locale = /** @type {'en' | 'es' | 'fr'} */ (
        LANGUAGES.includes(/** @type {'en' | 'es' | 'fr'} */ (cookie))
            ? cookie
            : LANGUAGES.includes(/** @type {'en' | 'es' | 'fr'} */ (accepted))
              ? accepted
              : 'en'
    );

    const auth = createAuth(env);
    if (event.url.pathname === '/api/auth' || event.url.pathname.startsWith('/api/auth/')) {
        return svelteKitHandler({ event, resolve, auth, building });
    }

    try {
        const session = await auth.api.getSession({ headers: event.request.headers });
        event.locals.session = session?.session ?? null;
        event.locals.user = session
            ? {
                  id: session.user.id,
                  // A member who arrived before usernames were required may have none.

                  username: session.user.username || session.user.email.split('@')[0],
                  name: session.user.name,
                  email: session.user.email,
                  emailVerified: session.user.emailVerified,
                  showInScoreboard: session.user.showInScoreboard
              }
            : null;
    } catch (error) {
        console.error('[session] could not be read:', error instanceof Error ? error.message : error);
        event.locals.session = null;
        event.locals.user = null;
    }

    // The page's language is the member's, from the first byte.
    return resolve(event, {
        transformPageChunk: ({ html }) => html.replace('<html lang="en">', `<html lang="${event.locals.locale}">`)
    });
}
