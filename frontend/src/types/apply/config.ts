import type { BrowserState } from "./tasks";

// ===== ⑤ 配置 =====

/**
 * 投递专用浏览器的选择方式。
 * `auto` = 自动（优先 Chrome，未装回退 Edge）；`custom` = 用下面填的自定义路径。
 */
export type BrowserChoice = "auto" | "chrome" | "edge" | "custom";

export const BROWSER_CHOICE_META: Record<BrowserChoice, { label: string; hint: string }> = {
  auto: { label: "自动（优先 Chrome）", hint: "优先用 Chrome；没装 Chrome 时自动回退 Edge。" },
  chrome: { label: "Google Chrome", hint: "只用 Chrome；找不到会明确提示，不会改用别的浏览器。" },
  edge: { label: "Microsoft Edge", hint: "只用 Edge；找不到会明确提示，不会改用别的浏览器。" },
  custom: {
    label: "自定义路径",
    hint: "填写浏览器可执行文件的完整路径（必须真实存在）。",
  },
};

export interface ApplyConfig {
  interval_seconds: number;
  interval_jitter_seconds: number;
  daily_limit: number;
  per_task_limit: number;
  breaker_threshold: number;
  default_greeting: string;
  skip_same_company: boolean;
  confirm_real_gap: boolean;
  browser_port: number;
  /** 投递台使用的浏览器：自动 / Chrome / Edge / 自定义路径。 */
  browser_choice: BrowserChoice;
  /** 自定义浏览器可执行文件的绝对路径，仅 browser_choice=custom 时生效。 */
  browser_path: string;
  /** 当前对接的招聘网站（站点适配器 key），默认取后端注册表里的第一个站点。 */
  site_key: string;
}

export interface ApplyConfigOut extends ApplyConfig {
  defaults: ApplyConfig;
}

export interface CollectConfig {
  keywords: string[];
  city: string;
  salary_min: number | null;
  experience: string;
  education: string;
  per_task_limit: number;
  interval_seconds: number;
  interval_jitter_seconds: number;
  /** 采集结果标注类型（校招/实习/社招）；可空=不限。只入库标注，不参与站点筛选与去重。 */
  job_type: string;
  /**
   * **站点侧筛选项**：`{分组 key: 选项编码}`（如 `{ degree: "203" }`）。
   *
   * 与上面 `salary_min` / `experience` / `education` 的分工：那三个筛的是"你的条件 vs
   * 岗位要求"（"我是本科"），这一份是**招聘网站筛选栏本身**（"岗位要求本科"）。
   * 选项清单由后端从站点读来（见 `CollectFilterOptions`），这里只存用户选中的编码。
   */
  filters: Record<string, string>;
}

export interface CollectConfigOut extends CollectConfig {
  defaults: CollectConfig;
}

/** 筛选项清单的来源：登录会话 / 全网通用 / 内置快照 / 读不到。 */
export type CollectFilterSource = "session" | "public" | "snapshot" | "unavailable";

export interface CollectFilterOption {
  code: string;
  label: string;
  /** 只用于界面分组（行业有 15 个一级分组），其余为空。 */
  group: string;
}

export interface CollectFilterGroup {
  key: string;
  /** 拼进搜索地址的参数名（由后端实测站点得到，前端不该自己拼）。 */
  param: string;
  label: string;
  options: CollectFilterOption[];
  source: CollectFilterSource;
  note: string;
}

export interface CollectFilterOptions {
  site_key: string;
  display_name: string;
  groups: CollectFilterGroup[];
  /** 是否读到了"你这个登录账号可见"的清单；false 表示用的是全网通用清单。 */
  session_read: boolean;
}

/** 「测试筛选是否实际生效」的单项结论。 */
export interface CollectFilterTestItem {
  key: string;
  /** 分组的人话名称（如「学历要求」）；站点清单里已没有这个分组时回退为分组 key。 */
  label: string;
  /** 用户选的选项文案（清单里找不到该选项时回退为原始编码）。 */
  value: string;
  /** 给用户看的一句话说明。 */
  detail: string;
}

export interface CollectFilterTestResult {
  /** 能在站点上真实选到的项。 */
  applied: CollectFilterTestItem[];
  /** 选不到的项（站点改版 / 仅部分账号可见）。 */
  unapplied: CollectFilterTestItem[];
  /** 选的是「不限」——不会向站点发送该参数。 */
  unlimited: CollectFilterTestItem[];
}

// ===== ⑥ 浏览器状态 =====
export interface BrowserStatus {
  state: BrowserState;
  port: number;
  profile_dir: string;
  browser_path: string;
  /** 人类可读的浏览器名（Google Chrome / Microsoft Edge / 自定义浏览器）。 */
  browser_name: string;
  /** 启动浏览器时会打开的站点入口地址，也用于「打开招聘网站」按钮。 */
  entry_url: string;
  logged_in_hint: string;
  /**
   * 这个浏览器是不是**本次运行**启动的。
   *
   * 为 false 表示它是上一次运行时打开的窗口：`state` 照样是 `running`（调试端口在答，
   * 采集与投递都能用），但「关闭浏览器」关不掉它——进程句柄随后端重启丢了，而应用
   * 只关自己拉起的进程，绝不按 PID 去猜。
   */
  owned: boolean;
}
