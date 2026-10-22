import type { AIMessage } from "@latex-editor/contracts" with { "resolution-mode": "import" };

function updateResponsePart(message: AIMessage, kind: "text" | "reasoning", id: string, text: string): void {
  message.responseParts ??= [];
  const part = message.responseParts.find(part => part.id === id && part.kind === kind);
  if (part) part.text = text;
  else message.responseParts.push({ id, kind, text });
}

/** Shared streaming format for project chat and the application companion. */
export function updateReasoning(message: AIMessage, id: string, text: string, complete: boolean): void {
  message.reasoning ??= [];
  let part = message.reasoning.find(item => item.id === id);
  if (!part) { part = { id, text: "", complete: false }; message.reasoning.push(part); }
  part.text = complete ? text : part.text + text;
  part.complete = complete;
  updateResponsePart(message, "reasoning", id, part.text);
  if (!complete) message.activity = "thinking";
}

export function updateResponseText(message: AIMessage, id: string, text: string, complete: boolean): void {
  const previous = message.responseParts?.find(part => part.kind === "text" && part.id === id)?.text ?? "";
  updateResponsePart(message, "text", id, complete ? text : previous + text);
  message.content = message.responseParts!.filter(part => part.kind === "text").map(part => part.text).join("\n\n");
}
