// SPDX-License-Identifier: Apache-2.0
/**
 * 「简历制作台」左栏：排版参数（模板 / 版式 / 板块顺序 / 字号 / 行距 / 页边距 / 间距 / 外观）。
 *
 * **为什么单独成文件**：`ResumeZoomModal` 已贴住单文件 500 行预算（那是零豁免的硬约束），
 * 而这一栏本身就是"一整块搬过来没有任何状态"的纯展示单元——它的四个分组、每个分组里的
 * 控件、以及"内容栏不在栅格里时的那句提示"全都可以原样透传，不需要任何 `useState`、
 * 不需要知道三栏布局的状态机（只读 `tier` 一个字符串）。
 *
 * 搬运时**行为一字未改**：分组顺序、`storageKey`、`showMarginSides` / `defaultSidesOpen`
 * 这两个只在制作台里打开的开关都留在原位。唯一的行为改动是 **P0-5**：这里不再无条件传
 * `preferProfileOrder`（卡片的顺序必须等于真实渲染顺序），见下面 `ResumeTemplateControls` 处。
 */
import type { RefObject } from "react";
import type { ResumeLayout, ResumeTemplateCatalog } from "../../types";
import type { ResumePreviewHandle } from "../ResumePreview";
import { t } from "../../i18n";
import ResumeColorControls from "./ResumeColorControls";
import ResumeMeasureControls from "./ResumeMeasureControls";
import ResumeParamGroup from "./ResumeParamGroup";
import ResumeSpacingControls from "./ResumeSpacingControls";
import ResumeTemplateControls from "./ResumeTemplateControls";

interface Props {
  /** 这份简历**草稿态**的版式（未保存的改动已经在里面，控件显示的就是它）。 */
  layout: ResumeLayout;
  /**
   * 打开这份简历时的版式快照：每个参数右侧那颗 ↺ 恢复的就是它（不是模板默认值）。
   * 由 `ResumeZoomModal` 在这一屏第一次渲染时捕获，之后不再变化。
   */
  baseline: ResumeLayout;
  /** 宿主正在按新设置重排：控件不禁用（禁用会让用户以为拖不动），只标个忙态。 */
  relayouting: boolean;
  /** 版式目录（宿主取一次后下发，四个分组共用一份，避免四个请求）。 */
  catalog?: ResumeTemplateCatalog;
  /** 这份简历有没有照片：没有时照片滑杆禁用并说明原因。 */
  hasPhoto?: boolean;
  /** 右栏那个预览实例：拖动度量/外观参数时用它注入探针 CSS，本地缩放、无网络往返。 */
  previewRef: RefObject<ResumePreviewHandle | null>;
  /**
   * 三档形态。只有 `three`（三栏）时内容栏在栅格里；两栏及以下要在本栏里给一句
   * "内容栏去哪了"的提示，否则用户会以为编辑入口消失了。
   */
  tier: "three" | "two" | "one";
  /** 中栏能否编辑（没有 `onSaveContent` 的只读宿主里为 false）：那句提示只在真能编辑时才说。 */
  editorEnabled: boolean;
  /** 任一控件改动后的重排回调（宿主负责 setState 重排，不落库）。 */
  onChange: (next: ResumeLayout) => void;
}

export default function WorkbenchParamsColumn({
  layout,
  baseline,
  relayouting,
  catalog,
  hasPhoto,
  previewRef,
  tier,
  editorEnabled,
  onChange,
}: Props) {
  return (
    <div className="resume-wb-col resume-wb-col-params">
      <ResumeParamGroup title={t("workbench.group.layout")} storageKey="layout">
        <ResumeTemplateControls
          layout={layout}
          disabled={relayouting}
          catalog={catalog}
          // 制作台**刻意不传** `preferProfileOrder`（P0-5）：卡片的顺序必须等于这份简历的
          // 真实渲染顺序。传了它，卡片会把"没有 section_order 的老简历"按资料顺序显示，
          // 而四个渲染器读的是内置默认——显示与渲染两套，那正是 P0-5 的根因。
          // 新简历要"资料顺序"改成**落库时物化**（后端 `default_section_order_config`），
          // 不再靠 UI 的默认值临时生效。
          onChange={onChange}
        />
      </ResumeParamGroup>
      <ResumeParamGroup title={t("workbench.group.measure")} storageKey="measure">
        <ResumeMeasureControls
          layout={layout}
          baseline={baseline}
          disabled={relayouting}
          catalog={catalog}
          previewRef={previewRef}
          hasPhoto={hasPhoto}
          // 分边页边距**只在这里**出现：左栏有纵向空间，四条支路摊开不挤。
          showMarginSides
          // 制作台内**默认展开**（PRD P0-5）：分边控件是「页边距」这一项的解释，紧跟在它的
          // 总滑杆之后；默认收起会让用户先点一次折叠标题才知道它存在。
          // 另两个宿主（主预览、生成配置页）不传这个 prop，仍取缺省 false（见该组件头注释）。
          defaultSidesOpen
          onChange={onChange}
        />
      </ResumeParamGroup>
      <ResumeParamGroup title={t("workbench.group.spacing")} storageKey="spacing">
        <ResumeSpacingControls
          layout={layout}
          baseline={baseline}
          catalog={catalog}
          disabled={relayouting}
          previewRef={previewRef}
          onChange={onChange}
        />
      </ResumeParamGroup>
      <ResumeParamGroup title={t("workbench.group.appearance")} storageKey="appearance">
        <ResumeColorControls
          layout={layout}
          baseline={baseline}
          catalog={catalog}
          disabled={relayouting}
          previewRef={previewRef}
          onChange={onChange}
        />
      </ResumeParamGroup>
      {/* 只在内容栏不在栅格里时显示（两栏 / 单栏）：告诉用户它去哪了，而不是让他找。
          三栏时这句描述的是不存在的问题（`display: none` 也在管这件事，两处同源）。 */}
      {tier !== "three" && editorEnabled ? (
        <span className="resume-wb-narrow-hint">{t("workbench.narrow.editor")}</span>
      ) : null}
    </div>
  );
}
