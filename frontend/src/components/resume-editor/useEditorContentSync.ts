// SPDX-License-Identifier: Apache-2.0
/**
 * 编辑器「外部内容 → 表单」的同步状态机：整份回填、脏值保护、资料刷新提示。
 *
 * 从 `useResumeEditorPanel` 拆出（那台状态机贴着 500 行预算）。判据只有三件事：
 *
 * 1. **什么时候回填**：打开/换目标（`active` / `initialTarget` 变化）一定整份重载；
 *    内容签名变化时按下面的脏值规则处理。
 * 2. **已有未保存改动时不能静默覆盖**（新建简历的投影刷新）：`deferRefreshWhenDirty`
 *    为真时只把新内容记成"待确认"，由界面给「用最新资料覆盖 / 保留当前编辑」两个动作。
 *    编辑已保存简历时不开这个开关——那时 `content` 是服务端刚存下的正文，本来就该覆盖。
 * 3. **同步之后谁善后**：写表单、清 sessionStorage 草稿、复位草稿通道、清撤回历史、
 *    滚动聚焦目标字段。四件事分开做必然有一处漏掉，所以集中在这一个 effect 里。
 *
 * 判据用**内容签名**而不是对象引用：宿主每换一次 detail（版式 PATCH、AI 修订、收藏……）
 * 都会传一个 JSON 重新解析出来的新对象，正文却可能一个字都没变。按引用比较会把用户
 * 还没保存的输入覆盖成服务端那份。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormInstance } from "antd";
import type { ResumeContent } from "../../types";
import { contentSignature } from "../../utils/contentSignature";
import { resolveEditorTarget } from "./ResumeEditorTarget";
import { scrollAndFocusEditorField } from "./editorFieldScroll";

/** 一次"整份重载"的快照：打开/换目标/内容签名，任何一项变化都要重新判定。 */
interface ContentSyncSnapshot {
  active: boolean;
  contentSig: string;
  initialTarget: string | null | undefined;
}

export interface EditorContentSyncOptions {
  /** 面板可见（弹窗=open，中栏=!collapsed）。 */
  active: boolean;
  content: ResumeContent | null;
  initialTarget?: string | null;
  /** 表单当前算不算"被改过"（状态机在 useResumeEditorPanel 里）。 */
  dirty: boolean;
  /**
   * 内容变化且表单有未保存改动时：不静默覆盖，改为暴露 `refreshPending` 让界面问一句。
   * 只有"新建简历（内容来自投影、会被别的窗口改资料影响）"要打开它。
   */
  deferRefreshWhenDirty?: boolean;
  form: FormInstance<ResumeContent>;
  /** 用户选「用最新资料覆盖」时先清掉 sessionStorage 草稿（表单回填由本 hook 负责）。 */
  onApplyLatest?: () => void;
  /** 内容被覆盖/重填后作废右栏的草稿预览（宿主提供的复位入口）。 */
  onDraftReset?: () => void;
  /** 清撤回/恢复历史（新内容就是新基线）。 */
  resetFormHistory: () => void;
}

export interface EditorContentSyncApi {
  /** 真正回填进表单的那份内容；只在"正文真的换了"时更新。 */
  syncedContent: ResumeContent | null;
  /** 收到了更新的资料内容，但因有未保存改动而没有覆盖（界面据此显示内联提示）。 */
  refreshPending: boolean;
  /** 「用最新资料覆盖」：清脏 + 清草稿 + 用最新内容回填表单。 */
  applyLatest: () => void;
  /** 「保留当前编辑」：收起提示；资料再变一次时会重新提示。 */
  dismissRefresh: () => void;
  /** 本帧是不是"打开/换目标"的整份重载（宿主据此重置脏值与当前页签）。 */
  freshLoad: boolean;
  /** 本帧内容被整份替换了（宿主据此清脏；不含 defer 拦下的那一类）。 */
  resynced: boolean;
}

export function useEditorContentSync({
  active,
  content,
  initialTarget,
  dirty,
  deferRefreshWhenDirty = false,
  form,
  onApplyLatest,
  onDraftReset,
  resetFormHistory,
}: EditorContentSyncOptions): EditorContentSyncApi {
  const contentSig = useMemo(() => (content ? contentSignature(content) : ""), [content]);
  const [syncedContent, setSyncedContent] = useState<ResumeContent | null>(content);
  const [pendingRefresh, setPendingRefresh] = useState<ResumeContent | null>(null);
  /** 用户点过「保留当前编辑」的那版签名：同一版不再反复提示，下一版再提示。 */
  const [dismissedSig, setDismissedSig] = useState<string | null>(null);
  const [prevSync, setPrevSync] = useState<ContentSyncSnapshot | null>(null);

  // 渲染期守卫（Compiler 规范：由外部信号驱动的状态调整同步完成，副作用留给 effect）。
  const freshLoad =
    prevSync === null || prevSync.active !== active || prevSync.initialTarget !== initialTarget;
  let resynced = false;
  if (freshLoad) {
    setPrevSync({ active, contentSig, initialTarget });
    setSyncedContent(content);
    setPendingRefresh(null);
    setDismissedSig(null);
  } else if (prevSync.contentSig !== contentSig) {
    setPrevSync({ active, contentSig, initialTarget });
    if (deferRefreshWhenDirty && active && dirty) {
      // 不覆盖、不清脏：用户正在编辑，这份输入比"资料更新了"更贵重。
      if (dismissedSig !== contentSig) setPendingRefresh(content);
    } else {
      resynced = true;
      setSyncedContent(content);
      setPendingRefresh(null);
      setDismissedSig(null);
    }
  }

  useEffect(() => {
    if (!active || !syncedContent) return;
    form.setFieldsValue(syncedContent);
    // 表单被外部内容覆盖了 → 草稿通道必须作废（右栏不能再显示旧草稿）。
    onDraftReset?.();
    // 换了/重开了这份内容：历史清空，以刚载入的内容为基线（撤回不该跨内容生效）。
    resetFormHistory();
    const target = initialTarget ? resolveEditorTarget(initialTarget) : null;
    if (!target || target.name.length === 0) return;
    return scrollAndFocusEditorField(form, target.name);
  }, [active, form, initialTarget, onDraftReset, resetFormHistory, syncedContent]);

  const applyLatest = useCallback(() => {
    if (!content) return;
    // 先清 sessionStorage 草稿：清早了等于"没点覆盖也丢草稿"，所以只在用户明确选覆盖时做。
    onApplyLatest?.();
    setPendingRefresh(null);
    setDismissedSig(contentSig);
    // 写回表单与历史复位交给上面那条 effect（走同一条"内容真的换了"的路径）。
    setSyncedContent(content);
  }, [content, contentSig, onApplyLatest]);

  const dismissRefresh = useCallback(() => {
    setPendingRefresh(null);
    setDismissedSig(contentSig);
  }, [contentSig]);

  return {
    syncedContent,
    refreshPending: pendingRefresh !== null,
    applyLatest,
    dismissRefresh,
    freshLoad,
    resynced,
  };
}
