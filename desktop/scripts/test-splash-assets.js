// SPDX-License-Identifier: Apache-2.0
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const SPLASH = path.join(__dirname, "../splash.html");

/**
 * splash 有两个内联 <script>：head 里那段只决定预载哪一枚图标（WF-20 的
 * `?theme=` 分流），body 末尾那段才是页面逻辑。断言页面逻辑时必须取**最后**一段，
 * 否则取到的是主题分流脚本（它不碰文案，用例会全部读到空串）。
 */
function mainScript(source) {
  const blocks = source.split("<script>").slice(1).map((chunk) => chunk.split("</script>")[0]);
  const block = blocks.find((chunk) => chunk.includes("prefersChinese"));
  assert.ok(block, "splash must keep its main inline script");
  return block;
}

/** 在 vm 里跑一遍 splash 的内联脚本，返回被改写的节点、document 与 onStage 入口。 */
function runSplash(navigatorStub) {
  const source = fs.readFileSync(SPLASH, "utf8");
  const script = mainScript(source);
  const nodes = new Map();
  const document = {
    title: "",
    documentElement: { getAttribute: () => null, setAttribute: () => {} },
    getElementById: (id) => {
      if (!nodes.has(id)) {
        nodes.set(id, {
          textContent: "",
          alt: "",
          src: null,
          style: {},
          classList: { add() {}, remove() {} },
          addEventListener() {},
          removeEventListener() {},
        });
      }
      return nodes.get(id);
    },
  };
  let onStage = null;
  vm.runInNewContext(script, {
    document,
    window: {
      splash: {
        onStage(handler) {
          onStage = handler;
        },
      },
    },
    navigator: navigatorStub,
  });
  return {
    document,
    nodes,
    text: (id) => nodes.get(id).textContent,
    /** 主进程推一个阶段给页面（splash-preload 的契约：{ stage, detail }）。 */
    emit: (payload) => onStage(payload),
  };
}

