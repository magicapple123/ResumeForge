// SPDX-License-Identifier: Apache-2.0
/**
 * 输入区左侧的「+」（R06-A）：附件 / 关联岗位 / 关联简历 / 技能 四组入口收进一个面板。
 *
 * 改之前这三件事散在三个地方：输入框上方两枚常驻虚线按钮（「+ 关联岗位或简历」「+ 技能」）
 * 白占一行高度，附件是工具栏里一枚独立按钮。空对话里最显眼的偏偏是两个"还没用上"的入口。
 * 现在空对话只看得到一枚 `+`，点开才是四组。
 *
 * 五个实现要点（都是踩过或容易踩的）：
 * 1. **Dropdown 必须受控**（`open` + `onOpenChange`）：非受控时组件内部知道开没开、
 *    外面拿不到，图标就没法跟着转。
 * 2. **旋转给包住图标的 span，不给 Button**：直接转按钮会把 `:focus-visible` 的焦点环和
 *    点击水波纹一起转过去。CSS 见 `styles/assistant-composer.css` 的 `.composer-add-icon`。
 * 3. **二级菜单不算收起**：技能二级展开时顶层 `open` 仍为 true，`+` 保持 `×`；
 *    判定只看顶层 `open`，不看二级菜单状态。
 * 4. **无障碍靠 `aria-expanded`**，不动态改 `aria-label`——读屏用户不该听到按钮名字在
 *    「添加」和「关闭」之间跳。
 * 5. **`Select` 不能塞进 `Menu` 的 item**：antd 会在选中时收掉菜单，搜索框当场失焦、
 *    没法连续选。所以面板用 `Dropdown` + `popupRender` 自定义（外观仍是菜单），
 *    宽度封顶 320px（沿用 `ModelProfileSelect` 的经验），窄栏不横向溢出。
 *
 * 第六点（#32）：**技能二级改成"悬停浮出"**——一级留在原地，鼠标在「技能」行停留 150ms 后
 * 从右侧浮出二级、移出 300ms 收起（`compact` 没有横向余量，保持点击整块替换；点击与键盘都保留）。
 */

import { useEffect, useState } from "react";
import {
  ExperimentOutlined,
  LeftOutlined,
  PaperClipOutlined,
  PlusOutlined,
  RightOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Input, Select, Tooltip, Upload } from "antd";
import { ASSISTANT_ACCEPT, MAX_ATTACHMENT_COUNT } from "../../assistantUtils";
import { layer } from "../../../../theme/tokens";
import { t } from "../../../../i18n";
import { useLocale } from "../../../../i18n/i18nContext";
import { useJobSearchSelect, useResumeSearchSelect } from "../../../../hooks/remoteSearchOptions";
import { SkillPicker } from "./SkillChips";
import AssistantToolsEntryRow from "../../tools/AssistantToolsEntryRow";
import AssistantToolsDrawer from "../../tools/AssistantToolsDrawer";
import type { AssistantSkill } from "../../../../types";
import type {
  ConversationSkillBudget,
  ConversationSkillItem,
} from "../../../../api/conversationSkills";
// #32 的浮出层样式单独成文件：`.composer-add-panel` 那条契约（500 行）已经贴线。
import "../../../../styles/assistant-composer-flyout.css";
// 悬停浮出层的状态机（二级开合/定位/悬停计时器/键盘接线）在 useAddMenuSkillFlyout；
// 上面四个常量仍从本模块 re-export，对外导出面不变。
import { useAddMenuSkillFlyout } from "./useAddMenuSkillFlyout";

export {
  SHORT_VIEWPORT_QUERY,
  SKILL_FLYOUT_CLOSE_DELAY_MS,
  SKILL_FLYOUT_OPEN_DELAY_MS,
  SKILL_FLYOUT_WIDTH,
} from "./useAddMenuSkillFlyout";

export interface AddMenuProps {
  /** 浮窗形态：弹层要抬到卡片之上，否则被卡片盖住。 */
  compact: boolean;
  /** 生成中：整块入口不可点（不能边发边改上下文）。 */
  sending: boolean;
  /** 正在读取的附件数（>0 时不能再加，也不该继续发）。 */
  attachmentReads: number;
  /** 已选附件数（到上限就不能再加）。 */
  attachmentsCount: number;
  jobId: number | undefined;
  resumeId: number | undefined;
  skillCatalog: AssistantSkill[];
  selectedSkills: ConversationSkillItem[];
  skillBudget: ConversationSkillBudget | null;
  skillsLoaded: boolean;
  togglingSkillId: number | null;
  onJobChange: (value: number | undefined) => void;
  onResumeChange: (value: number | undefined) => void;
  onToggleSkill: (skill: AssistantSkill, enabled: boolean) => void;
  onManageSkills: () => void;
  onAddAttachment: (file: File) => void;
}

