// SPDX-License-Identifier: Apache-2.0
/**
 * Collect tab, "filter by job site conditions": reload/test actions, the site filter
 * test and its per-item result rows.
 *
 * The `text` / `hint` fields of the module-level `SOURCE_TAG` constant are still Chinese
 * literals; they need labelKeys first and are left for the next batch.
 */
const collectFilters = {
  "collectFilters.toast.needCondition":
    "Select at least one site filter before testing whether it takes effect",
  "collectFilters.toast.testFailed": "Failed to test the filters",
  "collectFilters.unread.title": "Could not read the job site's filters",
  "collectFilters.unread.body":
    "Collection is not affected: keywords and cities still apply. Click Reload below to try again.",
  "collectFilters.action.reload": "Reload",
  "collectFilters.action.test": "Test filters",
  "collectFilters.section.title": "Filter by job site conditions",
  "collectFilters.section.loading": "Reading the site's filters…",
  "collectFilters.test.hint":
    "Check each selected condition on the real job site to see whether it can still be picked there (this briefly navigates to the filter bar and does not affect collection)",
  "collectFilters.intro":
    "These are the conditions from the job site's own filter bar; the site applies them while searching, which is more accurate than filtering after collection and means far fewer pages to go through. The option list is read from the site itself, so it follows the site whenever it changes.",
  "collectFilters.launch.title":
    "Start the dedicated browser to get the full option list your account can see",
  "collectFilters.launch.body":
    "Some options differ per account (for example, student accounts see internships under job type), and they can only be read from a browser where you are signed in. The current list is the site-wide one: usable, but not necessarily complete.",
  "collectFilters.result.partial": "{count} conditions could not take effect",
  "collectFilters.result.all": "Every selected condition is really selectable on the site",
  "collectFilters.result.applied": "Applied",
  "collectFilters.result.unapplied": "Not applied",
  "collectFilters.result.itemLabel": "{label}: {value}",
  "collectFilters.result.itemDetail": "{label}: {value} — {detail}",
  "collectFilters.result.unlimited": "{label} — {detail}",
  "collectFilters.tag.any": "Any",
  "collectFilters.aria.group": "Site filter - {label}",
} as const;

export default collectFilters;
