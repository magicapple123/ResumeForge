// SPDX-License-Identifier: Apache-2.0
/**
 * 侧栏品牌图（WF-10）：浅色=星、深色=月，切换时两个符号原地交替。
 *
 * 为什么从 `<img>` 换成内联 SVG：`<img>` 的文档是黑盒，CSS 碰不到里面的图层，
 * 只能换 `src`——那张图要等下载完才画，中间必然白闪一次。内联之后星/月/光晕都是
 * 独立图层，可以各自做动画，还省掉一次图片请求。
 *
 * 为什么用 `animation` 而不是 `transition`：切主题会让本组件重渲染、两套图层互换
 * 可见性；`transition` 需要"同一个节点上属性连续变化"，而这里每次切都是新的一套
 * class，只有 `animation` 会在 class 变化时可靠触发。
 *
 * 素材：浅色取自 `desktop/icon-intro.svg` 的静态终态（`#ii-star-shape` + `#ii-halo-fill`），
 * 深色取自用户素材 `dark-moon-layered.svg`（`crescent-shape` + `halo-fill`）。两者同为
 * 512×512、底板同为 `rect rx=57`，星心 (258,239) 与月心 (≈250,235) 几乎重合，所以两套
 * 图层可以直接叠放、只做透明度与旋转缩放。
 *
 * 尺寸只有 34px：位移/角度都要克制。`scale(.6)` 是下限——再小星角就糊成一个点；
 * 角度收到 ±60°（不是 90°），否则中间帧看起来像在"翻面"。
 */
import { useEffect, useRef, useState } from "react";
import ThemeLogoDefs from "./ThemeLogoDefs";
import { useResolvedTheme, type ResolvedTheme } from "./themeStore";

const SWITCH_CLEAR_MS = 460;

