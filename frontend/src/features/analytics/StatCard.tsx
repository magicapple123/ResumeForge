// SPDX-License-Identifier: Apache-2.0
/** 一个统计数字 + 一行说明。整页的指标都走这一个组件，避免 Card/Statistic/副文本
 *  的结构在各处复制十来遍。 */
import { Card, Statistic, Typography } from "antd";
import type { CSSProperties } from "react";

interface Props {
  title: string;
  value: number | string;
  suffix?: string;
  /** 数字下面的一行说明。既是补充数字，也是**口径**（例如"超过 7 天没有更新"）。
   *  留空则不渲染，不会留一个空占位。 */
  hint?: string;
  valueStyle?: CSSProperties;
  /** 外层包一张 Card。顶部指标行用 true；区块内部本来就在 Card 里，用默认 false。 */
  framed?: boolean;
  /**
   * 语义类名（项 8）：透传给 `Card` 的**根节点**（与 `.ant-card` 同一元素）。
   *
   * 顶部指标行用它编码"这张卡属于哪个阶段"（`stat-card-applied` / `-interview` /
   * `-assessment` / `-offer`），CSS 据此给彩条上阶段色。非 framed 分支**忽略**它：
   * 区块内部的小卡没有彩条，上色也没有意义。
   */
  className?: string;
}

export default function StatCard({
  title,
  value,
  suffix,
  hint,
  valueStyle,
  framed = false,
  className,
}: Props) {
  const body = (
    <>
      <Statistic title={title} value={value} suffix={suffix} styles={{ content: valueStyle }} />
      {hint ? <Typography.Text type="secondary">{hint}</Typography.Text> : null}
    </>
  );
  return framed ? <Card className={className}>{body}</Card> : body;
}
