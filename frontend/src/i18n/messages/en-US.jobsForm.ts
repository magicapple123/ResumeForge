// SPDX-License-Identifier: Apache-2.0
/**
 * The two display blocks inside the job form: note images (`NoteImagesField`)
 * and recognition (`RecognitionSourceSection`) - labels, placeholders, hints and
 * accessible names.
 */
const jobsForm = {
  "jobsForm.noteImages.label": "Note images (optional, up to {count})",
  "jobsForm.noteImages.add": "Add image",
  "jobsForm.noteImages.hint":
    "Job posting screenshots, referral codes, and so on - up to 2 MB each",
  "jobsForm.noteImages.imageAlt": "Note image {index}",
  "jobsForm.noteImages.remove": "Remove note image {index}",
  "jobsForm.recognition.label": "Full job posting",
  "jobsForm.recognition.placeholder":
    "Paste the full posting - job title, location, description, requirements - or press Ctrl+V to paste a screenshot (you can also upload a pdf/docx posting)",
  "jobsForm.recognition.submit": "Recognize and fill",
  "jobsForm.recognition.warningSeparator": "; ",
} as const;

export default jobsForm;
