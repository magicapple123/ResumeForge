// SPDX-License-Identifier: Apache-2.0
/**
 * Apply-settings dialog: intervals, limits, breaker threshold, default greeting and the
 * dedicated browser port.
 *
 * `defaults.hint` is the template for the "factory default" readout; `defaults.on` /
 * `defaults.off` are the two values a switch field can show, so the sentence order stays
 * in the template instead of being glued together in code.
 *
 * The intro paragraph is one key on purpose: the source emphasised "successful
 * applications" with an inline tag, and splitting around it cannot be reordered for
 * English. One complete sentence per locale wins over keeping the emphasis.
 */
const applySettings = {
  "applySettings.title": "Apply settings",
  "applySettings.intro":
    "These settings decide the rhythm and the safety net of applying: jobs wait a random interval between each other, consecutive failures pause the run automatically, and the daily limit only counts successful applications.",

  "applySettings.defaults.on": "On",
  "applySettings.defaults.off": "Off",
  "applySettings.defaults.hint": "Factory default: {value}",

  "applySettings.interval.label": "Interval between jobs (seconds)",
  "applySettings.interval.required": "Enter the interval between jobs",
  "applySettings.jitter.label": "Random jitter (seconds)",
  "applySettings.dailyLimit.label": "Daily limit (successful applications)",
  "applySettings.dailyLimit.required": "Enter the daily limit",
  "applySettings.perTaskLimit.label": "Per-batch limit",
  "applySettings.breaker.label": "Consecutive-failure threshold",

  "applySettings.greeting.label": "Default greeting",
  "applySettings.greeting.extra":
    "Used when a queue entry has no greeting of its own; you can still preview and edit it job by job before applying.",

  "applySettings.site.label": "Current job site",
  "applySettings.site.extra":
    "Only one job site is supported for now, and more will follow; new sites need no manual configuration from you.",
  "applySettings.site.placeholder": "Use the default site",

  "applySettings.browser.label": "Browser used by the apply console",
  "applySettings.browserPort.label": "Debug port of the apply browser",

  "applySettings.skipSameCompany.label": "Apply to only one job per company",
  "applySettings.skipSameCompany.extra":
    'Applies within one batch only: when a company has several jobs in the same batch, only the first is applied to and the rest are marked "Skipped" with a reason; the same company can still be applied to in a later batch. Matching ignores spaces and letter case in the company name, and a failed attempt also counts as "already applied" (the greeting may already have been sent).',

  "applySettings.realGap.label": 'Allow "real gap" jobs into the queue by default',
  "applySettings.realGap.extra":
    "Off by default: jobs that hit a real gap need your per-job confirmation; when turned on they are still flagged in the records.",

  "applySettings.action.save": "Save settings",
  "applySettings.saved": "Apply settings saved",
  "applySettings.saveFailed": "Could not save the apply settings",
} as const;

export default applySettings;
