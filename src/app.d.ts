// See https://svelte.dev/docs/kit/types#app.d.ts
import type { Session } from 'better-auth';

declare global {
	namespace App {
		interface Locals {
			/** The site's database. */
			db: D1Database;
			/** The member's language: the cookie, then the browser's preference, then English. */
			locale: 'en' | 'es' | 'fr';
			user: {
				id: string;
				username: string;
				name: string;
				email: string;
				emailVerified: boolean;
				showInScoreboard: boolean;
			} | null;
			session: Session | null;
		}
		/** What a page hands the next one through the browser's history. */
		interface PageState {
			/** Set by a room when the member has just left it, so the door can say so. */
			left?: boolean;
		}
	}
}

export {};
