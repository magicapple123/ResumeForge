// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位匹配的**文本级**面板（T34）：拿一份**外部简历的正文**对 JD 做字面覆盖比对。
 *
 * 为什么它必须是一块独立的东西，而不是结构化匹配那张列表里的一行：
 *
 * 1. **来源不同**：结构化匹配读「我的资料 + 内部简历的结构化字段与版式」；这里只读
 *    `external_resume.text` 一串正文字。外部简历没有 `content`，喂给结构化匹配只会得到
 *    满屏"资料中未提供"。
 * 2. **结论不可比**：那边给五类状态 + 准入闸门，这边只给"JD 抽出来的词，正文里出现了
 *    没有"。把两者排进同一张表，用户会开始比较两个分母不同的数字——那是我们必须避免的
 *    误读。所以这里自带标题、自带「文本级」徽标、自带来源选择器，**不与内部简历混排**。
 * 3. **不落库**：结果每次现算（本地确定性计算，几毫秒）。刷新页面就消失是刻意的——
 *    它不是"这个岗位的匹配结论"，只是一次对照。
 *
 * 没有正文的外部简历（扫描件）**在下拉里就禁用并写明原因**，而不是让用户选了之后才弹
 * 一句"没有文字"；后端同时对同一件事给出可照做的 400 文案（两条路径都不能静默失败）。
 */
import { ReloadOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Progress, Select, Space, Tag, Typography } from "antd";
import { useEffect, useId, useState } from "react";
import { listExternalResumes } from "../../api/externalResumes";
import { useApi } from "../../hooks/useApi";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { errorText } from "../../hooks/useAbortableRequest";
import { matchJobTextLevel, type TextLevelMatch } from "./jobMatchTextLevelApi";
import "./jobMatchTextLevel.css";

interface Props {
  /** 当前岗位；换岗位时面板整体重新取候选并清空上一次结果。 */
  jobId: number;
}

/** 下拉里一份外部简历的展示文案：名字 + （无正文）标记。名字为空时退回 `#id`。 */
function optionLabel(id: number, name: string, hasText: boolean): string {
  const label = name.trim() || `#${id}`;
  return hasText ? label : `${label} ${t("jobMatch.textLevel.resume.noText")}`;
}

/** 覆盖比例的整数百分比（分母为 0 时给 0，而不是 NaN / 100%）。 */
function coveragePercent(matched: number, target: number): number {
  if (target <= 0) return 0;
  return Math.round((matched / target) * 100);
}

/**
 * 文本级比对面板。
 *
 * `jobId` 一变就把已选简历与上一次结果一起丢掉：换了岗位还留着上一份结果，是最容易
 * 被误读成"这个岗位的结论"的状态。
 */
