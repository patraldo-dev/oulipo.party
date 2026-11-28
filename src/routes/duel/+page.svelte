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
    import { DUEL, SIDE_BET } from '#lib/oulipo/duel-rules.js';
    import { pieceView, promptKeySet, savedPiece } from '#lib/piece.js';
    import { suspiciousWords } from '#lib/spell.js';
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
                : !data.signedIn
                  ? 'signin'
                  : data.draftReady
                    ? 'write'
                    : data.round
                      ? 'locked'
                      : 'preparing'
        ),
        prompt: data.prompt?.text ?? '',
        round: /** @type {RoundView | null} */ (data.round ?? null),
        board: data.board ?? [],
        purse: typeof data.purse === 'number' ? data.purse : null,
        streak: typeof data.streak === 'number' ? data.streak : 0
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
        prompt_word: 'duel.prompt_free',
        already_locked: 'duel.already_locked',
        round_limit: 'duel.round_limit',
        purse_short: 'duel.purse_short',
        bet_limit: 'duel.bet_limit',
        stake_small: 'duel.bet_stake_small',
        word_unknown: 'duel.rope_bad',
        round_missing: 'duel.error',
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
    /** The purse — banked points — and the member's day streak. */
    let purse = $state(start.purse);
    let streak = $state(start.streak);
    /**
     * The pre-submit spelling gate: words the dictionary does not know, said
     * once, then forgotten the moment the piece changes. A second press of
     * the button sends anyway.
     */
    let spellWarned = $state('');
    /**
     * Side bets: staked on this round's hidden piece before the lock.
     */
    let myWagers = $state(/** @type {{ word: string, side: string, stake: number, status: string, payout: number }[]} */ ([]));
    let betWord = $state('');
    let betStake = $state(1);
    let betNotice = $state('');
    /** The select itself: its value is read when a stake is placed. */
    let betSelect = $state(/** @type {HTMLSelectElement | null} */ (null));

    /** What the game takes from the piece. Its words are the ones there are to send. */
    const piece = $derived(pieceView(story, lang));
    const candidates = $derived(piece.candidates);
    const storyFits = $derived(piece.storyFits);
    /**
     * The words the day's prompt gave her already. They cannot be sent —
     * the picker greys them out, and the server refuses them. Derived from
     * the prompt text with the same folding the game gives every word.
     */
    const hers = $derived(promptKeySet(prompt, lang));
    /** The words there are to stake on: the piece's own, never hers. */
    const stakeable = $derived(candidates.filter((type) => !hers.has(type.key)));
    /** Nothing is pressed while a request, or a file, is under way. */
    const held = $derived(busy !== '' || importing);

    // Editing the piece withdraws the spelling warning: the words it named
    // may no longer be the ones on the page.
    $effect(() => {
        void story;
        spellWarned = '';
    });

    // The stake starts on the piece's first sendable word, so the buttons are
    // live the moment the card appears.
    $effect(() => {
        if (!betWord && stakeable.length) betWord = stakeable[0].display;
    });

    /**
     * The select's own binding does not always show the standing choice when
     * its options arrive after the value; this keeps the two in step.
     * @param {HTMLSelectElement} el
     */
    const showBetWord = (el) => {
        const set = () => {
            if (betWord) el.value = betWord;
        };
        set();
        return { update: set };
    };

    /** The words of a message, with its numbers filled in. @param {string} key */
    function noticeText(key) {
        return fill($t(key), { n: key === 'duel.too_long' ? DUEL.maxStoryWords : DUEL.minStoryWords });
    }

    /**
     * What one hit paid, said shortly: the wager divides the pot by the
     * count, which rarely lands on a short decimal — the page says ×0.42,
     * not the whole tail.
     * @param {number} pays
     */
    function saidPays(pays) {
        return String(Math.round(pays * 100) / 100);
    }

    /** The craft grade, as the result says it: ✦ plain to ✦✦✦✦ remarkable. */
    const craftStars = $derived(round?.craft === null || round?.craft === undefined ? '' : '✦'.repeat(round.craft + 1));

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
            chosen = [];
            stage = 'write';
        } else {
            notice = ERROR_KEYS[payload?.error] ?? 'duel.prepare_failed';
        }
    }

    /** The result panel hands the pen back: another round, the piece kept. */
    async function playAgain() {
        chosen = [];
        await prepare();
        if (stage === 'write') window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async function lock() {
        // The spelling gate: a word the dictionary does not know is said once
        // and a second press sends anyway. A dictionary that cannot be had
        // says nothing and stands in nobody's way.
        if (!spellWarned) {
            const bad = await suspiciousWords(piece.counted, lang);
            if (bad.length) {
                // Say how many there are, name at most eight, and keep the piece's own
                // capitalization — the names are the writer's.
                const shown = bad.slice(0, 8);
                spellWarned = bad.length + '|' + shown.join(', ') + (bad.length > shown.length ? ` … +${bad.length - shown.length}` : '');
                notice = '';
                return;
            }
        }
        spellWarned = '';
        busy = 'lock';
        notice = '';
        const { ok, payload } = await call('lock', { story: piece.counted, ropes: chosen });
        busy = '';
        if (ok && payload?.draft) {
            round = /** @type {RoundView} */ (payload);
            stage = 'locked';
            // The piece stays kept: another round is one edit away.
            myWagers = round.wagers.filter((wager) => wager.status !== 'open');
            if (typeof round.purse === 'number') purse = round.purse;
            streak = streak > 0 ? streak : 1;
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
        const { ok, payload } = await call('rewrite', { roundId: round?.id ?? null });
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

    /**
     * Stake purse points on this round's hidden piece: that she uses a word,
     * or that she never does. Charged now; the lock settles it.
     * @param {'uses' | 'absent'} side
     */
    async function placeBet(side) {
        const word = betSelect?.value || betWord;
        if (!word || !Number.isFinite(betStake)) return;
        betNotice = '';
        const { ok, payload } = await call('wager', { word, side, stake: betStake, story: piece.counted });
        if (ok && payload && typeof payload.purse === 'number') {
            purse = payload.purse;
            myWagers = (payload.wagers ?? []).map(
                (/** @type {{ word_form: string, side: string, stake: number, status: string, payout: number }} */ wager) => ({
                    word: wager.word_form,
                    side: wager.side,
                    stake: Number(wager.stake),
                    status: wager.status,
                    payout: Number(wager.payout)
                })
            );
            betStake = 1;
        } else {
            betNotice = ERROR_KEYS[payload?.error] ?? 'duel.error';
        }
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
            <WordPicker {lang} {candidates} neutral={hers} bind:chosen disabled={held}>
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
                {#if spellWarned}
                    <p class="notice spell" aria-live="assertive">
                        {fill($t('duel.spell_words'), { n: spellWarned.split('|')[0], words: spellWarned.split('|')[1] || '' })}
                        {$t('duel.spell_anyway')}
                    </p>
                {/if}
                {#if notice}
                    <p class="notice" aria-live="assertive">{noticeText(notice)}</p>
                {/if}
            </WordPicker>
        {/if}

        {#if stakeable.length}
            <section class="glass-surface card side-bets">
                <h2><GameIcon icon="coin" />{$t('duel.bet_title')}</h2>
                <p class="note">{$t('duel.bet_body')}</p>
                <p class="purse-line">{fill($t('duel.purse'), { n: purse ?? 0 })}</p>
                <div class="row wrap">
                    <label class="bet-field">
                        <span class="note">{$t('duel.bet_word')}</span>
                        {#if betWord}
                            <select bind:this={betSelect} use:showBetWord disabled={held}>
                                {#each stakeable as type (type.key)}
                                    <option value={type.display}>{type.display}</option>
                                {/each}
                            </select>
                        {/if}
                    </label>
                    <label class="bet-field small">
                        <span class="note">{$t('duel.bet_stake')}</span>
                        <input type="number" min="1" step="1" bind:value={betStake} disabled={held} />
                    </label>
                    <button class="btn-secondary" type="button" onclick={() => placeBet('uses')} disabled={held || !betWord}>
                        {fill($t('duel.bet_uses'), { n: SIDE_BET.usesPays })}
                    </button>
                    <button class="btn-secondary" type="button" onclick={() => placeBet('absent')} disabled={held || !betWord}>
                        {fill($t('duel.bet_absent'), { n: SIDE_BET.absentPays })}
                    </button>
                </div>
                {#if myWagers.length}
                    <ul class="bet-list">
                        {#each myWagers as wager (wager.word + wager.side)}
                            <li>
                                {fill($t(wager.side === 'uses' ? 'duel.bet_on_uses' : 'duel.bet_on_absent'), { word: wager.word, n: wager.stake })}
                            </li>
                        {/each}
                    </ul>
                {/if}
                {#if betNotice}
                    <p class="notice" aria-live="assertive">{noticeText(betNotice)}</p>
                {/if}
            </section>
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
                    <dt>{$t('duel.sent_tile')}</dt>
                    <dd class="miss">{round.ropeCount}</dd>
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
            <p class="caption">
                {fill($t('duel.sent_contract'), {
                    n: round.ropeCount,
                    name: $t(`duel.contract.${round.contractName}`),
                    pays: saidPays(round.pays),
                    score: round.score
                })}
            </p>
            {#if round.purse !== null}
                <p class="caption purse-line">{fill($t('duel.purse'), { n: round.purse })}</p>
            {/if}
            {#if round.craft !== null}
                <p class="caption craft">{fill($t('duel.craft_line'), { stars: '✦'.repeat(round.craft + 1), name: $t(`duel.craft.${round.craft}`) })}</p>
            {/if}
            {#if round.jailbreak !== null && round.jailbreak > 0}
                <p class="caption jailbreak">{fill($t('duel.jailbreak'), { n: round.jailbreak, m: Math.round(round.jailbreak / 2) })}</p>
            {/if}
            {#each round.wagers as wager (wager.word + wager.side)}
                {#if wager.status === 'won'}
                    <p class="caption bet won">{fill($t('duel.bet_won'), { word: wager.word, n: wager.payout })}</p>
                {:else if wager.status === 'lost'}
                    <p class="caption bet lost">{fill($t('duel.bet_lost'), { word: wager.word, n: wager.stake })}</p>
                {:else if wager.status === 'void'}
                    <p class="caption bet">{fill($t('duel.bet_void'), { word: wager.word, n: wager.stake })}</p>
                {/if}
            {/each}
            {#if streak > 0}
                <p class="caption">{fill($t(streak === 1 ? 'duel.streak_one' : 'duel.streak'), { n: streak })}</p>
            {/if}
            <div class="row">
                <button class="btn-secondary small" type="button" onclick={share}>{$t('duel.share')}</button>
                <button class="btn-primary small" type="button" onclick={playAgain} disabled={held}>{$t('duel.play_again')}</button>
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
                            </span>
                            <span class="pts">{row.score > 0 ? '+' : ''}{row.score}</span>
                        </li>
                    {/each}
                </ol>
            {/if}
        </section>
    {/if}
</div>
