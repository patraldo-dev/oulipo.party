// POST /api/duel/rewrite — produce (or return) Sappho's rewrite of her piece
// without the sent words. May take a minute: up to four passes. The round is
// named in the body when the page knows it; otherwise the member's latest
// locked round of the day answers.
import { json } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { duelDay, rewriteDuel } from '#lib/server/oulipo-duel.js';
import { fail, readJson } from '../../_respond.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ locals, request }) {
    if (!locals.user) return json({ error: 'unauthorized' }, { status: 401 });
    const body = (await readJson(request)) ?? {};
    const roundId = typeof body.roundId === 'string' && body.roundId ? body.roundId : null;
    try {
        const view = await rewriteDuel(locals.db, env.AI, { userId: locals.user.id, day: duelDay(), roundId });
        return json(view);
    } catch (error) {
        return fail(error, 'duel rewrite');
    }
}
