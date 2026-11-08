// SPDX-License-Identifier: Apache-2.0
/**
 * Voice dictation: the microphone button, recording privacy hint, error copy, the
 * Settings "Voice transcription" card, and the recording hints in the interview
 * answer box / follow-up input.
 *
 * Errors decided by the backend (auth failure, missing endpoint, upstream error)
 * are intentionally not translated here: the server's Chinese reason is passed
 * through so users can see which part of the configuration is wrong. Only the
 * conditions detected on the client live in this file.
 *
 * The {host} placeholder is a hostname only (no path, no key), provided by
 * /api/transcribe/status.
 */
const voiceInput = {
  "voiceInput.aria.start": "Start voice input",
  "voiceInput.aria.stop": "Stop recording",
  "voiceInput.status.transcribing": "Transcribing",
  "voiceInput.tooltip.start": "Click to start dictation (up to {seconds} seconds per clip)",

  "voiceInput.hint.privacy": "Audio will be sent to {host}",
  "voiceInput.hint.notConfigured": "Voice service not configured",
  "voiceInput.hint.notConfiguredHelp":
    "Go to Settings → Voice transcription to fill in the address and key",

  "voiceInput.error.noMicrophone": "No microphone found. Connect one and try again",
  "voiceInput.error.permissionDenied":
    "Microphone permission was denied. Allow it in the browser address bar and try again",
  "voiceInput.error.recordingFailed": "Recording failed. Please record again",
  "voiceInput.error.unsupported":
    "This browser cannot record audio. Use a recent Chrome, Edge or Safari",
  "voiceInput.error.timeout": "Transcription timed out. Check the voice service and try again",
  "voiceInput.error.notConfigured":
    "Voice service not configured. Go to Settings → Voice transcription and fill in the address and key",
  "voiceInput.error.tooLarge": "The audio exceeds 10 MB. Shorten the recording and try again",
  "voiceInput.error.empty":
    "No speech was recognized. Move closer to the microphone and speak again",
  "voiceInput.error.serviceFailed": "The voice service is temporarily unavailable. Try again later",
  "voiceInput.error.backendTooOld":
    "This backend version does not support voice. Restart and try again",

  "voiceInput.action.submitBlocked": "Stop recording first",

  "voiceInput.settings.title": "Voice transcription",
  "voiceInput.settings.intro":
    "Voice is used for dictation only: stop the recording and the text is placed in the input box for you to review and submit. Audio is sent to the provider configured below; this app does not store audio.",
  "voiceInput.settings.providerNote":
    "DeepSeek cannot transcribe audio. Configure an OpenAI-compatible service here (OpenAI, Groq, SiliconFlow, etc.).",
  "voiceInput.settings.baseUrl.label": "Service address",
  "voiceInput.settings.baseUrl.aria": "Voice service address",
  "voiceInput.settings.baseUrl.placeholder": "https://api.openai.com/v1 (example)",
  "voiceInput.settings.baseUrl.hint":
    "The Base URL of an OpenAI-compatible service, including the path prefix the provider requires (usually /v1).",
  "voiceInput.settings.model.label": "Model",
  "voiceInput.settings.model.aria": "Voice transcription model",
  "voiceInput.settings.model.placeholder": "Model name, e.g. whisper-1",
  "voiceInput.settings.model.hint":
    "A transcription model the provider supports, e.g. whisper-1, whisper-large-v3, FunAudioLLM/SenseVoiceSmall.",
  "voiceInput.settings.key.label": "Voice service API key",
  "voiceInput.settings.key.aria": "Voice service API key",
  "voiceInput.settings.key.placeholder": "Paste the voice provider's API key",
  "voiceInput.settings.key.hint":
    "A saved key is shown as ********; leave it untouched to keep it, or use Clear saved key to remove it.",
  "voiceInput.settings.key.clear": "Clear saved key",
  "voiceInput.settings.key.cleared": "Saved voice service key cleared",
  "voiceInput.settings.save": "Save",
  "voiceInput.settings.saved": "Voice transcription settings saved",
  "voiceInput.settings.saveFailed": "Failed to save voice transcription settings",
  "voiceInput.settings.test": "Test connection",
  "voiceInput.settings.testing": "Testing…",
  "voiceInput.settings.testFailed": "Connection test failed",
  "voiceInput.settings.loadErrorTitle": "Could not load the saved voice transcription settings",
  "voiceInput.settings.loadErrorBody":
    "{message}. The empty form is shown below; saving will overwrite the server settings.",
  "voiceInput.settings.loadFailed": "Failed to load voice transcription settings",
  "voiceInput.settings.badge.configured": "Configured",
  "voiceInput.settings.badge.notConfigured": "Not configured",
  "voiceInput.settings.limitHint":
    "Up to 3 minutes / 10 MB per clip; 3 minutes for interview answers and 1 minute for follow-up questions.",
  "voiceInput.settings.privacyNote":
    "After saving, recordings go to {host}; this app does not store audio.",
} as const;

export default voiceInput;
