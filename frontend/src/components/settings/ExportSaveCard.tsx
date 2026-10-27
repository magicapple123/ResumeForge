// SPDX-License-Identifier: Apache-2.0
/**
 * 生成内容保存位置卡（设置页 · 数据）。
 *
 * **只支持点选**：后端在用户本机弹原生「选择文件夹」对话框拿真实绝对路径——
 * 浏览器拿不到完整路径，手动输入路径容易写错盘符/拼写，所以这版刻意不提供
 * 手动输入。默认留空 = 仅浏览器下载（与历史版本零差异）；选定后从本机前端导出简历时
 * 后端会在返回下载的同时把同一份产物落盘一份到那里。打印路径不受影响。
 *
 * 卡片自带取数与保存（与 ReminderPopupCard / WebFormRelaxedModeCard 一致），不走
 * 「编辑设置」的全局编辑态。
 */

import { FolderOpenOutlined } from "@ant-design/icons";
import { App, Button, Card, Space, Typography } from "antd";
import LoadingBlock from "../common/LoadingBlock";
import { useEffect, useState } from "react";
import {
  clearExportSaveLocation,
  getExportSaveLocation,
  pickExportSaveFolder,
} from "../../api/settings";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export default function ExportSaveCard() {
  useLocale();
  const { message } = App.useApp();
  const [path, setPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);

  // Compiler 规范：挂载加载用内联 async IIFE（setState 在自身回调里应用）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const saved = await getExportSaveLocation();
        if (!cancelled) setPath(saved.path);
      } catch (err) {
        if (!cancelled) {
          message.error(err instanceof Error ? err.message : t("settingsUi.exportSave.loadFailed"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [message]);

  const clear = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const saved = await clearExportSaveLocation();
      setPath(saved.path);
      message.success(t("settingsUi.exportSave.resetDone"));
    } catch (err) {
      // 清除失败时保留后端给出的可读原因。
      message.error(err instanceof Error ? err.message : t("settingsUi.exportSave.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  // 点选文件夹：后端在用户本机弹原生对话框拿真实绝对路径，选完自动保存
  // 并由后端校验、持久化；客户端不提交文件系统路径。
  const browse = async () => {
    if (picking) return;
    setPicking(true);
    try {
      const picked = await pickExportSaveFolder();
      if (picked.path === null) {
        message.info(t("settingsUi.exportSave.cancelled"));
        return;
      }
      setPath(picked.path);
      message.success(t("settingsUi.exportSave.picked", { path: picked.path }));
    } catch (err) {
      // 503：本机环境弹不出原生对话框（如运行时缺 tkinter），提示重试。
      message.warning(err instanceof Error ? err.message : t("settingsUi.exportSave.pickerFailed"));
    } finally {
      setPicking(false);
    }
  };

  return (
    <Card title={t("settingsUi.exportSave.title")} className="settings-card">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t("settingsUi.exportSave.intro")}
      </Typography.Paragraph>
      <LoadingBlock spinning={loading}>
        <Space wrap>
          <Button
            type="primary"
            icon={<FolderOpenOutlined />}
            disabled={loading || saving}
            loading={picking}
            onClick={() => void browse()}
          >
            {t("settingsUi.exportSave.browse")}
          </Button>
          <Button
            disabled={loading || saving || picking || !path}
            onClick={() => {
              void clear();
            }}
          >
            {t("settingsUi.exportSave.reset")}
          </Button>
        </Space>
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
          {t("settingsUi.exportSave.current", {
            path: path || t("settingsUi.exportSave.defaultPath"),
          })}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 4 }}>
          {t("settingsUi.exportSave.footnote")}
        </Typography.Text>
      </LoadingBlock>
    </Card>
  );
}