test("splash loads English copy in the static markup", () => {
  const source = fs.readFileSync(SPLASH, "utf8");
  // 静态 HTML 是"非中文环境的第一帧"，也是 CI 截图能拍到的最小实现：JS 还没跑起来时
  // 它必须已经是英文，否则中文环境之外的启动画面会先闪一段中文。这 5 处只能读**原始
  // 文件文本**来断言——vm 用例里的假 `getElementById` 会自动造节点，永远看不到默认文本。
  const expected = [
    ["<title>ResumeForge</title>", "title"],
    ['<h1 id="app-name">ResumeForge</h1>', "heading"],
    ['class="subtitle">AI-tailored resumes · local workbench</div>', "subtitle"],
    ['<img id="logo" class="logo" alt="ResumeForge" />', "logo alt text"],
    ['id="stage" class="stage">Starting…</div>', "stage"],
  ];
  for (const [markup, what] of expected) {
    assert.ok(source.includes(markup), `the static splash ${what} must ship in English`);
  }
  assert.match(source, /<html lang="[a-z]{2}/, "the document must declare a language");
  assert.doesNotMatch(
    source,
    /<html lang="zh-CN"/,
    "the page language must follow the system language, not be pinned to Chinese",
  );
});

test("splash copy follows the system language", () => {
  const english = runSplash({ languages: ["en-US"], language: "en-US" });
  assert.strictEqual(english.text("app-name"), "ResumeForge");
  assert.strictEqual(english.document.title, "ResumeForge");
  assert.strictEqual(english.document.documentElement.lang, "en");
  assert.strictEqual(english.text("stage"), "Starting…");
  assert.strictEqual(english.text("subtitle"), "AI-tailored resumes · local workbench");
  assert.strictEqual(english.nodes.get("logo").alt, "ResumeForge");

  const chinese = runSplash({ languages: ["zh-CN"], language: "zh-CN" });
  assert.strictEqual(chinese.text("app-name"), "简历通");
  assert.strictEqual(chinese.document.title, "简历通");
  assert.strictEqual(chinese.document.documentElement.lang, "zh-CN");
  assert.strictEqual(chinese.text("stage"), "正在启动…");
  assert.strictEqual(chinese.text("subtitle"), "AI 定制化简历生成 · 本地工作台");
  assert.strictEqual(chinese.nodes.get("logo").alt, "简历通");

  // 非中文（含 C locale，AppImage 目录的收录测试就在这种环境里截图）一律英文。
  const cLocale = runSplash({ languages: ["C"], language: "C" });
  assert.strictEqual(cLocale.text("app-name"), "ResumeForge");
  assert.strictEqual(cLocale.text("stage"), "Starting…");
  assert.strictEqual(cLocale.document.title, "ResumeForge");
});

test("every stage and the failure notice are localized in both languages", () => {
  const stages = {
    en: {
      "preparing-runtime": "Preparing runtime (first launch)…",
      "backend-starting": "Starting the backend service…",
      "health-check": "Waiting for the service…",
      "ready": "Loading the interface…",
      "backend-restarting": "Service interrupted, recovering…",
    },
    zh: {
      "preparing-runtime": "正在准备运行环境（首次启动）…",
      "backend-starting": "正在启动后端服务…",
      "health-check": "正在等待服务就绪…",
      "ready": "正在加载界面…",
      "backend-restarting": "服务中断，正在自动恢复…",
    },
  };
  const systems = {
    en: { languages: ["en-US"], language: "en-US" },
    zh: { languages: ["zh-CN"], language: "zh-CN" },
  };
  // 中文侧必须真的是中文、英文侧必须一个 CJK 都不带：这条与"逐字相等"互为补强——
  // 有人把某一侧的文案复制成另一侧时，相等断言可能仍然过，CJK 断言一定红。
  const hasCjk = (text) => /[\u4e00-\u9fff]/.test(text);
  for (const language of ["en", "zh"]) {
    const splash = runSplash(systems[language]);
    // 每条阶段文案都要有断言：漏一条时它会在界面上渲染成 undefined。
    for (const [stage, expected] of Object.entries(stages[language])) {
      splash.emit({ stage });
      assert.strictEqual(splash.text("stage"), expected, `${language} copy for stage ${stage}`);
      assert.strictEqual(
        hasCjk(splash.text("stage")),
        language === "zh",
        `stage ${stage} must be ${language === "zh" ? "Chinese" : "free of CJK"}`,
      );
    }
    // 未知阶段不能吞掉信息：原样显示 stage id 而不是空白。
    splash.emit({ stage: "some-new-stage" });
    assert.strictEqual(splash.text("stage"), "some-new-stage");
    // 启动失败是 CI 最容易拍到的画面，中英两套都要真的存在。
    splash.emit({ stage: "error", detail: "boom" });
    const headline = splash.text("stage");
    assert.strictEqual(headline, language === "en" ? "Startup failed" : "启动失败");
    assert.strictEqual(hasCjk(headline), language === "zh", `${language} failure headline`);
    assert.strictEqual(splash.text("error"), "boom", "the failure detail is shown verbatim");
  }
});

test("splash only chooses controlled icon paths and falls back to packaged extraResources", () => {
  const source = fs.readFileSync(SPLASH, "utf8");
  const script = mainScript(source);

  /** 跑一遍页面脚本，返回该次运行里 logo 被赋的 src 序列。 */
  const runWith = (search) => {
    const seen = [];
    const listeners = new Map();
    const element = { style: {}, classList: { add() {}, remove() {} } };
    const logo = {
      get src() {
        return seen.length ? seen[seen.length - 1] : null;
      },
      set src(value) {
        seen.push(value);
      },
      addEventListener: (name, handler) => listeners.set(name, handler),
      removeEventListener: (name) => listeners.delete(name),
    };
    vm.runInNewContext(script, {
      document: {
        getElementById: (name) => (name === "logo" ? logo : element),
        documentElement: { getAttribute: () => (search.includes("theme=dark") ? "dark" : null) },
      },
      window: { splash: { onStage() {} } },
      location: { search },
    });
    return { seen, listeners, logo };
  };

  // 浅色 / 未知参数：仍然只请求受控的 icon-intro.svg（参数里的任意路径不能被当成图标）。
  const light = runWith("?icon=javascript:synthetic-untrusted");
  assert.equal(light.seen[0], "icon-intro.svg", "the intro animation is the only icon the splash asks for");
  assert.equal(typeof light.listeners.get("error"), "function");
  light.listeners.get("error")();
  assert.equal(light.seen[light.seen.length - 1], "../icon.png", "the controlled extraResources asset exists outside app.asar");
  assert.equal(light.listeners.has("error"), false, "a missing extra resource must not cause an error loop");

  // 暗色（WF-20）：换成同结构的暗色矢量，失败仍退回同一张 PNG。
  const dark = runWith("?theme=dark");
  assert.equal(dark.seen[0], "icon-intro-dark.svg", "dark theme must ask for the dark intro animation");
});

test("the animated intro SVG actually ships with the package", () => {
  const splash = fs.readFileSync(SPLASH, "utf8");
  // 预载标签由 head 里那段脚本按 ?theme= 动态插入（浅色 / 暗色各一枚），
  // 所以断言的是脚本真的会按主题选，而不是某个硬编码的 <link>。
  assert.ok(
    splash.includes('link.rel = "preload"') && splash.includes("icon-intro.svg"),
    "the splash must preload the animated icon before the main script assigns it",
  );
  assert.ok(
    fs.existsSync(path.join(__dirname, "../icon-intro.svg")),
    "desktop/icon-intro.svg must exist next to splash.html",
  );
  assert.ok(
    fs.existsSync(path.join(__dirname, "../icon-intro-dark.svg")),
    "desktop/icon-intro-dark.svg must exist next to splash.html (WF-20)",
  );

  // electron-builder 的 files: 漏了这一行 → 打包后 <img src> 404，动画静默退回静态 PNG，
  // 看起来就像"动画没做"。
  //
  // 另一半是实测踩到的坑（2026-11-19，--win --dir）：extraResources: 里的匹配项会被
  // electron-builder 当成 app 文件的 exclusion（platformPackager.js 的 excludePatterns），
  // **连 files: 里那一行都会被吃掉**——icon-intro.svg 出现在 resources/ 却不在 app.asar 内，
  // splash.html 在 asar 根目录，相对路径直接 404。所以这条素材只能留在 asar 里。
  const manifest = fs.readFileSync(path.join(__dirname, "../electron-builder.yml"), "utf8");
  const [beforeExtra, ...afterExtra] = manifest.split(/^extraResources:\s*$/m);
  const filesBlock = beforeExtra.slice(beforeExtra.search(/^files:\s*$/m));
  for (const asset of ["icon-intro\\.svg", "icon-intro-dark\\.svg"]) {
    assert.match(
      filesBlock,
      new RegExp(`^\\s+-\\s+${asset}\\s*$`, "m"),
      `electron-builder.yml files: must list ${asset}`,
    );
    assert.doesNotMatch(
      afterExtra.join("\n"),
      new RegExp(`^\\s+- from: ${asset}\\s*$`, "m"),
      `${asset} must not move to extraResources: that silently evicts it from app.asar`,
    );
  }
});
