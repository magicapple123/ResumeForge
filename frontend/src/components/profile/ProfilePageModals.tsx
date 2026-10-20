// SPDX-License-Identifier: Apache-2.0
/**
 * 我的资料页上挂着的三个弹窗：生成通用简历 / 手写简历 / 粘贴识别。
 *
 * 抽出来是为了让 `ProfilePage.tsx` 守在单文件 500 行预算内（P5b 预算前置动作）。
 * 这里**只做装配**：开关状态与回调全部由页面（及其 `useProfilePage`）持有，本组件不存 state。
 *
 * Props 用**分组对象**而不是摊平成十几个：三组各自对应一个弹窗，读起来就是
 * "generate 这个弹窗、manual 这个弹窗、profileText 这个弹窗"，加一个弹窗也不会把签名搅乱。
 */
import type { ComponentProps } from "react";
import GenerateResumeModal from "../GenerateResumeModal";
import ManualResumeModal from "../ManualResumeModal";
import ProfileTextModal from "./ProfileTextModal";

interface Props {
  generate: { open: boolean; onClose: () => void };
  manual: { open: boolean; onClose: () => void };
  /** 简历资料的粘贴识别弹窗：整套 props 由页面透传（`ProfileTextModal` 的契约就是它的契约）。 */
  profileText: ComponentProps<typeof ProfileTextModal>;
  /** 网申资料的粘贴识别弹窗（同一组件，`mode: "webform"`）。 */
  webformText?: ComponentProps<typeof ProfileTextModal>;
}

export default function ProfilePageModals({ generate, manual, profileText, webformText }: Props) {
  return (
    <>
      <GenerateResumeModal job={null} open={generate.open} onClose={generate.onClose} />
      <ManualResumeModal
        job={null}
        open={manual.open}
        // T12：保存后由 `resumeListEvents` 广播刷新，入口不再各自 reload；
        // 关闭（含取消）也不需要任何额外动作。
        onClose={manual.onClose}
      />
      <ProfileTextModal {...profileText} />
      {webformText ? <ProfileTextModal {...webformText} /> : null}
    </>
  );
}
