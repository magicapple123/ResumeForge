// SPDX-License-Identifier: Apache-2.0
/**
 * Collect tab: the collection config form, the batch outcome alerts and the label of a
 * saved condition snapshot in the history dropdown.
 *
 * Covers `CollectConfigForm`, `CollectOutcomeAlerts` and `collectConfigHistory` under
 * `features/apply/collect/`; "filter by job site conditions" stays in `collectFilters`.
 */
const applyCollect = {
  "applyCollect.group.search": "Search conditions",
  "applyCollect.group.rhythm": "Collection timing",
  "applyCollect.group.searchHint":
    "Fill in at least one of keywords and city; results land in Collected records first, and only checked ones enter the job board.",
  "applyCollect.group.rhythmHint":
    "Shorter intervals hit rate limits sooner; jitter keeps the gaps from looking mechanical.",
  "applyCollect.field.history": "Saved conditions",
  "applyCollect.unit.perBatch": "per batch",
  "applyCollect.unit.seconds": "s",
  "applyCollect.footer.summary":
    "About {count} jobs · every {interval} ± {jitter}s · roughly {minutes} min",
  "applyCollect.filters.selected": "{count} selected",
  "applyCollect.flow.summary": "Collect results → Import jobs → Add to application queue",
  "applyCollect.flow.instructions": "View instructions",
  "applyCollect.field.keywords": "Keywords",
  "applyCollect.hint.keywords": "Up to 10; fill in at least one keyword or a city.",
  "applyCollect.placeholder.keywords": "e.g. marketing, finance and accounting",
  "applyCollect.field.city": "City",
  "applyCollect.placeholder.city": "e.g. Beijing",
  "applyCollect.field.perTaskLimit": "Batch limit",
  "applyCollect.field.intervalSeconds": "Job interval (seconds)",
  "applyCollect.field.jitterSeconds": "Random jitter (seconds)",
  "applyCollect.field.saveSamples":
    "Save the raw site responses from this run (for debugging parsing issues)",
  "applyCollect.hint.saveSamples":
    "Saves the raw responses from both the search and detail endpoints; stored only on this machine under backend/data/captures/ - not in the repository and not in backups.",
  "applyCollect.action.save": "Save conditions",
  "applyCollect.action.start": "Start collecting",
  "applyCollect.history.keywordSeparator": ", ",
  "applyCollect.history.noKeywords": "No keywords",
  "applyCollect.history.noCity": "No city",
  "applyCollect.outcome.listSeparator": ", ",
  "applyCollect.outcome.pagination.title":
    "The later pages repeat earlier results exactly, so paging stopped early at page {page}",
  "applyCollect.outcome.pagination.description":
    "There may be no more Jobs under these conditions, or most of them have already been collected. To collect more, change the keywords or city, or loosen the filters and run again.",
  "applyCollect.outcome.unmapped.title": "These conditions did not take effect",
  "applyCollect.outcome.unmapped.description":
    "In this run, {conditions} could not be mapped to the site's query parameters, so they were not used for filtering; the results may include Jobs that do not meet these conditions. Keywords, city and paging still applied.",
  "applyCollect.outcome.siteFiltered.appliedTitle":
    "The job site filtered out Jobs that do not match: {conditions}",
  "applyCollect.outcome.siteFiltered.unappliedTitle": "Some filters did not take effect",
  "applyCollect.outcome.siteFiltered.unappliedDescription":
    "These conditions did not take effect this time: {conditions} — their codes could not be checked against the site's current list, so they were not sent (an unmatched code still returns results, and you would think the filter had applied). Click Reload above to refresh the list, then try again.",
  "applyCollect.outcome.siteFiltered.appliedDescription":
    "The site applied these filters while searching, so the results contain no Jobs that do not match.",
} as const;

export default applyCollect;
