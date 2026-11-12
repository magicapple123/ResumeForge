// SPDX-License-Identifier: Apache-2.0
/**
 * 字段旁的**来源徽标**（#24 24E）：资料库 / AI 生成 / 手动。
 *
 * ## 为什么是一颗可点的小徽标
 *
 * 生成链路会把每一条内容的来历记在 `fact_annotations` 里（RF-13）。这份信息以前只在
 * 详情顶部的「来源」弹层里能看到——要核对"这句话是我自己写的还是 AI 补的"，用户得
 * 关掉制作台、回到预览、翻来源清单、再按路径找回那一行。徽标把答案搬到**正在编辑的
 * 那个字段旁边**：改之前就知道这句话的底稿是谁写的。
 *
 * ## 三档而不是五档
 *
 * 后端有五种 origin（资料原文 / 回填原文 / AI 改写保留 / AI 改写 / 用户补充），
 * 那是"怎么来的"的精确描述，一行 Tag 放得下，一颗 11px 的徽标放不下。用户在编辑时
 * 只问一件事："这段能不能随便改"——三档就够。映射表在 `factAnnotationMeta.ts`
 * （`FACT_SOURCE_KIND`），与证据面板同一份色板语义。
 *
 * ## 拿不到标注就不渲染
 *
 * 解析不到标注（页眉字段、自建板块、旧记录没有标注）时**整颗徽标不出现**。
 * 摆一个"未知来源"的标签比不摆更糟：它给出了一个看起来有信息量、实际什么都没说的判断，
 * 用户还会拿它当"来源可疑"的证据。
 *
 * ## 点开看原文
 *
 * 弹层正文是 `FactAnnotationItem`（与证据面板同一条渲染件）：字段名 + origin Tag +
 * 核实状态 + 依据原文 + 个人边界。不新写一套展示——"同一段内容在两处显示不同的来源色"
 * 正是本条要消灭的分叉。
 */
import { Popover } from "antd";
import { useI18n } from "../../../i18n/i18nContext";
import type { FactAnnotation } from "../../../types";
import type { ResumeDocument } from "../../../types/resumeDocument";
import FactAnnotationItem from "./factAnnotationItem";
import { FACT_SOURCE_LABELS, factSourceKind } from "./factAnnotationMeta";

export interface FactSourceBadgeProps {
  /** 这条字段的标注（调用方已经按路径解析好；`null` 的调用方不渲染本组件）。 */
  annotation: FactAnnotation;
  /** 用来把标注路径翻成人话（弹层标题那一行）。 */
  document?: ResumeDocument | null;
}

export default function FactSourceBadge({ annotation, document = null }: FactSourceBadgeProps) {
  const { t } = useI18n();
  const kind = factSourceKind(annotation);
  const label = t(FACT_SOURCE_LABELS[kind]);
  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      // 与诊断条同一层容器类：限高 + 内部滚动，不另造一套弹层样式。
      content={
        <div className="resume-diagnostics-popover resume-fact-source-body">
          <FactAnnotationItem annotation={annotation} content={document} />
        </div>
      }
    >
      <button
        type="button"
        className="document-chip-badge is-source resume-fact-source-badge"
        // 自动化与样式都按这三档取值断言（`profile` / `ai` / `manual`）。
        data-source={kind}
        data-fact-path={annotation.path}
        // 徽标上的字很小（"资料库"），读屏必须自己把含义说全，不能只念这三个字。
        aria-label={t("resume.factSource.aria", { source: label })}
        // 这颗按钮只管弹层：不把点击冒泡给 chip 的容器（那会顺带选中/展开字段）。
        onClick={(event) => event.stopPropagation()}
      >
        {label}
      </button>
    </Popover>
  );
}
