// SPDX-License-Identifier: Apache-2.0
/** Interview realtime voice copy (issue #26 P0). */
const interviewVoice = {
  "interviewVoice.action.start": "Turn on realtime voice",
  "interviewVoice.action.stop": "Turn off realtime voice",
  "interviewVoice.mode.label": "Voice mode",
  "interviewVoice.mode.alwaysOn": "Always on",
  "interviewVoice.mode.pushToTalk": "Hold-to-talk mode",
  "interviewVoice.action.hold": "Hold to talk",
  "interviewVoice.action.holdHint": "Release to send",
  "interviewVoice.status.off": "Realtime voice is off",
  "interviewVoice.status.starting": "Opening the microphone",
  "interviewVoice.status.listening": "Listening",
  "interviewVoice.status.waitingAsr": "Transcribing",
  "interviewVoice.status.extended": "Still listening",
  "interviewVoice.status.thinking": "Thinking mode",
  "interviewVoice.status.bargeIn": "Listening (interviewer speech paused)",
  "interviewVoice.hint.thinking": "Speak when ready — waits up to 5 seconds",
  "interviewVoice.hint.interrupted": "Interviewer interrupted — keep going",
  "interviewVoice.hint.privacy":
    "Audio is transcribed segment by segment in memory, never stored locally",
  "interviewVoice.room.title": "Live voice interview",
  "interviewVoice.room.enter": "Enter voice call",
  "interviewVoice.room.exit": "Exit call",
  "interviewVoice.room.interviewer": "Interviewer",
  "interviewVoice.room.you": "You",
  "interviewVoice.room.conversation": "Conversation",
  "interviewVoice.room.waiting": "Waiting for the interviewer",
  "interviewVoice.room.speaking": "Interviewer is speaking",
  "interviewVoice.room.speechUnsupported":
    "This browser cannot read replies aloud; text conversation is still available",
  "interviewVoice.room.cameraOn": "Turn on camera",
  "interviewVoice.room.cameraStop": "Turn off camera",
  "interviewVoice.room.cameraOff": "Camera preview is off",
  "interviewVoice.room.cameraPreview": "Local camera preview",
  "interviewVoice.room.localPreview": "Camera preview stays on this device and is not uploaded",
  "interviewVoice.room.cameraError":
    "Could not start the camera; check browser permissions and retry",
  "interviewVoice.room.micOn": "Turn on microphone",
  "interviewVoice.room.micOff": "Turn off microphone",

  // ===== Three-part layout (Q1-B) =====
  "interviewVoice.room.micStatus": "Microphone",
  "interviewVoice.room.micIdle": "off",
  "interviewVoice.room.speakingBadge": "Speaking",
  "interviewVoice.room.currentTurn": "Current exchange",
  "interviewVoice.room.noTurn": "No exchange yet - turn on the microphone or just start talking",
  "interviewVoice.room.settings": "Call settings",
  "interviewVoice.room.expand": "Open settings",
  "interviewVoice.room.fallbackLocal":
    "Speech synthesis is unavailable; this turn uses the local browser voice",
  "interviewVoice.room.fallbackReason":
    "Speech synthesis failed ({reason}); this turn uses the local browser voice",
  "interviewVoice.room.revise": "Edit and re-ask",
  "interviewVoice.room.reviseHint":
    "Confirming discards this round's interviewer reply and asks again; it cannot be undone.",
  "interviewVoice.room.reviseSubmit": "Re-ask",
  "interviewVoice.room.reviseCancel": "Cancel",

  // ===== Transcript confirmation bubble (Q1-C L1) =====
  "interviewVoice.pending.title": "Recognized",
  "interviewVoice.pending.segment": "Segment {index}",
  "interviewVoice.pending.hint":
    "A long answer is split at pauses; Re-say replaces only the latest segment, not the whole answer.",
  "interviewVoice.pending.resay": "Re-say this",
  "interviewVoice.pending.send": "Send as is",
  "interviewVoice.pending.discard": "Discard segment",
  "interviewVoice.pending.resayArmed": "Segment cleared - say it again",
  "interviewVoice.pending.editPlaceholder": "Edit the recognized text before sending",

  // ===== Configurable parameters (Q1-D) =====
  "interviewVoice.settings.title": "Call settings",
  "interviewVoice.settings.cardTitle": "Interview voice",
  "interviewVoice.settings.cardHint":
    "How the interviewer listens and speaks during a call. Changes apply immediately and stay on this device.",
  "interviewVoice.settings.speak": "Interviewer speaks",
  "interviewVoice.settings.speakHint": "Turn off to show text without audio",
  "interviewVoice.settings.voice": "Voice",
  "interviewVoice.settings.rate": "Speech rate",
  "interviewVoice.settings.volume": "Volume",
  "interviewVoice.settings.volumeUnit": "%",
  "interviewVoice.settings.silence": "Pause to finish",
  "interviewVoice.settings.filler": "Hold after filler words",
  "interviewVoice.settings.autoSend": "Send automatically",
  "interviewVoice.settings.autoSendHint":
    "Turn off to keep each transcript as a bubble you can edit before sending",
  "interviewVoice.settings.bargeIn": "Barge-in sensitivity",
  "interviewVoice.settings.bargeInSlow": "Low",
  "interviewVoice.settings.bargeInNormal": "Normal",
  "interviewVoice.settings.bargeInFast": "High",
  "interviewVoice.settings.maxRecord": "Max segment length",
  "interviewVoice.settings.seconds": "{value}s",
  "interviewVoice.settings.milliseconds": "{value} ms",
  "interviewVoice.settings.times": "{value}x",
  "interviewVoice.settings.reset": "Restore defaults",
  "interviewVoice.settings.resetDone": "Call settings restored to defaults",
  "interviewVoice.settings.saved": "Saved",
  "interviewVoice.settings.roomHint": "Changes apply immediately and only on this device",
  "interviewVoice.error.unsupported": "This browser does not support realtime voice",
  "interviewVoice.error.microphoneDenied":
    "Microphone permission denied: allow it in the address bar and retry",
  "interviewVoice.error.microphoneMissing": "No microphone was found",
  "interviewVoice.error.microphoneBusy":
    "The microphone is in use by another app; close it and retry",
  "interviewVoice.error.microphoneFailed": "Could not open the microphone; please retry",
  "interviewVoice.error.transcribeFailed":
    "That segment could not be transcribed; please say it again",
  "interviewVoice.error.empty": "Did not catch that; please say it again",
  "interviewVoice.waveform.label": "Live volume waveform",
  "interviewCamera.settings.title": "Interview camera",
  "interviewCamera.settings.hint":
    "Only applies inside the realtime voice room. Off by default; no camera permission is requested while off.",
  "interviewCamera.settings.enable": "Enable camera",
  "interviewCamera.settings.enableHint":
    "Allows turning on the camera in the room. Footage is processed on this machine only.",
  "interviewCamera.settings.record": "Local recording",
  "interviewCamera.settings.recordHint":
    "Video only, no audio. Capped at 30 minutes or 200 MB per session, then stops automatically.",
  "interviewCamera.settings.analyze": "Frame analysis",
  "interviewCamera.settings.analyzeHint":
    "One frame every 15 seconds, at most 12 per session. Frames stay in memory and are never saved.",
  "interviewCamera.settings.retention": "Keep recordings",
  "interviewCamera.settings.retention7": "7 days",
  "interviewCamera.settings.retention30": "30 days",
  "interviewCamera.settings.retentionNever": "Do not auto-delete",
  "interviewCamera.settings.countInScore": "Count camera score in total",
  "interviewCamera.settings.countInScoreHint":
    "Off by default. When on, camera presence contributes 15% to the interview total; when off, the report shows a separate experimental section only.",
  "interviewCamera.settings.storageHint":
    "Recordings stay in the local data directory and are excluded from backups. Deleting the interview deletes the recording too.",
  "interviewCamera.consent.title": "Before enabling the camera",
  "interviewCamera.consent.body":
    "Camera footage is sensitive personal information. Once enabled: recordings stay on this machine; video only, no audio; sampled frames are sent to the configured model for presence analysis and are never written to disk; you can stop at any time in the room and delete the recording from the report. Recordings are not included in backups.",
  "interviewCamera.consent.ok": "I understand, enable",
  "interviewCamera.consent.cancel": "Not now",
  "interviewCamera.room.recording": "Recording",
  "interviewCamera.room.frames": "{count} frames sampled",
  "interviewCamera.room.stop": "Stop recording",
  "interviewCamera.room.uploading": "Saving recording",
  "interviewCamera.room.uploaded": "Recording saved",
  "interviewCamera.room.uploadFailed": "Recording upload failed",
  "interviewCamera.room.retry": "Retry upload",
  "interviewCamera.room.unsupported": "This browser cannot record locally; recording is off",
  "interviewCamera.room.overwriteNote":
    "Resuming after a pause starts a new segment; the previous one is kept in the data directory.",
  "interviewCamera.report.title": "Camera presence (experimental)",
  "interviewCamera.report.score": "Presence {score}",
  "interviewCamera.report.insufficient": "Not enough usable footage to assess",
  "interviewCamera.report.frames": "{analyzed} frames analyzed, {visible} with a clear face",
  "interviewCamera.report.error": "Camera analysis unavailable: {reason}",
  "interviewCamera.report.playback": "Session recording",
  "interviewCamera.report.delete": "Delete recording",
  "interviewCamera.report.deleteConfirm":
    "The recording cannot be recovered (it does not go to trash). The interview and report are unaffected.",
  "interviewCamera.report.deleted": "Recording deleted",
  "interviewCamera.report.notInBackup": "Recordings are not included in backups.",
  "interviewCamera.report.combined": "Total with camera {score}",
  "interviewCamera.metric.face_visible": "Face visible",
  "interviewCamera.metric.gaze_at_camera": "Looking at camera",
  "interviewCamera.metric.head_stable": "Head steady",
  "interviewCamera.metric.framing_ok": "Framing",
  "interviewCamera.metric.lighting_ok": "Lighting",
} as const;

export default interviewVoice;
