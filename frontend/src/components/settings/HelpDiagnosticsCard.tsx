/** 设置页里的「帮助与诊断」卡片：一键导出脱敏诊断包 + 反馈渠道入口。 */

import { App, Button, Card, Space, Typography } from "antd";
import { useState } from "react";
import { exportDiagnostics } from "../../api/system";
import { downloadBlob } from "../../utils/download";

export const USER_GROUP_ID = "922830167";

export default function HelpDiagnosticsCard() {
  const { message } = App.useApp();
  const [exporting, setExporting] = useState(false);

  const runExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { blob, filename } = await exportDiagnostics();
      downloadBlob(blob, filename);
      message.success("诊断包已导出，里面没有简历数据与密钥");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "导出诊断包失败");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card title="帮助与诊断" className="settings-card">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        遇到问题可以先导出一份诊断包：里面只有脱敏的运行事件、系统信息和近期日志，
        <strong>不含简历数据与密钥</strong>。把它连同问题描述一起发出来，能省掉大半来回。
      </Typography.Paragraph>
      <Space orientation="vertical" size={12} style={{ display: "flex" }}>
        <Button type="primary" loading={exporting} onClick={() => void runExport()}>
          导出诊断包
        </Button>
        <Typography.Text type="secondary">
          反馈渠道：
          <Typography.Link
            href="https://github.com/magicapple123/ResumeForge/issues"
            target="_blank"
            rel="noreferrer"
          >
            GitHub Issues
          </Typography.Link>
          ，或加用户群
          <Typography.Text copyable style={{ margin: "0 4px" }}>
            {USER_GROUP_ID}
          </Typography.Text>
          （进群后可直接反馈）。
        </Typography.Text>
      </Space>
    </Card>
  );
}
