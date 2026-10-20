// SPDX-License-Identifier: Apache-2.0
import { Tabs } from "antd";
import { memo } from "react";
import type { ReactNode } from "react";

interface Props {
  resumeContent: ReactNode;
  webFormContent: ReactNode;
  /**
   * 当前激活的分页（受控）：「粘贴文本识别」成功后要由代码把用户带回「简历资料」，
   * 非受控的 Tabs 做不到这一点。切分页本来就会整页重渲一次，受控带来的 memo 重算
   * 只发生在切分页/识别回切时，不影响打字路径。
   */
  activeKey: ProfileWorkspaceKey;
  onActiveKeyChange?: (key: ProfileWorkspaceKey) => void;
}

export type ProfileWorkspaceKey = "resume" | "web-form";

function isProfileWorkspaceKey(key: string): key is ProfileWorkspaceKey {
  return key === "resume" || key === "web-form";
}

/**
 * **memo**：两个 tab 常驻挂载（destroyOnHidden=false）。页面因网申资料击键重渲时，
 * 只要传进来的子树元素引用不变（ProfilePage 侧用 useMemo 钉住了），整个 Tabs
 * 连同其中所有内容子树一起跳过重渲。
 */
function ProfileWorkspaceTabsImpl({
  resumeContent,
  webFormContent,
  activeKey,
  onActiveKeyChange,
}: Props) {
  return (
    <Tabs
      className="profile-workspace-tabs"
      activeKey={activeKey}
      destroyOnHidden={false}
      onChange={(key) => {
        if (isProfileWorkspaceKey(key)) onActiveKeyChange?.(key);
      }}
      items={[
        {
          key: "resume",
          label: "简历资料",
          children: resumeContent,
        },
        {
          key: "web-form",
          label: "网申资料",
          children: webFormContent,
        },
      ]}
    />
  );
}

export default memo(ProfileWorkspaceTabsImpl);
