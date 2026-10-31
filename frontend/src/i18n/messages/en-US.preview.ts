// SPDX-License-Identifier: Apache-2.0
const preview = {
  "preview.zoom.out": "Zoom out",
  "preview.zoom.in": "Zoom in",
  "preview.zoom.fit": "Fit page (reset zoom)",
  "preview.zoom.reset": "Fit page",
  "preview.zoom.scrollHint": "The page is wider than the frame: drag sideways to see it all",
  "preview.zoom.hint": "Hold Ctrl and scroll to zoom",

  "preview.mode.ariaLabel": "Preview mode",
  "preview.mode.draft": "Draft",
  "preview.mode.draft.hint": "Laid out live by the browser; use this while editing",
  "preview.mode.exact": "Exact",
  "preview.mode.exact.hint":
    "Rendered from the real PDF produced by the export engine, identical to the file you download",
  "preview.exact.note":
    "This view is laid out by the export engine and matches the downloaded PDF exactly; zoom with the buttons below the page (Ctrl+scroll also works)",

  "preview.exact.errorTitle": "Could not generate the exact preview",
  "preview.exact.errorHint":
    "The draft preview is unaffected — switch back to Draft to keep editing. Exporting the PDF likely fails for the same reason (most often the Chinese font is missing on this machine).",
  "preview.exact.typesetting": "Typesetting with the export engine...",
  "preview.exact.frameTitle": "Exact resume preview (exported PDF)",
  "preview.exact.pendingFrameTitle": "Exact preview loading",
  "preview.exact.loadTimeoutTitle": "Embedded preview timed out",
  "preview.exact.loadTimeoutBody":
    "The PDF is ready but the viewer did not finish loading in time. Open it in a new tab, or switch to Draft and back to Exact to retry.",
  "preview.exact.noViewerTitle": "This environment has no built-in PDF viewer",
  "preview.exact.noViewerBody":
    "The PDF has already been laid out by the export engine, but it cannot be embedded here. Use the button below to open it in your system PDF reader — the content is exactly what Export downloads.",
  "preview.exact.openInSystemViewer": "Open in system viewer",
  "preview.exact.overflowNote":
    "Font size, line spacing and margins render exactly as you set them and are never shrunk automatically; the part over the limit will not be shown — tighten the layout or add more pages to see everything.",

  "preview.canvas.warningsTitle":
    "The following content needs a manual check (it may be AI-generated)",
  "preview.canvas.overflowBody":
    "Font size, line spacing and margins render exactly as you set them and are never shrunk automatically; {amount} {note}",
  "preview.canvas.note.overflow":
    "The part over the limit will not be shown — tighten the layout or add more pages to see everything.",
  "preview.canvas.note.approximate":
    "The multi-page view is an approximate split at A4 height; browser print and the downloaded PDF are authoritative.",
  "preview.canvas.frameTitle": "Resume preview",
  "preview.canvas.frameTitlePage": "Resume preview, page {page}",
  "preview.canvas.pageLabel": "Page {page} of {total} (approximate)",

  "preview.geometry.overflowPercent": "The content is about {percent}% of a page too long.",
  "preview.geometry.overflowPages": "The content is about {pages} pages too long.",
  "preview.geometry.overflowUnknown": "The exact overflow cannot be measured yet.",
} as const;

export default preview;
