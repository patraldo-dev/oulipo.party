// POST /api/siege/join { code } — enter a room with its code, and be counted
// in for today.
import { json } from '@sveltejs/kit';
import { joinRoom } from '#lib/server/siege.js';
import { fail, readJson } from '../../_respond.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ locals, request }) {
    if (!locals.user) return json({ error: 'unauthorized' }, { status: 401 });
    const body = await readJson(request);
    const code = /** @type {Record<string, unknown>} */ (body)?.code;
    try {
        return json(await joinRoom(locals.db, { userId: locals.user.id, code }));
    } catch (error) {
        return fail(error, 'siege join');
    }
}
