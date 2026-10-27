// SPDX-License-Identifier: Apache-2.0
/**
 * API 层：请求失败、超时、取消与流式读取的兜底文案，错误指引（原因 / 建议 / 编号），
 * 以及响应缺少 Content-Disposition 时的下载兜底文件名。
 *
 * 只收「发生在请求层、但会直接给用户看」的文案。后端返回的 `detail` 原样透传（那是
 * 服务端文案，前端不重写）；协议值（businessCode、`code`、scope token）也不在这里。
 */
const apiErrors = {
  // ── client.ts：请求封装 ──
  "apiErrors.http.statusFallback": "请求失败（HTTP {status}）",
  /** FastAPI 校验错误数组之间的拼接符：中文用全角分号，英文用「; 」。 */
  "apiErrors.http.detailSeparator": "；",
  "apiErrors.network.unreachable": "无法连接本地服务，请确认应用已启动",
  "apiErrors.request.cancelled": "已取消",
  "apiErrors.request.timeout": "请求超时，请重试",

  // ── datasetScope.ts：启动期的数据集身份冻结 ──
  "apiErrors.datasetScope.confirmFailed": "无法确认当前数据集，请检查本地服务后刷新页面",

  // ── stream.ts：SSE 读取 ──
  "apiErrors.stream.malformed": "流式响应格式异常，请重试",
  "apiErrors.stream.unsupported": "浏览器不支持流式响应，请更换现代浏览器",

  // ── interview.ts：流式提交回答 ──
  "apiErrors.interview.streamFailed": "面试官开不了口，请重试",

  // ── resumes.ts / tracker.ts：缺少 Content-Disposition 时的兜底文件名 ──
  "apiErrors.download.shareZipFilename": "简历-离线包.zip",
  "apiErrors.download.trackerFilename": "求职进度.{format}",

  // ── errorGuidance.ts：失败面统一的「原因 / 建议 / 编号」──
  "apiErrors.guidance.format": "原因：{reason} · 建议：{action} · 编号：{ref}",
  "apiErrors.guidance.unknownReason": "发生未知错误",
  "apiErrors.guidance.retryDiagnostics": "重试；若反复出现，请导出诊断包反馈",
  "apiErrors.guidance.timeoutReason": "请求等待超时",
  "apiErrors.guidance.timeoutAction": "请重试；数据量大的导出/生成可稍后再试或调小范围",
  "apiErrors.guidance.networkReason": "无法连接后端服务",
  "apiErrors.guidance.networkAction": "请确认后端已启动（端口未被占用），然后重试",
  "apiErrors.guidance.cancelledReason": "操作已取消",
  "apiErrors.guidance.cancelledAction": "如需继续可重新发起",
  "apiErrors.guidance.scopeExpiredReason": "页面与本地数据集的连接已过期",
  "apiErrors.guidance.scopeExpiredAction": "已自动重新同步，请重试",
  "apiErrors.guidance.conflictReason": "存在进行中的任务或资源冲突",
  "apiErrors.guidance.conflictAction": "请先停止或等待当前任务完成，再重试本操作",
  "apiErrors.guidance.forbiddenReason": "当前请求未被允许",
  "apiErrors.guidance.forbiddenAction": "请检查登录状态或在启动应用的本机页面操作",
  "apiErrors.guidance.tooLargeReason": "请求体过大",
  "apiErrors.guidance.tooLargeAction": "请减小上传文件体积后重试",
  "apiErrors.guidance.serverReason": "服务器内部错误",
  "apiErrors.guidance.retryWithRef": "重试；若反复出现，请导出诊断包并附上编号反馈",
} as const;

export default apiErrors;
