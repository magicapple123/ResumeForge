// SPDX-License-Identifier: Apache-2.0
/**
 * 页导航（D04）：上一页 / 下一页 / 页码跳转 + 当前页读数。
 *
 * 三件必备：按钮有 aria-label、页码输入框有可读名、读数用 `aria-live="polite"`
 * （滚动翻页时读屏用户也能知道现在是第几页）。
 */
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { Button, InputNumber, Space, Tooltip, Typography } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { PageMarker, PageMarkerSeverity } from "../../../features/resume-proview/pageMarkers";
import type { PageNavigation } from "../../../features/resume-proview/usePageNavigation";

/** 标记颜色只走 token（深色主题跟着变）。 */
const MARKER_COLOR: Record<PageMarkerSeverity, string> = {
  blocker: "var(--rf-danger)",
  verify: "var(--rf-warning-text)",
  suggestion: "var(--rf-text-tertiary)",
};

interface Props {
  navigation: PageNavigation;
  /** 问题位置标记（W08 传入）；不传 = 视觉零变化。 */
  markers?: readonly PageMarker[];
}

export default function PageNavigator({ navigation, markers = [] }: Props) {
  useLocale();
  const { currentPage, totalPages, goToPage, nextPage, previousPage } = navigation;
  const single = totalPages <= 1;
  // 只显示页码落在当前文档范围内的标记：切换简历/改页数后旧标记自动失效。
  const visibleMarkers = markers.filter((marker) => marker.page >= 1 && marker.page <= totalPages);
  return (
    <Space size={4} role="navigation" aria-label={t("proview.pageNav.label")}>
      <Tooltip title={t("proview.pageNav.prev")}>
        <Button
          size="small"
          type="text"
          icon={<LeftOutlined />}
          aria-label={t("proview.pageNav.prev")}
          disabled={single || currentPage <= 1}
          onClick={previousPage}
        />
      </Tooltip>
      <Typography.Text type="secondary" style={{ fontSize: 12 }} aria-live="polite">
        {t("proview.pageNav.status", { page: currentPage, total: totalPages })}
      </Typography.Text>
      <InputNumber
        size="small"
        min={1}
        max={totalPages}
        controls={false}
        value={currentPage}
        disabled={single}
        aria-label={t("proview.pageNav.inputAria", { total: totalPages })}
        onChange={(value) => {
          if (typeof value === "number") goToPage(value);
        }}
        style={{ width: 52 }}
      />
      <Tooltip title={t("proview.pageNav.next")}>
        <Button
          size="small"
          type="text"
          icon={<RightOutlined />}
          aria-label={t("proview.pageNav.next")}
          disabled={single || currentPage >= totalPages}
          onClick={nextPage}
        />
      </Tooltip>
      {single ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("proview.pageNav.single")}
        </Typography.Text>
      ) : null}
      {visibleMarkers.map((marker) => {
        const label = t("proview.pageNav.markerTip", {
          page: marker.page,
          count: marker.count,
        });
        return (
          <Tooltip key={marker.page} title={label}>
            <Button
              size="small"
              type="text"
              aria-label={label}
              onClick={() => goToPage(marker.page)}
              style={{ color: MARKER_COLOR[marker.severity], paddingInline: 4 }}
            >
              <span aria-hidden="true">●</span>
              {marker.count}
            </Button>
          </Tooltip>
        );
      })}
    </Space>
  );
}
