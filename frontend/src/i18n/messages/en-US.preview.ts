// SPDX-License-Identifier: Apache-2.0
const preview = {
  "preview.zoom.out": "Zoom out",
  "preview.zoom.in": "Zoom in",
  "preview.zoom.fit": "Fit page (reset zoom)",
  "preview.zoom.reset": "Fit page",
  "preview.zoom.hint": "Hold Ctrl and scroll to zoom",

  "preview.mode.ariaLabel": "Preview mode",
  "preview.mode.draft": "Draft",
  "preview.mode.draft.hint": "Laid out live by the browser; use this while editing",
  "preview.mode.exact": "Exact",
  "preview.mode.exact.hint":
    "Rendered from the real PDF produced by the export engine, identical to the file you download",
  "preview.exact.note":
    "This view is laid out by the export engine and matches the downloaded PDF exactly; zoom with Ctrl+scroll in the PDF viewer",
} as const;

export default preview;
