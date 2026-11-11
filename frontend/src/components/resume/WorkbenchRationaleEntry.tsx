// SPDX-License-Identifier: Apache-2.0
/**
 * 左栏「版面」组里的**生成说明入口**（#24 24F）。
 *
 * ## 为什么入口在左栏、正文不搬过来
 *
 * 「生成说明」解释的是"这份简历为什么长这样"（选了什么、放弃了什么、为什么这样排序）。
 * 它以前只有预览卡顶部那一行诊断条能打开——而用户**做改动**的时候正是在制作台里，
 * 想知道"能不能动这一段"就得先关掉制作台。入口搬进左栏（紧邻版面状态条，两块回答的是
 * 同一类问题：眼前这一版是怎么来的），正文仍是**同一个** `RationaleParagraphs`：
 * 段落切分与标题加粗的规则只在那一处实现，这里不复制。
 *
 * ## 没有 rationale 就不渲染
 *
 * `rationale` 是生成时落库的固定文本，旧记录 / 手工新建的记录可能是空串。空的时候
 * 整块**不出现**——摆一个点开是空白的入口（死链）比不摆更糟。
 *
 * ## 数据同源
 *
 * 与 24D 的未收录清单、24E 的来源徽标一样，`rationale` 来自**同一份**详情
 * （`ResumeDetail.rationale`）：宿主 `ResumeDetailPreview` 只取一次，经
 * `ResumeWorkbenchV2` 传到左栏。这一层不发任何请求。
 */
import { Button, Popover } from "antd";
import { useI18n } from "../../i18n/i18nContext";
import RationaleParagraphs from "./rationaleParagraphs";

export interface WorkbenchRationaleEntryProps {
  /** 生成说明原文（`detail.rationale`）；空串 / null = 整块不渲染。 */
  rationale?: string | null;
}

export default function WorkbenchRationaleEntry({ rationale }: WorkbenchRationaleEntryProps) {
  const { t } = useI18n();
  const text = (rationale ?? "").trim();
  if (!text) return null;
  return (
    /**
     * 外层是给样式与 e2e 的锚点；视觉交给 antd 的 link 按钮（左栏里它与「切到精确预览」
     * 这类文字入口同一档，不该比状态条更抢眼）。
     */
    <div className="resume-wb-rationale">
      <Popover
        trigger="click"
        placement="bottomLeft"
        // 与诊断条同一层弹层容器：限高 + 内部滚动（长 rationale 可能 600+ 字）。
        content={
          <div className="resume-diagnostics-popover resume-wb-rationale-body">
            <RationaleParagraphs text={text} />
          </div>
        }
      >
        <Button
          type="link"
          size="small"
          className="resume-wb-rationale-entry"
          // 读屏名与预览卡的同一入口**同一条 key**：两处说的是同一件事。
          aria-label={t("resume.diagnostics.aria.rationale")}
        >
          {t("resume.diagnostics.entry.rationale")}
        </Button>
      </Popover>
    </div>
  );
}
