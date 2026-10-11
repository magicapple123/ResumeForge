/** 设置页里的「帮助与诊断」卡片：一键导出脱敏诊断包 + 反馈渠道入口。

导出前会先拉一次预览摘要（RF-20）：把包里的条数、时间范围与文件体积展示在
按钮旁，让用户导出前就知道里面有什么、没有什么（不含简历内容）。 */

import { App, Button, Card, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import { exportDiagnostics, getDiagnosticsPreview } from "../../api/system";
import type { DiagnosticsPreview } from "../../api/system";
import { downloadBlob } from "../../utils/download";

export const USER_GROUP_ID = "922830167";

/** 把字节量渲染成人类可读的大小（预览摘要用，KB 粒度足够）。 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function HelpDiagnosticsCard() {
  const { message } = App.useApp();
  const [exporting, setExporting] = useState(false);
  const [preview, setPreview] = useState<DiagnosticsPreview | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 预览是导出的补充说明，失败静默降级：摘要不出现，导出按钮照常可用。
    void getDiagnosticsPreview()
      .then((value) => {
        if (!cancelled) setPreview(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
        {preview !== null && (
          <Typography.Text type="secondary" data-testid="diagnostics-preview-summary">
            {`包内约 ${preview.event_count} 条脱敏事件`}
            {preview.files.length > 0
              ? `（${preview.files.map((file) => `${file.name} ${formatBytes(file.bytes)}`).join("、")}）`
              : ""}
            ，{preview.note}
          </Typography.Text>
        )}
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
