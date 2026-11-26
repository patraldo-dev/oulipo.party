// Bringing a file in as a piece: node --test tests/import.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';

import { fitPiece, ImportError, readPieceFile, textFromDocx, textFromDocumentXml } from '../src/lib/import-text.js';
import { countWords } from '../src/lib/oulipo/engine.js';

const WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const encoder = new TextEncoder();

/** A Word file's archive, as Word itself writes it. @param {[string, string, 0 | 8][]} entries */
function archive(entries) {
    const parts = [];
    for (const [name, content, method] of entries) {
        const nameBytes = encoder.encode(name);
        const data = encoder.encode(content);
        const payload = method === 8 ? deflateRawSync(data) : data;
        const header = new Uint8Array(30);
        const view = new DataView(header.buffer);
        view.setUint32(0, 0x04034b50, true);
        view.setUint16(4, 20, true);
        view.setUint16(8, method, true);
        view.setUint32(18, payload.length, true);
        view.setUint16(26, nameBytes.length, true);
        parts.push(header, nameBytes, payload);
    }
    return new Uint8Array(parts.flatMap((part) => [...part]));
}

/** A Word document's XML, as Word writes a few paragraphs. @param {string[]} paragraphs */
const documentXml = (paragraphs) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
        .map(
            (text) =>
                `<w:p w:rsidR="00A1B2C3"><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${text}</w:p>`
        )
        .join('')}<w:sectPr/></w:body></w:document>`;

const run = (text) => `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

test('plain text is taken as it is, in the line ends of the web', async () => {
    const file = new File(['\uFEFFfirst\r\nsecond\rthird\u0000'], 'piece.TXT', { type: 'text/plain' });
    assert.equal(await readPieceFile(file), 'first\nsecond\nthird');
});

test('Markdown passes through untouched', async () => {
    const file = new File(['# A door\n\nShe **waited**.'], 'piece.md', { type: 'text/markdown' });
    assert.equal(await readPieceFile(file), '# A door\n\nShe **waited**.');
});

test('a file with no type is read as text when its name says so', async () => {
    const file = new File(['just words'], 'piece.markdown');
    assert.equal(await readPieceFile(file), 'just words');
});

test('a Word document gives one line per paragraph, with its tabs, breaks and symbols', () => {
    const xml = documentXml([
        run('The house was '),
        `${run('smaller')}`,
        `${run('than she remembered.')}<w:r><w:tab/></w:r><w:r><w:br/></w:r>${run('  and cold  ')}`,
        // Word carries a character as itself, or in its numeric form.
        run('Rilke wrote &quot;Du musst dein Leben &#228;ndern&quot;: 1 &lt; 2 &amp; 3 &gt; 2, café'),
        ''
    ]);
    assert.equal(
        textFromDocumentXml(xml),
        'The house was \nsmaller\nthan she remembered.\t\n  and cold  \nRilke wrote "Du musst dein Leben ändern": 1 < 2 & 3 > 2, café'
    );
});

test('a Word file is opened from its own archive, compressed as Word compresses it', async () => {
    const bytes = archive([
        ['[Content_Types].xml', '<Types/>', 8],
        ['_rels/.rels', '<Relationships/>', 0],
        ['word/document.xml', documentXml([run('One.'), run('Two.')]), 8],
        ['word/styles.xml', '<styles/>', 8]
    ]);
    assert.equal(textFromDocumentXml(await textFromDocx(bytes)), 'One.\nTwo.');
});

test('a Word file whose entries carry their length after the data is opened too', async () => {
    // Flag 3 set and no length in the header: the next entry shows where it ends.
    const parts = [];
    for (const [name, content] of [
        ['[Content_Types].xml', '<Types/>'],
        ['word/document.xml', documentXml([run('After the data.')])],
        ['word/styles.xml', '<styles/>']
    ]) {
        const nameBytes = encoder.encode(name);
        const header = new Uint8Array(30);
        const view = new DataView(header.buffer);
        view.setUint32(0, 0x04034b50, true);
        view.setUint16(8, 0, true);
        view.setUint16(6, 8, true);
        view.setUint16(26, nameBytes.length, true);
        parts.push(header, nameBytes, encoder.encode(content));
    }
    const end = new Uint8Array(4);
    new DataView(end.buffer).setUint32(0, 0x02014b50, true);
    parts.push(end);
    const bytes = new Uint8Array(parts.flatMap((part) => [...part]));
    assert.equal(textFromDocumentXml(await textFromDocx(bytes)), 'After the data.');
});

