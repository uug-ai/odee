import type { APIRequestContext, APIResponse, Browser, BrowserType } from '@playwright/test'

export interface LocalTransport {
  proxy: { server: string; bypass: string }
  denied: { method: string; target: string }[]
  connections: string[]
  allowOrigin(origin: string): () => void
  assertAllowed(url: string): URL
  launch(chromium: BrowserType<Browser>): Promise<Browser>
  fetch(
    context: APIRequestContext,
    url: string,
    options?: Parameters<APIRequestContext['fetch']>[1],
  ): Promise<APIResponse>
  health(url: string): Promise<Response>
  close(): Promise<void>
}

export function createLocalTransport(origins?: string[]): Promise<LocalTransport>
