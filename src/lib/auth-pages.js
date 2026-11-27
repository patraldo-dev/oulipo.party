// src/lib/auth-pages.js
// What the sign-in pages share: where a member may be sent back to, and what
// the sign-in library's error codes mean to them.

/**
 * Only a path on this site. "//host" would leave it, so it is not one.
 * @param {string | null | undefined} target
 */
export function safeRedirect(target) {
    return target && target.startsWith('/') && !target.startsWith('//') ? target : '/';
}

/** The library's codes, as the keys of the member's text.
 * @type {Record<string, string>} */
const MESSAGES = {
    INVALID_EMAIL_OR_PASSWORD: 'error.invalid_credentials',
    INVALID_USERNAME_OR_PASSWORD: 'error.invalid_credentials',
    INVALID_PASSWORD: 'error.invalid_credentials',
    USER_NOT_FOUND: 'error.invalid_credentials',
    USER_ALREADY_EXISTS: 'error.user_exists',
    USERNAME_TAKEN: 'error.username_taken',
    INVALID_USERNAME: 'error.invalid_username',
    INVALID_EMAIL: 'error.invalid_email',
    PASSWORD_TOO_SHORT: 'error.password_short',
    EMAIL_NOT_VERIFIED: 'account.unverified'
};

/**
 * The text key for a refusal from the sign-in library. Every refusal reads
 * the same, whatever its reason — throttling included: how hard the site
 * pushes back is not something it explains to whoever is pushing.
 * @param {{ code?: string, status?: number } | null | undefined} error
 */
export function messageFor(error) {
    return (error?.code && MESSAGES[error.code]) || 'error.generic';
}

/** The names the sign-in buttons show.
 * @type {Record<string, string>} */
export const PROVIDER_NAMES = { google: 'Google', github: 'GitHub', discord: 'Discord' };
