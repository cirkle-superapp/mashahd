import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/streak?bid=<browserId>
 *
 * Returns the user's watch streak data (current streak, longest streak,
 * daily goal, videos watched today). Powers the streak badge on the home
 * page — a gamification feature unique to Mashahd (like Duolingo's flame
 * but for video watching).
 *
 * POST /api/streak
 * Body: { browserId, action: "watch" | "setGoal", dailyGoal? }
 *   - "watch": increments videosToday, updates the streak if it's a new day.
 *     Called by the watch view when a video starts playing.
 *   - "setGoal": updates the daily goal (1-20 videos per day).
 */

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(date1: string, date2: string): number {
  if (!date1 || !date2) return 0;
  const d1 = new Date(date1 + "T00:00:00Z").getTime();
  const d2 = new Date(date2 + "T00:00:00Z").getTime();
  return Math.round((d2 - d1) / 86400000);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") || "";
  if (!bid) return NextResponse.json({ streak: null });

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  try {
    let streak = await db.watchStreak.findUnique({
      where: { userId: verification.id },
    }).catch(() => null);

    // If no streak record exists, return defaults (streak = 0).
    if (!streak) {
      return NextResponse.json({
        streak: {
          currentStreak: 0,
          longestStreak: 0,
          totalDays: 0,
          dailyGoal: 3,
          videosToday: 0,
          lastWatchDate: "",
          goalMet: false,
        },
      });
    }

    // Reset videosToday if it's a new day.
    const today = todayISO();
    if (streak.lastResetDate !== today) {
      await db.watchStreak.update({
        where: { userId: verification.id },
        data: { videosToday: 0, lastResetDate: today },
      }).catch(() => {});
      streak = { ...streak, videosToday: 0 } as any;
    }

    return NextResponse.json({
      streak: {
        currentStreak: (streak as any).currentStreak || 0,
        longestStreak: (streak as any).longestStreak || 0,
        totalDays: (streak as any).totalDays || 0,
        dailyGoal: (streak as any).dailyGoal || 3,
        videosToday: (streak as any).videosToday || 0,
        lastWatchDate: (streak as any).lastWatchDate || "",
        goalMet: ((streak as any).videosToday || 0) >= ((streak as any).dailyGoal || 3),
      },
    });
  } catch {
    return NextResponse.json({ streak: null });
  }
}

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await rateLimit(`streak:${ip}`, 60, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const action: string = body.action || "watch";

  if (!bid) {
    return NextResponse.json({ error: "browserId required" }, { status: 400 });
  }
  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const today = todayISO();

  try {
    let streak = await db.watchStreak.findUnique({
      where: { userId: verification.id },
    }).catch(() => null);

    if (action === "setGoal") {
      const goal = Math.max(1, Math.min(20, parseInt(body.dailyGoal) || 3));
      if (streak) {
        await db.watchStreak.update({
          where: { userId: verification.id },
          data: { dailyGoal: goal },
        }).catch(() => {});
      } else {
        await db.watchStreak.create({
          data: { userId: verification.id, dailyGoal: goal },
        }).catch(() => {});
      }
      return NextResponse.json({ ok: true, dailyGoal: goal });
    }

    // action === "watch" — increment streak
    if (!streak) {
      // First time — create the streak record.
      streak = await db.watchStreak.create({
        data: {
          userId: verification.id,
          currentStreak: 1,
          longestStreak: 1,
          lastWatchDate: today,
          totalDays: 1,
          videosToday: 1,
          lastResetDate: today,
        },
      }).catch(() => null) as any;
      return NextResponse.json({
        ok: true,
        streak: {
          currentStreak: 1,
          longestStreak: 1,
          videosToday: 1,
          dailyGoal: 3,
          isNewStreak: true,
        },
      });
    }

    // Check if we need to reset videosToday (new day).
    let videosToday = (streak as any).videosToday || 0;
    if ((streak as any).lastResetDate !== today) {
      videosToday = 0;
    }

    // Increment videosToday.
    videosToday += 1;

    // Update streak if this is the first watch of the day.
    const lastWatch = (streak as any).lastWatchDate || "";
    let currentStreak = (streak as any).currentStreak || 0;
    let longestStreak = (streak as any).longestStreak || 0;
    let totalDays = (streak as any).totalDays || 0;
    let isNewStreak = false;

    if (lastWatch !== today) {
      // Check if this continues the streak (watched yesterday).
      const gap = daysBetween(lastWatch, today);
      if (gap === 1) {
        // Continued streak!
        currentStreak += 1;
        isNewStreak = true;
      } else if (gap > 1 || !lastWatch) {
        // Streak broken OR first watch ever (empty lastWatch) — reset.
        currentStreak = 1;
        isNewStreak = true;
      }
      // If gap === 0, it's the same day (shouldn't happen since we checked above).

      if (currentStreak > longestStreak) {
        longestStreak = currentStreak;
      }
      totalDays += 1;
    }

    await db.watchStreak.update({
      where: { userId: verification.id },
      data: {
        currentStreak,
        longestStreak,
        lastWatchDate: today,
        totalDays,
        videosToday,
        lastResetDate: today,
      },
    }).catch((e: any) => {
      console.warn("[streak] update failed:", e?.message?.slice(0, 100));
    });

    return NextResponse.json({
      ok: true,
      streak: {
        currentStreak,
        longestStreak,
        videosToday,
        dailyGoal: (streak as any).dailyGoal || 3,
        totalDays,
        isNewStreak,
        goalMet: videosToday >= ((streak as any).dailyGoal || 3),
      },
    });
  } catch (e: any) {
    console.error("[streak] error:", e?.message?.slice(0, 200));
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
