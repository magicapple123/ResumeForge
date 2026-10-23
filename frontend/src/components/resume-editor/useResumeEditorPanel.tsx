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
import { App, Form, type FormInstance, type TabsProps } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResumeContent } from "../../types";
import { t } from "../../i18n";
import { contentSignature } from "../../utils/contentSignature";
import { hasAnyResumeContent } from "../../utils/profileToResume";
import { summarizeDraftDiff, type DraftDiffEntry } from "../../utils/draftDiff";
import { formatErrorGuidance } from "../../api/errorGuidance";
import type { ProfileFillSources } from "../../features/profile/profileFillOptions";
import { useFormShortcutHistory } from "../../features/shortcuts/useFormShortcutHistory";
import ResumeWritingPanel from "../ResumeWritingPanel";
import ResumeBasicInfoTab from "../resume/ResumeBasicInfoTab";
import { useBeforeUnloadGuard } from "../resume/useBeforeUnloadGuard";
import {
  AwardEditor,
  CampusEditor,
  EducationEditor,
  ExperienceEditor,
  ProjectEditor,
  SkillEditor,
} from "./ResumeSectionEditors";
import { scrollAndFocusEditorField } from "./editorFieldScroll";
import type { ProfileFillContextValue } from "./profileFillContext";
import { resolveEditorTarget } from "./ResumeEditorTarget";
import { useEditorDraftBar, type EditorPendingAction } from "./useEditorDraftBar";

/** 编辑器的宿主无关配置。字段语义见设计 §3.1。 */
export interface ResumeEditorPanelOptions {
  /** 面板可见：`false` 时不读不写草稿、不挂 beforeunload（弹窗=open，中栏=!collapsed）。 */
  active: boolean;
  content: ResumeContent | null;
  resumeId?: number;
  initialTarget?: string | null;
  /** 缺省 `resume.edit#<resumeId|new>`；两个宿主必须给出**不同**作用域维度。 */
  draftScopeKey?: string;
  /**
   * 「点纸面字段 → 定位输入框」的请求（制作台专用）。
   *
   * 与 `initialTarget` 是两件事：`initialTarget` 同时驱动「AI 改写」面板并触发一次内容
   * 回填，复用它会让"点一下纸面"顺带把没保存的改动冲掉。`nonce` 让同一条路径连点两次
   * 也重新定位（每次宿主都给一个新对象）。
   */
  pickTarget?: { path: string; nonce: number } | null;
  fillSources?: ProfileFillSources | null;
  entryFill?: boolean;
  fillAll?: () => ResumeContent;
  /** 宿主负责 PATCH + 重渲染；resolve 即已落库。 */
  onSave: (content: ResumeContent) => Promise<void>;
  /** 「放弃修改 / 关闭」之后宿主做什么：弹窗=关窗；中栏=关制作台（不传即留在原地）。 */
  onExit?: () => void;
  /**
   * 保存**成功**之后做什么。不传时退回 `onExit`（弹窗的语义：存完就关）。
   *
   * 制作台中栏需要它：那里保存完**不关**面板——用户刚改完一句措辞，下一步往往是接着调
   * 参数、看右栏排版。把"存好了"和"关掉"拆成两个出口，是因为一个 `onExit` 同时承担
   * 这两件事时，中栏只能在"存完就关"与"Esc 关不掉"之间二选一。
   */
  onSaved?: () => void;
}

