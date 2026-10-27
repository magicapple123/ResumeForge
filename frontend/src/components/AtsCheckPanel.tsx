// SPDX-License-Identifier: Apache-2.0
/** ATS 本地检测面板：格式风险 / 关键词覆盖 / 信息位置。
 *
 * 提供可选的 JD 文本输入，按 JD 抽出的关键词检查覆盖；不填 JD 时做通用关键词覆盖。
 * 结果带免责声明（本地规则估计，不代表真实 ATS 解析结果），必须展示给用户。
 *
 * R13 起结果不再只有一个笼统的总分：三个分项（格式/关键词/位置）+ 关键词覆盖率一起展示，
 * 每条问题都带「建议」，并可一键复制成改进清单——用户要的是"下一步改什么"，
 * 而不是"你得了 62 分"。
 */
import { CopyOutlined, DownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Empty, Input, Progress, Space, Tag, Typography } from "antd";
import LoadingBlock from "./common/LoadingBlock";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runAtsCheck } from "../api/ats";
import { getJob } from "../api/jobs";
import { MAX_JOB_TEXT_CHARS } from "../config";
import { useApi } from "../hooks/useApi";
import type { AtsIssue, AtsIssueCategory, AtsKeywordHit, AtsSeverity } from "../types/ats";
import { copyText } from "../utils/clipboard";
import { MaxLengthHint } from "./common/MaxLengthHint";
import { t } from "../i18n";
import type { MessageKey } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

const CATEGORY_ORDER: {
  key: AtsIssueCategory;
  labelKey: MessageKey;
  cardTitleKey: MessageKey;
  color: string;
}[] = [
  {
    key: "format",
    labelKey: "atsCheck.category.format.label",
    cardTitleKey: "atsCheck.category.format.cardTitle",
    color: "orange",
  },
  {
    key: "keyword",
    labelKey: "atsCheck.category.keyword.label",
    cardTitleKey: "atsCheck.category.keyword.cardTitle",
    color: "blue",
  },
  {
    key: "position",
    labelKey: "atsCheck.category.position.label",
    cardTitleKey: "atsCheck.category.position.cardTitle",
    color: "purple",
  },
];

const SEVERITY: Record<AtsSeverity, { labelKey: MessageKey; color: string }> = {
  high: { labelKey: "atsCheck.severity.high", color: "red" },
  medium: { labelKey: "atsCheck.severity.medium", color: "orange" },
  low: { labelKey: "atsCheck.severity.low", color: "blue" },
};

/** 严重程度的显示名；未知取值返回 undefined，由调用处决定怎么兜底。 */
function severityLabel(severity: AtsSeverity): string | undefined {
  const meta: { labelKey: MessageKey } | undefined = SEVERITY[severity];
  return meta ? t(meta.labelKey) : undefined;
}

interface Props {
  resumeId: number;
  /**
   * 关联岗位 id（由父组件传入）。为 undefined 时既没有自动载入、也没有「载入 JD」按钮——
   * 面板自己再去请求一次简历只为拿 id 不划算，拿不到还会多一次失败态。
   */
  jobId?: number;
}

/** 把 issues 拼成可粘贴的改进清单（标题 + 建议，按严重程度保序）。 */
function buildImprovementList(issues: AtsIssue[]): string {
  return issues
    .map((issue, index) => {
      const severity = severityLabel(issue.severity) ?? t("atsCheck.severity.medium");
      const head = t("atsCheck.improvement.head", {
        index: index + 1,
        severity,
        title: issue.title,
      });
      const suggestion = issue.suggestion?.trim();
      return suggestion
        ? `${head}\n   ${t("atsCheck.improvement.suggestion", { suggestion })}`
        : head;
    })
    .join("\n");
}

