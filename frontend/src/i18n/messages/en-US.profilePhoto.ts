// SPDX-License-Identifier: Apache-2.0
/**
 * Resume photo panel: upload, photo library, and switching or deleting photos.
 */
const profilePhoto = {
  "profilePhoto.action.choose": "Choose photo",
  "profilePhoto.action.uploadNew": "Upload new photo",
  "profilePhoto.action.library": "Photo Library ({count})",

  "profilePhoto.upload.success": "Photo saved; choose which one to use here",
  "profilePhoto.upload.formatError": "Select a JPG, PNG or WebP photo",
  "profilePhoto.upload.tooLarge": "Photos cannot exceed {size} MB",
  "profilePhoto.upload.limit":
    "You can save up to {count} photos; delete one you no longer use first",
  "profilePhoto.upload.failed": "Could not upload the photo",
  "profilePhoto.upload.progress": "Photo upload progress",
  "profilePhoto.upload.dropHint": "Drop to upload the photo",
  "profilePhoto.upload.dropRejected": "Only JPG, PNG or WebP photos are supported",
  "profilePhoto.upload.formatsHint": "JPG, PNG or WebP, up to {size} MB, {count} photos max",
  "profilePhoto.upload.loading": "Loading photos…",

  "profilePhoto.preview.alt": "Resume photo",

  "profilePhoto.switch.success": "Resume photo changed",
  "profilePhoto.switch.failed": "Could not switch the resume photo",

  "profilePhoto.delete.success": "Photo deleted",
  "profilePhoto.delete.failed": "Could not delete the photo",

  "profilePhoto.library.title": "Photo Library",
  "profilePhoto.library.description":
    "Select a photo to use on your resume; only that photo will appear there.",
  "profilePhoto.library.tooltipActive": "Currently in use",
  "profilePhoto.library.tooltipSelect": "Use as resume photo",
  "profilePhoto.library.selectAria": "Use photo {name}",
  "profilePhoto.library.deleteAria": "Delete photo {name}",
  "profilePhoto.library.activeTag": "In use",
  "profilePhoto.library.photoAlt": "Photo",
  "profilePhoto.library.empty":
    "No alternate photos yet. Upload a new photo and it will appear here, ready to switch to.",
} as const;

export default profilePhoto;
