import { isValidReasoningEffort, type ReasoningEffort } from "../../types/assistant";

const REASONING_EFFORT_STORAGE_KEY = "resumeforge.assistant.reasoning_effort";

export function readStoredReasoningEffort(): ReasoningEffort {
  const raw = window.localStorage.getItem(REASONING_EFFORT_STORAGE_KEY) ?? "";
  return isValidReasoningEffort(raw) ? raw.trim() : "";
}
