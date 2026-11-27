<!-- src/lib/components/SiegeResult.svelte
     A resolved siege as one player sees it: how they did, with every word
     tagged; the room's table; her piece with everyone's hits marked; and her
     rewrite. The room shows it when the round resolves, and an earlier day
     is read back through it. -->
<script>
    import { fill, t } from '#lib/i18n/index.js';
    import GameIcon from '#lib/components/GameIcon.svelte';
    import MarkedPiece from '#lib/components/MarkedPiece.svelte';
    import RewriteCard from '#lib/components/RewriteCard.svelte';
    import { SIEGE } from '#lib/oulipo/siege-rules.js';

    /**
     * `late`: the player never locked in this round, so there is nothing of
     * theirs to show. `pass` and `working` say where her rewrite stands.
     * @type {{
     *   result: NonNullable<import('#lib/oulipo/types.js').SiegeView['result']>,
     *   pass: number,
     *   working: boolean,
     *   onask: () => void
     * }}
     */
    let { result, pass, working, onask } = $props();

    const mine = $derived(result.mine);
    /** The player's own place in the table. */
    const place = $derived(result.table.find((row) => row.mine)?.rank ?? 0);
    /** What each tag is called. @type {Record<import('#lib/oulipo/types.js').WordTag, string>} */
    const TAG = { plain: '', original: 'siege.tag.original', unanimous: 'siege.tag.unanimous', prompt: 'siege.tag.prompt' };

    /** A number with its sign, the way the games show one. @param {number} n */
    const signed = (n) => (n > 0 ? `+${n}` : String(n));
</script>

<section class="glass-surface card">
    <p class="locked"><GameIcon icon="siege" size={36} />{fill($t('siege.resolved'), { union: result.unionSize })}</p>

    {#if mine}
        <dl class="tiles">
            <div class="tile score">
                <dt>{$t('duel.score')}</dt>
                <dd>{signed(mine.score)}</dd>
            </div>
            <div class="tile hit">
                <dt>{$t('duel.hits')}</dt>
                <dd class="hit">{mine.hits}</dd>
            </div>
            <div class="tile miss">
                <dt>{$t('duel.misses')}</dt>
                <dd class="miss">{mine.misses}</dd>
            </div>
            <div class="tile bonus">
                <dt>{$t('siege.bonus')}</dt>
                <dd>{mine.bonus > 0 ? '+' : ''}{mine.bonus}</dd>
            </div>
        </dl>
        {#if mine.original > 0}
            <p class="caption">{fill($t('siege.original_line'), { n: mine.original, points: mine.original * SIEGE.originalBonus })}</p>
        {/if}
        {#if mine.unanimous > 0}
            <p class="caption">
                {fill($t('siege.unanimous_line'), { n: mine.unanimous, points: mine.unanimous * result.players * SIEGE.unanimousEach })}
            </p>
        {/if}
        {#if mine.bonus === 0}
            <p class="caption">{$t('siege.bonus_none')}</p>
        {/if}
        <p class="caption">{fill($t('siege.your_place'), { rank: place, total: result.players })}</p>

        <h3><GameIcon icon="send" size={30} />{$t('duel.your_words')}</h3>
        <div class="chips">
            {#each mine.ropes as rope (rope.key)}
                <span class="chip static" class:hit={rope.hit} class:miss={!rope.hit}>
                    {rope.forms[0]}{#if rope.hit && TAG[rope.tag]}<small> · {$t(TAG[rope.tag])}</small>{/if}
                </span>
            {/each}
        </div>
    {:else}
        <p class="caption">{$t('siege.did_not_lock')}</p>
    {/if}
</section>

<section class="glass-surface card">
    <h2><GameIcon icon="board" />{$t('siege.table_title')}</h2>
    <ol class="board">
        {#each result.table as row (row.userId)}
            <li class:mine={row.mine} data-rank={row.rank}>
                <span class="rank">{row.rank}</span>
                <span class="name">
                    {row.name}
                    {#if row.mine}<small> · {$t('duel.you')}</small>{/if}
                </span>
                <span class="marks">
                    <i class="mark hit"></i>{row.hits}
                    <i class="mark miss"></i>{row.misses}
                    {#if row.bonus > 0}<i class="mark bonus"></i>+{row.bonus}{/if}
                </span>
                <span class="pts">{signed(row.score)}</span>
            </li>
        {/each}
    </ol>
    <p class="caption">
        {result.muzzlePct > 0 ? fill($t('siege.muzzle_line'), { pct: result.muzzlePct }) : $t('siege.muzzle_none')}
    </p>
</section>

<section class="glass-surface card">
    <h2><GameIcon icon="sappho" />{$t('duel.she_wrote')}</h2>
    <p class="note">{$t('siege.she_wrote_note')}</p>
    <MarkedPiece text={result.draft.text} spans={result.draft.spans} />
</section>

<RewriteCard rewrite={result.rewrite} {pass} {working} {onask} />

<p class="caption">{$t('siege.same_code')}</p>
