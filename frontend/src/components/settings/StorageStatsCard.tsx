// SPDX-License-Identifier: Apache-2.0
/**
 * 存储占用卡（RF-25）：数据目录各分项的磁盘占用与文件数。
 *
 * 数字来自 GET /api/stats/storage，后端只 stat 不读内容。
 * 「清理旧文件」（R19）：清单先给用户看、按类别分组勾选（默认全选）、执行后只把文件
 * 移到数据目录下的回收目录（按时间分文件夹），**永不硬删**。
 *
 * 一条固定事实写在弹窗里：最近 3 份备份不会出现在清单里——它们是"出事了能回滚"的那
 * 几条，保留策略在后端（`services/cleanup.py:KEEP_RECENT_BACKUPS`），这里如实告知。
 */
import { DeleteOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Listy,
  Modal,
  Progress,
  Space,
  Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  getStorageStats,
  previewCleanup,
  runCleanup,
  type CleanupCategoryKey,
  type CleanupPlan,
  type StorageStats,
} from "../../api/storage";
import LoadingBlock from "../common/LoadingBlock";
import { ListyItem } from "../common/ListyItem";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/** 与后端默认保留期一致：界面上固定展示的就是这一档。 */
const CLEANUP_DAYS = 30;
/**
 * 固定提示语的**词表 key**。
 *
 * 保留策略在后端，文案跟着它走（改了常量也要改那句）。模块作用域里不能调 `t()`
 * ——那会把语言固定在模块求值那一刻（交接单 §8.1），所以这里只存 key，用它的两处
 * 都 `t(...)`。
 */
