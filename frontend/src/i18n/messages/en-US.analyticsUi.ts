// SPDX-License-Identifier: Apache-2.0
/**
 * Shared copy for the job-analytics charts: data-gap notice and the funnel chart's accessible name.
 *
 * The "N records in total" clause is conditional (rendered only when the caller passes
 * `available`), so it is a separate key; the two parts are concatenated with no extra separator,
 * which is why this one starts with a space.
 */
const analyticsUi = {
  /** First line of the data-gap notice: `{missing}` is the gap count, `{label}` is the already-translated noun phrase. */
  "analyticsUi.dataGap.notice": "Excluded from the chart: {missing} {label}",
  /** Parenthetical total: `{total}` counts both included and excluded records. */
  "analyticsUi.dataGap.total": " ({total} records in total)",

  /** Accessible name of the funnel chart (each chart needs a distinct one, see `HorizontalBarChart`). */
  "analyticsUi.funnel.aria": "Application funnel",
} as const;

export default analyticsUi;
