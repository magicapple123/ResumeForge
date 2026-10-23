// SPDX-License-Identifier: Apache-2.0
/**
 * 简历制作台 · **中栏**：内容编辑器（状态条 + 面板 + 动作条）。
 *
 * ## 与「手动调整」弹窗共用同一份主体
 *
 * 主体是 `resume-editor/ResumeEditorPanel`（`variant="inline"`），判据是
 * `resume-editor/useResumeEditorPanel`。这个文件只做三件事：把宿主参数翻译成 hook 入参、
 * 在中栏顶部加一条状态条、在底部加一条动作条。两份实现迟早在"能不能改照片、有没有写作
 * 增强"上分叉，所以一行表单代码都不在这里（`<Form>` 也不在这里，见 `popupGuard` P1）。
 *
 * ## 草稿作用域
 *
 * 固定带 `#workbench` 后缀：中栏与弹窗各有一份草稿。共用一个槽位的话，中栏里没保存的
 * 内容会在关掉中栏之后从弹窗里冒出来（设计 §3.1 / 风险 6）。
 *
 * ## 三个出口，语义各不相同
 *
 * | 动作 | 结果 |
 * |---|---|
 * | 保存内容 | PATCH → 宿主重渲染 → **留在原地**（`onSaved` 是空实现：宿主自己会提示） |
 * | 放弃修改 | 内联确认 → 回填服务端内容 + 清草稿 → 留在原地 |
 * | 关闭制作台（Esc / × / 遮罩） | 无脏值直接关；有脏值先在中栏出一次内联确认 |
 *
 * 第三条由 `closeSignal` 驱动：弹窗口子只有 `onCancel` 一个入口，而脏值住在这一层的
 * hook 里。用一个自增的计数而不是回调传递，是因为回调要在渲染期被重新赋值（Compiler
 * 禁止渲染期写 ref），而计数是纯数据；中栏把脏值同时上报给弹窗，弹窗据此决定"直接关"
 * 还是"自增一次、让中栏把确认亮出来"。
 *
 * 2026-11：制作台里前两条出口（保存内容 / 放弃修改）由 `hideActions` 摘掉，整屏顶部
 * 那一对是**整体**的（内容 + 排版参数）。组件能力不变——弹窗宿主照旧用同一个组件，
 * 只是不传这个 prop；"关闭制作台"的第三条确认与它无关，永远都在。
 */
import { SaveOutlined } from "@ant-design/icons";
import { Button, Space } from "antd";
import type { Ref } from "react";
import { useEffect, useImperativeHandle, useState } from "react";
import type { ResumeContent } from "../../types";
import type { ProfileFillSources } from "../../features/profile/profileFillOptions";
import { t } from "../../i18n";
import EditorFooterBar from "../resume-editor/EditorFooterBar";
import ResumeEditorPanel from "../resume-editor/ResumeEditorPanel";
import { useResumeEditorPanel } from "../resume-editor/useResumeEditorPanel";

/**
 * 中栏交给宿主的两个出口（2026-11：整屏顶部动作条的「保存修改 / 取消修改」要用）。
 *
 * 为什么是命令式句柄而不是再加两个回调：这两件事的**判据全在中栏里**（表单实例、
 * 脏值、内联确认的状态机）。宿主要么拿句柄去点一下，要么就得在中栏里再实现一遍
 * "表单提交"——那正是这轮抽 `useResumeEditorPanel` 想消灭的重复。
 */
export interface ResumeWorkbenchEditorHandle {
  /** = `api.submit`：走表单校验 → `onSave`（与中栏底部「保存内容」同一条链路）。 */
  save: () => void;
  /**
   * = `api.discardEdits`：立刻放弃，**不再二次确认**。
   *
   * 顶部动作条自己已经就地问过一遍（它离用户的眼睛更近），所以这里刻意**不**走
   * `api.requestDiscard`——那条会顺带把中栏底部的确认条亮起来，两条确认叠在两处，
   * 用户只会以为点错了。底部动作条仍旧直接用 `api.requestDiscard`（它就在眼前，
   * 就地确认正合适），两条路径各自成立。
   */
  discard: () => void;
}

