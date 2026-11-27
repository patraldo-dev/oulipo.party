// POST /api/siege/sit-out { code } — sit out today's siege, so that the rest
// may go on without this member.
import { json } from '@sveltejs/kit';
import { sitOut } from '#lib/server/siege.js';
import { fail, readJson } from '../../_respond.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ locals, request }) {
    if (!locals.user) return json({ error: 'unauthorized' }, { status: 401 });
    const body = await readJson(request);
    const code = /** @type {Record<string, unknown>} */ (body)?.code;
    try {
        return json(await sitOut(locals.db, { userId: locals.user.id, code }));
    } catch (error) {
        return fail(error, 'siege sit-out');
    }
}
