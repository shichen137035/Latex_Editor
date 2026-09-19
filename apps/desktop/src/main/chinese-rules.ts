/** Audited subset: upstream's full test corpus contains valid words and ambiguous replacements. */
export const reviewedRules: Record<string, string> = {
  "兴高彩列": "兴高采烈", "一落千仗": "一落千丈", "赛翁失马": "塞翁失马",
  "迫不急待": "迫不及待", "谈笑风声": "谈笑风生", "旁证博引": "旁征博引",
  "不径而走": "不胫而走", "通货膨涨": "通货膨胀", "发杨广大": "发扬光大",
  "好高务远": "好高骛远", "轰堂大笑": "哄堂大笑", "毛骨耸然": "毛骨悚然",
  "摸棱两可": "模棱两可", "如雷灌耳": "如雷贯耳", "水长船高": "水涨船高",
  "无精打彩": "无精打采", "兴高彩烈": "兴高采烈", "言不由中": "言不由衷",
  "一蹋糊涂": "一塌糊涂", "一榻糊涂": "一塌糊涂", "装聋做哑": "装聋作哑"
};
export const chineseRulesVersion = "fc8aa56c336276fbd8cdd3a49eef505dc67b8a6e";
export const chineseRulesUrl = `https://raw.githubusercontent.com/shibing624/pycorrector/${chineseRulesVersion}/tests/custom_confusion.txt`;

export function parseChineseRules(text: string): Record<string, string> {
  const rules: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const [wrong, replacement] = line.trim().split(/\s+/);
    if (wrong && replacement && reviewedRules[wrong] === replacement) rules[wrong] = replacement;
  }
  if (Object.keys(rules).length !== Object.keys(reviewedRules).length) throw new Error("Chinese rules package validation failed");
  return rules;
}

/** Rules are few and bounded (21 phrases). No segmentation/model or unknown-word guessing. */
export function checkChineseText(text: string, rules: Record<string, string>, personal: Set<string>) {
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
