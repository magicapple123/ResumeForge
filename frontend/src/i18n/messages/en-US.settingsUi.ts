// SPDX-License-Identifier: Apache-2.0
/**
 * Settings page cards that are not the software update card: the Toutou orb,
 * the assistant and Web form relaxed modes, the export save location, help and
 * diagnostics, privacy, reminders and the read-only assistant skills summary.
 *
 * The software update card keeps using `update.*` (see en-US.update.ts).
 */
const settingsUi = {
  // ── Shared switch labels ────────────────────────────────────
  "settingsUi.switch.on": "On",
  "settingsUi.switch.off": "Off",
  "settingsUi.switch.defaultOnHint": "On by default; you can turn it off here at any time.",

  // ── Toutou orb card ─────────────────────────────────────────
  "settingsUi.orb.title": "Toutou orb",
  "settingsUi.orb.intro":
    "Keeps a lightweight Job assistant entry on every page. Click it to open the assistant; when left alone it tucks itself against the edge and never covers the main content.",
  "settingsUi.orb.enableAria": "Turn on the Toutou orb",
  "settingsUi.orb.enableToast": "Toutou orb turned on",
  "settingsUi.orb.disableToast": "Toutou orb turned off",
  "settingsUi.orb.tipsAria": "Turn on Toutou tips",
  "settingsUi.orb.tipsOnToast": "Toutou will keep showing tips",
  "settingsUi.orb.tipsOffToast": "Toutou will no longer show tips",
  "settingsUi.orb.tipsHint":
    "When off, the orb stops showing tips and no longer suggests improving your Profile on the My Profile page; everything else keeps working.",
  "settingsUi.orb.loadFailed": "Could not load the Toutou orb setting",
  "settingsUi.orb.saveFailed": "Could not save the Toutou orb setting",

  // ── Assistant relaxed mode card ─────────────────────────────
  "settingsUi.assistantRelaxed.title": "Job assistant · Relaxed mode",
  "settingsUi.assistantRelaxed.intro":
    "Off by default: the assistant reads a redacted Profile without name, phone or other identity fields, and has no Web form values or conversation history tools.",
  "settingsUi.assistantRelaxed.toggleAria": "Job assistant relaxed mode",
  "settingsUi.assistantRelaxed.enableToast":
    "Relaxed mode on: the assistant can now read your full Profile, sensitive information included",
  "settingsUi.assistantRelaxed.disableToast":
    "Off: the assistant is back to the default redacted view and sensitive tools are withdrawn",
  "settingsUi.assistantRelaxed.saveFailed": "Could not save the assistant relaxed mode setting",
  "settingsUi.assistantRelaxed.stateOn":
    "On: the assistant can read your full Profile — name, phone, email and other identity fields, the real values typed into Web form fields, and your conversation history; all of it is sent to the model provider you configured along with your question. Turn this on only on your own device.",
  "settingsUi.assistantRelaxed.stateOff":
    "Before you turn this on: once on, the assistant can read your full Profile (name, phone and other sensitive information), the real values typed into Web form fields, and your conversation history; all of it is sent to the model provider you configured along with your question.",
  "settingsUi.assistantRelaxed.neverSent":
    "Never sent in any mode: credentials such as the API key or the global configuration, or the image content of Resume photos; the assistant also never has delete tools.",

  // ── Export save location card ───────────────────────────────
  "settingsUi.exportSave.title": "Generated content save location",
  "settingsUi.exportSave.intro":
    "Saved to the browser's default download folder by default; once you pick a folder from the local frontend, exports are also saved there.",
  "settingsUi.exportSave.browse": "Choose folder",
  "settingsUi.exportSave.reset": "Restore default",
  "settingsUi.exportSave.current": "Current: {path}",
  "settingsUi.exportSave.defaultPath": "Default (browser download folder)",
  "settingsUi.exportSave.footnote":
    "If a file with the same name already exists, a timestamp suffix is added instead of overwriting it; a failed write does not affect the normal download.",
  "settingsUi.exportSave.loadFailed": "Could not load the export save location",
  "settingsUi.exportSave.resetDone": "Restored the default: browser download only",
  "settingsUi.exportSave.saveFailed": "Could not save the export save location",
  "settingsUi.exportSave.cancelled": "Selection cancelled",
  "settingsUi.exportSave.picked":
    "Saved: exports from the local frontend will also be stored in {path}",
  "settingsUi.exportSave.pickerFailed": "Could not open the folder picker; try again",

  // ── Help and diagnostics card ───────────────────────────────
  "settingsUi.help.title": "Help and diagnostics",
  "settingsUi.help.introLead":
    "If something goes wrong, export a diagnostics bundle first: it contains only redacted runtime events, system information and recent logs, ",
  "settingsUi.help.introNoResume": "never your Resume data or keys",
  "settingsUi.help.introTail":
    ". Send it along with a description of the problem and we can skip most of the back-and-forth.",
  "settingsUi.help.export": "Export diagnostics",
  "settingsUi.help.exported": "Diagnostics bundle exported; it contains no Resume data or keys",
  "settingsUi.help.exportFailed": "Could not export the diagnostics bundle",
  "settingsUi.help.previewSummary": "About {count} redacted events in the bundle{files}. {note}",
  "settingsUi.help.previewFiles": " ({files})",
  "settingsUi.help.previewSeparator": ", ",
  "settingsUi.help.feedbackLead": "Feedback: ",
  "settingsUi.help.feedbackJoin": " or join our user group ",
  "settingsUi.help.feedbackTail": " (we can help right there).",

  // ── Privacy and data ownership card ─────────────────────────
  "settingsUi.privacy.title": "Privacy and data ownership",
  "settingsUi.privacy.localLead":
    "Your Resumes, Jobs, Profile and reminders all live in a data directory ",
  "settingsUi.privacy.localStrong": "on this machine",
  "settingsUi.privacy.localTail":
    " (an SQLite database). There are no accounts and no analytics, and no Resume data is ever uploaded to any server.",
  "settingsUi.privacy.ai":
    "AI features send only what a task needs to the model provider you configured, and only when you invoke them; the provider key stays on this machine (encrypted with system-level DPAPI on Windows). The diagnostics bundle (see Help and diagnostics under the App tab) contains only redacted runtime events and the tail of the log, never Resume data or keys.",
  "settingsUi.privacy.exportStrong": "Take your data: ",
  "settingsUi.privacy.exportBody":
    "the Datasets card's Export menu has Export all datasets, which packs everything into a .zip — the database, referenced attachments, custom fonts and the global model configuration; if the data directory holds top-level items that neither entered the bundle nor count as rebuildable output, the export explicitly says “N other items were not included in the backup”.",
  "settingsUi.privacy.deleteStrong": "Delete for good: ",
  "settingsUi.privacy.deleteBody":
    "deleting the dataset is enough; to wipe everything, quit the app and then delete the data directory (backend/data) — uninstalling leaves nothing behind.",

  // ── Reminders and sounds card ───────────────────────────────
  "settingsUi.reminderPopup.title": "Reminders and sounds",
  "settingsUi.reminderPopup.intro":
    "When the app opens, whether to pop up a list of recent reminders if any calendar reminders are still open.",
  "settingsUi.reminderPopup.toggleAria": "Show reminders when the app opens",
  "settingsUi.reminderPopup.enableToast": "On: recent reminders pop up when you open the app",
  "settingsUi.reminderPopup.disableToast": "Off: no reminder popup when you open the app",
  "settingsUi.reminderPopup.loadFailed": "Could not load the reminder popup setting",
  "settingsUi.reminderPopup.saveFailed": "Could not save the reminder popup setting",
  "settingsUi.reminderPopup.soundIntro":
    "Whether to play a chime when generation tasks (Resume generation, Job analysis, match analysis and so on) and apply / collect batches **finish**. Popup reminders are not affected by this switch.",
  "settingsUi.reminderPopup.soundAria": "Play a chime when a task finishes",
  "settingsUi.reminderPopup.soundHint":
    "On by default. If the browser blocks autoplay, the sound is skipped silently.",

  // ── Assistant skills summary card (read only) ───────────────
  "settingsUi.skills.title": "Assistant skills",
  "settingsUi.skills.introLead": "A skill is a ",
  "settingsUi.skills.introPrompt": "prompt",
  "settingsUi.skills.introMiddle": ", or bundled with ",
  "settingsUi.skills.introKnowledge": "knowledge files",
  "settingsUi.skills.introTail":
    " (.md / .txt). Enabled skills tell the assistant how to answer, while knowledge files are read on demand instead of being stuffed into the conversation. To create a skill or fine-tune one, ",
  "settingsUi.skills.manageLink": "manage them in the workbench",
  "settingsUi.skills.manageTail": ".",
  "settingsUi.skills.empty": "No skills yet",
  "settingsUi.skills.tagEnabled": "Enabled",
  "settingsUi.skills.tagDisabled": "Disabled",
  "settingsUi.skills.files": "{count} knowledge files",
  "settingsUi.skills.promptOnly": "Prompt only",
  "settingsUi.skills.noDescription": "No use case described",
  "settingsUi.skills.promptChars": "{count} characters of prompt",
  "settingsUi.skills.updatedAt": "Updated {date}",

  // ── Web form relaxed mode card ──────────────────────────────
  "settingsUi.webFormRelaxed.title": "Web form · Relaxed mode",
  "settingsUi.webFormRelaxed.intro":
    "Off by default: Web form filling only fills, never clicks; dropdowns, checkboxes and dates still need your own click on the page.",
  "settingsUi.webFormRelaxed.toggleAria": "Web form relaxed mode",
  "settingsUi.webFormRelaxed.enableToast": "Relaxed mode on",
  "settingsUi.webFormRelaxed.disableToast": "Off: back to fill-only, the default boundary",
  "settingsUi.webFormRelaxed.saveFailed": "Could not save the relaxed mode setting",
  "settingsUi.webFormRelaxed.warning":
    "Once on, the program tries to click dropdown and popup options for you and to tick the declaration items you confirmed one by one; something can be picked wrong, so check the form afterwards. Date pickers and file uploads are still left to you.",
} as const;

export default settingsUi;
