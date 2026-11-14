// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页左侧竖向导航（三档分组标题 + 九项）。
 *
 * 用原生 `<button>` + `aria-current="page"`，不是 `role="tab"`：这九个分组不是同一组
 * 互斥的页签面板，而是一张"页面地图"——屏幕阅读器读出「当前页：语音与面试」比读出
 * 「第 4 个，共 9 个」更贴近它实际做的事。↑/↓ 在项间移动（焦点跟着走、同时切换分组），
 * 与侧栏导航的键盘习惯一致。
 *
 * 窄屏（容器 ≤900px）由 CSS 把这份导航换成顶部一个 `Select`——两种形态同时挂载，
 * 靠容器查询二选一显示，省掉 JS 断点监听。
 */
import { Select } from "antd";
import { useRef } from "react";
import type { KeyboardEvent } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { SETTINGS_NAV_GROUPS, SETTINGS_SECTIONS, sectionsOfGroup } from "./settingsSections";
import type { SettingsSectionKey } from "./settingsSections";

export interface SettingsNavProps {
  active: SettingsSectionKey;
  onChange: (section: SettingsSectionKey) => void;
}

export default function SettingsNav({ active, onChange }: SettingsNavProps) {
  useLocale();
  const navRef = useRef<HTMLElement>(null);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(
      navRef.current?.querySelectorAll<HTMLButtonElement>(".settings-nav-item") ?? [],
    );
    const index = items.findIndex((item) => item === document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : items.length - 1;
    const next = items[(index + step) % items.length];
    next.focus();
    const key = next.dataset.section;
    const target = SETTINGS_SECTIONS.find((section) => section.key === key);
    if (target) onChange(target.key);
  };

  return (
    <>
      <nav
        ref={navRef}
        className="settings-nav"
        aria-label={t("settings.nav.aria")}
        onKeyDown={handleKeyDown}
      >
        {SETTINGS_NAV_GROUPS.map((group) => {
          const sections = sectionsOfGroup(group.key);
          if (sections.length === 0) return null;
          return (
            <div className="settings-nav-group" key={group.key}>
              <div className="settings-nav-group-title">{t(group.titleKey)}</div>
              {sections.map((section) => (
                <button
                  key={section.key}
                  type="button"
                  className="settings-nav-item"
                  data-section={section.key}
                  aria-current={active === section.key ? "page" : undefined}
                  onClick={() => onChange(section.key)}
                >
                  {t(section.titleKey)}
                </button>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="settings-nav-mobile">
        <Select
          className="settings-nav-mobile-select"
          value={active}
          onChange={(value: SettingsSectionKey) => onChange(value)}
          options={SETTINGS_SECTIONS.map((section) => ({
            value: section.key,
            label: t(section.titleKey),
          }))}
          aria-label={t("settings.nav.aria")}
        />
      </div>
    </>
  );
}
