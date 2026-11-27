// /siege — the Siege's door: start a room and get a code, or enter one with
// the code you were given. The room itself is at /siege/[code].
/** @type {import('./$types').PageServerLoad} */
export function load({ locals }) {
    return { locale: locals.locale, signedIn: Boolean(locals.user) };
}
