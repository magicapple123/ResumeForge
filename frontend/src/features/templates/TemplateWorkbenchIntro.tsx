// SPDX-License-Identifier: Apache-2.0
/**
 * 工作台顶部说明：**一行引言 + `ⓘ`**（I-20）。
 *
 * 这里改过两次，原因都记下来：
 * 1. 自制模板下线后，原来那句"从下面挑一个内置模板，点「复制为新模板」开始编辑"指向的按钮
 *    已经不存在——指南类文案提到一个点不到的东西，比不写更糟。现在只讲版式。
 * 2. I-20：三行说明卡占掉首屏，用户要滚一屏才看到模板列表。说明的真实职责只是"让人知道
 *    这块是干什么的"，完整解释应该在 `ⓘ` 里。所以收成一行 + 浮层，卡片外壳一并去掉——
 *    它只是说明、不是可操作对象，没必要和下面的模板表抢视觉重量。
 */
import HintDetail from "../../components/common/HintDetail";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export default function TemplateWorkbenchIntro() {
  useLocale();
  return (
    <div className="template-workbench-intro">
      <span className="template-workbench-intro__summary">{t("layout.intro.title")}</span>
      <HintDetail
        // 原来的两段正文合并进浮层：分开写会让"是什么 / 怎么用"在浮层里也各占一段，
        // 而用户点开 `ⓘ` 时想一次看全。
        detail={`${t("layout.intro.body")} ${t("layout.intro.howto")}`}
        label={t("layout.intro.label")}
      />
    </div>
  );
}