interface Props {
  /** 顶部动作条用的命令式出口（React 19：函数组件直接收 `ref`，不需要转发）。 */
  ref?: Ref<ResumeWorkbenchEditorHandle>;
  /** 中栏是否可见：折叠 / 窄屏时不读不写草稿、也不挂 beforeunload。 */
  active: boolean;
  /** 这份简历**已保存**的内容（宿主 `detail.content`）。 */
  content: ResumeContent | null;
  resumeId?: number;
  /**
   * 「从我的资料追加一条」的候选（`null` = 没有这条入口）。
   *
   * 与「手动调整」弹窗**同一份实现**：中栏是用户改内容的主场，只给弹窗开而不给中栏开，
   * 就会出现"在制作台里改内容时无法从资料带一条进来，必须关掉制作台再开手动调整"。
   */
  fillSources?: ProfileFillSources | null;
  /** 后端正在按新参数重排：状态条上说明一句，避免用户以为编辑器卡了。 */
  relayouting?: boolean;
  /** 宿主负责 PATCH + 重渲染；resolve 即已落库。 */
  onSave: (content: ResumeContent) => Promise<void>;
  /** 脏值变化（宿主据此禁用底部「手动调整」，见设计 §9 Q6）。 */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * 保存中状态变化（宿主据此给顶部「保存修改」按钮上 loading、并暂时禁用「取消修改」）。
   *
   * 与 `onDirtyChange` 同一条写法：顶部动作条只有这一份信号，按钮才不会出现"点了两次
   * 各发一次 PATCH"。
   */
  onSavingChange?: (saving: boolean) => void;
  /** 关闭制作台（无脏值时由弹窗直接调用）。缺省 = 这一栏不负责关闭。 */
  onRequestClose?: () => void;
  /**
   * 外部请求关闭：每次 +1 视为一次"想问一句"。
   *
   * **2026-10-24 起制作台不再使用这条链路**：关闭确认改成动作条最右那颗 × 自带的
   * `Popconfirm`（卡片长在用户刚点的地方，中栏不渲染时也不会"关不掉"）。能力保留在
   * 这里，是因为它描述的是中栏自己的事实（脏值只有它知道）；缺省 0 = 永不被触发。
   */
  closeSignal?: number;
  /**
   * 「点纸面字段 → 定位输入框」的请求（右栏预览点的，送到这一栏来）。
   *
   * `nonce` 每次点击自增：同一条路径连点两次时对象引用也会变，定位才能重新跑一遍
   * （只比路径的话，第二次点击会被"值没变"的判据吃掉）。
   */
  pickTarget?: { path: string; nonce: number } | null;
  /**
   * 藏起底部那对「保存内容 / 放弃修改」。
   *
   * 制作台里已经有**一对整体的**保存/取消（顶部动作条：内容与排版参数一起收口），底部
   * 再摆一对，用户得先判断"这两颗管的是不是同一件事"。弹窗宿主不传这个 prop，行为
   * 与之前逐字相同；"关闭制作台"的内联确认**不受它影响**（那是另一件事）。
   */
  hideActions?: boolean;
  /**
   * "关闭制作台"那道确认的文案（缺省 = 只有内容脏时那句「这份简历还有改动没有保存」）。
   *
   * 为什么由弹窗给：脏值有两个来源（中栏内容 / 左栏版式），只有弹窗两层都看得见。只改了版式
   * 时丢的东西完全不同，用同一句话会把"版式也会丢"这件事藏起来。
   */
  closeConfirmBody?: string;
}

