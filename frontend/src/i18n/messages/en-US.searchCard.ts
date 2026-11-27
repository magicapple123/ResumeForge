// SPDX-License-Identifier: Apache-2.0
/**
 * Settings page · Web search card: sources, search depth, results per search.
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
    "This is **how the search runs** when the assistant's Web search switch is on; the switch on the assistant page decides whether this run searches at all. Fetching page bodies gives more complete content than snippets, but each search is slower and a site may refuse it. Sources, address and key are stored as a global setting shared by every dataset, so switching datasets keeps them.",

  "searchCard.action.save": "Save search settings",
  "searchCard.action.reset": "Restore saved values",
  "searchCard.dirty": "Unsaved changes",

  "searchCard.loadErrorTitle": "Could not load the saved settings",
  "searchCard.loadErrorBody":
    "{message}. The values below are defaults; saving overwrites the settings currently stored on the server.",
  "searchCard.loadFailed": "Could not load the web search settings",
  "searchCard.needSource": "Select at least one search source",
  "searchCard.badSearxngUrl": "The SearXNG instance URL must start with http:// or https://",
  "searchCard.badCustomUrl": "The custom search base URL must start with http:// or https://",
  "searchCard.saving": "Saving…",
  "searchCard.saved": "Web search settings saved",
  "searchCard.saveFailed": "Could not save the web search settings",

  "searchCard.source.bing": "Bing",
  "searchCard.source.duckduckgo": "DuckDuckGo",
  "searchCard.source.searxng": "SearXNG (self-hosted)",
  "searchCard.source.deepseek": "DeepSeek",
  "searchCard.source.tavily": "Tavily",
  "searchCard.source.jina": "Jina",
  "searchCard.source.custom": "Custom",
  "searchCard.source.note.custom": "Your own search endpoint, configured by template",

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
  "searchCard.deepseek.keyRule":
    "Clear the field and save to remove this key. Scanned OCR uses the same key (engine settings live under Settings → Connections).",
  "searchCard.deepseek.cost":
    "This card configures the direct Search / Fetch APIs: about ¥0.005 per successful request each, billed by DeepSeek. The model-side web tools used by the research brief have not been charged per tool call since 2026-11-18. The app only counts calls and never converts them into money. A saved key is echoed as ********; clear the field to remove it.",
  "searchCard.deepseek.privacy":
    "With this source selected, page URLs are sent to DeepSeek so it can fetch the body; local reading is used only when that fails. Turn the source off if you do not want URLs sent.",

  "searchCard.depth.title": "Search depth",
  "searchCard.depth.hint":
    "Controls whether result pages are opened for their body text: snippets only shows the search snippet (fastest); standard opens the top 2 pages and keeps up to 2 passages each; deep opens the top 5 pages with up to 3 passages each and a larger total budget (most detail, slowest).",
  "searchCard.depth.snippet": "Snippets only (fastest)",
  "searchCard.depth.standard": "Standard: fetch the top 2 page bodies",
  "searchCard.depth.deep": "Deep: fetch the top 5 page bodies (most detail, slowest)",

  "searchCard.results.title": "Maximum results per search",
  "searchCard.results.hint":
    "1 to 50. This is only a cap: the model decides how many it actually needs. More results take up more of the model's context, and the real count is also limited by the sources (Bing returns at most 8).",
  "searchCard.results.aria": "Maximum results per search",
  "searchCard.results.unit": "results",
  "searchCard.sources.count": "{count} selected",
  "searchCard.source.note.bing": "No key needed",
  "searchCard.source.note.duckduckgo": "No key needed",
  "searchCard.source.note.searxng": "Needs your own instance URL",
  "searchCard.source.note.deepseek": "Needs an API key; pay as you go",
  "searchCard.source.note.tavily": "Needs an API key; pay as you go",
  "searchCard.source.note.jina": "Needs an API key; free tier available",
  "searchCard.tavily.keyAria": "Tavily API key",
  "searchCard.tavily.keyPlaceholder": "Paste a key starting with tvly-",
  "searchCard.tavily.keyRule":
    "Clear the field and save to remove the Tavily key; assistant search loses one source.",
  "searchCard.tavily.note":
    "One call returns both snippets and full page bodies, so the extra page-fetch round is unnecessary; the free tier allows 1000 credits per month (1 credit per basic search). Bodies still go through passage selection, so a whole page is never pasted into the context.",
  "searchCard.jina.keyAria": "Jina API key",
  "searchCard.jina.keyPlaceholder": "Paste a key starting with jina-",
  "searchCard.jina.keyRule":
    "Clear the field and save to remove the Jina key; page fetching loses one source.",
  "searchCard.jina.note":
    "Search returns the first 5 clean page bodies. Pages that cannot be read locally (JS-heavy) are read once more with it; anything readable locally is not requested twice.",

  /** CR-04: DeepSeek key check (DeepSeek only; a failed check never blocks saving). */
  "searchCard.deepseek.test": "Test key",
  "searchCard.deepseek.testing": "Testing…",
  "searchCard.deepseek.testOk": "Key works ({ms} ms)",
  "searchCard.deepseek.testFailed": "{name} test failed: {reason}",
  "searchCard.deepseek.testUnknown": "Unrecognized reason; check the diagnostics log",
  "searchCard.deepseek.fail.missingKey": "No key to test yet: type one in the field, or save first",
  "searchCard.deepseek.fail.unauthorized":
    "API key is invalid or lacks permission: check whether this key is mistyped or revoked",
  "searchCard.deepseek.fail.balance": "This key is out of balance: top up or use another key",
  "searchCard.deepseek.fail.rateLimited": "This key is rate-limited: try again later",
  "searchCard.deepseek.fail.network":
    "Cannot reach DeepSeek: check the network or proxy (the key itself is fine)",
  "searchCard.deepseek.fail.parse":
    "Connected but the response cannot be parsed: check the relay URL and API protocol (the key itself is fine)",

  /** CR-09: custom search source (template + endpoint + field mapping). */
  "searchCard.custom.template": "Protocol template",
  "searchCard.custom.templateMoonshot": "Kimi (Moonshot)",
  "searchCard.custom.templateGeneric": "Generic",
  "searchCard.custom.baseUrlAria": "Custom search base URL",
  "searchCard.custom.baseUrlPlaceholder": "Paste the base URL from your provider",
  "searchCard.custom.baseUrlHint":
    "Root address only; endpoints are relative paths. Private IP literals are rejected; loopback is allowed.",
  "searchCard.custom.keyAria": "Custom search API key",
  "searchCard.custom.keyPlaceholder": "Only if the endpoint needs auth (optional)",
  "searchCard.custom.searchPathAria": "Custom search endpoint",
  "searchCard.custom.searchPathPlaceholder": "Blank = template default (/v1/tools/search)",
  "searchCard.custom.fetchPathAria": "Custom fetch endpoint",
  "searchCard.custom.fetchPathPlaceholder": "Blank = template default (/v1/tools/fetch)",
  "searchCard.custom.fieldAria": "Results field path",
  "searchCard.custom.fieldPlaceholder": "e.g. data.items",
  "searchCard.custom.includeContent": "Search responses include full page bodies",
  "searchCard.custom.keyRule": "Clear the field and save to remove the custom key.",
  "searchCard.custom.note":
    "The custom source only affects result cards and assistant web search; the research brief still uses DeepSeek. Field paths support only a.b / a[0].b.",

  "searchCard.general.title": "Shared parameters",
  "searchCard.status.saved": "Auto-saved",
  "searchCard.status.saving": "Saving…",
  "searchCard.status.error": "Save failed",
} as const;

export default searchCard;
