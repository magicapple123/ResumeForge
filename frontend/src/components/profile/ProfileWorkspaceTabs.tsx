import { Tabs } from "antd";
import { memo } from "react";
import type { ReactNode } from "react";

interface Props {
  resumeContent: ReactNode;
  webFormContent: ReactNode;
  onActiveKeyChange?: (key: ProfileWorkspaceKey) => void;
}

export type ProfileWorkspaceKey = "resume" | "web-form";

function isProfileWorkspaceKey(key: string): key is ProfileWorkspaceKey {
  return key === "resume" || key === "web-form";
}

/**
 * **memo**：两个 tab 常驻挂载（destroyOnHidden=false）。页面因网申资料击键重渲时，
 * 只要传进来的子树元素引用不变（ProfilePage 侧用 useMemo 钉住了），整个 Tabs
 * 连同其中所有内容子树一起跳过重渲。activeKey 由 Tabs 自身管理（非受控），
 * 切 tab 的更新不经过这里，memo 不会挡住它。
 */
function ProfileWorkspaceTabsImpl({ resumeContent, webFormContent, onActiveKeyChange }: Props) {
  return (
    <Tabs
      className="profile-workspace-tabs"
      defaultActiveKey="resume"
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
