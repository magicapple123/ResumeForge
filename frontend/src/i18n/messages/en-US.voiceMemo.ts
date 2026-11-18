// SPDX-License-Identifier: Apache-2.0
/**
 * English copy for the two voice additions: the resume editor's "dictate one item" entry, and the
 * TTS provider tiers. The namespace itself is pre-registered by the lead in `en-US.ts`.
 */
const voiceMemo = {
  // ── Dictate one item ────────────────────────────────────────────────
  "voiceMemo.button": "Dictate",
  "voiceMemo.buttonAria": "Dictate one item: speak and it becomes resume entries",
  "voiceMemo.status.recording": "Recording, tap to stop",
  "voiceMemo.status.transcribing": "Transcribing",
  /** I-18: purpose comes first, the limit second. */
  "voiceMemo.hint.purpose": "Speak one experience; it becomes a resume entry",
  "voiceMemo.hint.limit": "Up to {seconds} seconds per clip",
  "voiceMemo.hint.streamLimited":
    "This service does not stream, so clips stop at {seconds} seconds",
  "voiceMemo.hint.serverCap":
    "This service accepts at most {seconds} seconds per clip; longer clips are rejected",
  "voiceMemo.hint.privacy": "Audio goes to {host} as text only and is not kept locally",
  "voiceMemo.error.parse": "No entries came out of that, try saying it differently",
  "voiceMemo.modal.title": "Dictate",
  "voiceMemo.modal.hint": "Check the fields, then insert them as editable entries",
  "voiceMemo.modal.apply": "Insert into resume",
  "voiceMemo.modal.empty": "Nothing to insert",
  "voiceMemo.toast.inserted": "Inserted {count} entries",
  "voiceMemo.toast.covered": "{count} already exist and were skipped",
  "voiceMemo.toast.basicOnly": "Only contact basics were recognised, fill them on the profile page",
  "voiceMemo.toast.nothing": "Nothing to insert",
  // User-guide entry (I-18): written by the same hand as the UI copy above.
  "voiceMemo.guide.lead": "Dictate one item",
  "voiceMemo.guide.text":
    "In the resume workbench, choose Dictate, speak one experience, then check and insert it as an editable entry.",

  // ── Transcribe provider preset: the DeepSeek tier (T08) ─────────────
  //
  // These keys live under the existing `voiceInput.` prefix (referenced by asrPresets.ts) but are
  // written here: `en-US.voiceInput.ts` belongs to the realtime voice line, so this file only adds.
  "voiceInput.settings.provider.deepseek": "DeepSeek",
  "voiceInput.settings.provider.note.deepseek": "No model to pick, WAV only, 120 seconds per clip",

  // ── Speech provider tiers ───────────────────────────────────────────
  "ttsProvider.label": "Speech service",
  "ttsProvider.hint": "Each tier keeps its own voices; switching leaves the other one alone",
  "ttsProvider.dashscope": "Bailian",
  "ttsProvider.deepseek": "DeepSeek",
  "ttsProvider.missingKey": "No key for this tier yet",
  "ttsProvider.fallback": "Voice {previous} belongs to the other tier, switched to {voice}",
} as const;

export type VoiceMemoMessages = typeof voiceMemo;
export default voiceMemo;
