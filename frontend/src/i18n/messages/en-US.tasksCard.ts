// SPDX-License-Identifier: Apache-2.0
/** Home "Tasks" card (T02): card title, subtitle and expand/collapse actions. */
const tasksCard = {
  /** Card title (same entity as the "Task cards" switch in Settings). */
  "tasksCard.title": "Tasks",
  /** CR-19: title of the "Needs your confirmation" card (waiting_approval only). */
  "tasksCard.confirmTitle": "Needs your confirmation",
  /** Subtitle: this card only holds multi-step tasks the assistant created (CR-19). */
  "tasksCard.subtitle": "Multi-step tasks the assistant created",
  /** In-place expand button when active tasks exceed the limit; `{count}` hidden. */
  "tasksCard.more": "{count} more",
  /** Collapsed "Finished" section header; `{count}` is the total finished count. */
  "tasksCard.finishedCount": "Finished ({count})",
} as const;

export default tasksCard;
