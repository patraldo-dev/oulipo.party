<!-- src/routes/+page.svelte
     The landing page: today's games. Each is one tile with its colour, what
     it is, and, for a member, what they have already done of it today. -->
<script>
    import { fill, t } from '#lib/i18n/index.js';
    import GameIcon from '#lib/components/GameIcon.svelte';

    let { data } = $props();

    /** A score with its sign, the way the games show one. @param {number} score */
    const signed = (score) => (score > 0 ? `+${score}` : String(score));
</script>

<svelte:head>
    <title>{$t('hub.title')} — oulipo.party</title>
</svelte:head>

<div class="hub">
    <header class="head">
        <h1>{$t('hub.title')}</h1>
        <p class="tagline">{$t('site.description')}</p>
    </header>

    <div class="games">
        <a class="game glass-surface duel" href="/duel">
            <GameIcon icon="duel" size={72} />
            <h2>{$t('duel.title')}</h2>
            <p class="what">{$t('hub.duel_tag')}</p>
            <p class="how">{$t('hub.duel_line')}</p>
            <p class="status" class:done={Boolean(data.duel)}>
                {#if !data.signedIn}
                    {$t('hub.signin_hint')}
                {:else if data.duel}
                    {fill($t('hub.duel_played'), { score: signed(data.duel.score) })}
                {:else}
                    {$t('hub.duel_open')}
                {/if}
            </p>
            <span class="go">{$t('hub.duel_button')} <span aria-hidden="true">→</span></span>
        </a>

        <a class="game glass-surface siege" href="/siege">
            <GameIcon icon="siege" size={72} />
            <h2>{$t('hub.siege_title')}</h2>
            <p class="what">{$t('hub.siege_tag')}</p>
            <p class="how">{$t('hub.siege_line')}</p>
            <p class="status">
                {#if !data.signedIn}
                    {$t('hub.signin_hint')}
                {:else if data.siege}
                    {fill($t('hub.siege_open'), { n: data.siege.open })}
                    {#if data.siege.waiting}&nbsp;· {fill($t('hub.siege_waiting'), { n: data.siege.waiting })}{/if}
                {:else}
                    {$t('hub.siege_none')}
                {/if}
            </p>
            <span class="go">{$t('hub.siege_button')} <span aria-hidden="true">→</span></span>
        </a>
    </div>
</div>

<style>
    .hub {
        max-width: 760px;
        margin: 0 auto;
        padding: 2.25rem 1.25rem 3rem;
    }
    .head {
        margin-bottom: 1.75rem;
    }
    h1 {
        font-family: var(--font-display);
        font-size: clamp(2.6rem, 8vw, 3.75rem);
        line-height: 0.95;
        font-weight: 900;
        letter-spacing: -0.035em;
        color: var(--text);
        margin: 0 0 0.6rem;
    }
    .tagline {
        color: var(--text-dim);
        font-size: 1.05rem;
        font-weight: 500;
        line-height: 1.45;
        margin: 0;
        max-width: 36ch;
    }

    /* One tile per game, in that game's colour. */
    .games {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1.1rem;
    }
    .game {
        --tint: var(--duel);
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        padding: 1.6rem 1.6rem 1.4rem;
        color: inherit;
        text-decoration: none;
        transition:
            transform 0.15s,
            box-shadow 0.15s,
            border-color 0.15s;
    }
    .game.siege {
        --tint: var(--siege);
    }
    .game:hover,
    .game:focus-visible {
        transform: translateY(-2px);
        border-color: var(--tint);
        box-shadow: 0 10px 28px rgba(18, 18, 18, 0.09);
    }
    .game:focus-visible {
        outline: 3px solid var(--accent);
        outline-offset: 3px;
    }
    h2 {
        font-family: var(--font-heading);
        font-weight: 800;
        font-size: 1.6rem;
        letter-spacing: -0.02em;
        color: var(--text);
        margin: 1.1rem 0 0.35rem;
    }
    .what {
        font-weight: 700;
        line-height: 1.4;
        color: var(--text);
        margin: 0;
    }
    .how {
        color: var(--text-dim);
        font-size: 0.95rem;
        line-height: 1.5;
        margin: 0.15rem 0 0;
    }
    .status {
        color: var(--tint);
        font-size: 0.88rem;
        font-weight: 700;
        line-height: 1.4;
        margin: 1rem 0 0;
    }
    /* What is already done, or waiting, has a mark before it. */
    .status.done::before {
        content: '✓ ';
    }
    .go {
        margin-top: auto;
        padding-top: 1.1rem;
        color: var(--tint);
        font-weight: 800;
    }

    @media (max-width: 620px) {
        .games {
            grid-template-columns: 1fr;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .game {
            transition: none;
        }
        .game:hover,
        .game:focus-visible {
            transform: none;
        }
    }
</style>
