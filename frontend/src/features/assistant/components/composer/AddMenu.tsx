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

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { useMediaQuery } from "../../../../hooks/useMediaQuery";
import { SkillPicker } from "./SkillChips";
import AssistantToolsEntryRow from "../../tools/AssistantToolsEntryRow";
import AssistantToolsDrawer from "../../tools/AssistantToolsDrawer";
import { useSkillFlyoutKeyboard } from "./useSkillFlyoutKeyboard";
import type { AssistantSkill } from "../../../../types";
import type {
  ConversationSkillBudget,
  ConversationSkillItem,
} from "../../../../api/conversationSkills";
// #32 的浮出层样式单独成文件：`.composer-add-panel` 那条契约（500 行）已经贴线。
import "../../../../styles/assistant-composer-flyout.css";

/** 悬停多久算"要看"：150ms 足够滤掉路过，又不至于让人觉得没反应。 */
export const SKILL_FLYOUT_OPEN_DELAY_MS = 150;
/** 移出多久才收起：比展开长一倍——斜向移进二级的途中不会闪关。 */
export const SKILL_FLYOUT_CLOSE_DELAY_MS = 300;
/** 二级面板宽度（与 `.composer-add-panel` 同宽）、与一级的间隙、贴视口的最低留白。 */
export const SKILL_FLYOUT_WIDTH = 320;
const SKILL_FLYOUT_GAP = 12;
const SKILL_FLYOUT_EDGE = 12;
/**
 * 矮视口（F35）：<560px 时二级面板在纵向没有余量，浮出层只会盖住输入框。
 * 与窄栏一起参与 `stacked`，走"整块替换一级"——`compact` 分支已经实现了这套形态。
 */
export const SHORT_VIEWPORT_QUERY = "(max-height: 559px)";

