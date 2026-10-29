// SPDX-License-Identifier: Apache-2.0
/**
 * 「条目字段排版」面板（W4）：按分区调整**承载区补充字段**的每行字段数、对齐方式、
 * 列间距、顺序与独占行。
 *
 * ## 为什么是"分区 + 字段顺序"而不是拖拽画布
 *
 * 教育 / 实习 / 项目等条目的补充字段在纸面上此前一律逐字段左对齐一行；字段一多，左边挤成
 * 一列、右半边空着。用户要的是"这几个字段两两一行、研究方向自己一行"。因此这里只有五个
 * 自由度（列数 / 对齐方式 / 列间距 / 顺序 / 独占行）——与后端 `format_config.field_layout`
 * 一一对应，HTML / PDF / Word / Markdown 四格式共用同一份装箱结果（后端
 * `profile_field_rows`）。
 *
 * 对齐方式默认「等宽对齐」：多列时各行的第 2 列起点一致（CSS Grid），解决"每行第二个
 * 字段起点随第一个字段长短漂移"的问题；「按内容」是改造前的顺排行为，留给需要还原的人。
 * 列间距是可自由拖动的滑杆，存**字号倍数**而非像素：改字号 / 换模板后按比例跟随。
 *
 * ## 分区级 vs 条目级
 *
 * 面板顶部的「条目」下拉选「全部条目」时改的是**分区级**设置（整栏统一，与改造前一致）；
 * 选中某一条（如"上海大学"这一条教育）时只改那一条：控件显示的是**这条实际生效的**配置
 * （分区默认 + 该条的覆盖），每次修改只写 `entries.<分区>.<id>` 里**相对分区默认变化了**
 * 的键，其余项继续继承分区默认。改回与分区默认一致时覆盖被整条删掉（不给库里留空记录），
 * 「恢复继承」是这条的复位入口。
 *
 * 数据读写与归一化在 `features/resume-layout/fieldLayout.ts`（纯函数，可单测）；本文件只管
 * 交互。一次修改 = 一次 `onChange`（宿主记一步历史并重排预览），面板不自己存草稿；列间距
 * 是唯一的例外——滑杆拖动与两侧加减按钮都只更新本地读数，停顿 `GAP_COMMIT_DEBOUNCE_MS`
 * 才提交一次（连点加减不会被压成十几步撤销）。
 *
 * ## 条目上移 / 下移
 *
 * 「条目」下拉右侧的两个箭头改的是**正文里的顺序**（不是排版域），所以它们不走 `onChange`：
 * 面板把"哪一条往哪边挪一格"报给宿主的 `onReorderEntry`，宿主翻译成大纲的 `reorder-entry`
 * 命令（同一份命令执行器 / 历史 / 保存链路，见 `features/resume-layout/entryReorder.ts`）。
 * 下拉的选中值按**条目 id** 记，所以挪完之后仍然停在同一条上（不按下标跟随）。
 */
import { ArrowDownOutlined, ArrowUpOutlined, MinusOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Segmented, Select, Slider, Switch, Typography } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ResumeLayout } from "../../types";
import {
  ALIGN_LABEL_KEYS,
  COLUMN_LABEL_KEYS,
  FIELD_LAYOUT_ALIGNS,
  FIELD_LAYOUT_SECTIONS,
  GAP_MAX,
  GAP_MIN,
  GAP_STEP,
  SECTION_LABEL_KEYS,
  defaultGapFor,
  defaultSectionLayout,
  effectiveSectionLayout,
  entryPatchFromEffective,
  fieldLabelKey,
  isSectionDefault,
  moveField,
  readEntryFieldLayout,
  readFieldLayout,
  withEntryFieldLayout,
  withSectionFieldLayout,
} from "../../features/resume-layout/fieldLayout";
import type {
  EntryFieldLayoutPatch,
  FieldLayoutAlign,
  FieldLayoutColumns,
  FieldLayoutSection,
  SectionFieldLayout,
} from "../../features/resume-layout/fieldLayout";
import type { EntryFieldLayoutOption } from "../../features/resume-layout/entryOptions";
import { isReorderableSection } from "../../features/resume-layout/entryReorder";

