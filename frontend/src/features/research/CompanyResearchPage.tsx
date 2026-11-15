// SPDX-License-Identifier: Apache-2.0
/**
 * 公司与岗位背景调研页（T07）。
 *
 * 一屏两段：上面是输入的三个字段，下面是「资料卡片 + 联网简报」。两条路**分开发请求**，
 * 所以页面必须能表达"卡片出来了但简报没出来"（`brief.status === "failed"`）这种半成功态
 * ——那正是无 Key / 余额不足时用户的真实遭遇，报整页错误会把已经搜到的资料一起藏掉。
 *
 * 深度开关默认关闭：搜索按查询词条数计费，深度档最多约 20 次工具调用。默认态在界面上
 * **写出来**（`deep.defaultOff`），不能只靠开关的视觉状态。
 */
import { Alert, Button, Card, Input, Space, Switch, Typography } from "antd";
import { useState } from "react";
import { researchCompany, type CompanyResearchResult } from "../../api/research";
import ErrorState from "../../components/common/ErrorState";
import LoadingBlock from "../../components/common/LoadingBlock";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import ResearchBriefPanel from "./ResearchBrief";
import ResearchCardList from "./ResearchCardList";
import "./research.css";

export default function CompanyResearchPage() {
  useLocale();
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [jd, setJd] = useState("");
  const [deep, setDeep] = useState(false);
  const [result, setResult] = useState<CompanyResearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    const name = company.trim();
    if (!name) {
      setError(t("companyResearch.error.companyRequired"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      setResult(await researchCompany({ company: name, role: role.trim(), jd, deep }));
    } catch (err) {
      // 后端 `detail` 只写原因，引导由这句兜底文案负责。
      setError(
        err instanceof Error && err.message ? err.message : t("companyResearch.error.request"),
      );
    } finally {
      setLoading(false);
    }
  };

  const usage = result?.usage;

  return (
    <div className="rf-research-page">
      <Card title={t("companyResearch.title")} className="rf-research-form">
        <Typography.Paragraph type="secondary">{t("companyResearch.intro")}</Typography.Paragraph>
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <label className="rf-research-field">
            <span>{t("companyResearch.field.company")}</span>
            <Input
              value={company}
              onChange={(event) => setCompany(event.target.value)}
              placeholder={t("companyResearch.field.companyPlaceholder")}
              aria-label={t("companyResearch.field.company")}
              data-testid="research-company"
              allowClear
            />
          </label>
          <label className="rf-research-field">
            <span>{t("companyResearch.field.roleOptional")}</span>
            <Input
              value={role}
              onChange={(event) => setRole(event.target.value)}
              placeholder={t("companyResearch.field.rolePlaceholder")}
              aria-label={t("companyResearch.field.roleOptional")}
              data-testid="research-role"
              allowClear
            />
          </label>
          <label className="rf-research-field">
            <span>{t("companyResearch.field.jdOptional")}</span>
            <Input.TextArea
              value={jd}
              onChange={(event) => setJd(event.target.value)}
              placeholder={t("companyResearch.field.jdPlaceholder")}
              aria-label={t("companyResearch.field.jdOptional")}
              data-testid="research-jd"
              autoSize={{ minRows: 3, maxRows: 8 }}
            />
          </label>
          <div className="rf-research-deep">
            <Space align="center">
              <Switch
                checked={deep}
                onChange={setDeep}
                aria-label={t("companyResearch.deep.label")}
                data-testid="research-deep"
              />
              <span>{t("companyResearch.deep.label")}</span>
            </Space>
            <Typography.Text type="secondary" className="rf-research-hint">
              {t("companyResearch.deep.hint")}
            </Typography.Text>
            {/* The default state is written on the page, not implied by the switch position. */}
            <Typography.Text type="secondary" className="rf-research-hint">
              {t("companyResearch.deep.defaultOff")}
            </Typography.Text>
          </div>
          <Button
            type="primary"
            onClick={() => void submit()}
            loading={loading}
            data-testid="research-submit"
          >
            {result ? t("companyResearch.action.rerun") : t("companyResearch.action.submit")}
          </Button>
        </Space>
      </Card>

      {loading ? (
        <LoadingBlock tip={t("companyResearch.brief.empty")} />
      ) : error ? (
        <ErrorState description={error} onRetry={() => void submit()} retrying={loading} />
      ) : result ? (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          {result.notes.length > 0 ? (
            <Alert
              type="info"
              showIcon
              title={t("companyResearch.notes.title")}
              description={result.notes.join(t("companyResearch.notes.separator"))}
            />
          ) : null}
          <Card title={t("companyResearch.cards.title")}>
            <ResearchCardList cards={result.cards} />
          </Card>
          <Card title={t("companyResearch.brief.title")}>
            <ResearchBriefPanel brief={result.brief} />
            {usage ? (
              <Typography.Paragraph
                type="secondary"
                className="rf-research-usage"
                data-testid="research-usage"
              >
                {t("companyResearch.usage.summary", {
                  count: usage.search_calls,
                  seconds: Math.max(1, Math.round(usage.elapsed_ms / 1000)),
                })}
                {" · "}
                {t("companyResearch.usage.billing")}
              </Typography.Paragraph>
            ) : null}
          </Card>
        </Space>
      ) : (
        <Card title={t("companyResearch.brief.title")}>
          <Typography.Text type="secondary">{t("companyResearch.brief.empty")}</Typography.Text>
        </Card>
      )}
    </div>
  );
}
