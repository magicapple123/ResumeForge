// SPDX-License-Identifier: Apache-2.0
/**
 * 简历微调表单的**弹窗壳**：编辑已保存简历（「手动调整」）与自行编写简历共用。
 *
 * 2026-10-23 起主体被抽成两个可复用文件，这里只剩三件事：
 *
 * 1. `Modal` 的壳（宽窄两档、层级、禁蒙层关闭、body 滚动方式）；
 * 2. `footer`（`EditorFooterBar` 的两态：正常按钮组 / 内联确认条）；
 * 3. 把宿主参数转成 `useResumeEditorPanel` 的入参。
 *
 * 表单主体、草稿条、标签页与那个唯一的 `<Form>` 在
 * `resume-editor/ResumeEditorPanel.tsx`；脏值/草稿/历史/提交的判据在
 * `resume-editor/useResumeEditorPanel.tsx`。抽出来的原因不是"文件太长"本身，而是
 * **制作台中栏要挂同一份主体**：两份实现迟早在"能不能改照片、有没有写作增强"上分叉。
 */
import { Grid, Modal, Space } from "antd";
import type { ReactNode } from "react";
import type { ResumeContent } from "../types";
import type { ProfileFillSources } from "../features/profile/profileFillOptions";
import { layer } from "../theme/tokens";
import EditorFooterBar from "./resume-editor/EditorFooterBar";
import ResumeEditorPanel from "./resume-editor/ResumeEditorPanel";
import { useResumeEditorPanel } from "./resume-editor/useResumeEditorPanel";

interface Props {
  open: boolean;
  content: ResumeContent | null;
  onClose: () => void;
  onSave: (content: ResumeContent) => Promise<void>;
  title?: string;
  description?: string;
  /** 渲染在说明行之上的额外内容（手写简历的「简历名称」输入，项 11）。 */
  headerExtra?: ReactNode;
  saveLabel?: string;
  referencePanel?: ReactNode;
  /** 从预览点击进入时使用的结构化字段路径，如 projects.0.description.1。 */
  initialTarget?: string | null;
  /** 提供后启用「写作增强」标签页（STAR/润色/翻译/话术，结果回填个人总结）。 */
  resumeId?: number;
  /** 草稿作用域（缺省 `resume.edit#<resumeId|new>`）。
   *
   * 「自行编写某岗位简历」没有 `resumeId`，只按 id 分槽会让所有岗位共用 `resume.edit#new`
   * ——在岗位 A 放弃修改后打开岗位 B，B 里会冒出 A 的草稿还能一键灌进去。这类入口要把
   * 岗位维度拼进作用域（见 `ManualResumeModal`）。
   */
  draftScopeKey?: string;
  /**
   * 「从我的资料填入」的候选；不传则这条入口完全不渲染。
   *
   * 手写简历会传（"预填之后我又补了一段实习，想加进这份简历"）；编辑已保存简历时不传
   * ——那时用户要的是改这一份，不是从资料里再抓一条进来。
   */
  fillSources?: ProfileFillSources | null;
  /**
   * 是否渲染**条目级**的「从资料填入本条」，默认 `true`。
   *
   * 关掉它（`false`）时，模块顶部的「从我的资料追加一条」照旧可用，只是每个条目头部
   * 不再出现下拉。岗位详情里的「自行编写简历」用它：那份表单的经历/项目是空的，
   * 用户要照着岗位从头写，条目级填入没有可对应的东西。
   */
  entryFill?: boolean;
  /**
   * 「填入我的资料全部数据」（T11）。
   *
   * 提供后头部多一个次按钮：把整份「我的资料」一次性带进表单。手写通用简历会传
   * （它从空白开始，需要一条"要么自己写、要么全部带入"的捷径）；岗位模式与编辑已保存
   * 简历都不传——前者会替用户做决定，后者要的是改这一份而不是换成资料里的内容。
   */
  fillAll?: () => ResumeContent;
  /**
   * footer 左侧的额外动作（「前往简历制作台」）。
   *
   * 只在**新建**场景由 `ManualResumeModal` 传入：那条入口的语义是"先落库、再去制作台
   * 从空白开始排版"，没有这份简历的 id 就无从进制作台。编辑已保存简历时不传——
   * 那里本来就能从预览页直达制作台。
   *
   * 确认态（`api.confirming`）下不渲染：那一行整条让给确认句与两颗按钮。
   */
  footerExtra?: ReactNode;
}

