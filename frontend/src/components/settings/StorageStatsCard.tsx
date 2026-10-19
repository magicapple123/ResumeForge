/**
 * 存储占用卡（RF-25）：数据目录各分项的磁盘占用与文件数。
 *
 * 数字来自 GET /api/stats/storage，后端只 stat 不读内容；这里不做任何清理动作，
 * 清理入口（手动备份）在旁边的「手动备份」卡里，逐份确认。
 */
import { DeleteOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Listy, Modal, Progress, Space, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  getStorageStats,
  previewCleanup,
  runCleanup,
  type CleanupPlan,
  type StorageStats,
} from "../../api/storage";
import LoadingBlock from "../common/LoadingBlock";
import { ListyItem } from "../common/ListyItem";

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
  const { message } = App.useApp();
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // 清理（R19）：先看清单再动手，且只移到回收目录——这里不做任何"永久删除"。
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupPlan, setCleanupPlan] = useState<CleanupPlan | null>(null);
  const [cleanupRunning, setCleanupRunning] = useState(false);

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

  /** 打开清理预览：没有候选时说一句就收工，不弹一个空清单。 */
  const openCleanup = async () => {
    try {
      const plan = await previewCleanup();
      if (plan.totals.files === 0) {
        message.success("没有超过 30 天的旧备份或日志，暂时不用清理");
        return;
      }
      setCleanupPlan(plan);
      setCleanupOpen(true);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "读取清理清单失败");
    }
  };

  const confirmCleanup = async () => {
    if (cleanupRunning) return;
    setCleanupRunning(true);
    try {
      const result = await runCleanup();
      setCleanupOpen(false);
      const failed = result.failed.length;
      message.success(
        `已把 ${result.moved} 个文件移到「${result.trash_dir || ".cleanup-trash"}」，` +
          `释放 ${formatSize(result.freed_bytes)}` +
          (failed > 0 ? `；另有 ${failed} 个文件被占用未能移动` : ""),
      );
      void load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "清理失败");
    } finally {
      setCleanupRunning(false);
    }
  };

  const top = stats ? [...stats.items].sort((a, b) => b.size_bytes - a.size_bytes).slice(0, 6) : [];
  const maxSize = top.length > 0 ? Math.max(...top.map((item) => item.size_bytes), 1) : 1;

  return (
    <Card
      title="存储占用"
      className="settings-card"
      extra={
        <Space size={4}>
          {/* 清理旧文件（R19）：移到 .cleanup-trash，不永久删除；清单先给用户看。 */}
          <Button size="small" icon={<DeleteOutlined />} onClick={() => void openCleanup()}>
            清理旧文件
          </Button>
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined />}
            onClick={() => void load()}
            aria-label="刷新存储占用"
          />
        </Space>
      }
    >
      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <Alert type="error" showIcon title={error} />
      ) : stats ? (
        <Space orientation="vertical" style={{ width: "100%" }} size={8}>
          <Typography.Text type="secondary">
            数据目录共占用 {formatSize(stats.total_bytes)}（{stats.total_file_count} 个文件）。
            这里只显示体积，不会读取或改动任何文件内容；占用大的目录（如投递浏览器的用户目录）
            属于正常现象。
          </Typography.Text>
          {top.some((item) => item.size_bytes > 0) ? (
            <Listy
              items={top.filter((item) => item.size_bytes > 0)}
              rowKey={(item) => item.key}
              itemRender={(item) => (
                <ListyItem>
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
                </ListyItem>
              )}
            />
          ) : (
            <Typography.Text type="secondary">还没有产生本地文件</Typography.Text>
          )}
        </Space>
      ) : null}

      <Modal
        title="清理旧文件"
        open={cleanupOpen}
        okText={cleanupPlan ? `移走 ${cleanupPlan.totals.files} 个文件` : "移走"}
        cancelText="取消"
        confirmLoading={cleanupRunning}
        onOk={() => void confirmCleanup()}
        onCancel={() => setCleanupOpen(false)}
        width="min(560px, 92vw)"
      >
        {cleanupPlan ? (
          <Space orientation="vertical" size={8} style={{ width: "100%" }}>
            <Alert
              type="info"
              showIcon
              title={`以下文件超过 ${cleanupPlan.older_than_days} 天没有变动，共 ${formatSize(
                cleanupPlan.totals.bytes,
              )}`}
              description="清理会把它们移到数据目录下的 .cleanup-trash/（按时间分文件夹），不会永久删除；确认无误后可自行在文件管理器里删除那个目录。"
            />
            <Listy
              items={cleanupPlan.candidates.slice(0, 20)}
              rowKey={(item) => item.path}
              itemRender={(item) => (
                <ListyItem>
                  <Space style={{ width: "100%", justifyContent: "space-between" }}>
                    <Typography.Text ellipsis title={item.path} style={{ maxWidth: 380 }}>
                      {item.path}
                    </Typography.Text>
                    <Typography.Text type="secondary">{formatSize(item.size)}</Typography.Text>
                  </Space>
                </ListyItem>
              )}
            />
            {cleanupPlan.candidates.length > 20 ? (
              <Typography.Text type="secondary">
                还有 {cleanupPlan.candidates.length - 20} 个文件未列出，确认后一并移走。
              </Typography.Text>
            ) : null}
          </Space>
        ) : null}
      </Modal>
    </Card>
  );
}
