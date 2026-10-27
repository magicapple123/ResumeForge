// SPDX-License-Identifier: Apache-2.0
/**
 * The Resume comparison field view: the header summary and its three counters,
 * the three-state tags on single-field and list blocks, empty placeholders,
 * the unchanged collapsibles and the raw source diff fallback.
 *
 * Keys are grouped by block: `tag` / `column` label one block, `stats` is the
 * header counter row and `raw` is the collapsible that reveals the raw source
 * diff. `subFieldLabel` carries a `{label}` placeholder filled with a field name
 * from the data layer; the field names themselves are not part of this pack.
 */
const resumeFieldDiffView = {
  "resumeFieldDiffView.compare": "Comparing:",
  "resumeFieldDiffView.stats.added": "{added} added",
  "resumeFieldDiffView.stats.removed": "{removed} removed",
  "resumeFieldDiffView.stats.unchanged": "{unchanged} unchanged",
  "resumeFieldDiffView.tag.added": "Added",
  "resumeFieldDiffView.tag.removed": "Removed",
  "resumeFieldDiffView.tag.modified": "Modified",
  "resumeFieldDiffView.column.old": "Before",
  "resumeFieldDiffView.column.new": "After",
  "resumeFieldDiffView.empty": "(Empty)",
  "resumeFieldDiffView.itemFallback": "(Item)",
  "resumeFieldDiffView.subFieldLabel": "{label}:",
  "resumeFieldDiffView.unchangedItems": "{count} unchanged items",
  "resumeFieldDiffView.unchangedFields": "{count} unchanged fields",
  "resumeFieldDiffView.emptyDescription": "Both Resumes are identical — no differences",
  "resumeFieldDiffView.raw.toggle": "View raw differences",
} as const;

export default resumeFieldDiffView;
