// POST /api/siege/leave { code } — leave a room for good. A member who has
// already locked today's words is told to come back tomorrow.
import { json } from '@sveltejs/kit';
import { leaveRoom } from '#lib/server/siege.js';
import { fail, readJson } from '../../_respond.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ locals, request }) {
    if (!locals.user) return json({ error: 'unauthorized' }, { status: 401 });
    const body = await readJson(request);
    const code = /** @type {Record<string, unknown>} */ (body)?.code;
    try {
        await leaveRoom(locals.db, { userId: locals.user.id, code });
        return json({ left: true });
    } catch (error) {
        return fail(error, 'siege leave');
    }
}
