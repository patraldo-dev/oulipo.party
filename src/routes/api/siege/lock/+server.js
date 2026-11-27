// POST /api/siege/lock { code, story, ropes: [key…] } — lock the member's words
// for the day. The piece and the words are checked again here, whatever the
// browser sent. When this is the last player counted in, the round resolves
// here, and the answer carries its result.
import { json } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { lockSiege } from '#lib/server/siege.js';
import { fail, readJson } from '../../_respond.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ locals, request }) {
    if (!locals.user) return json({ error: 'unauthorized' }, { status: 401 });
    const body = await readJson(request);
    if (!body || typeof body !== 'object') return json({ error: 'story_missing' }, { status: 400 });
    try {
        return json(
            await lockSiege(locals.db, env.AI, {
                userId: locals.user.id,
                code: body.code,
                story: body.story,
                ropes: body.ropes
            })
        );
    } catch (error) {
        return fail(error, 'siege lock');
    }
}
