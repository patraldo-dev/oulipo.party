<!-- src/routes/siege/+page.svelte
     The Siege's door: start a room and get a code to share, or enter a room
     with the code you were given. -->
<script>
    import { goto } from '$app/navigation';
    import { page } from '$app/state';
    import { fill, t } from '#lib/i18n/index.js';
    import GameIcon from '#lib/components/GameIcon.svelte';
    import { SIEGE, isCode, normalizeCode } from '#lib/oulipo/siege-rules.js';
    import { post } from '#lib/api.js';

    let { data } = $props();

    const HERE = '/siege';
    const LOGIN = `/sign-in?redirect=${encodeURIComponent(HERE)}`;
    const SIGNUP = `/sign-up?redirect=${encodeURIComponent(HERE)}`;

    /** What the server's error codes mean to a player. @type {Record<string, string>} */
    const ERROR_KEYS = {
        too_many_starts: 'siege.too_many',
        too_many_rooms: 'siege.too_many_rooms',
        room_full: 'siege.room_full',
        no_room: 'siege.no_room',
        too_many_attempts: 'siege.too_many_attempts'
    };

    /** 'start' while a room is being started, 'join' while a code is being tried. */
    let busy = $state('');
    let code = $state('');
    /** i18n key of the last message shown. */
    let notice = $state('');

    /** The door is reached from a room the member has just left. */
    const justLeft = $derived(page.state?.left === true);

    /** @param {string} key */
    function noticeText(key) {
        return fill($t(key), { n: key === 'siege.too_many_rooms' ? SIEGE.roomsPerMember : SIEGE.maxPlayers });
    }

    async function start() {
        busy = 'start';
        notice = '';
        const { ok, payload } = await post('/api/siege/create', {});
        busy = '';
        if (ok && payload?.code) goto(`/siege/${payload.code}`);
        else notice = ERROR_KEYS[payload?.error] ?? 'duel.error';
    }

    /** @param {SubmitEvent} event */
    async function join(event) {
        event.preventDefault();
        const typed = normalizeCode(code);
        if (!isCode(typed)) {
            notice = 'siege.no_room';
            return;
        }
        busy = 'join';
        notice = '';
        const { ok, payload } = await post('/api/siege/join', { code: typed });
        busy = '';
        if (ok && payload?.code) goto(`/siege/${payload.code}`);
        else notice = ERROR_KEYS[payload?.error] ?? 'duel.error';
    }
</script>

<svelte:head>
    <title>{$t('hub.siege_title')} — oulipo.party</title>
</svelte:head>

<div class="game-page">
    <header class="head">
        <GameIcon icon="siege" size={96} />
        <div>
            <h1>{$t('hub.siege_title')}</h1>
            <p class="tagline">{$t('siege.tagline')}</p>
        </div>
    </header>

    {#if notice || justLeft}
        <p class="notice" class:news={justLeft && !notice} aria-live="polite">
            {notice ? noticeText(notice) : $t('siege.left')}
        </p>
    {/if}

    {#if !data.signedIn}
        <section class="glass-surface card">
            <ol class="steps">
                <li><span class="step s1">1</span><p>{$t('siege.rule_1')}</p></li>
                <li><span class="step s2">2</span><p>{$t('siege.rule_2')}</p></li>
                <li><span class="step s3">3</span><p>{$t('siege.rule_3')}</p></li>
            </ol>
            <p class="note">{$t('duel.note')}</p>
        </section>
        <section class="glass-surface card center invite">
            <p class="lead">{$t('siege.signin')}</p>
            <div class="row">
                <a class="btn-primary big" href={LOGIN}>{$t('nav.signin')}</a>
                <a class="btn-secondary big" href={SIGNUP}>{$t('nav.signup')}</a>
            </div>
        </section>
    {:else}
        <section class="glass-surface card">
            <h2><GameIcon icon="siege" />{$t('siege.start_title')}</h2>
            <p class="note">{fill($t('siege.start_body'), { n: SIEGE.maxPlayers })}</p>
            <div class="row">
                <button class="btn-primary big" type="button" onclick={start} disabled={busy !== ''}>
                    {busy === 'start' ? '…' : $t('siege.start')}
                </button>
            </div>
        </section>

        <section class="glass-surface card">
            <h2><GameIcon icon="send" />{$t('siege.join_title')}</h2>
            <p class="note">{$t('siege.join_body')}</p>
            <form class="join" onsubmit={join}>
                <input
                    class="code"
                    bind:value={code}
                    maxlength={SIEGE.codeLength}
                    autocomplete="off"
                    autocapitalize="characters"
                    spellcheck="false"
                    placeholder="•••••"
                    aria-label={$t('siege.code_label')}
                />
                <button class="btn-primary big" type="submit" disabled={busy !== ''}>
                    {busy === 'join' ? '…' : $t('siege.join')}
                </button>
            </form>
        </section>
    {/if}
</div>

<style>
    .join {
        display: flex;
        flex-wrap: wrap;
        gap: 0.6rem;
        margin-top: 1rem;
    }
    /* The code is short and read out loud: give it room and spread its letters. */
    .code {
        flex: 1 1 10rem;
        min-width: 0;
        font-family: var(--font-display);
        font-size: 1.6rem;
        font-weight: 800;
        letter-spacing: 0.35em;
        text-transform: uppercase;
        text-align: center;
        padding: 0.6rem 0.4rem 0.6rem 0.75rem;
        color: var(--text);
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-radius: 12px;
    }
    .code::placeholder {
        color: var(--border);
        letter-spacing: 0.2em;
    }
    .code:focus-visible {
        outline: 3px solid var(--accent);
        outline-offset: 1px;
        border-color: var(--accent);
    }
</style>
