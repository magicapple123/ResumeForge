// SPDX-License-Identifier: Apache-2.0
/**
 * Site-wide search (`components/GlobalSearch.tsx`): the header magnifier, the
 * Ctrl/⌘+K overlay chrome, the input hints, the four result states and the
 * group headings.
 *
 * Hit titles, companies, subtitles and data-domain tags come from the API and
 * are data, not copy.
 */
const globalSearch = {
  "globalSearch.title": "Global search",
  "globalSearch.trigger.tooltip": "Global search (Ctrl/⌘ + K)",
  "globalSearch.trigger.aria": "Global search",
  "globalSearch.panel.aria": "Global search",
  "globalSearch.close.aria": "Close search",

  "globalSearch.input.placeholder":
    "Search jobs, resumes, referrals, reminders, interview notes, fact ledger or materials…",
  "globalSearch.input.aria": "Search keywords",

  "globalSearch.idle":
    "Type a keyword to start. Results come only from your own local data and never go online.",
  "globalSearch.loading": "Searching…",
  "globalSearch.error.fallback": "Search failed",
  "globalSearch.empty": "No matches",
  "globalSearch.resume.fallback": "General Resume",

  "globalSearch.group.jobs": "Jobs",
  "globalSearch.group.resumes": "Resumes",
  "globalSearch.group.more": "Other",

  /** Data-domain tags of a hit come from the language pack, never the raw code. */
  "globalSearch.type.referral": "Referral",
  "globalSearch.type.reminder": "Reminder",
  "globalSearch.type.experience": "Interview notes",
  "globalSearch.type.claim": "Fact ledger",
  "globalSearch.type.material": "Material",
  /** Hit inside My Profile: the click lands on the matching section. */
  "globalSearch.type.profile": "My profile",
} as const;

export default globalSearch;
