// SPDX-License-Identifier: Apache-2.0
/**
 * 编辑器提示条（问题 14）。
 *
 * ## 为什么单独抽出来
 *
 * 提示条原先排在 `.document-editor` 的**正常布局流末尾**（字段区之后），于是：
 * - 长条目下用户停在顶部时，提示在视口下方几百像素处，等于"操作被拒但没有任何反馈"；
 * - 但它当初离开"页签之上"正是因为那里会顶动字段区 52.3px（F1-b），
 *   所以这次不能再往回流里挪，必须**脱离滚动容器**（portal 到中栏底部的浮层宿主）。
 *
 * 宿主（`ResumeWorkbenchV2EditorColumn`）把 `.resume-wb-notice-host` 挂在
 * `.resume-wb-v2-editor` 里、滚动容器 `.document-editor` **之外**，于是：
 * 提示固定在中栏底部，不随内容滚；浮层不参与布局，字段区零位移。
 *
 * ## 回退
 *
 * 没有 host 时（生成预览等不带浮层宿主的场景）退回原样：流内渲染在内容末尾，
 * 与改动前完全一致——不能"没 host 就干脆不渲染"，那会让那些场景彻底没有提示。
 *
 * ## 生命周期
 *
 * 成功类（`info`）读得快、拒绝类（`warning`）要留够时间，按 tone 分流自动消失；
 * 两者都仍可点 × 提前关。计时器跟着 `notice` 对象重建——同一句文案连点两次会重新读秒。
 */
import { Alert } from "antd";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type NoticeTone = "info" | "warning";

export interface NoticeState {
  text: string;
  tone: NoticeTone;
}

/**
 * 自动消失时长（毫秒）：`info` = 已添加/已移动/已删除/已隐藏，`warning` = 拖拽被拒。
 * 写成常量便于按真机手感调，别散落在定时器调用处。
 */
export const NOTICE_AUTO_DISMISS_MS: Record<NoticeTone, number> = {
  info: 2500,
  warning: 8000,
};

export interface DocumentNoticeProps {
  notice: NoticeState | null;
  /** portal 目标（滚动容器之外的中栏底部浮层宿主）；null = 回退到流内渲染。 */
  host?: HTMLElement | null;
  /** 关闭回调（点 × 或自动消失都走它）。 */
  onDismiss: () => void;
}

export default function DocumentNotice({ notice, host = null, onDismiss }: DocumentNoticeProps) {
  // 只依赖 `notice` 重建计时器：`onDismiss` 每次渲染都是新箭头函数，
  // 若进依赖数组，父组件任何一次无关重渲染都会把读秒重置，2.5 秒永远到不了。
  const dismissRef = useRef(onDismiss);

  // 提交后再同步最新回调：在渲染期间写 ref 会被 react-hooks 判为「渲染期访问 ref」。
  // 本 effect 声明在计时器之前，同一次提交里先跑它，计时器读取时拿到的已是最新值。
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = globalThis.setTimeout(() => {
      // 只关闭当前这条，不去比 `notice.text`：旧提示已消失、新提示刚出现时，
      // 读闭包里的旧文案会误杀新提示。
      dismissRef.current();
    }, NOTICE_AUTO_DISMISS_MS[notice.tone]);
    return () => globalThis.clearTimeout(timer);
  }, [notice]);

  if (!notice) return null;

  const layer = (
    <div className="document-editor-notice" data-notice-tone={notice.tone}>
      <Alert
        type={notice.tone === "warning" ? "warning" : "info"}
        title={notice.text}
        closable
        onClose={() => dismissRef.current()}
      />
    </div>
  );

  // 浮层宿主：portal 出去，不进滚动容器，也不参与中栏的 flex 布局。
  return host ? createPortal(layer, host) : layer;
}
