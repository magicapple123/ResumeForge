// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台的**Modal 外壳**（从 `ResumeZoomModal` 拆出，2026-10-24 W02 行数预算）。
 *
 * 拆出的唯一原因：外壳文件要同时装"三栏编排 + 条件保存 + 冲突条"，已经贴住单文件 500 行
 * 预算（零豁免）。这一块是**纯形态**——铺满视口、禁蒙层关闭、没有底部按钮组——没有任何
 * 状态判断，搬出去之后外层只回答"装什么"，不再回答"长什么样"。
 *
 * 形态规则（改之前先读）：
 * - **铺满视口**：宽度用 `100%`（= wrapper 宽度，不含滚动条）而不是 `100vw`——后者把
 *   竖向滚动条也算进去，横向会多出十几像素溢出。`padding: 0` 必须显式写：antd 给
 *   `.ant-modal` 的 `padding-bottom: 24px` 会让底部露出遮罩（又一条"黑边"）。
 * - **禁蒙层关闭**：整屏未保存编辑，误点遮罩的代价太大。
 * - **没有底部按钮组**：动作区在标题行（标题节点就是动作条）。`footer={null}` 显式写而不是
 *   省略，是为了让 `popupGuard` P2（"Modal 必须自带 footer 或 okText"）看得到这个决定。
 * - **关闭按钮自绘**：`closable={false}`，× 由动作条最右那颗承担（它自带就地确认卡片）。
 */
import { Modal } from "antd";
import type { ModalProps } from "antd";
import type { CSSProperties, ReactNode } from "react";

/** 标题节点高度 56px 由 CSS 接管（见 `workbench-shell.css` 的 `.ant-modal-header`）。 */
const SHELL_STYLE: CSSProperties = {
  top: 0,
  height: "100dvh",
  maxWidth: "none",
  margin: 0,
  padding: 0,
};

const SHELL_STYLES: NonNullable<ModalProps["styles"]> = {
  wrapper: { inset: 0, display: "flex", alignItems: "stretch", overflow: "hidden" },
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    maxHeight: "100%",
    margin: 0,
    padding: 0,
    overflow: "hidden",
  },
  header: { flex: "0 0 auto", marginBottom: 0 },
  body: {
    display: "flex",
    flex: "1 1 auto",
    minHeight: 0,
    overflow: "hidden",
    padding: 0,
  },
};

interface Props {
  open: boolean;
  /** Esc / 遮罩（尽管遮罩已禁）/ 自绘 × 统一走这里，由外层判断"直接关还是问一句"。 */
  onCancel: () => void;
  /** 标题节点：制作台就是动作条（`ResumeWorkbenchActionBar`）。 */
  title: ReactNode;
  children: ReactNode;
}

export default function WorkbenchModalFrame({ open, onCancel, title, children }: Props) {
  return (
    <Modal
      title={title}
      open={open}
      onCancel={onCancel}
      closable={false}
      mask={{ closable: false }}
      footer={null}
      width="100%"
      style={SHELL_STYLE}
      classNames={{ wrapper: "resume-zoom-workbench-wrap" }}
      styles={SHELL_STYLES}
      destroyOnHidden
    >
      {children}
    </Modal>
  );
}
