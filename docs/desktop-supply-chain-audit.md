# 桌面依赖供应链审计与豁免基线（2026-10-13，生产审计 PR-06）

## 范围与结论

对 `desktop/` 运行 `npm audit`（registry.npmjs.org，2026-10-13）：**19 个受影响包条目**
（4 moderate / 14 high / 1 critical，critical 为 `tar`）。

**结论：本轮不升级任何依赖版本，全部 19 条登记为带到期日的豁免（waiver）。** 依据：

- 每一条的 `fixAvailable` 都是 **semver-major** 升级（`electron ^33.0.0 → 44.7.0`、
  `electron-builder ^25.1.8 → 26.15.3`）或依赖这两个升级间接达成——不存在"范围内安全升级"。
- `electron` 是桌面**运行内核**（在 devDependencies 里也一样是运行时组件），主版本升级需要完整回归
  （打包产物、托盘、splash、更新器、CI 真启动冒烟），不能顺手做。
- `electron-builder` 26 改变打包行为（配置 schema、产物命名、ASAR 布局），需要维护者过目 CI 的
  `desktop-shell` + `desktop-shell-smoke` 全链路后再切。
- `tar`（critical，12 条公告）安装为 6.2.1，被 `node-gyp@9` 的 `^6.1.2` 钉死；修复线在 7.5.21+，
  不可达。tar 只在**构建期**（依赖安装时解包）被使用，**不进 app.asar、不进 payload**，运行时无暴露面。
- `npm audit fix` / `audit fix --force` 被审计规则禁止（会重写 node_modules / 强升主版本）。

## 门禁（CI 强制）

- 脚本：`desktop/scripts/check-npm-audit.js`（只读运行 `npm audit --json`，不改锁文件）。
- 基线：`desktop/scripts/audit-baseline.json`——逐包登记 severity、类别（runtime / build）、
  公告 id 清单、豁免决定与**到期日（`until`，当前为 2027-01-31）**。
- CI 的 `desktop-shell` 作业运行该门禁。以下情形**失败**：
  1. 出现基线之外的**新 critical/high** 受影响包；
  2. 已登记包出现**新公告 id**（新的 GHSA）；
  3. 已登记包的 severity **升级**（如 moderate → high）；
  4. 任何豁免**到期**（到期即失败，强制复审——不许无声续期）。
- 修复方式只有两种：真正升级，或在复审后更新基线（带新的到期日与理由）。放宽脚本本身不被接受。

## 逐条清单（19 条）

`runtime` = 随应用分发的 Electron 运行内核及其依赖；`build` = 仅构建/打包链使用，不进发布产物。

| 包 | 严重度 | 直接 | 类别 | 主公告 | 修复路径 | 决定 |
| --- | --- | --- | --- | --- | --- | --- |
| electron | high | 是 | runtime | 38 条 GHSA（ASAR integrity bypass、use-after-free、context isolation bypass 等；完整清单见基线 JSON） | electron 44.x（major） | 豁免至 2027-01-31，与 electron 44 评估合并推进 |
| @electron/get | moderate | 否 | runtime | （经由 global-agent） | electron 44.x | 豁免，随 electron 升级清除 |
| global-agent | moderate | 否 | runtime | （经由 roarr） | electron 44.x | 豁免，随 electron 升级清除 |
| roarr | moderate | 否 | runtime | （经由 sprintf-js） | electron 44.x | 豁免，随 electron 升级清除 |
| sprintf-js | moderate | 否 | runtime | [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) | electron 44.x | 豁免，随 electron 升级清除 |
| extract-zip | high | 否 | runtime | [GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv), [GHSA-7pqw-9j4j-h8q3](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3) | electron 44.x | 豁免（仅 Electron 自身更新路径使用） |
| electron-builder | high | 是 | build | （经由 app-builder-lib 链） | 26.15.3（major） | 豁免至 2027-01-31，需 CI 全链路复验后切换 |
| app-builder-lib | high | 否 | build | [GHSA-7g7r-gx96-252g](https://github.com/advisories/GHSA-7g7r-gx96-252g)（AppImage 搜索路径） | 26.15.3 | 豁免（本仓库不构建 AppImage） |
| builder-util-runtime | high | 否 | build | [GHSA-p2f4-r6v6-j797](https://github.com/advisories/GHSA-p2f4-r6v6-j797)（electron-updater 令牌泄漏） | 26.15.3 | 豁免（本仓库更新器为自研 updater.js，不经 electron-updater） |
| builder-util | high | 否 | build | （经由 builder-util-runtime） | 26.15.3 | 豁免 |
| @electron/rebuild | high | 否 | build | （经由 node-gyp/tar） | 26.15.3 | 豁免 |
| node-gyp | high | 否 | build | （经由 make-fetch-happen/tar） | 26.15.3 | 豁免 |
| make-fetch-happen | high | 否 | build | （经由 cacache） | 26.15.3 | 豁免 |
| cacache | high | 否 | build | （经由 tar） | 26.15.3 | 豁免 |
| tar | **critical** | 否 | build | 12 条 GHSA（路径穿越/任意文件覆盖/DoS；见基线 JSON） | tar 7.5.21+，被 node-gyp@9 ^6.1.2 阻断 → 实际路径为 electron-builder 26 | 豁免（仅构建期使用，不进发布产物；到期复审优先级最高） |
| glob | high | 否 | build | [GHSA-5j98-mcp5-4vw2](https://github.com/advisories/GHSA-5j98-mcp5-4vw2)（CLI `-c` 注入） | node-gyp 10+ / electron-builder 26 | 豁免（本仓库从不调用 glob CLI） |
| dmg-builder | high | 否 | build | （经由 app-builder-lib 链） | 26.15.3 | 豁免 |
| electron-builder-squirrel-windows | high | 否 | build | （经由 app-builder-lib 链） | 26.15.3 | 豁免（未使用的构建目标） |
| electron-publish | high | 否 | build | （经由 builder-util 链） | 26.15.3 | 豁免 |

## 后续动作

1. **到期前（2027-01-31）**：评估 electron 44 + electron-builder 26 的组合升级（两者应一起做：
   builder 26 的公告修复同样要求 electron 侧跟进）。升级 PR 必须附带 `desktop-shell` +
   `desktop-shell-smoke` 全绿的 CI 链接。
2. 任何**新** critical/high 公告出现时门禁立即变红，按上文"修复方式"处理。
3. `tar`（critical）虽为纯构建期依赖，仍列为复审时第一个解决项。
