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
 */

import { useEffect, useState } from "react";
import {
  ExperimentOutlined,
  LeftOutlined,
  PaperClipOutlined,
  PlusOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Select, Tooltip, Upload } from "antd";
import { ASSISTANT_ACCEPT, MAX_ATTACHMENT_COUNT } from "../../assistantUtils";
import { layer } from "../../../../theme/tokens";
import { t } from "../../../../i18n";
import { useLocale } from "../../../../i18n/i18nContext";
import { useJobSearchSelect, useResumeSearchSelect } from "../../../../hooks/remoteSearchOptions";
import { SkillPicker } from "./SkillChips";
import type { AssistantSkill } from "../../../../types";
import type {
  ConversationSkillBudget,
  ConversationSkillItem,
} from "../../../../api/conversationSkills";

/** 面板两级：顶级四组，技能点进去是第二级（复用 SkillChips 的勾选列表与预算行）。 */
type AddPanelLevel = "root" | "skills";

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
  const [level, setLevel] = useState<AddPanelLevel>("root");

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
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      setLevel("root");
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    // 收起时回到顶级：下次点开不该停在上一次的技能二级。
    if (!next) setLevel("root");
  };

  const attachDisabled = sending || attachmentReads > 0 || attachmentsCount >= MAX_ATTACHMENT_COUNT;

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
      <Button
        type="text"
        size="small"
        className="composer-add-action is-navigate"
        icon={<ExperimentOutlined />}
        disabled={sending}
        onClick={() => setLevel("skills")}
      >
        <span className="composer-add-action-row">
          <span>{t("assistantComposer.skills.count", { count: selectedSkills.length })}</span>
          <RightOutlined className="composer-add-caret" aria-hidden="true" />
        </span>
      </Button>
    </>
  );

  const skillsPanel = (
    <>
      <div className="composer-add-head">
        <Button
          type="text"
          size="small"
          className="composer-add-back"
          icon={<LeftOutlined />}
          aria-label={t("common.action.back")}
          onClick={() => setLevel("root")}
        />
        <span className="composer-add-head-title">{t("composerAddMenu.section.skills")}</span>
      </div>
      <SkillPicker
        catalog={skillCatalog}
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

  return (
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
            <div className="composer-add-panel">{level === "skills" ? skillsPanel : rootPanel}</div>
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
  );
}
