// SPDX-License-Identifier: Apache-2.0
/**
 * #15C 岗位体检小卡片（抽屉形态，不新增页面）。
 *
 * 回答三个「投之前想问、但现有界面都不答」的问题：
 * 1. **薪资偏离** —— 这个岗位相对同城同族中位是高还是低；
 * 2. **同司多投** —— 这家公司我已经投过几条、队列里还排着几条；
 * 3. **历史结果** —— 这个岗位以前投过几次、各自什么结局。
 *
 * 两条硬约束：
 * - **样本不足就只说样本不足**：`status="insufficient"` 时显示「样本不足（N 条）」，
 *   **不显示任何百分比**。把不足的样本算成一个数，用户会把它当结论。
 * - **失败不阻塞队列**：接口挂了只在本卡片里显示错误态，队列照常可以投递
 *   （体检是额外信息，不是准入门槛）。
 */
import { Alert, Drawer, Space, Typography } from "antd";
import LoadingBlock from "../../../components/common/LoadingBlock";
import { useApi } from "../../../hooks/useApi";
import { inspectQueueItem } from "../../../api/applyInsights";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { ApplyInspectHistory, ApplyInspectSalary, ApplyJobInspect } from "../../../types";

interface Props {
  /** 要体检的**队列条目 id**；`null` 表示抽屉关闭。 */
  queueId: number | null;
  /** 岗位标题（只用于抽屉标题，缺失时给「该岗位」）。 */
  jobTitle?: string;
  onClose: () => void;
}

/** 薪资偏离一句话：`ok` 给「中位 / 本岗 / 高 20%」，其余一律只说样本不足。 */
function salaryLine(salary: ApplyInspectSalary): string {
  if (salary.status !== "ok" || salary.median === null || salary.target === null) {
    return t("applyQueue.insights.inspect.salary.insufficient", { sample: salary.sample });
  }
  const percent = Math.abs(Math.round(salary.delta_percent ?? 0));
  let delta = t("applyQueue.insights.inspect.salary.same");
  if (salary.direction === "high") {
    delta = t("applyQueue.insights.inspect.salary.high", { percent });
  } else if (salary.direction === "low") {
    delta = t("applyQueue.insights.inspect.salary.low", { percent });
  }
  return t("applyQueue.insights.inspect.salary.ok", {
    median: Math.round(salary.median),
    target: Math.round(salary.target),
    delta,
  });
}

/** 「同司多投」一句话：0 条时说清"没碰过"，比显示「0 / 0」有用。 */
function sameCompanyLine(same: ApplyJobInspect["same_company"]): string {
  if (same.count <= 0) return t("applyQueue.insights.inspect.sameCompany.none");
  return t("applyQueue.insights.inspect.sameCompany.line", {
    applied: same.applied,
    in_queue: same.in_queue,
    count: same.count,
  });
}

/**
 * 「历史结果」一句话：只列出**非零**的结局。
 *
 * 「投过 2 次：1 成功 / 0 失败 / 1 无回音」里那两个 0 是噪声——用户要看的是发生过什么。
 * 分隔符用常量斜杠，不占语言包（它没有词序问题）。
 */
function historyLine(history: ApplyInspectHistory): string {
  if (history.applied <= 0) return t("applyQueue.insights.inspect.history.none");
  const parts: string[] = [];
  if (history.succeeded > 0) {
    parts.push(t("applyQueue.insights.inspect.history.succeeded", { count: history.succeeded }));
  }
  if (history.failed > 0) {
    parts.push(t("applyQueue.insights.inspect.history.failed", { count: history.failed }));
  }
  if (history.no_reply > 0) {
    parts.push(t("applyQueue.insights.inspect.history.noReply", { count: history.no_reply }));
  }
  if (parts.length === 0) return t("applyQueue.insights.inspect.history.none");
  return t("applyQueue.insights.inspect.history.summary", {
    applied: history.applied,
    parts: parts.join(" / "),
  });
}

export default function ApplyJobInspectCard({ queueId, jobTitle, onClose }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后卡片停在旧文案。
  useLocale();
  const open = queueId !== null;
  // 关闭时不发请求（`enabled: open`）：抽屉关着还打后端只是白费一次往返。
  // 兜底拒绝里用语言包的文案：这条分支在 UI 上不可达（关着不会调用），但错误对象里的
  // 字符串同样属于"会给用户看的文案"，不能就地写死。
  const { data, loading, error } = useApi<ApplyJobInspect>(
    () => {
      if (queueId === null) {
        return Promise.reject(new Error(t("applyQueue.insights.inspect.error")));
      }
      return inspectQueueItem(queueId);
    },
    [queueId],
    { enabled: open },
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="right"
      size={420}
      destroyOnHidden
      title={t("applyQueue.insights.inspect.title", {
        job: jobTitle || t("applyQueue.insights.inspect.untitledJob"),
      })}
    >
      {loading ? (
        <LoadingBlock />
      ) : error ? (
        // 错误态就在卡片里：不给重试按钮也没有意义（体检是只读加分项），
        // 但要说清"队列与投递不受影响"，否则用户会以为这次投不成了。
        <Alert type="error" showIcon title={t("applyQueue.insights.inspect.error")} />
      ) : data ? (
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <section>
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              {t("applyQueue.insights.inspect.salary.label")}
            </Typography.Title>
            <Typography.Paragraph style={{ marginBottom: 4 }}>
              {salaryLine(data.salary)}
            </Typography.Paragraph>
            <Typography.Text type="secondary">
              {t("applyQueue.insights.inspect.salary.hint")}
            </Typography.Text>
          </section>
          <section>
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              {t("applyQueue.insights.inspect.sameCompany.label")}
            </Typography.Title>
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              {sameCompanyLine(data.same_company)}
            </Typography.Paragraph>
          </section>
          <section>
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              {t("applyQueue.insights.inspect.history.label")}
            </Typography.Title>
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              {historyLine(data.history)}
            </Typography.Paragraph>
          </section>
        </Space>
      ) : null}
    </Drawer>
  );
}
