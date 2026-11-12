// SPDX-License-Identifier: Apache-2.0
/**
 * 我的资料页上挂着的两个粘贴识别弹窗：简历资料 / 网申资料。
 *
 * 抽出来是为了让 `ProfilePage.tsx` 守在单文件 500 行预算内（P5b 预算前置动作）。
 * 这里**只做装配**：开关状态与回调全部由页面（及其 `useProfilePage` / `useWebformParse`）
 * 持有，本组件不存 state。
 *
 * 「生成通用简历」与「手写简历」两个弹窗 2026-10-24 从这一页移除（用户口径："我的资料
 * 里不该有通用简历"）：新建简历统一走简历中心的「新建简历」。那条链路完整保留在
 * `GenerateResumeModal` / `ManualResumeModal` 里，只是不再从这一页进入。
 */
import type { ComponentProps } from "react";
import ProfileTextModal from "./ProfileTextModal";

interface Props {
  /** 简历资料的粘贴识别弹窗：整套 props 由页面透传（`ProfileTextModal` 的契约就是它的契约）。 */
  profileText: ComponentProps<typeof ProfileTextModal>;
  /** 网申资料的粘贴识别弹窗（同一组件，`mode: "webform"`）。 */
  webformText?: ComponentProps<typeof ProfileTextModal>;
}

export default function ProfilePageModals({ profileText, webformText }: Props) {
  return (
    <>
      <ProfileTextModal {...profileText} />
      {webformText ? <ProfileTextModal {...webformText} /> : null}
    </>
  );
}
