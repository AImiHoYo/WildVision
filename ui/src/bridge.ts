import type { ApiResult } from "./types";

type DesktopApi = Record<
  string,
  (...args: unknown[]) => Promise<ApiResult> | ApiResult
>;

declare global {
  interface Window {
    pywebview?: { api?: DesktopApi };
  }
}

export function onReady(callback: () => void): void {
  if (window.pywebview?.api) {
    callback();
    return;
  }
  window.addEventListener("pywebviewready", () => callback(), { once: true });
}

async function waitForMethod(
  name: string,
  timeoutMs = 10000,
): Promise<DesktopApi[string] | undefined> {
  // WKWebView can create the API object before registering its callable methods.
  // Waiting only for the object lets the initial get_state request fail permanently.
  const start = performance.now();
  do {
    const method = window.pywebview?.api?.[name];
    if (typeof method === "function") return method;
    await new Promise((resolve) => window.setTimeout(resolve, 60));
  } while (performance.now() - start < timeoutMs);
  return undefined;
}

export async function call(
  name: string,
  ...args: unknown[]
): Promise<ApiResult> {
  const method = await waitForMethod(name);
  if (typeof method !== "function") {
    return {
      ok: false,
      message: `正在准备功能模块 (${name})，请重启 WildVision.app 后重试。`,
    };
  }
  return await method(...args);
}