test('a Word file is read through the same door as any other', async () => {
    const bytes = archive([['word/document.xml', documentXml([run('From Word.')]), 8]]);
    const file = new File([bytes], 'piece.docx', { type: WORD });
    assert.equal(await readPieceFile(file), 'From Word.');
});

test('what cannot become a piece is refused, and says why', async () => {
    /** @param {File} file */
    const refused = (file) =>
        readPieceFile(file).then(
            () => 'read',
            (error) => `refused: ${error instanceof ImportError ? error.code : error}`
        );
    assert.equal(await refused(new File([new Uint8Array(200)], 'piece.docx', { type: WORD })), 'refused: not_text', 'not a Word file');
    const noDocument = archive([['word/styles.xml', '<styles/>', 0]]);
    assert.equal(await refused(new File([noDocument], 'piece.docx', { type: WORD })), 'refused: not_text', 'a Word file without a document');
    assert.equal(await refused(new File(['x'], 'piece.doc', { type: 'application/msword' })), 'refused: not_text', 'the older format');
    assert.equal(await refused(new File(['x'], 'piece.png', { type: 'image/png' })), 'refused: not_text', 'a picture');
});

test('a file that fits is brought in whole', () => {
    const within = Array.from({ length: 300 }, (_, i) => `word${i + 1}`).join('\n');
    assert.deepEqual(fitPiece(within, 300, 4000), { text: within, cut: false });
});

test('a file longer than a piece is cut after the last word a piece holds', () => {
    const words = Array.from({ length: 340 }, (_, i) => `word${i + 1}`);
    const { text, cut } = fitPiece(words.join('\n'), 300, 4000);
    assert.equal(text, words.slice(0, 300).join('\n'), 'the first 300 words, whole');
    assert.equal(countWords(text), 300, 'which is what the duel will count');
    assert.equal(cut, true);
});

test('a piece is held to its characters too, and the word the limit falls inside is left out whole', () => {
    const text = 'alpha beta gamma delta epsilon';
    assert.deepEqual(fitPiece(text, 300, 22), { text: 'alpha beta gamma delta', cut: true }, 'the limit is 22; "alpha beta gamma delta" is 22');
    assert.deepEqual(fitPiece(text, 300, 20), { text: 'alpha beta gamma', cut: true }, 'the limit falls inside "delta"');
    assert.deepEqual(fitPiece(text, 300, 34), { text, cut: false });
});

test('blank lines at the end of a file are not words left out', () => {
    // 300 words in 3892 characters, then enough empty lines to pass 4000.
    const text = `${'abcdefghijkl '.repeat(299)}gamma`;
    assert.equal(countWords(text), 300);
    assert.ok(text.length <= 4000);
    const padded = `${text}${'\n'.repeat(120)}`;
    assert.ok(padded.length > 4000);
    assert.deepEqual(fitPiece(padded, 300, 4000), { text, cut: false });
});

test('whatever a file holds, what is brought in is a beginning of it that fits', () => {
    let seed = 11;
    const next = (n) => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed % n;
    };
    for (let trial = 0; trial < 500; trial++) {
        const body = Array.from({ length: next(700) }, () => 'x'.repeat(1 + next(14))).join(next(4) ? ' ' : '\n');
        const text = next(3) ? body : `${body}${'\n'.repeat(next(30))}`;
        const maxWords = 1 + next(60);
        const maxChars = 20 + next(600);
        const { text: piece, cut } = fitPiece(text, maxWords, maxChars);
        const how = `trial ${trial}: ${countWords(text)} words, ${text.length} chars, limits ${maxWords} and ${maxChars}`;
        assert.ok(text.startsWith(piece), `${how}: not a beginning of the file`);
        assert.ok(piece.length <= maxChars, `${how}: ${piece.length} chars brought in`);
        assert.ok(countWords(piece) <= maxWords, `${how}: ${countWords(piece)} words brought in`);
        assert.equal(cut, piece.trimEnd().length !== text.trimEnd().length, `${how}: said ${cut}`);
        assert.ok(!cut || piece.trim() === '' || /\S$/.test(piece), `${how}: ends inside a word`);
        assert.ok(!cut || text.startsWith(piece) && piece.length < text.trimEnd().length, `${how}: said cut, yet whole`);
    }
});
