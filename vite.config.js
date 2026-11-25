import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [
        sveltekit({
            // The sign-in library's handler is served for these paths only.
            adapter: adapter({ routes: { include: ['/api/auth/(.*)', '/api/auth'] } })
        })
    ]
});