interface FlyoutPlacement {
  left: number;
  top: number;
  /** 右侧放不下时翻到一级面板左侧（`::before` 桥也跟着换边）。 */
  flipLeft: boolean;
}

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
  /** 二级是否展开：`compact` 下是"整块替换"，其余形态是"右侧浮出"。 */
  const [skillsOpen, setSkillsOpen] = useState(false);
  /** 二级的搜索词（关掉二级就清空，下次从完整列表开始）。 */
  const [skillQuery, setSkillQuery] = useState("");
  const [placement, setPlacement] = useState<FlyoutPlacement | null>(null);
  /** 浮出层本身比视口还高时（F35）：退回"整块替换"，而不是把面板顶出屏幕。 */
  const [stackedByHeight, setStackedByHeight] = useState(false);
  const shortViewport = useMediaQuery(SHORT_VIEWPORT_QUERY);
  /** 整块替换（窄栏 / 浮窗 / 矮视口 / 浮出层放不下）：任何一条成立都不渲染浮出层。 */
  const stacked = compact || shortViewport || stackedByHeight;

  /** 浮出层的定位基准：「技能」行容器（`position: relative`）。 */
  const anchorRef = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const hoverOpenTimer = useRef<number | null>(null);
  const hoverCloseTimer = useRef<number | null>(null);

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

  /** 清掉一个悬停计时器（没有就跳过）。 */
  const stopTimer = useCallback((handle: { current: number | null }) => {
    if (handle.current === null) return;
    window.clearTimeout(handle.current);
    handle.current = null;
  }, []);

  /** 收起二级。`restoreFocus` 用于键盘路径：焦点要还给「技能」行，不能掉到 body 上。 */
  const closeSkills = useCallback(
    (restoreFocus = false) => {
      stopTimer(hoverOpenTimer);
      stopTimer(hoverCloseTimer);
      setSkillsOpen(false);
      setSkillQuery("");
      setPlacement(null);
      setStackedByHeight(false);
      if (restoreFocus) {
        anchorRef.current?.querySelector<HTMLButtonElement>(".composer-add-action")?.focus();
      }
    },
    [stopTimer],
  );

  const openSkills = useCallback(() => {
    stopTimer(hoverCloseTimer);
    setSkillsOpen(true);
  }, [stopTimer]);

  // 键盘（Enter / Space / → / ← / Esc）整段在 hook 里：`compact` 没有浮出层，整条入口关掉。
  const { onRowKeyDown, onFlyoutKeyDown } = useSkillFlyoutKeyboard({
    flyoutRef,
    skillsOpen,
    enabled: !stacked,
    open: openSkills,
    close: closeSkills,
  });

  /** 悬停展开：只在浮出形态下排 150ms 计时器。生成中不展开——勾选框全是禁用的。 */
  const scheduleHoverOpen = useCallback(() => {
    if (stacked || sending || skillsOpen) return;
    stopTimer(hoverCloseTimer);
    if (hoverOpenTimer.current !== null) return;
    hoverOpenTimer.current = window.setTimeout(() => {
      hoverOpenTimer.current = null;
      setSkillsOpen(true);
    }, SKILL_FLYOUT_OPEN_DELAY_MS);
  }, [stacked, sending, skillsOpen, stopTimer]);

  /** 悬停收起：300ms 的缓冲。二级是「技能」行的子节点，指针进到二级会重新取消这个计时器。 */
  const scheduleHoverClose = useCallback(() => {
    if (stacked || !skillsOpen) return;
    stopTimer(hoverOpenTimer);
    if (hoverCloseTimer.current !== null) return;
    hoverCloseTimer.current = window.setTimeout(() => {
      hoverCloseTimer.current = null;
      closeSkills();
    }, SKILL_FLYOUT_CLOSE_DELAY_MS);
  }, [stacked, skillsOpen, stopTimer, closeSkills]);

  // 卸载时清计时器：面板被 `destroyOnHidden` 收走时，回调不该再碰已卸载的状态。
  useEffect(
    () => () => {
      stopTimer(hoverOpenTimer);
      stopTimer(hoverCloseTimer);
    },
    [stopTimer],
  );

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

  /**
   * 定位只在展开那一刻测一次：右侧不足 `320 + 12 + 12 = 344`px 翻到左侧，下方溢出则整体
   * 上移贴合视口（`SKILL_FLYOUT_EDGE` 留白）。逐帧测量会跟着动画抖，也会每帧重渲染。
   *
   * F35 补的两条：`top` 有下限（不许越过视口顶，`-overflowBottom` 可以为很大的负数）；
   * 浮出层比视口还高时不浮出，直接切整块替换。
   */
  useLayoutEffect(() => {
    if (!skillsOpen || stacked) {
      setPlacement(null);
      return;
    }
    const anchor = anchorRef.current;
    const flyout = flyoutRef.current;
    if (!anchor || !flyout) return;
    if (flyout.offsetHeight > window.innerHeight - SKILL_FLYOUT_EDGE * 2) {
      setStackedByHeight(true);
      setPlacement(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const rightSpace = window.innerWidth - rect.right;
    const flipLeft = rightSpace < SKILL_FLYOUT_WIDTH + SKILL_FLYOUT_GAP + SKILL_FLYOUT_EDGE;
    const overflowBottom =
      rect.top + flyout.offsetHeight - (window.innerHeight - SKILL_FLYOUT_EDGE);
    const top = Math.min(0, Math.max(SKILL_FLYOUT_EDGE - rect.top, -overflowBottom));
    setPlacement({
      left: flipLeft ? -(SKILL_FLYOUT_WIDTH + SKILL_FLYOUT_GAP) : rect.width + SKILL_FLYOUT_GAP,
      top,
      flipLeft,
    });
  }, [skillsOpen, stacked]);

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
            onMouseEnter={() => stopTimer(hoverCloseTimer)}
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
      <Tooltip title={t("composerAddMenu.tooltip")} placement="top">
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
