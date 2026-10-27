// SPDX-License-Identifier: Apache-2.0
/**
 * 模拟面试页：会话列表、问答、结束/删除确认与结果提示。
 *
 * `interview.listSeparator` 是把关卡焦点题拼成一行时的分隔符：中文用全角「；」，
 * 英文用 "; "，属于随语言变化的符号，必须走语言包而不是硬编码。
 *
 * `interview.confirm.deleteBody` 的后果段用 `{note}` 参数传入共用常量 `HARD_DELETE_NOTE`
 * （硬删除提示的唯一出口，见 `components/common/rowActionMenu.ts`），不在语言包里复制一份。
 */
const interview = {
  "interview.toast.loadFailed": "Could not load interview records",
  "interview.toast.startFailed": "Could not start the interview",
  "interview.toast.openFailed": "Could not open the interview",
  "interview.toast.reportReady": "Interview finished — the score report is ready",
  "interview.toast.submitFailed": "Could not submit the answer — try again",
  "interview.toast.ended": "Interview ended",
  "interview.toast.endFailed": "Could not end the interview",
  "interview.toast.deleted": "Interview deleted",
  "interview.toast.deleteFailed": "Could not delete",
  "interview.toast.deletedMany": "Deleted {count} interviews",
  "interview.toast.deletedPartial": "Deleted {ok}; {failed} failed — try again",
  "interview.toast.savedToMaterials": "Saved to the Interview retrospective category",
  "interview.toast.saveFailed": "Could not save to the material library",
  "interview.toast.questionsImported": "Questions added to Focus areas — review them and start",
  "interview.confirm.endTitle": "End this interview?",
  "interview.confirm.endBody":
    "A score report is generated from the answers so far, and no further answers can be added.",
  "interview.confirm.endOk": "End and get the report",
  "interview.confirm.endCancel": "Keep interviewing",
  "interview.confirm.deleteTitle": "Delete the selected interviews?",
  "interview.confirm.deleteBody": "These {count} interviews will be deleted permanently. {note}",
  "interview.page.title": "Mock interview",
  "interview.page.subtitle":
    "An AI interviewer asks questions at the type and difficulty you set, then gives a score report and improvement suggestions.",
  "interview.action.backToSettings": "Back to settings",
  "interview.tab.interview": "Mock interview",
  "interview.tab.questionBank": "Question bank",
  "interview.tab.experiences": "Interview experiences",
  "interview.tab.review": "Retrospectives",
  "interview.round.withClosing": "Round {current} · the interviewer is wrapping up",
  "interview.round.progress": "Round {current} / {total}",
  "interview.action.end": "End and get the report",
  "interview.action.new": "Start a new one",
  "interview.role.you": "Me",
  "interview.role.comment": "Interviewer feedback:",
  "interview.thinking": "Thinking about the next question…",
  "interview.placeholder":
    "Answer as in a real interview: conclusion first, then what you did and how it turned out (Ctrl+Enter to send)",
  "interview.hint.dontKnow":
    "If you cannot answer, say “I don't know” — the interviewer will suggest an approach.",
  "interview.action.submit": "Submit answer",
  "interview.listSeparator": "; ",
} as const;

export default interview;
