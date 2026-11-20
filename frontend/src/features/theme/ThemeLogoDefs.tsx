// SPDX-License-Identifier: Apache-2.0
/**
 * 品牌图的内联素材定义（`<defs>`）：渐变、投影滤镜与裁剪路径。
 *
 * 为什么单独一个文件：`ThemeLogo` 已经贴着 500 行预算，而这一段是**纯静态标记**——
 * 不引用任何 props、状态或主题值。抽出来不改变渲染结果（`<defs>` 不产生可见节点，
 * 内部 id 仍是全局唯一的那一套），只是把"素材"与"动画逻辑"分开：下次改配色时不必
 * 在 500 行里翻，改图层时也不必担心碰到渐变。
 */
export default function ThemeLogoDefs() {
  return (
    <defs>
      {/* 浅色（星） */}
      <linearGradient id="rf-logo-plate" x2="20%" y2="100%">
        <stop stopColor="#DCEBF8" />
        <stop offset="1" stopColor="#C1DBF6" />
      </linearGradient>
      <radialGradient id="rf-logo-plate-light" cx="15%" cy="20%" r="78%">
        <stop stopColor="#E2EEF8" />
        <stop offset="1" stopColor="#D2E8FD" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="rf-logo-cover" x1="14%" y1="12%" x2="87%" y2="94%">
        <stop stopColor="#ABD3F6" />
        <stop offset=".43" stopColor="#7EB8F6" />
        <stop offset=".72" stopColor="#539BEA" />
        <stop offset="1" stopColor="#99C7F6" />
      </linearGradient>
      <linearGradient
        id="rf-logo-left-paper"
        gradientUnits="userSpaceOnUse"
        x1="135"
        y1="132"
        x2="336"
        y2="275"
      >
        <stop stopColor="#FBFCFC" />
        <stop offset=".76" stopColor="#F0F6FB" />
        <stop offset="1" stopColor="#E1ECF9" />
      </linearGradient>
      <linearGradient
        id="rf-logo-right-paper"
        gradientUnits="userSpaceOnUse"
        x1="390"
        y1="120"
        x2="223"
        y2="475"
      >
        <stop stopColor="#FEFDFC" />
        <stop offset="1" stopColor="#F5F9FB" />
      </linearGradient>
      <linearGradient id="rf-logo-fold" x2="65%" y2="100%">
        <stop stopColor="#E6EFF9" stopOpacity=".53" />
        <stop offset="1" stopColor="#FDFDFC" stopOpacity="0" />
      </linearGradient>
      <linearGradient id="rf-logo-row" x2="100%" y2="100%">
        <stop stopColor="#C9E1F7" />
        <stop offset="1" stopColor="#BBD8F3" />
      </linearGradient>
      <linearGradient id="rf-logo-photo" x2="100%" y2="100%">
        <stop stopColor="#BAD8F4" />
        <stop offset="1" stopColor="#B4D3F3" />
      </linearGradient>
      <linearGradient id="rf-logo-pill" x2="100%" y2="100%">
        <stop stopColor="#FDB35B" />
        <stop offset="1" stopColor="#FDA349" />
      </linearGradient>
      <linearGradient id="rf-logo-star" x2="25%" y2="100%">
        <stop stopColor="#FEC762" />
        <stop offset="1" stopColor="#FEAD53" />
      </linearGradient>
      <radialGradient id="rf-logo-halo">
        <stop offset=".37" stopColor="#FFF2B2" stopOpacity=".88" />
        <stop offset=".67" stopColor="#FFD28B" stopOpacity=".3" />
        <stop offset="1" stopColor="#FFD28B" stopOpacity="0" />
      </radialGradient>
      <filter
        id="rf-logo-cover-shadow"
        x="-24%"
        y="-24%"
        width="150%"
        height="157%"
        colorInterpolationFilters="sRGB"
      >
        <feDropShadow dx="-1" dy="23" stdDeviation="22" floodColor="#3983CC" floodOpacity=".24" />
      </filter>
      <filter
        id="rf-logo-book-shadow"
        x="-16%"
        y="-16%"
        width="135%"
        height="139%"
        colorInterpolationFilters="sRGB"
      >
        <feDropShadow dx="1" dy="6" stdDeviation="11" floodColor="#5193D8" floodOpacity=".19" />
      </filter>
      <clipPath id="rf-logo-safe">
        <rect x="32" y="32" width="448" height="448" />
      </clipPath>
      <clipPath id="rf-logo-plate-clip">
        <rect width="512" height="512" rx="57" />
      </clipPath>
      <clipPath id="rf-logo-left-leaf">
        <path d="M326 100 C289 79 223 57 194 46 C183 42 173 47 168 59 C135 144 87 246 35 335 C29 346 34 356 43 360 C98 384 149 395 186 431 C237 337 291 211 326 100 Z" />
      </clipPath>
      <clipPath id="rf-logo-right-leaf">
        <path d="M326 100 C379 107 431 111 464 116 C476 118 482 128 478 139 C437 245 388 355 335 454 C330 464 320 469 310 466 C268 455 221 440 186 431 C237 337 291 211 326 100 Z" />
      </clipPath>
      <path
        id="rf-logo-star-shape"
        d="M254 194C259 187 267 187 271 194L279 209Q281 213 288 215L304 219C314 222 315 231 306 238L291 249Q287 252 288 258L289 273C290 282 283 288 274 283L260 274Q255 270 249 273L229 280C220 283 213 278 216 269L221 254Q223 248 219 244L209 232C202 223 207 215 217 214L235 212Q240 212 243 207Z"
      />

      {/* 深色（月） */}
      <linearGradient id="rf-logo-d-plate" x2="20%" y2="100%">
        <stop stopColor="#2D425D" />
        <stop offset="1" stopColor="#172235" />
      </linearGradient>
      <radialGradient id="rf-logo-d-plate-light" cx="15%" cy="20%" r="78%">
        <stop stopColor="#3A536F" />
        <stop offset="1" stopColor="#2D455F" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="rf-logo-d-cover" x1="14%" y1="12%" x2="87%" y2="94%">
        <stop stopColor="#426D9E" />
        <stop offset=".43" stopColor="#3B6797" />
        <stop offset=".72" stopColor="#234A7B" />
        <stop offset="1" stopColor="#325B84" />
      </linearGradient>
      <linearGradient
        id="rf-logo-d-left-paper"
        gradientUnits="userSpaceOnUse"
        x1="135"
        y1="132"
        x2="336"
        y2="275"
      >
        <stop stopColor="#B6CBDE" />
        <stop offset=".76" stopColor="#AFC2D8" />
        <stop offset="1" stopColor="#90AAC4" />
      </linearGradient>
      <linearGradient
        id="rf-logo-d-right-paper"
        gradientUnits="userSpaceOnUse"
        x1="390"
        y1="120"
        x2="223"
        y2="475"
      >
        <stop stopColor="#D8E6F2" />
        <stop offset="1" stopColor="#ACBED1" />
      </linearGradient>
      <linearGradient id="rf-logo-d-row" x2="100%" y2="100%">
        <stop stopColor="#657F9C" />
        <stop offset="1" stopColor="#546F8E" />
      </linearGradient>
      <linearGradient id="rf-logo-d-photo" x2="100%" y2="100%">
        <stop stopColor="#6888A9" />
        <stop offset="1" stopColor="#527293" />
      </linearGradient>
      <linearGradient id="rf-logo-d-pill" x2="100%" y2="100%">
        <stop stopColor="#FDB35B" />
        <stop offset="1" stopColor="#FDA349" />
      </linearGradient>
      <linearGradient id="rf-logo-d-crescent" x1="12%" y1="0" x2="82%" y2="100%">
        <stop stopColor="#FFF6D9" />
        <stop offset=".54" stopColor="#FCE2A5" />
        <stop offset="1" stopColor="#E5AE58" />
      </linearGradient>
      <radialGradient id="rf-logo-d-halo">
        <stop stopColor="#FFE3A1" stopOpacity=".43" />
        <stop offset=".58" stopColor="#F2C675" stopOpacity=".16" />
        <stop offset="1" stopColor="#E59A50" stopOpacity="0" />
      </radialGradient>
      <filter
        id="rf-logo-d-cover-shadow"
        x="-24%"
        y="-24%"
        width="150%"
        height="157%"
        colorInterpolationFilters="sRGB"
      >
        <feDropShadow dx="-1" dy="23" stdDeviation="22" floodColor="#080F1A" floodOpacity=".24" />
      </filter>
      <filter
        id="rf-logo-d-book-shadow"
        x="-16%"
        y="-16%"
        width="135%"
        height="139%"
        colorInterpolationFilters="sRGB"
      >
        <feDropShadow dx="1" dy="6" stdDeviation="11" floodColor="#080F1A" floodOpacity=".19" />
      </filter>
      <path
        id="rf-logo-crescent-shape"
        d="M279 181 C249 175 220 191 207 219 C193 249 206 281 234 294 C264 308 298 297 315 269 Q317 266 313 268 C289 276 265 265 253 246 C240 225 250 197 279 183 Q282 182 279 181 Z"
      />
    </defs>
  );
}
