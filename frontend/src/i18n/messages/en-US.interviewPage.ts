// SPDX-License-Identifier: Apache-2.0
/**
 * Mock interview page: the interviewer setup card, the interview history card and
 * the score report card.
 *
 * Enum values are protocol values sent to the backend, so only their display names
 * live here: `SetupTab.tsx` maps each protocol value to a key and renders it with
 * `t()`. The history card shows the raw values returned by the backend (data, not copy).
 *
 * `{time}` in the two round labels is formatted by the caller; `{answered}` and
 * `{total}` are round counts. `history.total` is the pagination total.
 *
 * "Select multiple" reuses `common.action.batchSelect` and is not duplicated here.
 */
const interviewPage = {
  "interviewPage.avatarAlt": "Interviewer Jane",
  // Author name on interviewer bubbles: a given name, not translatable prose.
  "interviewPage.interviewerName": "Jane",
  // Author name shown on interviewer bubbles.

  // ===== Interview history card =====
  "interviewPage.history.cardTitle": "Interview history",
  "interviewPage.history.deleteOne": "Delete this interview",
  "interviewPage.history.deleteOneConfirm": "Delete this interview? It cannot be restored.",
  "interviewPage.history.deleteSelected": "Delete selected",
  "interviewPage.history.empty": "No mock interviews yet",
  "interviewPage.history.selectAria": "Select the interview {title}",
  "interviewPage.history.actionContinue": "Continue",
  "interviewPage.history.actionViewReport": "View report",
  "interviewPage.history.statusActive": "In progress",
  "interviewPage.history.statusFinished": "Finished",
  "interviewPage.history.roundsAuto": "{answered} rounds (auto finish) · {time}",
  "interviewPage.history.roundsProgress": "Round {answered}/{total} · {time}",
  "interviewPage.history.total": "{count} interviews",

  // ===== Score report card =====
  "interviewPage.report.cardTitle": "Score report",
  "interviewPage.report.failedTitle": "The report could not be generated",
  "interviewPage.report.failedBody":
    "This interview's Q&A is in the material library, and you can also take the interview again.",
  "interviewPage.report.score": "{score} pts",
  "interviewPage.report.strengths": "What went well",
  "interviewPage.report.improvements": "What to improve next time",
  "interviewPage.report.saveToMaterial": "Save this interview to the material library",

  // ===== Timer / ready gate =====
  "interviewPage.timer.label": "Duration",
  "interviewPage.thinkingFinishReport": "This interview has ended — generating your report…",
  "interviewPage.ready.title": "Jane is ready — are you?",
  "interviewPage.ready.body":
    "We start when you say so: the timer starts when you click, pauses while you are away, and continues when you come back.",
  "interviewPage.ready.start": "I'm ready",
  "interviewPage.ready.resume": "Continue interview",
  "interviewPage.ready.hint":
    "The timer starts when you click, and the final report includes how long this interview took.",

  // ===== Interviewer setup card =====
  "interviewPage.setup.title": "Interviewer setup",
  "interviewPage.setup.greeting": "Hi, I'm Jane and I'll be interviewing you today.",
  "interviewPage.setup.jobLabel": "Related job",
  "interviewPage.setup.jobPlaceholder": "Questions follow this job's JD (type keywords to search)",
  "interviewPage.setup.jobRequired": "Select the related job",
  "interviewPage.setup.resumeLabel": "Related resume",
  "interviewPage.setup.resumePlaceholder":
    "Resumes linked to this job plus general ones (type keywords to search)",
  "interviewPage.setup.resumePlaceholderNoJob": "Pick the job first, then choose a resume",
  "interviewPage.setup.resumeRequired": "Select the related resume",
  "interviewPage.setup.scopeHint":
    "The interviewer only sees this resume and the job's JD; nothing else is passed in.",
  "interviewPage.setup.typeLabel": "Interview type",
  "interviewPage.setup.difficultyLabel": "Difficulty",
  "interviewPage.setup.styleLabel": "Interviewer style",
  "interviewPage.setup.roundsLabel": "Rounds",
  "interviewPage.setup.roundsAuto": "Auto (AI decides when to finish)",
  "interviewPage.setup.roundsOption": "{round} rounds",
  "interviewPage.setup.roundsExtra":
    "Auto sets no fixed round count: the interviewer decides when to wrap up based on your answers, which is closer to a real interview.",
  "interviewPage.setup.focusLabel": "Focus areas (optional)",
  "interviewPage.setup.focusExtra": "e.g. user growth, cross-team collaboration, cost control",
  "interviewPage.setup.focusPlaceholder": "Leave blank for general questions for this type",
  "interviewPage.setup.personaLabel": "Custom interviewer persona (optional)",
  "interviewPage.setup.personaExtra":
    "e.g. a business lead at a company who digs into concrete numbers and how things shipped. Takes priority over the default style above.",
  "interviewPage.setup.start": "Start interview",
  "interviewPage.setup.confidenceTip":
    "The interviewer asks from your materials and the job requirements; the more specific your answer (what you did, what the result was), the more useful the feedback.",

  // Display names for interview type / difficulty / interviewer style (keys are protocol values).
  "interviewPage.setup.type.technical": "Technical",
  "interviewPage.setup.type.project": "Project deep dive",
  "interviewPage.setup.type.behavioral": "Behavioral (STAR)",
  "interviewPage.setup.type.hr": "HR interview",
  "interviewPage.setup.type.general": "General",
  "interviewPage.setup.type.case": "Case study",
  "interviewPage.setup.type.english": "English interview",
  "interviewPage.setup.type.stress": "Stress interview",
  "interviewPage.setup.difficulty.junior": "Junior",
  "interviewPage.setup.difficulty.mid": "Mid-level",
  "interviewPage.setup.difficulty.senior": "Senior",
  "interviewPage.setup.style.rigorous": "Rigorous and professional",
  "interviewPage.setup.style.gentle": "Warm and guiding",
  "interviewPage.setup.style.probing": "Persistent follow-ups",
  "interviewPage.setup.style.pressure": "Pressure questioning",
} as const;

export default interviewPage;
