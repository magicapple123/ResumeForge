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
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import {
  cancelRiskScan,
  markRiskPanelAttached,
  startRiskScan,
  useRiskScan,
} from "../features/resume/riskScanStore";
import type { RiskCategory, RiskPoint, RiskSeverity } from "../types/resumeRisk";

const CATEGORY_ORDER: {
  key: RiskCategory;
  label: string;
  color: string;
  description: string;
}[] = [
  { key: "duplicate", label: "查重", color: "default", description: "同一要点在简历里重复出现" },
  {
    key: "sensitive",
    label: "敏感词",
    color: "red",
    description: "身份证号 / 银行卡号 / 精确生日 / 住址 / 薪资",
  },
  {
    key: "exaggeration",
    label: "夸大",
    color: "orange",
    description: "「精通」「全球第一」这类绝对化表述与 ≥100% 的量化",
  },
  {
    key: "deep_dive",
    label: "深挖风险点",
    color: "volcano",
    description: "面试官会追问的强主张（联动事实台账给出准备方向）",
  },
  {
    key: "compliance",
    label: "合规校验",
    color: "magenta",
    description: "保密 / 未公开 / 涉密等 NDA 相关表述",
  },
];

const SEVERITY: Record<RiskSeverity, { label: string; color: string }> = {
  high: { label: "高", color: "red" },
  medium: { label: "中", color: "orange" },
  low: { label: "低", color: "blue" },
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
          扫描于 {formatClock(state.finishedAt)}
          {duration ? ` · 用时 ${duration}` : ""} · {data.llm_used ? "含模型增强" : "不含模型增强"}
        </Typography.Text>

        {changed && (
          <Alert
            type="warning"
            showIcon
            title="简历内容已修改，建议重新扫描"
            action={
              <Button size="small" onClick={beginScan}>
                重新扫描
              </Button>
            }
          />
        )}

        <Space wrap>
          <Typography.Text strong>共 {total} 条风险点</Typography.Text>
          {CATEGORY_ORDER.map((item) => {
            const count = data.summary?.[item.key] ?? 0;
            if (!count) return null;
            return (
              <Tag key={item.key} color={item.color}>
                {item.label} {count}
              </Tag>
            );
          })}
          {data.llm_used && <Tag color="geekblue">含模型增强</Tag>}
          <Button size="small" icon={<ReloadOutlined />} onClick={beginScan}>
            重新扫描
          </Button>
          {data.remote_enhancement_available && (
            <EnhanceToggle checked={enhance} onChange={changeEnhance} />
          )}
        </Space>

        {data.notes?.map((note) => (
          <Alert key={note} type="warning" showIcon title={note} />
        ))}

        {total === 0 ? (
          <Empty description="未发现明显风险点" />
        ) : (
          grouped.map((group) =>
            group.points.length === 0 ? null : (
              <Card
                key={group.key}
                size="small"
                title={
                  <Space>
                    <Typography.Text strong>{group.label}</Typography.Text>
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
            title="风险扫描失败"
            description={error}
            action={
              <Button size="small" onClick={onStart}>
                重试
              </Button>
            }
          />
        )}
        <Typography.Paragraph style={{ margin: 0 }}>
          扫描只做检查与提示，<Typography.Text strong>不会改写任何正文</Typography.Text>
          ——发现的问题要不要改、怎么改都由你决定。
        </Typography.Paragraph>
        <List
          size="small"
          dataSource={CATEGORY_ORDER}
          renderItem={(item) => (
            <List.Item style={{ paddingBlock: 4 }}>
              <Space size="small" align="start">
                <Tag color={item.color}>{item.label}</Tag>
                <Typography.Text type="secondary">{item.description}</Typography.Text>
              </Space>
            </List.Item>
          )}
        />
        <Space wrap size="small">
          <EnhanceToggle checked={enhance} onChange={onChangeEnhance} />
          <Typography.Text type="secondary">
            {enhance
              ? "开启后会把遮罩后的简历发给本机配置的模型复核（姓名/电话/邮箱/公司等已遮蔽），台账只发结构信息。"
              : "已关闭：只用本地规则，不会向模型发送任何内容。"}
          </Typography.Text>
        </Space>
        <Typography.Text type="secondary">
          预计耗时：本地规则通常 1–3 秒；开启 AI 增强一般十几秒，最长 45 秒后自动降级为本地结果。
          扫描期间可以关掉这个窗口，扫描会在后台继续，完成后会提醒你。
        </Typography.Text>
        <div>
          <Button type="primary" onClick={onStart}>
            {error ? "重新扫描" : "开始扫描"}
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
      <Spin />
      <Typography.Text>正在扫描…已用时 {elapsed}s</Typography.Text>
      <Typography.Text type="secondary">可以关闭此窗口，扫描会继续</Typography.Text>
      <Button onClick={onCancel}>取消</Button>
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
    <Tooltip
      title={
        checked
          ? "开启时会把你已配置的模型拿来复核简历——只发送遮罩后的正文（姓名/电话/邮箱/公司等已遮蔽），台账只发条数与承担程度这类结构信息，不发送条目原文。关掉后只用本地规则，完全不联网。"
          : "已关闭：只用本地规则，不会向模型发送任何内容。"
      }
    >
      <Space size={4}>
        <Switch size="small" checked={checked} onChange={onChange} aria-label="AI 增强" />
        <Typography.Text type="secondary">AI 增强</Typography.Text>
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
        <Tag color={severity.color}>{severity.label}</Tag>
        {point.location && <Typography.Text type="secondary">{point.location}</Typography.Text>}
        {point.claim_id != null && <Tag>事实台账 #{point.claim_id}</Tag>}
      </Space>
      {point.text && (
        <Typography.Paragraph style={{ margin: "8px 0 4px" }} code>
          {point.text}
        </Typography.Paragraph>
      )}
      {point.suggestion && (
        <Typography.Paragraph style={{ margin: "4px 0" }}>
          <Typography.Text type="success">建议：</Typography.Text>
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
              label: `追问准备（${point.follow_up.length}）`,
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
