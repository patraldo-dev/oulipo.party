<!-- src/lib/components/MarkedPiece.svelte
     A piece of writing with the server's marks shown as highlights: the
     words she used that were sent against her (a hit), or the words that
     slipped past her rewrite (a miss). -->
<script>
    import { segments } from '#lib/marks.js';

    /**
     * @type {{
     *   text: string,
     *   spans: import('#lib/oulipo/types.js').Span[],
     *   kind?: 'hit' | 'miss'
     * }}
     */
    let { text, spans, kind = 'hit' } = $props();
</script>

<p class="piece">
    {#each segments(text, spans) as part, i (i)}{#if part.hit}<mark class={kind}>{part.text}</mark>{:else}{part.text}{/if}{/each}
</p>
