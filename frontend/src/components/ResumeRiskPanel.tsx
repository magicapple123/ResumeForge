// SPDX-License-Identifier: Apache-2.0
/** 简历风险扫描面板：查重 / 敏感词 / 夸大 / 深挖风险点 / 合规校验。
 *
 * 只展示后端算好的风险点与建议，**绝不自动改写正文**。五类风险按固定顺序分组渲染，
 * 深挖风险点若联动到事实台账，会展示「台账 #{claim_id}」标记。
 *
 * 状态机（R12）住在 `features/resume/riskScanStore`：**挂载不发请求**——用户先看到
 * 说明卡（查什么、发不发模型、大概多久），点「开始扫描」才发。这样预览页不再为一次
 * 打开就白跑一次模型调用，也让"关掉窗口继续扫"成为可能（面板卸载不影响模块级请求）。
 */
import { ReloadOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Empty,
  List,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import LoadingBlock from "./common/LoadingBlock";
import { useEffect, useMemo, useState } from "react";
import {
  cancelRiskScan,
  markRiskPanelAttached,
  startRiskScan,
  useRiskScan,
} from "../features/resume/riskScanStore";
import type { RiskCategory, RiskPoint, RiskSeverity } from "../types/resumeRisk";
import { t } from "../i18n";
import type { MessageKey } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

const CATEGORY_ORDER: {
  key: RiskCategory;
  labelKey: MessageKey;
  color: string;
  descriptionKey: MessageKey;
}[] = [
  {
    key: "duplicate",
    labelKey: "riskPanel.category.duplicate.label",
    color: "default",
    descriptionKey: "riskPanel.category.duplicate.description",
  },
  {
    key: "sensitive",
    labelKey: "riskPanel.category.sensitive.label",
    color: "red",
    descriptionKey: "riskPanel.category.sensitive.description",
  },
  {
    key: "exaggeration",
    labelKey: "riskPanel.category.exaggeration.label",
    color: "orange",
    descriptionKey: "riskPanel.category.exaggeration.description",
  },
  {
    key: "deep_dive",
    labelKey: "riskPanel.category.deepDive.label",
    color: "volcano",
    descriptionKey: "riskPanel.category.deepDive.description",
  },
  {
    key: "compliance",
    labelKey: "riskPanel.category.compliance.label",
    color: "magenta",
    descriptionKey: "riskPanel.category.compliance.description",
  },
];

const SEVERITY: Record<RiskSeverity, { labelKey: MessageKey; color: string }> = {
  high: { labelKey: "riskPanel.severity.high", color: "red" },
  medium: { labelKey: "riskPanel.severity.medium", color: "orange" },
  low: { labelKey: "riskPanel.severity.low", color: "blue" },
};

interface Props {
  resumeId: number;
  /** 当前简历内容的签名；与扫描时的签名不同就提示「建议重新扫描」。 */
  contentSignature?: string;
}

/** 「AI 增强」偏好的本地存储键：本机单用户工具，不引入服务端设置项。 */
const ENHANCE_STORAGE_KEY = "resumeRisk.remoteEnhancement";

/**
 * 时间格式：完成时刻用 `HH:mm`，耗时用一位小数的秒。
 *
 * 分开写是因为两者的"精度需求"不同：用户想知道"这是刚扫的还是十分钟前的"（分钟足够），
 * 以及"扫描花了多久"（秒级才有意义）。
 */
function formatClock(timestamp?: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

function formatDuration(startedAt?: number, finishedAt?: number): string {
  if (!startedAt || !finishedAt) return "";
  const seconds = Math.max(0, finishedAt - startedAt) / 1000;
  return `${seconds.toFixed(1)}s`;
}

function initialEnhancePreference(): boolean {
  try {
    return window.localStorage.getItem(ENHANCE_STORAGE_KEY) !== "off";
  } catch {
    // 隐私模式等读不到 storage：默认开，与历史行为一致。
    return true;
  }
}

export default function ResumeRiskPanel({ resumeId, contentSignature }: Props) {
  useLocale();
  const [enhance, setEnhance] = useState(initialEnhancePreference);
  const state = useRiskScan(resumeId);

  // 声明"面板正开着"：watcher 据此决定要不要弹全局通知（返回 detach 由 effect 清理）。
  useEffect(() => markRiskPanelAttached(resumeId), [resumeId]);

  const changeEnhance = (next: boolean) => {
    setEnhance(next);
    try {
      window.localStorage.setItem(ENHANCE_STORAGE_KEY, next ? "on" : "off");
    } catch {
      // 存不下就只在本次会话生效。
    }
  };

  const beginScan = () => startRiskScan(resumeId, { enhance, signature: contentSignature });

  const grouped = useMemo(() => {
    const map = new Map<RiskCategory, RiskPoint[]>();
    for (const point of state.result?.points ?? []) {
      const list = map.get(point.category) ?? [];
      list.push(point);
      map.set(point.category, list);
    }
    return CATEGORY_ORDER.map((item) => ({ ...item, points: map.get(item.key) ?? [] }));
  }, [state.result]);

  if (state.status === "scanning") {
    return <ScanningCard startedAt={state.startedAt} onCancel={() => cancelRiskScan(resumeId)} />;
  }

  if (state.status === "done" && state.result) {
    const data = state.result;
    const total = data.points.length;
    const duration = formatDuration(state.startedAt, state.finishedAt);
    const changed =
      Boolean(state.signature) && Boolean(contentSignature) && state.signature !== contentSignature;
    return (
      <Space orientation="vertical" style={{ width: "100%" }} size="middle">
        <Typography.Text type="secondary">
          {t("riskPanel.scanAt", { time: formatClock(state.finishedAt) })}
          {duration ? ` · ${t("riskPanel.scanDuration", { duration })}` : ""} ·{" "}
          {data.llm_used ? t("riskPanel.llmUsed") : t("riskPanel.llmOff")}
        </Typography.Text>

        {changed && (
          <Alert
            type="warning"
            showIcon
            title={t("riskPanel.stale.title")}
            action={
              <Button size="small" onClick={beginScan}>
                {t("riskPanel.action.rescan")}
              </Button>
            }
          />
        )}

        <Space wrap>
          <Typography.Text strong>{t("riskPanel.summary", { count: total })}</Typography.Text>
          {CATEGORY_ORDER.map((item) => {
            const count = data.summary?.[item.key] ?? 0;
            if (!count) return null;
            return (
              <Tag key={item.key} color={item.color}>
                {t(item.labelKey)} {count}
              </Tag>
            );
          })}
          {data.llm_used && <Tag color="geekblue">{t("riskPanel.llmUsed")}</Tag>}
          <Button size="small" icon={<ReloadOutlined />} onClick={beginScan}>
            {t("riskPanel.action.rescan")}
          </Button>
          {data.remote_enhancement_available && (
            <EnhanceToggle checked={enhance} onChange={changeEnhance} />
          )}
        </Space>

        {data.notes?.map((note) => (
          <Alert key={note} type="warning" showIcon title={note} />
        ))}

        {total === 0 ? (
          <Empty description={t("riskPanel.empty")} />
        ) : (
          grouped.map((group) =>
            group.points.length === 0 ? null : (
              <Card
                key={group.key}
                size="small"
                title={
                  <Space>
                    <Typography.Text strong>{t(group.labelKey)}</Typography.Text>
                    <Tag color={group.color}>{group.points.length}</Tag>
                  </Space>
                }
              >
                <Space orientation="vertical" style={{ width: "100%" }} size="small">
                  {group.points.map((point, index) => (
                    <RiskPointItem key={index} point={point} />
                  ))}
                </Space>
              </Card>
            ),
          )
        )}
      </Space>
    );
  }

  return (
    <IntroCard
      enhance={enhance}
      onChangeEnhance={changeEnhance}
      error={state.status === "error" ? state.error : undefined}
      onStart={beginScan}
    />
  );
}

/** 说明卡：查什么、AI 增强的隐私边界、预计耗时、开始扫描。 */
function IntroCard({
  enhance,
  onChangeEnhance,
  error,
  onStart,
}: {
  enhance: boolean;
  onChangeEnhance: (next: boolean) => void;
  error?: string;
  onStart: () => void;
}) {
  return (
    <Card size="small">
      <Space orientation="vertical" style={{ width: "100%" }} size="middle">
        {error && (
          <Alert
            type="error"
            showIcon
            title={t("riskPanel.error.title")}
            description={error}
            action={
              <Button size="small" onClick={onStart}>
                {t("riskPanel.action.retry")}
              </Button>
            }
          />
        )}
        <Typography.Paragraph style={{ margin: 0 }}>
          {t("riskPanel.intro.summary")}
        </Typography.Paragraph>
        <List
          size="small"
          dataSource={CATEGORY_ORDER}
          renderItem={(item) => (
            <List.Item style={{ paddingBlock: 4 }}>
              <Space size="small" align="start">
                <Tag color={item.color}>{t(item.labelKey)}</Tag>
                <Typography.Text type="secondary">{t(item.descriptionKey)}</Typography.Text>
              </Space>
            </List.Item>
          )}
        />
        <Space wrap size="small">
          <EnhanceToggle checked={enhance} onChange={onChangeEnhance} />
          <Typography.Text type="secondary">
            {enhance ? t("riskPanel.enhance.note.on") : t("riskPanel.enhance.note.off")}
          </Typography.Text>
        </Space>
        <Typography.Text type="secondary">
          {t("riskPanel.intro.estimatedTime")} {t("riskPanel.intro.background")}
        </Typography.Text>
        <div>
          <Button type="primary" onClick={onStart}>
            {error ? t("riskPanel.action.rescan") : t("riskPanel.action.start")}
          </Button>
        </div>
      </Space>
    </Card>
  );
}

/** 扫描中：已用时 + 「可以关掉窗口」+ 取消。 */
function ScanningCard({ startedAt, onCancel }: { startedAt?: number; onCancel: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;

  return (
    <Space orientation="vertical" style={{ width: "100%" }} size="middle" align="center">
      <LoadingBlock />
      <Typography.Text>{t("riskPanel.scanning.elapsed", { elapsed })}</Typography.Text>
      <Typography.Text type="secondary">{t("riskPanel.scanning.hint")}</Typography.Text>
      <Button onClick={onCancel}>{t("common.action.cancel")}</Button>
    </Space>
  );
}

/** AI 增强开关：隐私边界写在 tooltip 里，默认沿用本机偏好。 */
function EnhanceToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Tooltip title={checked ? t("riskPanel.enhance.tooltip.on") : t("riskPanel.enhance.note.off")}>
      <Space size={4}>
        <Switch
          size="small"
          checked={checked}
          onChange={onChange}
          aria-label={t("riskPanel.enhance.aria")}
        />
        <Typography.Text type="secondary">{t("riskPanel.enhance.label")}</Typography.Text>
      </Space>
    </Tooltip>
  );
}

function RiskPointItem({ point }: { point: RiskPoint }) {
  const severity = SEVERITY[point.severity] ?? SEVERITY.medium;
  return (
    <div
      style={{ borderTop: "1px solid var(--rf-border)", paddingTop: 8 }}
      data-risk-category={point.category}
    >
      <Space size="small" wrap>
        <Tag color={severity.color}>{t(severity.labelKey)}</Tag>
        {point.location && <Typography.Text type="secondary">{point.location}</Typography.Text>}
        {point.claim_id != null && <Tag>{t("riskPanel.claimTag", { id: point.claim_id })}</Tag>}
      </Space>
      {point.text && (
        <Typography.Paragraph style={{ margin: "8px 0 4px" }} code>
          {point.text}
        </Typography.Paragraph>
      )}
      {point.suggestion && (
        <Typography.Paragraph style={{ margin: "4px 0" }}>
          <Typography.Text type="success">{t("riskPanel.suggestion")}</Typography.Text>
          {point.suggestion}
        </Typography.Paragraph>
      )}
      {point.follow_up.length > 0 && (
        <Collapse
          size="small"
          ghost
          items={[
            {
              key: "follow-up",
              label: t("riskPanel.followUp", { count: point.follow_up.length }),
              children: (
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {point.follow_up.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
