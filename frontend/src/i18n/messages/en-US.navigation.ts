// SPDX-License-Identifier: Apache-2.0
/**
 * Sidebar, mobile navigation drawer, "My space" menu and the "Interface and navigation"
 * settings card: navigation entry names, page titles, brand copy and shell accessibility
 * labels.
 */
const navigation = {
  // ── Navigation entries (labelKey values on NAVIGATION_ITEMS) ──────────
  "navigation.item.home": "Home",
  "navigation.item.jobs": "Job board",
  "navigation.item.resumes": "Resume Center",
  "navigation.item.apply": "Apply desk",
  "navigation.item.webform": "Web form",
  "navigation.item.tracker": "Job tracker",
  "navigation.item.interview": "Mock interview",
  "navigation.item.assistant": "Job assistant",
  "navigation.item.settings": "Settings",
  "navigation.item.profile": "My Profile",
  "navigation.item.favorites": "Favorites",
  "navigation.item.materials": "Material library",
  "navigation.item.knowledge": "Knowledge base",
  "navigation.item.skills": "Workbench",
  "navigation.item.analytics": "Analytics",
  "navigation.item.claims": "Fact ledger",
  "navigation.item.trash": "Trash",

  /** "Fact check" is not in the sidebar, but the /claims/drill route title uses it. */
  "navigation.page.claimsDrill": "Fact check",

  /** Trigger label for the "My space" menu, also its accessible name. */
  "navigation.mySpace.label": "My space",
  /** User guide entry in the sidebar and the mobile drawer. */
  "navigation.guide.open": "User guide",

  /** Mobile navigation drawer title and the accessible name of its nav landmark. */
  "navigation.mobile.title": "Navigation",
  "navigation.mobile.aria": "Mobile main navigation",

  /** Skip link: keyboard users can jump straight to the main content. */
  "navigation.a11y.skipToMain": "Skip to main content",

  /** Sidebar brand area and header. */
  "navigation.shell.title": "AI-powered resume builder",
  "navigation.shell.brandCaption": "AI resume workbench",
  "navigation.shell.versionTooltip": "Current version",
  "navigation.shell.scrollTop": "Back to top",
  "navigation.shell.collapse": "Collapse sidebar",
  "navigation.shell.expand": "Expand sidebar",
  "navigation.shell.openMenu": "Open navigation",

  /** Settings page "Interface and navigation" card. */
  "navigation.settings.title": "Interface and navigation",
  "navigation.settings.restore": "Restore defaults",
  "navigation.settings.intro":
    "Hiding an entry only removes it from navigation. It does not delete data or block direct access to the page. Home, Job board, Resume Center, My Profile, Apply desk and Settings are always shown.",
  "navigation.settings.group.primary": "Core entries",
  "navigation.settings.group.space": "My space",
  "navigation.settings.fixed": "Always shown",
  "navigation.settings.switchAria": "{name} navigation entry",
  "navigation.settings.saved": "Navigation visibility saved",
  "navigation.settings.saveFailed": "Could not save navigation visibility",
} as const;

export default navigation;
