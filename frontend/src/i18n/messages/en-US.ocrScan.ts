// SPDX-License-Identifier: Apache-2.0
/** Scanned-document OCR panel (the "Scan OCR" entry inside resume recognition). */
const ocrScan = {
  "ocrScan.entry": "Scan OCR",
  "ocrScan.title": "Scanned document OCR",
  "ocrScan.hint":
    "Upload a scanned PDF or image with no text layer; DeepSeek recognizes it page by page (billed per page). Recognition runs on the server, so closing this dialog does not stop it.",
  "ocrScan.pickFile": "Choose file",
  "ocrScan.start": "Start recognition",
  "ocrScan.cancelUpload": "Cancel upload",
  "ocrScan.stopWaiting": "Stop waiting",
  "ocrScan.stopNote":
    "Stopping only stops the progress refresh: the server still finishes recognition and bills for it. There is no partial refund.",
  "ocrScan.uploading": "Uploading the original file…",
  "ocrScan.recognizing": "Recognizing…",
  "ocrScan.pages": "Recognized {done} of {total} pages",
  "ocrScan.elapsed": "Elapsed {seconds}s",
  "ocrScan.resultTitle": "Recognized text",
  "ocrScan.chars": "{count} characters",
  "ocrScan.copy": "Copy all",
  "ocrScan.copied": "Copied",
  "ocrScan.close": "Close",
  "ocrScan.failed": "Recognition failed: {reason}",
  "ocrScan.noFile": "Choose a file first",
  "ocrScan.emptyResult": "Recognized, but no text was found — try a clearer scan",
  "ocrScan.fileTooLarge": "File exceeds the 100 MB limit",
  "ocrScan.stopped": "Stopped waiting (the server is still recognizing)",
};

export default ocrScan;