const RECENT_BACKUPS_HINT_KEY: MessageKey = "storageStats.recentBackupsHint";
/** 清单里最多列多少个文件：更多时只说个数，确认后一并移走。 */
const CANDIDATE_PREVIEW_LIMIT = 20;

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
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  const { message, modal } = App.useApp();
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // 清理（R19）：先看清单再动手，且只移到回收目录——这里不做任何"彻底删除"。
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupPlan, setCleanupPlan] = useState<CleanupPlan | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<CleanupCategoryKey[]>([]);
  const [cleanupRunning, setCleanupRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setStats(await getStorageStats());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("storageStats.loadFailed"));
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
        setError(err instanceof Error ? err.message : t("storageStats.loadFailed"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 打开清理预览：没有候选时说一句就收工，不弹一个空清单。 */
  const openCleanup = async () => {
    try {
      // 不传 categories = 全部类别：弹窗里再按类别勾选。
      const plan = await previewCleanup(CLEANUP_DAYS);
      if (plan.totals.files === 0) {
        message.success(t("storageStats.cleanup.nothing", { days: CLEANUP_DAYS }));
        return;
      }
      setSelectedCategories(plan.categories.map((item) => item.key));
      setCleanupPlan(plan);
      setCleanupOpen(true);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("storageStats.cleanup.planFailed"));
    }
  };

  /**
   * 勾选变化：立刻重新预览。
   *
   * 刻意不让前端自己算数量——"预览 = 执行"的保证在后端同一份 plan 上，前端重算一遍
   * 就等于把这条保证降级成"两处代码碰巧算得一样"。
   */
  const applyCategories = async (next: CleanupCategoryKey[]) => {
    setSelectedCategories(next);
    try {
      setCleanupPlan(await previewCleanup(CLEANUP_DAYS, next));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("storageStats.cleanup.planFailed"));
    }
  };

  const confirmCleanup = async () => {
    if (cleanupRunning) return;
    setCleanupRunning(true);
    try {
      const result = await runCleanup(CLEANUP_DAYS, selectedCategories);
      setCleanupOpen(false);
      const failed = result.failed.length;
      modal.success({
        title: t("storageStats.cleanup.done.title", { count: result.moved }),
        content: (
          <Space orientation="vertical" size={4} style={{ width: "100%" }}>
            <span>
              {t("storageStats.cleanup.done.freed", { size: formatSize(result.freed_bytes) })}
            </span>
            <span>
              {t("storageStats.cleanup.done.kept", {
                hint: t(RECENT_BACKUPS_HINT_KEY),
                count: result.skipped.length,
              })}
            </span>
            {/* 条件片段单独一条 key：只在有文件被占用时出现，句式与上面两句无关。 */}
            {failed > 0 ? (
              <span>{t("storageStats.cleanup.done.busy", { count: failed })}</span>
            ) : null}
          </Space>
        ),
      });
      void load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("storageStats.cleanup.failed"));
    } finally {
      setCleanupRunning(false);
    }
  };

  const top = stats ? [...stats.items].sort((a, b) => b.size_bytes - a.size_bytes).slice(0, 6) : [];
  const maxSize = top.length > 0 ? Math.max(...top.map((item) => item.size_bytes), 1) : 1;
  const listedCandidates = cleanupPlan?.candidates ?? [];

  return (
    <Card
      title={t("storageStats.title")}
      className="settings-card"
      extra={
        <Space size={4}>
          {/* 清理旧文件（R19）：移到数据目录下的回收目录，不彻底删除；清单先给用户看。 */}
          <Button size="small" icon={<DeleteOutlined />} onClick={() => void openCleanup()}>
            {t("storageStats.cleanup.action")}
          </Button>
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined />}
            onClick={() => void load()}
            aria-label={t("storageStats.refresh.aria")}
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
            {t("storageStats.summary", {
              size: formatSize(stats.total_bytes),
              count: stats.total_file_count,
            })}
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
            <Typography.Text type="secondary">{t("storageStats.empty")}</Typography.Text>
          )}
        </Space>
      ) : null}

      <Modal
        title={t("storageStats.cleanup.title")}
        open={cleanupOpen}
        okText={
          cleanupPlan
            ? t("storageStats.cleanup.okCount", { count: cleanupPlan.totals.files })
            : t("storageStats.cleanup.ok")
        }
        cancelText={t("common.action.cancel")}
        confirmLoading={cleanupRunning}
        okButtonProps={{ disabled: (cleanupPlan?.totals.files ?? 0) === 0 }}
        onOk={() => void confirmCleanup()}
        onCancel={() => setCleanupOpen(false)}
        // 清单可能有 30+ 个文件：body 用统一上限自己滚动（--rf-modal-body-max-h），
        // 候选清单再在里面单独限高——这样头部说明与底部按钮都不随滚动跑掉。
        // 只加高度与溢出，不改 body 的 padding（浅色视觉必须零变化）。
        styles={{
          body: {
            maxHeight: "var(--rf-modal-body-max-h)",
            overflowY: "auto",
          },
        }}
        width="min(560px, 92vw)"
      >
        {cleanupPlan ? (
          <Space orientation="vertical" size={8} style={{ width: "100%" }}>
            <Alert
              type="info"
              showIcon
              title={t("storageStats.cleanup.plan.title", {
                days: cleanupPlan.older_than_days,
                size: formatSize(cleanupPlan.totals.bytes),
                count: cleanupPlan.totals.files,
              })}
              description={t("storageStats.cleanup.plan.description")}
            />
            <Typography.Text type="secondary">
              {t("storageStats.cleanup.plan.kept", {
                hint: t(RECENT_BACKUPS_HINT_KEY),
                count: cleanupPlan.skipped.length,
              })}
            </Typography.Text>
            {/* 按类别分组勾选：名称 / 文件数 / 体积都在同一行，默认全选。 */}
            <Checkbox.Group
              value={selectedCategories}
              onChange={(values) =>
                void applyCategories(values.map(String) as CleanupCategoryKey[])
              }
              style={{ width: "100%" }}
            >
              <Space orientation="vertical" size={4} style={{ width: "100%" }}>
                {cleanupPlan.categories.map((category) => {
                  const stat = cleanupPlan.by_category[category.key];
                  return (
                    <Checkbox key={category.key} value={category.key}>
                      <span>{category.label}</span>
                      <Typography.Text type="secondary">
                        {` ${t("storageStats.category.files", {
                          files: stat?.files ?? 0,
                          size: formatSize(stat?.bytes ?? 0),
                        })}`}
                      </Typography.Text>
                    </Checkbox>
                  );
                })}
              </Space>
            </Checkbox.Group>
            <div className="cleanup-candidate-list">
              <Listy
                items={listedCandidates.slice(0, CANDIDATE_PREVIEW_LIMIT)}
                rowKey={(item) => item.path}
                itemRender={(item) => (
                  <ListyItem>
                    <Space style={{ width: "100%", justifyContent: "space-between" }}>
                      <Typography.Text ellipsis title={item.path} style={{ maxWidth: 340 }}>
                        {item.label}·{item.path}
                      </Typography.Text>
                      <Typography.Text type="secondary">{formatSize(item.size)}</Typography.Text>
                    </Space>
                  </ListyItem>
                )}
              />
              {listedCandidates.length > CANDIDATE_PREVIEW_LIMIT ? (
                <Typography.Text type="secondary">
                  {t("storageStats.cleanup.more", {
                    count: listedCandidates.length - CANDIDATE_PREVIEW_LIMIT,
                  })}
                </Typography.Text>
              ) : null}
            </div>
          </Space>
        ) : null}
      </Modal>
    </Card>
  );
}
