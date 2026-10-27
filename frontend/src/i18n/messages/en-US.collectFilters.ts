// SPDX-License-Identifier: Apache-2.0
/**
 * Collect tab, "filter by job site conditions": reload/test actions, the site filter
 * test and its per-item result rows.
 *
 * Covers the module-level `SOURCE_TAG` source tags and their tooltips (read from your
 * signed-in session / site-wide option list …).
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
  "collectFilters.source.session.text": "Read from your signed-in session",
  "collectFilters.source.session.hint":
    "These are the options your account can really see on the job site, so they are the most accurate.",
  "collectFilters.source.public.text": "Site-wide option list",
  "collectFilters.source.public.hint":
    "The browser is not running, so this is the generic list you can get without signing in. A few options (such as internships, which only some accounts have) may be missing; once the browser starts, it is replaced with the full list your own account can see.",
  "collectFilters.source.snapshot.text": "Built-in snapshot (offline)",
  "collectFilters.source.snapshot.hint":
    "Reading from the site over the network failed, so this is a built-in snapshot. Its codes may be out of date; reconnect to the internet and reload before collecting.",
  "collectFilters.source.unavailable.text": "Unavailable this time",
  "collectFilters.source.unavailable.hint":
    "This condition could not be read from the site this time, so it cannot be used for filtering yet.",
} as const;

export default collectFilters;
