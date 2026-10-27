// SPDX-License-Identifier: Apache-2.0
/**
 * Shared apply-console copy: the record detail drawer, the per-batch record group, the records
 * toolbar, the "controlled browser" fields, the browser settings dialog, the auto-collect
 * panel, the collection records panel and the current-site bar.
 *
 * Two groups are intentionally out of scope (their source files are outside this batch):
 * - Status tags, failure-category names, batch statuses and browser type names still come from
 *   the mapping tables in `types` (protocol value to display name); "Google Chrome" and
 *   "Microsoft Edge" are pure ASCII brand names and would be flagged as English source text by
 *   `messageContract`, so they need a documented equality exception instead of a translation.
 * - The detail drawer's field names (Job / Resume / Greeting / Result / Failure type) and
 *   "(Job deleted)" reuse the keys of `en-US.applyRecords.ts` - same panel, same wording.
 */
const applyUi = {
  "applyUi.recordDetail.title": "Apply record details",
  "applyUi.recordDetail.time": "Time",
  "applyUi.recordDetail.taskBatch": "Task / batch",
  "applyUi.recordDetail.defaultGreeting": "(default greeting)",
  "applyUi.recordDetail.failureDetail": "Failure details (page URL and title)",
  "applyUi.recordDetail.batchAttempt": "Batch #{id} · attempt {attempt}",

  "applyUi.batch.selectMode": "Select multiple",
  "applyUi.batch.deleteBatch": "Delete this batch ({count} records)",
  "applyUi.batch.deleteConfirm": "Delete this batch of records?",
  "applyUi.batch.deleteConfirmBody":
    "These {count} apply records move to Trash and can be restored later; the stats and the daily limit drop as well.",
  "applyUi.batch.heading": "Batch #{id}",
  "applyUi.batch.recordCount": "{count} records",
  "applyUi.batch.succeeded": "{count} succeeded",
  "applyUi.batch.failed": "{count} failed",
  "applyUi.batch.skipped": "{count} skipped",
  "applyUi.batch.loadingItems": "Loading records…",
  "applyUi.batch.emptyItems": "No records match in this batch",

  "applyUi.toolbar.searchPlaceholder": "Search Jobs or companies",
  "applyUi.toolbar.resultSuccess": "Succeeded",
  "applyUi.toolbar.resultFailed": "Failed",
  "applyUi.toolbar.resultSkipped": "Skipped",
  "applyUi.toolbar.goTracker": "Follow up in the Job tracker",
  "applyUi.toolbar.groupHint":
    "Grouped by apply batch: Jobs sent in one go share a batch - expand it to see the records",

  "applyUi.browserChoice.label": "Controlled browser",
  "applyUi.browserChoice.pathLabel": "Custom browser path",
  "applyUi.browserChoice.pathExtra":
    "Only used with Custom path; it must be an existing executable file.",
  "applyUi.browserChoice.pathPlaceholder": "e.g. C:\\Program Files\\MyBrowser\\browser.exe",

  "applyUi.browserSettings.title": "Browser settings",
  "applyUi.browserSettings.save": "Save browser settings",
  "applyUi.browserSettings.intro":
    "The apply console and the web-form filler open separate browser windows with separate sign-in state; the browser chosen here applies to both.",
  "applyUi.browserSettings.effectiveHint":
    "After switching, close the browser on the page and start it again for the change to take effect",
  "applyUi.browserSettings.saved": "Browser settings saved",
  "applyUi.browserSettings.saveFailed": "Could not save",

  "applyUi.collect.saved": "Collection conditions saved",
  "applyUi.collect.saveFailed": "Could not save the collection conditions",
  "applyUi.collect.needKeywords": "Fill in at least one keyword or city",
  "applyUi.collect.startedWithSamples":
    "Collection started - track progress in the batch card; the raw site pages are saved and you will be told where when it finishes",
  "applyUi.collect.started": "Collection started - track progress in the batch card",
  "applyUi.collect.startFailed": "Could not start collecting",
  "applyUi.collect.flowTitle": "Two more steps before applying",
  "applyUi.collect.flowStepStage":
    "Collection puts Jobs into “Results of this collection” below; nothing goes to the Job board directly - you filter out the noise.",
  "applyUi.collect.flowStepImport":
    "Tick the Jobs you want to keep, then click “Import selected jobs”.",
  "applyUi.collect.flowStepQueue":
    "Go to “Apply queue”, line them up and start applying explicitly; the results show under “Apply records”.",
  "applyUi.collect.historyLabel": "Saved conditions",
  "applyUi.collect.clearHistory": "Clear history",
  "applyUi.collect.clearHistoryConfirm":
    "Clear the saved conditions? Every saved collection snapshot is deleted and cannot be recovered.",

  "applyUi.collectRecords.conditionKeywords": "Keywords: {keywords}",
  "applyUi.collectRecords.conditionCity": "City: {city}",
  "applyUi.collectRecords.conditionEmpty": "(no collection conditions recorded)",
  "applyUi.collectRecords.keywordSeparator": ", ",
  "applyUi.collectRecords.conditionSeparator": "; ",
  "applyUi.collectRecords.resultSaved": "{count} Jobs staged",
  "applyUi.collectRecords.resultDuplicate": "{count} duplicates",
  "applyUi.collectRecords.resultFiltered": "{count} filtered out",
  "applyUi.collectRecords.resultFailed": "{count} failed",
  "applyUi.collectRecords.resultBackfilled": "{count} descriptions filled in",
  "applyUi.collectRecords.resultSkipped": "{count} skipped",
  "applyUi.collectRecords.resultBackfillFailed": "{count} failed",
  "applyUi.collectRecords.resultSeparator": ", ",
  "applyUi.collectRecords.empty":
    "No collection records yet. Set conditions in the “Auto collect” tab and click “Start collecting”; every run will show up here.",
  "applyUi.collectRecords.nextStep": "After importing:",
  "applyUi.collectRecords.viewJobs": "View Candidate Jobs",
  "applyUi.collectRecords.paginationTotal": "{count} collection runs in total",

  "applyUi.siteBar.currentLabel": "Current job site:",
  "applyUi.siteBar.capabilityCollect": "Collect",
  "applyUi.siteBar.capabilityApply": "Apply",
  "applyUi.siteBar.onlyOne": "Only this job site is supported for now; more will be added later.",
  "applyUi.siteBar.switchHint": "Switch the job site in Apply settings.",
  "applyUi.siteBar.degradedFallback":
    "Recent collections failed - the site may have changed. Retry once; if it keeps failing, report it in the project repository.",
  "applyUi.siteBar.degradedTag": "Site may have changed",
  "applyUi.siteBar.healthAria": "Site health warning: {reason}",
} as const;

export default applyUi;
