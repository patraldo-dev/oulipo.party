// src/lib/import-text.js
// Turn a file a member brings into the text of a piece: plain text, Markdown,
// and Word documents (.docx). Pure, and the same in the browser and in tests.
// A Word document is read from its own structure, the XML inside it, so no
// library is needed for it; the older .doc format is not a document of that
// kind and is refused.

import { countWords } from '#lib/oulipo/engine.js';

/** Thrown for a file that cannot become a piece. */
export class ImportError extends Error {
    /**
     * @param {string} code
     * @param {string} [detail]
     */
    constructor(code, detail) {
        super(detail ? `${code}: ${detail}` : code);
        this.name = 'ImportError';
        this.code = code;
    }
}

/** What the file picker offers. */
export const IMPORT_TYPES =
    '.txt,.md,.markdown,.docx,text/plain,text/markdown,text/x-markdown,' +
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const WORD_DOCUMENT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** @param {Uint8Array} bytes */
const decode = (bytes) => new TextDecoder().decode(bytes);

/** @param {Uint8Array} bytes */
const viewOf = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** A little-endian number at `at`. @param {DataView} view @param {number} at @param {boolean} [wide] */
const number = (view, at, wide = false) => (wide ? view.getUint32(at, true) : view.getUint16(at, true));

/**
 * Where the next entry of the archive begins, at or after `from`.
 * @param {Uint8Array} bytes @param {number} from
 */
const nextEntry = (bytes, from) => {
    const view = viewOf(bytes);
    for (let at = from; at + 4 <= bytes.length; at++) {
        // An entry's header, or the directory that ends the archive.
        if (number(view, at, true) === 0x04034b50 || number(view, at, true) === 0x02014b50) return at;
    }
    return bytes.length;
};

/** @param {Uint8Array} data */
async function inflate(data) {
    if (typeof DecompressionStream === 'undefined') {
        throw new ImportError('not_text', 'this browser cannot open a Word document');
    }
    // A copy of its own, so that the browser sees plain bytes.
    const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
}

/**
 * The text of a Word document, from the bytes of its .docx file.
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
export async function textFromDocx(bytes) {
    const view = viewOf(bytes);
    let at = 0;
    while (at + 30 <= bytes.length && number(view, at, true) === 0x04034b50) {
        const flags = number(view, at + 6);
        const method = number(view, at + 8);
        const size = number(view, at + 18, true);
        const nameLength = number(view, at + 26);
        const extraLength = number(view, at + 28);
        const name = decode(bytes.subarray(at + 30, at + 30 + nameLength));
        const start = at + 30 + nameLength + extraLength;
        // The length may be kept after the data (flag 3), or absent: then the
        // next entry shows where this one ends.
        const end = flags & 8 || size === 0 ? nextEntry(bytes, start) : start + size;
        if (name === 'word/document.xml') {
            const data = bytes.subarray(start, end);
            if (method === 0) return decode(data);
            if (method !== 8) throw new ImportError('not_text', `compressed as ${method}`);
            return await inflate(data);
        }
        at = end;
    }
    throw new ImportError('not_text', 'no Word document in the file');
}

/** The five entities Word writes, and the numeric ones. @param {string} text */
const entities = (text) =>
    text
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(parseInt(digits, 10)))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');

/**
 * The text held in a Word document's XML: one line per paragraph, with the
 * tabs and line breaks the writer put in.
 * @param {string} xml
 */
export function textFromDocumentXml(xml) {
    const paragraphs = xml.match(/<w:p(?=[\s>])[\s\S]*?<\/w:p>|<w:p\s*\/>/g) ?? [];
    return paragraphs
        .map((paragraph) => {
            /** @type {string} */
            let text = '';
            for (const match of paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g)) {
                if (match[1] !== undefined) text += entities(match[1]);
                else text += match[0].startsWith('<w:tab') ? '\t' : '\n';
            }
            return text;
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * The text of a file, to be the piece.
 * @param {File} file
 * @returns {Promise<string>} rejects with an ImportError when it cannot be read
 */
export async function readPieceFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.docx') || file.type === WORD_DOCUMENT) {
        return textFromDocumentXml(await textFromDocx(new Uint8Array(await file.arrayBuffer())));
    }
    if (name.endsWith('.doc') || file.type === 'application/msword') {
        throw new ImportError('not_text', 'a .doc file; save it as .docx');
    }
    if (file.type && !/^(text\/|application\/(json|xml|x-yaml|toml)$)/.test(file.type)) {
        throw new ImportError('not_text', file.type);
    }
    // Plain text and Markdown are taken as they are. Word pads some exports
    // with empty characters; Windows and old Mac write other line ends.
    const text = await file.text();
    return text.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
}

/**
 * As much of a text as one piece may hold: whole words up to `maxWords`, and
 * never past `maxChars`. A word is what the game counts as one, so what is
 * brought in is what the duel will accept.
 * @param {string} text
 * @param {number} maxWords
 * @param {number} maxChars
 * @returns {{ text: string, cut: boolean }}
 */
export function fitPiece(text, maxWords, maxChars) {
    if (text.length <= maxChars && countWords(text) <= maxWords) return { text, cut: false };
    // Where the last word that may come in ends. A word past either limit is
    // left out whole, so the piece never stops inside one.
    let end = 0;
    let count = 0;
    for (const word of text.matchAll(/\S+/g)) {
        if (count === maxWords || word.index + word[0].length > maxChars) break;
        end = word.index + word[0].length;
        count++;
    }
    const piece = text.slice(0, end);
    // Blank lines at the end of a file are not words left out.
    return { text: piece, cut: piece.trimEnd() !== text.trimEnd() };
}
