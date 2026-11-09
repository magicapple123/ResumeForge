// SPDX-License-Identifier: Apache-2.0
/**
 * Settings page · Web search card: sources, page-fetch count, results per search.
 *
 * Source values (`bing` / `duckduckgo` / `searxng`) stay untranslated protocol values in
 * the component; only their display names live here. `Bing` / `DuckDuckGo` are brand
 * names spelled the same in both locales, so they are not in the pack at all — an ASCII
 * source value would be rejected as "untranslated English". Only the SearXNG suffix
 * ("self-hosted") needs translating.
 *
 * The instance-address paragraph keeps its example URL inline: the source wrapped it in
 * `<code>`, and splitting a sentence around an inline tag cannot be reordered for English.
 */
const searchCard = {
  "searchCard.title": "Web search",
  "searchCard.intro":
    "This is **how the search runs** when the assistant's Web search switch is on; the switch on the assistant page decides whether this run searches at all. Fetching page bodies gives more complete content than snippets, but each search is slower and a site may refuse it.",

  "searchCard.action.save": "Save search settings",
  "searchCard.action.reset": "Restore saved values",
  "searchCard.dirty": "Unsaved changes",

  "searchCard.loadErrorTitle": "Could not load the saved settings",
  "searchCard.loadErrorBody":
    "{message}. The values below are defaults; saving overwrites the settings currently stored on the server.",
  "searchCard.loadFailed": "Could not load the web search settings",
  "searchCard.needSource": "Select at least one search source",
  "searchCard.badUrl": "The SearXNG address must start with http:// or https://",
  "searchCard.saving": "Saving…",
  "searchCard.saved": "Web search settings saved",
  "searchCard.saveFailed": "Could not save the web search settings",

  "searchCard.source.searxng": "SearXNG (self-hosted)",
  "searchCard.source.deepseek": "DeepSeek",

  "searchCard.sources.title": "Search sources",
  "searchCard.sources.hint":
    "Multiple sources are queried concurrently, then merged and de-duplicated; pick at least one.",

  "searchCard.searxng.title": "SearXNG instance address",
  "searchCard.searxng.placeholder": "e.g. http://localhost:8080",
  "searchCard.searxng.hint":
    "Public instances are rate-limited often, so no default is preset; the address is queried only when you fill in your own instance, e.g. http://localhost:8080. You can leave it empty when the SearXNG source is not selected.",

  "searchCard.deepseek.title": "DeepSeek search (optional)",
  "searchCard.deepseek.hint":
    "It is called only when you save your own API key and select the DeepSeek source above. It does not follow the chat model configuration, so quota and billing are separate. Without a key this source does not join the search and is never shown as a successful search.",
  "searchCard.deepseek.keyAria": "DeepSeek search API key",
  "searchCard.deepseek.keyPlaceholder": "Paste your DeepSeek API key",
  "searchCard.deepseek.cost":
    "Search and Fetch cost about ¥0.005 per successful request each, billed by DeepSeek; this app does not track that usage. A saved key is echoed as ********; clear the field to remove it.",
  "searchCard.deepseek.privacy":
    "With this source selected, page URLs are sent to DeepSeek so it can fetch the body; local reading is used only when that fails. Turn the source off if you do not want URLs sent.",

  "searchCard.fetch.title": "Page bodies fetched",
  "searchCard.fetch.hint":
    "The top-ranked results are opened and their body text is read. When this is off, the assistant only sees search snippets.",
  "searchCard.fetch.0": "Snippets only (fastest)",
  "searchCard.fetch.1": "Fetch the top 1 page body",
  "searchCard.fetch.2": "Fetch the top 2 page bodies",
  "searchCard.fetch.3": "Fetch the top 3 page bodies (most detail, slowest)",

  "searchCard.results.title": "Results returned per search",
  "searchCard.results.hint":
    "1 to 15. The more results, the more of the model's context they take up.",
  "searchCard.results.aria": "Number of search results",
  "searchCard.results.unit": "results",
  "searchCard.sources.count": "{count} selected",
  "searchCard.source.note.bing": "No key needed",
  "searchCard.source.note.duckduckgo": "No key needed",
  "searchCard.source.note.searxng": "Needs your own instance URL",
  "searchCard.source.note.deepseek": "Needs an API key; pay as you go",

  "searchCard.general.title": "Shared parameters",
  "searchCard.status.saved": "Auto-saved",
  "searchCard.status.saving": "Saving…",
  "searchCard.status.error": "Save failed",
} as const;

export default searchCard;
