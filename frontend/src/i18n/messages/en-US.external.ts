// SPDX-License-Identifier: Apache-2.0
/**
 * Copy for the "External connections" page (T11 / T12) and the recognition-engine
 * setting (T01). See the zh-CN file for the rule about which names come from the
 * backend: the three engine options are described by the API only, never here.
 */

const external = {
  // ── Page and groups ────────────────────────────────────────
  "connections.tab": "External connections",
  "connections.intro":
    "Every outside service and download source this machine depends on: whether it is configured, where it lives, and how to change it. Keys are shown masked; clearing one in place removes it.",
  "connections.group.ai": "AI services",
  "connections.group.search": "Search sources",
  "connections.group.system": "Sources and ports",
  "connections.group.aiHint":
    "Keys for models, speech transcription and semantic search. Changes apply immediately.",
  "connections.group.searchHint":
    "Keys for assistant web search and page fetching. The DeepSeek key also powers OCR for scans.",
  "connections.group.systemHint":
    "Download sources and the browser port. These are not secrets, they travel with backups, and changes apply on the next call.",

  // ── Storage summary ────────────────────────────────────────
  "connections.storage.title": "Key storage on this machine: {label}",

  // ── Status ─────────────────────────────────────────────────
  "connections.status.saved": "Saved",
  "connections.status.not_configured": "Not configured",
  "connections.status.session_only": "This session only",
  "connections.status.modified": "Changed",
  "connections.status.default": "Default",

  // ── Storage protection ─────────────────────────────────────
  "connections.protection.dpapi": "DPAPI encrypted",
  "connections.protection.plaintext": "No system encryption here",
  "connections.protection.memory_only": "Memory only, never written",
  "connections.protection.config_file": "Plain config file",

  // ── Actions and feedback ───────────────────────────────────
  // The primary button follows the state (issue I-09): not configured → Set,
  // saved → Replace, system source → Edit. Clear/Restore default move into the
  // `⋯` menu, but Clear keeps its confirmation because it cannot be undone.
  "connections.action.primary.set": "Set",
  "connections.action.primary.change": "Replace",
  "connections.action.primary.modify": "Edit",
  "connections.action.more": "More actions for {name}",
  "connections.action.copy": "Copy current value",
  "connections.action.save": "Save",
  "connections.action.cancel": "Cancel",
  "connections.action.clear": "Clear",
  "connections.action.reset": "Restore default",
  // The accessible name must contain the visible text (label-in-name): the
  // button reads "Set" or "Replace", and this sentence contains both.
  "connections.action.editAria": "Set or change the key for {name}",
  "connections.action.saveAria": "Save the new key for {name}",
  "connections.action.clearAria": "Clear the key for {name}",
  "connections.action.editValue": "Change {name}",
  "connections.action.saveValue": "Save {name}",
  "connections.action.resetValue": "Restore the default for {name}",
  "connections.emptyMask": "Not set",
  "connections.input.label": "New key for {name}",
  "connections.input.placeholder": "Paste the new key",
  "connections.hint.aria": "Show details for {name}",
  "connections.hint.storage": "Storage: {label}",
  "connections.clear.title": "Clear this key",
  "connections.clear.body": "The related feature stops working until you enter a key again",
  "connections.loadFailed": "Could not load external connections",
  "connections.loadErrorBody": "Reason: {message}",
  "connections.saveFailed": "Could not save: {message}",
  "connections.toast.saved": "Saved {name}",
  "connections.toast.cleared": "Cleared {name}",
  "connections.toast.reset": "Restored the default for {name}",
  "connections.toast.copied": "Copied the current value of {name}",
  "connections.toast.copyFailed": "Could not copy. Select the text and copy it manually",
  "connections.system.factoryValue": "Factory value {value}",
  "connections.system.resetHint": "You can restore the default at any time",
  "connections.error.emptyValue": "The new key cannot be empty. Use Clear to remove it.",
  "connections.error.unsupported": "This entry cannot be changed here",
  "connections.error.noAsrProfile":
    "No voice configuration to write to yet; create one under Voice & interview → Speech-to-text",

  // ── Item names and inline hints ────────────────────────────
  "connections.item.llm.default.label": "Model API key (active configuration)",
  "connections.item.llm.default.hint":
    "Only the key is changed here. Provider and model live under AI models; switching providers does not carry the key over.",
  "connections.item.llm.session.label": "Model key for this session only",
  "connections.item.llm.session.hint":
    "Held in backend memory only, gone after a restart. Clearing it falls back to the saved key.",
  "connections.item.asr.default.label": "Speech-to-text API key (active configuration)",
  "connections.item.asr.default.hint":
    "Changes the key of the active voice configuration. A new address or protocol needs the key again.",
  "connections.item.embedding.default.label": "Semantic search API key (active configuration)",
  "connections.item.embedding.default.hint":
    "Configured under AI models → semantic search; this page only tells whether a key exists.",
  "connections.item.web_search.deepseek.label": "DeepSeek (search / fetch / OCR)",
  "connections.item.web_search.deepseek.hint":
    "Changing it here changes the DeepSeek key used by web search. Clearing removes it; OCR shares the same key.",
  "connections.item.web_search.tavily.label": "Tavily (search source)",
  "connections.item.web_search.tavily.hint":
    "Clearing removes the Tavily key; assistant search loses one source.",
  "connections.item.web_search.jina.label": "Jina (page fetch source)",
  "connections.item.web_search.jina.hint":
    "Clearing removes the Jina key; page fetching loses one source.",
  "connections.item.system.update_repo.label": "Update source (GitHub repository)",
  "connections.item.system.update_repo.hint":
    "Repository queried when checking for updates, as owner/repo. Change it to use a self-hosted release source.",
  "connections.item.system.font_base_url.label": "Font download source",
  "connections.item.system.font_base_url.hint":
    "Root address for the built-in font download; must start with http or https.",
  "connections.item.system.rag_asset_base_url.label": "RAG asset download source",
  "connections.item.system.rag_asset_base_url.hint":
    "Root address for the local semantic-search model archive. Point at the directory, not a file.",
  "connections.item.system.browser_port.label": "Browser debug port",
  "connections.item.system.browser_port.hint":
    "Debug port for the dedicated application browser, between 1024 and 65535. Web forms use 9334, so avoid it.",

  // ── Recognition engine ─────────────────────────────────────
  "ocrEngine.title": "Recognition engine",
  "ocrEngine.intro":
    "Which path reads text out of scans. The two paths send the original to different third parties: OCR to DeepSeek (billed per page), vision to the multimodal model you configured.",
  "ocrEngine.current": "In use: {label}",
  "ocrEngine.keyMissing.title": "No DeepSeek API key yet",
  "ocrEngine.keyMissing.body":
    "OCR reuses the DeepSeek key from web search (the search sources group on this page). Auto keeps using the vision model when no key is set; OCR only fails outright instead of silently switching providers or spending money.",
  "ocrEngine.saveFailed": "Could not switch: {message}",
  "ocrEngine.saved": "Recognition engine switched",
  "ocrEngine.loadFailed": "Could not load the recognition engine setting",
};

export default external;
