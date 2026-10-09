/**
 * 采集批次的两张账目 Alert：「未生效条件」/「站点侧筛选」，
 * 以及可选的「翻页提前停止」说明。
 *
 * 纯展示组件——账目由 collectTaskSummary.ts 从 task.config 解析后经 props 传入。
 */
import { Alert, Typography } from "antd";
import type { SiteFilterSummary } from "./collectTaskSummary";

interface Props {
  unmapped: string[];
  siteFiltered: SiteFilterSummary | null;
  /** 翻页提前停止的页码（0/缺省 = 没有触发）。 */
  paginationStoppedAt?: number;
}

export default function CollectOutcomeAlerts({
  unmapped,
  siteFiltered,
  paginationStoppedAt = 0,
}: Props) {
  return (
    <div className="apply-collect-outcomes">
      {paginationStoppedAt > 0 && (
        <Alert
          className="apply-collect-pagination"
          type="info"
          showIcon
          title={`后面的页与前面的结果完全重复，已在第 ${paginationStoppedAt} 页提前停止翻页`}
          description="该条件下的岗位可能就这么多，或者大多已经采集过。想采更多：换关键词 / 城市，或放宽筛选条件后再跑一次。"
        />
      )}
      {unmapped.length > 0 && (
        <Alert
          className="apply-collect-unmapped"
          type="warning"
          showIcon
          title="以下条件未生效"
          description={
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              这批采集里，{unmapped.join("、")} 无法映射到该站点的查询参数，因此
              <Typography.Text strong>没有</Typography.Text>
              按它们筛选；结果里可能包含不满足这些条件的岗位。关键词、城市与翻页正常生效。
            </Typography.Paragraph>
          }
        />
      )}

      {/* 站点侧筛选的账目：**哪几条真的生效了**，以及**哪几条没能生效**。后端早就把这两笔账
          写进了批次配置，一直没在界面上露面——那等于记了账不给看。 */}
      {siteFiltered && (
        <Alert
          className="apply-collect-site-filtered"
          type={siteFiltered.unapplied.length > 0 ? "warning" : "success"}
          showIcon
          title={
            siteFiltered.applied.length > 0
              ? `招聘网站已按这些条件筛掉不符合的岗位：${siteFiltered.applied.join("、")}`
              : "有筛选条件没能生效"
          }
          description={
            siteFiltered.unapplied.length > 0 ? (
              <Typography.Text type="danger">
                这些条件本次
                <Typography.Text strong>没有生效</Typography.Text>：
                {siteFiltered.unapplied.join("、")}
                ——编码没能在站点当前的清单里核对上，所以没有发出去（发一个对不上的编码，
                网站会照常返回结果，你会以为筛过了）。点上面「重新读取」刷新清单后再试。
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary">
                网站在搜索时就完成了这些筛选，所以结果里不会有不符合的岗位。
              </Typography.Text>
            )
          }
        />
      )}
    </div>
  );
}
