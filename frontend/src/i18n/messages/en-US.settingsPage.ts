// SPDX-License-Identifier: Apache-2.0
/** 设置页的页面级文案（与 zh-CN.settingsPage.ts 一一对应）。 */
const settingsPage = {
  "settings.page.title": "Settings",
  "settings.page.subtitle":
    "Configure the model service used by Resume generation, Job analysis and the career assistant",
  "settings.tab.model": "AI models",
  "settings.tab.data": "Data",
  "settings.tab.app": "App",
  "settings.model.intro":
    "Resume generation, Job analysis and the career assistant share one model configuration across every dataset. Saved configurations appear as record cards; use “New configuration” or “Edit” on a card to fill them in.",
  "settings.model.group.title": "Model API configuration (shared across all datasets)",
  "settings.model.group.hint":
    "Changes apply to every dataset once saved; a record card can be switched to In use at any time",
  "settings.assistant.group.title": "Assistant capabilities",
  "settings.assistant.group.hint": "What the assistant can search, do and read",
  "settings.data.intro":
    "Jobs, Resumes and Profile content all live in the current dataset, which can be exported as a backup or switched.",
  "settings.app.intro": "Version, update and reminder behaviour of the app itself.",
  "settings.app.ui.title": "Interface and reminders",
  "settings.app.ui.hint": "Navigation entries, shortcuts, the floating orb and recent reminders",
  "settings.app.theme.note":
    "Switch themes with the Theme toggle; dark mode affects the app interface only — Resume preview, exported PDF and printing stay on white paper.",
  "settings.webform.title": "Web form filling",
  "settings.webform.hint": "How much the assistant may do while filling in web forms",
  "settings.help.title": "Updates and help",
  "settings.help.hint": "Version updates, diagnostics and feedback",
} as const;

export default settingsPage;
