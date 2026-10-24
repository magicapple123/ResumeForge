// SPDX-License-Identifier: Apache-2.0
/**
 * 资产库的**离线样例**（W17-FE 在 W17-BE 就绪前用它开发与演示）。
 *
 * 纪律：样例是**虚构**内容，且这里是 `src/` 下的源码（不是 `demo/` 目录），
 * 所以正文一律用英文——中文样本会撞 `cjkRatchet`（新增文件基线 0）。真实中文表达
 * 由用户自己收藏，不进仓库。
 *
 * 接入真实 API 后本文件只保留给测试/演示宿主使用：生产路径由 `features/resume-assets/api.ts`
 * 提供（W17-BE 就绪时新增），组件本身不认数据来源。
 */
import type { ResumePhrase } from "./types";

/** 一组覆盖四种类型、三种来源、两种语言的样例。 */
export const MOCK_PHRASES: ResumePhrase[] = [
  {
    id: 1,
    text: "Led the checkout rewrite that cut p95 latency from 800ms to 210ms.",
    kind: "achievement",
    language: "en-US",
    job_tags: ["backend", "performance"],
    source_claim_id: 12,
    source_resume_id: 3,
    source_object_id: "exp_7f3a91c2",
    quality_note: "Concrete number plus the before/after pair.",
    usage_count: 6,
    last_used_at: "2026-10-20T09:00:00Z",
    created_at: "2026-09-01T09:00:00Z",
  },
  {
    id: 2,
    text: "Built a replayable migration checklist adopted by three teams.",
    kind: "method",
    language: "en-US",
    job_tags: ["platform", "process"],
    source_claim_id: null,
    source_resume_id: 3,
    source_object_id: "prj_1a2b3c4d",
    quality_note: "Shows influence beyond one team.",
    usage_count: 2,
    last_used_at: "2026-10-12T09:00:00Z",
    created_at: "2026-09-10T09:00:00Z",
  },
  {
    id: 3,
    text: "Owned on-call rotation for 12 services and reduced alerts by 40%.",
    kind: "result",
    language: "en-US",
    job_tags: ["sre", "backend"],
    source_claim_id: 18,
    source_resume_id: null,
    source_object_id: null,
    quality_note: "Ownership plus a measured outcome.",
    usage_count: 4,
    last_used_at: "2026-10-18T09:00:00Z",
    created_at: "2026-08-20T09:00:00Z",
  },
  {
    id: 4,
    text: "Backend engineer focused on payment reliability and developer tooling.",
    kind: "summary",
    language: "en-US",
    job_tags: ["backend"],
    source_claim_id: null,
    source_resume_id: null,
    source_object_id: null,
    quality_note: "Reusable opening line for platform roles.",
    usage_count: 0,
    last_used_at: null,
    created_at: "2026-10-01T09:00:00Z",
  },
  {
    id: 5,
    text: "Ran weekly design reviews that shortened the spec-to-ship loop.",
    kind: "custom",
    language: "",
    job_tags: ["collaboration"],
    source_claim_id: 21,
    source_resume_id: 5,
    source_object_id: "exp_9a8b7c6d",
    quality_note: "Process improvement without claiming a hard number.",
    usage_count: 1,
    last_used_at: "2026-09-28T09:00:00Z",
    created_at: "2026-09-15T09:00:00Z",
  },
];
