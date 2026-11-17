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
import { Alert, App, Button, Card, Input, Space, Switch, Typography } from "antd";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  latestCompanyResearch,
  researchCompany,
  type CompanyResearchResult,
  type ResearchEntrySummary,
} from "../../api/research";
import ErrorState from "../../components/common/ErrorState";
import LoadingBlock from "../../components/common/LoadingBlock";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import ResearchBriefPanel from "./ResearchBrief";
import ResearchCardList from "./ResearchCardList";
import ResearchHistoryDrawer from "./ResearchHistoryDrawer";
import "./research.css";

/** 「最近一次调研」的时间说法：只做到"天"，精确到分钟对这个场景没有意义。 */
function relativeDays(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const hours = (Date.now() - then.getTime()) / 3_600_000;
  if (hours < 1) return t("companyResearch.latest.justNow");
  if (hours < 24) return t("companyResearch.latest.today");
  return t("companyResearch.latest.daysAgo", { days: Math.floor(hours / 24) });
}

export default function CompanyResearchPage() {
  const { message } = App.useApp();
  useLocale();
  const [searchParams] = useSearchParams();
  const [company, setCompany] = useState("");
  // T17：空公司名是**输入校验**，不是请求失败——不该出现红框面板与「重试」。
  const [nameInvalid, setNameInvalid] = useState(false);
  const [role, setRole] = useState("");
  const [jd, setJd] = useState("");
  const [deep, setDeep] = useState(false);
  const [result, setResult] = useState<CompanyResearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [latest, setLatest] = useState<ResearchEntrySummary | null>(null);
  // 历史条数独立于「最近一次调研」：知识条目可能被删过，历史仍在。
  const [historyCount, setHistoryCount] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  // I-22：`?company=&role=&job_id=` 只用于**预填**，不自动提交——一打开页面就搜一次
  // 等于替用户花搜索费，而用户可能只是想看看这家公司上次调研过什么。
  const [jobId, setJobId] = useState<number | undefined>(undefined);

  useEffect(() => {
    const presetCompany = searchParams.get("company")?.trim() || "";
    const presetRole = searchParams.get("role")?.trim() || "";
    const presetJob = Number(searchParams.get("job_id") || 0);
    /* eslint-disable react-hooks/set-state-in-effect -- URL 预填只在挂载时做一次：
       延后一拍会让用户先看到空表单再跳成预填值，那一下闪烁比级联渲染更糟。 */
    if (presetCompany) setCompany(presetCompany);
    if (presetRole) setRole(presetRole);
    if (presetJob > 0) setJobId(presetJob);
    // `?history=1`：岗位详情「查看全部」直接打开历史抽屉（仍然不自动提交调研）。
    if (searchParams.get("history") === "1") setHistoryOpen(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    // 只在进入页面时读一次：用户改完输入不该被 URL 里的旧值拉回去。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const name = company.trim();
    // 不在这里 setState 清空：显示条件随 company 变空而失效（effect 内直接 setState 会级联渲染）。
    if (!name) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      latestCompanyResearch(name)
        .then((payload) => {
          if (cancelled) return;
          setLatest(payload.entry);
          setHistoryCount(payload.count ?? 0);
        })
        .catch(() => {
          // 读「最近一次调研」是增强项：失败就当没有，不打扰用户。
          if (cancelled) return;
          setLatest(null);
          setHistoryCount(0);
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [company]);

  const submit = async () => {
    const name = company.trim();
    if (!name) {
      // 轻提示 + 输入框自身标错：错误面板只留给真正的请求失败。
      setNameInvalid(true);
      message.warning(t("companyResearch.error.companyRequired"));
      return;
    }
    setNameInvalid(false);
    setLoading(true);
    setError("");
    try {
      const payload = await researchCompany({
        company: name,
        role: role.trim(),
        jd,
        deep,
        job_id: jobId,
      });
      setResult(payload);
      // 刚跑完的这次就是"最近一次"，不必再发一次读请求。
      if (payload.knowledge_entry) setLatest(payload.knowledge_entry);
    } catch (err) {
      // 后端 `detail` 只写原因，引导由这句兜底文案负责。
      setError(
        err instanceof Error && err.message ? err.message : t("companyResearch.error.request"),
      );
    } finally {
      setLoading(false);
    }
  };

  /** I-23：只重跑简报（429 等场景）。卡片已经搜过，再跑一遍等于白付一次搜索费。 */
  const retryBrief = async () => {
    const name = company.trim();
    if (!name || loading) return;
    setLoading(true);
    setError("");
    try {
      const payload = await researchCompany({
        company: name,
        role: role.trim(),
        jd,
        deep,
        job_id: jobId,
        parts: ["brief"],
      });
      setResult((prev) =>
        prev
          ? {
              ...prev,
              brief: payload.brief,
              sources: payload.sources,
              notes: payload.notes,
              usage: payload.usage,
              knowledge_entry: payload.knowledge_entry ?? prev.knowledge_entry,
            }
          : payload,
      );
      if (payload.knowledge_entry) setLatest(payload.knowledge_entry);
    } catch (err) {
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
      <Card
        title={t("companyResearch.title")}
        className="rf-research-form"
        extra={
          // 右上角入口：不带公司名也开着，能翻到所有公司的历史。
          <Button onClick={() => setHistoryOpen(true)} data-testid="research-history-open">
            {t("companyResearch.history.open")}
          </Button>
        }
      >
        <Typography.Paragraph type="secondary">{t("companyResearch.intro")}</Typography.Paragraph>
        {company.trim() && (latest || historyCount > 0) ? (
          <Typography.Paragraph type="secondary" data-testid="research-latest">
            {latest
              ? t("companyResearch.latest.label", { when: relativeDays(latest.updated_at) })
              : ""}
            {latest ? " · " : ""}
            <Button type="link" size="small" onClick={() => setHistoryOpen(true)}>
              {t("companyResearch.history.viewAll")}
            </Button>
          </Typography.Paragraph>
        ) : null}
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <label className="rf-research-field">
            <span>{t("companyResearch.field.company")}</span>
            <Input
              value={company}
              onChange={(event) => {
                setCompany(event.target.value);
                if (nameInvalid) setNameInvalid(false);
              }}
              placeholder={t("companyResearch.field.companyPlaceholder")}
              aria-label={t("companyResearch.field.company")}
              data-testid="research-company"
              status={nameInvalid ? "error" : undefined}
              aria-invalid={nameInvalid || undefined}
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
            <ResearchBriefPanel brief={result.brief} onRetryBrief={() => void retryBrief()} />
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

      <ResearchHistoryDrawer
        open={historyOpen}
        company={company.trim() || undefined}
        jobId={jobId}
        onClose={() => setHistoryOpen(false)}
        // 「重新调研」只回填：清空上一次的结果，用户看过输入再自己按开始（避免又付一次搜索费）。
        onRerun={(run) => {
          setCompany(run.company_raw || run.company);
          setRole(run.role);
          setJd(run.jd_excerpt);
          setJobId(run.job_id ?? undefined);
          setResult(null);
          setError("");
        }}
      />
    </div>
  );
}
