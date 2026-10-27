// SPDX-License-Identifier: Apache-2.0
/**
 * Runtime notices raised by the file and attachment utilities: attachment reads,
 * downloads and printing, PDF-to-PNG rendering, and image export packaging.
 */
const fileUtils = {
  "fileUtils.attachments.error.read": "Could not read the attachment",
  "fileUtils.download.error.popupBlocked":
    "Your browser blocked the popup. Allow popups for this site and try again",
  "fileUtils.pdfToPng.error.canvasToPng":
    "The browser could not convert the canvas to PNG (the canvas may be too large)",
  "fileUtils.pdfToPng.error.noPages": "This PDF has no pages that can be rendered",
  "fileUtils.pngExport.fallbackStem": "Resume",
  "fileUtils.pngExport.error.conversionFailed":
    "The PDF was created, but the image conversion failed. Use the “PDF” export instead if you need to submit an application.",
  "fileUtils.pngExport.error.conversionFailedWithDetail":
    "The PDF was created, but the image conversion failed: {detail}. Use the “PDF” export instead if you need to submit an application.",
} as const;

export default fileUtils;
