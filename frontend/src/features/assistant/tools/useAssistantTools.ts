// SPDX-License-Identifier: Apache-2.0
import { listAssistantTools, type AssistantToolList } from "../../../api/assistant";
import { useApi } from "../../../hooks/useApi";

type InventoryState =
  | { status: "idle" | "loading"; data: null; error: null }
  | { status: "ready"; data: AssistantToolList; error: null }
  | { status: "error"; data: null; error: unknown };

export function useAssistantTools(enabled = true) {
  const { data, error, loading, reload } = useApi(listAssistantTools, [], {
    enabled,
    refreshOnRequest: enabled,
  });
  const state: InventoryState = error
    ? { status: "error", data: null, error: new Error(error) }
    : data
      ? { status: "ready", data, error: null }
      : { status: loading ? "loading" : "idle", data: null, error: null };
  return { ...state, reload };
}
