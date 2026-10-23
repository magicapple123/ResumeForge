// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心的**结果列表**：宽档用表格，窄档（<1092）用卡片。
 *
 * 为什么在这里切而不是在页面里：`ResumesPage` 已经 482 行、离 500 行预算只剩十几行，
 * 而"这一屏该用哪种形态"是一个纯粹的呈现判断。做成一层薄壳之后，页面只换一个组件名，
 * 两份实现共用同一组受控 props（分页/排序/批量选择/各入口都在页面里）。
 *
 * 阈值来自 `BREAKPOINTS.narrow`（1092）：在那之下表格要横滚 660px，读一条记录等于做一次
 * 定位；卡片是一行字 + 一组动作，触控目标也更大。
 */
import type { ComponentProps } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { mqMax } from "../../theme/breakpoints";
import ResumeCardList from "./ResumeCardList";
import ResumeTable from "./ResumeTable";

type Props = ComponentProps<typeof ResumeTable>;

export default function ResumeResultList(props: Props) {
  const narrow = useMediaQuery(mqMax("narrow"));
  return narrow ? <ResumeCardList {...props} /> : <ResumeTable {...props} />;
}
