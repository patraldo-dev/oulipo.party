// POST /api/siege/rewrite { code, date? } — produce (or return) Sappho's
// rewrite of her piece without a word any player sent. May take a minute: up
// to four passes. An earlier day's round may be asked for by its date.
import { json } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { rewriteSiege } from '#lib/server/siege.js';
import { fail, readJson } from '../../_respond.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ locals, request }) {
    if (!locals.user) return json({ error: 'unauthorized' }, { status: 401 });
    const body = await readJson(request);
    const code = /** @type {Record<string, unknown>} */ (body)?.code;
    try {
        const day = /** @type {Record<string, unknown>} */ (body)?.date;
        return json(
            await rewriteSiege(locals.db, env.AI, {
                userId: locals.user.id,
                code,
                day: typeof day === 'string' && day ? day : undefined
            })
        );
    } catch (error) {
        return fail(error, 'siege rewrite');
    }
}
