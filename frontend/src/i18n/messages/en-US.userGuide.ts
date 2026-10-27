// SPDX-License-Identifier: Apache-2.0
/**
 * User guide: the title, intro, points and action button of each of the eight steps, plus the
 * first-launch “Quick start” cards and the dialog's own buttons.
 *
 * The data files (components/user-guide/*.ts, quickStartPaths.ts) only hold `userGuide.*` keys.
 * The `**emphasis**` markers are kept as written — `UserGuideModal` renders them as bold — and
 * names of on-screen controls are quoted with “ ” to match how the UI labels them.
 */
const userGuide = {
  // ── Step 1 · Set up AI (setupProfileSteps.ts) ──
  "userGuide.setupProfile.step1.title": "Set up AI",
  "userGuide.setupProfile.step1.heading": "Pick a preset, or configure a custom model",
  "userGuide.setupProfile.step1.description":
    "Features that need a model use the connection configured here; features that do not need one can be skipped for now.",
  "userGuide.setupProfile.step1.point1.lead": "Do you need one",
  "userGuide.setupProfile.step1.point1.text":
    "Managing Jobs, the Profile and writing a Resume by hand **does not** need a model; AI generation, Job requirement reading, improvement suggestions, screenshot recognition and the assistant do need one.",
  "userGuide.setupProfile.step1.point2.lead": "Quick presets",
  "userGuide.setupProfile.step1.point2.text":
    "Covers the common providers — picking one fills in the endpoint and model name; the DeepSeek preset uses `deepseek-flash` from your account's model list.",
  "userGuide.setupProfile.step1.point3.lead": "Official endpoint",
  "userGuide.setupProfile.step1.point3.text":
    "Choose the “Claude (Anthropic native protocol)” preset to fill in the endpoint, model name and API protocol in one step.",
  "userGuide.setupProfile.step1.point4.lead": "Custom",
  "userGuide.setupProfile.step1.point4.text":
    "“Custom model” keeps what you have already filled in; **Manual only** clears the Base URL and model name, which suits a relay or a company gateway.",
  "userGuide.setupProfile.step1.point5.lead": "Model name unknown",
  "userGuide.setupProfile.step1.point5.text":
    "Click “Fetch available models” next to “Model name” to pull the list for the account; if nothing comes back, retry or type the model name from the provider's docs.",
  "userGuide.setupProfile.step1.point6.lead": "API protocol",
  "userGuide.setupProfile.step1.point6.text":
    "Providers on an OpenAI-compatible API: choose “OpenAI compatible”. Direct Claude access: choose “Anthropic native” and set the Base URL to https://api.anthropic.com/v1. A wrong choice returns 404 or 400.",
  "userGuide.setupProfile.step1.point7.lead": "Test before saving",
  "userGuide.setupProfile.step1.point7.text":
    "The configuration dialog has “Test connection” built in; save only after it succeeds. You can name and save frequently used settings as a record, then click “Use” on the card to switch in one step.",
  "userGuide.setupProfile.step1.point8.lead": "Saved configurations",
  "userGuide.setupProfile.step1.point8.text":
    "Settings has three pages: AI model / Data / App. Saved configurations are listed as record cards: click **New configuration** or “Edit” on a card to fill the dialog in, click the card itself for details, and the one marked “In use” is the active one; the other two pages always work immediately. On the App page you can also turn the Toutou floating ball on or off at any time, and hide its tagline separately if you do not want it.",
  "userGuide.setupProfile.step1.point9.lead": "API key",
  "userGuide.setupProfile.step1.point9.text":
    "Stored in the local database; model requests still go to the provider you chose. When editing a record, leave the key blank to keep the existing one.",
  "userGuide.setupProfile.step1.actionLabel": "Go to Settings",
  // ── Step 2 · Fill in the Profile (setupProfileSteps.ts) ──
  "userGuide.setupProfile.step2.title": "Fill in the Profile",
  "userGuide.setupProfile.step2.heading": "Build your personal Profile library",
  "userGuide.setupProfile.step2.description":
    "The 13 sections, the Current Plan and the field settings all live here; then verify, entry by entry, what you may say in public in the Fact ledger.",
  "userGuide.setupProfile.step2.point1.lead": "How to enter it",
  "userGuide.setupProfile.step2.point1.text":
    "Fill it in by hand, or paste a whole Profile at once; you can also press Ctrl+V to paste a screenshot, or upload a **pdf/docx Resume** (text is extracted on this machine) and have it recognized as a draft.",
  "userGuide.setupProfile.step2.point2.lead": "13 sections",
  "userGuide.setupProfile.step2.point2.text":
    "The Profile page is organized into 13 sections: Basic information, Education, Internship/Work, Projects, Skills, Campus, Honors, Summary, Academic output, Research projects, Intellectual property, Certificates, Languages; each one has its default fields. Fields use a responsive multi-column layout — single-line text up to 3 columns on wide screens, multi-line text and dates on a full row.",
  "userGuide.setupProfile.step2.point3.lead": "Current Plan",
  "userGuide.setupProfile.step2.point3.text":
    "“Current Plan” in the header decides which sections generation, new Resumes and Web form filling read; click “Manage Plans” to tick the section list. Basic information always stays first and cannot be removed.",
  "userGuide.setupProfile.step2.point4.lead": "Showing and hiding sections",
  "userGuide.setupProfile.step2.point4.text":
    "Every section can be shown or hidden on its own: hidden means removed from the Current Plan, so it takes no part in generation, export or Web form filling; the “Hidden sections” list at the top of the Profile page restores them at any time (it works in view mode too), and Basic information can never be hidden. A new Plan hides every section by default (except Basic information); created outside edit mode, it switches to the new Plan automatically, and you then open the sections you need one by one.",
  "userGuide.setupProfile.step2.point5.lead": "Fields are always visible",
  "userGuide.setupProfile.step2.point5.text":
    "Fields no longer collapse by default — enter edit mode and every visible field in the Current Plan is right there; to keep one out of AI and export, set it hidden in the field settings. The value still stays in the database and can be restored at any time.",
  "userGuide.setupProfile.step2.point6.lead": "Hiding",
  "userGuide.setupProfile.step2.point6.text":
    "Fields hidden in “Field settings” take no part in AI or export, but their values stay in the database; click the hidden-field entry to restore them at any time (the button reads “Show again”). Sections also have a “Show on the Profile page” switch — that one controls whether the whole section is in the Current Plan, a separate layer from hiding a field.",
  "userGuide.setupProfile.step2.point7.lead": "Field settings",
  "userGuide.setupProfile.step2.point7.text":
    "Every section accepts custom fields (single line, multi-line, date text) and lets you reorder them; default fields can only be hidden — not renamed or deleted.",
  "userGuide.setupProfile.step2.point8.lead": "Which section",
  "userGuide.setupProfile.step2.point8.text":
    "The table behind the Profile page's help entry covers “one experience belongs to one section”: choose the section by what the material is, so the same experience never appears twice on paper.",
  "userGuide.setupProfile.step2.point9.lead": "Training",
  "userGuide.setupProfile.step2.point9.text":
    "Training and courses are no longer a section: add a custom field under Projects or Education when you need one, or create a training-and-courses section yourself.",
  "userGuide.setupProfile.step2.point10.lead": "Old data after an upgrade",
  "userGuide.setupProfile.step2.point10.text":
    "Upgrading from an older version hides the old data, but it is still on this machine and in your backups; follow the hint at the top of the page to take it out of a backup and re-enter it by hand.",
  "userGuide.setupProfile.step2.point11.lead": "Fact ledger",
  "userGuide.setupProfile.step2.point11.text":
    "At **the bottom of the sidebar, above Settings**: record every statement you want in a Resume as one entry — the original fact, the Resume wording, how much of it was yours (participated / owned a module / led / owner) and your personal boundaries.",
  "userGuide.setupProfile.step2.point12.lead": "Generate from the Profile",
  "userGuide.setupProfile.step2.point12.text":
    "In the Fact ledger you can “Generate from profile” a batch of drafts and check them one by one, or create entries by hand.",
  "userGuide.setupProfile.step2.point13.lead": "Only confirmed counts",
  "userGuide.setupProfile.step2.point13.text":
    "Only entries marked “Confirmed” are used as facts when a Resume is generated; unverified claims are explicitly excluded and never slip into a Resume.",
  "userGuide.setupProfile.step2.point14.lead": "Interview deep dive",
  "userGuide.setupProfile.step2.point14.text":
    "“**Start deep dive**” at the top of the Fact ledger, next to “New entry”, pressure-tests each confirmed claim; the bar for every question is **fixed before you see the question** and is not lowered by fluent answers.",
  "userGuide.setupProfile.step2.point15.lead": "Deep dive results",
  "userGuide.setupProfile.step2.point15.text":
    "Instead of a score you get “Verified / Partially verified / Unverified / Contradictory”, and at the end a “pre-interview action list” plus a practice queue.",
  "userGuide.setupProfile.step2.point16.lead": "[To be filled] blocks export",
  "userGuide.setupProfile.step2.point16.text":
    "While the body still contains [To be filled: …] the export is blocked and the position is pointed out; to export a draft just to review it, choose “Still export draft” in the dialog.",
  "userGuide.setupProfile.step2.point17.lead": "Web form Profile",
  "userGuide.setupProfile.step2.point17.text":
    "“My Profile” switches horizontally between the Resume Profile and the shared Web form Profile. The latter adds Web form fields such as ID documents and family, and Education, Experience, Certificates and Works can each have several entries; the education extras (studied abroad, unified admission, highest degree, minor) are plain yes/no choices. In edit mode you can **paste text and have it recognized** for the whole screen of fields; unknown fields are first listed as items to confirm. Attachments must be uploaded by hand. **Resume generation reads the Resume Profile only; Web form filling merges both parts**.",
  "userGuide.setupProfile.step2.point18.lead": "Resume photo",
  "userGuide.setupProfile.step2.point18.text":
    "Only **the photo in use** is shown; click “Photo library” to change or delete it. The photo stays on this machine and is never sent to the model.",
  "userGuide.setupProfile.step2.point19.lead": "Collapsing sections",
  "userGuide.setupProfile.step2.point19.text":
    "Every section is expanded by default; click its title to collapse it, use “Expand all / Collapse all” in the header as a one-click switch, and editing expands everything automatically.",
  "userGuide.setupProfile.step2.point20.lead": "Career scenario",
  "userGuide.setupProfile.step2.point20.text":
    "“Career scenario” in the header is an optional suggestion for this window (career change, research application, career return, senior management and so on). Switching or editing a scenario changes only the guidance and suggestions — not the Profile, Jobs, existing Resumes, Apply settings or background tasks; to use it for a Resume you must turn on “For this generation” in the generate dialog, and the generation record keeps the scenario used.",
  "userGuide.setupProfile.step2.point21.lead": "Default order",
  "userGuide.setupProfile.step2.point21.text":
    "The global order of the 13 sections is: Basic information, Education, Internship/Work, Projects, Skills, Campus, Honors, Summary, Academic output, Research projects, Intellectual property, Certificates, Languages; sections you create come last. Drag the reorder handle to change it — the order holds from then on, and Resume generation follows it too.",
  "userGuide.setupProfile.step2.actionLabel": "Go to My Profile",
  // ── Step 1 · Import Jobs and apply (workflowSteps.ts) ──
  "userGuide.workflow.step1.title": "Import Jobs and apply",
  "userGuide.workflow.step1.heading":
    "Enter them by hand or collect them automatically, then send them from the Apply desk",
  "userGuide.workflow.step1.description":
    "Jobs can be entered by hand or collected automatically; before anything is sent you see the match verdict and confirm it yourself.",
  "userGuide.workflow.step1.point1.lead": "How to enter one",
  "userGuide.workflow.step1.point1.text":
    "Type it in field by field, or paste a whole posting and let it be recognized; you can also paste a screenshot, or upload a **pdf/docx posting — both are recognized** (up to 4 at a time).",
  "userGuide.workflow.step1.point2.lead": "Bulk CSV import",
  "userGuide.workflow.step1.point2.text":
    "“Import CSV” takes up to 10 files at once (2000 rows in total), by selection or drag and drop, and pasted table content works too — press Ctrl+V in the import area; a bad file only flags itself while good ones still import, and submission splits into batches of 500 rows automatically.",
  "userGuide.workflow.step1.point3.lead": "Recognition does not save",
  "userGuide.workflow.step1.point3.text":
    "**Recognition results are not saved automatically** — check the fields, then click save; saving appends a source line to the note (pasted-text recognition / image recognition / document recognition).",
  "userGuide.workflow.step1.point4.lead": "AI or local",
  "userGuide.workflow.step1.point4.text":
    "A line under the result always says whether it was AI recognition or local rules; when AI is unavailable it falls back automatically and explains why.",
  "userGuide.workflow.step1.point5.lead": "Candidate Jobs",
  "userGuide.workflow.step1.point5.text":
    "Anything you have not checked yet can be parked with “Candidate Jobs” (pasted text and screenshots both work), then brought in with one click via “Import as Job”, or left to the assistant to import for you.",
  "userGuide.workflow.step1.point6.lead": "Auto collect",
  "userGuide.workflow.step1.point6.text":
    "In “Apply desk → Auto collect” set the keywords and city, then click “Start collecting”; several keywords are searched one by one and de-duplicated across them, and saved conditions land in “Saved filters” for one-click reuse. Collection runs in the background: switching page does not interrupt it, the Apply desk still shows progress when you come back, and a notification arrives when it finishes.",
  "userGuide.workflow.step1.point7.lead": "City codes",
  "userGuide.workflow.step1.point7.text":
    "The city name is converted to that site's own city code; when it cannot be recognized you get a clear error instead of a silent search in a different city.",
  "userGuide.workflow.step1.point8.lead": "Site filters",
  "userGuide.workflow.step1.point8.text":
    "Collection conditions include “Filter by the job site's own filters”: job type / salary / experience / education / company industry / company size / funding stage — the site filters them during the search, which is more accurate than filtering afterwards. The options are read from the site itself and their source is stated: with the browser running it is the list **your account can see**.",
  "userGuide.workflow.step1.point9.lead": "Staging area first",
  "userGuide.workflow.step1.point9.text":
    "Collected Jobs **do not go straight to the Job board**: you tick the ones to keep and click “Import selected jobs” (their source is marked “Job collection”); anything unticked stays in Candidate Jobs.",
  "userGuide.workflow.step1.point10.lead": "Collection history",
  "userGuide.workflow.step1.point10.text":
    "Every collection leaves one entry in “Collection history”; expand it to see which conditions that run used and what it found.",
  "userGuide.workflow.step1.point11.lead": "It says when nothing was found",
  "userGuide.workflow.step1.point11.text":
    "A genuine empty search (keywords too narrow) is reported as such; bad parameters, a changed page structure, a logged-out browser or a CAPTCHA fail explicitly with diagnostics — “nothing scraped” is never dressed up as “0 found”.",
  "userGuide.workflow.step1.point12.lead": "The site may have changed",
  "userGuide.workflow.step1.point12.text":
    "When Job pages repeatedly cannot be read, or the description is generally missing, a banner explains what happened, that it is an inference, and what to do; a login wall, a CAPTCHA, a network timeout or a genuinely empty search **do not** count as a redesign.",
  "userGuide.workflow.step1.point13.lead": "Match analysis",
  "userGuide.workflow.step1.point13.text":
    "“Match analysis” on the Job detail reads your Profile and Resumes and gives five verdicts — “matched / wording gap / insufficient evidence / real gap / needs confirmation” — plus a 0–100 reference score (see the next point); unlike “Job requirement reading”, which only reads the posting.",
  "userGuide.workflow.step1.point14.lead": "Batch analysis",
  "userGuide.workflow.step1.point14.text":
    "On the Job board click “Select” to tick several Jobs, then “Analyze fit with AI”; the dropdown can run it in the background, results are sorted by reference score and saved to “Analysis records” for later.",
  "userGuide.workflow.step1.point15.lead": "Reference score",
  "userGuide.workflow.step1.point15.text":
    "There is also a 0–100 reference score with five sub-scores; it only helps you sense the distance, **takes no part in apply admission**, and comes with a disclaimer.",
  "userGuide.workflow.step1.point16.lead": "Join the apply queue",
  "userGuide.workflow.step1.point16.text":
    "Click “Add to apply desk” on the Job detail to queue it; **only Jobs whose source is a job site can be applied to automatically** — for a hand-entered Job with no site application URL the button is grayed out and the detail explains why (add that Job's URL on the site and it works). The top of the queue page lays out the whole flow (where Jobs come from, what to check, when anything is really sent); click a Job name for details, and you can reorder, edit the greeting and choose which materials to use.",
  "userGuide.workflow.step1.point17.lead": "Admission rules",
  "userGuide.workflow.step1.point17.text":
    "Jobs with “insufficient evidence / needs confirmation” need your confirmation item by item before they can join the queue; a Job with a “real gap” shows as “Do not apply” with the reason.",
  "userGuide.workflow.step1.point18.lead": "Dedicated browser",
  "userGuide.workflow.step1.point18.text":
    "Start it on the Apply desk before applying — it is a separate window that opens the job site's home page, and you sign in once by scanning a code (sign-in is yours; the app stores neither password nor cookie). The page reads the browser state on first paint and polls it live; closing the window directly flips it back to not started, and “Refresh status” checks immediately; “Close browser” only closes the window this app started.",
  "userGuide.workflow.step1.point19.lead": "Which browser",
  "userGuide.workflow.step1.point19.text":
    "“Apply settings → Browser used by the Apply desk” offers prefer Chrome automatically / Chrome only / Edge only / custom path; when you name one it looks for that one only and says so plainly if it is not installed.",
  "userGuide.workflow.step1.point20.lead": "Who sends the greeting",
  "userGuide.workflow.step1.point20.text":
    "For a Job **you have never messaged**, the job site first sends **the default greeting configured in your account on that site**, and the greeting this app wrote follows as the second message. So the recruiter receives two — the first comes from the site and is outside this app's control; change it in the job site's own settings.",
  "userGuide.workflow.step1.point21.lead": "Progress",
  "userGuide.workflow.step1.point21.text":
    "Shown as “handled N/M” plus a per-Job status, with pause / resume / stop always available; repeated failures trip a circuit breaker with a prominent notice, and times follow your local time zone. Sending happens in the background, so switching page does not interrupt it.",
  "userGuide.workflow.step1.point22.lead": "Apply settings",
  "userGuide.workflow.step1.point22.text":
    "Every item in “Apply desk → Apply settings” really takes effect: **batch limit** caps how many go out in one batch (the rest stay queued), **daily limit** counts successes only, **one Job per company** sends only that company's first Job in the batch (the skipped one says why), and **Job interval + jitter** sets the wait between two sends.",
  "userGuide.workflow.step1.point23.lead": "Where failures show",
  "userGuide.workflow.step1.point23.text":
    "Apply desk → “Apply records”: Jobs sent together are grouped per batch, and clicking the group header expands the detail; filter by failure class (sign-in needed / CAPTCHA / selector broken / network timeout and so on), click “Details” for the full record in the drawer on the right, and a single record can be retried. When a batch ends you get a notification on whatever page you are on.",
  "userGuide.workflow.step1.point24.lead": "Records can be deleted",
  "userGuide.workflow.step1.point24.text":
    "A single Apply record can be deleted, and the group header also has “Delete this batch”. Deleted records go to Trash and can be restored; **a deleted record no longer counts in the stats or the daily limit** — nothing in Trash appears in any statistic.",
  "userGuide.workflow.step1.point25.lead": "Web form filling",
  "userGuide.workflow.step1.point25.text":
    "Filling a company's web form goes “open browser → open the form page → read the form → check → fill”; with a target URL it opens directly, without loading a blank page or opening duplicate dialogs.",
  "userGuide.workflow.step1.point26.lead": "Floating ball",
  "userGuide.workflow.step1.point26.text":
    "“Lili” in the dedicated browser supports click to toggle, double-click for the menu and press-and-drag. Turning live filling off grays the ball out and focusing an input no longer pops a card; “Auto-fill this page” in the menu is the shortcut for the main fill flow — it reuses the same date conversion, conflict protection and field matching, shows the result and success rate, and can also “Ask Lili” directly.",
  "userGuide.workflow.step1.point27.lead": "Remember a field",
  "userGuide.workflow.step1.point27.text":
    "“Remember this” lets you rename the field; by default it writes only into the Web form Profile — an existing field is updated, otherwise a custom field is added. Normal mode reuses a field only on one unique exact label; with relaxed mode on, custom fields also take part in constrained text matching.",
  "userGuide.workflow.step1.point28.lead": "Repeated sections",
  "userGuide.workflow.step1.point28.text":
    "Repeated blocks such as Internship-2 or Project-3 match the Profile entry by their index on the page; a box it cannot recognize can be pointed at another entry or handed to AI (only the page text is sent).",
  "userGuide.workflow.step1.point29.lead": "A browser for filling",
  "userGuide.workflow.step1.point29.text":
    "The Web form browser and the Apply desk share the browser-type setting, and **their windows never overwrite each other**. On launch you can type a URL to open a new page, and history can be deleted; **opening the browser or a page turns on “Smart field-by-field filling” automatically** (the Lili ball appears with the page, no manual switch), and every page has a floating switch that is on by default and can be turned off separately. Changing browser settings needs a restart to take effect.",
  "userGuide.workflow.step1.point30.lead": "It fills, you submit",
  "userGuide.workflow.step1.point30.text":
    "Go back to the browser to check after filling — **submitting is your click**; passwords and CAPTCHAs are never filled, and existing values are not overwritten by default. **Only text-like controls are written**: dropdowns, radio buttons, checkboxes, date controls and searchable dropdowns such as school or major — ones that “look like an input but must be opened and picked” — are never filled automatically and are listed honestly as “you need to pick this yourself”; dates are converted only inside text boxes, following the page's format (missing parts are not invented). AI suggestions are unticked by default.",
  "userGuide.workflow.step1.point31.lead": "Relaxed mode",
  "userGuide.workflow.step1.point31.text":
    "After you **turn it on explicitly** on the Web form page or in Settings, the app clicks dropdown and popover options for you and matches unrecognized text boxes (custom fields included) by label and context; low-confidence candidates are marked “needs confirmation” and unticked by default. Consent and declaration items still need confirming one by one; date pickers and file uploads are left to you. Relaxed matching can pick the wrong item, so check after filling.",
  "userGuide.workflow.step1.point32.lead": "Success rate and diagnostics",
  "userGuide.workflow.step1.point32.text":
    "Batch filling and the ball's auto-fill show a success rate as “fields filled / total form fields on the page”, and tell you how many were actually recognized and attempted. When something goes wrong, “Export diagnostics” exports only redacted facts — version, request id, control count, elapsed time, error type — never Resume values, form values, passwords or API keys; send it with a screenshot to make it easier to pin down.",
  "userGuide.workflow.step1.point33.lead": "What was filled",
  "userGuide.workflow.step1.point33.text":
    "“Fill records” at the bottom keeps the time, page, field, value, result and snapshot of every fill, **stored on this machine only**. Switching page or closing the dedicated browser keeps the current draft; come back to the Web form page to continue, and only “Finish this fill” clears it.",
  "userGuide.workflow.step1.actionLabel": "Go to the Job board",
  // ── Step 2 · Track each application (workflowSteps.ts) ──
  "userGuide.workflow.step2.title": "Track each application",
  "userGuide.workflow.step2.heading": "What happens after you send it",
  "userGuide.workflow.step2.description":
    "One record per company and role, moving through “Applied → Screening → Assessment/Test → Interview → Offer”.",
  "userGuide.workflow.step2.point1.lead": "Automatic",
  "userGuide.workflow.step2.point1.text":
    "Jobs sent successfully from the Apply desk appear here automatically — no need to enter them again by hand.",
  "userGuide.workflow.step2.point2.lead": "Import from a message",
  "userGuide.workflow.step2.point2.text":
    "Paste a recruiting email, SMS or in-site notification and the progress is recognized; screenshots and pdf/docx uploads work too.",
  "userGuide.workflow.step2.point3.lead": "Preview before writing",
  "userGuide.workflow.step2.point3.text":
    "The result **shows you what will happen first**: every item states “new record / progress update / already up to date, unchanged” together with the reason, and nothing is written until you tick and confirm it.",
  "userGuide.workflow.step2.point4.lead": "Channel and Job link",
  "userGuide.workflow.step2.point4.text":
    "The edit form can set a **channel** (referral / company site / job platform and so on; leave it as “Unknown” when unsure) and the **linked Job** — both optional.",
  "userGuide.workflow.step2.point5.lead": "Status only moves forward",
  "userGuide.workflow.step2.point5.text":
    "Records are merged by “company + role”, and a later message overrides an earlier “Applied”; pasting an out-of-order “application received” from three months ago will not push a record that is already interviewing backwards.",
  "userGuide.workflow.step2.point6.lead": "Auto-receipts",
  "userGuide.workflow.step2.point6.text":
    "**An ordinary auto-receipt is never read as an interview or an Offer**: “thanks for applying” is recorded as “Applied” only, and anything undecidable is marked “needs confirmation” for you to settle.",
  "userGuide.workflow.step2.point7.lead": "The funnel is clickable",
  "userGuide.workflow.step2.point7.text":
    "Every stage of the funnel can be clicked, and a click filters by that stage.",
  "userGuide.workflow.step2.point8.lead": "Deadlines",
  "userGuide.workflow.step2.point8.text":
    "“Next step” and the deadline are shown on every record, and overdue ones are marked in red.",
  "userGuide.workflow.step2.point9.lead": "Export",
  "userGuide.workflow.step2.point9.text":
    "Export the current filter as CSV (opens straight in Excel) or JSON.",
  "userGuide.workflow.step2.point10.lead": "Reminders and referrals",
  "userGuide.workflow.step2.point10.text":
    "“Reminders” sets due-time alerts for applications, interviews and referrals, switchable between **list / month view** (clicking a day in the month view shows everything scheduled that day, and the home month view works the same), and the home page colors them by urgency; “Referrals” records opportunities that came from your network and tracks the conversion rate — click a card for contact details, referral code and note images.",
  "userGuide.workflow.step2.point11.lead": "Interview prep",
  "userGuide.workflow.step2.point11.text":
    "Practice with “Personalized question bank” (basics / project deep dive / questions for HR), or run an “Interview retrospective” to record the real questions and analyze them; afterwards you can keep it as an “Interview experience”.",
  "userGuide.workflow.step2.point12.lead": "History is kept",
  "userGuide.workflow.step2.point12.text":
    "Question-bank generation and interview retrospectives are saved to history automatically; open a history entry and the original screen and buttons are still there, with new results written back to that entry.",
  "userGuide.workflow.step2.actionLabel": "Go to the Job tracker",
} as const;

export default userGuide;
