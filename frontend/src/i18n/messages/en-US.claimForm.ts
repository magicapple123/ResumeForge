// SPDX-License-Identifier: Apache-2.0
/** Fact ledger form (mirrors zh-CN.claimForm.ts). */
const claimForm = {
  "claimForm.title.edit": "Edit entry",
  "claimForm.title.create": "New entry",
  "claimForm.action.save": "Save entry",
  "claimForm.toast.saved": "Entry saved",
  "claimForm.toast.created": "Added to the fact ledger",
  "claimForm.toast.saveFailed": "Could not save",

  "claimForm.field.title": "Title",
  "claimForm.placeholder.title":
    "A searchable name, e.g. “search API for the campus retrieval platform”",
  "claimForm.field.category": "Category",
  "claimForm.field.subject": "Subject",
  "claimForm.hint.subject":
    "Who this claim is about: a company, a project, a school or a skill. Resume generation uses it to point back to the matching experience.",
  "claimForm.placeholder.subject": "e.g. “campus knowledge retrieval platform”",
  "claimForm.field.sourceFact": "Source fact",
  "claimForm.hint.sourceFact":
    "Write it as it happened, without polishing. Everything else is checked against this.",
  "claimForm.required.sourceFact": "Describe the source fact",
  "claimForm.placeholder.sourceFact": "What I actually did, and how far it went",
  "claimForm.field.wording": "Resume wording",
  "claimForm.hint.wording":
    "The version that goes into the Resume. It must not claim more than the source fact; mark anything unverified with [TODO: what is missing].",
  "claimForm.placeholder.wording": "e.g. “built the search API and shipped it end to end”",
  "claimForm.field.responsibility": "Responsibility",
  "claimForm.responsibility.hint.participate":
    "Did part of the work under someone else's direction",
  "claimForm.responsibility.hint.ownModule":
    "Independently owned one clearly defined module or area",
  "claimForm.responsibility.hint.leadDelivery":
    "Set the approach and drove delivery while others supported you",
  "claimForm.responsibility.hint.owner": "Accountable for the whole project's outcome",
  "claimForm.field.verification": "Verification",
  "claimForm.field.lastVerified": "Last verified",
  "claimForm.field.boundary": "Personal boundary",
  "claimForm.hint.boundary":
    "What the team did versus what you did. Verified entries go into the real Resume, so this line is your defense in an interview.",
  "claimForm.placeholder.boundary":
    "e.g. “I built the API; the retrieval algorithm was another student's work”",
  "claimForm.field.allowedUses": "Allowed uses",
  "claimForm.placeholder.allowedUses":
    "Press Enter to add, e.g. “AI role Resume”, “HR opening line”. Leave empty for no restriction.",

  "claimForm.evidence.title": "Evidence sources (where to find it — do not paste content)",
  "claimForm.placeholder.evidence": "A link, a file name, or “advisor can confirm”",
  "claimForm.evidence.public": "Public",
  "claimForm.evidence.private": "Private",
  "claimForm.evidence.removeAria": "Remove this evidence",
  "claimForm.evidence.add": "Add evidence source",

  "claimForm.interview.title":
    "Interview details (the parts you can defend under follow-up questions; essential for strong claims)",
  "claimForm.field.decisions": "Decisions you made",
  "claimForm.field.difficulties": "Difficulties",
  "claimForm.field.howVerified": "How it was verified",
  "claimForm.field.result": "Result",
  "claimForm.placeholder.result":
    "Without reliable numbers, describe the outcome qualitatively — do not invent figures",
  "claimForm.field.riskNotes": "Risk notes",
  "claimForm.hint.riskNotes": "What an interviewer might probe, and where the claim is still weak.",
  "claimForm.hint.onePerLine": "One per line",
  "claimForm.placeholder.riskNotes": "Press Enter to add, e.g. “metric definition unclear”",
} as const;

export default claimForm;
