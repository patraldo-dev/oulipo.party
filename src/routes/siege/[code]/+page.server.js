// /siege/[code] — a room. What a member may see before the page asks to be
// counted in for the day. A member who is not in the room yet learns only
// enough to decide to join.
import { readSiege } from '#lib/server/siege.js';
import { DuelError } from '#lib/server/oulipo-duel.js';
import { normalizeCode } from '#lib/oulipo/siege-rules.js';

/** @type {import('./$types').PageServerLoad} */
export async function load({ locals, params }) {
    const base = { locale: locals.locale, signedIn: Boolean(locals.user), code: normalizeCode(params.code) };
    const nothing = { ...base, view: /** @type {import('#lib/oulipo/types.js').SiegeView | null} */ (null), preview: null, error: '' };
    if (!locals.user) return nothing;
    try {
        const seen = await readSiege(locals.db, locals.user.id, params.code);
        if (!seen) return nothing;
        return { ...base, view: seen.view, preview: seen.preview, error: '' };
    } catch (error) {
        // A member who has looked for too many rooms today is told so, and no more.
        if (error instanceof DuelError && error.code === 'too_many_attempts') return { ...nothing, error: 'siege.too_many_attempts' };
        console.error('[siege] page failed:', error instanceof Error ? error.message : error);
        return { ...nothing, error: 'duel.error' };
    }
}
