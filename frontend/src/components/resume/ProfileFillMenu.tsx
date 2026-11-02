// SPDX-License-Identifier: Apache-2.0
/**
 * 「从资料填入」菜单（v2）：候选解析与合并**只走 frontend-core 的单一实现**
 * （features/profile-library/projectionContent）：document_entry（新契约首选）→
 * 原生 document_path 定位；source 去重、只填空、补板块/补条目、
 * 仅素材标记都在 helper 里，本组件只负责菜单与目标拦截。
 *
 * ## 目标语义（R-29 之后）
 *
 * - 传 `selectedPath`（当前聚焦条目的 v2 路径）时**只列这个条目的候选**（`filter`），不再
 *   把全量候选摆出来 + disabled + 挂一长串原因：菜单第一行就是能点的，宽度也压得住 360px；
 * - 没有目标时列全量（`target = null` 靠 `mergeProjectionCandidate` 新增板块/条目）；
 * - 过滤后为空给一行说明，而不是给一个空菜单；
 * - 点不匹配的候选仍然给 `needTarget` 提示（防御：候选可能在菜单打开后被替换）。
 *
 * 写入只通过 onChange 回流（宿主记历史/标脏）。
 */
import { ImportOutlined } from "@ant-design/icons";
import { App, Button, Dropdown, Input, Tooltip } from "antd";
import { useState } from "react";
import { useLocale } from "../../i18n/i18nContext";
import { getCurrentProjection } from "../../features/profile-library/api";
import {
  mergeProjectionCandidate,
  resolvableProjectionCandidates,
} from "../../features/profile-library/projectionContent";
import type { ResolvedProjectionCandidate } from "../../features/profile-library/projectionContent";
import type {
  PaperProjectionOut,
  ProjectionCandidateOut,
} from "../../features/profile-library/types";
import type { ResumeDocument, ResumeItem } from "../../types/resumeDocument";
import { itemDisplayValue } from "../../features/resume-document/format";
import { enumLabelOf } from "../../features/resume-document/fieldCatalog";
import { useI18n } from "../../i18n/i18nContext";
import "./profile-fill-menu.css";

interface Props {
  document: ResumeDocument;
  onChange: (next: ResumeDocument) => void;
  /**
   * 当前聚焦条目的 v2 路径（如 education.ob_x）。给了就只列"填进这个条目"的候选；
   * 菜单只显示能填的那些，按钮文案也会带上目标条目名。
   */
  selectedPath?: string | null;
}

/** 目标板块/条目（v2 路径前两段；header 等非条目路径返回 null）。 */
type Target = { section: string; entryId: string };

function targetOfPath(path: string | null | undefined): Target | null {
  if (!path || path.startsWith("header.")) return null;
  const [section, entryId] = path.split(".");
  if (!section || !entryId) return null;
  return { section, entryId };
}

function candidateKey(candidate: ProjectionCandidateOut): string {
  return candidate.document_path || candidate.entry_id;
}

/**
 * 目标条目的名字：取该条目里第一个有值的标题字段（没有再退到第一个有值的字段）。
 *
 * 从**当前文档**读而不是等 projection 回来再改按钮文案：按钮在菜单展开前就要有名字，
 * 而且文档里已经有的就是用户在编辑器里看到的那一行。
 * #11a：枚举字段显示本地化标签（与 chip 同一 resolver），不再裸显 `full_time`。
 */
function targetTitleOf(
  document: ResumeDocument,
  target: Target | null,
  resolveEnum: (sectionKey: string, fieldKey: string, value: string) => string,
): string {
  if (!target) return "";
  const entry = document.sections
    .find((section) => section.key === target.section)
    ?.entries.find((candidate) => candidate.id === target.entryId);
  if (!entry) return "";
  const display = (item: ResumeItem) =>
    itemDisplayValue(item, {
      resolveEnum:
        item.kind === "field" && item.format === "enum"
          ? (raw) => resolveEnum(target.section, item.key, raw)
          : undefined,
    });
  const valued = entry.items.filter((item) => display(item).trim());
  const titled = valued.find((item) => item.kind !== "text" && item.placement === "title");
  const first = titled ?? valued[0];
  return first ? display(first).trim() : "";
}

/** 候选的单行文案（与 `option` 的显示一致），搜索匹配也用它。 */
function optionLabel(candidate: ProjectionCandidateOut): string {
  return candidate.subtitle ? candidate.title + " · " + candidate.subtitle : candidate.title;
}