export interface ResumeEditorPanelApi {
  dirty: boolean;
  saving: boolean;
  confirming: EditorPendingAction;
  draftPending: { values: Record<string, unknown>; savedAt: number } | null;
  /**
   * 草稿与**当前表单内容**的差异摘要（供草稿条的「查看差异」展开）。
   *
   * `null` = 没有草稿可恢复；空数组 = 有草稿但与现在一致（这时界面上不该出现
   * 「查看差异」入口，点了也是空表）。
   */
  draftChanges: DraftDiffEntry[] | null;
  activeTab: string;
  setActiveTab: (key: string) => void;
  tabItems: TabsProps["items"];
  /** 只交给视图（视图里那个 `<Form form={api.form}>` 是全文唯一的一个）。 */
  form: FormInstance<ResumeContent>;
  summarySource: string;
  fillSummary: () => void;
  fillContextValue: ProfileFillContextValue | null;
  /**
   * `<Form onValuesChange>` 的处理：置脏 + 记一次可撤回的历史。
   *
   * 放在 API 里而不是让视图自己写一个空函数：脏值与历史是**状态机的两件事**，
   * 视图重复实现一次就会出现"改了但保存按钮不亮"。
   */
  onValuesChange: () => void;
  /** `<Form onFinish>`：合并照片后交给宿主的 `onSave`。 */
  onFinish: (values: ResumeContent) => void;
  /** 提交（= `form.submit()` → `onSave`）；弹窗 footer 与中栏动作条共用。 */
  submit: () => void;
  /** 关闭入口（Esc / × / 遮罩）。 */
  requestClose: () => void;
  /** 「放弃修改」入口。 */
  requestDiscard: () => void;
  /**
   * 立刻放弃（不再二次确认）。
   *
   * 制作台中栏的"放弃并关闭制作台"用它：那里已经由中栏自己的内联确认问过一遍，
   * 再走 `requestDiscard` 会出现两层确认。同样会清草稿 + 回填服务端内容 + 清脏 + 重置历史。
   */
  discardEdits: () => void;
  confirmPending: () => void;
  keepEditing: () => void;
  /** 恢复条。 */
  restoreDraft: () => void;
  /** 恢复条。 */
  discardDraft: () => void;
  /**
   * 「填入我的资料全部数据」的入口：`fillAll` 没传时为 `null`，视图据此完全不渲染。
   *
   * 这一条不在原始契约里，但 `fillAll` 的确认分支住在 `useEditorDraftBar` 里（`fill-all`），
   * 只有 hook 才够得着；把它当 API 交出去，两个宿主都不必各自实现一遍"要不要先问"。
   */
  fillAllData: (() => void) | null;
}

