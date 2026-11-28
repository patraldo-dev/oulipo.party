// POST /api/duel/prepare — ready a round for the member: reuse the one they
// are writing, or make a fresh one with its own hidden piece against the
// day's prompt. Answers with the prompt, that the piece is ready, and the
// round's id; never with the piece itself.
import { json } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { duelDay, prepareDuel } from '#lib/server/oulipo-duel.js';
import { fail } from '../../_respond.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ locals }) {
    if (!locals.user) return json({ error: 'unauthorized' }, { status: 401 });
    try {
        return json(await prepareDuel(locals.db, env.AI, locals.user.id, locals.locale, duelDay()));
    } catch (error) {
        return fail(error, 'duel prepare');
    }
}
