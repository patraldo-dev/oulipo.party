// src/lib/auth-client.js — the sign-in library's client, for the browser.
import { createAuthClient } from 'better-auth/svelte';
import { usernameClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
    baseURL: '',
    plugins: [usernameClient()]
});
