// POST /api/duel/lock { story, ropes: [key…] } — lock the member's duel for
// the day and reveal the hidden draft with every sent word marked. The story
// and the ropes are checked again here, whatever the browser sent.
import { json } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { duelDay, lockDuel } from '#lib/server/oulipo-duel.js';
import { fail, readJson } from '../_respond.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ locals, request }) {
    if (!locals.user) return json({ error: 'unauthorized' }, { status: 401 });
    const body = await readJson(request);
    if (!body || typeof body !== 'object') return json({ error: 'story_missing' }, { status: 400 });
    try {
        const view = await lockDuel(locals.db, env.AI, {
            userId: locals.user.id,
            locale: locals.locale,
            day: duelDay(),
            story: /** @type {Record<string, unknown>} */ (body).story,
            ropes: /** @type {Record<string, unknown>} */ (body).ropes
        });
        return json(view);
    } catch (error) {
        return fail(error, 'lock');
    }
}
