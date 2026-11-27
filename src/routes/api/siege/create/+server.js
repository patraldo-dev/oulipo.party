// POST /api/siege/create — start a room, in the member's language, and be
// counted in for today. The room's code is in the answer.
import { json } from '@sveltejs/kit';
import { createRoom } from '#lib/server/siege.js';
import { fail } from '../../_respond.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ locals }) {
    if (!locals.user) return json({ error: 'unauthorized' }, { status: 401 });
    try {
        return json(await createRoom(locals.db, { userId: locals.user.id, locale: locals.locale }));
    } catch (error) {
        return fail(error, 'siege create');
    }
}
