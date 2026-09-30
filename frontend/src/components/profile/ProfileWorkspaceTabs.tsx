import { Tabs } from "antd";
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

export default function ProfileWorkspaceTabs({
  resumeContent,
  webFormContent,
  onActiveKeyChange,
}: Props) {
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
