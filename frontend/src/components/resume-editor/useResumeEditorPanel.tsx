// SPDX-License-Identifier: Apache-2.0
/**
 * 简历内容编辑器的**状态机**（表单实例 / 脏值 / 草稿 / 撤回历史 / 提交）。
 *
 * 从 `ResumeEditorModal` 搬出来（那份 421 行已贴 500 行预算），抽成 hook 的唯一目的是让
 * **两个宿主共用同一套语义**：
 *
 * | 宿主 | `active` | `onExit` | 关闭行为 |
 * |---|---|---|---|
 * | 弹窗「手动调整」（`ResumeEditorModal`） | `open` | 关窗 | 有脏值出内联确认条 |
 * | 制作台中栏（`ResumeWorkbenchEditorColumn`） | `!collapsed` | 关制作台 | 同上 |
 *
 * 三个义项（设计 §3.1 的语义对照表）：
 *
 * - `submit`：`form.submit()` → `onSave(合并后的内容)`。弹窗 footer 与中栏动作条共用它；
 * - `requestClose`：**关闭**入口（Esc / × / 遮罩）。提交中忽略；确认条已开则收起确认条；
 *   无脏值直接 `onExit`；有脏值出确认条；
 * - `requestDiscard`：**放弃修改**入口（中栏那颗按钮）。直接进确认态，确认后 =
 *   清草稿 + 回填服务端内容 + 清脏 + 重置历史 → `onExit?.()`。
 *   `onExit` 不传时（中栏）就**留在原地**——这就是"放弃修改 vs 关闭制作台"的差别。
 *
 * 表单本体、标签页、改写面板都不在这里：它们由 `ResumeEditorPanel` 渲染，唯一的
 * `<Form>` 也只在那个文件里（`popupGuard` P1 是文件级文本扫描，`*Modal.tsx` 里出现
 * `<Form` 就必须禁蒙层关闭——把 Form 关在面板里，宿主只管壳）。
 */
import { App, Form, type TabsProps } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResumeContent } from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { hasAnyResumeContent } from "../../utils/profileToResume";
import { formatErrorGuidance } from "../../api/errorGuidance";
import { useFormShortcutHistory } from "../../features/shortcuts/useFormShortcutHistory";
import { useBeforeUnloadGuard } from "../resume/useBeforeUnloadGuard";
import { scrollAndFocusEditorField } from "./editorFieldScroll";
import { buildResumeEditorTabItems, tabContentPresenceMask } from "./resumeEditorTabs";
import { resolveEditorTarget } from "./ResumeEditorTarget";
import { useEditorDraftBar } from "./useEditorDraftBar";
import { useEditorContentSync } from "./useEditorContentSync";
import { useEditorDraftDiff } from "./useEditorDraftDiff";
import { mergeEditorContent } from "./editorContentMerge";
import type { ResumeEditorPanelApi, ResumeEditorPanelOptions } from "./editorPanelTypes";