interface Props {
  /** 这份简历草稿态的版式（format_config 里带 field_layout）。 */
  layout: ResumeLayout;
  disabled?: boolean;
  /** 一次修改 = 一次提交（宿主记历史并重排预览）。 */
  onChange: (next: ResumeLayout) => void;
  /**
   * 每个分区可**单独设置**的条目（`id` + 主标题）。不传 / 该分区没有带稳定 id 的条目时，
   * 条目下拉只有"全部条目"且禁用（并说明原因）。
   */
  entryOptions?: Partial<Record<FieldLayoutSection, EntryFieldLayoutOption[]>>;
  /**
   * 条目上移 / 下移：`direction` = -1 上移一格、1 下移一格。
   *
   * 面板**不自己改内容**（正文在宿主里、要进历史、要重排预览），只把"哪一条往哪边挪一格"
   * 报上去，由宿主翻译成大纲的 `reorder-entry` 命令——两个入口共用同一份命令执行器。
   * 不传 = 只读（生成流程预览等宿主）：按钮禁用。
   */
  onReorderEntry?: (section: FieldLayoutSection, entryId: string, direction: -1 | 1) => void;
}

/** 滑杆拖动期间的提交防抖（与 `ResumeSpacingControls` 的同名行为一致）：一次拖动折叠成一次提交。 */
const GAP_COMMIT_DEBOUNCE_MS = 120;

/** 滑杆 `marks` 已移除：窄栏里 `0/1.6/8/16/30` 会叠成一团，定位交给「加减按钮 + 读数」。 */

