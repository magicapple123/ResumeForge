// SPDX-License-Identifier: Apache-2.0
/**
 * The web-form page "click-to-fill" card: title, toggle, the explanatory paragraph,
 * status tags, candidate hints, the profile-target prompt and the ended states.
 */
const liveModeCard = {
  "liveModeCard.title": "Click-to-fill",
  "liveModeCard.toggle.off": "Turn off",
  "liveModeCard.toggle.on": "Turn on",
  "liveModeCard.toggle.ariaOff": "Turn off click-to-fill",
  "liveModeCard.toggle.ariaOn": "Turn on click-to-fill",
  "liveModeCard.intro.lead": "Turn it on and go back to the browser window: ",
  "liveModeCard.intro.focusHint":
    "click any box and the matching value from your profile appears right next to it",
  "liveModeCard.intro.writeHint":
    ", and nothing is written until you click “Fill”. If it can't recognize a box, click ",
  "liveModeCard.intro.profilePickerHint": "“Switch profile…”",
  "liveModeCard.intro.profileListHint":
    " to see all the profile data you've filled in (grouped by section, searchable), ",
  "liveModeCard.intro.pickHint": "pick the one you want",
  "liveModeCard.intro.tail":
    " - so it doesn't have to recognize the box. Good for checking one box at a time, and for boxes the bulk fill can't handle.",
  "liveModeCard.status.waiting": "Waiting for you to click a box",
  "liveModeCard.status.off": "Not started",
  "liveModeCard.tag.off": "Off",
  "liveModeCard.tag.ai": "AI suggestion",
  "liveModeCard.alternatives.tooltipEntry": "{label}: {value}",
  "liveModeCard.alternatives.count": "{count} more candidates (pick one in the browser window)",
  "liveModeCard.remember.tag": "Waiting for a profile target",
  "liveModeCard.remember.choose": "Choose where to save",
  "liveModeCard.progress.filled": "Filled {count} this session",
  "liveModeCard.progress.keepRunning":
    "The floating ball is still in the browser; turn it back on any time",
  "liveModeCard.ended.browserClosed":
    "The browser was closed, so this session ended automatically. It turns back on when you reopen the browser.",
} as const;

export default liveModeCard;
