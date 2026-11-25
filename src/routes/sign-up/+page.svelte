<script>
    import { goto, invalidateAll } from '$app/navigation';
    import { page } from '$app/state';
    import { authClient } from '#lib/auth-client.js';
    import { PROVIDER_NAMES, messageFor, safeRedirect } from '#lib/auth-pages.js';
    import { fill, t } from '#lib/i18n/index.js';

    /** @type {{ data: import('./$types').PageData }} */
    let { data } = $props();

    let username = $state('');
    let name = $state('');
    let email = $state('');
    let password = $state('');
    let busy = $state(false);
    let error = $state('');

    const after = $derived(safeRedirect(page.url.searchParams.get('redirect')));
    const providers = $derived(data.providers.filter((provider) => provider in PROVIDER_NAMES));

    async function signUp() {
        busy = true;
        error = '';
        const { error: refused } = await authClient.signUp.email({
            username: username.trim(),
            name: name.trim() || username.trim(),
            email: email.trim().toLowerCase(),
            password,
            callbackURL: after
        });
        busy = false;
        if (refused) {
            error = messageFor(refused);
            return;
        }
        await invalidateAll();
        goto(after);
    }

    /** @param {string} provider */
    function signUpWith(provider) {
        authClient.signIn.social({ provider, callbackURL: after });
    }
</script>

<svelte:head>
    <title>{$t('signup.title')} — oulipo.party</title>
</svelte:head>

<section class="auth-card glass-surface">
    <h1>{$t('signup.title')}</h1>

    {#if providers.length}
        <div class="providers">
            {#each providers as provider (provider)}
                <button class="btn-secondary btn-block" onclick={() => signUpWith(provider)} disabled={busy}>
                    {fill($t('signin.with'), { provider: PROVIDER_NAMES[provider] })}
                </button>
            {/each}
        </div>
        <div class="auth-divider">{$t('signin.or')}</div>
    {/if}

    {#if error}
        <p class="auth-message bad" role="alert">{$t(error)}</p>
    {/if}

    <form onsubmit={(event) => { event.preventDefault(); signUp(); }}>
        <div class="field">
            <label for="username">{$t('signup.username')}</label>
            <input id="username" type="text" bind:value={username} autocomplete="username" autocapitalize="none" spellcheck="false" minlength="3" maxlength="30" pattern="[a-zA-Z0-9_.]+" required />
            <small>{ $t('signup.username_hint') }</small>
        </div>
        <div class="field">
            <label for="name">{$t('signup.name')}</label>
            <input id="name" type="text" bind:value={name} autocomplete="nickname" maxlength="60" />
            <small>{ $t('signup.name_hint') }</small>
        </div>
        <div class="field">
            <label for="email">{$t('signup.email')}</label>
            <input id="email" type="email" bind:value={email} autocomplete="email" autocapitalize="none" spellcheck="false" required />
        </div>
        <div class="field">
            <label for="password">{$t('signup.password')}</label>
            <input id="password" type="password" bind:value={password} autocomplete="new-password" minlength="8" required />
            <small>{ $t('signup.password_hint') }</small>
        </div>
        <button class="btn-primary btn-block" type="submit" disabled={busy}>{$t('signup.submit')}</button>
    </form>

    <div class="auth-links">
        <a href="/sign-in">{ $t('signup.haveaccount') }</a>
    </div>
</section>

<style>
    .providers {
        display: grid;
        gap: 0.5rem;
    }
    small {
        color: var(--text-muted);
    }
</style>
