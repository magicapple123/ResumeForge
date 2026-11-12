// SPDX-License-Identifier: Apache-2.0
/**
 * 外部简历详情抽屉（第 21 条）：原件 / 提取文本 / 文本检查三个视图。
 *
 * **只读**：没有编辑正文、没有导出、没有版式——外部简历进不了制作台，这里也不需要
 * 假装能编辑。三个视图按内容而不是容器分：原件看"传的是哪份"，文本看"提取到了什么"，
 * 检查看"文本里有什么问题"。视图用 Tabs 切换，不在抽屉里再开弹层。
 *
 * 检查结果**没有总分**：只按条目渲染每类结论（占位符 / 量化 / 联系方式 / 长度 /
 * 弱表述 / 关键词），每条带行号与原文片段；未提取到文字时只给一条说明，绝不显示
 * "检查通过"。
 */
import { DownloadOutlined } from "@ant-design/icons";
import { Alert, Button, Drawer, Space, Tabs, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  externalResumeFileUrl,
  getExternalResume,
  getExternalResumeAnalysis,
} from "../../../api/externalResumes";
import type {
  AnalysisCheck,
  ExternalResumeAnalysis,
  ExternalResumeDetail,
} from "../../../api/externalResumes";
import ErrorState from "../../../components/common/ErrorState";
import LoadingBlock from "../../../components/common/LoadingBlock";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

export type ExternalResumeDetailTab = "original" | "text" | "check";

type CheckStatus = "ok" | "warn" | "info";

/** 每类检查的"正常/需注意"判定（文案 key 也是界面语汇，协议 key 来自后端）。 */
const CHECK_META = {
  placeholder: {
    label: "resumesPage.external.checkPlaceholder",
    status: (check: AnalysisCheck): CheckStatus => (check.count > 0 ? "warn" : "ok"),
  },
  quantification: {
    label: "resumesPage.external.checkQuantification",
    status: (check: AnalysisCheck): CheckStatus =>
      check.sample_size >= 3 && (check.ratio ?? 0) < 0.3 ? "warn" : "ok",
  },
  contact: {
    label: "resumesPage.external.checkContact",
    status: (check: AnalysisCheck): CheckStatus => (check.count > 0 ? "ok" : "warn"),
  },
  length: {
    label: "resumesPage.external.checkLength",
    status: (): CheckStatus => "info",
  },
  weak_wording: {
    label: "resumesPage.external.checkWeakWording",
    status: (check: AnalysisCheck): CheckStatus => (check.count > 0 ? "warn" : "ok"),
  },
  keywords: {
    label: "resumesPage.external.checkKeywords",
    status: (check: AnalysisCheck): CheckStatus => ((check.ratio ?? 0) < 0.6 ? "warn" : "ok"),
  },
} as const;

function percent(ratio: number | null): number {
  return Math.round((ratio ?? 0) * 100);
}

function statusTag(status: CheckStatus) {
  if (status === "ok") {
    return <Tag color="success">{t("resumesPage.external.checkStatusOk")}</Tag>;
  }
  if (status === "warn") {
    return <Tag color="warning">{t("resumesPage.external.checkStatusWarn")}</Tag>;
  }
  return <Tag>{t("resumesPage.external.checkStatusInfo")}</Tag>;
}

/** 每类检查的一句结论（比例一律换算成百分比，避免界面出现 0.4 这种原始小数）。 */
function checkDetail(check: AnalysisCheck): string {
  switch (check.key) {
    case "placeholder":
      return check.count > 0
        ? t("resumesPage.external.checkPlaceholderDetail", { count: check.count })
        : t("resumesPage.external.checkPlaceholderOk");
    case "quantification":
      return t("resumesPage.external.checkQuantificationDetail", {
        count: check.count,
        total: check.sample_size,
        ratio: percent(check.ratio),
      });
    case "contact":
      return check.count > 0
        ? t("resumesPage.external.checkContactDetail", { count: check.count })
        : t("resumesPage.external.checkContactMissing");
    case "length":
      return t("resumesPage.external.checkLengthDetail", {
        chars: check.count,
        lines: check.sample_size,
        pages: Math.max(0.1, Math.round((check.count / 1200) * 10) / 10),
      });
    case "weak_wording":
      return check.count > 0
        ? t("resumesPage.external.checkWeakWordingDetail", {
            count: check.count,
            total: check.sample_size,
            ratio: percent(check.ratio),
          })
        : t("resumesPage.external.checkWeakWordingOk");
    case "keywords": {
      const keywords = check.keywords;
      if (!keywords) return "";
      const base = t("resumesPage.external.checkKeywordsDetail", {
        matched: keywords.matched.length,
        target: keywords.target.length,
        ratio: percent(keywords.coverage_ratio),
      });
      return keywords.missing.length > 0
        ? `${base} · ${t("resumesPage.external.checkKeywordsMissing", {
            words: keywords.missing.join(" / "),
          })}`
        : base;
    }
    default:
      return "";
  }
}

