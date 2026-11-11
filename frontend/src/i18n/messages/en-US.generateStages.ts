// SPDX-License-Identifier: Apache-2.0
/**
 * The three stages of the generation dialog: running (step bar, progress line,
 * background notice and its two actions), failed (error title, back and
 * regenerate) and preview (go to Resume Center, regenerate, done).
 *
 * Step titles come from `appConfig.progressStage.*`; `{message}` in the
 * progress line is a backend `progress` event, so it is interpolated as is.
 */
const generateStages = {
  "generateStages.progress.preparing": "Preparing…",
  "generateStages.progress.status": "{message} · {count} characters received",
  "generateStages.progress.backgroundAlert":
    "Generation has started in the background: closing this window will not interrupt it. When it finishes you will be notified and the result will open.",
  "generateStages.action.continueInBackground": "Continue in background (close window)",
  "generateStages.action.cancel": "Cancel generation",

  "generateStages.error.title": "Generation failed",
  "generateStages.error.back": "Back and retry",
  "generateStages.action.regenerate": "Regenerate",

  "generateStages.preview.goResumes": "Go to Resume Center",
  "generateStages.preview.done": "Done",

  // #30 semantic retrieval receipt (progress badge + result audit share the five states)
  "generateStages.rag.progress.label": "Semantic search",
  "generateStages.rag.state.off": "Off · keyword matching only",
  "generateStages.rag.state.empty": "Enabled · index is empty",
  "generateStages.rag.state.miss": "Enabled · no matches this time",
  "generateStages.rag.state.hit": "Used · {count} matches",
  "generateStages.rag.state.fallback": "Timed out, fell back to keywords · {ms} ms",
  "generateStages.rag.enable": "Turn on",
  "generateStages.rag.audit.hit":
    "Semantic search used · {count} matches, {impacts} entries affected",
  "generateStages.rag.audit.expand": "Show details",
  "generateStages.rag.audit.collapse": "Hide details",
  "generateStages.rag.audit.jump": "Open in profile",
  "generateStages.rag.audit.exportNote":
    "Structured search details are shown only for this generation; exports do not include them",
} as const;

export default generateStages;
