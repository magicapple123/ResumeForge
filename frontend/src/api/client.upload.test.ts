/** uploadWithProgress：XHR 进度上传的契约测试（进度序列、错误口径、取消与预算）。 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, BUDGETS_MS, uploadWithProgress } from "./client";
import { clientDiagnosticSnapshot } from "../utils/clientDiagnostics";

/** 最小可用的 XHR 替身：记录 open/setRequestHeader/send，测试手动派发事件。 */
class FakeXHR {
  static instances: FakeXHR[] = [];
  upload = {
    onprogress: null as ((event: ProgressEvent) => void) | null,
    onload: null as (() => void) | null,
  };
  onload: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onerror: (() => void) | null = null;
  timeout = 0;
  status = 0;
  responseText = "";
  method = "";
  url = "";
  body: unknown = null;
  requestHeaders: Record<string, string> = {};
  sent = false;
  aborted = false;
  requestId: string | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(key: string, value: string) {
    // 与 fetch 规格一致：Headers 迭代出的名字是全小写；存储也统一小写便于断言。
    this.requestHeaders[key.toLowerCase()] = value;
  }
  abort() {
    if (this.aborted) return;
    this.aborted = true;
    this.onabort?.();
  }
  send(body: unknown) {
    this.sent = true;
    this.body = body;
    FakeXHR.instances.push(this);
  }
  getResponseHeader(name: string): string | null {
    return name === "x-request-id" ? this.requestId : null;
  }
  /** 测试辅助：模拟服务端响应（同步触发 onload）。 */
  respond(status: number, text: string, requestId: string | null = null) {
    this.status = status;
    this.responseText = text;
    this.requestId = requestId;
    this.onload?.();
  }
  /** 测试辅助：模拟一段上传字节进度。 */
  progress(loaded: number, total: number) {
    this.upload.onprogress?.(
      new ProgressEvent("progress", { loaded, total, lengthComputable: true }),
    );
  }
}

const lastXhr = () => FakeXHR.instances[FakeXHR.instances.length - 1]!;

beforeEach(() => {
  FakeXHR.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadWithProgress 请求形状", () => {
  it("POST 到 /api 前缀；JSON 字符串体自动补 application/json", async () => {
    const pending = uploadWithProgress("/profile/parse-text", JSON.stringify({ text: "x" }));
    const xhr = lastXhr();
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("/api/profile/parse-text");
    xhr.respond(200, JSON.stringify({ ok: true }));
    await expect(pending).resolves.toEqual({ ok: true });
    expect(xhr.requestHeaders["content-type"]).toBe("application/json");
  });

  it("FormData 体不预设 Content-Type（multipart boundary 由浏览器生成）", async () => {
    const pending = uploadWithProgress("/referrals/upload-image", new FormData());
    const xhr = lastXhr();
    xhr.respond(200, JSON.stringify({ path: "a.png" }));
    await pending;
    expect(xhr.requestHeaders["content-type"]).toBeUndefined();
  });

  it("调用方传的 Content-Type 优先于自动推断", async () => {
    const pending = uploadWithProgress("/assistant/skills/import", new Blob(["x"]), {
      headers: { "Content-Type": "application/zip" },
    });
    const xhr = lastXhr();
    xhr.respond(200, "{}");
    await pending;
    expect(xhr.requestHeaders["content-type"]).toBe("application/zip");
  });

  it("204 返回 undefined", async () => {
    const pending = uploadWithProgress("/example", new FormData());
    lastXhr().respond(204, "");
    await expect(pending).resolves.toBeUndefined();
  });

  it("默认预算是 upload 档（600s）", async () => {
    const pending = uploadWithProgress("/example", new FormData());
    expect(lastXhr().timeout).toBe(BUDGETS_MS.upload);
    lastXhr().respond(200, "{}");
    await pending;
  });
});

