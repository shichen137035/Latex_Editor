import type { AIResponsePart } from "@latex-editor/contracts";

export type DisplayResponsePart = AIResponsePart & { sourceIds: string[] };

/** Keep provider reasoning chunks together until visible answer text separates them. */
export function groupAdjacentReasoningParts(parts: AIResponsePart[]): DisplayResponsePart[] {
  const grouped: DisplayResponsePart[] = [];
  for (const part of parts) {
    // Some providers send empty message events between reasoning summaries. They
    // have no visible place in the transcript and should not split a thought group.
    if (part.kind === "text" && !part.text.trim()) continue;
    const previous = grouped.at(-1);
    if (part.kind === "reasoning" && previous?.kind === "reasoning") {
      previous.text = [previous.text, part.text].filter(Boolean).join("\n\n");
      previous.sourceIds.push(part.id);
    } else {
      grouped.push({ ...part, sourceIds: [part.id] });
    }
  }
  return grouped;
}
