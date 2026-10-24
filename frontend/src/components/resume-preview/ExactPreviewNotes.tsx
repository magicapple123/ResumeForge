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
import { Alert, Button, Typography } from "antd";
import { t } from "../../i18n";
import { EXACT_OVERFLOW_NOTE } from "./config";
import type { PreviewShot } from "./exactPreviewCache";

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
          description={EXACT_OVERFLOW_NOTE}
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

interface StatusProps {
  current: PreviewShot;
  busy: boolean;
  pageLimit: number;
  /** 标题字族是衬线时那句"精确预览用嵌入黑体"的说明。 */
  headingSerif: boolean;
  /** 只有当前可见时才说字族的事（藏起来时说了也没人看）。 */
  active: boolean;
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
  onOpenInNewTab,
}: StatusProps) {
  return (
    <div className="exact-preview-status" aria-busy={busy}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {/* 重排期间要说话：PDF 是服务端排的、查看器还要重建，改完参数到新图出来之间
            必然有一段空窗——静悄悄留着旧图会让人以为"没生效"。 */}
        {busy
          ? t("exact.status.busy")
          : t("exact.status.pages", { pages: current.pages ?? "?", limit: pageLimit })}
      </Typography.Text>
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
