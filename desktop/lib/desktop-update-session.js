// SPDX-License-Identifier: Apache-2.0
"use strict";

// The main process owns the offer, its asset URLs and the one active install.
// A renderer reload can recover the last snapshot without starting any work.
function createDesktopUpdateSession({ current, inspect, install, publish, log = () => {} }) {
  let state = { phase: "idle", current, latest: "", published: "", notes: "", size: null,
    received: 0, total: null, manual: false, request: 0, sequence: 0, error: "" };
  let offer = null;
  let checking = null;
  const snapshot = () => ({ ...state });
  function report(fields) {
    state = { ...state, ...fields, sequence: state.sequence + 1 };
    try { publish(snapshot()); } catch (err) { log(`update renderer unavailable: ${err}`); }
  }
  function failed(err, stage) {
    log(`desktop update ${stage} failed: ${err}`);
    const error = err?.code === "STALL" ? "stall" : stage;
    report({ phase: "failed", error });
  }
  function check(manual) {
    const active = ["downloading", "verifying", "installing"].includes(state.phase);
    if (active || checking) {
      if (manual) report({ manual: true, request: state.request + 1 });
      return checking || Promise.resolve();
    }
    offer = null;
    report({ phase: "checking", manual, request: state.request + 1, error: "",
      latest: "", notes: "", published: "", size: null, received: 0, total: null });
    checking = Promise.resolve().then(inspect).then(next => {
      offer = next;
      const { latest, notes = "", size = null, published = "", upToDate, missing } = next;
      if (missing) log(`update assets incomplete for ${latest}: missing ${missing}`);
      report({ phase: upToDate ? "current" : missing ? "failed" : "available",
        error: missing ? "incomplete" : "", latest, notes, size, published });
    }).catch(err => failed(err, "check")).finally(() => { checking = null; });
    return checking;
  }
  function start(version) {
    if (state.phase !== "available" || !offer || version !== offer.latest) return false;
    report({ phase: "downloading", manual: true, received: 0, total: null });
    void Promise.resolve().then(() => install(offer, report)).catch(err => failed(err, "download"));
    return true;
  }
  function interrupted(version) {
    report({ phase: "failed", error: "interrupted", latest: version, manual: true, request: state.request + 1 });
  }
  return { snapshot, check, start, interrupted };
}

module.exports = { createDesktopUpdateSession };
