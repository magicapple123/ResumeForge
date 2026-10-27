// SPDX-License-Identifier: Apache-2.0
/**
 * Display names for the job-domain enums: job type, job status, recognition
 * source, and candidate source.
 *
 * The keys are the values stored in the database (and the backend protocol
 * values), never translated on the data side; this pack only supplies the
 * display names that `src/i18n/enum/jobs.ts` looks up by protocol value.
 */
const enumsJobs = {
  "enumsJobs.jobType.campus": "Campus",
  "enumsJobs.jobType.internship": "Internship",
  "enumsJobs.jobType.experienced": "Experienced hire",
  "enumsJobs.jobType.other": "Other",

  "enumsJobs.status.open": "Open",
  "enumsJobs.status.closed": "Closed",
  "enumsJobs.status.applied": "Applied",

  "enumsJobs.recognitionSource.manual": "Manual entry",
  "enumsJobs.recognitionSource.pastedText": "Pasted text",
  "enumsJobs.recognitionSource.image": "Image recognition",
  "enumsJobs.recognitionSource.document": "Document recognition",
  "enumsJobs.recognitionSource.candidate": "Imported from Candidate Jobs",
  "enumsJobs.recognitionSource.assistant": "Added by the assistant",
  "enumsJobs.recognitionSource.collected": "Collected",
  "enumsJobs.recognitionSource.officialSite": "Collected from the company site",

  "enumsJobs.candidateSource.manualAdd": "Added manually",
  "enumsJobs.candidateSource.pastedText": "Pasted text",
  "enumsJobs.candidateSource.screenshot": "Hiring screenshot",
  "enumsJobs.candidateSource.document": "Hiring document",
  "enumsJobs.candidateSource.assistant": "Added by the assistant",
} as const;

export default enumsJobs;
