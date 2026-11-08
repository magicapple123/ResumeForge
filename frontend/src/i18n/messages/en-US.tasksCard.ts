// SPDX-License-Identifier: Apache-2.0
/** Home "Tasks" card (T02): card title, subtitle and expand/collapse actions. */
const tasksCard = {
  /** Card title (same entity as the "Task cards" switch in Settings). */
  "tasksCard.title": "Tasks",
  /** Subtitle: one sentence on what the card is. */
  "tasksCard.subtitle": "What the assistant is working on",
  /** In-place expand button when active tasks exceed the limit; `{count}` hidden. */
  "tasksCard.more": "{count} more",
  /** Collapsed "Finished" section header; `{count}` is the total finished count. */
  "tasksCard.finishedCount": "Finished ({count})",
} as const;

export default tasksCard;
