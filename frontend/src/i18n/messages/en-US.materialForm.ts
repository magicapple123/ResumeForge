// SPDX-License-Identifier: Apache-2.0
/**
 * Material form dialog: the intro, field labels and placeholders, attachment hints, and the
 * attachment validation / read-failure messages plus the save action.
 *
 * The category fallback is a protocol value (it is sent to the backend and acts as a
 * grouping key), so it stays in the component; category options come from the backend and
 * from `MATERIAL_CATEGORIES` and are shown as-is.
 */
const materialForm = {
  "materialForm.error.imageTooLarge": "A single image cannot exceed 2 MB",
  "materialForm.error.maxImages": "A material can hold at most {count} images",
  "materialForm.error.maxFiles": "A material can hold at most {count} files",
  "materialForm.error.readImage": "Could not read the image — try again",
  "materialForm.warning.noText": "This file has no readable text",
  "materialForm.error.readFile": "Could not read the file — try again",
  "materialForm.warning.needContent": "Fill in a title, content or a link, or add an attachment",
  "materialForm.error.unsupported": "Only images and text files (.txt/.md/.csv …) are supported",
  "materialForm.title.edit": "Edit material",
  "materialForm.title.create": "Add material",
  "materialForm.action.save": "Save material",
  "materialForm.action.addImage": "Add image",
  "materialForm.action.addText": "Add text file",
  "materialForm.hint.drop": "Drop to add the attachment",
  "materialForm.intro":
    "The material library holds loose material that is not part of a resume yet: certificates, work samples, links, notes and more. The assistant can read it and cite it as needed.",
  "materialForm.hint.shortcut": "Ctrl / ⌘ + Enter or S to save, Esc to cancel",
  "materialForm.hint.dropNote":
    "You can also drop files here. For PDF or Word, paste the text into the content box: the app does not keep the original file.",
  "materialForm.label.title": "Title",
  "materialForm.label.category": "Category",
  "materialForm.label.content": "Content",
  "materialForm.label.url": "Related link",
  "materialForm.label.attachments": "Attachments (up to {count} files, at most {images} images)",
  "materialForm.label.note": "Notes",
  "materialForm.placeholder.title": "e.g. CET-6 score report / portfolio link",
  "materialForm.placeholder.category": "Pick a category or type a new one",
  "materialForm.placeholder.content": "Paste the original text or write down the key points",
  "materialForm.placeholder.url": "https://… (optional)",
  "materialForm.placeholder.note": "Why you kept it and what is still missing (optional)",
  "materialForm.file.image": "Image · {size} KB",
  "materialForm.file.text": "{count} characters",
  "materialForm.aria.removeFile": "Remove attachment {name}",
} as const;

export default materialForm;
