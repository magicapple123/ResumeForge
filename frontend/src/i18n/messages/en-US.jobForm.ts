// SPDX-License-Identifier: Apache-2.0
/**
 * The create / edit job dialog (`JobFormModal`) and its static fields
 * (`JobFormFields`): dialog titles, field labels, placeholders, validation
 * messages, and the recognition and batch-save toasts.
 *
 * Two kinds of text stay in the component on purpose: the recognition sources
 * ("manual", "pasted text", "image", "document") are protocol values submitted to
 * the backend (`JOB_RECOGNITION_SOURCES`), and job type / status are values stored
 * in the database (`types/job.ts`), whose display names can only be localized
 * once that table carries label keys (a separate batch).
 */
const jobForm = {
  "jobForm.title.create": "Add job",
  "jobForm.title.edit": "Edit job",
  "jobForm.title.confirmImport": "Confirm the job postings to import",
  "jobForm.field.title": "Job title",
  "jobForm.field.company": "Company",
  "jobForm.field.location": "Location",
  "jobForm.field.salary": "Salary range",
  "jobForm.field.jobType": "Job type",
  "jobForm.field.status": "Status",
  "jobForm.field.sourceUrl": "Application link",
  "jobForm.field.postedAt": "Posted on (optional)",
  "jobForm.field.description": "Job description (JD)",
  "jobForm.field.requirements": "Requirements (optional)",
  "jobForm.field.additionalInfo": "Other hiring info (optional)",
  "jobForm.field.note": "Note (optional)",
  "jobForm.required.title": "Enter the job title",
  "jobForm.required.description": "Enter the job description",
  "jobForm.required.url": "Enter a valid URL",
  "jobForm.placeholder.title": "e.g. Marketing specialist (campus)",
  "jobForm.placeholder.company": "e.g. Example Tech",
  "jobForm.placeholder.location": "e.g. Beijing",
  "jobForm.placeholder.salary": "e.g. 25-40K, 15 months",
  "jobForm.placeholder.sourceUrl": "Application link on the company careers page (optional)",
  "jobForm.placeholder.description": "Paste the full JD - AI tailors the resume to it",
  "jobForm.placeholder.requirements":
    "Fill in the requirements separately if you have them, otherwise leave it empty",
  "jobForm.placeholder.additionalInfo":
    "e.g. team intro, job ID, benefits, work schedule, application or interview process",
  "jobForm.placeholder.note":
    "Application progress, referral contacts, interview schedule, and so on",
  "jobForm.images.tooLarge": "A single image cannot exceed 2 MB",
  "jobForm.images.limit": "A note can hold at most {count} images",
  "jobForm.images.readFailed": "Could not read the image - try again",
  "jobForm.parse.needMaterial": "Paste the job posting, or add a screenshot or document first",
  "jobForm.parse.noContent": "Nothing was recognized - check the material or try again later",
  "jobForm.parse.noFields": "Nothing was recognized, so the form was left unchanged",
  "jobForm.parse.failed": "Could not recognize the job posting",
  "jobForm.parse.multiFound": "Found {count} job postings - review them before saving",
  "jobForm.parse.filledByAi": "AI filled in the form - check the fields before saving",
  "jobForm.parse.filledByRule": "Local rules filled in the form - check the fields before saving",
  "jobForm.drafts.engineAi": "Split by AI",
  "jobForm.drafts.engineRule": "Split by separators",
  "jobForm.drafts.fallbackTitle": "Untitled job",
  "jobForm.drafts.unnamed": "Unnamed job",
  "jobForm.drafts.failure": "{title}: {reason}",
  "jobForm.drafts.saved": "Saved {count} jobs",
  "jobForm.drafts.partialFailed": "{count} jobs were not saved: {message}",
  "jobForm.save.updated": "Job updated",
  "jobForm.save.created": "Job added",
  "jobForm.save.failed": "Could not save",
} as const;

export default jobForm;
