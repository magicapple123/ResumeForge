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
  "interviewVoice.status.bargeIn": "Listening (interviewer volume lowered)",
  "interviewVoice.hint.thinking": "Speak when ready — waits up to 5 seconds",
  "interviewVoice.hint.interrupted": "Interviewer interrupted — keep going",
  "interviewVoice.hint.privacy":
    "Audio is transcribed segment by segment in memory, never stored locally",
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
} as const;

export default interviewVoice;
