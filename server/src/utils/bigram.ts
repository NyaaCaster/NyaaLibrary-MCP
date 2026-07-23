/**
 * CJK bigram tokenizer for FTS indexing.
 *
 * Splits text into space-separated tokens:
 * - Consecutive CJK characters → sliding-window bigrams (with isolated single
 *   characters kept as unigrams so nothing is dropped)
 * - Non-CJK runs (letters, digits, whitespace, punctuation, emoji etc.) →
 *   preserved as-is, one token per contiguous run
 *
 * The result is fed to an FTS5 table with tokenize='unicode61' so that the
 * tokenizer sees the pre-built bigram tokens and does NOT further split them.
 *
 * CJK code-point ranges (locked per SSOT D5):
 *   U+4E00–U+9FFF   CJK Unified Ideographs
 *   U+3400–U+4DBF   CJK Unified Ideographs Extension A
 *   U+3040–U+30FF   Hiragana + Katakana
 *   U+F900–U+FAFF   CJK Compatibility Ideographs
 */

const CJK_RANGES: ReadonlyArray<[number, number]> = [
  [0x4e00, 0x9fff],
  [0x3400, 0x4dbf],
  [0x3040, 0x30ff],
  [0xf900, 0xfaff],
];

function isCJK(cp: number): boolean {
  return CJK_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
}

export function bigram(text: string): string {
  if (!text) return "";

  const tokens: string[] = [];
  let i = 0;

  while (i < text.length) {
    const cp = text.codePointAt(i);
    if (cp === undefined) {
      i++;
      continue;
    }

    if (isCJK(cp)) {
      // Collect consecutive CJK characters (BMP only — code point fits in
      // one UTF-16 code unit after the check above).
      const cjkStart = i;
      const charLen = cp > 0xffff ? 2 : 1;
      i += charLen;

      while (i < text.length) {
        const nextCp = text.codePointAt(i);
        if (nextCp === undefined || !isCJK(nextCp)) break;
        i += nextCp > 0xffff ? 2 : 1;
      }

      const cjkSeq = text.slice(cjkStart, i);
      if (cjkSeq.length === 1) {
        tokens.push(cjkSeq); // isolated single CJK → unigram
      } else {
        for (let j = 0; j < cjkSeq.length - 1; j++) {
          tokens.push(cjkSeq[j] + cjkSeq[j + 1]);
        }
      }
    } else {
      // Non-CJK run — collect until next CJK character (BMP surrogate-aware
      // is fine because none of the CJK ranges cross the BMP boundary).
      const nonStart = i;
      i += cp > 0xffff ? 2 : 1;

      while (i < text.length) {
        const nextCp = text.codePointAt(i);
        if (nextCp === undefined || isCJK(nextCp)) break;
        i += nextCp > 0xffff ? 2 : 1;
      }

      tokens.push(text.slice(nonStart, i));
    }
  }

  return tokens.join(" ");
}
