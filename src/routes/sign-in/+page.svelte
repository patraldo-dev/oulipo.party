<script>
    import { goto, invalidateAll } from '$app/navigation';
    import { page } from '$app/state';
    import { authClient } from '#lib/auth-client.js';
    import { PROVIDER_NAMES, messageFor, safeRedirect } from '#lib/auth-pages.js';
    import { fill, t } from '#lib/i18n/index.js';

    /** @type {{ data: import('./$types').PageData }} */
    let { data } = $props();

    let identifier = $state('');
    let password = $state('');
    let busy = $state(false);
    let error = $state('');
    // Arriving from the reset page, with a new password.
    let notice = $state(page.url.searchParams.has('reset') ? 'signin.reset_done' : '');

    /** Where to go afterwards: only ever a page of this site. */
    const after = $derived(safeRedirect(page.url.searchParams.get('redirect')));
    const providers = $derived(data.providers.filter((name) => name in PROVIDER_NAMES));

    async function signIn() {
        busy = true;
        error = '';
        const value = identifier.trim();
        const { error: refused } = value.includes('@')
            ? await authClient.signIn.email({ email: value.toLowerCase(), password })
            : await authClient.signIn.username({ username: value, password });
        busy = false;
        if (refused) {
            error = messageFor(refused);
            return;
        }
        await invalidateAll();
        goto(after);
    }

    /** The library takes the browser to the provider and back to `after`. @param {string} provider */
    function signInWith(provider) {
        authClient.signIn.social({ provider, callbackURL: after });
    }
</script>

<svelte:head>
    <title>{$t('signin.title')} — oulipo.party</title>
</svelte:head>

<section class="auth-card glass-surface">
    <h1>{$t('signin.title')}</h1>
    <p>{$t('duel.signin')}</p>

    {#if providers.length}
        <div class="providers">
            {#each providers as provider (provider)}
                <button class="btn-secondary btn-block" onclick={() => signInWith(provider)} disabled={busy}>
                    {fill($t('signin.with'), { provider: PROVIDER_NAMES[provider] })}
                </button>
            {/each}
        </div>
        <div class="auth-divider">{$t('signin.or')}</div>
    {/if}

    {#if notice}
        <p class="auth-message good">{$t(notice)}</p>
    {/if}
    {#if error}
        <p class="auth-message bad" role="alert">{$t(error)}</p>
    {/if}

    <form onsubmit={(event) => { event.preventDefault(); signIn(); }}>
        <div class="field">
            <label for="identifier">{$t('signin.identifier')}</label>
            <input id="identifier" type="text" bind:value={identifier} autocomplete="username" autocapitalize="none" spellcheck="false" required />
        </div>
        <div class="field">
            <label for="password">{$t('signin.password')}</label>
            <input id="password" type="password" bind:value={password} autocomplete="current-password" required />
        </div>
        <button class="btn-primary btn-block" type="submit" disabled={busy}>{$t('signin.submit')}</button>
    </form>

    <div class="auth-links">
        <a href="/reset-password">{$t('signin.forgot')}</a>
        <a href="/sign-up">{ $t('signin.noaccount') }</a>
    </div>
</section>

<style>
    .providers {
        display: grid;
        gap: 0.5rem;
    }
</style>
