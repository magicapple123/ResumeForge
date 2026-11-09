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

  "voiceInput.settings.cardHint":
    "Audio goes only to the provider you pick; this app keeps no recording",

  "voiceInput.settings.provider.label": "Provider",
  "voiceInput.settings.provider.aria": "Choose a speech provider",
  "voiceInput.settings.provider.hint":
    "Picking one fills the address, protocol and default model; you can still edit them",
  "voiceInput.settings.provider.openai": "OpenAI",
  "voiceInput.settings.provider.groq": "Groq",
  "voiceInput.settings.provider.siliconflow": "SiliconFlow",
  "voiceInput.settings.provider.dashscope": "Alibaba Cloud Bailian",
  "voiceInput.settings.provider.custom": "Custom",
  "voiceInput.settings.provider.note.openai": "gpt-transcribe is the official pick",
  "voiceInput.settings.provider.note.groq": "OpenAI-compatible; 25 MB on the free tier",
  "voiceInput.settings.provider.note.siliconflow": "Strong Chinese results; 50 MB per file",
  "voiceInput.settings.provider.note.dashscope": "Qwen-ASR uses the chat API, not whisper",
  "voiceInput.settings.provider.note.custom": "Fill in the address, protocol and model yourself",

  "voiceInput.settings.protocol.label": "Call protocol",
  "voiceInput.settings.protocol.aria": "Speech service call protocol",
  "voiceInput.settings.protocol.openai": "OpenAI-compatible",
  "voiceInput.settings.protocol.dashscope": "Alibaba Cloud Bailian",
  "voiceInput.settings.protocol.hint":
    "Bailian's compatible endpoint rejects whisper-style uploads and keeps returning 400",

  "voiceInput.settings.model.fetch": "Fetch model list",
  "voiceInput.settings.model.fetched": "Fetched {count} models",
  "voiceInput.settings.model.fetchEmpty": "No models returned; just type the name",
  "voiceInput.settings.model.fetchFailed": "Could not fetch models; you can type the name",
  "voiceInput.settings.model.showAll": "Show all models",
  "voiceInput.settings.model.retiredOption": "{model} (retires {date})",
  "voiceInput.settings.model.retiredHint":
    "This model retires on {date}; new projects should pick gpt-transcribe",

  "voiceInput.settings.badge.active": "In effect",
  "voiceInput.settings.testOk": "Connected in {ms} ms",
  "voiceInput.settings.key.clearTitle": "Clear the saved key",
  "voiceInput.settings.key.clearConfirm": "You must re-enter it before dictation works again",
} as const;

export default voiceInput;
