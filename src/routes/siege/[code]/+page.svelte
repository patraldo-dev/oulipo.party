<!-- src/routes/siege/[code]/+page.svelte
     A room. Whoever is counted in for today writes a piece and locks words,
     as in the Duel. When the last of them locks, the room shows how everyone
     did against the one hidden piece that is this room's own. -->
<script>
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';
    import { fill, t } from '#lib/i18n/index.js';
    import GameIcon from '#lib/components/GameIcon.svelte';
    import SiegeResult from '#lib/components/SiegeResult.svelte';
    import WordPicker from '#lib/components/WordPicker.svelte';
    import WritingSpace from '#lib/components/WritingSpace.svelte';
    import { DUEL } from '#lib/oulipo/duel-rules.js';
    import { SIEGE, normalizeCode } from '#lib/oulipo/siege-rules.js';
    import { post } from '#lib/api.js';
    import { pieceView, savedPiece } from '#lib/piece.js';

    /** @typedef {import('#lib/oulipo/types.js').SiegeView} SiegeView */
    /** @typedef {'signin' | 'error' | 'noRoom' | 'join' | 'preparing' | 'write' | 'out' | 'waiting' | 'resolved' | 'lapsed' | 'late'} Stage */
    /** @typedef {'' | 'open' | 'join' | 'prepare' | 'lock' | 'rewrite'} Busy */

    let { data } = $props();

    /** @typedef {{ locale: import('#lib/oulipo/types.js').Lang, members: number, full: boolean }} Preview */

    // The page is rendered per visit, so reading the loader's answer once,
    // to start from, is exactly the intent.
    // svelte-ignore state_referenced_locally
    const start = {
        locale: data.locale,
        signedIn: data.signedIn,
        view: /** @type {SiegeView | null} */ (data.view),
        preview: /** @type {Preview | null} */ (data.preview),
        error: data.error,
        code: data.code
    };

    const CODE = normalizeCode(start.code);
    const HERE = `/siege/${CODE}`;
    const LOGIN = `/sign-in?redirect=${encodeURIComponent(HERE)}`;
    const SIGNUP = `/sign-up?redirect=${encodeURIComponent(HERE)}`;

    /** What the server's error codes mean to a player. @type {Record<string, string>} */
    const ERROR_KEYS = {
        story_missing: 'duel.too_short',
        story_too_short: 'duel.too_short',
        story_too_long: 'duel.too_long',
        rope_not_in_story: 'duel.rope_bad',
        ropes_missing: 'duel.rope_bad',
        already_locked: 'siege.already_locked',
        already_resolved: 'siege.late',
        draft_failed: 'duel.prepare_failed',
        prompt_failed: 'duel.prepare_failed',
        no_engine: 'duel.prepare_failed',
        rewrite_failed: 'duel.rewrite_failed',
        room_full: 'siege.room_full',
        no_room: 'siege.no_room',
        too_many_attempts: 'siege.too_many_attempts',
        too_many_rooms: 'siege.too_many_rooms',
        not_a_member: 'siege.not_a_member'
    };

    /** Where this room's piece is kept in the member's own browser. */
    const PIECE_KEY = `oulipo.party:piece:siege:${CODE}`;

    let view = $state(start.view);
    let failure = $state(start.error);
    let prompt = $state(start.view?.prompt ?? '');
    /** True once the room's hidden piece is known to exist. */
    let prepared = $state(false);
    /** The piece: in the browser it starts as whatever was kept. */
    let story = $state(savedPiece(PIECE_KEY));
    let importing = $state(false);
    /** Rope keys, in the order they will be sent. */
    let chosen = $state(/** @type {string[]} */ ([]));
    let busy = $state(/** @type {Busy} */ (''));
    /** i18n key of the last message shown. */
    let notice = $state('');
    /** Passes Sappho has made so far, while the rewrite is still going. */
    let pass = $state(0);
    let pollTimer = $state(/** @type {number | undefined} */ (undefined));
    let rewriteTimer = $state(/** @type {number | undefined} */ (undefined));
    /** True while the room is being asked about, so that asks do not pile up. */
    let asking = false;

    /** The room's language is the game's; the page's own words are the member's. */
    const lang = $derived(view?.locale ?? start.locale);
    /** What the game takes from the piece. Its words are the ones there are to send. */
    const piece = $derived(pieceView(story, lang));
    const candidates = $derived(piece.candidates);
    const storyFits = $derived(piece.storyFits);
    /** Nothing is pressed while a request, or a file, is under way. */
    const held = $derived(busy !== '' || importing);
    const news = new Set(['siege.link_copied']);

    const stage = $derived.by(() => {
        if (!start.signedIn) return 'signin';
        if (failure) return 'error';
        if (!view) return start.preview ? 'join' : 'noRoom';
        if (view.status !== 'writing') return view.status === 'resolved' ? (view.you === 'late' ? 'late' : 'resolved') : 'lapsed';
        if (view.you === 'locked') return 'waiting';
        if (view.you === 'out') return 'out';
        // Until the page's first ask has counted the member in, there is nothing to write in yet.
        return prepared && view.you === 'writing' ? 'write' : 'preparing';
    });

    /** Those counted in who have not locked yet. */
    const waitingOn = $derived(view?.players.filter((player) => !player.locked) ?? []);
    const waitingLine = $derived(
        waitingOn.length === 1
            ? fill($t('siege.waiting_for_one'), { name: waitingOn[0].name, locked: view?.locked ?? 0, total: view?.players.length ?? 0 })
            : fill($t('siege.waiting_for_many'), { n: waitingOn.length, locked: view?.locked ?? 0, total: view?.players.length ?? 0 })
    );
    /** The member may sit out while they are counted in and have not locked. */
    const canSitOut = $derived(view?.status === 'writing' && view.you === 'writing');
    const canLeave = $derived(view?.status !== 'writing' || view.you !== 'locked');

    /** A number with its sign, the way the games show one. @param {number} n */
    const signed = (n) => (n > 0 ? `+${n}` : String(n));

    /** The words of a message, with its numbers filled in. @param {string} key */
    function noticeText(key) {
        return fill($t(key), { n: key === 'siege.too_many_rooms' ? SIEGE.roomsPerMember : key === 'duel.too_long' ? DUEL.maxStoryWords : DUEL.minStoryWords });
    }

    /** Call one of the siege's endpoints. @param {string} path @param {unknown} [body] */
    const call = (path, body) => post(`/api/siege/${path}`, body);

    /** Take the room as the server now gives it, and give it back as what it is.
     *  @param {any} payload */
    function take(payload) {
        view = payload;
        return /** @type {SiegeView} */ (payload);
    }

    /** @param {string} date */
    const dayName = (date) => new Date(`${date}T12:00:00`).toLocaleDateString(start.locale, { month: 'short', day: 'numeric' });

    const stopPolling = () => {
        window.clearTimeout(pollTimer);
        pollTimer = undefined;
    };

    /**
     * Ask how the room stands, and go on asking while anyone is still to
     * lock. A hidden tab does not ask; it starts again when it is shown.
     */
    async function poll() {
        pollTimer = undefined;
        if (!asking && !document.hidden && busy !== 'lock') {
            asking = true;
            try {
                const { ok, payload } = await call('state', { code: CODE });
                if (ok && payload?.code) {
                    const next = take(payload);
                    if (next.status !== 'writing') {
                        if (next.status === 'resolved') rewrite();
                        return;
                    }
                }
            } finally {
                asking = false;
            }
        }
        pollTimer = window.setTimeout(poll, SIEGE.pollMs);
    }
    const startPolling = () => {
        if (pollTimer === undefined) pollTimer = window.setTimeout(poll, SIEGE.pollMs);
    };

    /** The page's first ask: it counts the member in, and settles what is ready. */
    async function refresh() {
        busy = 'open';
        const { ok, payload } = await call('state', { code: CODE });
        busy = '';
        if (ok && payload?.code) {
            const next = take(payload);
            if (next.status === 'writing') {
                if (!prepared) await prepare();
                startPolling();
            } else if (next.status === 'resolved') {
                rewrite();
            }
        } else if (payload?.error) {
            failure = ERROR_KEYS[payload.error] ?? 'duel.error';
        }
    }

    /** Make sure the day's prompt and the room's hidden piece exist. */
    async function prepare() {
        busy = 'prepare';
        notice = '';
        const { ok, payload } = await call('prepare', { code: CODE });
        busy = '';
        if (ok && payload?.draftReady && payload.prompt?.text) {
            prompt = payload.prompt.text;
            prepared = true;
        } else {
            notice = ERROR_KEYS[payload?.error] ?? 'duel.prepare_failed';
        }
    }

    /** Enter the room, then be counted in for today. */
    async function enter() {
        busy = 'join';
        notice = '';
        const { ok, payload } = await call('join', { code: CODE });
        busy = '';
        if (ok && payload?.code) {
            take(payload);
            await prepare();
            startPolling();
        } else {
            notice = ERROR_KEYS[payload?.error] ?? 'duel.error';
        }
    }

    async function lock() {
        busy = 'lock';
        notice = '';
        const { ok, payload } = await call('lock', { code: CODE, story: piece.counted, ropes: chosen });
        busy = '';
        if (ok && payload?.code) {
            const next = take(payload);
            try {
                localStorage.removeItem(PIECE_KEY);
            } catch {
                // nothing was kept
            }
            if (next.status === 'resolved') {
                stopPolling();
                rewrite();
            }
        } else {
            notice = ERROR_KEYS[payload?.error] ?? 'duel.error';
        }
    }

    async function sitOut() {
        if (!window.confirm($t('siege.sit_out_confirm'))) return;
        busy = 'lock';
        const { ok, payload } = await call('sit-out', { code: CODE });
        busy = '';
        if (ok && payload?.code) take(payload);
        else notice = ERROR_KEYS[payload?.error] ?? 'duel.error';
    }

    async function backIn() {
        busy = 'join';
        notice = '';
        const { ok, payload } = await call('join', { code: CODE });
        busy = '';
        if (ok && payload?.code) take(payload);
        else notice = ERROR_KEYS[payload?.error] ?? 'duel.error';
    }

    async function leave() {
        if (!window.confirm($t('siege.leave_confirm'))) return;
        busy = 'lock';
        const { ok, payload } = await call('leave', { code: CODE });
        busy = '';
        if (ok) goto('/siege', { state: { left: true } });
        else notice = ERROR_KEYS[payload?.error] ?? 'duel.error';
    }

    async function copyLink() {
        try {
            await navigator.clipboard.writeText(`${location.origin}${HERE}`);
            notice = 'siege.link_copied';
        } catch {
            notice = 'siege.copy_failed';
        }
    }

    /**
     * Ask for the rewrite until it settles. Each request is one pass of
     * Sappho's; the page asks again a moment after an unfinished answer.
     * Bounded, so a round that never settles cannot keep a tab busy forever.
     * @param {number} tries
     */
    async function rewrite(tries = 0) {
        busy = 'rewrite';
        const { ok, payload } = await call('rewrite', { code: CODE });
        if (ok && payload?.result) {
            const next = take(payload);
            const result = /** @type {NonNullable<SiegeView['result']>} */ (next.result);
            pass = result.rewrite.attempts;
            const status = result.rewrite.status;
            if (status === 'clean' || status === 'escaped') {
                busy = '';
                return;
            }
            if (tries < 30) {
                rewriteTimer = window.setTimeout(() => rewrite(tries + 1), 1500);
                return;
            }
        }
        // A request that failed or never finished is the card's to explain:
        // it says the rewrite did not come through, and offers to ask again.
        busy = '';
        pass = 0;
    }

    onMount(() => {
        // Asking counts the member in for today, so the page asks only once
        // it is open: a page merely drawn never did.
        if (start.signedIn && start.view) refresh();
        return () => {
            stopPolling();
            window.clearTimeout(rewriteTimer);
        };
    });
