import type { Checks, CityBlueprint } from "@city-building/shared";

export interface ActionContext {
  apiKey: string;
  serverUrl: string;
  checks: Checks | null;
}

export interface PushClient {
  pushBlueprint(serverUrl: string, apiKey: string, blueprint: CityBlueprint): Promise<{ ok: boolean }>;
}

export async function runSyncAction(
  context: ActionContext,
  blueprint: CityBlueprint,
  client: PushClient,
): Promise<{ ok: boolean; serverUrl: string; hash: string }> {
  const payload: CityBlueprint = {
    ...blueprint,
    checks: context.checks,
  };
  await client.pushBlueprint(context.serverUrl, context.apiKey, payload);
  return { ok: true, serverUrl: context.serverUrl, hash: payload.hash };
}
