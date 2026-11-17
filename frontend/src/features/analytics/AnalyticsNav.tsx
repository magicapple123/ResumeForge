// SPDX-License-Identifier: Apache-2.0
/**
 * 看板的分段导航（T13）。
 *
 * 为什么不是 `Tabs`：这里不是互斥面板，而是同一页里的十个段落——用 `Tabs` 会把"整页
 * 一屏屏切换"错当成"页面只有当前这一段"，用户没法滚着读，也没法复制链接给同事。
 *
 * 行为三件：
 * 1. 点击滚动到对应段落（`scrollIntoView({block:"start"})`，靠 `scroll-margin-top` 留出
 *    sticky 条的高度，否则标题会被压在导航下面）；
 * 2. 滚动时用 `IntersectionObserver` 高亮当前段（`rootMargin` 取"上 30% / 下 60%"，
 *    让"刚进入视口上部的段"算当前，而不是"还没离开视口"的上一段）；
 * 3. 高亮只有两种手段：字重 600 + 12×2px 品牌短横线——与设置页导航同一套语言。
 */
import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/** 段落 id 与文案 key。顺序即页面顺序；改顺序时两处一起改（本数组 + AnalyticsBody）。 */
export const ANALYTICS_SECTIONS = [
  { id: "analytics-overview", key: "overview" },
  { id: "analytics-funnel", key: "funnel" },
  { id: "analytics-channel", key: "channel" },
  { id: "analytics-duration", key: "duration" },
  { id: "analytics-cohort", key: "cohort" },
  { id: "analytics-trend", key: "trend" },
  { id: "analytics-channels", key: "channels" },
  { id: "analytics-repeat", key: "repeat" },
  { id: "analytics-resume-effect", key: "resumeEffect" },
  { id: "analytics-goal", key: "goal" },
  { id: "analytics-resume", key: "resume" },
] as const;

export default function AnalyticsNav() {
  useLocale();
  const [active, setActive] = useState<string>(ANALYTICS_SECTIONS[0].id);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) return;
        // 取"最靠上"的那一段，而不是最后一条回调：一次滚动会同时触发多段。
        const top = visible.reduce((best, entry) =>
          entry.boundingClientRect.top < best.boundingClientRect.top ? entry : best,
        );
        setActive(top.target.id);
      },
      { rootMargin: "-30% 0px -60% 0px", threshold: 0 },
    );
    for (const section of ANALYTICS_SECTIONS) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <nav ref={navRef} className="analytics-nav" aria-label={t("analyticsPage.nav.aria")}>
      {ANALYTICS_SECTIONS.map((section) => (
        <button
          key={section.id}
          type="button"
          className="analytics-nav-item"
          aria-current={active === section.id ? "true" : undefined}
          onClick={() => {
            document
              .getElementById(section.id)
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
            setActive(section.id);
          }}
        >
          {t(`analyticsPage.nav.${section.key}`)}
        </button>
      ))}
    </nav>
  );
}
