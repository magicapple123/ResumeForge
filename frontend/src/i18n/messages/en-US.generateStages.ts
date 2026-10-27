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
} as const;

export default generateStages;
