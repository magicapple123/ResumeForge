// SPDX-License-Identifier: Apache-2.0
"use strict";

// The main process owns the offer, its asset URLs and the one active install.
// A renderer reload can recover the last snapshot without starting any work.
// `errorDetail`：失败的技术原文（截断 300，见 failureDetail）。`error` 是阶段码、属于兼
// 容契约（渲染层按它选固定文案），**不能**承载原因；原因必须单独带出去，否则弹窗里只剩
// 「检查更新失败」五个字（第 11 条）。原文由渲染层做中文归因（features/updates/updateErrorText.ts），
// 主进程不翻译——壳层对话框是双语的，中文只走日志。
const DETAIL_LIMIT = 300;
function createDesktopUpdateSession({ current, inspect, install, publish, log = () => {} }) {
  let state = { phase: "idle", current, latest: "", published: "", notes: "", size: null,
    received: 0, total: null, manual: false, request: 0, sequence: 0, error: "", errorDetail: "" };
  let offer = null;
  let checking = null;
  const snapshot = () => ({ ...state });
  function report(fields) {
    state = { ...state, ...fields, sequence: state.sequence + 1 };
    try { publish(snapshot()); } catch (err) { log(`update renderer unavailable: ${err}`); }
  }
  // 原文里的 URL / 文件名对反馈问题有用，300 字是为了不把弹窗撑破：完整内容仍在
  // desktop-main.log 的 `desktop update <stage> failed:` 那一行。
  function failureDetail(err) {
    return String(err?.message ?? err ?? "").slice(0, DETAIL_LIMIT);
  }
  function failed(err, stage) {
    // `err.reason` 是中文归因（lib/update-failure-text.js 的 describeFailure，与后端
    // describe_failure 同口径），**只进日志**：它比状态码更容易被人读懂，而 errorDetail
    // 要保持原文（用户可见的归因在渲染层走 i18n）。
    const reason = err && typeof err.reason === "string" && err.reason ? ` —— ${err.reason}` : "";
    log(`desktop update ${stage} failed: ${err}${reason}`);
    const error = err?.code === "STALL" ? "stall" : stage;
    report({ phase: "failed", error, errorDetail: failureDetail(err) });
  }
  function check(manual) {
    const active = ["downloading", "verifying", "installing"].includes(state.phase);
    if (active || checking) {
      if (manual) report({ manual: true, request: state.request + 1 });
      return checking || Promise.resolve();
    }
    offer = null;
    // `errorDetail` 与 `error` 一起清空：否则上一次的失败原因会粘在这次成功的检查上
    // （用户会看到「已是最新」下面挂着一句上一次的 403）。
    report({ phase: "checking", manual, request: state.request + 1, error: "", errorDetail: "",
      latest: "", notes: "", published: "", size: null, received: 0, total: null });
    checking = Promise.resolve().then(inspect).then(next => {
      offer = next;
      const { latest, notes = "", size = null, published = "", upToDate, missing } = next;
      if (missing) log(`update assets incomplete for ${latest}: missing ${missing}`);
      report({ phase: upToDate ? "current" : missing ? "failed" : "available",
        error: missing ? "incomplete" : "", latest, notes, size, published,
        // 附件取不到而这次检查是**降级**来的（主路径 403、靠备用探测才拿到版本号）时，
        // 把降级原因一起带出去：「发布包尚未齐备」在那种情形下字面正确但会误导人，
        // 原文能让用户看到真正的原因是额度用完。成功查到的 offer 没有这个字段。
        errorDetail: missing ? failureDetail(next.failureDetail) : "" });
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
    // 启动对账发现的"上次没装成"不是这次的检查失败，没有可展示的原文——清空，
    // 免得弹窗把上一次 403 的原文挂在这条提示下面。
    report({ phase: "failed", error: "interrupted", errorDetail: "", latest: version,
      manual: true, request: state.request + 1 });
  }
  return { snapshot, check, start, interrupted };
}

module.exports = { createDesktopUpdateSession };
