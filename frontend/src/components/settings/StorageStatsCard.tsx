/**
 * 存储占用卡（RF-25）：数据目录各分项的磁盘占用与文件数。
 *
 * 数字来自 GET /api/stats/storage，后端只 stat 不读内容；这里不做任何清理动作，
 * 清理入口（手动备份）在旁边的「手动备份」卡里，逐份确认。
 */
import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, List, Progress, Space, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { getStorageStats } from "../../api/storage";
import type { StorageStats } from "../../api/storage";
import LoadingBlock from "../common/LoadingBlock";

function formatSize(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** 体积占比条的颜色：纯视觉分级，不是告警——占用大不等于有问题。 */
function percentColor(percent: number): string {
  if (percent >= 50) return "#faad14";
  return "#1677ff";
}

export default function StorageStatsCard() {
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setStats(await getStorageStats());
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取存储占用失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // Compiler 规范：初始加载的 setState 放 .then 回调（外部数据到达时应用）。
  useEffect(() => {
    let cancelled = false;
    getStorageStats()
      .then((data) => {
        if (cancelled) return;
        setStats(data);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "读取存储占用失败");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const top = stats ? [...stats.items].sort((a, b) => b.size_bytes - a.size_bytes).slice(0, 6) : [];
  const maxSize = top.length > 0 ? Math.max(...top.map((item) => item.size_bytes), 1) : 1;

  return (
    <Card
      title="存储占用"
      className="settings-card"
      extra={
        <Button
          size="small"
          type="text"
          icon={<ReloadOutlined />}
          onClick={() => void load()}
          aria-label="刷新存储占用"
        />
      }
    >
      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <Alert type="error" showIcon title={error} />
      ) : stats ? (
        <Space direction="vertical" style={{ width: "100%" }} size={8}>
          <Typography.Text type="secondary">
            数据目录共占用 {formatSize(stats.total_bytes)}（{stats.total_file_count} 个文件）。
            这里只显示体积，不会读取或改动任何文件内容；占用大的目录（如投递浏览器的用户目录）
            属于正常现象。
          </Typography.Text>
          <List
            size="small"
            dataSource={top.filter((item) => item.size_bytes > 0)}
            locale={{ emptyText: "还没有产生本地文件" }}
            renderItem={(item) => (
              <List.Item>
                <div style={{ width: "100%" }}>
                  <Space style={{ width: "100%", justifyContent: "space-between" }}>
                    <Typography.Text>{item.label}</Typography.Text>
                    <Typography.Text type="secondary">
                      {formatSize(item.size_bytes)}
                    </Typography.Text>
                  </Space>
                  <Progress
                    percent={Math.max(1, Math.round((item.size_bytes / maxSize) * 100))}
                    showInfo={false}
                    strokeColor={percentColor((item.size_bytes / maxSize) * 100)}
                    size="small"
                  />
                </div>
              </List.Item>
            )}
          />
        </Space>
      ) : null}
    </Card>
  );
}
