// Secrets are not listed in wrangler.jsonc, so the types `wrangler types`
// generates from it do not know them. They are set on each Worker with
// `wrangler secret put NAME [--env staging]`.
declare global {
	namespace Cloudflare {
		interface Env {
			/** Signs sessions and tokens. Required. */
			BETTER_AUTH_SECRET: string;
			/** A social provider is offered only when its id and secret are both set. */
			GOOGLE_CLIENT_SECRET?: string;
			GITHUB_CLIENT_SECRET?: string;
			DISCORD_CLIENT_SECRET?: string;
		}
	}
}

export {};
