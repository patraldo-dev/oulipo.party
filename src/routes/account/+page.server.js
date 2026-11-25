// /account — only for a member who is signed in; anyone else is sent to sign
// in first and brought back here.
import { redirect } from '@sveltejs/kit';

/** @type {import('./$types').PageServerLoad} */
export function load({ locals }) {
    if (!locals.user) redirect(303, `/sign-in?redirect=${encodeURIComponent('/account')}`);
    return { member: locals.user };
}
