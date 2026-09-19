/**
 * Conservative literal subset of textlint-rule-ja-no-abusage.
 * Context-sensitive, stylistic and regular-expression rules stay disabled.
 */
export const reviewedJapaneseRules: Record<string, string> = {
  "例外を補足": "例外を捕捉",
  "転稼": "転嫁",
  "こんにちわ": "こんにちは",
  "論戦を張る": "論陣を張る",
  "うる覚え": "うろ覚え",
  "口先三寸": "舌先三寸",
  "舌の先の乾かぬ": "舌の根の乾かぬ",
  "絶対絶命": "絶体絶命",
  "有頂点": "有頂天",
  "一発即発": "一触即発",
  "青色吐息": "青息吐息",
  "胸先三寸": "胸三寸",
  "後ろ立て": "後ろ盾",
  "無理なからぬ": "無理からぬ",
  "一同に会する": "一堂に会する"
};

export const japaneseRulesVersion = "1e523f8b1dc2f600bc8aed2fe3e8bcf26345dd05";
export const japaneseRulesUrl = `https://raw.githubusercontent.com/textlint-ja/textlint-rule-ja-no-abusage/${japaneseRulesVersion}/dict/prh.yml`;
export const japaneseRulesLicenseUrl = `https://raw.githubusercontent.com/textlint-ja/textlint-rule-ja-no-abusage/${japaneseRulesVersion}/LICENSE`;

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

/** Accepts the pinned upstream YAML or TeXWeave's filtered tab-separated cache. */
export function parseJapaneseRules(text: string): Record<string, string> {
  const rules: Record<string, string> = {};
  let expected = "";
  for (const line of text.split(/\r?\n/)) {
    const cached = line.match(/^([^\t]+)\t([^\t]+)$/);
    if (cached?.[1] && cached[2] && reviewedJapaneseRules[cached[1]] === cached[2]) rules[cached[1]] = cached[2];
    const expectedMatch = line.match(/^\s*-\s+expected:\s*(.+?)\s*$/);
    if (expectedMatch?.[1]) { expected = unquote(expectedMatch[1]); continue; }
    const patternMatch = line.match(/^\s+patterns?:\s*(?!\/)(.+?)\s*$/);
    if (patternMatch?.[1]) {
      const wrong = unquote(patternMatch[1]);
      if (reviewedJapaneseRules[wrong] === expected) rules[wrong] = expected;
    }
  }
  if (Object.keys(rules).length !== Object.keys(reviewedJapaneseRules).length) throw new Error("Japanese rules package validation failed");
  return rules;
}

export function checkJapaneseText(text: string, rules: Record<string, string>, personal: Set<string>) {
  const protectedRanges: Array<[number, number]> = [];
  for (const word of personal) {
    if (!word) continue;
    for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1)) protectedRanges.push([at, at + word.length]);
  }
  const errors: Array<{ word: string; start: number; end: number; suggestions: string[] }> = [];
  for (const [word, replacement] of Object.entries(rules)) {
    for (let start = text.indexOf(word); start >= 0; start = text.indexOf(word, start + 1)) {
      const end = start + word.length;
      if (!protectedRanges.some(([a, b]) => start >= a && end <= b)) errors.push({ word, start, end, suggestions: [replacement] });
    }
  }
  return errors.sort((a, b) => a.start - b.start || b.end - a.end).filter((item, index, all) => !all.slice(0, index).some((previous) => previous.end > item.start));
}
