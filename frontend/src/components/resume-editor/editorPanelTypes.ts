// SPDX-License-Identifier: Apache-2.0
/**
 * 简历内容编辑器状态机的**契约**（从 `useResumeEditorPanel` 拆出：500 行文件预算）。
 *
 * 拆的只是类型声明，行为一条都没变：`ResumeEditorPanel` 直接从这里取 API 类型，
 * 状态机（`useResumeEditorPanel`）只负责实现。
 */
import type { FormInstance, TabsProps } from "antd";
import type { ResumeContent } from "../../types";
import type { DraftDiffEntry } from "../../utils/draftDiff";
import type { ProfileFillSources } from "../../features/profile/profileFillOptions";
import type { ProfileFillContextValue } from "./profileFillContext";
import type { EditorPendingAction } from "./useEditorDraftBar";

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
  /**
   * 内容变化且表单有未保存改动时**不静默覆盖**，改为暴露 contentRefreshPending 让界面问一句。
   *
   * 只给"新建简历"打开：那里的 content 来自当前组投影，别的窗口改资料/切组会直接换一份；
   * 编辑已保存简历时 content 是服务端刚存下的正文，本来就该覆盖。
   */
  deferRefreshWhenDirty?: boolean;
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
  /**
   * **只上行**的草稿通道（制作台右栏实时预览用，P0-7）。
   *
   * 每次表单值变化都上报「按保存口径合并后的整份内容」——合并口径与 `onSave` 里那一句
   * **是同一份实现**（`mergePartial`），所以"预览所见"与"保存所得"在机械上不可能不同。
   *
   * 刻意**不是** `content` 的回传：让草稿沿着 props 变成 `content`，本文件那条"内容签名
   * 变了就重填表单"的守卫会命中，用户每打一个字就被服务端那份覆盖（设计 §7 R1，数据丢失）。
   */
  onDraftContent?: (content: ResumeContent) => void;
  /**
   * 草稿作废：右栏回落到宿主那一版 html。
   *
   * **三个调用点缺一不可**（漏一处就是"存完预览闪回旧内容"，设计 §7 R2）：
   * 1. 内容签名变化的重填（`useEditorContentSync` 里那条 `form.setFieldsValue` effect）；
   * 2. 放弃修改（`handleDiscard`）；
   * 3. 保存成功（`handleFinish`）。
   */
  onDraftReset?: () => void;
  /** W03：制作台由统一历史接管撤回/恢复时传 false（避免同一个组合键两套栈各退一步）。 */
  keyboardHistory?: boolean;
}

export interface ResumeEditorPanelApi {
  dirty: boolean;
  saving: boolean;
  /** 资料刷新到了，但表单有未保存改动所以没有覆盖（界面据此给两个动作，见下）。 */
  contentRefreshPending: boolean;
  /** 刷新提示的「用最新资料覆盖」：清脏 + 清草稿 + 用最新资料回填表单。 */
  applyLatestContent: () => void;
  /** 刷新提示的「保留当前编辑」：收起提示，保留未保存的输入。 */
  dismissContentRefresh: () => void;
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
   * `<Form onValuesChange>` 的处理：置脏 + 记一次可撤回的历史 + 上报草稿通道。
   *
   * 放在 API 里而不是让视图自己写一个空函数：脏值与历史是**状态机的两件事**，
   * 视图重复实现一次就会出现"改了但保存按钮不亮"。
   *
   * `allValues`（第二个参数，antd 已透传）是上报实时预览的依据：只拿 `changedValues`
   * 拼不出整份内容，而预览要的是整份。
   */
  onValuesChange: (changed: unknown, allValues: ResumeContent) => void;
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
  /** 「填入我的资料全部数据」的入口：`fillAll` 没传时为 `null`，视图据此完全不渲染。
   * 确认分支住在 `useEditorDraftBar` 里，只有 hook 才够得着，所以当 API 交出去。 */
  fillAllData: (() => void) | null;
  /** 外部整份替换（W06 大纲命令）：写回表单 + 标脏 + 记一次可撤回历史；不触发保存。 */
  replaceContent: (next: ResumeContent) => void;
}