export default function FieldLayoutPanel({
  layout,
  disabled = false,
  onChange,
  entryOptions,
  onReorderEntry,
}: Props) {
  useLocale();
  const [section, setSection] = useState<FieldLayoutSection>("education");
  // 条目级：`""` = 全部条目（= 分区级设置），否则只改选中的这一条。
  const [entryId, setEntryId] = useState("");
  // 拖动中的本地读数：滑块与数字先动，不等提交回来（否则拖动会一顿一顿）。
  const [gapDragging, setGapDragging] = useState<number | null>(null);
  const gapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configured = useMemo(() => readFieldLayout(layout), [layout]);
  const entryLayouts = useMemo(() => readEntryFieldLayout(layout), [layout]);
  // 分区级配置（= 条目没改过的项继承的那一份）。
  const sectionBase = configured[section] ?? defaultSectionLayout(section);
  const options = useMemo(() => entryOptions?.[section] ?? [], [entryOptions, section]);
  // 换分区 / 条目被删掉后旧选中值不再存在 → 回到"全部条目"（不静默改到一个不存在的 id）。
  const activeEntryId = options.some((option) => option.id === entryId) ? entryId : "";
  const entryPatch: EntryFieldLayoutPatch | null = activeEntryId
    ? (entryLayouts[section]?.[activeEntryId] ?? null)
    : null;
  // 选中具体条目时控件显示的是**这条实际生效的**配置（分区默认叠上覆盖）。
  const current = activeEntryId
    ? effectiveSectionLayout(section, sectionBase, entryPatch)
    : sectionBase;
  const activeEntryLabel = options.find((option) => option.id === activeEntryId)?.label ?? "";
  // 条目上移 / 下移的边界：下标取**当前选项顺序**（= 正文数组顺序），`-1` = 没选具体条目。
  const entryIndex = activeEntryId
    ? options.findIndex((option) => option.id === activeEntryId)
    : -1;
  // 论文 / 科研项目没有大纲分组 → 没有可下的 `reorder-entry`，那种分区不渲染这两个按钮。
  const canReorder = Boolean(onReorderEntry) && isReorderableSection(section);
  const moveEntry = (direction: -1 | 1) => {
    if (!activeEntryId) return;
    onReorderEntry?.(section, activeEntryId, direction);
  };

  // 父组件交回权威值（提交成功 / 外部改动 / 换分区换了对齐方式）后清本地态，
  // 否则滑杆会停在上一轮的中间值上。签名与 ResumeSpacingControls 的做法一致。
  const signature = `${activeEntryId}:${current.columns}:${current.align}:${current.gap ?? ""}`;
  const [prevSignature, setPrevSignature] = useState(signature);
  if (prevSignature !== signature) {
    setPrevSignature(signature);
    setGapDragging(null);
  }

  // 卸载时清定时器：否则防抖回调会在组件消失后提交一次。
  useEffect(
    () => () => {
      if (gapTimerRef.current) clearTimeout(gapTimerRef.current);
    },
    [],
  );

  // 滑杆要显示"当前实际生效的间距"：拖动中用本地值，未设置时用该对齐模式的兜底值。
  const gapValue = gapDragging ?? current.gap ?? defaultGapFor(current.align);
  /**
   * 提交一次改动。
   *
   * - 全部条目模式：写分区级（与改造前完全一致）；
   * - 条目模式：只写 `entries.<分区>.<id>`，patch 只含**相对分区默认变化了**的键；
   *   `null` = 这一条不再需要覆盖（"恢复继承"）。
   */
  const commit = (next: SectionFieldLayout | null) => {
    if (!activeEntryId) {
      onChange(withSectionFieldLayout(layout, section, next));
      return;
    }
    const patch = next === null ? null : entryPatchFromEffective(sectionBase, next);
    onChange(withEntryFieldLayout(layout, section, activeEntryId, patch));
  };

  // 定时器闭包不能捕获渲染快照：120ms 防抖窗口内用户可能又改了列数 / 对齐 / 独占行，
  // 一旦闭包里用旧快照提交，就会把新改动覆盖回旧值（例如把 3 列写回 2 列）。
  // 用 ref 存每次渲染最新的提交入口与配置，定时器触发时读**当前**值合并。
  // 赋值放在 effect 里而不是渲染中：React 会在处理下一次输入事件 / 定时器回调前冲刷
  // 待执行的被动 effect，所以 ref 里永远是最近一次提交后的配置（且满足 hooks/refs 规则）。
  const latest = useRef({ commit, current });
  useEffect(() => {
    latest.current = { commit, current };
  });

  const disabledProp = disabled || undefined;

  const commitGap = (value: number) => {
    setGapDragging(value); // 即时反馈：读数与滑块先动
    if (gapTimerRef.current) clearTimeout(gapTimerRef.current);
    gapTimerRef.current = setTimeout(() => {
      gapTimerRef.current = null;
      // 停顿 120ms 才真正落库 + 重排：从 1.6 拖到 3.0 不会压出十几步撤销。
      // 用 ref 里的最新 commit / current（见上），不捕获本次渲染的快照。
      const { commit: commitNow, current: currentNow } = latest.current;
      commitNow({ ...currentNow, gap: value });
    }, GAP_COMMIT_DEBOUNCE_MS);
  };

  /**
   * 加减按钮：一次走一个 `GAP_STEP`（0.2 倍字号），结果按 1 位小数取整（浮点累加会得到
   * `1.7000000000000002` 这种读数）并夹在 `[GAP_MIN, GAP_MAX]` 内——按钮点到底也不会越界。
   * 与滑杆共用 `commitGap`，所以同样折叠成一次提交 / 一步撤销。
   */
  const stepGap = (direction: -1 | 1) => {
    const raw = Math.min(GAP_MAX, Math.max(GAP_MIN, gapValue + direction * GAP_STEP));
    commitGap(Math.round(raw * 10) / 10);
  };

  return (
    <div className="resume-field-layout">
      <Typography.Text type="secondary">{t("typography.fieldLayout.hint")}</Typography.Text>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <span>{t("typography.fieldLayout.sectionLabel")}</span>
        <Select<FieldLayoutSection>
          aria-label={t("typography.fieldLayout.sectionLabel")}
          value={section}
          disabled={disabledProp}
          options={FIELD_LAYOUT_SECTIONS.map((key) => ({
            value: key,
            label: t(SECTION_LABEL_KEYS[key]),
          }))}
          onChange={(value) => {
            // 换分区时丢掉上一个分区拖到一半的读数，否则滑杆会带着旧值出现。
            setGapDragging(null);
            setSection(value);
          }}
          style={{ minWidth: 160, flex: "1 1 auto" }}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <span>{t("typography.fieldLayout.entryLabel")}</span>
        <Select<string>
          aria-label={t("typography.fieldLayout.entryLabel")}
          value={activeEntryId}
          // 该分区还没有带稳定 id 的条目时只留"全部条目"，并禁用（原因见下一行小字）。
          disabled={disabled || options.length === 0 || undefined}
          options={[
            { value: "", label: t("typography.fieldLayout.entryAll") },
            ...options.map((option) => ({ value: option.id, label: option.label })),
          ]}
          onChange={(value) => {
            // 换条目时丢掉上一条拖到一半的读数，否则滑杆会带着旧值出现。
            setGapDragging(null);
            setEntryId(value);
          }}
          style={{ minWidth: 160, flex: "1 1 auto" }}
        />
        {/* 条目上移 / 下移：正文顺序在大纲页签里能拖，但用户在这里调"这一条的字段排版"时
            也要能顺手挪位置。命令交给宿主，走大纲同一份 `reorder-entry` 执行器。
            只有选中具体条目时可用；首项的上移 / 末项的下移禁用（越界不发命令）。 */}
        {canReorder ? (
          <>
            <Button
              size="small"
              type="text"
              icon={<ArrowUpOutlined />}
              aria-label={t("typography.fieldLayout.entryMoveUp", { label: activeEntryLabel })}
              disabled={disabled || entryIndex <= 0 || undefined}
              onClick={() => moveEntry(-1)}
            />
            <Button
              size="small"
              type="text"
              icon={<ArrowDownOutlined />}
              aria-label={t("typography.fieldLayout.entryMoveDown", { label: activeEntryLabel })}
              disabled={disabled || entryIndex < 0 || entryIndex >= options.length - 1 || undefined}
              onClick={() => moveEntry(1)}
            />
          </>
        ) : null}
      </div>
      {options.length === 0 ? (
        <div style={{ marginTop: 2 }}>
          <Typography.Text type="secondary">
            {t("typography.fieldLayout.entryNone")}
          </Typography.Text>
        </div>
      ) : null}
      {activeEntryId ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            marginTop: 8,
          }}
        >
          <Typography.Text type="secondary">
            {t("typography.fieldLayout.entryEditing", { label: activeEntryLabel })}
          </Typography.Text>
          <Button
            size="small"
            disabled={disabled || !entryPatch || undefined}
            onClick={() => onChange(withEntryFieldLayout(layout, section, activeEntryId, null))}
          >
            {t("typography.fieldLayout.entryRestore")}
          </Button>
        </div>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <span>{t("typography.fieldLayout.columnsLabel")}</span>
        <Segmented<FieldLayoutColumns>
          aria-label={t("typography.fieldLayout.columnsLabel")}
          value={current.columns}
          disabled={disabledProp}
          options={([1, 2, 3] as FieldLayoutColumns[]).map((value) => ({
            value,
            label: t(COLUMN_LABEL_KEYS[value]),
          }))}
          onChange={(value) => commit({ ...current, columns: value })}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <span>{t("typography.fieldLayout.alignLabel")}</span>
        <Segmented<FieldLayoutAlign>
          aria-label={t("typography.fieldLayout.alignLabel")}
          value={current.align}
          disabled={disabledProp}
          options={FIELD_LAYOUT_ALIGNS.map((value) => ({
            value,
            label: t(ALIGN_LABEL_KEYS[value]),
          }))}
          onChange={(value) => commit({ ...current, align: value })}
        />
      </div>
      <div style={{ marginTop: 2 }}>
        <Typography.Text type="secondary">{t("typography.fieldLayout.alignHint")}</Typography.Text>
      </div>
      {/* 列间距：标签与读数一行，`[−] 滑杆 [+]` 独占下一行——滑杆要和读数列在同一行时只剩
          几十像素，连两个刻度都摆不开（`0` 与 `1.6` 叠成了 `0.6`）。读数在上一行右侧，
          滑杆拿到整行宽度，拖到哪儿、点几下都看得清。 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginTop: 8,
        }}
      >
        <span>{t("typography.fieldLayout.gapLabel")}</span>
        <Typography.Text type="secondary">
          {t("typography.fieldLayout.gapValue", { value: gapValue.toFixed(1) })}
        </Typography.Text>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
        <Button
          size="small"
          type="default"
          icon={<MinusOutlined />}
          aria-label={t("typography.fieldLayout.gapDecrease")}
          // 到下限就别再让人点了；用 `disabled` 而不是只改样式，读屏也能听出"不可用"。
          disabled={disabled || gapValue <= GAP_MIN || undefined}
          onClick={() => stepGap(-1)}
        />
        <Slider
          aria-label={t("typography.fieldLayout.gapLabel")}
          ariaLabelForHandle={t("typography.fieldLayout.gapLabel")}
          // rc-slider 不输出 aria-valuestep，读屏用户至少能听到"当前是几倍字号"。
          aria-valuetext={t("typography.fieldLayout.gapValue", { value: gapValue.toFixed(1) })}
          min={GAP_MIN}
          max={GAP_MAX}
          step={GAP_STEP}
          value={gapValue}
          disabled={disabledProp}
          tooltip={{
            formatter: (value) =>
              t("typography.fieldLayout.gapValue", { value: Number(value).toFixed(1) }),
          }}
          onChange={commitGap}
          // 占满两个按钮之间的剩余宽度（`minWidth: 0` 让 flex 项能真正被压缩，不会撑出容器）。
          style={{ flex: 1, minWidth: 0, margin: 0 }}
        />
        <Button
          size="small"
          type="default"
          icon={<PlusOutlined />}
          aria-label={t("typography.fieldLayout.gapIncrease")}
          disabled={disabled || gapValue >= GAP_MAX || undefined}
          onClick={() => stepGap(1)}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginTop: 10,
        }}
      >
        <Typography.Text strong>{t("typography.fieldLayout.fieldsTitle")}</Typography.Text>
        <Typography.Text type="secondary">{t("typography.fieldLayout.solo")}</Typography.Text>
      </div>
      <ul style={{ listStyle: "none", margin: "4px 0 0", padding: 0 }}>
        {current.order.map((field, index) => {
          const label = t(fieldLabelKey(section, field));
          const solo = current.solo.includes(field);
          return (
            <li
              key={field}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}
            >
              <span
                style={{
                  flex: "1 1 auto",
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </span>
              <Button
                size="small"
                type="text"
                icon={<ArrowUpOutlined />}
                aria-label={t("typography.fieldLayout.moveUp", { label })}
                disabled={disabled || index === 0 || undefined}
                onClick={() => commit({ ...current, order: moveField(current.order, index, -1) })}
              />
              <Button
                size="small"
                type="text"
                icon={<ArrowDownOutlined />}
                aria-label={t("typography.fieldLayout.moveDown", { label })}
                disabled={disabled || index === current.order.length - 1 || undefined}
                onClick={() => commit({ ...current, order: moveField(current.order, index, 1) })}
              />
              <Switch
                size="small"
                checked={solo}
                aria-label={t("typography.fieldLayout.soloAria", { label })}
                disabled={disabledProp}
                onChange={(checked) =>
                  commit({
                    ...current,
                    solo: checked
                      ? [...current.solo, field]
                      : current.solo.filter((item) => item !== field),
                  })
                }
              />
            </li>
          );
        })}
      </ul>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginTop: 8,
        }}
      >
        <Typography.Text type="secondary">
          {t("typography.fieldLayout.summary", {
            columns: current.columns,
            solo: current.solo.length,
          })}
        </Typography.Text>
        {/* 条目模式下这里**不**再放"恢复默认"：分区 reset 只作用于整栏，很容易被误解成
            "把这条也清掉"。条目模式的复位入口是上面那一行的「恢复继承」（语义唯一）。 */}
        {activeEntryId ? null : (
          <Button
            size="small"
            disabled={disabled || isSectionDefault(section, current) || undefined}
            onClick={() => commit(null)}
          >
            {t("typography.fieldLayout.reset")}
          </Button>
        )}
      </div>
    </div>
  );
}