export default function ProfileFillMenu({ document, onChange, selectedPath = null }: Props) {
  useLocale();
  const { t } = useI18n();
  const { message } = App.useApp();
  const [projection, setProjection] = useState<PaperProjectionOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // #22：候选搜索——只按候选文案（标题 · 次要说明）过滤，不区分大小写。
  const [query, setQuery] = useState("");
  // 受控 open：为了让「↓↓ / Esc」在焦点还在按钮上时也优先作用于这个下拉
  // （否则 Esc 会冒泡到工作台的"关闭制作台"处理器，#8/A3 的层级问题）。
  const [menuOpen, setMenuOpen] = useState(false);
  const target = targetOfPath(selectedPath);
  const targetTitle = targetTitleOf(document, target, (sectionKey, fieldKey, value) =>
    enumLabelOf(null, sectionKey, fieldKey, value, t),
  );

  const ensureProjection = async () => {
    if (projection || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      setProjection(await getCurrentProjection());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const candidates = resolvableProjectionCandidates(projection);
  const matchesTarget = (resolved: ResolvedProjectionCandidate): boolean => {
    if (!target) return true;
    return resolved.sectionKey === target.section && resolved.entry.id === target.entryId;
  };
  // R-29 ①：有目标时只留能填进这个条目的候选（过滤而不是 disabled）。
  const visibleBase = target ? candidates.filter(matchesTarget) : candidates;
  // #22：搜索过滤——按「标题 · 次要说明」或**板块名**不区分大小写匹配（方案 2），
  // 分组结构不动。板块名必须进来：用户搜「证书」时，证书资质下的条目标题里并没有"证书"两个字。
  const keyword = query.trim().toLowerCase();
  const matchesSearch = (resolved: ResolvedProjectionCandidate): boolean => {
    if (!keyword) return true;
    const sections = resolved.candidate.section_name + " " + resolved.candidate.section_key;
    return (optionLabel(resolved.candidate) + " " + sections).toLowerCase().includes(keyword);
  };
  const visible = visibleBase.filter(matchesSearch);

  const applyCandidate = (resolved: ResolvedProjectionCandidate) => {
    // 防御：候选可能在菜单打开后被替换；目标不匹配时给可读提示，不静默失败。
    if (!matchesTarget(resolved)) {
      message.info(t("editor.profileFill.needTarget"));
      return;
    }
    const result = mergeProjectionCandidate(document, resolved);
    if (result.filled <= 0) {
      message.info(t("editor.profileFill.empty"));
      return;
    }
    onChange(result.document);
    message.success(t("editor.profileFill.success", { count: result.filled }));
    if (result.materialOnly) message.info(t("document.toast.materialOnly"));
  };

  // #22：层级——条目缩进一级，右侧固定灰色板块名（不靠悬停也能看出属于哪个板块）。
  // 主文案仍单行省略 + title 兜底（R-33 R3）；右侧板块名是稳定小字长，不参与省略。
  const option = (resolved: ResolvedProjectionCandidate) => {
    const label = optionLabel(resolved.candidate);
    const section = resolved.candidate.section_name;
    return (
      <span className="rf-profile-fill-option" title={label}>
        <span className="rf-profile-fill-option-label">{label}</span>
        {section ? <span className="rf-profile-fill-option-section">{section}</span> : null}
      </span>
    );
  };

  const emptyItem = {
    key: "__empty",
    disabled: true,
    label: (
      <span className="rf-profile-fill-empty">
        {target ? t("editor.profileFill.emptyTarget") : t("editor.profileFill.empty")}
      </span>
    ),
  };

  const candidateItems =
    visible.length === 0
      ? [emptyItem]
      : target
        ? visible.map((resolved) => ({
            key: candidateKey(resolved.candidate),
            label: option(resolved),
          }))
        : Object.entries(
            visible.reduce<Record<string, ResolvedProjectionCandidate[]>>((groups, resolved) => {
              (groups[resolved.candidate.section_name] ??= []).push(resolved);
              return groups;
            }, {}),
          ).map(([label, group]) => ({
            type: "group" as const,
            label,
            children: group.map((resolved) => ({
              key: candidateKey(resolved.candidate),
              label: option(resolved),
            })),
          }));

  // 问题 5：搜索框与计数行**不再是菜单项**，改由 `popupRender` 渲染在固定头部
  // （`.rf-profile-fill-head`）里；`items` 只剩候选（或空态说明）。
  // 这样列表独立滚动，头部永不滚走，分组标题的 `top` 也不必再叠三层硬编码数字。
  const items = candidateItems;

  const buttonText = target
    ? targetTitle
      ? t("editor.profileFill.title.fillTarget", { title: targetTitle })
      : t("editor.profileFill.title.fill")
    : t("editor.profileFill.title.add");

  /**
   * 下拉根节点（`classNames.root` 挂的那个 div）。props 里的 `document`（ResumeDocument）
   * 会遮蔽全局 `document`，所以一律走 `globalThis.document`。
   */
  const dropdownRoot = (): HTMLElement | null =>
    globalThis.document.querySelector<HTMLElement>(".rf-profile-fill-menu");

  /** 固定头部里的搜索输入（allowClear 时 className 落在外层 affix 容器上，两种结构都兜住）。 */
  const searchInputEl = (): HTMLInputElement | null => {
    const root = dropdownRoot();
    if (!root) return null;
    const node = root.querySelector<HTMLElement>(".rf-profile-fill-search-input");
    if (!node) return null;
    if (node instanceof HTMLInputElement) return node;
    return node.querySelector<HTMLInputElement>("input");
  };

  /** 候选列表的菜单根（rc-menu 会给它 tabindex=0，拿到焦点后 ↑↓/Enter 由 rc-menu 接管）。 */
  const listMenuEl = (): HTMLElement | null =>
    globalThis.document.querySelector<HTMLElement>(
      ".rf-profile-fill-menu .rf-profile-fill-list .ant-dropdown-menu",
    );

  /**
   * 键盘层级：
   * - 触发按钮上 ↓/↑：焦点交给**搜索框**（问题 5 之后头部在菜单外，不再交给菜单）；
   * - 搜索框里 ↓/↑：焦点交给候选列表（之后由 rc-menu 处理 ↑↓/Enter）；
   * - 两处的 Esc：只关下拉并拦住冒泡（工作台的 Esc 处理器挂在 document 上，
   *   不拦会把整个制作台一起关掉）。
   * 鼠标事件仍拦在搜索框上，否则点输入框会把下拉关掉（它现在虽不在菜单里，
   * 但仍在 `popupRender` 内，点击会冒泡到 Dropdown 的关闭逻辑）。
   */
  const handleButtonKeyDown = (event: React.KeyboardEvent) => {
    if (!menuOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(false);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const input = searchInputEl();
    event.preventDefault();
    input?.focus();
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const menu = listMenuEl();
      if (!menu) return;
      event.preventDefault();
      menu.focus();
      return;
    }
    // 打字键与 Enter 都不冒泡给工作台（Enter 在搜索框里没有"提交"语义，
    // 选候选要先把焦点交给列表）。
    event.stopPropagation();
  };

  const button = (
    <Button
      size="small"
      icon={<ImportOutlined />}
      loading={loading || undefined}
      aria-label={t("editor.profileFill.aria.entry")}
      disabled={failed || undefined}
      onKeyDown={handleButtonKeyDown}
    >
      <span className="rf-profile-fill-label" title={buttonText}>
        {buttonText}
      </span>
    </Button>
  );

  if (failed) {
    return <Tooltip title={t("editor.profileFill.empty")}>{button}</Tooltip>;
  }
  return (
    <Dropdown
      menu={{
        items,
        onClick: ({ key }) => {
          if (key === "__empty") return;
          const resolved = candidates.find((item) => candidateKey(item.candidate) === key);
          if (resolved) applyCandidate(resolved);
        },
      }}
      trigger={["click"]}
      // antd 6 起 `overlayClassName` 已废弃，Dropdown 也没有 popupClassName；
      // 挂到弹出菜单根节点的推荐写法是 classNames.root（与 MySpaceMenu 一致）。
      classNames={{ root: "rf-profile-fill-menu" }}
      // 问题 5：固定头部 + 独立滚动列表。搜索框与计数行移出菜单项后，
      // 它们不再随候选滚动，分组标题的 sticky top 也就有了确定的参照系（top: 0）。
      // 注意：antd 6 里 `dropdownRender` 已废弃，必须用 `popupRender`。
      popupRender={(menu) => (
        <div className="rf-profile-fill-shell">
          <div className="rf-profile-fill-head">
            <Input
              size="small"
              allowClear
              className="rf-profile-fill-search-input"
              value={query}
              placeholder={t("editor.profileFill.search")}
              onKeyDown={handleSearchKeyDown}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setQuery(event.target.value)}
            />
            <span className="rf-profile-fill-count-text">
              {t("editor.profileFill.count", { count: visible.length })}
            </span>
          </div>
          <div className="rf-profile-fill-list">{menu}</div>
        </div>
      )}
      open={menuOpen}
      onOpenChange={(open) => {
        setMenuOpen(open);
        if (open) void ensureProjection();
        else setQuery(""); // 关掉就清搜索，下次打开是全量列表。
      }}
    >
      {button}
    </Dropdown>
  );
}
