import { db } from "@/lib/db";

/**
 * Helpers for the anonymous per-browser state (likes, subscriptions, watch
 * history). The browser generates a random `browserId` on first visit and
 * sends it with every state-changing request.
 */

export async function getUserState(browserId: string) {
  let state = await db.userState.findUnique({ where: { browserId } });
  if (!state) {
    state = await db.userState.create({ data: { browserId } });
  }
  return state;
}

export function parseList(s: string): string[] {
  return s ? s.split("|").filter(Boolean) : [];
}

export function joinList(arr: string[]): string {
  return arr.join("|");
}
