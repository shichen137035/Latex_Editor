export interface DetectedLanguage {
  language: string | null;
  confidence: number;
}

const markers: Array<[string, RegExp]> = [
  ["de-DE", /\b(?:der|die|das|und|nicht|ist|eine|mit)\b/gi],
  ["fr-FR", /\b(?:le|la|les|des|une|est|avec|pour|dans)\b/gi],
  ["es-ES", /\b(?:el|los|las|una|que|con|para|del|está)\b/gi],
  ["en-US", /\b(?:the|and|this|that|with|from|for|are|is|of)\b/gi]
];

/** Conservative detector: script evidence is strong; short/ambiguous Latin text falls back to English. */
export function detectLanguage(sample: string): DetectedLanguage {
  const text = sample.trim();
  if ((text.match(/[\u3040-\u30ff]/g)?.length ?? 0) >= 2) return { language: "ja-JP", confidence: 0.98 };
  if ((text.match(/[\uac00-\ud7af]/g)?.length ?? 0) >= 2) return { language: "ko-KR", confidence: 0.98 };
  if ((text.match(/[\u0400-\u04ff]/g)?.length ?? 0) >= 2) return { language: "ru-RU", confidence: 0.96 };
  if ((text.match(/[\u4e00-\u9fff]/g)?.length ?? 0) >= 3) return { language: "zh-CN", confidence: 0.9 };
  if (text.length < 40) return { language: "en-US", confidence: 0.25 };
  const scores = markers.map(([language, pattern]) => [language, [...text.matchAll(pattern)].length] as const).sort((left, right) => right[1] - left[1]);
  const best = scores[0];
  if (!best || best[1] < 2) return { language: "en-US", confidence: 0.35 };
  return { language: best[0], confidence: Math.min(0.92, 0.55 + best[1] * 0.08) };
}
