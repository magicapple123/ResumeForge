// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位详情抽屉：操作入口、投递台准入提示、字段表与三个折叠区。
 *
 * 录入方式（`recognition_source || "手动"`）是后端返回的协议值，保持中文。
 */
const jobDetail = {
  "jobDetail.title": "Job details",
  "jobDetail.action.generate": "Generate a Resume with AI",
  "jobDetail.action.write": "Write a Resume manually",
  "jobDetail.action.viewResume": "View the generated Resume",
  "jobDetail.action.readRequirement": "Read the requirements",
  "jobDetail.hint.readRequirement": "Reads only the posting and summarises what the Job asks for",
  "jobDetail.hint.matchRunning":
    "Match analysis is running in the background; a notification will follow",
  "jobDetail.hint.matchIdle": "Reads your Profile and Resumes to judge how well you fit",
  "jobDetail.action.analyzing": "Analysing…",
  "jobDetail.action.match": "Match analysis",
  "jobDetail.hint.unsupported":
    "This Job's source is not a job board the apply desk supports, so it cannot be auto-applied",
  "jobDetail.hint.applyDesk":
    "Adds it to the apply desk queue; real gaps or missing analysis ask for your confirmation first",
  "jobDetail.action.applyDesk": "Add to apply desk",
  "jobDetail.action.askAssistant": "Ask the assistant",
  "jobDetail.section.progress": "Application progress for this Job",
  "jobDetail.action.interview": "Mock interview",
  "jobDetail.action.goApply": "Go and apply",
  "jobDetail.action.favorite": "Favourite this Job",
  "jobDetail.action.unfavorite": "Remove from favourites",
  "jobDetail.unsupported.title": "This Job cannot be auto-applied from the apply desk",
  "jobDetail.unsupported.body":
    "The apply desk can only auto-apply to Jobs posted on a job board — either the source or the apply link must point at a supported site, and this Job has neither, so Add to apply desk is greyed out. Either change its apply link to the Job's address on the job board (that is enough to enable auto-apply), or use Go and apply above, or apply through the original channel.",
  "jobDetail.field.company": "Company",
  "jobDetail.field.location": "Location",
  "jobDetail.field.salary": "Salary range",
  "jobDetail.field.jobType": "Job type",
  "jobDetail.field.status": "Status",
  "jobDetail.field.postedAt": "Posted",
  "jobDetail.field.source": "Source",
  "jobDetail.field.recognitionSource": "Entry method",
  "jobDetail.section.skills": "Skill tags",
  "jobDetail.section.description": "Job description",
  "jobDetail.section.requirements": "Requirements",
  "jobDetail.section.extra": "Other recruiting information",
  "jobDetail.section.note": "Notes",
  "jobDetail.empty.description": "No Job description yet",
  "jobDetail.empty.requirements": "No requirements yet",
  "jobDetail.empty.extra": "No other recruiting information yet",
  "jobDetail.empty.note": "No notes yet",
  "jobDetail.section.noteImages": "Note images",
  "jobDetail.alt.noteImage": "Note image {index}",
} as const;

export default jobDetail;