export default function JobMatchTextLevelPanel({ jobId }: Props) {
  useLocale();
  const selectLabelId = useId();
  const [resumeId, setResumeId] = useState<number | undefined>();
  const [result, setResult] = useState<TextLevelMatch | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");

  const { data, loading, error, reload } = useApi(
    () => listExternalResumes({ page_size: 100 }),
    [jobId],
  );

  // 换岗位 = 换一次对照：已选简历与上一次结果都不能留着。
  useEffect(() => {
    setResumeId(undefined);
    setResult(null);
    setRunError("");
  }, [jobId]);

  const items = data?.items ?? [];
  const usable = items.filter((item) => item.has_text);
  // 有正文的名单里混着扫描件：只在悬停 title 里说原因，等于把"为什么灰"藏起来。
  // 这里给一条**常驻**说明（为什么用不了 + 去哪里补），一屏之内可读到。
  const hasTextless = items.length > usable.length;
  const options = items.map((item) => ({
    value: item.id,
    label: optionLabel(item.id, item.name, item.has_text),
    // 没有正文就选不到：不是"选了再报错"，而是根本不该让用户白做一次选择动作。
    disabled: item.has_text ? undefined : true,
    title: item.has_text ? undefined : t("jobMatch.textLevel.resume.noTextHint"),
  }));

  const run = async (targetId: number | undefined) => {
    if (targetId === undefined) return;
    setRunning(true);
    setRunError("");
    try {
      setResult(await matchJobTextLevel(jobId, targetId));
    } catch (runFailure) {
      // 后端把"为什么不行"写在 400 的 detail 里（没有正文 / 岗位没有 JD）：原样展示。
      setResult(null);
      setRunError(errorText(runFailure, t("jobMatch.textLevel.error.run")));
    } finally {
      setRunning(false);
    }
  };

  const onSelect = (value: number | undefined) => {
    setResumeId(value);
    setResult(null);
    setRunError("");
    void run(value);
  };

  return (
    <Card
      size="small"
      className="job-match-text-level"
      title={
        <Space size={6} wrap>
          <ThunderboltOutlined />
          <span>{t("jobMatch.textLevel.title")}</span>
          <Tag color="blue">{t("jobMatch.textLevel.badge")}</Tag>
        </Space>
      }
    >
      <Space orientation="vertical" size={10} style={{ width: "100%" }}>
        <Typography.Paragraph type="secondary" className="job-match-text-level-intro">
          {t("jobMatch.textLevel.intro")}
        </Typography.Paragraph>

        {error && (
          <Alert
            type="warning"
            showIcon
            title={t("jobMatch.textLevel.error.resumes")}
            action={
              <Button size="small" onClick={() => void reload()}>
                {t("jobMatch.action.retry")}
              </Button>
            }
          />
        )}

        <div>
          <Typography.Text id={selectLabelId}>
            {t("jobMatch.textLevel.resume.label")}
          </Typography.Text>
          <Select
            aria-labelledby={selectLabelId}
            style={{ width: "100%", marginTop: 4 }}
            allowClear
            showSearch={{ optionFilterProp: "label" }}
            placeholder={t("jobMatch.textLevel.resume.placeholder")}
            value={resumeId}
            onChange={onSelect}
            loading={loading}
            disabled={running || undefined}
            options={options}
          />
        </div>

        {!loading && !error && usable.length === 0 && (
          <Alert type="info" showIcon title={t("jobMatch.textLevel.resume.empty")} />
        )}

        {!loading && !error && usable.length > 0 && hasTextless && (
          <Alert type="info" showIcon title={t("jobMatch.textLevel.resume.someNoText")} />
        )}

        {runError && (
          <Alert
            type="error"
            showIcon
            title={runError}
            action={
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => void run(resumeId)}
                disabled={resumeId === undefined || undefined}
              >
                {t("jobMatch.action.retry")}
              </Button>
            }
          />
        )}

        {result && (
          <div className="job-match-text-level-result">
            <Space size={8} wrap className="job-match-text-level-head">
              <Typography.Text strong>{t("jobMatch.textLevel.coverage")}</Typography.Text>
              <Typography.Text>
                {t("jobMatch.textLevel.coverageValue", {
                  matched: result.matched_count,
                  target: result.target_count,
                })}
              </Typography.Text>
              <Typography.Text type="secondary">
                {t("jobMatch.textLevel.resumeSource", {
                  name: result.resume_name,
                  chars: result.text_chars,
                })}
              </Typography.Text>
            </Space>

            <Progress
              percent={coveragePercent(result.matched_count, result.target_count)}
              size="small"
              showInfo={false}
            />

            {result.target_count === 0 ? (
              <Alert type="info" showIcon title={t("jobMatch.textLevel.empty.words")} />
            ) : (
              <>
                <div className="job-match-text-level-words">
                  <Typography.Text type="secondary">
                    {t("jobMatch.textLevel.matched")}
                  </Typography.Text>
                  <Space size={4} wrap>
                    {result.matched_words.length === 0 ? (
                      <Typography.Text type="secondary">{t("jobMatch.empty.none")}</Typography.Text>
                    ) : (
                      result.matched_words.map((word) => (
                        <Tag key={word} color="green">
                          {word}
                        </Tag>
                      ))
                    )}
                  </Space>
                </div>
                <div className="job-match-text-level-words">
                  <Typography.Text type="secondary">
                    {t("jobMatch.textLevel.missing")}
                  </Typography.Text>
                  <Space size={4} wrap>
                    {result.missing_words.length === 0 ? (
                      <Typography.Text type="secondary">{t("jobMatch.empty.none")}</Typography.Text>
                    ) : (
                      result.missing_words.map((word) => <Tag key={word}>{word}</Tag>)
                    )}
                  </Space>
                </div>
              </>
            )}

            {result.highlights.length > 0 && (
              <div className="job-match-text-level-words">
                <Typography.Text type="secondary">
                  {t("jobMatch.textLevel.highlights")}
                </Typography.Text>
                <ul className="job-match-text-level-quotes">
                  {result.highlights.map((highlight) => (
                    <li key={highlight.text}>
                      {highlight.text}
                      {highlight.words.length > 0 && (
                        <Typography.Text type="secondary">
                          {" "}
                          {t("jobMatch.textLevel.highlightWords", {
                            words: highlight.words.join(", "),
                          })}
                        </Typography.Text>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.notes.length > 0 && (
              <ul className="job-match-notes">
                {result.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Space>
    </Card>
  );
}
