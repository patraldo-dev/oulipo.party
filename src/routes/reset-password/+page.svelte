<script>
    import { goto } from '$app/navigation';
    import { page } from '$app/state';
    import { authClient } from '#lib/auth-client.js';
    import { messageFor } from '#lib/auth-pages.js';
    import { t } from '#lib/i18n/index.js';

    // With a token in the address the member has followed the link and
    // chooses a new password; without one they ask for the link.
    const token = $derived(page.url.searchParams.get('token'));

    let email = $state('');
    let password = $state('');
    let busy = $state(false);
    let sent = $state(false);
    let error = $state('');

    async function askForLink() {
        busy = true;
        error = '';
        // Asked through the site's own endpoint, which waits to know whether
        // the mail left: the library's own answers before it is sent. An
        // address that has no account is answered the same as one that has,
        // so nobody can find out who is a member.
        const answer = await fetch('/api/reset-link', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: email.trim().toLowerCase() })
        }).catch(() => null);
        busy = false;
        // A refusal is answered like any other failure, in the same words —
        // however the site is throttling, it says so to nobody.
        const left = answer?.ok && (await answer.json().catch(() => null))?.sent === true;
        if (left) sent = true;
        else error = 'reset.failed';
    }

    async function savePassword() {
        busy = true;
        error = '';
        const { error: refused } = await authClient.resetPassword({ newPassword: password, token: token ?? '' });
        busy = false;
        if (refused) {
            error = messageFor(refused);
            return;
        }
        goto('/sign-in?reset=1');
    }
</script>

<svelte:head>
    <title>{$t('reset.title')} — oulipo.party</title>
</svelte:head>

<section class="auth-card glass-surface">
    {#if token}
        <h1>{$t('reset.new_title')}</h1>
        {#if error}
            <p class="auth-message bad" role="alert">{$t(error)}</p>
        {/if}
        <form onsubmit={(event) => { event.preventDefault(); savePassword(); }}>
            <div class="field">
                <label for="password">{$t('signup.password')}</label>
                <input id="password" type="password" bind:value={password} autocomplete="new-password" minlength="8" required />
                <small>{$t('signup.password_hint')}</small>
            </div>
            <button class="btn-primary btn-block" type="submit" disabled={busy}>{$t('reset.new_submit')}</button>
        </form>
    {:else}
        <h1>{$t('reset.title')}</h1>
        <p>{$t('reset.intro')}</p>
        {#if sent}
            <p class="auth-message good">{$t('reset.sent')}</p>
        {/if}
        {#if error}
            <p class="auth-message bad" role="alert">{$t(error)}</p>
        {/if}
        <form onsubmit={(event) => { event.preventDefault(); askForLink(); }}>
            <div class="field">
                <label for="email">{$t('signup.email')}</label>
                <input id="email" type="email" bind:value={email} autocomplete="email" autocapitalize="none" spellcheck="false" required />
            </div>
            <button class="btn-primary btn-block" type="submit" disabled={busy}>{$t('reset.submit')}</button>
        </form>
        <div class="auth-links">
            <a href="/sign-in">{$t('signup.haveaccount')}</a>
        </div>
    {/if}
</section>

<style>
    small {
        color: var(--text-muted);
    }
</style>