export default function ThemeLogo() {
  const theme = useResolvedTheme();
  const previous = useRef(theme);
  // 只在"主题真的变了"时播一次；首屏渲染不播（否则每次进应用都闪一下）。
  const [switching, setSwitching] = useState<ResolvedTheme | null>(null);

  useEffect(() => {
    if (previous.current === theme) return;
    previous.current = theme;
    setSwitching(theme);
    const timer = window.setTimeout(() => setSwitching(null), SWITCH_CLEAR_MS);
    return () => window.clearTimeout(timer);
  }, [theme]);

  return (
    /* 装饰图：`aria-hidden` 后整个 SVG 不进入无障碍树，星/月只是同一件事的两种视觉形态，
       所以没有 `aria-label` / `data-filled` 需要跟随切换。可访问名由外层提供——
       侧栏品牌按钮是「回到顶部」（AppShell），页头主题档位是 ThemeSwitch 里
       `<span role="img" aria-label="浅色/深色/跟随系统">`；两者都不描述"当前画的是星还是月"。 */
    <svg
      className="app-brand-logo"
      viewBox="0 0 512 512"
      role="img"
      aria-hidden="true"
      focusable="false"
      data-theme={theme}
      data-switch={switching ?? undefined}
    >
      <ThemeLogoDefs />

      <g clipPath="url(#rf-logo-safe)">
        <g transform="translate(32 32) scale(.875)">
          {/* 浅色底板与书本 */}
          <g className="rf-logo-layer rf-logo-layer-light rf-logo-art">
            <rect width="512" height="512" rx="57" fill="url(#rf-logo-plate)" />
            <rect width="512" height="512" rx="57" fill="url(#rf-logo-plate-light)" />
            <g clipPath="url(#rf-logo-plate-clip)">
              <path
                d="M97 105Q100 83 123 82L417 74Q440 73 440 97L430 293 404 416Q400 438 379 436L79 414Q54 412 57 388Z"
                fill="url(#rf-logo-cover)"
                stroke="#D4EAFC"
                strokeOpacity=".85"
                filter="url(#rf-logo-cover-shadow)"
              />
              <g filter="url(#rf-logo-book-shadow)">
                <path
                  d="M322 110C290 215 240 330 191 420"
                  fill="none"
                  stroke="#F9FBFC"
                  strokeWidth="9"
                  strokeLinecap="round"
                />
                <g clipPath="url(#rf-logo-left-leaf)">
                  <rect x="25" y="30" width="310" height="410" fill="url(#rf-logo-left-paper)" />
                  <g fill="url(#rf-logo-row)">
                    <g transform="translate(186 87) rotate(20)">
                      <rect width="101" height="21" rx="10.5" />
                    </g>
                    <g transform="translate(171 125) rotate(20)">
                      <rect width="100" height="14" rx="7" />
                    </g>
                    <g transform="translate(157 156) rotate(20)">
                      <rect width="106" height="14" rx="7" />
                    </g>
                    <g transform="translate(143 188) rotate(21)">
                      <rect width="110" height="14" rx="7" />
                    </g>
                    <g transform="translate(127 222) rotate(21)">
                      <rect width="108" height="14" rx="7" />
                    </g>
                    <g transform="translate(110 256) rotate(21)">
                      <rect width="107" height="14" rx="7" />
                    </g>
                  </g>
                  <rect
                    x="0"
                    y="0"
                    width="105"
                    height="57"
                    rx="7"
                    transform="translate(96 287) rotate(21)"
                    fill="url(#rf-logo-photo)"
                  />
                </g>
                <g clipPath="url(#rf-logo-right-leaf)">
                  <rect x="175" y="80" width="310" height="400" fill="url(#rf-logo-right-paper)" />
                  <path d="M324 97 361 111Q348 125 333 142L314 151Z" fill="url(#rf-logo-fold)" />
                  <path
                    d="M326 100C291 211 237 337 186 431"
                    fill="none"
                    stroke="#FFFFFF"
                    strokeOpacity=".62"
                    strokeWidth="2.3"
                  />
                  <g fill="url(#rf-logo-row)">
                    <g transform="translate(320 182) rotate(8)">
                      <rect width="104" height="13" rx="6.5" />
                    </g>
                    <g transform="translate(306 216) rotate(8)">
                      <rect width="102" height="13" rx="6.5" />
                    </g>
                    <g transform="translate(290 251) rotate(8)">
                      <rect width="103" height="13" rx="6.5" />
                    </g>
                    <g transform="translate(274 285) rotate(9)">
                      <rect width="102" height="13" rx="6.5" />
                    </g>
                    <g transform="translate(266 319) rotate(10)">
                      <rect width="95" height="13" rx="6.5" />
                    </g>
                    <g transform="translate(250 353) rotate(11)">
                      <rect width="95" height="13" rx="6.5" />
                    </g>
                    <g transform="translate(235 385) rotate(12)">
                      <rect width="95" height="13" rx="6.5" />
                    </g>
                  </g>
                  <rect
                    width="81"
                    height="18"
                    rx="6"
                    transform="translate(361 142) rotate(7) skewX(-15)"
                    fill="url(#rf-logo-pill)"
                    stroke="#F5953D"
                  />
                </g>
              </g>
            </g>
          </g>

          {/* 深色底板与书本 */}
          <g className="rf-logo-layer rf-logo-layer-dark rf-logo-art">
            <rect width="512" height="512" rx="57" fill="url(#rf-logo-d-plate)" />
            <rect
              x="1.5"
              y="1.5"
              width="509"
              height="509"
              rx="55.5"
              fill="none"
              stroke="#5C7390"
              strokeOpacity=".65"
              strokeWidth="3"
            />
            <rect width="512" height="512" rx="57" fill="url(#rf-logo-d-plate-light)" />
            <g clipPath="url(#rf-logo-plate-clip)">
              <path
                d="M97 105Q100 83 123 82L417 74Q440 73 440 97L430 293 404 416Q400 438 379 436L79 414Q54 412 57 388Z"
                fill="url(#rf-logo-d-cover)"
                stroke="#5D82A9"
                strokeOpacity=".85"
                filter="url(#rf-logo-d-cover-shadow)"
              />
              <g filter="url(#rf-logo-d-book-shadow)">
                <path
                  d="M322 110C290 215 240 330 191 420"
                  fill="none"
                  stroke="#A8BBCD"
                  strokeWidth="9"
                  strokeLinecap="round"
                />
                <g clipPath="url(#rf-logo-left-leaf)">
                  <rect x="25" y="30" width="310" height="410" fill="url(#rf-logo-d-left-paper)" />
                  <g fill="url(#rf-logo-d-row)">
                    <g transform="translate(186 87) rotate(20)">
                      <rect width="101" height="21" rx="10.5" />
                    </g>
                    <g transform="translate(171 125) rotate(20)">
                      <rect width="100" height="14" rx="7" />
                    </g>
                    <g transform="translate(157 156) rotate(20)">
                      <rect width="106" height="14" rx="7" />
                    </g>
                    <g transform="translate(143 188) rotate(21)">
                      <rect width="110" height="14" rx="7" />
                    </g>
                    <g transform="translate(127 222) rotate(21)">
                      <rect width="108" height="14" rx="7" />
                    </g>
                    <g transform="translate(110 256) rotate(21)">
                      <rect width="107" height="14" rx="7" />
                    </g>
                  </g>
                  <rect
                    x="0"
                    y="0"
                    width="105"
                    height="57"
                    rx="7"
                    transform="translate(96 287) rotate(21)"
                    fill="url(#rf-logo-d-photo)"
                  />
                </g>
                <g clipPath="url(#rf-logo-right-leaf)">
                  <rect
                    x="175"
                    y="80"
                    width="310"
                    height="400"
                    fill="url(#rf-logo-d-right-paper)"
                  />
                  <path
                    d="M326 100C291 211 237 337 186 431"
                    fill="none"
                    stroke="#E8F3FF"
                    strokeOpacity=".62"
                    strokeWidth="2.3"
                  />
                  <g fill="url(#rf-logo-d-row)">
                    <g transform="translate(320 182) rotate(8)">
                      <rect width="104" height="13" rx="6.5" />
                    </g>
                    <g transform="translate(306 216) rotate(8)">
                      <rect width="102" height="13" rx="6.5" />
                    </g>
                    <g transform="translate(290 251) rotate(8)">
                      <rect width="103" height="13" rx="6.5" />
                    </g>
                    <g transform="translate(274 285) rotate(9)">
                      <rect width="102" height="13" rx="6.5" />
                    </g>
                    <g transform="translate(266 319) rotate(10)">
                      <rect width="95" height="13" rx="6.5" />
                    </g>
                    <g transform="translate(250 353) rotate(11)">
                      <rect width="95" height="13" rx="6.5" />
                    </g>
                    <g transform="translate(235 385) rotate(12)">
                      <rect width="95" height="13" rx="6.5" />
                    </g>
                  </g>
                  <rect
                    width="81"
                    height="18"
                    rx="6"
                    transform="translate(361 142) rotate(7) skewX(-15)"
                    fill="url(#rf-logo-d-pill)"
                    stroke="#F5953D"
                  />
                </g>
              </g>
            </g>
          </g>

          {/* 浅色符号：光晕 + 星（同一组，位移/缩放/透明度必然同步） */}
          <g className="rf-logo-layer rf-logo-layer-light rf-logo-symbol">
            <ellipse cx="258" cy="239" rx="114" ry="106" fill="url(#rf-logo-halo)" />
            <use
              href="#rf-logo-star-shape"
              transform="translate(258 239) scale(1.31) translate(-258 -239)"
              fill="#FFF5D6"
              fillOpacity=".68"
              stroke="#FFF9E5"
              strokeOpacity=".63"
              strokeWidth="19"
              strokeLinejoin="round"
            />
            <use
              href="#rf-logo-star-shape"
              fill="url(#rf-logo-star)"
              stroke="#FFF8E3"
              strokeWidth="2"
            />
            <path
              d="M255 217Q260 210 264 217L268 225Q269 227 272 228L279 229Q285 230 281 236L274 241Q272 243 272 246L272 254Q273 260 267 258L260 253Q257 251 254 252L244 256Q238 258 239 252L242 244Q243 242 241 240L235 233Q231 228 237 226L247 225Q250 224 255 217Z"
              fill="#FEF4D9"
              stroke="#FFFDF1"
              strokeWidth="1.3"
            />
          </g>

          {/* 深色符号：光晕 + 月牙 */}
          <g className="rf-logo-layer rf-logo-layer-dark rf-logo-symbol">
            <ellipse cx="256" cy="239" rx="114" ry="106" fill="url(#rf-logo-d-halo)" />
            <use
              href="#rf-logo-crescent-shape"
              transform="translate(264 236) scale(1.39) translate(-258 -239)"
              fill="#FFE0A3"
              fillOpacity=".22"
              stroke="#FFE7B9"
              strokeOpacity=".19"
              strokeWidth="10"
              strokeLinejoin="round"
            />
            <use
              href="#rf-logo-crescent-shape"
              transform="translate(264 236) scale(1.20) translate(-258 -239)"
              fill="#FEC76F"
              fillOpacity=".32"
              stroke="#FFD38A"
              strokeOpacity=".24"
              strokeWidth="6"
              strokeLinejoin="round"
            />
            <use
              href="#rf-logo-crescent-shape"
              transform="translate(6 -3)"
              fill="url(#rf-logo-d-crescent)"
              stroke="#FFE1A4"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path
              d="M264 184 C241 189 221 204 212 224 C203 245 210 269 221 279"
              transform="translate(6 -3)"
              fill="none"
              stroke="#FFFBEA"
              strokeOpacity=".78"
              strokeWidth="2.3"
              strokeLinecap="round"
            />
          </g>
        </g>
      </g>
    </svg>
  );
}