export default function ResumeEditorModal({
  open,
  content,
  onClose,
  onSave,
  title = "手动调整简历内容",
  description,
  headerExtra,
  saveLabel = "保存并更新预览",
  referencePanel,
  initialTarget,
  resumeId,
  draftScopeKey,
  fillSources,
  entryFill = true,
  fillAll,
  footerExtra,
}: Props) {
  // 弹窗形态 = 「面板可见」跟着 open 走：关掉时既不读也不写草稿、也不挂 beforeunload。
  // `onExit` 就是关窗：保存成功、放弃修改、无脏值关闭都汇到这一个出口。
  const api = useResumeEditorPanel({
    active: open,
    content,
    resumeId,
    initialTarget,
    draftScopeKey,
    fillSources,
    entryFill,
    fillAll,
    onSave,
    onExit: onClose,
  });

  // "两栏独立滚动"：要有参考栏、且屏幕够宽（两处判据必须一致，见 `ResumeEditorPanel`：
  // 判两次不一致会出现"body 不滚 + grid 不是双栏"，内容就滚不动了）。
  const screens = Grid.useBreakpoint();
  const wideLayout = Boolean(referencePanel) && Boolean(screens.lg);

  return (
    <Modal
      title={title}
      open={open}
      width={referencePanel ? "min(1320px, calc(100vw - 24px))" : "min(1000px, calc(100vw - 24px))"}
      // 必须高于宿主弹窗（ResumeDetailModal / GenerateResumeModal）：全局主题把
      // zIndexPopupBase 提到了 3100，宿主 Modal 因此在 3100；这里写死 3110 才能稳稳
      // 盖在宿主之上。旧的 1100 反而比宿主低——编辑器被宿主弹窗整个压住，看起来就是
      // 「手动调整」卡片被挡住了。
      zIndex={layer.editorModal}
      destroyOnHidden
      mask={{ closable: false }}
      keyboard={!api.saving}
      onCancel={api.requestClose}
      footer={
        // 确认态独占整行：那一刻用户在回答"要不要放弃"，旁边多一颗"去制作台"只会分心。
        api.confirming || !footerExtra ? (
          <EditorFooterBar
            confirming={api.confirming}
            saving={api.saving}
            saveLabel={saveLabel}
            onRequestClose={api.requestClose}
            onConfirmPending={api.confirmPending}
            onKeepEditing={api.keepEditing}
            onSubmit={api.submit}
          />
        ) : (
          <Space size={8} wrap>
            {footerExtra}
            <EditorFooterBar
              confirming={api.confirming}
              saving={api.saving}
              saveLabel={saveLabel}
              onRequestClose={api.requestClose}
              onConfirmPending={api.confirmPending}
              onKeepEditing={api.keepEditing}
              onSubmit={api.submit}
            />
          </Space>
        )
      }
      styles={{
        // 宽屏 + 岗位参考：**body 不滚**，左右两栏各滚各的（见 styles/resume.css）。
        // 这里必须同时把 body 变成纵向 flex：`height: 100%` 只有在父容器高度确定时才
        // 生效，而 `max-height` 单独一个并不构成确定高度——flex 布局会把剩余高度算给
        // grid，`min-height: 0` 才允许它缩到内容以下、让子栏真正出现滚动条。
        // 窄屏与无参考时保持原来的"整块 body 一起滚"。
        body: wideLayout
          ? {
              maxHeight: "var(--rf-modal-body-max-h)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }
          : { maxHeight: "var(--rf-modal-body-max-h)", overflowY: "auto", overflowX: "hidden" },
      }}
    >
      <ResumeEditorPanel
        api={api}
        variant="modal"
        description={description}
        headerExtra={headerExtra}
        referencePanel={referencePanel}
        onFillAll={api.fillAllData ?? undefined}
      />
    </Modal>
  );
}
