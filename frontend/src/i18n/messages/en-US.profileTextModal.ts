// SPDX-License-Identifier: Apache-2.0
/**
 * Paste-and-recognize modal used by both the Resume Profile page and the Web form Profile
 * page: titles, example placeholders, intro paragraphs, upload and parse states, review
 * notices, action buttons, and the separator that joins several warnings.
 */
const profileTextModal = {
  "profileTextModal.profile.title": "Paste Profile details and recognize",
  "profileTextModal.profile.placeholder":
    "e.g.\nName: Alex Chen\nEducation\nExample University | Marketing | Bachelor's degree | 2022.09-2026.06\nProjects\nCampus job fair planning | Lead | Event planning, partner outreach",
  "profileTextModal.profile.intro":
    "Paste one block of text covering basic information, education, internship/work experience, campus activities, projects, skills and awards. You can also paste screenshots of this content (press Ctrl+V in the box below) or upload a resume document (pdf/docx). Document text is extracted on this device and the original file is not uploaded; if a model is configured, the content is sent to that model for structured recognition. Recognized items are listed for you to check and are only written to the form after you confirm. Recognizing images requires a multimodal model with image input support.",
  "profileTextModal.webform.title": "Paste Web form details and recognize",
  "profileTextModal.webform.placeholder":
    "e.g.\nPolitical status: CPC member\nHigh school diploma: Yes\nEmergency contact: Alex Chen 13800000000",
  "profileTextModal.webform.intro":
    "Paste a whole screen of Web form fields at once (screenshots or PDF/Word also work) and the app will place each item in the Web form Profile field directory. **Fields outside the directory are listed for confirmation first** and are only added after you tick them: recognition can guess, but your Profile details should not be guessed for you.",
  "profileTextModal.action.cancel": "Cancel",
  "profileTextModal.action.close": "Close",
  "profileTextModal.action.cancelRecognize": "Cancel recognition",
  "profileTextModal.action.recognize": "Recognize and fill in",
  "profileTextModal.action.apply": "Fill in {count} items",
  "profileTextModal.review.count":
    "Recognized {count} items. Check them before filling in (editable in place)",
  "profileTextModal.review.hint":
    "Recognition is inferred automatically and may differ from the source. Review each item before confirming; it is easier than fixing it later.",
  "profileTextModal.input.textAria": "Profile text",
  "profileTextModal.upload.progressAria": "Attachment upload progress",
  "profileTextModal.upload.parsing": "Parsing the details…",
  "profileTextModal.separator.warning": "; ",
} as const;

export default profileTextModal;
