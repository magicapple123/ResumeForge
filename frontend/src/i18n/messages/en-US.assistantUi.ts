// SPDX-License-Identifier: Apache-2.0
/**
 * Assistant message area, empty state, conversation sidebar, write-proposal card and
 * group dialog (migrated 2026-10-28).
 *
 * Covers the display copy under features/assistant/: starter-prompt labels (the prompt
 * bodies themselves are instructions sent to the model and stay in assistantTypes.ts),
 * the time-based greeting, the skill-name summary, reasoning and sources panels,
 * message context menus and the multi-select bar, sidebar filters/actions/confirms/toasts,
 * and the write-proposal statuses and buttons.
 *
 * The module-level tables store keys only (labelKey) and resolve them with t() at render
 * time; this pack contains no protocol values. The {note} placeholder carries the
 * deletion-consequence constant from components/common/rowActionMenu.ts until that
 * constant moves into a language pack.
 */
const assistantUi = {
  "assistantUi.starter.matchAnalysis": "Analyze job fit",
  "assistantUi.starter.polishProjects": "Improve project experience",
  "assistantUi.starter.interviewRound": "Prepare for an interview",
  "assistantUi.starter.findJobs": "Find job postings",
  "assistantUi.greeting.headline": "Hi, I'm Toutou",
  "assistantUi.greeting.lateNight": "It's late. Finish this one and get some rest",
  "assistantUi.skillNames.separator": ", ",
  "assistantUi.skillNames.overflow": "{names} ({count} total)",
  "assistantUi.empty.floatingDescription":
    "I can help with ResumeForge questions, analyze your resume and the job, and change the data the assistant is allowed to touch when you explicitly ask.",
  "assistantUi.empty.pageDescription":
    "I can polish your resume, check it against a job to spot gaps, and answer job search questions. Link a job or resume first, then turn on profile data and web search as needed.",
  "assistantUi.empty.starterPromptsAria": "Common job search questions",
  "assistantUi.empty.skillsDiscoveryBefore": "The assistant can also answer with the ",
  "assistantUi.empty.skillsDiscoveryTerm": "skills",
  "assistantUi.empty.skillsDiscoveryAfter":
    " you imported — a skill is a prompt (optionally with knowledge files) that fixes an answer style or workflow.",
  "assistantUi.empty.manageSkills": "Add a skill in the workbench",
  "assistantUi.group.move": "Move to group",
  "assistantUi.group.moveCurrent": "Move to group (current: {name})",
  "assistantUi.group.description":
    "Give this conversation a category (for example “ByteDance” or “Interview prep”). Leave it empty to remove the conversation from its group. Groups only affect the sidebar, never the conversation itself.",
  "assistantUi.group.placeholder": "Group name",
  "assistantUi.reasoning.title": "Reasoning",
  "assistantUi.reasoning.truncated": "The reasoning was too long, so only the first part is kept.",
  "assistantUi.sources.header": "Sources ({count})",
  "assistantUi.attachments.notesSeparator": "; ",
  "assistantUi.messageList.action.quote": "Quote this message and keep asking",
  "assistantUi.messageList.action.copy": "Copy content",
  "assistantUi.messageList.action.delete": "Delete this message",
  "assistantUi.messageList.toast.copied": "Copied this message",
  "assistantUi.messageList.toast.copyFailed": "Could not copy — select the text manually",
  "assistantUi.messageList.confirm.delete":
    "Delete this message? Questions that quote it keep the quoted content.",
  "assistantUi.messageList.role.self": "You",
  "assistantUi.messageList.aria.selectOwn": "Select your message",
  "assistantUi.messageList.aria.selectAssistant": "Select the assistant's message",
  "assistantUi.messageList.loadEarlier": "Load earlier",
  "assistantUi.messageList.total": "{count} messages in total",
  "assistantUi.messageList.thinking": "Thinking…",
  "assistantUi.messageList.streaming": "Generating the answer",
  "assistantUi.messageList.preparing": "Preparing the answer",
  "assistantUi.selectBar.selected": "{count} selected",
  "assistantUi.selectBar.confirm.title": "Delete the selected messages?",
  "assistantUi.selectBar.confirm.content":
    "These {count} messages {note} Questions that quote them keep the quoted content.",
  "assistantUi.selectBar.deleteSelected": "Delete selected",
  "assistantUi.selectBar.exit": "Exit selection",
  "assistantUi.actionProposal.status.pending": "Pending confirmation",
  "assistantUi.actionProposal.status.approved": "Approved",
  "assistantUi.actionProposal.status.executed": "Executed",
  "assistantUi.actionProposal.status.expired": "Expired",
  "assistantUi.actionProposal.status.rejected": "Rejected",
  "assistantUi.actionProposal.status.failed": "Failed",
  "assistantUi.actionProposal.status.unknown": "Result unknown",
  "assistantUi.actionProposal.status.fallback": "Unknown status",
  "assistantUi.actionProposal.aria": "Write proposal: {target}",
  "assistantUi.actionProposal.heading": "The assistant wants to write data",
  "assistantUi.actionProposal.changeField": "{field}: ",
  "assistantUi.actionProposal.noContent": "(no content)",
  "assistantUi.actionProposal.notice":
    "This write will not run until you confirm it, and the assistant cannot confirm on your behalf.",
  "assistantUi.actionProposal.action.approve": "Confirm and run",
  "assistantUi.actionProposal.action.reject": "Reject",
  "assistantUi.actionProposal.toast.done": "Write completed",
  "assistantUi.actionProposal.toast.executed": "Proposal executed",
  "assistantUi.actionProposal.error.fallback": "Could not run the proposal",
  "assistantUi.sidebar.newConversation": "New conversation",
  "assistantUi.sidebar.deleteSelected": "Delete selected",
  "assistantUi.sidebar.searchPlaceholder": "Search titles or first messages",
  "assistantUi.sidebar.searchAria": "Search conversations",
  "assistantUi.sidebar.filter.all": "All",
  "assistantUi.sidebar.filter.favorite": "Favorites",
  "assistantUi.sidebar.filter.archived": "Archived",
  "assistantUi.sidebar.loading": "Loading conversations…",
  "assistantUi.sidebar.empty": "No conversations",
  "assistantUi.sidebar.aria.selectConversation": "Select conversation {title}",
  "assistantUi.sidebar.moreTooltip": "More actions (you can also right-click this conversation)",
  "assistantUi.sidebar.moreAria": "More conversation actions",
  "assistantUi.sidebar.saveTitleTooltip": "Save the title (Enter also works)",
  "assistantUi.sidebar.saveTitleAria": "Save conversation title",
  "assistantUi.sidebar.messageCount": "{count} messages",
  "assistantUi.sidebar.action.pin": "Pin conversation",
  "assistantUi.sidebar.action.unpin": "Unpin conversation",
  "assistantUi.sidebar.action.favorite": "Add to favorites",
  "assistantUi.sidebar.action.unfavorite": "Remove from favorites",
  "assistantUi.sidebar.action.shareLink": "Copy share link",
  "assistantUi.sidebar.action.rename": "Rename",
  "assistantUi.sidebar.action.fork": "Continue in a new conversation",
  "assistantUi.sidebar.action.export": "Export as Markdown",
  "assistantUi.sidebar.action.saveToMaterials": "Save to materials",
  "assistantUi.sidebar.action.copyId": "Copy conversation ID",
  "assistantUi.sidebar.action.archive": "Archive conversation",
  "assistantUi.sidebar.action.unarchive": "Unarchive conversation",
  "assistantUi.sidebar.confirm.deleteSelectedTitle": "Delete the selected conversations?",
  "assistantUi.sidebar.confirm.deleteSelectedContent": "These {count} conversations {note}",
  "assistantUi.sidebar.toast.shareLinkCopied":
    "Copied the conversation link — open it in this app to return to the conversation",
  "assistantUi.sidebar.toast.copyLinkFailed": "Could not copy — copy it manually: {link}",
  "assistantUi.sidebar.toast.idCopied": "Copied conversation ID: {id}",
  "assistantUi.sidebar.toast.exported": "Exported as a Markdown file",
  "assistantUi.sidebar.toast.exportFailed": "Could not export",
  "assistantUi.sidebar.toast.savedToMaterials": "Saved to materials",
  "assistantUi.sidebar.toast.saveFailed": "Could not save to materials",
} as const;

export default assistantUi;
