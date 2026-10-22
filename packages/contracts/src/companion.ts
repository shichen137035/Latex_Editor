export interface CompanionSkillSummary {
  name: string;
  description: string;
  source: "built-in" | "custom" | "customized";
  enabled: boolean;
  readOnly: boolean;
}
export interface CompanionSkillDocument extends CompanionSkillSummary { content: string }
export interface CompanionSkillContext { core: CompanionSkillDocument; skills: CompanionSkillDocument[] }
import type { AIApprovalRequest, AIConversation } from "./index.js";

export type CompanionChatUpdate =
  | { kind: "conversation"; payload: AIConversation }
  | { kind: "approval"; payload: AIApprovalRequest };

