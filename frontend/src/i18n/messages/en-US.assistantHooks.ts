// SPDX-License-Identifier: Apache-2.0
/**
 * Runtime notices raised by the assistant hooks: streaming sends, attachment
 * validation, conversation create/rename/delete, quoting and deleting messages,
 * sidebar skills and groups, and deep-link guidance.
 *
 * The hooks and the stream store resolve these through the module-level `t()`
 * inside callbacks; the page that renders them subscribes to locale changes
 * (`AssistantPage` already calls `useLocale()`).
 */
const assistantHooks = {
  "assistantHooks.stream.error.createConversation": "Could not create the conversation",
  "assistantHooks.stream.attachmentOnly": "[Attachment]",
  "assistantHooks.stream.error.send": "Could not send the message",
  "assistantHooks.attachments.warning.unsupported":
    "The attachment extension does not match the file type, or the format is not supported",
  "assistantHooks.attachments.warning.tooMany": "You can add up to {count} attachments per message",
  "assistantHooks.attachments.warning.tooLarge": "A single attachment cannot exceed {size} MB",
  "assistantHooks.attachments.warning.totalTooLarge":
    "Attachments cannot exceed {size} MB in total",
  "assistantHooks.attachments.error.read": "Could not read the attachment",
  "assistantHooks.conversations.error.loadDetail": "Could not load the conversation",
  "assistantHooks.conversations.error.loadEarlier": "Could not load earlier messages",
  "assistantHooks.conversations.error.create": "Could not create the conversation",
  "assistantHooks.conversations.error.createWelcome": "Could not create the welcome conversation",
  "assistantHooks.conversations.error.delete": "Could not delete the conversation",
  "assistantHooks.conversations.warning.emptyTitle": "A conversation title is required",
  "assistantHooks.conversations.error.rename": "Could not rename the conversation",
  "assistantHooks.conversations.error.update": "Could not update the conversation",
  "assistantHooks.conversations.error.fork": "Could not continue in a new conversation",
  "assistantHooks.conversations.forkTitleSuffix": " (continued)",
  "assistantHooks.messageActions.quote.attachmentOnly": "[Attachment message]",
  "assistantHooks.messageActions.quote.info": "Quoted this message. Type your follow-up below",
  "assistantHooks.messageActions.success.deleted": "Message deleted",
  "assistantHooks.messageActions.error.delete": "Could not delete the message",
  "assistantHooks.messageSelection.success.deletedCount": "Deleted {count} messages",
  "assistantHooks.messageSelection.error.delete": "Could not delete the messages",
  "assistantHooks.sidebar.success.skillEnabled": "Enabled the “{name}” skill",
  "assistantHooks.sidebar.success.skillDisabled": "Disabled the “{name}” skill",
  "assistantHooks.sidebar.error.toggleSkill": "Could not toggle the skill",
  "assistantHooks.sidebar.success.movedToGroup": "Moved to “{name}”",
  "assistantHooks.sidebar.success.removedFromGroup": "Removed from its group",
  "assistantHooks.url.info.outOfRange":
    "The conversation in this link is not in the list, which only covers the latest 100 conversations.",
} as const;

export default assistantHooks;