function CheckList({ analysis }: { analysis: ExternalResumeAnalysis }) {
  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Alert type="info" showIcon title={t("resumesPage.external.checkHint")} />
      {analysis.checks.map((check) => {
        const meta = CHECK_META[check.key];
        if (!meta) return null;
        return (
          <div key={check.key}>
            <Space size={8} wrap>
              <Typography.Text strong>{t(meta.label)}</Typography.Text>
              {statusTag(meta.status(check))}
            </Space>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
              {checkDetail(check)}
            </Typography.Paragraph>
            {check.items.length > 0 ? (
              <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                {check.items.map((item) => (
                  <li key={`${check.key}-${item.line}-${item.text.slice(0, 12)}`}>
                    <Typography.Text type="secondary">
                      {t("resumesPage.external.lineWithText", {
                        line: item.line,
                        text: item.text,
                      })}
                    </Typography.Text>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </Space>
  );
}

export function ExternalResumeDetailDrawer({
  resumeId,
  initialTab = "original",
  onClose,
}: {
  resumeId: number | null;
  initialTab?: ExternalResumeDetailTab;
  onClose: () => void;
}) {
  useLocale();
  /**
   * 详情与检查结果都按**记录 id 缓存**（`{id, ...}`），渲染时只认"和当前 resumeId 匹配"
   * 的那份。这样切换/关闭时不需要在 effect 里同步清状态（那会触发 cascading render 的
   * lint 警告，也会让下一次打开先闪一眼上一份简历）。
   */
  const [detail, setDetail] = useState<{
    id: number;
    record: ExternalResumeDetail | null;
    error: string;
  } | null>(null);
  const [analysisState, setAnalysisState] = useState<{
    id: number;
    data: ExternalResumeAnalysis | null;
    error: string;
    loading: boolean;
  } | null>(null);
  const [tabState, setTabState] = useState<{
    id: number;
    tab: ExternalResumeDetailTab;
  } | null>(null);
  const open = resumeId !== null;
  const record = detail !== null && detail.id === resumeId ? detail.record : null;
  const detailError = detail !== null && detail.id === resumeId ? detail.error : "";
  const tab = tabState !== null && tabState.id === resumeId ? tabState.tab : initialTab;

  /**
   * 文本检查按需加载（只对"有文字"的简历有意义；空正文由界面直接说明）。
   *
   * 由**事件**触发（切到检查标签 / 详情带 initialTab=check 回来），不在 effect 里
   * 跟着状态跑：那会在 setState 后重跑 effect、把上一次请求的 cancelled 置真，
   * 表现是"永远转圈"。这里按记录 id 缓存结果，重复点同一标签不重复请求。
   */
  const loadAnalysis = useCallback((id: number, force = false) => {
    setAnalysisState((previous) => {
      if (!force && previous && previous.id === id && (previous.loading || previous.data)) {
        return previous;
      }
      return { id, data: null, error: "", loading: true };
    });
    void getExternalResumeAnalysis(id)
      .then((next) => {
        setAnalysisState((previous) =>
          previous && previous.id === id ? { id, data: next, error: "", loading: false } : previous,
        );
      })
      .catch((error: unknown) => {
        setAnalysisState((previous) =>
          previous && previous.id === id
            ? {
                id,
                data: null,
                error:
                  error instanceof Error ? error.message : t("resumesPage.external.checkFailed"),
                loading: false,
              }
            : previous,
        );
      });
  }, []);

  // 打开/切换记录：取详情（旧记录的数据靠渲染层的 id 匹配自然失效，不用先清空）。
  useEffect(() => {
    if (resumeId === null) return;
    let cancelled = false;
    void getExternalResume(resumeId)
      .then((next) => {
        if (cancelled) return;
        setDetail({ id: resumeId, record: next, error: "" });
        // 深链直接落在「文本检查」时，详情到手后再拉检查结果（有正文才值得拉）。
        if (initialTab === "check" && next.has_text) loadAnalysis(next.id);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDetail({
          id: resumeId,
          record: null,
          error: error instanceof Error ? error.message : t("resumesPage.external.loadFailed"),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [resumeId, initialTab, loadAnalysis]);

  const originalView = () => {
    if (!record) return null;
    if ((record.mime ?? "").toLowerCase().includes("pdf")) {
      return (
        <iframe
          title={record.name}
          src={externalResumeFileUrl(record.id)}
          style={{ width: "100%", height: 560, border: "none" }}
        />
      );
    }
    return (
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <Alert type="info" showIcon title={t("resumesPage.external.originalUnsupported")} />
        <Button
          icon={<DownloadOutlined />}
          href={externalResumeFileUrl(record.id)}
          target="_blank"
          rel="noreferrer"
        >
          {t("resumesPage.external.downloadOriginal")}
        </Button>
      </Space>
    );
  };

  const textView = () => {
    if (!record) return null;
    if (!record.has_text) {
      return <Alert type="warning" showIcon title={t("resumesPage.external.textEmpty")} />;
    }
    return (
      <pre
        style={{
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          margin: 0,
          fontFamily: "inherit",
          fontSize: 13,
          lineHeight: 1.7,
          maxHeight: "calc(100vh - 220px)",
          overflow: "auto",
        }}
      >
        {record.text}
      </pre>
    );
  };

  const checkView = () => {
    if (!record) return null;
    if (!record.has_text) {
      return (
        <Alert
          type="warning"
          showIcon
          title={t("resumesPage.external.textEmpty")}
          description={t("resumesPage.external.checkNoText")}
        />
      );
    }
    // 检查结果按记录缓存：打开时要么在加载、要么已有结果（由 loadAnalysis 维护）。
    const current = analysisState && analysisState.id === record.id ? analysisState : null;
    if (current === null || current.loading) {
      return <LoadingBlock tip={t("resumesPage.external.checkLoading")} />;
    }
    if (current.error) return <ErrorState description={current.error} />;
    if (current.data === null) {
      return <LoadingBlock tip={t("resumesPage.external.checkLoading")} />;
    }
    if (current.data.warnings.length > 0) {
      return <Alert type="warning" showIcon title={current.data.warnings[0]} />;
    }
    return <CheckList analysis={current.data} />;
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="large"
      title={
        <Space size={8}>
          <Typography.Text strong>{t("resumesPage.external.detailTitle")}</Typography.Text>
          {record ? <Typography.Text type="secondary">{record.name}</Typography.Text> : null}
        </Space>
      }
    >
      {detailError ? (
        <ErrorState description={detailError} />
      ) : record === null ? (
        <LoadingBlock />
      ) : (
        <Tabs
          activeKey={tab}
          onChange={(key) => {
            if (resumeId === null) return;
            const nextTab = key as ExternalResumeDetailTab;
            setTabState({ id: resumeId, tab: nextTab });
            // 检查结果按需拉取（有文字才值得拉；空正文由界面直接说明）。
            if (nextTab === "check" && record !== null && record.has_text) {
              loadAnalysis(record.id);
            }
          }}
          items={[
            {
              key: "original",
              label: t("resumesPage.external.tabOriginal"),
              children: originalView(),
            },
            {
              key: "text",
              label: t("resumesPage.external.tabText"),
              children: textView(),
            },
            {
              key: "check",
              label: t("resumesPage.external.tabCheck"),
              children: checkView(),
            },
          ]}
        />
      )}
    </Drawer>
  );
}

export default ExternalResumeDetailDrawer;
