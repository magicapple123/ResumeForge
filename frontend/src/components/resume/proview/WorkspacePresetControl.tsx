// SPDX-License-Identifier: Apache-2.0
/**
 * 工作区预设切换（D14）：全部面板 / 内容撰写 / 精细排版 / 投递检查 + 恢复默认。
 *
 * 状态与面板显隐都由 shell 持有（只有它能决定三栏渲染），这里只把"选了哪个"回传。
 * 恢复默认是**独立按钮**而不是预设列表里的一项：它要能随时把用户的临时布局拉回来。
 */
import { ReloadOutlined } from "@ant-design/icons";
import { App, Button, Segmented, Space, Tooltip } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { WORKSPACE_PRESET_IDS } from "../../../features/resume-proview/workspacePresets";
import {
  WORKSPACE_PRESET_LABEL_KEY,
  type WorkspacePresetId,
} from "../../../features/resume-proview/types";

interface Props {
  value: WorkspacePresetId;
  onChange: (next: WorkspacePresetId) => void;
  onReset: () => void;
}

export default function WorkspacePresetControl({ value, onChange, onReset }: Props) {
  useLocale();
  const { message } = App.useApp();
  // 选项标签必须是**纯文本**：外层 Tooltip 已经把「只切换面板可见性…」解释了一遍，
  // 再给每个选项套一层同样的 Tooltip 会在悬停时同时弹出两个（2026-10-25 用户截图：
  // 两句话叠在一起）。一个触发区只留一个提示。
  const options = WORKSPACE_PRESET_IDS.map((id) => ({
    value: id,
    label: t(WORKSPACE_PRESET_LABEL_KEY[id]),
  }));
  return (
    <Space size={4}>
      <Tooltip
        title={
          <>
            <div>{t("proview.workspace.hint")}</div>
            <div>{t("proview.workspace.persistHint")}</div>
          </>
        }
      >
        <Segmented
          size="small"
          aria-label={t("proview.workspace.label")}
          value={value}
          options={options}
          onChange={(next) => {
            const preset = next as WorkspacePresetId;
            onChange(preset);
            message.success(
              t("proview.workspace.switched", { name: t(WORKSPACE_PRESET_LABEL_KEY[preset]) }),
            );
          }}
        />
      </Tooltip>
      <Tooltip title={t("proview.workspace.reset")}>
        <Button
          size="small"
          type="text"
          icon={<ReloadOutlined />}
          aria-label={t("proview.workspace.reset")}
          onClick={() => {
            onReset();
            message.success(t("proview.workspace.resetToast"));
          }}
        />
      </Tooltip>
    </Space>
  );
}
