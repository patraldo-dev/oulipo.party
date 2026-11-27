// POST /api/siege/state { code } — the room as it stands: who is in, who has
// locked, and the result once there is one. Asking counts the member in for
// the day, and settles whatever is ready to be settled.
import { json } from '@sveltejs/kit';
import { stateOf } from '#lib/server/siege.js';
import { fail, readJson } from '../../_respond.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ locals, request }) {
    if (!locals.user) return json({ error: 'unauthorized' }, { status: 401 });
    const body = await readJson(request);
    const code = /** @type {Record<string, unknown>} */ (body)?.code;
    try {
        return json(await stateOf(locals.db, locals.user.id, code));
    } catch (error) {
        return fail(error, 'siege state');
    }
}