</script>

<svelte:head>
    <title>{$t('hub.siege_title')} — oulipo.party</title>
</svelte:head>

<div class="game-page">
    <header class="head">
        <GameIcon icon="siege" size={96} />
        <div>
            <h1>{$t('hub.siege_title')}</h1>
            {#if view}
                <p class="tagline">{fill($t('siege.code'), { code: view.code })}</p>
            {:else}
                <p class="tagline">{$t('siege.tagline')}</p>
            {/if}
        </div>
    </header>

    {#if stage !== 'write' && notice}
        <p class="notice" class:news={news.has(notice)} aria-live="polite">{noticeText(notice)}</p>
    {/if}

    {#if stage === 'signin'}
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
    {:else if stage === 'noRoom' || stage === 'error'}
        <section class="glass-surface card center">
            <p class="lead">{$t(stage === 'error' ? failure : 'siege.no_room')}</p>
            <div class="row">
                <a class="btn-secondary" href="/siege">{$t('siege.join_title')}</a>
            </div>
        </section>
    {:else if stage === 'join'}
        <section class="glass-surface card center">
            <h2><GameIcon icon="siege" />{$t('siege.join_room_title')}</h2>
            <p class="lead">
                {fill($t('siege.join_room_body'), {
                    n: start.preview?.members ?? 0,
                    max: SIEGE.maxPlayers,
                    lang: $t(`siege.lang.${start.preview?.locale ?? 'en'}`)
                })}
            </p>
            <details class="howto left">
                <summary>{$t('siege.how_title')}</summary>
                <ol class="steps">
                    <li><span class="step s1">1</span><p>{$t('siege.rule_1')}</p></li>
                    <li><span class="step s2">2</span><p>{$t('siege.rule_2')}</p></li>
                    <li><span class="step s3">3</span><p>{$t('siege.rule_3')}</p></li>
                </ol>
                <p class="note">{$t('duel.note')}</p>
            </details>
            <div class="row">
                <button class="btn-primary big" type="button" onclick={enter} disabled={busy !== '' || start.preview?.full === true}>
                    {busy === 'join' ? '…' : $t('siege.join')}
                </button>
            </div>
            {#if start.preview?.full}<p class="note">{$t('siege.room_full')}</p>{/if}
        </section>
    {:else if view}
        <!-- The room: its code, and who is in for today. -->
        <section class="glass-surface card">
            <div class="room-head">
                <div>
                    <p class="eyebrow">{$t('siege.today')}</p>
                    <p class="code">{view.code}</p>
                </div>
                <div class="row actions">
                    <button class="btn-secondary small" type="button" onclick={copyLink} disabled={busy !== ''}>
                        {$t('siege.copy_link')}
                    </button>
                    {#if canSitOut}
                        <button class="btn-secondary small" type="button" onclick={sitOut} disabled={busy !== ''}>
                            {$t('siege.sit_out')}
                        </button>
                    {/if}
                    {#if canLeave}
                        <button class="btn-secondary small" type="button" onclick={leave} disabled={busy !== ''}>
                            {$t('siege.leave')}
                        </button>
                    {/if}
                </div>
            </div>
            {#if view.locale !== start.locale}
                <p class="note">{fill($t('siege.room_language'), { lang: $t(`siege.lang.${view.locale}`) })}</p>
            {/if}
            {#if view.players.length}
                <ul class="players" aria-label={$t('siege.players')}>
                    {#each view.players as player (player.userId)}
                        <li class:locked={player.locked} class:mine={player.mine}>
                            <span class="pip" aria-hidden="true"></span>
                            <span class="name">
                                {player.name}
                                {#if player.mine}<small> · {$t('duel.you')}</small>{/if}
                            </span>
                            <span class="state">{player.locked ? $t('siege.locked_in') : $t('siege.still_writing')}</span>
                        </li>
                    {/each}
                </ul>
            {/if}
        </section>

        {#if stage === 'preparing'}
            <section class="glass-surface card center">
                {#if busy === 'prepare' || busy === 'open'}
                    <p class="waiting"><span class="dot" aria-hidden="true"></span>{$t('duel.preparing')}</p>
                {:else}
                    <button class="btn-primary" type="button" onclick={prepare}>{$t('duel.retry')}</button>
                {/if}
            </section>
        {:else if stage === 'write' || stage === 'out'}
            {#if stage === 'out'}
                <section class="glass-surface card center">
                    <p class="lead">{$t('siege.sit_back_in_body')}</p>
                    <div class="row">
                        <button class="btn-primary" type="button" onclick={backIn} disabled={busy !== ''}>{$t('siege.sit_back_in')}</button>
                    </div>
                </section>
            {/if}

            {#if stage === 'write'}
                <section class="glass-surface card">
                    <h2><GameIcon icon="prompt" />{$t('duel.prompt_label')}</h2>
                    <p class="prompt">{prompt}</p>
                    <details class="howto" open>
                        <summary>{$t('siege.how_title')}</summary>
                        <ol class="steps">
                            <li><span class="step s1">1</span><p>{$t('siege.rule_1')}</p></li>
                            <li><span class="step s2">2</span><p>{$t('siege.rule_2')}</p></li>
                            <li><span class="step s3">3</span><p>{$t('siege.rule_3')}</p></li>
                        </ol>
                        <p class="note">{$t('duel.note')}</p>
                    </details>
                </section>

                <WritingSpace saveKey={PIECE_KEY} bind:story bind:working={importing} disabled={busy !== ''} oninput={() => (notice = '')} />

                {#if candidates.length}
                    <WordPicker {lang} {candidates} bind:chosen disabled={held}>
                        <div class="row">
                            <button
                                class="btn-primary big"
                                type="button"
                                onclick={lock}
                                disabled={held || !storyFits || chosen.length < DUEL.minRopes}
                            >
                                {busy === 'lock' ? '…' : $t('duel.lock')}
                            </button>
                            <!-- Beside the button: why it is off, while it is off; what it does, once it is on. -->
                            <span class="note">
                                {#if !storyFits}
                                    {fill($t('duel.too_short'), { n: DUEL.minStoryWords })}
                                {:else if chosen.length < DUEL.minRopes}
                                    {$t('duel.pick_one')}
                                {:else}
                                    {$t('siege.lock_hint')}
                                {/if}
                            </span>
                        </div>
                        {#if notice}
                            <p class="notice" aria-live="assertive">{noticeText(notice)}</p>
                        {/if}
                    </WordPicker>
                {/if}

            {/if}
        {:else if stage === 'waiting'}
            <section class="glass-surface card center">
                <p class="locked"><GameIcon icon="score" size={36} />{$t('siege.waiting')}</p>
                <p class="lead">{waitingLine}</p>
                <p class="note">{$t('siege.waiting_note')}</p>
                <p class="note">{$t('siege.can_leave')}</p>
            </section>
        {:else if stage === 'lapsed'}
            <section class="glass-surface card center">
                <p class="lead">{$t('siege.lapsed')}</p>
                <p class="note">{$t('siege.same_code')}</p>
            </section>
        {:else if view.result}
            {#if stage === 'late'}
                <section class="glass-surface card center">
                    <p class="lead">{$t('siege.late')}</p>
                </section>
            {/if}
            <SiegeResult result={view.result} {pass} working={busy === 'rewrite'} onask={() => rewrite()} />
        {/if}

        {#if view.earlier.length}
            <section class="glass-surface card">
                <h2><GameIcon icon="board" />{$t('siege.earlier_title')}</h2>
                <ol class="board">
                    {#each view.earlier as one (one.date)}
                        <li>
                            <a class="earlier" href={`${HERE}/${one.date}`}>
                                <span class="name">{dayName(one.date)}</span>
                                <span class="pts">
                                    {one.status === 'lapsed' ? '—' : one.score === null ? $t('siege.did_not_lock') : signed(one.score)}
                                </span>
                            </a>
                        </li>
                    {/each}
                </ol>
            </section>
        {/if}
    {/if}
</div>

<style>
    .room-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem 1rem;
    }
    .eyebrow {
        margin: 0;
        color: var(--text-muted);
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 0.09em;
        text-transform: uppercase;
    }
    /* A code is short and read out loud: spread its letters. */
    .code {
        margin: 0.15rem 0 0;
        font-family: var(--font-display);
        font-weight: 900;
        font-size: 1.9rem;
        letter-spacing: 0.22em;
        color: var(--text);
    }
    .actions {
        margin-top: 0;
    }

    .players {
        list-style: none;
        margin: 1.1rem 0 0;
        padding: 0;
        display: grid;
        gap: 0.3rem;
    }
    .players li {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 0.65rem;
        padding: 0.45rem 0.7rem;
        border-radius: 10px;
        color: var(--text);
        font-size: 0.97rem;
    }
    .players li.mine {
        background: var(--accent-bg);
        font-weight: 700;
    }
    .pip {
        width: 0.7rem;
        height: 0.7rem;
        border-radius: 50%;
        background: var(--text-muted);
    }
    .players li.locked .pip {
        background: var(--hit);
    }
    .state {
        color: var(--text-dim);
        font-size: 0.86rem;
        font-weight: 600;
    }
    .players li.locked .state {
        color: var(--hit);
    }

    /* A centred card that holds the rules keeps them left-aligned inside. */
    .howto.left {
        text-align: left;
    }

    .earlier {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: 0.75rem;
        grid-column: 1 / -1;
        color: inherit;
        text-decoration: none;
    }
    .earlier:hover .name {
        text-decoration: underline;
    }
    .earlier:focus-visible {
        outline: 3px solid var(--accent);
        outline-offset: 3px;
        border-radius: 6px;
    }
</style>
