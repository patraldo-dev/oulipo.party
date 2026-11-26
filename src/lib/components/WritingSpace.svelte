<!-- src/lib/components/WritingSpace.svelte
     The box a piece is written in. Kept in the browser as it is written, so a
     closed tab or a lost connection never costs a piece; filled from a file
     by button, picker or drop; growing with its text. The Duel and the Siege
     both use it. What a game takes from the piece is the page's to decide
     (src/lib/piece.js); the box only holds it. -->
<script>
    import { tick } from 'svelte';
    import { fill, t } from '#lib/i18n/index.js';
    import GameIcon from '#lib/components/GameIcon.svelte';
    import { countWords } from '#lib/oulipo/engine.js';
    import { DUEL } from '#lib/oulipo/duel-rules.js';
    import { IMPORT_TYPES, readPieceFile } from '#lib/import-text.js';
    import { countLine, fitForBox } from '#lib/piece.js';

    /**
     * `saveKey` is where the piece is kept in this browser; without one it is
     * not kept. `working` is true while a file is being read. `disabled` is
     * the page's own reason for holding still. `oninput` is told whenever the
     * member types, so that a message about an earlier piece can go.
     * @type {{
     *   saveKey?: string | null,
     *   story?: string,
     *   working?: boolean,
     *   disabled?: boolean,
     *   oninput?: () => void
     * }}
     */
    let { saveKey = null, story = $bindable(''), working = $bindable(false), disabled = false, oninput = () => {} } = $props();

    /** The box, and the picker that brings a file in. */
    let pieceBox = $state(/** @type {HTMLTextAreaElement | null} */ (null));
    let fileInput = $state(/** @type {HTMLInputElement | null} */ (null));
    /** True once the browser has taken the page over and filled the box. */
    let live = $state(false);
    let dragging = $state(false);
    /** How many words the last file brought in, and what was said of it. */
    let importedWords = $state(0);
    let fileNotice = $state('');
    /** Messages that are news, not a refusal: said in ink rather than in red. */
    const NEWS = new Set(['duel.imported', 'duel.import_cut']);
    /** What the line under the box says about the piece. */
    const line = $derived(countLine(story));

    // Kept as it is written. Nothing leaves the browser for it; the page
    // takes it away once the piece has been sent.
    $effect(() => {
        void story;
        if (!saveKey) return;
        try {
            if (story) localStorage.setItem(saveKey, story);
            else localStorage.removeItem(saveKey);
        } catch {
            // A browser that refuses storage keeps nothing; the rest works.
        }
    });

    // Until the browser has taken the page over the box stays read-only: the
    // server cannot know a kept piece, so the page arrives with the box empty,
    // and letters typed into that empty box would take the kept piece's place.
    $effect(() => {
        tick().then(() => {
            live = true;
        });
    });

    // The box grows with the piece, from its nine lines upward.
    $effect(() => {
        void story;
        tick().then(() => {
            if (pieceBox) {
                pieceBox.style.height = 'auto';
                pieceBox.style.height = `${pieceBox.scrollHeight}px`;
            }
        });
    });

    /**
     * Bring a file's words in as the piece. A piece already in the box gives
     * way only on the member's word, as it does for starting over.
     * @param {File} file
     */
    async function importFile(file) {
        working = true;
        fileNotice = '';
        try {
            const whole = await readPieceFile(file);
            // A file fills the box, up to what the box holds. What goes into
            // the game is decided from the box, never from the file.
            const { text, cut } = fitForBox(whole);
            importedWords = countWords(text);
            if (!importedWords) {
                fileNotice = 'duel.import_empty';
                return;
            }
            if (story && !window.confirm($t('duel.import_replace_confirm'))) return;
            story = text;
            fileNotice = cut ? 'duel.import_cut' : 'duel.imported';
        } catch (error) {
            console.error('[piece] import failed:', error instanceof Error ? error.message : error);
            fileNotice = 'duel.import_failed';
        } finally {
            working = false;
        }
    }

    /** @param {DragEvent} event */
    const carriesFiles = (event) => Boolean(event.dataTransfer?.types?.includes('Files'));

    /** @param {DragEvent} event */
    function dragOver(event) {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        dragging = true;
    }

    /** @param {DragEvent} event */
    function drop(event) {
        dragging = false;
        if (!carriesFiles(event)) return;
        event.preventDefault();
        const file = event.dataTransfer?.files?.[0];
        if (file) importFile(file);
    }

    /** @param {Event} event */
    function fileChosen(event) {
        const input = /** @type {HTMLInputElement} */ (event.currentTarget);
        const file = input.files?.[0];
        if (file) importFile(file);
        // So that picking the same file twice still brings it in.
        input.value = '';
    }

    function startOver() {
        if (window.confirm($t('duel.clear_story_confirm'))) {
            story = '';
            fileNotice = '';
        }
    }
</script>

<section class="glass-surface card">
    <h2><GameIcon icon="write" />{$t('duel.story_label')}</h2>
    <div
        class="box"
        class:dragging
        role="group"
        aria-label={$t('duel.story_label')}
        ondragover={dragOver}
        ondragleave={() => (dragging = false)}
        ondrop={drop}
    >
        <textarea
            bind:this={pieceBox}
            bind:value={story}
            oninput={() => oninput()}
            readonly={!live}
            maxlength={DUEL.maxStoryChars}
            rows="9"
            placeholder={$t('duel.placeholder')}
            disabled={disabled || working}
        ></textarea>
        {#if dragging}<p class="drop-note">{$t('duel.drop_here')}</p>{/if}
    </div>
    <div class="tools">
        <p class="count" class:off={line.off}>{fill($t(line.key), { n: line.n, total: line.total })}</p>
        <div class="tools-actions">
            {#if story && saveKey}<span class="kept">{$t('duel.autosave_hint')}</span>{/if}
            {#if story}
                <button class="btn-secondary small" type="button" onclick={startOver} disabled={disabled || working}>
                    {$t('duel.clear_story')}
                </button>
            {/if}
            <button class="btn-secondary small" type="button" onclick={() => fileInput?.click()} disabled={disabled || working}>
                {$t('duel.import')}
            </button>
        </div>
    </div>
    {#if fileNotice}
        <p class="notice" class:news={NEWS.has(fileNotice)} aria-live="polite">{fill($t(fileNotice), { n: importedWords })}</p>
    {/if}
    <p class="note">{$t('duel.import_hint')}</p>
    <input
        bind:this={fileInput}
        class="file"
        type="file"
        accept={IMPORT_TYPES}
        onchange={fileChosen}
        aria-hidden="true"
        tabindex="-1"
    />
</section>