export function useResumeEditorPanel(options: ResumeEditorPanelOptions): ResumeEditorPanelApi {
  const {
    active,
    content,
    resumeId,
    initialTarget,
    pickTarget = null,
    draftScopeKey,
    fillSources,
    entryFill = true,
    fillAll,
    onSave,
    onExit,
    onSaved,
  } = options;
  const { message } = App.useApp();
  const [form] = Form.useForm<ResumeContent>();
  // `setFieldValue` 只接受字面量路径联合，而字段名是 `resolveEditorTarget` 算出来的数组
  // （同一份映射），这里做一次显式类型擦除；useCallback 固定引用：它是 tabItems 的依赖。
  const setFormValue = useCallback(
    (name: (string | number)[], value: unknown) =>
      (form.setFieldValue as unknown as (n: (string | number)[], v: unknown) => void)(name, value),
    [form],
  );
  const [saving, setSaving] = useState(false);
  /** 清草稿的稳定入口（见 `handleDiscard` 里的说明：绕开 onDiscard ↔ clearDraft 的循环）。 */
  const clearDraftRef = useRef<() => void>(() => {});
  // 草稿（B6）只把受控值递进去：作用域、防抖写入、"点了才应用"全在 `useEditorDraftBar`。
  const watched = Form.useWatch<ResumeContent>([], form) as ResumeContent | undefined;
  // R5：撤回/恢复作用于这份表单，保存与「保存内容」同走 `form.submit()`。
  const formHistory = useFormShortcutHistory(form, {
    onSave: () => form.submit(),
    historyEnabled: active && !saving,
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
    onExit?.();
  }, [content, form, onExit, resetFormHistory]);

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

  /**
   * 草稿 vs 当前表单内容的差异。
   *
   * 方向是 `summarizeDraftDiff(现在, 草稿)`：用户展开差异是想知道"点恢复会改掉什么"，
   * 所以左侧必须是当前值。`draftPending.values` 只是**被改过的那几个字段**（表单值快照），
   * 叠到当前值上就得到"草稿若恢复会变成的内容"。
   *
   * 依赖 `watched` 而不是 `form`：`getFieldsValue` 不是响应式的，靠表单值订阅来触发重算。
   */
  const draftChanges = useMemo<DraftDiffEntry[] | null>(() => {
    const pending = draftBar.draftPending;
    if (!pending) return null;
    // `watched` 优先：它是订阅来的表单值快照，值一变这个 memo 就必须重算。
    // 首帧 `watched` 还是 `undefined` 时退回一次性读取（`getFieldsValue(true)` 拿全量，
    // 包括未注册的字段）。
    const current = (watched ?? form.getFieldsValue(true) ?? {}) as ResumeContent;
    const drafted = { ...current, ...pending.values } as ResumeContent;
    return summarizeDraftDiff(current, drafted);
  }, [draftBar.draftPending, form, watched]);

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

  // Compiler 规范：随 active/内容/initialTarget 变化的回填用渲染期守卫式调整；
  // 表单实例写入与滚动聚焦的定时器副作用留在 effect。
  //
  // 判据是**内容签名**而不是 `content` 的引用：宿主每换一次 detail（版式 PATCH、AI 修订、
  // 采纳建议、收藏、备注……）都会传下一个 JSON 重新解析出来的新对象，正文却可能一个字都
  // 没变。按引用比较会让守卫与回填 effect 一起命中，把用户还没保存的正文覆盖成服务端那份。
  const contentSig = useMemo(() => (content ? contentSignature(content) : ""), [content]);
  const [prevSync, setPrevSync] = useState<{
    active: boolean;
    contentSig: string;
    initialTarget: string | null | undefined;
  } | null>(null);
  /**
   * 真正回填进表单的那份内容：只在"正文真的换了"（签名变）或 `active / initialTarget` 变了
   * 时才更新。
   *
   * 回填 effect 的依赖因此可以按签名写：引用换了但正文没变时 effect **不重跑**，用户没保存
   * 的输入不会被冲掉；而 effect 里读到的仍是当下这份 `content`，不是被签名掩盖的旧值。
   */
  const [syncedContent, setSyncedContent] = useState<ResumeContent | null>(content);
  if (
    prevSync === null ||
    prevSync.active !== active ||
    prevSync.contentSig !== contentSig ||
    prevSync.initialTarget !== initialTarget
  ) {
    setPrevSync({ active, contentSig, initialTarget });
    setSyncedContent(content);
    if (active && content) {
      setDirty(false);
      const target = initialTarget ? resolveEditorTarget(initialTarget) : null;
      setActiveTab(target?.tab ?? "basic");
    }
  }

  // 面板开着且没保存的修改还在时，挂 beforeunload：刷新/关闭浏览器出原生确认，
  // 不再静默丢稿。实现在 `resume/useBeforeUnloadGuard`。
  useBeforeUnloadGuard(active && dirty);

  useEffect(() => {
    if (!active || !syncedContent) return;
    form.setFieldsValue(syncedContent);
    // 换了/重开了这份简历：历史清空，以刚载入的内容为基线（撤回不该跨简历生效）。
    resetFormHistory();
    const target = initialTarget ? resolveEditorTarget(initialTarget) : null;
    if (!target || target.name.length === 0) return;
    // 滚动 + 聚焦的实现在 `editorFieldScroll`：与"点纸面定位"共用同一条，
    // 两个入口的"滚几次、什么时候聚焦"才不会各自漂。
    return scrollAndFocusEditorField(form, target.name);
  }, [active, form, initialTarget, resetFormHistory, syncedContent]);

  /*
   * 「点纸面字段 → 定位输入框」（制作台专用）。
   *
   * 与上面那条 effect 分开，而且是**必须分开**：上面那条同时负责"把服务端内容回填进表单"，
   * 复用它就意味着用户每点一次纸面，中栏里还没保存的改动就被服务端那份覆盖一次。
   *
   * 切标签页这一步放在**渲染期守卫**里（与本文件其它"外部信号变了就换态"同一写法）：
   * 在 effect 里 setState 只会多一轮级联渲染，而标签页必须**先**切过去，字段才挂得上、
   * 才滚得到。`{ path, nonce }` 而不是裸路径：同一条路径连点两次时对象引用也会变，
   * 定位因此会重跑（只比路径的话第二次点击毫无反应）。
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

  const tabItems = useMemo<TabsProps["items"]>(
    () => [
      {
        key: "basic",
        label: t("editor.tab.basic"),
        children: <ResumeBasicInfoTab summarySource={summarySource} onFillSummary={fillSummary} />,
      },
      { key: "education", label: t("editor.tab.education"), children: <EducationEditor /> },
      { key: "experience", label: t("editor.tab.experience"), children: <ExperienceEditor /> },
      { key: "campus", label: t("editor.tab.campus"), children: <CampusEditor /> },
      { key: "projects", label: t("editor.tab.projects"), children: <ProjectEditor /> },
      { key: "skills", label: t("editor.tab.skills"), children: <SkillEditor /> },
      { key: "awards", label: t("editor.tab.awards"), children: <AwardEditor /> },
      ...(resumeId
        ? [
            {
              key: "writing",
              label: t("editor.tab.writing"),
              children: (
                <ResumeWritingPanel
                  resumeId={resumeId}
                  initialText={content?.summary ?? ""}
                  onApply={(text) => form.setFieldValue("summary", text)}
                />
              ),
            },
          ]
        : []),
    ],
    // summarySource 决定「填入个人总结」是否出现；fillSummary 已用 useCallback 固定
    // （它自己依赖 setFormValue），只在值真的变时才重建标签页。
    [resumeId, content, form, summarySource, fillSummary],
  );

  const handleFinish = async (values: ResumeContent) => {
    if (!content) return;
    setSaving(true);
    try {
      // 照片不在本次编辑表单中，始终保留已校验的原始值。
      await onSave({ ...content, ...values, photo: content.photo });
      setDirty(false);
      // 存进去了就没有"没提交的草稿"了：清早了等于"保存失败也把内容扔了"，所以放在这里。
      draftBar.clearDraft();
      // 已保存的内容成为新基线：这次编辑不再可撤回（撤回已落库的改动会让人以为没存上）。
      resetFormHistory();
      // 出口二选一：中栏"存完继续调参数"（`onSaved`），弹窗"存完就关"（`onExit`）。
      if (onSaved) onSaved();
      else onExit?.();
    } catch (error) {
      // 保存失败走全站统一的「原因 · 建议 · 编号」指引（RF-20）：用户在制作台里改的是
      // 已落库的内容，失败后必须能看出"是网络、是权限、还是服务端挂了"，并在反馈时
      // 报得出那一次的 requestId 前 8 位。`editor.save.failed` 只作兜底主因。
      message.error(formatErrorGuidance(error, t("editor.save.failed")));
    } finally {
      setSaving(false);
    }
  };

  return {
    dirty,
    saving,
    confirming: draftBar.confirming,
    draftPending: draftBar.draftPending,
    draftChanges,
    activeTab,
    setActiveTab,
    tabItems,
    form,
    summarySource,
    fillSummary,
    fillContextValue,
    onValuesChange: () => {
      setDirty(true);
      formHistory.push();
    },
    onFinish: (values: ResumeContent) => void handleFinish(values),
    submit: () => form.submit(),
    requestClose: draftBar.requestClose,
    requestDiscard: draftBar.requestDiscard,
    discardEdits: handleDiscard,
    confirmPending: draftBar.confirmPending,
    keepEditing: draftBar.keepEditing,
    restoreDraft: draftBar.restoreDraft,
    discardDraft: draftBar.discardDraft,
    fillAllData,
  };
}
