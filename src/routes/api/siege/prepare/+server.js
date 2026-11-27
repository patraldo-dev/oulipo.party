// POST /api/siege/prepare { code } — make sure the day's prompt and the room's
// own hidden piece exist. May take a moment: Sappho has to write.
import { json } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { prepareSiege } from '#lib/server/siege.js';
import { fail, readJson } from '../../_respond.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ locals, request }) {
    if (!locals.user) return json({ error: 'unauthorized' }, { status: 401 });
    const body = await readJson(request);
    const code = /** @type {Record<string, unknown>} */ (body)?.code;
    try {
        return json(await prepareSiege(locals.db, env.AI, { userId: locals.user.id, code }));
    } catch (error) {
        return fail(error, 'siege prepare');
    }
}
