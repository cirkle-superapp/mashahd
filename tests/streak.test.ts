/**
 * Watch streak logic unit tests (Pass 70)
 *
 * Tests the streak calculation logic: consecutive days, streak break,
 * daily reset, longest streak tracking, and goal-met detection.
 * Tests the pure logic without hitting the database.
 */

import { describe, it, expect } from "bun:test";

// ── Streak calculation logic (mirrors src/app/api/streak/route.ts) ──

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(date1: string, date2: string): number {
  if (!date1 || !date2) return 0;
  const d1 = new Date(date1 + "T00:00:00Z").getTime();
  const d2 = new Date(date2 + "T00:00:00Z").getTime();
  return Math.round((d2 - d1) / 86400000);
}

interface StreakState {
  currentStreak: number;
  longestStreak: number;
  lastWatchDate: string;
  totalDays: number;
  videosToday: number;
  dailyGoal: number;
}

/**
 * Calculate the new streak state when a user watches a video.
 * Returns the updated state + whether this is a new streak day.
 */
function processWatch(state: StreakState, today: string): StreakState & { isNewStreak: boolean; goalMet: boolean } {
  let { currentStreak, longestStreak, lastWatchDate, totalDays, videosToday, dailyGoal } = state;
  let isNewStreak = false;

  // Reset videosToday if it's a new day
  if (lastWatchDate !== today) {
    videosToday = 0;
  }

  videosToday++;

  // Check if this is the first watch of the day
  if (lastWatchDate !== today) {
    const gap = daysBetween(lastWatchDate, today);
    if (gap === 1) {
      // Continued streak
      currentStreak += 1;
      isNewStreak = true;
    } else if (gap > 1 || !lastWatchDate) {
      // Streak broken OR first watch ever (empty lastWatchDate)
      currentStreak = 1;
      isNewStreak = true;
    }
    // If gap === 0, same day (shouldn't happen since we checked above)

    if (currentStreak > longestStreak) {
      longestStreak = currentStreak;
    }
    totalDays += 1;
  }

  return {
    currentStreak,
    longestStreak,
    lastWatchDate: today,
    totalDays,
    videosToday,
    dailyGoal,
    isNewStreak,
    goalMet: videosToday >= dailyGoal,
  };
}

describe("Watch streak logic", () => {
  const today = "2026-09-22";
  const yesterday = "2026-09-21";
  const twoDaysAgo = "2026-09-20";
  const weekAgo = "2026-09-15";

  it("creates a new streak on first watch ever", () => {
    const state: StreakState = {
      currentStreak: 0,
      longestStreak: 0,
      lastWatchDate: "",
      totalDays: 0,
      videosToday: 0,
      dailyGoal: 3,
    };
    const result = processWatch(state, today);
    expect(result.currentStreak).toBe(1);
    expect(result.longestStreak).toBe(1);
    expect(result.isNewStreak).toBe(true);
    expect(result.totalDays).toBe(1);
    expect(result.videosToday).toBe(1);
    expect(result.goalMet).toBe(false); // 1 < 3
  });

  it("continues streak when watched yesterday", () => {
    const state: StreakState = {
      currentStreak: 5,
      longestStreak: 5,
      lastWatchDate: yesterday,
      totalDays: 5,
      videosToday: 0,
      dailyGoal: 3,
    };
    const result = processWatch(state, today);
    expect(result.currentStreak).toBe(6);
    expect(result.longestStreak).toBe(6);
    expect(result.isNewStreak).toBe(true);
    expect(result.totalDays).toBe(6);
  });

  it("breaks streak when gap > 1 day", () => {
    const state: StreakState = {
      currentStreak: 10,
      longestStreak: 10,
      lastWatchDate: weekAgo,
      totalDays: 10,
      videosToday: 0,
      dailyGoal: 3,
    };
    const result = processWatch(state, today);
    expect(result.currentStreak).toBe(1); // Reset to 1
    expect(result.longestStreak).toBe(10); // Longest unchanged
    expect(result.isNewStreak).toBe(true);
    expect(result.totalDays).toBe(11);
  });

  it("does not increment streak for same-day watches", () => {
    const state: StreakState = {
      currentStreak: 3,
      longestStreak: 5,
      lastWatchDate: today,
      totalDays: 10,
      videosToday: 2,
      dailyGoal: 3,
    };
    const result = processWatch(state, today);
    expect(result.currentStreak).toBe(3); // Unchanged
    expect(result.totalDays).toBe(10); // Unchanged
    expect(result.isNewStreak).toBe(false);
    expect(result.videosToday).toBe(3);
    expect(result.goalMet).toBe(true); // 3 >= 3
  });

  it("updates longestStreak when current exceeds it", () => {
    const state: StreakState = {
      currentStreak: 9,
      longestStreak: 9,
      lastWatchDate: yesterday,
      totalDays: 9,
      videosToday: 0,
      dailyGoal: 3,
    };
    const result = processWatch(state, today);
    expect(result.currentStreak).toBe(10);
    expect(result.longestStreak).toBe(10);
  });

  it("does not update longestStreak when current is less", () => {
    const state: StreakState = {
      currentStreak: 1,
      longestStreak: 15,
      lastWatchDate: weekAgo, // Gap > 1, streak breaks
      totalDays: 20,
      videosToday: 0,
      dailyGoal: 3,
    };
    const result = processWatch(state, today);
    expect(result.currentStreak).toBe(1);
    expect(result.longestStreak).toBe(15); // Unchanged
  });

  it("resets videosToday on a new day", () => {
    const state: StreakState = {
      currentStreak: 3,
      longestStreak: 3,
      lastWatchDate: yesterday,
      totalDays: 3,
      videosToday: 5, // Watched 5 yesterday
      dailyGoal: 3,
    };
    const result = processWatch(state, today);
    expect(result.videosToday).toBe(1); // Reset to 0, then incremented to 1
    expect(result.goalMet).toBe(false); // 1 < 3
  });

  it("detects goalMet when videosToday reaches dailyGoal", () => {
    const state: StreakState = {
      currentStreak: 2,
      longestStreak: 5,
      lastWatchDate: today,
      totalDays: 2,
      videosToday: 2, // One more will make it 3
      dailyGoal: 3,
    };
    const result = processWatch(state, today);
    expect(result.videosToday).toBe(3);
    expect(result.goalMet).toBe(true);
  });

  it("detects goalMet exceeds dailyGoal", () => {
    const state: StreakState = {
      currentStreak: 2,
      longestStreak: 5,
      lastWatchDate: today,
      totalDays: 2,
      videosToday: 3, // Already met goal, one more
      dailyGoal: 3,
    };
    const result = processWatch(state, today);
    expect(result.videosToday).toBe(4);
    expect(result.goalMet).toBe(true);
  });

  it("handles daysBetween correctly for consecutive days", () => {
    expect(daysBetween("2026-09-21", "2026-09-22")).toBe(1);
    expect(daysBetween("2026-09-20", "2026-09-22")).toBe(2);
    expect(daysBetween("2026-09-15", "2026-09-22")).toBe(7);
  });

  it("handles daysBetween with empty dates", () => {
    expect(daysBetween("", "2026-09-22")).toBe(0);
    expect(daysBetween("2026-09-22", "")).toBe(0);
  });
});
