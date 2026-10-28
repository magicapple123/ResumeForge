// SPDX-License-Identifier: Apache-2.0
/** Usage guide copy (continued): resume / assistant / data backup / quick start / modal chrome — split out of the userGuide pack on 2026-10-28. */
/**
 * User guide: the title, intro, points and action button of each of the eight steps, plus the
 * first-launch “Quick start” cards and the dialog's own buttons.
 *
 * The data files (components/user-guide/*.ts, quickStartPaths.ts) only hold `userGuide.*` keys.
 * The `**emphasis**` markers are kept as written — `UserGuideModal` renders them as bold — and
 * names of on-screen controls are quoted with “ ” to match how the UI labels them.
 */
const userGuideFlow = {
  // ── Step 1 · Build a Resume (resumeSteps.ts) ──
  "userGuideFlow.resume.step1.title": "Build a Resume",
  "userGuideFlow.resume.step1.heading": "Generate for a Job, or write a general one",
  "userGuideFlow.resume.step1.description":
    "Enter the Resume flow from a Job, preview it, change just the spot you clicked or rewrite broadly with “Manual editing”, then keep a history record and export.",
  "userGuideFlow.resume.step1.point1.lead": "Three ways in",
  "userGuideFlow.resume.step1.point1.text":
    "“AI generate” in this page's header is not tied to a Job and produces a general Resume (it takes the sections in the Current Plan, without filtering by direction); “New Resume” is the hand-written entry pre-filled from the Current Plan, and its tabs show only that Plan's sections; AI generation entered from a Job detail filters the Profile by that Job and lets you choose how much polish to apply.",
  "userGuideFlow.resume.step1.point2.lead": "Long CV",
  "userGuideFlow.resume.step1.point2.text":
    "“Document mode” in the generate dialog offers “Standard Resume” (1–3 pages) or “Long CV” (up to 10). Long CV is only an explicitly chosen page strategy — it never switches on its own; going over the limit is reported honestly, without shrinking the font.",
  "userGuideFlow.resume.step1.point3.lead": "For this generation",
  "userGuideFlow.resume.step1.point3.text":
    "“Career scenario (for this generation)” in the generate dialog is off by default; once you turn it on and pick a scenario, the server sends only the allowed dimensions of expression and freezes a snapshot (no name or contact details; employment status is not sent by default). With it off, the request is exactly the same as in older versions.",
  "userGuideFlow.resume.step1.point4.lead": "General Resume",
  "userGuideFlow.resume.step1.point4.text":
    "For when the direction is not settled yet: it is not tied to a Job — the entry is “New Resume” in this page's header (titled “Write a general Resume from scratch”), pre-filled from the Current Plan; tabs, tab names and visible fields are frozen from the Plan at creation, so later Plan changes do not affect this Resume. Another window changing the Profile or switching Plan refreshes it automatically; unsaved changes trigger a keep-or-overwrite question first. Saving writes only this Resume and leaves the Profile alone.",
  "userGuideFlow.resume.step1.point5.lead": "Fill from the Profile",
  "userGuideFlow.resume.step1.point5.text":
    "When writing a Resume yourself, every entry has “Fill this entry from Profile”: pick one and click “Fill” to fill only the empty fields of the current entry; candidates already used in another entry are marked “In another entry”, the entry itself is marked “This entry”, and both are disabled — nothing is duplicated or overwritten. Candidates follow the Current Plan and refresh after Profile changes or a Plan switch.",
  "userGuideFlow.resume.step1.point6.lead": "Generation runs in the background",
  "userGuideFlow.resume.step1.point6.text":
    "The dialog shows a stage bar — “Organize material → Select material → Call the model → Validate and repair → Done” — and a live “N characters received” count. There is no percentage, because the model emits text token by token and the total length is unknown.",
  "userGuideFlow.resume.step1.point7.lead": "You can close the dialog",
  "userGuideFlow.resume.step1.point7.text":
    "Close it while generating and the task continues in the background; when it finishes a “Resume generated” notification opens the result directly. Only “Cancel generation” really stops it, and a cancelled run saves no half-finished output.",
  "userGuideFlow.resume.step1.point8.lead": "Length and font size",
  "userGuideFlow.resume.step1.point8.text":
    "Before generating you can pick a maximum length (1–3 A4 pages) and a font size (5–18px in 0.1px steps; below 8px you are warned it may not print legibly), defaulting to one page at the standard size; “Font” next to it picks a downloaded or imported font for this Resume (the built-in Source Han Sans must be downloaded in Settings first).",
  "userGuideFlow.resume.step1.point9.lead": "Resume language",
  "userGuideFlow.resume.step1.point9.text":
    "Before exporting, “Resume language” in the typography settings changes only section headings and field names (such as Education / Skills) — it never translates what you wrote.",
  "userGuideFlow.resume.step1.point10.lead": "Layout diagnosis",
  "userGuideFlow.resume.step1.point10.text":
    "Above the preview you see what percentage of the page the body **takes up**, plus the order in which to fix things; for a multi-page Resume, check whether the last page is too empty.",
  "userGuideFlow.resume.step1.point11.lead": "Fit to one page",
  "userGuideFlow.resume.step1.point11.text":
    "The button only appears when the content does not fit: it tightens step by step — “page margins → block spacing → line height → font size” — and **stops as soon as it fits**, never shrinking the text to the minimum in one go.",
  "userGuideFlow.resume.step1.point12.lead": "How small it goes",
  "userGuideFlow.resume.step1.point12.text":
    "**Fit to one page** shrinks the font to 11px at most (the slider can go smaller, down to 5px); if the typography settings are already at their tightest and it still does not fit, it says so instead of pretending to succeed.",
  "userGuideFlow.resume.step1.point13.lead": "Research Resume",
  "userGuideFlow.resume.step1.point13.text":
    "The middle column of the Workbench has Academic output, Research projects and Intellectual property: title, author order and your own marker, publication status (under review is never written as published), DOI / link. “Document mode” in the settings column switches to “Long CV” (up to 10 pages; a standard Resume is 1–3).",
  "userGuideFlow.resume.step1.point14.lead": "Languages are their own section",
  "userGuideFlow.resume.step1.point14.text":
    "Languages are a separate section in the Resume (the Workbench's left column has its own “Languages” tab too), shown per language (level · certificate · score) with the date obtained as a trailing note, no longer folded into Skills; if the model omits it, the backend restores it from the Profile.",
  "userGuideFlow.resume.step1.point15.lead": "Layout optimization",
  "userGuideFlow.resume.step1.point15.text":
    "Below the “Layout diagnosis” card in the preview you can optimize by condition: first set “keep font size / minimum page margin / target length”, then review up to 3 candidate plans (which parameters changed, how much overflow was removed, readability impact); “Apply this plan” writes the values back into the sliders and never quietly shrinks the font.",
  "userGuideFlow.resume.step1.point16.lead": "Content trims",
  "userGuideFlow.resume.step1.point16.text":
    "Besides tightening typography, layout optimization offers content-level candidates: merge duplicate entries, delete duplicate bullets, merge short bullets, and trim low-relevance bullets when there is a Job signal; each candidate lists its changes, you review the diff and only confirm writes it (undoable), and when there is no plan it explains why.",
  "userGuideFlow.resume.step1.point17.lead": "Source and fact lock",
  "userGuideFlow.resume.step1.point17.text":
    "“Source” in the Workbench's left column shows which Profile entry the selected content came from and, when linked, which version; it does not guess when unlinked. You can create links (including manual sources) and, after the source updates, confirm to write the update back. The fact lock pins key facts: AI rewrites are rejected with the values listed, while manual editing is unrestricted.",
  "userGuideFlow.resume.step1.point18.lead": "Outbound preview and usage",
  "userGuideFlow.resume.step1.point18.text":
    "Settings shows “Preview before sending” (what goes out this time: target service, material categories, attachments, excluded fields and the text) and “Model usage” (calls and tokens per task / model; unknown tokens are not counted as 0); the preview text lives in memory only and never touches disk.",
  "userGuideFlow.resume.step1.point19.lead": "Document outline",
  "userGuideFlow.resume.step1.point19.text":
    "“Document outline” in the Workbench's left column lists entries and bullets by section: reorder, copy, hide, lock content or lock typography; the top can search the outline and restore scrolling from a position on the page, and bullets can be hidden or copied individually; hidden content goes into no export. During drag reordering the outline tree and the preview follow live (also when the screen is narrow and editing is folded into a drawer, and the change counts as unsaved edits), and a history step is recorded only on release; entry and bullet handles look different.",
  "userGuideFlow.resume.step1.point20.lead": "Save conflicts",
  "userGuideFlow.resume.step1.point20.text":
    "When saving in the “Resume Workbench”, if the same Resume has been changed in another window you are first asked to choose “use the newest / compare differences / save a copy” — it **never overwrites** someone else's changes.",
  "userGuideFlow.resume.step1.point21.lead": "Check Resume",
  "userGuideFlow.resume.step1.point21.text":
    "“Check Resume” in the Workbench action bar checks content, typography and the export output on three levels, grades problems and offers a way to fix each, and can re-check afterwards; it also checks key links and export redaction, and verifies before export against the same snapshot digest the server uses.",
  "userGuideFlow.resume.step1.point22.lead": "Pro view",
  "userGuideFlow.resume.step1.point22.text":
    "The canvas toolbar offers full page / fit width / 100% zoom, paging, guides and a grayscale proof; “Commands” or Cmd/Ctrl+Shift+P opens the command palette, and workspace presets only toggle panel visibility; “Photo crop” changes framing only — the original is untouched and can be restored, and the parameters are saved with this Resume; an uncropped photo keeps its aspect ratio instead of being forced into a square.",
  "userGuideFlow.resume.step1.point23.lead": "Undo and redo",
  "userGuideFlow.resume.step1.point23.text":
    "“History” in the Workbench's left column undoes or redoes step by step: content, typography and structural actions each record a step (consecutive typing is merged into one); clicking a step shows the summary at that point, and the actual rollback is “Undo”.",
  "userGuideFlow.resume.step1.point24.lead": "Local typography",
  "userGuideFlow.resume.step1.point24.text":
    "“Local typography” in the Workbench's left column fine-tunes font size, color, line height and indentation for six paragraph kinds; properties you never set follow the template and can each be reset to inherit again. With content selected you can apply one of five fixed text levels (“Heading 1 / Heading 2 / Heading 3 / Body / Secondary note”, multi-select supported, restoring inheritance supported); outline entries can be multi-selected and applied in bulk, the format painter copies one entry's typography to another, and selected body text can use the italic and link buttons.",
  "userGuideFlow.resume.step1.point25.lead": "Pagination",
  "userGuideFlow.resume.step1.point25.text":
    "“Pagination” in the Workbench's left column can set “start on a new page” per section and repeat name and page number on continuation pages; page thumbnails show the real page count and how full the last page is, and PDF/Word avoid orphaned headings or bullets; drafts do not show real pagination, so switch to Exact or check on export. The section pagination mode can be switched for the whole Resume between natural flow and a new page per section; inserted breaks are visible and can be reset to natural pagination in one click.",
  "userGuideFlow.resume.step1.point26.lead": "Expression library",
  "userGuideFlow.resume.step1.point26.text":
    "“Expression library” in the Workbench's left column keeps reusable wording, searchable by keyword / type / language / Job tag; select where to insert and insert in one click (it creates a new object); deleting it moves it to Trash with an undo in the Toast.",
  "userGuideFlow.resume.step1.point27.lead": "Named versions",
  "userGuideFlow.resume.step1.point27.text":
    "“Versions” at the top of the Workbench saves immutable named versions: freeze, compare, restore — restoring creates a new current version while history and applied records stay unchanged. “Job variants” are edited independently with optional path syncing; a variant can also keep its own typography and be exported as a variant. To adjust expression for a career scenario, derive a scenario variant on the “Job variants” page first, then generate candidates, review the differences and adopt — the source Resume is never rewritten.",
  "userGuideFlow.resume.step1.point28.lead": "Bilingual versions",
  "userGuideFlow.resume.step1.point28.text":
    "“Bilingual versions” in the Workbench's left column translates the body: compare the two columns, click “Generate translation candidates”, tick “Adopt selected” item by item and only that language variant is written — the current Resume stays as it is; fixed renderings such as names and companies go into the “Glossary” first (dataset-wide, lockable), and deleting them moves them to Trash where they can be restored. Generation waits for the whole Resume to be translated (usually tens of seconds) — do not click again while waiting.",
  "userGuideFlow.resume.step1.point29.lead": "Rewrite a passage",
  "userGuideFlow.resume.step1.point29.text":
    "In “Manual editing”, **select the text to change → right-click → “AI polish”**: write the instruction → generate → the result is shown first, and only “Replace selection” writes it back; only the selected passage is sent to the model. Close it if you do not like the result — the original text stays untouched.",
  "userGuideFlow.resume.step1.point30.lead": "You are told when it's done",
  "userGuideFlow.resume.step1.point30.text":
    "Tasks that wait on a model — Resume generation, Job reading, match analysis, Job improvement suggestions — explain themselves before starting and offer “Continue in background” while running, so closing the window still finishes (suggestions can be cancelled at any time); at the end **a dialog and a chime** tell you (the sound can be turned off in Settings → Reminders and sounds).",
  "userGuideFlow.resume.step1.point31.lead": "Writing boost",
  "userGuideFlow.resume.step1.point31.text":
    "While editing a Resume, **select a passage → right-click → “Writing boost”**: STAR quantification, a phrasing generator (Resume / STAR / spoken versions), multi-style polishing and Chinese-English translation. The result **writes back into the passage you selected** (where right-clicking lands on a non-editable spot the action becomes “Copy”); you can also compare any two Resumes with “Version comparison” (purely local, no model call).",
  "userGuideFlow.resume.step1.point32.lead": "Polish the selection",
  "userGuideFlow.resume.step1.point32.text":
    "Right-click after selecting text: the menu offers cut / copy / paste / select all; inside an input, text area or editable region it also offers “Writing boost” and “AI polish”. Write one instruction → review the result → click “Replace selection” to write it back; only the selected passage is sent, never the whole Resume.",
  "userGuideFlow.resume.step1.point33.lead": "Zoom the preview",
  "userGuideFlow.resume.step1.point33.text":
    "Hold **Ctrl** (**Cmd** on macOS) and scroll the wheel to zoom the preview; the toolbar also has zoom in / zoom out / fit page. The “Resume Workbench” below the preview puts parameters, content editing and layout on one screen; **separate page margins exist only in the Workbench** — the “adjust each side separately” switch is gone from both the pre-generation settings page and the preview toolbar. Column width can be dragged and reset in one click.",
  "userGuideFlow.resume.step1.point34.lead": "Exact preview",
  "userGuideFlow.resume.step1.point34.text":
    "The “Draft / Exact” switch on the first toolbar row: **Draft** is browser-side live layout — a change shows immediately and elements are clickable; **Exact** shows the PDF the server laid out with the export engine, identical to what “Export” downloads, and its page count is what you get.",
  "userGuideFlow.resume.step1.point35.lead": "Quality check",
  "userGuideFlow.resume.step1.point35.text":
    "“Quality check” runs only after you click “Start scan”: repetition, sensitive words, exaggeration risk, deep-dive risk points, compliance and local ATS checks; a scan can be cancelled, and closing the window still finishes it in the background with a notification. ATS reports sub-scores, coverage and item-by-item advice, and when a Job is linked it loads the JD on open (fills it only; no check runs).",
  "userGuideFlow.resume.step1.point36.lead": "Templates",
  "userGuideFlow.resume.step1.point36.text":
    "The five templates also have layout presets that only change parameters, switchable before generating and in the preview; click a thumbnail in the template overview for a large image; “Try and compare” puts your current content side by side under two templates (showing real page counts and overflow) and takes effect only after you adopt one. The same toolbar reorders sections and can force line breaks for contact details (each field stays whole, so long URLs are not cut). Technical / editorial / columns no longer appear.",
  "userGuideFlow.resume.step1.point37.lead": "Export formats",
  "userGuideFlow.resume.step1.point37.text":
    "PDF downloads directly (generated by the server), and browser printing works too (layout matches the preview); Word, plain text, Markdown and JSON are also available.",
  "userGuideFlow.resume.step1.point38.lead": "Watermark and redaction",
  "userGuideFlow.resume.step1.point38.text":
    "When exporting you can add a custom watermark (**HTML / PDF / Word only** — plain text, Markdown and JSON do not support it, and ticking both together is an error), or run one-click privacy redaction (name / phone / email / company / school and so on).",
  "userGuideFlow.resume.step1.point39.lead": "Delivery package",
  "userGuideFlow.resume.step1.point39.text":
    "The export dialog of a saved Resume can store export settings (format, naming rule, watermark/redaction), and watermark/redaction can be previewed on the real PDF first; you can also export a zip of several files (hashed item by item) and optionally archive the delivered originals (hashes plus font/render version list).",
  "userGuideFlow.resume.step1.point40.lead": "Sharing",
  "userGuideFlow.resume.step1.point40.text":
    "Use an “Offline share package”: redacted HTML/PDF + a read-only snapshot + a comment return file, either read-only or commentable. A commentable package shows “Object annotations” in its details afterwards: import the annotations.json a reviewer returns and “Mark resolved” or “Ignore this one” item by item; annotations on a changed object must be “Re-link”ed and never attach themselves to a different entry — annotations live only in the share package and never enter the Resume you apply with.",
  "userGuideFlow.resume.step1.point41.lead": "Over the page limit",
  "userGuideFlow.resume.step1.point41.text":
    "The draft preview stacks multiple pages **as a few A4 sheets** (approximate pagination cut at A4 height) and says roughly how many pages are needed and how much overflows; for real pagination switch to “Exact” — the same PDF the export engine produced.",
  "userGuideFlow.resume.step1.point42.lead": "After saving",
  "userGuideFlow.resume.step1.point42.text":
    "You can look back at the linked Job, and add a **note** to each Resume to mark its purpose; the list can also filter by **Job** (the address carries `?job_id=`, so a bookmark goes straight there).",
  "userGuideFlow.resume.step1.point43.lead": "Delivery archive",
  "userGuideFlow.resume.step1.point43.text":
    "Each delivery record can **download its archive**; “Delivery archive” in the Resume center can also find historical records by title, company and source after the original Resume is deleted. Files are regenerated from the frozen content and parameters, so they may differ slightly — the UI says so and shows a historical fingerprint.",
  "userGuideFlow.resume.step1.point44.lead": "Batch selection",
  "userGuideFlow.resume.step1.point44.text":
    "**Right-click** an item in lists such as the Resume center, Candidate Jobs, assistant conversations or messages, past interviews, deep dives, reminders, question banks, fill records, knowledge base, material library, Fact ledger, interview experiences, referrals and Apply record details, and choose “Batch select” to multi-select; one confirmation deletes them all (they go to Trash and can be restored).",
  "userGuideFlow.resume.step1.actionLabel": "Open the Resume center",
  // ── Step 1 · Job assistant (assistantSteps.ts) ──
  "userGuideFlow.assistant.step1.title": "Job assistant",
  "userGuideFlow.assistant.step1.heading": "Let the assistant work on your data",
  "userGuideFlow.assistant.step1.description":
    "Ask it anything about the project, and let it change data directly after telling you exactly what it will do; on any other page, click the Toutou floating ball to open it, or **double-click** it to open the “Toutou clipboard” for snippets you paste often.",
  "userGuideFlow.assistant.step1.point1.lead": "What it can look up",
  "userGuideFlow.assistant.step1.point1.text":
    "Besides Jobs, Candidate Jobs, the material library, Resume layout presets and the Profile, it can read reminders, referrals, interview experiences, question-bank history, retrospective history, the knowledge base, job-search statistics and share packages; it can also summarize the failure reasons in Apply records to help you diagnose them.",
  "userGuideFlow.assistant.step1.point2.lead": "What it can change",
  "userGuideFlow.assistant.step1.point2.text":
    "It can **add and edit knowledge-base entries, record a reminder, and create or update tracker records**, and also enter interview experiences and referrals, mark reminders done, and favorite or annotate Resumes; structured entries (education / work / projects / skills / awards) can only be **appended**.",
  "userGuideFlow.assistant.step1.point3.lead": "Time awareness",
  "userGuideFlow.assistant.step1.point3.text":
    "Before answering it is given the local date, time and weekday; ask late at night and it first suggests you get some rest.",
  "userGuideFlow.assistant.step1.point4.lead": "It never deletes for you",
  "userGuideFlow.assistant.step1.point4.text":
    "**But it will not delete any of your data**: there are no delete tools, so deleting is something you do yourself on the matching page or in Trash.",
  "userGuideFlow.assistant.step1.point5.lead": "It checks first",
  "userGuideFlow.assistant.step1.point5.text":
    "Conclusions about your data (“how many Jobs / reminders / referrals do I have”) are checked with tools before answering, never guessed; it writes only when you explicitly ask.",
  "userGuideFlow.assistant.step1.point6.lead": "Visible at a glance",
  "userGuideFlow.assistant.step1.point6.text":
    "Every change is recorded under “What the assistant did” in the reply, with the title **stating “changed N items” or “N items failed”** so you know without expanding it.",
  "userGuideFlow.assistant.step1.point7.lead": "What it reads",
  "userGuideFlow.assistant.step1.point7.text":
    "It **automatically includes the Profile from the current dataset**, but strips name, phone, email and photo before sending to the model; Jobs and Resumes are still linked only when you ask.",
  "userGuideFlow.assistant.step1.point8.lead": "Ask with an image",
  "userGuideFlow.assistant.step1.point8.text":
    "You can **paste a screenshot straight into the input** (Ctrl+V) or click “Attachment” to pick a file (up to 4, each ≤ 2 MB); after the question with the image, the image is carried once more in the very next message and not again after that. The floating-ball card works the same way.",
  "userGuideFlow.assistant.step1.point9.lead": "Web search",
  "userGuideFlow.assistant.step1.point9.text":
    "When on, the assistant searches once automatically and can search again with different keywords (at most 3 searches per turn); sources are collected under “Sources (N)” below the answer, and clicking a title opens the original page.",
  "userGuideFlow.assistant.step1.point10.lead": "Skills switch",
  "userGuideFlow.assistant.step1.point10.text":
    "The “Skills” button in the toolbar under the input turns enabled skills on and off directly.",
  "userGuideFlow.assistant.step1.point11.lead": "New skills",
  "userGuideFlow.assistant.step1.point11.text":
    "To create or edit a prompt, go to “**Workbench → Skills**” in the sidebar.",
  "userGuideFlow.assistant.step1.point12.lead": "Conversations",
  "userGuideFlow.assistant.step1.point12.text":
    "The “⋮” on a conversation in the left list (or a right-click) renames it, pins it, copies a share link, continues it in a new conversation, archives or deletes it, and exports it as Markdown or saves it to the material library.",
  "userGuideFlow.assistant.step1.point13.lead": "Messages",
  "userGuideFlow.assistant.step1.point13.text":
    "Right-click any message to “Quote this and keep asking”, copy or delete it; to delete several at once, right-click any message, choose “Batch select”, tick them and click “Delete selected”.",
  "userGuideFlow.assistant.step1.point14.lead": "Thinking",
  "userGuideFlow.assistant.step1.point14.text":
    "Models with a thinking mode let you set “Thinking effort” on the right of the input; when it is on, a collapsed “Thinking process” appears below the reply.",
  "userGuideFlow.assistant.step1.actionLabel": "Open the Job assistant",
  // ── Step 2 · Material library, knowledge base and Workbench (assistantSteps.ts) ──
  "userGuideFlow.assistant.step2.title": "Material library, knowledge base and Workbench",
  "userGuideFlow.assistant.step2.heading":
    "Store material and knowledge, and build your own assistant and templates",
  "userGuideFlow.assistant.step2.description":
    "The material library holds loose material, the knowledge base keeps written-up notes, and the Workbench is where you build skills and templates.",
  "userGuideFlow.assistant.step2.point1.lead": "Material library",
  "userGuideFlow.assistant.step2.point1.text":
    "Write a body, paste a link, or upload images and text files — files can be dragged straight in; click a card for details (full body, note and attachment list), and the assistant can read them and help you organize them.",
  "userGuideFlow.assistant.step2.point2.lead": "My files",
  "userGuideFlow.assistant.step2.point2.text":
    "Stored files all appear under the “My files” tab of the material library: images, documents and PDFs are visible at a glance and open any time; they belong to the current dataset, so export/import and upgrades never lose them",
  "userGuideFlow.assistant.step2.point3.lead": "Knowledge base",
  "userGuideFlow.assistant.step2.point3.text":
    "Written-up content — interview summaries, Resume tips, job-search strategy, interview Q&A, industry notes and so on; it has categories and tags, the body supports Markdown, entries can be searched, added, edited and deleted, and clicking a card reads the full text.",
  "userGuideFlow.assistant.step2.point4.lead": "Which one to use",
  "userGuideFlow.assistant.step2.point4.text":
    "The material library holds **loose material that is not organized yet**; the knowledge base holds **notes written up and worth re-reading**.",
  "userGuideFlow.assistant.step2.point5.lead": "Editing shortcuts",
  "userGuideFlow.assistant.step2.point5.text":
    "The edit dialogs in the material library and knowledge base save with **Ctrl / ⌘ + S** or **Ctrl / ⌘ + Enter**; when the title fails validation the body is kept, so you can fix it and save again.",
  "userGuideFlow.assistant.step2.point6.lead": "Save a conversation",
  "userGuideFlow.assistant.step2.point6.text":
    "The “⋮” on the right of an assistant conversation exports it as Markdown or saves the whole conversation to the material library in one click.",
  "userGuideFlow.assistant.step2.point7.lead": "Skills",
  "userGuideFlow.assistant.step2.point7.text":
    "A “Skill” in the Workbench is a prompt that stays in effect: once ticked it applies to every later conversation; it can carry knowledge files too.",
  "userGuideFlow.assistant.step2.point8.lead": "Layout presets",
  "userGuideFlow.assistant.step2.point8.text":
    "The Workbench's “Layout presets” lists the built-in presets; “Custom preset” only asks for parameters (line height, page margins, block spacing, accent color) — no code; this is the fastest way to squeeze into one page. The entry points for custom templates and importing HTML are gone, and existing templates still render as they are.",
  "userGuideFlow.assistant.step2.point9.lead": "Let the assistant build one",
  "userGuideFlow.assistant.step2.point9.text":
    "The layout preset page has “Ask the Job assistant to build one”, so the assistant can create or edit a **preset** — you still save it in the Workbench; the assistant changes only the parameters you mention and cannot clear ones you already set.",
  "userGuideFlow.assistant.step2.actionLabel": "Open the material library",
  // ── Step 1 · Backup and updates (dataBackupSteps.ts) ──
  "userGuideFlow.dataBackup.step1.title": "Backup and updates",
  "userGuideFlow.dataBackup.step1.heading": "Take your data with you, or start a new copy",
  "userGuideFlow.dataBackup.step1.description":
    "All data lives on this computer; export a copy before changing machines.",
  "userGuideFlow.dataBackup.step1.point1.lead": "Delete goes to Trash",
  "userGuideFlow.dataBackup.step1.point1.text":
    "Jobs, Candidate Jobs, Resumes, Apply records, Fact ledger entries, material library items, assistant conversations, referrals, reminders, interview experiences, share packages, and Profile Plans, custom sections/fields and Profile entries all go to “Trash” in the sidebar after deletion.",
  "userGuideFlow.dataBackup.step1.point2.lead": "Restorable",
  "userGuideFlow.dataBackup.step1.point2.text":
    "In Trash you can restore in one click, or restore or permanently delete a multi-selection at once; only “Delete permanently” really erases something, and it asks once more.",
  "userGuideFlow.dataBackup.step1.point3.lead": "Invisible outside Trash",
  "userGuideFlow.dataBackup.step1.point3.text":
    "Anything in Trash stops appearing on other pages (lists, home-page statistics and search all miss it).",
  "userGuideFlow.dataBackup.step1.point4.lead": "Export a backup",
  "userGuideFlow.dataBackup.step1.point4.text":
    "“Datasets” in Settings exports the current (or every) dataset plus attachments, custom fonts and the global model configuration as one archive, and importing it on a new computer restores everything; automatic backups are database snapshots only, without attachments or fonts. When items sit outside the package you are warned that “N items were not included”, with details in the manifest.json inside the package.",
  "userGuideFlow.dataBackup.step1.point5.lead": "Where exports go",
  "userGuideFlow.dataBackup.step1.point5.text":
    "The “Data” tab in Settings sets the folder exports are saved to; a local frontend writes there as well, while remote or cross-site requests never trigger local file access",
  "userGuideFlow.dataBackup.step1.point6.lead": "Several datasets",
  "userGuideFlow.dataBackup.step1.point6.text":
    "Importing creates a new dataset by default and leaves the one you are using alone; you can also **create an empty dataset** and record into it from scratch. Before importing, every attachment in the package is checked (checksums and name clashes) and any problem rejects the whole import without touching a local file; once confirmed you may skip the broken attachments and import the database only.",
  "userGuideFlow.dataBackup.step1.point7.lead": "Storage and backups",
  "userGuideFlow.dataBackup.step1.point7.text":
    "At the bottom of Settings → Data you can see how much disk each part of the data directory uses; database snapshots left in backups/ during a migration are listed too — unwanted ones can be moved, one by one and after confirmation, into a recycle folder inside the local data directory, where the file manager can always find them again. The system never cleans them up automatically.",
  "userGuideFlow.dataBackup.step1.point8.lead": "API keys",
  "userGuideFlow.dataBackup.step1.point8.text":
    "A backup includes model API keys by default; clear “Include model API keys in the backup” before exporting if you do not want them; after restoring, test the connection in the model settings; backups from older versions still import, and a new package with keys / fonts (formats 5 and 6) warns older versions to upgrade — export and import within the same major version when migrating.",
  "userGuideFlow.dataBackup.step1.point9.lead": "Trim the sidebar",
  "userGuideFlow.dataBackup.step1.point9.text":
    "Settings → App → “Interface and navigation” lets you turn off sidebar modules you do not use, and “Restore default display” on the card header undoes it in one click. Hiding only folds the entry away — no data is deleted, and Home, Job board, Resume center, My Profile, Apply desk and Settings always stay.",
  "userGuideFlow.dataBackup.step1.point10.lead": "Narrow screens and keyboard",
  "userGuideFlow.dataBackup.step1.point10.text":
    "On a narrow window click **“Open navigation”** to switch pages; “My space” stays in the header. Tab reaches “Skip to main content” first, and Enter takes you straight into the body. Common actions have shortcuts: Ctrl/⌘+K search, Ctrl/⌘+S save, Ctrl/⌘+Z undo, Ctrl/⌘+J toggle the assistant; “Settings → App → Shortcuts” changes the keys.",
  "userGuideFlow.dataBackup.step1.point11.lead": "Check for updates",
  "userGuideFlow.dataBackup.step1.point11.text":
    "The refresh icon in the header checks for updates. Settings → App supports downloading, progress and background download; if reading the status fails, click “Retry reading status” first. Windows confirms with “Restart and install”, macOS uses update.command; only the program is replaced — data/, .env and backups stay — and the real version and logs are the source of truth.",
  "userGuideFlow.dataBackup.step1.point12.lead": "Uninstalling",
  "userGuideFlow.dataBackup.step1.point12.text":
    "On Windows double-click uninstall.cmd in the project folder: by default it removes only the environment and caches the launcher created, keeping data/ and .env; use uninstall.cmd -Purge to delete the data too. macOS needs no uninstall script — deleting the project folder is a clean uninstall.",
  "userGuideFlow.dataBackup.step1.point13.lead": "Start and stop",
  "userGuideFlow.dataBackup.step1.point13.text":
    "On Windows double-click start.cmd / stop.cmd, on macOS start.command / stop.command; both are one-click startup with no extra dependencies. The first launch on macOS may be blocked once — **right-click it → Open** is enough, once.",
  "userGuideFlow.dataBackup.step1.point14.lead": "Source code",
  "userGuideFlow.dataBackup.step1.point14.text":
    "**Left of “Sign out” in the header** is the GitHub icon; clicking it opens the source and issue pages. The chip further left shows the **current dataset** (click it to switch from a menu, and “New dataset…” at the bottom of that menu creates another one right there). **“My space”, left of the avatar**, is the entry to private pages such as “My Profile”, and the avatar itself is the photo currently in use in your Profile.",
  "userGuideFlow.dataBackup.step1.point15.lead": "Open the guide again",
  "userGuideFlow.dataBackup.step1.point15.text":
    "“User guide” at the bottom of the sidebar can be reopened at any time; “Sign out” is in the header and stops the frontend and backend processes together (browsers do not let a script close this tab, so close it yourself afterwards).",
  "userGuideFlow.dataBackup.step1.point16.lead": "Try it online first",
  "userGuideFlow.dataBackup.step1.point16.text":
    "If you have not installed it yet, or want to get a feel for the interface, click through the “Live demo” on the official site; it is a read-only demo, **not connected to a real model** — AI replies are pre-recorded, and nothing you change is saved.",
  "userGuideFlow.dataBackup.step1.actionLabel": "Go to Settings",
  // ── First-launch “Quick start” cards (quickStartPaths.ts) ──
  "userGuideFlow.quickStart.existingResume.lead": "I already have a Resume",
  "userGuideFlow.quickStart.existingResume.text":
    "Paste or upload a pdf/docx and turn it into a Profile draft",
  "userGuideFlow.quickStart.fromScratch.lead": "Start from scratch",
  "userGuideFlow.quickStart.fromScratch.text":
    "Enter your experience by hand — no model needed anywhere",
  "userGuideFlow.quickStart.sample.lead": "Try the sample data first",
  "userGuideFlow.quickStart.sample.text":
    "Load a complete sample, kept separate from your real Profile",
  // ── Dialog copy and toasts (UserGuideModal.tsx) ──
  "userGuideFlow.modal.title": "Welcome to ResumeForge",
  "userGuideFlow.modal.quickStart.heading": "Start here",
  "userGuideFlow.modal.quickStart.description":
    "All three roads lead to your first deliverable Resume — take whichever feels natural.",
  "userGuideFlow.modal.action.viewFullGuide": "View the full guide (8 steps)",
  "userGuideFlow.modal.action.loadSample": "Load sample data to explore",
  "userGuideFlow.modal.action.later": "Later",
  "userGuideFlow.modal.action.prev": "Back",
  "userGuideFlow.modal.action.next": "Next",
  "userGuideFlow.modal.action.start": "Start using it",
  "userGuideFlow.modal.toast.sampleReady": "Sample data is ready — opening the home page",
  "userGuideFlow.modal.toast.sampleReused": "Back on the sample data",
  "userGuideFlow.modal.toast.sampleFailed": "Could not load the sample data",
} as const;

export default userGuideFlow;
