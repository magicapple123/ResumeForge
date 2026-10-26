// SPDX-License-Identifier: Apache-2.0
const fonts = {
  "fonts.card.description":
    "Used for preview, HTML and PDF. The selected font takes effect immediately in the preview and is also used in exported HTML and PDF. Settings and list pages continue to use the system font.",
  "fonts.card.empty": "No other fonts imported yet.",
  "fonts.card.delete-body":
    "The font file will be deleted directly, with no restore option in the app. Resumes using it will revert to the system font.",
  "fonts.card.active-tag": "Current font",
  "fonts.card.active-hint": "Used in previews and exports",
  "fonts.card.reset-hint":
    "Clearing the selection restores the local system font (Microsoft YaHei on Windows / PingFang on macOS). Downloaded font files remain on disk.",
  "fonts.builtin.name": "Source Han Sans",
  "fonts.builtin.approx-size": "About {size}",
  "fonts.builtin.download": "Download",
  "fonts.builtin.download-aria": "Download Source Han Sans (about {size})",
  "fonts.builtin.source-tooltip":
    "Downloaded online without increasing the installer size. Published by Adobe under the SIL Open Font License 1.1, free for personal and commercial documents",
  "fonts.builtin.downloading-with-total": "Downloading... {done} / {total}",
  "fonts.builtin.downloading": "Downloading... {done}",
  "fonts.builtin.failed": "Could not download Source Han Sans: {error}. Select Retry to try again.",
  "fonts.builtin.failed-unknown": "Could not download Source Han Sans. Select Retry to try again.",
  "fonts.builtin.retry": "Retry",
  "fonts.builtin.downloaded": "Downloaded",
  "fonts.builtin.activate": "Use this font",
  "fonts.builtin.activate-success": "Source Han Sans downloaded and set as the current font",
  "fonts.builtin.activate-ok": "Source Han Sans is now the current font",
  "fonts.builtin.download-success":
    "Source Han Sans downloaded; select Use this font to apply it to previews and exports",
  "fonts.builtin.activate-failed": "Could not set the current font; try again",
  "fonts.control.undownloaded": "{name} (not downloaded)",
  "fonts.control.download-hint": "Download in Settings > App > Resume fonts",
  "fonts.control.empty":
    "No fonts available yet. Download Source Han Sans in Settings > App > Resume fonts",
  "skills.tab.layout": "Layout presets",
  "skills.page.subtitle":
    "Skills control how the assistant responds; layout presets control Resume typography. Manage both here.",
  "layout.intro.title": "Using layout presets",
  "layout.intro.body":
    "Layout presets control Resume density through line height, margins, Section spacing and accent color. Adjust settings without writing code. Templates control the visual structure, and you can switch built-in templates at any time.",
  "layout.intro.howto":
    "To fit one page, use Create layout preset to adjust line height and margins. You can switch templates and layout presets during generation and preview without regenerating the content.",
} as const;

export default fonts;
