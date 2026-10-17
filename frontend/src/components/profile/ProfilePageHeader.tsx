import {
  CloseOutlined,
  DownOutlined,
  EditOutlined,
  FileSearchOutlined,
  SaveOutlined,
  UpOutlined,
} from "@ant-design/icons";
import { Button, Typography } from "antd";
import type { ProfileWorkspaceKey } from "./ProfileWorkspaceTabs";

interface Props {
  editing: boolean;
  activeWorkspace: ProfileWorkspaceKey;
  saving: boolean;
  extraSaving: boolean;
  photoReading: boolean;
  profileTextParsing: boolean;
  allExpanded: boolean;
  onOpenProfileTextModal: () => void;
  onCancelEditing: () => void;
  onSubmitAll: () => Promise<void>;
  onToggleExpandAll: () => void;
  onStartEditing: () => void;
}

export default function ProfilePageHeader({
  editing,
  activeWorkspace,
  saving,
  extraSaving,
  photoReading,
  profileTextParsing,
  allExpanded,
  onOpenProfileTextModal,
  onCancelEditing,
  onSubmitAll,
  onToggleExpandAll,
  onStartEditing,
}: Props) {
  return (
    <div className="profile-page-header">
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>
          我的资料
        </Typography.Title>
        <Typography.Text type="secondary">
          简历资料用于生成简历，网申资料用于补充网申填表
        </Typography.Text>
      </div>
      <div className="profile-page-header-actions">
        {editing ? (
          <>
            {activeWorkspace === "resume" ? (
              <Button
                icon={<FileSearchOutlined />}
                disabled={saving || photoReading || profileTextParsing}
                onClick={onOpenProfileTextModal}
              >
                粘贴文本识别
              </Button>
            ) : null}
            <Button
              icon={<CloseOutlined />}
              disabled={saving || photoReading}
              onClick={onCancelEditing}
            >
              取消
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving || extraSaving}
              disabled={photoReading}
              onClick={() => void onSubmitAll()}
            >
              保存全部资料
            </Button>
          </>
        ) : (
          <>
            {activeWorkspace === "resume" ? (
              <Button
                icon={allExpanded ? <UpOutlined /> : <DownOutlined />}
                onClick={onToggleExpandAll}
              >
                {allExpanded ? "全部收起" : "全部展开"}
              </Button>
            ) : null}
            <Button icon={<EditOutlined />} onClick={onStartEditing}>
              编辑资料
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
