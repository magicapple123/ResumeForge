// SPDX-License-Identifier: Apache-2.0
/**
 * Interview domain enum labels: interview type, difficulty, interviewer style,
 * experience source and experience round.
 *
 * The values are display names only; the protocol values themselves are submitted
 * unchanged (they live in `types/interview.ts` and `types/interviewExperience.ts`).
 * The protocol value -> key mapping is in `i18n/enum/interview.ts`.
 */
const enumsInterview = {
  // ===== Interview type (display names for INTERVIEW_TYPES) =====
  "enumsInterview.type.technical": "Technical",
  "enumsInterview.type.project": "Project deep dive",
  "enumsInterview.type.behavioral": "Behavioral (STAR)",
  "enumsInterview.type.hr": "HR interview",
  "enumsInterview.type.general": "General",
  "enumsInterview.type.case": "Case study",
  "enumsInterview.type.english": "English interview",
  "enumsInterview.type.stress": "Stress interview",

  // ===== Difficulty (display names for INTERVIEW_DIFFICULTIES) =====
  "enumsInterview.difficulty.junior": "Junior",
  "enumsInterview.difficulty.mid": "Mid-level",
  "enumsInterview.difficulty.senior": "Senior",

  // ===== Interviewer style (display names for INTERVIEWER_STYLES) =====
  "enumsInterview.style.rigorous": "Rigorous and professional",
  "enumsInterview.style.gentle": "Warm and guiding",
  "enumsInterview.style.probing": "Persistent follow-ups",
  "enumsInterview.style.pressure": "Pressure questioning",

  // ===== Experience source (display names for EXPERIENCE_SOURCE_LABELS) =====
  "enumsInterview.experienceSource.self": "Self",
  "enumsInterview.experienceSource.peer": "Peer",
  "enumsInterview.experienceSource.public": "Public",

  // ===== Experience round (display names for EXPERIENCE_ROUND_TYPES) =====
  "enumsInterview.experienceRound.first": "First round",
  "enumsInterview.experienceRound.second": "Second round",
  "enumsInterview.experienceRound.third": "Third round",
  "enumsInterview.experienceRound.hr": "HR round",
  "enumsInterview.experienceRound.writtenTest": "Written test",
  "enumsInterview.experienceRound.other": "Other",
} as const;

export default enumsInterview;
