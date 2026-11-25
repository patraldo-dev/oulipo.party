<script>
    import { goto, invalidateAll } from '$app/navigation';
    import { authClient } from '#lib/auth-client.js';
    import { messageFor } from '#lib/auth-pages.js';
    import { fill, t } from '#lib/i18n/index.js';

    /** @type {{ data: import('./$types').PageData }} */
    let { data } = $props();

    /** What the member chose after touching the switch; null until then. */
    let choice = $state(/** @type {boolean | null} */ (null));
    const onBoard = $derived(choice ?? data.member.showInScoreboard);
    let message = $state(/** @type {'good' | 'bad'} */ ('good'));
    let text = $state('');
    let busy = $state(false);

    /** @param {Event} event */
    async function setBoard(event) {
        const input = /** @type {HTMLInputElement} */ (event.currentTarget);
        choice = input.checked;
        busy = true;
        text = '';
        // The field is the member's own to change (input: true on the server),
        // but in plain JavaScript the client's type does not know it.
        const { error } = await authClient.updateUser(/** @type {any} */ ({ showInScoreboard: onBoard }));
        busy = false;
        if (error) {
            choice = null;
            message = 'bad';
            text = 'account.save_failed';
            return;
        }
        message = 'good';
        text = 'account.saved';
        await invalidateAll();
    }

    async function sendLinkAgain() {
        busy = true;
        text = '';
        const { error } = await authClient.sendVerificationEmail({ email: data.member.email, callbackURL: '/' });
        busy = false;
        message = error ? 'bad' : 'good';
        text = error ? messageFor(error) === 'error.generic' ? 'account.resend_failed' : messageFor(error) : 'account.resend_done';
    }

    async function signOut() {
        await authClient.signOut();
        await invalidateAll();
        goto('/');
    }
</script>

<svelte:head>
    <title>{$t('account.title')} — oulipo.party</title>
</svelte:head>

<section class="auth-card glass-surface" style="max-width: 34rem;">
    <h1>{$t('account.title')}</h1>

    <dl>
        <div class="account-row">
            <dt>{$t('account.username')}</dt>
            <dd>{data.member.username}</dd>
        </div>
        <div class="account-row">
            <dt>{$t('account.email')}</dt>
            <dd>{data.member.email}</dd>
        </div>
    </dl>

    {#if data.member.emailVerified}
        <p class="auth-message good">{$t('account.verified')}</p>
    {:else}
        <p class="auth-message bad">
            {$t('account.unverified')}
            <button class="btn-secondary" type="button" onclick={sendLinkAgain} disabled={busy} style="margin-top: 0.6rem;">
                {$t('account.resend')}
            </button>
        </p>
    {/if}

    <label class="account-toggle">
        <input type="checkbox" checked={onBoard} onchange={setBoard} disabled={busy} />
        <span>
            <strong>{$t('account.scoreboard')}</strong>
            <small>{$t('account.scoreboard_hint')}</small>
        </span>
    </label>

    {#if text}
        <p class="auth-message {message}">{$t(text)}</p>
    {/if}

    <button class="btn-secondary" type="button" onclick={signOut}>{$t('nav.signout')}</button>
</section>