export default function AddMenu({
  compact,
  sending,
  attachmentReads,
  attachmentsCount,
  jobId,
  resumeId,
  skillCatalog,
  selectedSkills,
  skillBudget,
  skillsLoaded,
  togglingSkillId,
  onJobChange,
  onResumeChange,
  onToggleSkill,
  onManageSkills,
  onAddAttachment,
}: AddMenuProps) {
  // 本组件用模块级 t()：必须订阅语言变化。
  useLocale();
  const jobSelect = useJobSearchSelect();
  const resumeSelect = useResumeSearchSelect();
  const [open, setOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const {
    skillsOpen,
    skillQuery,
    setSkillQuery,
    stacked,
    anchorRef,
    flyoutRef,
    placement,
    closeSkills,
    openSkills,
    onRowKeyDown,
    onFlyoutKeyDown,
    scheduleHoverOpen,
    scheduleHoverClose,
    cancelHoverClose,
  } = useAddMenuSkillFlyout({ compact, sending });

  // 打开面板才拉第一页候选：空对话里不该为一个没点开的菜单花两次请求。
  useEffect(() => {
    if (!open) return;
    void jobSelect.reload();
    void resumeSelect.reload();
    // hook 的回调引用稳定，只跟随开合变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 已选值保显示（P0-1）：深链 / 页面侧带入的 id 也要显示标题而不是 `#id`。
  useEffect(() => {
    void jobSelect.ensure(jobId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);
  useEffect(() => {
    void resumeSelect.ensure(resumeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId]);

  // Esc 关闭：面板挂在 body 上，键盘事件不经过触发器，所以监听在 document 上。
  // 二级开着时的 Esc 走二级自己的 React 处理器（带 `stopPropagation`）——antd 的 Dropdown
  // 也监听 Esc，冒到 document 就两层一起收，等于"想收二级、整块面板没了"。
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      closeSkills();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, closeSkills]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    // 收起时二级与搜索词一起归零：下次点开不该停在上一次的技能二级。
    if (!next) closeSkills();
  };

  const attachDisabled = sending || attachmentReads > 0 || attachmentsCount >= MAX_ATTACHMENT_COUNT;
  // 搜索：名称与描述都参与匹配；查询为空时原样返回（不复制一份数组）。
  const normalizedQuery = skillQuery.trim().toLowerCase();
  const filteredSkills = normalizedQuery
    ? skillCatalog.filter(
        (skill) =>
          skill.name.toLowerCase().includes(normalizedQuery) ||
          (skill.description ?? "").toLowerCase().includes(normalizedQuery),
      )
    : skillCatalog;
  const noSkillMatch = normalizedQuery.length > 0 && filteredSkills.length === 0;

  /**
   * 二级内容（`compact` 是整块替换，其余是浮出层）：两级共用一份，预算口径不会分叉。
   * 列表与底部预算行仍由 `SkillPicker` 渲染——搜索无匹配时它那句"还没有技能"是错的，
   * 所以本层加 `is-empty` 压掉它，换成「没有匹配的技能」，预算行照常由它出。
   */
  const skillsBody = (
    <>
      <div className="composer-add-head">
        <Button
          type="text"
          size="small"
          className="composer-add-back"
          icon={<LeftOutlined />}
          aria-label={t("common.action.back")}
          onClick={() => closeSkills(true)}
        />
        <span className="composer-add-head-title">{t("composerAddMenu.section.skills")}</span>
      </div>
      <Input
        size="small"
        allowClear
        className="composer-add-select"
        value={skillQuery}
        onChange={(event) => setSkillQuery(event.target.value)}
        placeholder={t("composerAddMenu.skills.search")}
        aria-label={t("composerAddMenu.skills.search")}
        prefix={<SearchOutlined aria-hidden="true" />}
      />
      {noSkillMatch ? (
        <span className="composer-add-row-label">{t("composerAddMenu.skills.noMatch")}</span>
      ) : null}
      <SkillPicker
        catalog={filteredSkills}
        selected={selectedSkills}
        budget={skillBudget}
        loaded={skillsLoaded}
        togglingId={togglingSkillId}
        disabled={sending}
        onToggle={onToggleSkill}
        onManage={onManageSkills}
      />
    </>
  );

  const emptyClass = skillsOpen && noSkillMatch ? " is-empty" : "";
  /** 浮出层是「技能」行的子元素，一级面板的 overflow-y 会把它裁没；浮出期间让出裁切。 */
  const flyoutOpenClass = !stacked && skillsOpen ? " is-flyout-open" : "";
  const panelClass = `composer-add-panel${stacked ? emptyClass : ""}${flyoutOpenClass}`;
  const flyoutClass = `composer-add-panel composer-add-flyout${emptyClass}${
    placement?.flipLeft ? " is-left" : ""
  }`;

  const rootPanel = (
    <>
      <div className="composer-add-row">
        <span className="composer-add-row-label">{t("composerAddMenu.section.job")}</span>
        <Select
          size="small"
          allowClear
          className="composer-add-select"
          aria-label={t("assistantComposer.aria.jobSelect")}
          placeholder={t("assistantComposer.placeholder.job")}
          value={jobId}
          onChange={onJobChange}
          {...jobSelect.selectProps}
        />
      </div>
      <div className="composer-add-row">
        <span className="composer-add-row-label">{t("composerAddMenu.section.resume")}</span>
        <Select
          size="small"
          allowClear
          className="composer-add-select"
          aria-label={t("assistantComposer.aria.resumeSelect")}
          placeholder={t("assistantComposer.placeholder.resume")}
          value={resumeId}
          onChange={onResumeChange}
          {...resumeSelect.selectProps}
        />
      </div>
      {/* 附件：数量与体积限制、toast 全部照旧——这里只是把同一颗按钮挪进面板。
          提示包在 Upload **外面**（Tooltip 依赖的是可收事件的包裹层）：包在里面等于让
          Upload 去克隆 Tooltip，点击能否打开文件选择框就取决于 Tooltip 是否透传 onClick，
          这种事不该靠运气。 */}
      <Tooltip
        title={
          compact
            ? t("assistantComposer.tooltip.attachCompact")
            : t("assistantComposer.tooltip.attach")
        }
        placement="top"
        styles={compact ? { root: { maxWidth: 240, zIndex: layer.cardPopup } } : undefined}
      >
        <span className="composer-add-upload">
          <Upload
            accept={ASSISTANT_ACCEPT}
            multiple
            showUploadList={false}
            disabled={attachDisabled}
            beforeUpload={(file) => {
              onAddAttachment(file as File);
              return Upload.LIST_IGNORE;
            }}
          >
            <Button
              type="text"
              size="small"
              className="composer-add-action"
              icon={<PaperClipOutlined />}
              loading={attachmentReads > 0}
              disabled={attachDisabled}
              aria-label={t("composerAddMenu.action.attach")}
            >
              {t("composerAddMenu.action.attach")}
            </Button>
          </Upload>
        </span>
      </Tooltip>
      {/* 技能行：悬停容器 + 浮出层的定位基准。`compact` 下既没有 hover 也没有浮出层，
          点击依旧是"整块替换一级内容"。 */}
      <div
        ref={anchorRef}
        className="composer-add-skills-anchor"
        onMouseEnter={stacked ? undefined : scheduleHoverOpen}
        onMouseLeave={stacked ? undefined : scheduleHoverClose}
      >
        <Button
          type="text"
          size="small"
          className="composer-add-action is-navigate"
          icon={<ExperimentOutlined />}
          disabled={sending}
          aria-expanded={stacked ? undefined : skillsOpen}
          onClick={() => (skillsOpen ? closeSkills(true) : openSkills())}
          onKeyDown={onRowKeyDown}
        >
          <span className="composer-add-action-row">
            <span>{t("assistantComposer.skills.count", { count: selectedSkills.length })}</span>
            <RightOutlined className="composer-add-caret" aria-hidden="true" />
          </span>
        </Button>
        {!stacked && skillsOpen ? (
          <div
            ref={flyoutRef}
            className={flyoutClass}
            style={placement ? { left: placement.left, top: placement.top } : undefined}
            onMouseEnter={cancelHoverClose}
            onMouseLeave={scheduleHoverClose}
            onKeyDown={onFlyoutKeyDown}
          >
            {skillsBody}
          </div>
        ) : null}
      </div>
      <AssistantToolsEntryRow
        onOpen={() => {
          setOpen(false);
          closeSkills();
          setToolsOpen(true);
        }}
      />
    </>
  );

  return (
    <>
      {/* T12：菜单打开时**撤掉** tooltip。
        气泡与菜单同锚点，指针停在按钮上不会触发 leave，菜单展开后气泡仍在下面露一截。
        不删 Tooltip：未打开时它是"这个 + 能干什么"的唯一说明。 */}
      <Tooltip title={open ? null : t("composerAddMenu.tooltip")} placement="top">
        <span className="composer-add-wrap">
          <Dropdown
            open={open}
            onOpenChange={handleOpenChange}
            trigger={["click"]}
            placement="topLeft"
            disabled={sending}
            destroyOnHidden
            popupRender={() => (
              <div className={panelClass}>{stacked && skillsOpen ? skillsBody : rootPanel}</div>
            )}
            // 浮窗卡片（3400）高于 antd 弹层默认：不抬层会被卡片盖住。
            styles={compact ? { root: { zIndex: layer.cardPopup } } : undefined}
          >
            <Button
              type="text"
              size="small"
              className="composer-add-button"
              aria-label={t("composerAddMenu.aria.trigger")}
              // 开合状态只走 aria-expanded：名字保持稳定（见文件头第 4 条）。
              aria-expanded={open}
              aria-haspopup="menu"
            >
              <span
                className={open ? "composer-add-icon is-open" : "composer-add-icon"}
                aria-hidden="true"
              >
                <PlusOutlined />
              </span>
            </Button>
          </Dropdown>
        </span>
      </Tooltip>
      <AssistantToolsDrawer open={toolsOpen} onClose={() => setToolsOpen(false)} />
    </>
  );
}
