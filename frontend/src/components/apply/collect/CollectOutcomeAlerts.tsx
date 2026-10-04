/**
 * 采集批次的三张账目 Alert：「未生效条件」/「站点侧筛选」/「本地筛选」。
 *
 * 纯展示组件——账目由 collectTaskSummary.ts 从 task.config 解析后经 props 传入。
 */
import { Alert, Space, Typography } from "antd";
import type { FilterSummary, SiteFilterSummary } from "./collectTaskSummary";

interface Props {
  unmapped: string[];
  filtered: FilterSummary | null;
  siteFiltered: SiteFilterSummary | null;
}

export default function CollectOutcomeAlerts({ unmapped, filtered, siteFiltered }: Props) {
  return (
    <>
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

      {/* 本地筛选的账目：筛掉几条、有几条因为岗位没写字段而没能判断、以及自己的条件有没有
          被识别。三者都不说，用户就不知道"少了几个"是筛掉的还是没采到。 */}
      {filtered && (
        <Alert
          className="apply-collect-filtered"
          type="success"
          showIcon
          title={`已按${filtered.applied.join(" / ")}在采集后筛选`}
          description={
            <Space orientation="vertical" size={2}>
              <Typography.Text>
                {filtered.filtered > 0
                  ? `本次筛掉 ${filtered.filtered} 个不符合条件的岗位。`
                  : "本次没有岗位被筛掉。"}
              </Typography.Text>
              {filtered.undecidedCount > 0 && (
                <Typography.Text type="secondary">
                  其中 {filtered.undecidedCount} 个岗位没有写
                  {filtered.undecided.join("、")}，无法判断，已保留在结果里（宁可多给你看，
                  也不误删）。
                </Typography.Text>
              )}
              {filtered.unapplied.length > 0 && (
                <Typography.Text type="danger">
                  注意：{filtered.unapplied.join("、")}
                  这条条件没能识别，本次没有生效——换个写法试试（例如「本科」「3-5 年」）。
                </Typography.Text>
              )}
            </Space>
          }
        />
      )}
    </>
  );
}