export default function ResumeWorkbenchEditorColumn({
  ref,
  active,
  content,
  resumeId,
  fillSources,
  relayouting = false,
  onSave,
  onDirtyChange,
  onSavingChange,
  onRequestClose,
  closeSignal = 0,
  pickTarget,
  hideActions = false,
  closeConfirmBody,
}: Props) {
  const api = useResumeEditorPanel({
    active,
    content,
    resumeId,
    // 与弹窗分开一份草稿：见文件头。
    draftScopeKey: `resume.edit#${resumeId ?? "new"}#workbench`,
    fillSources,
    pickTarget,
    onSave,
    // 保存成功**不关**制作台：用户刚改完一句措辞，下一步往往是接着调参数、看右栏排版。
    // 保存成功的提示由宿主（`saveEditedResume`）给，这里不重复弹。
    onSaved: () => undefined,
  });

  // 脏值上报：底部那一排动作里的「手动调整」在有未保存内容时要禁用（两个编辑器同时开
  // 会各自持有一份 form，互相覆盖草稿）。
  useEffect(() => {
    onDirtyChange?.(api.dirty);
  }, [api.dirty, onDirtyChange]);
  // 中栏卸载（关掉制作台）时复位：否则「手动调整」会被永久禁用一个不存在的脏值。
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  // 保存中上报：顶部动作条的「保存修改」靠它上 loading。
  useEffect(() => {
    onSavingChange?.(api.saving);
  }, [api.saving, onSavingChange]);
  useEffect(() => () => onSavingChange?.(false), [onSavingChange]);

  // 顶部动作条的两颗按钮经由这个句柄打到中栏的状态机上（见 `ResumeWorkbenchEditorHandle`）。
  // 依赖写在这两个函数上而不是整个 `api`：`api` 每次渲染都是新对象，挂上去会让句柄失效。
  useImperativeHandle(ref, () => ({ save: api.submit, discard: api.discardEdits }), [
    api.submit,
    api.discardEdits,
  ]);

  // "关闭制作台"的内联确认：弹窗那侧只知道自己"想关"，脏值只有这里知道。
  //
  // 用渲染期守卫（`prev !== next` 就地调整 state）而不是 effect：effect 里 setState 会
  // 触发一轮级联渲染，而且这里描述的是"这个信号处理过了"——那是渲染期就能判定的事实。
  const [handledSignal, setHandledSignal] = useState(closeSignal);
  const [closeConfirm, setCloseConfirm] = useState(false);
  if (handledSignal !== closeSignal) {
    setHandledSignal(closeSignal);
    setCloseConfirm(true);
  }

  const confirmClose = () => {
    // 先把这份草稿与表单一起丢掉（`discardEdits` 会清 sessionStorage 里的草稿），
    // 再关：只关不清的话，下次打开中栏会冒出"已经放弃的改动"。
    api.discardEdits();
    setCloseConfirm(false);
    onRequestClose?.();
  };

  /**
   * 底部动作区。三个出口的优先级：
   * 1. "要关制作台"的内联确认（`closeConfirm`）—— 它必须在，即使按钮被藏起来
   *    （关闭请求来自弹窗，不是来自这一排按钮）；
   * 2. `hideActions` —— 制作台里整屏顶部已有一对整体的保存/取消，这一排不渲染；
   * 3. 其余：待确认动作的确认条 / 平时的「保存内容 + 放弃修改」。
   */
  const actions = closeConfirm ? (
    // 就地换态（与 `EditorFooterBar` 同一套内联确认形态）：不新开第二个弹层，
    // 制作台本身已经是一个整屏弹窗。
    <div className="rf-form-modal-discard" role="alert" aria-live="assertive">
      <span className="rf-form-modal-discard-text">
        {closeConfirmBody ?? t("resume.editor.discard.body")}
      </span>
      <Space>
        <Button onClick={() => setCloseConfirm(false)}>{t("common.action.keep-editing")}</Button>
        <Button danger onClick={confirmClose}>
          {t("common.action.discard")}
        </Button>
      </Space>
    </div>
  ) : hideActions ? null : api.confirming ? (
    <EditorFooterBar
      confirming={api.confirming}
      saving={api.saving}
      saveLabel={t("workbench.action.save-content")}
      onRequestClose={api.requestClose}
      onConfirmPending={api.confirmPending}
      onKeepEditing={api.keepEditing}
      onSubmit={api.submit}
    />
  ) : (
    <Space>
      {/* 只在脏值时是主按钮：一颗永远高亮的「保存内容」会让"有没有改动"失去信号。 */}
      <Button
        type={api.dirty ? "primary" : "default"}
        icon={<SaveOutlined />}
        loading={api.saving}
        onClick={api.submit}
      >
        {t("workbench.action.save-content")}
      </Button>
      <Button disabled={!api.dirty || api.saving} onClick={api.requestDiscard}>
        {t("workbench.action.discard-edits")}
      </Button>
    </Space>
  );

  return (
    <div className="resume-wb-editor">
      <div className="resume-wb-editor-head">
        <span className="resume-wb-editor-title">{t("workbench.column.editor")}</span>
        {relayouting ? (
          <span className="resume-wb-editor-status">{t("workbench.status.relayouting")}</span>
        ) : api.dirty ? (
          <span className="resume-wb-editor-status">{t("workbench.status.unsaved")}</span>
        ) : null}
      </div>
      <div className="resume-wb-editor-body">
        <ResumeEditorPanel api={api} variant="inline" />
      </div>
      {/* 底部这一行整行都可以不渲染：只藏按钮会留下一条空白的条。 */}
      {actions ? <div className="resume-wb-editor-actions">{actions}</div> : null}
    </div>
  );
}
