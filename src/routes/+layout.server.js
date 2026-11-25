// What every page knows: the member's language, whether they are signed in,
// and which ways of signing in this Worker is set up for.
import { env } from 'cloudflare:workers';
import { signInOptions } from '#lib/auth.js';

/** @type {import('./$types').LayoutServerLoad} */
export function load({ locals }) {
    return {
        locale: locals.locale,
        signedIn: Boolean(locals.user),
        member: locals.user ? { username: locals.user.username, name: locals.user.name } : null,
        providers: signInOptions(env)
    };
}
