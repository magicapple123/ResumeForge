// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台三栏的**布局外壳**（2026-10-25 从 `ResumeZoomModal` 拆出，行数预算）。
 *
 * 纯形态：冲突条挂载点 + 参数栏 + 两条分隔条 + 内容栏 + 画布。它不判断"该不该渲染某一栏"
 * ——可见性由 `ResumeZoomModal` 按档位 / 工作区预设算好后传入；这里只回答"三栏怎么排"。
 * 与 `WorkbenchModalFrame` 同一类：外壳归外壳，状态归组合根。
 *
 * 两条分隔条的**顺序**是这里的核心约束：参数栏右缘一条（参数栏之后、内容栏之前），
 * 内容栏右缘一条（内容栏之后、画布之前）。两栏档没有第二条（内容栏进抽屉），
 * 只读宿主没有第二条（中栏不渲染），都由布尔量在调用方算好。
 */
import type { ReactNode, RefObject } from "react";
import WorkbenchResizer from "./WorkbenchResizer";
import type { WorkbenchColumnsApi } from "./useWorkbenchColumns";

interface Props {
  bodyRef: RefObject<HTMLDivElement | null>;
  columns: WorkbenchColumnsApi;
  hasSettings: boolean;
  editorEnabled: boolean;
  showParamsColumn: boolean;
  showEditorColumn: boolean;
  paramsColumn: ReactNode;
  editorColumn: ReactNode;
  /** 画布栏（右栏）：由调用方构造后作为 children 传入，外壳不关心它内部吃什么。 */
  children: ReactNode;
  /** 冲突条（W02）：浮在正文上方，不新增第二层弹窗。 */
  conflictBar?: ReactNode;
}

export default function WorkbenchColumnsBody({
  bodyRef,
  columns,
  hasSettings,
  editorEnabled,
  showParamsColumn,
  showEditorColumn,
  paramsColumn,
  editorColumn,
  children,
  conflictBar,
}: Props) {
  // 宽度仍由 `useWorkbenchColumns` 以自定义属性下发；高度交给弹窗容器的 flex。
  const style = {
    ...columns.style,
    height: "auto",
    flex: "1 1 auto",
    minHeight: 0,
  };
  return (
    <div
      ref={bodyRef}
      style={style}
      className={`resume-wb-body${hasSettings ? "" : " is-preview-only"}${
        editorEnabled ? "" : " is-editor-hidden"
      }`}
    >
      {conflictBar}
      {showParamsColumn ? paramsColumn : null}
      {/* 参数栏右缘的分隔条：只有中栏真的在栅格里时才给，否则"拖参数栏"没有相邻列可让。 */}
      {showParamsColumn && showEditorColumn ? (
        <WorkbenchResizer columns={columns} kind="params" />
      ) : null}
      {showEditorColumn ? editorColumn : null}
      {showEditorColumn ? <WorkbenchResizer columns={columns} kind="editor" /> : null}
      {children}
    </div>
  );
}
