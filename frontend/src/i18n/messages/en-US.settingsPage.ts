// SPDX-License-Identifier: Apache-2.0
/** 设置页的页面级文案（与 zh-CN.settingsPage.ts 一一对应）。 */
const settingsPage = {
  "settings.page.title": "Settings",
  "settings.page.subtitle":
    "Configure the model service used by Resume generation, Job analysis and the career assistant",
  "settings.nav.aria": "Settings sections",
  "settings.nav.group.ai": "AI & assistant",
  "settings.nav.group.interface": "Interface & controls",
  "settings.nav.group.data": "Data & app",
  "settings.tab.model": "AI models",
  "settings.tab.assistant": "Assistant behavior",
  "settings.tab.memorySkills": "Memory & skills",
  "settings.tab.voice": "Voice & interviews",
  "settings.tab.appearance": "Appearance & language",
  "settings.tab.interaction": "Interaction habits",
  "settings.tab.data": "Data & storage",
  "settings.tab.backup": "Backup & privacy",
  "settings.tab.about": "Updates & help",
  "settings.search.placeholder": "Search settings",
  "settings.search.empty": "No matching settings",
  // Spoken-word aliases: only for cards whose title lacks the everyday wording
  // (see the rule in settingsIndex.ts).
  "settings.search.alias.model-config": "key base URL endpoint temperature timeout provider",
  "settings.search.alias.model-window": "context window length tokens limit",
  "settings.search.alias.embedding": "vector RAG vector store local model",
  "settings.search.alias.asr": "dictation recognition transcription service",
  "settings.search.alias.interview-voice": "timbre speed pause auto send",
  "settings.search.alias.interview-camera": "webcam recording interview capture",
  "settings.search.alias.datasets": "import export switch dataset",
  "settings.search.alias.storage": "disk size cleanup cache",
  "settings.search.alias.shortcuts": "keyboard key combo keys",
  "settings.search.alias.manual-backup": "snapshot restore backup archive",
  "settings.model.intro":
    "Resume generation, Job analysis and the career assistant share one model configuration across every dataset. Saved configurations appear as record cards; use “New configuration” or “Edit” on a card to fill them in.",
  "settings.model.group.title": "Model & usage",
  "settings.model.group.hint": "Shared across datasets; applies immediately once saved",
  "settings.assistant.intro":
    "What the assistant may search, whether it may relax its rules, how many rounds it may run, which tools it may use, and how much it may do in the floating orb and in web form filling. These affect the assistant only — the model configuration stays as it is.",
  "settings.assistant.group.title": "Assistant capabilities",
  "settings.assistant.group.hint":
    "Affects the assistant and web forms only, never the model configuration",
  "settings.memorySkills.intro":
    "Which job-search facts the assistant remembers, when it creates task cards on its own, and which skills it may read. Memory and skills follow the current dataset.",
  "settings.voice.intro":
    "Transcription service, the timbre and pacing of live calls, and the camera used in interviews. These stay on this machine and do not switch with datasets.",
  "settings.appearance.intro":
    "Interface language, the font used for exported resumes, sidebar entries and the floating orb. These are the settings you look at and click every day, so each change applies immediately.",
  "settings.appearance.group.title": "Language, font and navigation",
  "settings.appearance.group.hint":
    "Switch themes in the header; the three cards below are independent and apply immediately",
  "settings.interaction.intro":
    "Shortcuts, plus the parameters shared by batch generation and batch export. Changes apply immediately.",
  "settings.app.theme.note":
    "Switch themes with the Theme toggle; dark mode covers the app interface and the resume preview (the page turns dark too), while exported PDF / Word files and printing stay on white paper.",
  "settings.data.intro":
    "Jobs, Resumes and Profile content all live in the current dataset, which can be exported as a backup or switched. Storage usage shows how much room that takes.",
  "settings.backup.intro":
    "Automatic backups, manual snapshots and privacy-related behavior. These control how your data is kept and what is never sent out, independently of the current dataset.",
  "settings.about.intro": "Version, updates, diagnostics and reminder behavior of the app itself.",
  "settings.webform.title": "Web form filling",
  "settings.webform.hint": "How much the assistant may do while filling in web forms",
  // Title and extra copy for the language card (label / saveFailed live in core).
  "settings.locale.title": "Interface language",
  "settings.locale.option.zh-CN": "Interface copy, buttons and tips in Simplified Chinese",
  "settings.locale.option.en-US":
    "Interface copy, buttons and tips in English (resume content and export format are unaffected)",
  "settings.locale.autoSaveHint": "Click to apply and save instantly — there is no save button.",
  // Reset-to-default (I-10): card-level button, field-level undo icon and confirm dialog.
  "settings.reset.cardButton": "Reset to defaults",
  "settings.reset.fieldButton": "Reset this setting to its default",
  "settings.reset.title": "Reset to defaults?",
  "settings.reset.intro": "These settings will return to their factory values:",
  "settings.reset.keepSecrets":
    "API keys are never cleared, and saved configuration names stay untouched.",
  "settings.reset.datasetScope":
    "Only the current dataset is affected; other datasets keep their settings.",
  "settings.reset.indexRebuild":
    "Resetting may clear the search index; it has to be rebuilt before searching again.",
  "settings.reset.confirm": "Reset",
  "settings.reset.cancel": "Cancel",
  "settings.reset.nothingToReset": "Already at the default value",
  "settings.reset.success": "Reset {count} settings to their defaults",
  "settings.reset.failed": "Could not reset: {message}",
  "settings.reset.value.on": "On",
  "settings.reset.value.off": "Off",
  "settings.reset.value.empty": "(empty)",
  "settings.reset.key.llm_config": "Model parameters",
  "settings.reset.key.assistant_compaction_model": "Compaction model",
  "settings.reset.key.assistant_compaction_mask_percent": "Compaction threshold",
  "settings.reset.key.assistant_compaction_summary_percent": "Summary threshold",
  "settings.reset.key.asr_config": "Transcription endpoint and model",
  "settings.reset.key.assistant_permission": "Assistant permission level",
  "settings.reset.key.assistant_relaxed_mode": "Assistant relaxed mode",
  "settings.reset.key.assistant_max_tool_rounds": "Tool round limit",
  "settings.reset.key.assistant_stream_budget_seconds": "Whole-run time budget",
  "settings.reset.key.assistant_tool_result_max_chars": "Single tool result limit",
  "settings.reset.key.assistant_memory_auto_extract": "Automatic memory capture",
  "settings.reset.key.agent_task_events_enabled": "Task cards from due reminders",
  "settings.reset.key.webform_relaxed_mode": "Web form relaxed mode",
  "settings.reset.key.reminder_popup_on_start": "Reminder popup on start",
  "settings.reset.key.editor_inline_format_preview": "Preview inline formatting",
  "settings.reset.key.assistant_orb_enabled": "Floating assistant orb",
  "settings.reset.key.navigation_visibility": "Sidebar entries",
  "settings.reset.key.apply_blocklist": "Application blocklist",
  "settings.reset.key.apply_greeting_templates": "Greeting templates",
  "settings.reset.key.analytics_weekly_goal": "Weekly application goal",
  "settings.reset.key.tracker_probe_enabled": "Automatic status read-back",
  "settings.reset.key.tracker_probe_page_url": "Application records page",
  "settings.reset.key.export_save_location": "Export save location",
  "settings.reset.key.auto_backup_interval_days": "Automatic backup interval",
  "settings.reset.key.batch_operation_config": "Batch operation parameters",
} as const;

export default settingsPage;
