/**
 * 生成内容保存位置卡（设置页 · 数据）。
 *
 * **只支持点选**：后端在用户本机弹原生「选择文件夹」对话框拿真实绝对路径——
 * 浏览器拿不到完整路径，手动输入路径容易写错盘符/拼写，所以这版刻意不提供
 * 手动输入。默认留空 = 仅浏览器下载（与历史版本零差异）；选定后导出简历时
 * 后端会在返回下载的同时把同一份产物落盘一份到那里。打印路径不受影响。
 *
 * 卡片自带取数与保存（与 ReminderPopupCard / WebFormRelaxedModeCard 一致），不走
 * 「编辑设置」的全局编辑态。
 */

import { FolderOpenOutlined } from "@ant-design/icons";
import { App, Button, Card, Space, Spin, Typography } from "antd";
import { useEffect, useState } from "react";
import {
  getExportSaveLocation,
  pickExportSaveFolder,
  putExportSaveLocation,
} from "../../api/settings";

export default function ExportSaveCard() {
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
          message.error(err instanceof Error ? err.message : "加载导出保存位置失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [message]);

  const save = async (next: string) => {
    if (saving) return;
    setSaving(true);
    try {
      const saved = await putExportSaveLocation(next.trim());
      setPath(saved.path);
      message.success(
        saved.path ? `已保存：导出内容将同时存到 ${saved.path}` : "已恢复默认：仅浏览器下载",
      );
    } catch (err) {
      // 后端校验失败（目录不存在 / 不是目录 / 不可写）时 detail 可直接展示。
      message.error(err instanceof Error ? err.message : "保存导出保存位置失败");
    } finally {
      setSaving(false);
    }
  };

  // 点选文件夹：后端在用户本机弹原生对话框拿真实绝对路径，选完自动保存
  // （保存时后端会做目录校验，非法目录的错误原因直接展示）。
  const browse = async () => {
    if (picking) return;
    setPicking(true);
    try {
      const picked = await pickExportSaveFolder();
      if (picked.path === null) {
        message.info("已取消选择");
        return;
      }
      setPath(picked.path);
      await save(picked.path);
    } catch (err) {
      // 503：本机环境弹不出原生对话框（如运行时缺 tkinter），提示重试。
      message.warning(err instanceof Error ? err.message : "无法打开文件夹选择器，请重试");
    } finally {
      setPicking(false);
    }
  };

  return (
    <Card title="生成内容保存位置" className="settings-card">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        默认保存到浏览器默认下载目录；选择文件夹后将同时保存一份到那里。
      </Typography.Paragraph>
      <Spin spinning={loading}>
        <Space wrap>
          <Button
            type="primary"
            icon={<FolderOpenOutlined />}
            loading={picking}
            onClick={() => void browse()}
          >
            选择文件夹
          </Button>
          <Button
            disabled={saving || !path}
            onClick={() => {
              setPath("");
              void save("");
            }}
          >
            恢复默认
          </Button>
        </Space>
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
          当前：{path || "默认（浏览器下载目录）"}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 4 }}>
          同名文件已存在时会自动加时间戳后缀，不会覆盖；落盘失败不影响正常下载。
        </Typography.Text>
      </Spin>
    </Card>
  );
}