export function useResumeEditorPanel(options: ResumeEditorPanelOptions): ResumeEditorPanelApi {
  const locale = useLocale();
  const {
    active,
    content,
    resumeId,
    initialTarget,
    pickTarget = null,
    draftScopeKey,
    fillSources,
    entryFill = true,
    deferRefreshWhenDirty = false,
    fillAll,
    onSave,
    onExit,
    onSaved,
    onDraftContent,
    onDraftReset,
    keyboardHistory = true,
  } = options;
  const { message } = App.useApp();
  const [form] = Form.useForm<ResumeContent>();
  /**
   * 宿主回调的最新实现（经 ref 取，不进 useCallback 依赖）。
   *
   * 两个宿主传的 `onSave` / `onSaved` / `onExit` / `onDraftContent` / `onDraftReset`
   * 通常是内联箭头函数，每次渲染都是新引用。直接依赖它们会让下面这些**提交路径**的回调
   * 逐帧换身份，进而把 `ResumeEditorPanel` 里被 memo 的表单子树整棵重渲染——那正是
   * 「打字时面板陪跑」的来源（需求 #12）。行为不变：事件发生时总取到最新那一份。
   */
  const hostCallbacksRef = useRef({ onSave, onSaved, onExit, onDraftContent, onDraftReset });
  useEffect(() => {
    hostCallbacksRef.current = { onSave, onSaved, onExit, onDraftContent, onDraftReset };
  });
  // `setFieldValue` 只接受字面量路径联合，而字段名是 `resolveEditorTarget` 算出来的数组
  // （同一份映射），这里做一次显式类型擦除；useCallback 固定引用：它是 tabItems 的依赖。
  const setFormValue = useCallback(
    (name: (string | number)[], value: unknown) =>
      (form.setFieldValue as unknown as (n: (string | number)[], v: unknown) => void)(name, value),
    [form],
  );
  const [saving, setSaving] = useState(false);
  /**
   * 表单值 → 完整正文的**唯一**合并口径（保存与实时预览共用这一句）。
   *
   * 为什么必须共用：`photo` 不在编辑表单里（它是 base64 图片，走单独的上传校验），所以
   * "表单值"永远缺这一项。保存时保留原始的 `photo`、预览时也保留原始的 `photo`——两处
   * 各写一份，就会出现"预览里照片没了、保存后又回来"这种谁也说不清的差异。
   *
   * 返回 `null` = 还没有服务端内容（新建流程的只读场景），调用方自己决定怎么处理。
   */
  const mergePartial = useCallback(
    (values: Partial<ResumeContent> | undefined): ResumeContent | null =>
      mergeEditorContent(content, values),
    [content],
  );
  /** 清草稿的稳定入口（见 `handleDiscard` 里的说明：绕开 onDiscard ↔ clearDraft 的循环）。 */
  const clearDraftRef = useRef<() => void>(() => {});
  /** 资料刷新提示里点「用最新资料覆盖」时清 sessionStorage 草稿（走 ref，不等 draftBar 初始化）。 */
  const clearDraftForContentRefresh = useCallback(() => clearDraftRef.current(), []);
  // 草稿（B6）只把受控值递进去：作用域、防抖写入、"点了才应用"全在 `useEditorDraftBar`。
  const watched = Form.useWatch<ResumeContent>([], form) as ResumeContent | undefined;
  // R5：撤回/恢复作用于这份表单，保存与「保存内容」同走 `form.submit()`。
  const formHistory = useFormShortcutHistory(form, {
    onSave: () => form.submit(),
    historyEnabled: active && !saving && keyboardHistory,
    saveEnabled: active && !saving,
  });
  // `reset` 是稳定引用：直接依赖 formHistory 会在 canUndo/canRedo 翻转时重跑载入 effect。
  const resetFormHistory = formHistory.reset;
  // 未保存守卫（RF-13）：改过还没保存时，取消/遮罩/ESC 都要先过确认；保存成功即清脏。
  const [dirty, setDirty] = useState(false);
  const [activeTab, setActiveTab] = useState("basic");

  // 基本信息里只有「个人总结」能从资料填入（见 `resume/ResumeBasicInfoTab`）：
  // 姓名/手机/邮箱是身份信息，用户可能就在这份简历里改过它们，从资料覆盖回去等于把
  // 他刚改的抹掉。
  const summarySource = fillSources?.summary?.trim() ?? "";
  const fillSummary = useCallback(() => {
    setFormValue(["summary"], summarySource);
    setDirty(true);
  }, [setFormValue, summarySource]);
  // 上下文的值必须稳定：每次渲染新建一个对象会让所有消费它的分区重渲染（表单很大）。
  const fillContextValue = useMemo(
    () =>
      fillSources ? { sources: fillSources, onFilled: () => setDirty(true), entryFill } : null,
    [fillSources, entryFill],
  );

  /**
   * 「填入我的资料全部数据」：整份表单被覆盖，所以先看有没有东西会被冲掉。
   *
   * 只看当前标签页会把"教育里已经填好的两条"当成空（Tabs 惰性渲染），于是一声不响地
   * 覆盖掉用户的内容——所以判空一律用 `getFieldsValue(true)`。
   */
  const applyFillAll = useCallback(() => {
    if (!fillAll) return;
    form.setFieldsValue(fillAll() as never);
    setDirty(true);
    formHistory.push();
    message.success(t("editor.fillAll.applied"));
  }, [fillAll, form, formHistory, message]);

  const handleDiscard = useCallback(() => {
    // 放弃 = 回到服务端那份内容：草稿清掉、表单回填、脏标记清掉、历史重置。
    // 四件事缺一不可——少清一件，用户下次打开就会看到"已经放弃的改动"。
    //
    // 清草稿走 ref：`clearDraft` 由 `useEditorDraftBar` 产出，而 `useEditorDraftBar` 又要
    // 拿到这个回调（`onDiscard`），直接引用会形成先有鸡还是先有蛋。ref 在 effect 里赋值，
    // 用户点按钮时一定已经就绪。
    setDirty(false);
    if (content) form.setFieldsValue(content);
    resetFormHistory();
    clearDraftRef.current();
    // 草稿通道也要一起复位（R2 第 2 处）：右栏此刻还显示着"被放弃的那一版"，
    // 不复位就会出现"界面上写着已放弃、纸上还是放弃前的内容"。
    onDraftReset?.();
    onExit?.();
  }, [content, form, onDraftReset, onExit, resetFormHistory]);

  // 草稿恢复与关闭分级：状态机在 `resume-editor/useEditorDraftBar` 里，
  // 这里只提供"恢复后怎么落到表单"和"确认后各自做什么"。
  const draftBar = useEditorDraftBar({
    open: active,
    saving,
    dirty,
    scope: draftScopeKey ?? `resume.edit#${resumeId ?? "new"}`,
    values: watched,
    onRestored: (restored) => {
      form.setFieldsValue(restored as never);
      setDirty(true);
      // 恢复也算一次编辑：撤回要能退回到恢复之前的样子。
      formHistory.push();
    },
    onClose: () => onExit?.(),
    onDiscard: handleDiscard,
    onFillAll: applyFillAll,
  });
  const clearDraft = draftBar.clearDraft;
  useEffect(() => {
    clearDraftRef.current = clearDraft;
  }, [clearDraft]);

  // 草稿 vs 当前表单内容的差异（纯展示逻辑，拆到 `useEditorDraftDiff` 守 500 行预算）。
  const draftChanges = useEditorDraftDiff(draftBar.draftPending, form, watched);

  const fillAllData = useMemo(() => {
    if (!fillAll) return null;
    return () => {
      if (!hasAnyResumeContent(form.getFieldsValue(true) as ResumeContent)) {
        applyFillAll();
        return;
      }
      draftBar.requestFillAll();
    };
  }, [applyFillAll, draftBar, fillAll, form]);

  // 外部内容 → 表单的同步（整份回填 / 脏值保护 / 资料刷新提示）在
  // `useEditorContentSync`：判据用内容签名而不是对象引用，细节见那个文件。
  const contentSync = useEditorContentSync({
    active,
    content,
    initialTarget,
    dirty,
    deferRefreshWhenDirty,
    form,
    onApplyLatest: clearDraftForContentRefresh,
    onDraftReset,
    resetFormHistory,
  });
  if (contentSync.freshLoad) {
    // 打开 / 换目标：整份重载，清脏并按目标切页签（与搬迁前的渲染期守卫逐条对应）。
    if (active && content) {
      setDirty(false);
      const target = initialTarget ? resolveEditorTarget(initialTarget) : null;
      setActiveTab(target?.tab ?? "basic");
    }
  } else if (contentSync.resynced && active) {
    // 正文被资料/服务端整份替换：未保存标记作废（内容已经是最新的那份）。页签不跳——
    // 用户正在看的那一栏不该因为一次后台刷新被顶回基本信息。
    setDirty(false);
  }

  // 面板开着且没保存的修改还在时，挂 beforeunload：刷新/关闭浏览器出原生确认，
  // 不再静默丢稿。实现在 `resume/useBeforeUnloadGuard`。
  useBeforeUnloadGuard(active && dirty);

  /*
   * 「点纸面字段 → 定位输入框」（制作台专用）。与上面的内容同步**必须分开**：复用那条
   * 会让"点一下纸面"把中栏未保存的改动覆盖掉。切页签放渲染期守卫里（标签页必须先切过去
   * 字段才挂得上）；`{ path, nonce }` 让同一条路径连点两次也重新定位。
   */
  const [prevPick, setPrevPick] = useState<{ path: string; nonce: number } | null>(null);
  if (prevPick !== pickTarget) {
    setPrevPick(pickTarget);
    if (active && pickTarget) setActiveTab(resolveEditorTarget(pickTarget.path).tab);
  }

  useEffect(() => {
    if (!active || !pickTarget) return;
    const target = resolveEditorTarget(pickTarget.path);
    if (target.name.length === 0) return;
    return scrollAndFocusEditorField(form, target.name);
  }, [active, form, pickTarget]);

  // 页签装配拆到 `resumeEditorTabs`（本文件贴着 500 行预算）：key 与 content 字段名逐字一致。
  // 视图优先级（F10）：冻结的编辑器视图（已保存简历 / 新简历的方案投影）> 当前组参与清单
  // （F9/R1 的既有行为）；已有内容的分区另行保留（R-34）。视图搭在 fillSources 上，两个宿主
  // 共用同一条链路，不需要再各传一个参数。
  const participatingKeys = fillSources?.participatingKeys;
  const editorView = fillSources?.editorView ?? null;
  const customSectionCount = content?.custom_sections?.length ?? 0;
  // 正文 + 表单当前值的"有没有内容"掩码：用户刚加、还没保存的分区也要保留页签。
  // 掩码是字符串，打字时不变 → 页签不会逐键重建（依赖按它写）。
  const contentPresenceMask = useMemo(
    () => tabContentPresenceMask(content, watched),
    [content, watched],
  );
  const tabItems = useMemo<TabsProps["items"]>(
    () => {
      // Tab labels are translated inside the builder; locale invalidates this memo.
      void locale;
      return buildResumeEditorTabItems({
        summarySource,
        fillSummary,
        customSectionCount,
        participatingKeys,
        editorView,
        content,
        contentPresenceMask,
      });
    },
    // summarySource 决定「填入个人总结」是否出现；fillSummary 已用 useCallback 固定
    // （它自己依赖 setFormValue），只在值真的变时才重建标签页。
    [
      summarySource,
      fillSummary,
      customSectionCount,
      participatingKeys,
      editorView,
      content,
      contentPresenceMask,
      locale,
    ],
  );
  /**
   * 过滤后当前页签可能已经不在清单里（切组把这一栏藏了）：回落到基本信息，别让 Tabs
   * 的 activeKey 指着一个不存在的项（那会渲染出一块空白）。
   */
  const visibleActiveTab = (tabItems ?? []).some((item) => item?.key === activeTab)
    ? activeTab
    : "basic";

  const handleFinish = useCallback(
    async (values: ResumeContent) => {
      const merged = mergePartial(values);
      if (!merged) return;
      setSaving(true);
      try {
        // 照片不在本次编辑表单中，始终保留已校验的原始值（口径见 `mergePartial`）。
        // 宿主回调走 ref：见 hostCallbacksRef 的说明（稳定引用才能让表单子树不被逐帧重渲染）。
        const host = hostCallbacksRef.current;
        await host.onSave(merged);
        setDirty(false);
        // 存进去了就没有"没提交的草稿"了：清早了等于"保存失败也把内容扔了"，所以放在这里。
        clearDraftRef.current();
        // 草稿通道复位（R2 第 3 处）：宿主保存完会把权威 html 换上来，不清这里右栏还留着
        // "保存前那一刻"的草稿，看起来就像保存没生效。
        host.onDraftReset?.();
        // 已保存的内容成为新基线：这次编辑不再可撤回（撤回已落库的改动会让人以为没存上）。
        resetFormHistory();
        // 出口二选一：中栏"存完继续调参数"（`onSaved`），弹窗"存完就关"（`onExit`）。
        if (host.onSaved) host.onSaved();
        else host.onExit?.();
      } catch (error) {
        // 保存失败走全站统一的「原因 · 建议 · 编号」指引（RF-20）：用户在制作台里改的是
        // 已落库的内容，失败后必须能看出"是网络、是权限、还是服务端挂了"，并在反馈时
        // 报得出那一次的 requestId 前 8 位。`editor.save.failed` 只作兜底主因。
        message.error(formatErrorGuidance(error, t("editor.save.failed")));
      } finally {
        setSaving(false);
      }
    },
    [mergePartial, resetFormHistory, message],
  );

  /**
   * 表单值变化：置脏 + 记一次可撤回的历史 + 只在宿主消费时合并且上报实时预览。
   *
   * 三点取舍（需求 #12）：
   * 1. **整份合并只在宿主真的要时算**：弹窗宿主不消费草稿通道，逐键 `mergePartial`
   *    （深拷贝 + 三个 strip）纯属白算；
   * 2. 引用稳定：依赖只放 `mergePartial`（随 content 变）与 `pushHistory`（稳定），
   *    不把宿主回调放进来——否则每次渲染都换身份，被 memo 的表单子树会跟着重渲染；
   * 3. 脏标记与历史语义不变：首键置脏、连续击键按 300ms 合并成一个历史点（在 useFormHistory 里）。
   */
  const pushHistory = formHistory.push;
  const onValuesChange = useCallback(
    (_changed: unknown, allValues: ResumeContent) => {
      setDirty(true);
      pushHistory();
      const draftContent = hostCallbacksRef.current.onDraftContent;
      if (!draftContent) return;
      const drafted = mergePartial(allValues);
      if (drafted) draftContent(drafted);
    },
    [mergePartial, pushHistory],
  );

  /** 提交入口（`<Form onFinish>`）：身份稳定，表单子树不会因为它逐帧重渲染。 */
  const onFinishValues = useCallback(
    (values: ResumeContent) => void handleFinish(values),
    [handleFinish],
  );
  /** 弹窗 footer / 中栏动作条的提交按钮（`form.submit()`，与表单 onFinish 同一条链路）。 */
  const submitForm = useCallback(() => form.submit(), [form]);

  /** 外部整份替换（W06 大纲命令）：写回表单 + 标脏 + 记一次可撤回的历史；不触发保存。 */
  const replaceContent = useCallback(
    (next: ResumeContent) => {
      form.setFieldsValue(next as never);
      setDirty(true);
      formHistory.push();
      onDraftContent?.(next);
    },
    [form, formHistory, onDraftContent],
  );

  /** 「用最新资料覆盖」= 清脏 + 清草稿 + 用最新内容回填（清草稿与回填在 contentSync 里）。 */
  const applyLatestContent = useCallback(() => {
    setDirty(false);
    contentSync.applyLatest();
  }, [contentSync]);

  return {
    dirty,
    saving,
    contentRefreshPending: contentSync.refreshPending,
    applyLatestContent,
    dismissContentRefresh: contentSync.dismissRefresh,
    confirming: draftBar.confirming,
    draftPending: draftBar.draftPending,
    draftChanges,
    activeTab: visibleActiveTab,
    setActiveTab,
    tabItems,
    form,
    summarySource,
    fillSummary,
    fillContextValue,
    onValuesChange,
    onFinish: onFinishValues,
    submit: submitForm,
    requestClose: draftBar.requestClose,
    requestDiscard: draftBar.requestDiscard,
    discardEdits: handleDiscard,
    confirmPending: draftBar.confirmPending,
    keepEditing: draftBar.keepEditing,
    restoreDraft: draftBar.restoreDraft,
    discardDraft: draftBar.discardDraft,
    fillAllData,
    replaceContent,
  };
}