/** 关键词命中：有 hits 时按出现次数降序；没有时退回旧的 matched/missing 两个数组。 */
function keywordTags(result: {
  keyword_hits?: AtsKeywordHit[];
  matched_keywords: string[];
  missing_keywords: string[];
}): { matched: { word: string; count: number }[]; missing: string[] } {
  const hits = result.keyword_hits ?? [];
  if (hits.length > 0) {
    const matched = hits
      .filter((hit) => hit.matched)
      .map((hit) => ({ word: hit.keyword, count: hit.count }))
      .sort((left, right) => right.count - left.count);
    const missing = hits.filter((hit) => !hit.matched).map((hit) => hit.keyword);
    return { matched, missing };
  }
  return {
    matched: result.matched_keywords.map((word) => ({ word, count: 0 })),
    missing: result.missing_keywords,
  };
}

export default function AtsCheckPanel({ resumeId, jobId }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一屏停在旧文案。
  useLocale();
  const { message } = App.useApp();
  const [jdText, setJdText] = useState("");
  const [loadingJd, setLoadingJd] = useState(false);
  /** 自动载入的提示行：带上 jobId，换岗位后旧提示自然不再显示。 */
  const [jdNotice, setJdNotice] = useState<{ jobId: number; kind: "auto" | "failed" } | null>(null);
  /** 自动载入过的岗位 id：同一个岗位只自动填一次（用户手动清空后不再填回）。 */
  const autoLoadedJobId = useRef<number | null>(null);
  const jdTextRef = useRef("");
  const { data, loading, error, reload } = useApi(
    () => runAtsCheck(resumeId, jdTextRef.current),
    [resumeId],
  );

  const run = () => {
    jdTextRef.current = jdText;
    void reload();
  };

  /** 读取关联岗位并拼成 JD 文本（只取文本、不碰界面状态）；失败返回 null。 */
  const fetchJobJd = useCallback(async (targetJobId: number): Promise<string | null> => {
    try {
      const job = await getJob(targetJobId);
      const combined = [job.description, job.requirements]
        .map((part) => (part ?? "").trim())
        .filter(Boolean)
        .join("\n");
      // 硬上限与后端 AtsCheckRequest.jd_text 一致，超了就是 422，这里先裁掉。
      return combined.slice(0, MAX_JOB_TEXT_CHARS);
    } catch {
      return null;
    }
  }, []);

  /**
   * 自动填入关联岗位 JD：**只填不跑检测**。
   *
   * 三个前置条件缺一不可——有 jobId、输入框还是空的、这个岗位没自动载入过。第三条是
   * "用户手动清空后不要再填回来"的实现：用 ref 记 jobId，不需要额外 state 触发重跑。
   */
  useEffect(() => {
    if (jobId == null) return;
    if (autoLoadedJobId.current === jobId) return;
    if (jdText.trim() !== "") return;
    autoLoadedJobId.current = jobId;
    let cancelled = false;
    void fetchJobJd(jobId).then((text) => {
      if (cancelled) return;
      if (!text) {
        // 自动路径不弹阻塞错误：保留手动按钮，留一行次要提示就够了。
        setJdNotice({ jobId, kind: "failed" });
        return;
      }
      // 用户在请求期间开始打字时不能覆盖他：空串才写。
      setJdText((current) => (current.trim() === "" ? text : current));
      setJdNotice({ jobId, kind: "auto" });
    });
    return () => {
      cancelled = true;
    };
  }, [fetchJobJd, jdText, jobId]);

  /**
   * 用户改写 JD 时同步收掉「已自动载入…」提示：输入框已经被清空（或换成了自己粘贴的内容），
   * 再说"可直接开始检测"就与界面不一致了。
   *
   * 只清 `auto` 这一类：自动载入**失败**时输入框本来就是空的，那行提示必须留着告诉用户
   * 为什么框里没东西，所以失败态（`failed`）原样保留。
   *
   * 写在 onChange 里而不是 effect 里：这是"用户操作引起的状态变化"，用 effect 同步
   * setState 会触发级联渲染（`react-hooks/set-state-in-effect`），事件回调是 React 推荐写法。
   */
  const handleJdInput = (next: string) => {
    setJdText(next);
    if (next.trim() !== "") return;
    setJdNotice((current) => (current?.kind === "auto" ? null : current));
  };

  /** 手动载入/刷新：失败照旧弹出可操作的错误提示（自动路径才静默）。 */
  const handleLoadJd = async () => {
    if (jobId == null) return;
    setLoadingJd(true);
    const text = await fetchJobJd(jobId);
    setLoadingJd(false);
    if (text === null) {
      setJdNotice(null);
      message.error(t("atsCheck.jd.loadFailed"));
      return;
    }
    autoLoadedJobId.current = jobId;
    setJdText(text);
    setJdNotice(null);
  };

  /** 只显示当前 jobId 的提示：换岗位/换简历后旧提示不该继续挂着。 */
  const notice = jdNotice && jdNotice.jobId === jobId ? jdNotice.kind : null;

  const copyImprovements = async () => {
    if (!data || data.issues.length === 0) return;
    const ok = await copyText(buildImprovementList(data.issues));
    if (ok) message.success(t("atsCheck.improvement.copied"));
    else message.error(t("atsCheck.improvement.copyFailed"));
  };

  const grouped = useMemo(() => {
    const map = new Map<AtsIssueCategory, AtsIssue[]>();
    for (const issue of data?.issues ?? []) {
      const list = map.get(issue.category) ?? [];
      list.push(issue);
      map.set(issue.category, list);
    }
    return CATEGORY_ORDER.map((item) => ({ ...item, issues: map.get(item.key) ?? [] }));
  }, [data]);

  const keywords = useMemo(() => (data ? keywordTags(data) : { matched: [], missing: [] }), [data]);

  return (
    <Space orientation="vertical" style={{ width: "100%" }} size="middle">
      <Space orientation="vertical" style={{ width: "100%" }} size="small">
        <Space.Compact style={{ width: "100%" }}>
          <Input.TextArea
            rows={2}
            maxLength={MAX_JOB_TEXT_CHARS}
            value={jdText}
            placeholder={t("atsCheck.jd.placeholder")}
            aria-label={t("atsCheck.jd.label")}
            onChange={(event) => handleJdInput(event.target.value)}
          />
          <Button type="primary" loading={loading} onClick={run}>
            {t("atsCheck.action.run")}
          </Button>
        </Space.Compact>
        {jobId != null && (
          <Space wrap size="small">
            <Button
              size="small"
              icon={<DownloadOutlined />}
              loading={loadingJd}
              onClick={() => void handleLoadJd()}
            >
              {t("atsCheck.action.reloadJd")}
            </Button>
            {notice === "auto" && (
              <Typography.Text type="secondary">{t("atsCheck.jd.autoLoaded")}</Typography.Text>
            )}
            {notice === "failed" && (
              <Typography.Text type="secondary">{t("atsCheck.jd.autoFailed")}</Typography.Text>
            )}
          </Space>
        )}
      </Space>
      {/* 硬上限交给 maxLength；提示统一走 MaxLengthHint（全仓禁用 antd showCount）。 */}
      <MaxLengthHint value={jdText} maxLength={MAX_JOB_TEXT_CHARS} />

      {error && <Alert type="error" showIcon title={error} />}

      {data && !loading && (
        <>
          <Alert type="info" showIcon title={data.disclaimer} />
          <Space wrap align="center" size="large">
            <Space orientation="vertical" size={0} align="center">
              <Typography.Text strong>{t("atsCheck.score.label")}</Typography.Text>
              <Progress
                type="circle"
                size={64}
                percent={data.score}
                format={(value) => `${value ?? 0}`}
              />
            </Space>
            <Space orientation="vertical" size={4} style={{ minWidth: 180 }}>
              {CATEGORY_ORDER.map((item) => (
                <div key={item.key}>
                  <Typography.Text type="secondary">{t(item.labelKey)}</Typography.Text>
                  <Progress
                    percent={data.subscores?.[item.key] ?? 0}
                    size="small"
                    format={(value) => `${value ?? 0}`}
                  />
                </div>
              ))}
            </Space>
            {data.coverage_ratio != null && (
              <Tag color="geekblue">
                {t("atsCheck.coverage", { percent: Math.round(data.coverage_ratio * 100) })}
              </Tag>
            )}
            {CATEGORY_ORDER.map((item) => {
              const count = data.summary?.[item.key] ?? 0;
              if (!count) return null;
              return (
                <Tag key={item.key} color={item.color}>
                  {t(item.labelKey)} {count}
                </Tag>
              );
            })}
          </Space>

          <Space wrap>
            <Button size="small" icon={<ReloadOutlined />} onClick={() => void reload()}>
              {t("atsCheck.action.retry")}
            </Button>
            <Button
              size="small"
              icon={<CopyOutlined />}
              disabled={data.issues.length === 0}
              onClick={() => void copyImprovements()}
            >
              {t("atsCheck.action.copyImprovements")}
            </Button>
          </Space>

          {keywords.matched.length > 0 && (
            <div>
              <Typography.Text type="secondary">{t("atsCheck.keywords.matched")}</Typography.Text>
              <Space wrap>
                {keywords.matched.map((hit) => (
                  <Tag key={hit.word} color="green">
                    {hit.count > 0 ? `${hit.word} ×${hit.count}` : hit.word}
                  </Tag>
                ))}
              </Space>
            </div>
          )}
          {keywords.missing.length > 0 && (
            <div>
              <Typography.Text type="secondary">{t("atsCheck.keywords.missing")}</Typography.Text>
              <Space wrap>
                {keywords.missing.map((word) => (
                  <Tag key={word}>{word}</Tag>
                ))}
              </Space>
            </div>
          )}

          {data.issues.length === 0 ? (
            <Empty description={t("atsCheck.empty")} />
          ) : (
            grouped.map((group) =>
              group.issues.length === 0 ? null : (
                <Card
                  key={group.key}
                  size="small"
                  title={
                    <Space>
                      <Typography.Text strong>{t(group.cardTitleKey)}</Typography.Text>
                      <Tag color={group.color}>{group.issues.length}</Tag>
                    </Space>
                  }
                >
                  <Space orientation="vertical" style={{ width: "100%" }} size="small">
                    {group.issues.map((issue, index) => (
                      <div
                        key={index}
                        style={{ borderTop: "1px solid var(--rf-border)", paddingTop: 8 }}
                        data-ats-category={issue.category}
                      >
                        <Space size="small" wrap>
                          <Tag color={SEVERITY[issue.severity]?.color}>
                            {severityLabel(issue.severity)}
                          </Tag>
                          <Typography.Text strong>{issue.title}</Typography.Text>
                        </Space>
                        <Typography.Paragraph style={{ margin: "4px 0" }}>
                          {issue.detail}
                        </Typography.Paragraph>
                        {issue.evidence.length > 0 && (
                          <Space wrap>
                            {issue.evidence.map((item, evidenceIndex) => (
                              <Tag key={evidenceIndex} color="default">
                                {item}
                              </Tag>
                            ))}
                          </Space>
                        )}
                        {issue.suggestion && (
                          <Typography.Paragraph style={{ margin: "4px 0 0" }}>
                            <Typography.Text type="success">
                              {t("atsCheck.issue.suggestion")}
                            </Typography.Text>
                            {issue.suggestion}
                          </Typography.Paragraph>
                        )}
                      </div>
                    ))}
                  </Space>
                </Card>
              ),
            )
          )}
        </>
      )}
      {loading && <LoadingBlock />}
    </Space>
  );
}
