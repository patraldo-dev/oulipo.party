<!-- src/routes/duel/+page.svelte
     The solitaire duel. Sappho has written a hidden piece for today's
     prompt; the player writes one, sends some of its words against hers,
     and scores the ones her draft used. One duel a day. The Siege (/siege)
     shares the writing space, the word picker and her rewrite with it. -->
<script>
    import { onMount } from 'svelte';
    import { fill, t } from '#lib/i18n/index.js';
    import GameIcon from '#lib/components/GameIcon.svelte';
    import MarkedPiece from '#lib/components/MarkedPiece.svelte';
    import RewriteCard from '#lib/components/RewriteCard.svelte';
    import WordPicker from '#lib/components/WordPicker.svelte';
    import WritingSpace from '#lib/components/WritingSpace.svelte';
    import { DUEL } from '#lib/oulipo/duel-rules.js';
    import { pieceView, savedPiece } from '#lib/piece.js';
    import { post } from '#lib/api.js';

    /** @typedef {import('#lib/oulipo/types.js').RoundView} RoundView */
    /** @typedef {'unavailable' | 'signin' | 'preparing' | 'write' | 'locked'} Stage */
    /** @typedef {'' | 'prepare' | 'lock' | 'rewrite'} Busy */

    let { data } = $props();

    // The page is rendered per visit, so reading the loader's answer once,
    // to start from, is exactly the intent.
    // svelte-ignore state_referenced_locally
    const start = {
        locale: data.locale,
        stage: /** @type {Stage} */ (
            data.unavailable
                ? 'unavailable'
                : data.round
                  ? 'locked'
                  : !data.signedIn
                    ? 'signin'
                    : data.prompt && data.draftReady
                      ? 'write'
                      : 'preparing'
        ),
        prompt: data.prompt?.text ?? '',
        round: /** @type {RoundView | null} */ (data.round ?? null),
        board: data.board ?? []
    };

    const lang = start.locale;

    const HERE = '/duel';
    const LOGIN = `/sign-in?redirect=${encodeURIComponent(HERE)}`;
    const SIGNUP = `/sign-up?redirect=${encodeURIComponent(HERE)}`;

    /** What the server's error codes mean to a player. @type {Record<string, string>} */
    const ERROR_KEYS = {
        story_missing: 'duel.too_short',
        story_too_short: 'duel.too_short',
        story_too_long: 'duel.too_long',
        rope_not_in_story: 'duel.rope_bad',
        ropes_missing: 'duel.rope_bad',
        already_locked: 'duel.already_locked',
        draft_failed: 'duel.prepare_failed',
        prompt_failed: 'duel.prepare_failed',
        no_engine: 'duel.prepare_failed',
        rewrite_failed: 'duel.rewrite_failed'
    };

    /** Where the piece is kept in the member's own browser, per language. */
    const PIECE_KEY = `oulipo.party:piece:${start.locale}`;

    let stage = $state(start.stage);
    let prompt = $state(start.prompt);
    /** The piece: in the browser it starts as whatever was kept, whatever stage the
     *  page opens in, so that none is dropped because a prompt was not ready yet. */
    let story = $state(savedPiece(PIECE_KEY));
    /** True while the writing space is bringing a file in. */
    let importing = $state(false);
    /** Rope keys, in the order they will be sent. */
    let chosen = $state(/** @type {string[]} */ ([]));
    let round = $state(start.round);
    let board = $state(start.board);
    let busy = $state(/** @type {Busy} */ (''));
    /** i18n key of the last message shown. */
    let notice = $state('');
    /** "Copied" is news, and said in ink rather than in red. */
    const noticeIsNews = $derived(notice === 'duel.copied');
    /** Passes Sappho has made so far, while the rewrite is still going. */
    let pass = $state(0);
    let pollTimer = $state(/** @type {number | undefined} */ (undefined));

    /** What the game takes from the piece. Its words are the ones there are to send. */
    const piece = $derived(pieceView(story, lang));
    const candidates = $derived(piece.candidates);
    const storyFits = $derived(piece.storyFits);
    /** Nothing is pressed while a request, or a file, is under way. */
    const held = $derived(busy !== '' || importing);

    /** The words of a message, with its numbers filled in. @param {string} key */
    function noticeText(key) {
        return fill($t(key), { n: key === 'duel.too_long' ? DUEL.maxStoryWords : DUEL.minStoryWords });
    }

    const rewriteStatus = $derived(round?.rewrite.status ?? 'pending');

    /** Call one of the duel's endpoints. @param {string} path @param {unknown} [body] */
    const call = (path, body) => post(`/api/duel/${path}`, body);

    async function prepare() {
        busy = 'prepare';
        notice = '';
        const { ok, payload } = await call('prepare', {});
        busy = '';
        if (ok && payload?.prompt?.text && payload?.draftReady) {
            prompt = payload.prompt.text;
            stage = 'write';
        } else {
            notice = 'duel.prepare_failed';
        }
    }

    async function lock() {
        busy = 'lock';
        notice = '';
        const { ok, payload } = await call('lock', { story: piece.counted, ropes: chosen });
        busy = '';
        if (ok && payload?.draft) {
            round = /** @type {RoundView} */ (payload);
            stage = 'locked';
            try {
                localStorage.removeItem(PIECE_KEY);
            } catch {
                // nothing was kept
            }
            rewrite();
            loadBoard();
        } else {
            notice = ERROR_KEYS[payload?.error] ?? 'duel.error';
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
        notice = '';
        const { ok, payload } = await call('rewrite', {});
        if (ok && payload?.draft) {
            round = /** @type {RoundView} */ (payload);
            pass = round.rewrite.attempts;
            const status = round.rewrite.status;
            if (status === 'clean' || status === 'escaped') {
                busy = '';
                return;
            }
            if (tries < 30) {
                pollTimer = window.setTimeout(() => rewrite(tries + 1), 1500);
                return;
            }
        }
        // A request that failed or never finished is the card's to explain:
        // it says the rewrite did not come through, and offers to ask again.
        busy = '';
        pass = 0;
    }

    async function loadBoard() {
        const { ok, payload } = await call('board');
        if (ok) board = payload.board ?? [];
    }

    async function share() {
        if (!round) return;
        const marks = round.ropes.map((rope) => (rope.hit ? '🟢' : '🔴')).join('');
        const text = [
            `${$t('duel.title')} · ${round.date}`,
            marks,
            `🟢 ${round.hits}  🔴 ${round.misses}  ⛔ ${round.muzzlePct}%`,
            `${location.origin}${HERE}`
        ].join('\n');
        try {
            await navigator.clipboard.writeText(text);
            notice = 'duel.copied';
        } catch {
            notice = 'duel.copy_failed';
        }
    }

    onMount(() => {
        if (stage === 'preparing') prepare();
        // Back to a duel whose rewrite is still being asked for elsewhere.
        else if (stage === 'locked' && rewriteStatus !== 'clean' && rewriteStatus !== 'escaped') rewrite();
        return () => window.clearTimeout(pollTimer);
    });
</script>

<svelte:head>
    <title>{$t('duel.title')} — oulipo.party</title>
</svelte:head>

<div class="game-page">
    <header class="head">
        <GameIcon icon="duel" size={96} />
        <div>
            <h1>{$t('duel.title')}</h1>
            <p class="tagline">{$t('duel.tagline')}</p>
        </div>
    </header>

    <!-- While writing, a message is shown beside what it is about: under the
         box for a file, under the button for a refusal. -->
    {#if stage !== 'write'}
        <p class="notice" class:news={noticeIsNews} aria-live="polite">{notice ? noticeText(notice) : ''}</p>
    {/if}

    {#if stage === 'unavailable'}
        <section class="glass-surface card center"><p>{$t('duel.unavailable')}</p></section>
    {:else if stage === 'signin'}
        <section class="glass-surface card">
            <ol class="steps">
                <li><span class="step s1">1</span><p>{$t('duel.rule_1')}</p></li>
                <li><span class="step s2">2</span><p>{$t('duel.rule_2')}</p></li>
                <li><span class="step s3">3</span><p>{$t('duel.rule_3')}</p></li>
            </ol>
            <p class="note">{$t('duel.note')}</p>
        </section>
        <section class="glass-surface card center invite">
            <p class="lead">{$t('duel.signin')}</p>
            <div class="row">
                <a class="btn-primary big" href={LOGIN}>{$t('nav.signin')}</a>
                <a class="btn-secondary big" href={SIGNUP}>{$t('nav.signup')}</a>
            </div>
        </section>
    {:else if stage === 'preparing'}
        <section class="glass-surface card center">
            {#if busy === 'prepare'}
                <p class="waiting"><span class="dot" aria-hidden="true"></span>{$t('duel.preparing')}</p>
            {:else}
                <button class="btn-primary" type="button" onclick={prepare}>{$t('duel.retry')}</button>
            {/if}
        </section>
    {:else if stage === 'write'}
        <section class="glass-surface card">
            <h2><GameIcon icon="prompt" />{$t('duel.prompt_label')}</h2>
            <p class="prompt">{prompt}</p>
            <details class="howto" open>
                <summary>{$t('duel.how_title')}</summary>
                <ol class="steps">
                    <li><span class="step s1">1</span><p>{$t('duel.rule_1')}</p></li>
                    <li><span class="step s2">2</span><p>{$t('duel.rule_2')}</p></li>
                    <li><span class="step s3">3</span><p>{$t('duel.rule_3')}</p></li>
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
                            {$t('duel.lock_hint')}
                        {/if}
                    </span>
                </div>
                {#if notice}
                    <p class="notice" aria-live="assertive">{noticeText(notice)}</p>
                {/if}
            </WordPicker>
        {/if}
    {:else if stage === 'locked' && round}
        <section class="glass-surface card">
            <p class="locked"><GameIcon icon="score" size={36} />{$t('duel.locked_notice')}</p>
            <dl class="tiles">
                <div class="tile score">
                    <dt>{$t('duel.score')}</dt>
                    <dd>{round.score > 0 ? '+' : ''}{round.score}</dd>
                </div>
                <div class="tile hit">
                    <dt>{$t('duel.hits')}</dt>
                    <dd class="hit">{round.hits}</dd>
                </div>
                <div class="tile miss">
                    <dt>{$t('duel.misses')}</dt>
                    <dd class="miss">{round.misses}</dd>
                </div>
                <div class="tile muzzle">
                    <dt>{$t('duel.muzzle')}</dt>
                    <dd>{round.muzzlePct}%</dd>
                </div>
            </dl>
            <p class="caption">
                {round.muzzlePct > 0 ? fill($t('duel.muzzle_line'), { pct: round.muzzlePct }) : $t('duel.muzzle_none')}
            </p>
            <p class="caption">{fill($t('duel.sent_line'), { tier: $t(`duel.tier.${round.tier}`) })}</p>
            <div class="row">
                <button class="btn-secondary small" type="button" onclick={share}>{$t('duel.share')}</button>
            </div>
            <h3><GameIcon icon="send" size={30} />{$t('duel.your_words')}</h3>
            <div class="chips">
                {#each round.ropes as rope (rope.key)}
                    <span class="chip static" class:hit={rope.hit} class:miss={!rope.hit}>{rope.forms[0]}</span>
                {/each}
            </div>
        </section>

        <section class="glass-surface card">
            <h2><GameIcon icon="sappho" />{$t('duel.she_wrote')}</h2>
            <p class="note">{$t('duel.she_wrote_note')}</p>
            <MarkedPiece text={round.draft.text} spans={round.draft.spans} />
        </section>

        <RewriteCard rewrite={round.rewrite} {pass} working={busy === 'rewrite'} onask={() => rewrite()} />
    {/if}

    {#if stage === 'locked' && round}
        <section class="glass-surface card">
            <h2><GameIcon icon="board" />{$t('duel.board_title')}</h2>
            {#if board.length === 0}
                <p class="note">{$t('duel.board_empty')}</p>
            {:else}
                <ol class="board">
                    {#each board as row, i (row.id)}
                        <li class:mine={row.mine}>
                            <span class="rank">{i + 1}</span>
                            <span class="name">
                                {row.name ?? '·'}
                                {#if row.mine}<small> · {$t('duel.you')}</small>{/if}
                            </span>
                            <span class="marks">
                                <i class="mark hit"></i>{row.hits}
                                <i class="mark miss"></i>{row.misses}
                            </span>
                            <span class="pts">{row.score > 0 ? '+' : ''}{row.score}</span>
                        </li>
                    {/each}
                </ol>
            {/if}
        </section>
    {/if}
</div>
