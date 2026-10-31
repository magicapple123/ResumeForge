// SPDX-License-Identifier: Apache-2.0
/**
 * 精确预览的提示块：溢出警告 / 旧后端警告 / 底部状态行。
 *
 * **为什么单独成文件**：`ExactPreviewPanel` 贴着 500 行预算（零豁免），而这三段都是
 * **纯展示**——只根据"这一版排了几页、要不要提示"决定渲染什么，不碰请求、不碰双缓冲
 * 状态机。把它们搬出来，面板里才装得下相框与缩放那层容器。
 *
 * 文案与草稿侧**同一措辞**（2026-10-21 用户要求）：同一个事实在两处换两种说法，
 * 用户会以为是两件事。
 */
import { Alert, Button, Space, Typography } from "antd";
import { t } from "../../i18n";
import { EXACT_OVERFLOW_NOTE_KEY } from "./config";
import type { PreviewShot } from "./exactPreviewCache";
import { useLocale } from "../../i18n/i18nContext";

interface AlertsProps {
  current: PreviewShot | null;
  busy: boolean;
  pageLimit: number;
}

/**
 * 相框上方的两条警告。
 *
 * - 溢出：这一版已经是**按上限截断**的产物，直接说"约需几页"，让用户自己决定加页还是收排版；
 * - 旧后端：没有 `X-Resume-Pages-Needed` 响应头时，跑着的还是"自动缩字号"的旧版本，
 *   不点破的话用户只会看到"滑杆 18px、PDF 明显更小"。
 */
export function ExactPreviewAlerts({ current, busy, pageLimit }: AlertsProps) {
  useLocale();
  if (!current) return null;
  return (
    <>
      {current.overflow && !busy ? (
        <Alert
          type="warning"
          showIcon
          className="exact-preview-overflow"
          style={{ marginBottom: 8 }}
          title={t("exact.overflow.title", {
            needed: current.pagesNeeded ?? current.pages ?? "?",
            limit: pageLimit,
          })}
          description={t(EXACT_OVERFLOW_NOTE_KEY)}
        />
      ) : null}
      {current.pagesNeeded == null ? (
        <Alert
          type="warning"
          showIcon
          className="exact-preview-stale"
          style={{ marginBottom: 8 }}
          title={t("exact.stale.title")}
          description={t("exact.stale.body")}
        />
      ) : null}
    </>
  );
}

/**
 * 环境没有内置 PDF 查看器（Electron 默认 `plugins=false`）时的出口。
 *
 * 从 `ExactPreviewPanel` 搬出来（那份文件贴着 500 行预算）：它只是"说清楚 + 给一条在新
 * 标签打开的路"，不碰请求与双缓冲。
 */
export function ExactNoViewer({
  url,
  fallback = "no-viewer",
}: {
  url: string;
  /**
   * 为什么落到这个兜底：环境没有内置查看器 / 查看器 8 秒内没加载出来（Q18）。
   * 两种情况的标题与正文不同——"这里放不了 PDF"和"PDF 有了但没加载出来"是两件事。
   * 属性名刻意不叫 `reason`：它在产品文案守卫的 COPY_PROPERTIES 清单里（Q18 收口时踩到）。
   */
  fallback?: "no-viewer" | "timeout";
}) {
  useLocale();
  const timedOut = fallback === "timeout";
  return (
    <div style={{ padding: 16 }}>
      <Alert
        type="info"
        showIcon
        title={t(timedOut ? "preview.exact.loadTimeoutTitle" : "preview.exact.noViewerTitle")}
        description={
          <Space orientation="vertical" size={6}>
            <Typography.Text>
              {t(timedOut ? "preview.exact.loadTimeoutBody" : "preview.exact.noViewerBody")}
            </Typography.Text>
            <Button
              type="primary"
              onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
            >
              {t("preview.exact.openInSystemViewer")}
            </Button>
          </Space>
        }
      />
    </div>
  );
}

/**
 * 精确预览请求失败时的整块错误态。
 *
 * 从 `ExactPreviewPanel` 搬出来（那份文件贴着 500 行预算）：它纯粹是"把 error 摆出来 +
 * 给一句怎么办"，不碰请求状态机。文案口径不变：第一行是服务端原话，第二行才是我们能给的
 * 建议（检查后端 / 稍后重试），别把两件事混成一句。
 */
export function ExactPreviewError({ error }: { error: string }) {
  useLocale();
  return (
    <Alert
      type="error"
      showIcon
      title={t("preview.exact.errorTitle")}
      description={
        <Space orientation="vertical" size={4}>
          <Typography.Text>{error}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("preview.exact.errorHint")}
          </Typography.Text>
        </Space>
      }
    />
  );
}

interface StatusProps {
  current: PreviewShot;
  busy: boolean;
  pageLimit: number;
  /** 标题字族是衬线时那句"精确预览用嵌入黑体"的说明。 */
  headingSerif: boolean;
  /** 只有当前可见时才说字族的事（藏起来时说了也没人看）。 */
  active: boolean;
  /** 这一版预览用的是**还没保存**的正文（制作台里改完没点保存）。 */
  hasUnsavedContent?: boolean;
  onOpenInNewTab: () => void;
}

/**
 * 整块预览的页脚：实际页数 + （可选）字族说明 + 「在新标签打开」。
 *
 * 放在**最后一张纸之后**，不夹在纸与纸之间：一条横栏会把最后一页读成被切断的纸
 * （用户口径："有内容的页上直接接下一页"）。
 */
export function ExactPreviewStatus({
  current,
  busy,
  pageLimit,
  headingSerif,
  active,
  hasUnsavedContent = false,
  onOpenInNewTab,
}: StatusProps) {
  useLocale();
  return (
    <div className="exact-preview-status" aria-busy={busy}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {/* 重排期间要说话：PDF 是服务端排的、查看器还要重建，改完参数到新图出来之间
            必然有一段空窗——静悄悄留着旧图会让人以为"没生效"。 */}
        {busy
          ? t("exact.status.busy")
          : t("exact.status.pages", { pages: current.pages ?? "?", limit: pageLimit })}
      </Typography.Text>
      {hasUnsavedContent && active ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("exact.unsavedNote")}
        </Typography.Text>
      ) : null}
      {headingSerif && active ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("exact.serifNote")}
        </Typography.Text>
      ) : null}
      <Button size="small" type="link" onClick={onOpenInNewTab}>
        {t("exact.openNewTab")}
      </Button>
    </div>
  );
}
