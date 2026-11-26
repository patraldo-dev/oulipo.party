<!-- src/lib/components/RewriteCard.svelte
     Her rewrite of her own piece, without the words sent against her. It
     arrives one pass per request, so the card waits, says which pass is under
     way, and at the end shows what she wrote. What slipped through is marked,
     never cleaned up and hidden. -->
<script>
    import { fill, t } from '#lib/i18n/index.js';
    import GameIcon from '#lib/components/GameIcon.svelte';
    import MarkedPiece from '#lib/components/MarkedPiece.svelte';
    import { DUEL } from '#lib/oulipo/duel-rules.js';

    /**
     * @type {{
     *   rewrite: import('#lib/oulipo/types.js').RewriteView,
     *   pass: number,
     *   working: boolean,
     *   onask: () => void
     * }}
     */
    let { rewrite, pass, working, onask } = $props();

    const settled = $derived(rewrite.status === 'clean' || rewrite.status === 'escaped');
</script>

<section class="glass-surface card">
    {#if settled}
        <h2><GameIcon icon="sappho" />{$t('duel.rewrite_title')}</h2>
        {#if rewrite.status === 'clean'}
            <p class="note">{$t('duel.clean')}</p>
        {:else}
            <p class="note">{$t('duel.escaped')}</p>
            <div class="chips tight">
                {#each rewrite.violations as word (word)}<span class="chip static miss">{word}</span>{/each}
            </div>
        {/if}
        {#if rewrite.attempts > 1}
            <p class="note muted">{fill($t('duel.attempts'), { n: rewrite.attempts })}</p>
        {/if}
        <MarkedPiece text={rewrite.text} spans={rewrite.spans} kind="miss" />
    {:else if working}
        <p class="waiting">
            <span class="dot" aria-hidden="true"></span>
            {pass > 0 ? fill($t('duel.rewrite_pass'), { n: pass, total: DUEL.rewriteAttempts }) : $t('duel.rewriting')}
        </p>
    {:else}
        <p>{$t('duel.rewrite_failed')}</p>
        <button class="btn-primary" type="button" onclick={onask}>{$t('duel.ask_rewrite')}</button>
    {/if}
</section>
