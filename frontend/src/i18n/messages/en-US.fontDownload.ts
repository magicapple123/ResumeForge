// SPDX-License-Identifier: Apache-2.0
const fontDownload = {
  "fontDownload.download": "Download",
  "fontDownload.downloading": "Downloading... {done} / {total}",
  "fontDownload.downloadingNoTotal": "Downloading... {done}",
  "fontDownload.progress": "Downloading... {percent}%",
  "fontDownload.downloadFailed": "Download failed: {error}",
  "fontDownload.downloadFailedNoReason": "Download failed",
  "fontDownload.retry": "Retry",
  "fontDownload.downloaded": "Downloaded",
  "fontDownload.downloadedAndSet": "Downloaded and set as this Resume's font",
  "fontDownload.cancel": "Cancel",
  "fontDownload.canceling": "Canceling...",
  "fontDownload.cancelFailed": "Could not cancel: {error}",
  "fontDownload.alreadyDownloading": "Font download is already in progress",
  "fontDownload.optionHint": "Select this row to download",
  "fontDownload.delete": "Delete",
  "fontDownload.deleteConfirmTitle": "Delete the downloaded built-in font?",
  "fontDownload.deleteConfirmBody":
    "The font file will be deleted directly, with no restore option. Download it again for any Resume that needs it. Resumes currently using it will revert to the system font.",
  "fontDownload.deleted": "Downloaded built-in font deleted",
  "fontDownload.deletedAndResetToSystem": "Font deleted; Resume now uses the system font",
  "fontDownload.deleteFailed": "Could not delete font: {error}",
  "fontDownload.sampleTitle": "Font sample",
  "fontDownload.sampleUnavailable": "Font file is unavailable",
  "fontDownload.sampleNotDownloaded": "Download to preview",
  "fontDownload.sampleLineTitle": "Alex Taylor - Backend Engineer",
  "fontDownload.sampleLineMixed": "QPS 8,500 - P99 reduced by 42% - Jul 2022 - Sep 2024",
  "fontDownload.sampleLinePunct": "!?;:\"'()[]--...",
  "fontDownload.sampleLineBold":
    "This line is bold so you can check the weight and clarity of its strokes.",
  "fontDownload.sampleActivate": "Use this font",
  "fontDownload.sampleActive": "Currently in use",
  "sections.arrangeByProfile": "Use My Profile Section order",
  "sections.arrangeByProfileHint":
    "Set this Resume's Section order to match My Profile. Later changes to your Profile order will not change this Resume.",
  "sections.profileOrderUnavailable": "My Profile has no Sections that can be reordered yet",
  "sections.profileOrderSame": "Profile order already matches the default order",
  "exact.serifNote":
    "Exact preview uses an available local CJK sans-serif font; its heading font differs from the draft",
} as const;

export default fontDownload;
