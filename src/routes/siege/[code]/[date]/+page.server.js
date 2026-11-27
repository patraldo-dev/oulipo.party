// /siege/[code]/[date] — an earlier day of a room, read only, for its
// members. A siege may resolve at the end of its day, when nobody is looking;
// this is where its result is read afterwards.
import { readEarlier } from '#lib/server/siege.js';
import { DuelError } from '#lib/server/oulipo-duel.js';
import { normalizeCode } from '#lib/oulipo/siege-rules.js';

/** @type {import('./$types').PageServerLoad} */
export async function load({ locals, params }) {
    const base = { locale: locals.locale, signedIn: Boolean(locals.user), code: normalizeCode(params.code), date: String(params.date ?? '') };
    const nothing = { ...base, view: /** @type {import('#lib/oulipo/types.js').SiegeView | null} */ (null) };
    if (!locals.user) return nothing;
    try {
        return { ...base, view: await readEarlier(locals.db, locals.user.id, params.code, params.date) };
    } catch (error) {
        // Not the member's room, or no such room: nothing is said about it.
        if (error instanceof DuelError) return nothing;
        console.error('[siege] earlier page failed:', error instanceof Error ? error.message : error);
        return nothing;
    }
}
