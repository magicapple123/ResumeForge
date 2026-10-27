// SPDX-License-Identifier: Apache-2.0
/**
 * API layer: request failure, timeout, cancellation and stream-read fallbacks, the
 * error guidance line (reason / action / ref), and the download filenames used when a
 * response has no Content-Disposition header.
 *
 * Only the client's own user-facing fallbacks live here. Backend `detail` messages pass
 * through untouched, and protocol values (businessCode, `code`, the scope token) stay in
 * the code.
 */
const apiErrors = {
  // ── client.ts: request wrapper ──
  "apiErrors.http.statusFallback": "Request failed (HTTP {status})",
  /** Separator between FastAPI validation messages: a full-width semicolon in Chinese, `; ` here. */
  "apiErrors.http.detailSeparator": "; ",
  "apiErrors.network.unreachable": "Cannot reach the local service - check that the app is running",
  "apiErrors.request.cancelled": "Cancelled",
  "apiErrors.request.timeout": "Request timed out - try again",

  // ── datasetScope.ts: freezing the dataset identity at startup ──
  "apiErrors.datasetScope.confirmFailed":
    "Could not confirm the current dataset - check the local service and reload the page",

  // ── stream.ts: reading SSE ──
  "apiErrors.stream.malformed": "The stream response was malformed - try again",
  "apiErrors.stream.unsupported":
    "This browser does not support streaming responses - use a modern browser",

  // ── interview.ts: streaming an answer ──
  "apiErrors.interview.streamFailed": "The interviewer could not respond - try again",

  // ── resumes.ts / tracker.ts: fallback filenames without Content-Disposition ──
  "apiErrors.download.shareZipFilename": "resume-offline-package.zip",
  "apiErrors.download.trackerFilename": "job-applications.{format}",

  // ── errorGuidance.ts: the shared "reason / action / ref" line ──
  "apiErrors.guidance.format": "Reason: {reason} · Action: {action} · Ref: {ref}",
  "apiErrors.guidance.unknownReason": "An unknown error occurred",
  "apiErrors.guidance.retryDiagnostics":
    "Try again; if it keeps happening, export a diagnostics bundle and share it",
  "apiErrors.guidance.timeoutReason": "The request timed out",
  "apiErrors.guidance.timeoutAction":
    "Try again; for large exports or generations, retry later or reduce the scope",
  "apiErrors.guidance.networkReason": "Cannot reach the backend service",
  "apiErrors.guidance.networkAction":
    "Make sure the backend is running (the port is not taken), then try again",
  "apiErrors.guidance.cancelledReason": "The operation was cancelled",
  "apiErrors.guidance.cancelledAction": "Start it again if you want to continue",
  "apiErrors.guidance.scopeExpiredReason": "The page's connection to the local dataset expired",
  "apiErrors.guidance.scopeExpiredAction": "It re-synced automatically - try again",
  "apiErrors.guidance.conflictReason": "A task or resource conflict is in progress",
  "apiErrors.guidance.conflictAction": "Stop or wait for the current task, then try again",
  "apiErrors.guidance.forbiddenReason": "This request is not allowed",
  "apiErrors.guidance.forbiddenAction":
    "Check your sign-in state, or use the page from the app running on this machine",
  "apiErrors.guidance.tooLargeReason": "The request body is too large",
  "apiErrors.guidance.tooLargeAction": "Reduce the upload size and try again",
  "apiErrors.guidance.serverReason": "Internal server error",
  "apiErrors.guidance.retryWithRef":
    "Try again; if it keeps happening, export a diagnostics bundle and include the ref",
} as const;

export default apiErrors;
