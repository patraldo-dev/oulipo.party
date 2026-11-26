// POST /api/reset-link { email } — ask for a password-reset link, and answer
// whether its mail left. The sign-in library's own endpoint for this answers
// before the mail is sent, so a mail it could not send still comes back a
// yes (sendResetLink, in src/lib/auth.js, is why this one can be honest).
import { json } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { sendResetLink } from '#lib/auth.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, url }) {
    // Only the site's own pages may ask. A JSON request is not covered by
    // SvelteKit's own cross-site check, which looks at form posts only.
    if (request.headers.get('origin') !== url.origin) return json({ error: 'forbidden' }, { status: 403 });
    const body = await request.json().catch(() => null);
    const email = /** @type {{ email?: unknown } | null} */ (body)?.email;
    if (typeof email !== 'string' || email.length > 254) return json({ error: 'invalid_email' }, { status: 400 });
    const answer = await sendResetLink(env, email, `${url.origin}/reset-password`, request.headers);
    if (answer.tooMany) return json({ error: 'too_many' }, { status: 429 });
    return json({ sent: answer.sent });
}
