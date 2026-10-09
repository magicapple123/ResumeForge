/**
 * 页面级骨架屏：数据未返回时的占位，避免整页白屏闪一下。
 *
 * 默认带 16px 内边距的卡片容器（card），与常见页头/卡片布局对齐；
 * 传 `card={false}` 可去掉容器（用于调用方已经有卡片外壳的场景）。
 */
import { Skeleton } from "antd";

interface Props {
  /** 段落行数。 */
  rows?: number;
  /** 是否显示头像占位。 */
  avatar?: boolean;
  /** 是否套一层 16px 内边距的卡片容器。 */
  card?: boolean;
}

export default function PageSkeleton({ rows = 6, avatar = false, card = true }: Props) {
  const skeleton = <Skeleton active avatar={avatar} paragraph={{ rows }} />;
  if (!card) {
    return skeleton;
  }
  return <div style={{ padding: 16 }}>{skeleton}</div>;
}
