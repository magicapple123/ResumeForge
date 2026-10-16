import type { KeyboardEvent } from "react";

/** Scoped to an editor form so shortcuts cannot save a background page. */
export function handleEditorSaveKey(event: KeyboardEvent, save: () => void) {
  if (event.nativeEvent.isComposing || !(event.ctrlKey || event.metaKey)) return;
  if (event.key !== "Enter" && event.key.toLowerCase() !== "s") return;
  event.preventDefault();
  if (!event.repeat) save();
}
