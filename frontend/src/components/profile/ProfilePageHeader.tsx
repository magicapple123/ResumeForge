// SPDX-License-Identifier: Apache-2.0
/**
 * 我的资料页头（F6）：标题/说明 + 「当前组」控件 + 编辑/保存/取消/识别/展开按钮。
 *
 * 不新增 Tabs（现有简历资料/网申资料两层保持）；「管理组」与当前组下拉由
 * ProfileGroupControl 提供（经 groupControl 插槽注入，页头本身不读接口）。
 */
import {
  CloseOutlined,
  DownOutlined,
  EditOutlined,
  FileSearchOutlined,
  QuestionCircleOutlined,
  SaveOutlined,
  UpOutlined,
} from "@ant-design/icons";
import { Button, Typography } from "antd";
import type { ReactNode } from "react";
import { t } from "../../i18n";
import type { ProfileWorkspaceKey } from "./ProfileWorkspaceTabs";

interface Props {
  editing: boolean;
  activeWorkspace: ProfileWorkspaceKey;
  saving: boolean;
  extraSaving: boolean;
  photoReading: boolean;
  profileTextParsing: boolean;
  allExpanded: boolean;
  /** 当前组控件（资料页注入；页头不依赖组接口）。 */
  groupControl?: ReactNode;
  onOpenProfileTextModal: () => void;
  onOpenWebFormParse: () => void;
  onCancelEditing: () => void;
  onSubmitAll: () => Promise<void>;
  onToggleExpandAll: () => void;
  onStartEditing: () => void;
  onOpenGuide: () => void;
}

export default function ProfilePageHeader({
  editing,
  activeWorkspace,
  saving,
  extraSaving,
  photoReading,
  profileTextParsing,
  allExpanded,
  groupControl,
  onOpenProfileTextModal,
  onOpenWebFormParse,
  onCancelEditing,
  onSubmitAll,
  onToggleExpandAll,
  onStartEditing,
  onOpenGuide,
}: Props) {
  return (
    <div className="profile-page-header">
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t("profileLibrary.page.title")}
        </Typography.Title>
        <Typography.Text type="secondary">{t("profileLibrary.page.subtitle")}</Typography.Text>
        <div className="profile-page-header-group">{groupControl}</div>
      </div>
      <div className="profile-page-header-actions">
        <Button icon={<QuestionCircleOutlined />} disabled={saving} onClick={onOpenGuide}>
          {t("profileLibrary.action.guide")}
        </Button>
        {editing ? (
          <>
            <Button
              icon={<FileSearchOutlined />}
              disabled={saving || photoReading || profileTextParsing}
              onClick={activeWorkspace === "resume" ? onOpenProfileTextModal : onOpenWebFormParse}
            >
              {t("profileLibrary.action.recognize")}
            </Button>
            <Button
              icon={<CloseOutlined />}
              disabled={saving || photoReading}
              onClick={onCancelEditing}
            >
              {t("profileLibrary.action.cancel")}
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving || extraSaving}
              disabled={photoReading}
              onClick={() => void onSubmitAll()}
            >
              {t("profileLibrary.action.save")}
            </Button>
          </>
        ) : (
          <>
            {activeWorkspace === "resume" ? (
              <Button
                icon={allExpanded ? <UpOutlined /> : <DownOutlined />}
                onClick={onToggleExpandAll}
              >
                {allExpanded
                  ? t("profileLibrary.action.collapseAll")
                  : t("profileLibrary.action.expandAll")}
              </Button>
            ) : null}
            <Button icon={<EditOutlined />} onClick={onStartEditing}>
              {t("profileLibrary.action.edit")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