describe("uploadWithProgress 进度回调", () => {
  it("按上传字节比例推进，字节发完报 100", async () => {
    const percents: number[] = [];
    const pending = uploadWithProgress("/upload", JSON.stringify("x".repeat(100)), {
      onProgress: (percent) => percents.push(percent),
    });
    const xhr = lastXhr();
    xhr.progress(10, 100);
    xhr.progress(55, 100);
    xhr.progress(100, 100);
    xhr.upload.onload?.();
    xhr.respond(200, "{}");
    await pending;
    expect(percents).toEqual([10, 55, 100, 100]);
  });

  it("lengthComputable 为假或 total 为 0 时不报进度（不产生 NaN）", async () => {
    const percents: number[] = [];
    const pending = uploadWithProgress("/upload", new FormData(), {
      onProgress: (percent) => percents.push(percent),
    });
    const xhr = lastXhr();
    xhr.progress(10, 0);
    xhr.upload.onprogress?.(
      new ProgressEvent("progress", { loaded: 10, total: 0, lengthComputable: false }),
    );
    xhr.upload.onload?.();
    xhr.respond(200, "{}");
    await pending;
    expect(percents).toEqual([100]);
  });
});

describe("uploadWithProgress 错误口径", () => {
  it("非 2xx：detail 文本进 message，requestId 透传", async () => {
    const pending = uploadWithProgress("/example", "{}");
    lastXhr().respond(500, JSON.stringify({ detail: "识别失败" }), "req-77");
    const error = await pending.then(
      () => {
        throw new Error("should not resolve");
      },
      (e: ApiError) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe("识别失败");
    expect(error.status).toBe(500);
    expect(error.code).toBe("http");
    expect(error.requestId).toBe("req-77");
    expect(error.retryable).toBe(false);
  });

  it("错误体不是 JSON 时退回「请求失败（HTTP xxx）」", async () => {
    const pending = uploadWithProgress("/example", "{}");
    lastXhr().respond(502, "Bad Gateway");
    const error = await pending.then(
      () => {
        throw new Error("should not resolve");
      },
      (e: ApiError) => e,
    );
    expect(error.message).toBe("请求失败（HTTP 502）");
  });

  it("连接失败抛中文 network 提示，原始错误在 cause 上", async () => {
    const pending = uploadWithProgress("/example", "{}");
    lastXhr().onerror?.();
    const error = await pending.then(
      () => {
        throw new Error("should not resolve");
      },
      (e: ApiError) => e,
    );
    expect(error.message).toBe("无法连接本地服务，请确认应用已启动");
    expect(error.code).toBe("network");
    expect(error.retryable).toBe(false);
  });

  it("200 但响应体不是合法 JSON 按网络类失败提示", async () => {
    const pending = uploadWithProgress("/example", "{}");
    lastXhr().respond(200, "");
    const error = await pending.then(
      () => {
        throw new Error("should not resolve");
      },
      (e: ApiError) => e,
    );
    expect(error.code).toBe("network");
  });
});

describe("uploadWithProgress 取消与预算", () => {
  it("signal 已 aborted 时直接抛 cancelled，请求不发出", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await uploadWithProgress("/example", "{}", { signal: controller.signal }).then(
      () => {
        throw new Error("should not resolve");
      },
      (e: ApiError) => e,
    );
    expect(error.code).toBe("cancelled");
    expect(error.message).toBe("已取消");
    expect(FakeXHR.instances).toHaveLength(0);
  });

  it("调用方中途 abort 抛 cancelled，且不记诊断", async () => {
    const controller = new AbortController();
    const pending = uploadWithProgress("/example", "{}", { signal: controller.signal });
    const diagnosticsBefore = clientDiagnosticSnapshot().length;
    const xhr = lastXhr();
    controller.abort();
    const error = await pending.then(
      () => {
        throw new Error("should not resolve");
      },
      (e: ApiError) => e,
    );
    expect(error.code).toBe("cancelled");
    expect(xhr.aborted).toBe(true);
    expect(clientDiagnosticSnapshot().length).toBe(diagnosticsBefore);
  });

  it("预算到期（ontimeout）抛 timeout 并记诊断；xhr.timeout 取自预算档", async () => {
    const pending = uploadWithProgress("/example", "{}", { budget: "recognition" });
    const xhr = lastXhr();
    expect(xhr.timeout).toBe(BUDGETS_MS.recognition);
    const diagnosticsBefore = clientDiagnosticSnapshot().length;
    xhr.ontimeout?.();
    const error = await pending.then(
      () => {
        throw new Error("should not resolve");
      },
      (e: ApiError) => e,
    );
    expect(error.code).toBe("timeout");
    expect(error.message).toBe("请求超时，请重试");
    expect(error.retryable).toBe(false);
    expect(clientDiagnosticSnapshot().length).toBe(diagnosticsBefore + 1);
  });
});
