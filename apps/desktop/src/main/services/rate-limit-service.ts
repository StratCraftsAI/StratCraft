/**
 * Rate Limit Service
 *
 * TICKET_704: Sliding-window rate limiter for free-tier BYOK users.
 * In-memory (resets on app restart) -- acceptable for desktop app.
 *
 * Two windows:
 * - Per-minute: 1 request allowed
 * - Per-hour: 15 requests allowed
 *
 * Keyed by install token (anonymous identity).
 */

import {
  FREE_TIER_RATE_LIMIT_PER_MINUTE,
  FREE_TIER_RATE_LIMIT_PER_HOUR,
  FREE_TIER_RATE_LIMIT_MINUTE_WINDOW_MS,
  FREE_TIER_RATE_LIMIT_HOUR_WINDOW_MS,
} from '../../shared/constants/timing';

// =============================================================================
// Types
// =============================================================================

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
  remaining: {
    minute: number;
    hour: number;
  };
}

interface SlidingWindow {
  timestamps: number[];
}

// =============================================================================
// Rate Limit Service
// =============================================================================

class RateLimitService {
  private minuteWindows: Map<string, SlidingWindow> = new Map();
  private hourWindows: Map<string, SlidingWindow> = new Map();

  checkRateLimit(key: string): RateLimitResult {
    const now = Date.now();

    // Clean expired entries and get current counts
    const minuteWindow = this.getOrCreateWindow(this.minuteWindows, key);
    const hourWindow = this.getOrCreateWindow(this.hourWindows, key);

    this.pruneWindow(minuteWindow, now, FREE_TIER_RATE_LIMIT_MINUTE_WINDOW_MS);
    this.pruneWindow(hourWindow, now, FREE_TIER_RATE_LIMIT_HOUR_WINDOW_MS);

    const minuteCount = minuteWindow.timestamps.length;
    const hourCount = hourWindow.timestamps.length;

    const minuteRemaining = Math.max(0, FREE_TIER_RATE_LIMIT_PER_MINUTE - minuteCount);
    const hourRemaining = Math.max(0, FREE_TIER_RATE_LIMIT_PER_HOUR - hourCount);

    // Check per-minute limit
    if (minuteCount >= FREE_TIER_RATE_LIMIT_PER_MINUTE) {
      const oldestInMinute = minuteWindow.timestamps[0];
      const retryAfterMs = (oldestInMinute + FREE_TIER_RATE_LIMIT_MINUTE_WINDOW_MS) - now;
      return {
        allowed: false,
        retryAfterMs: Math.max(0, retryAfterMs),
        remaining: { minute: 0, hour: hourRemaining },
      };
    }

    // Check per-hour limit
    if (hourCount >= FREE_TIER_RATE_LIMIT_PER_HOUR) {
      const oldestInHour = hourWindow.timestamps[0];
      const retryAfterMs = (oldestInHour + FREE_TIER_RATE_LIMIT_HOUR_WINDOW_MS) - now;
      return {
        allowed: false,
        retryAfterMs: Math.max(0, retryAfterMs),
        remaining: { minute: minuteRemaining, hour: 0 },
      };
    }

    // Allowed -- record the request
    minuteWindow.timestamps.push(now);
    hourWindow.timestamps.push(now);

    return {
      allowed: true,
      retryAfterMs: 0,
      remaining: {
        minute: Math.max(0, FREE_TIER_RATE_LIMIT_PER_MINUTE - minuteCount - 1),
        hour: Math.max(0, FREE_TIER_RATE_LIMIT_PER_HOUR - hourCount - 1),
      },
    };
  }

  /**
   * Peek at current rate limit state without consuming a request slot.
   * Used by UI status queries.
   */
  peekRateLimit(key: string): RateLimitResult {
    const now = Date.now();

    const minuteWindow = this.getOrCreateWindow(this.minuteWindows, key);
    const hourWindow = this.getOrCreateWindow(this.hourWindows, key);

    this.pruneWindow(minuteWindow, now, FREE_TIER_RATE_LIMIT_MINUTE_WINDOW_MS);
    this.pruneWindow(hourWindow, now, FREE_TIER_RATE_LIMIT_HOUR_WINDOW_MS);

    const minuteCount = minuteWindow.timestamps.length;
    const hourCount = hourWindow.timestamps.length;

    const minuteRemaining = Math.max(0, FREE_TIER_RATE_LIMIT_PER_MINUTE - minuteCount);
    const hourRemaining = Math.max(0, FREE_TIER_RATE_LIMIT_PER_HOUR - hourCount);

    if (minuteCount >= FREE_TIER_RATE_LIMIT_PER_MINUTE) {
      const oldestInMinute = minuteWindow.timestamps[0];
      const retryAfterMs = (oldestInMinute + FREE_TIER_RATE_LIMIT_MINUTE_WINDOW_MS) - now;
      return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs), remaining: { minute: 0, hour: hourRemaining } };
    }

    if (hourCount >= FREE_TIER_RATE_LIMIT_PER_HOUR) {
      const oldestInHour = hourWindow.timestamps[0];
      const retryAfterMs = (oldestInHour + FREE_TIER_RATE_LIMIT_HOUR_WINDOW_MS) - now;
      return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs), remaining: { minute: minuteRemaining, hour: 0 } };
    }

    return { allowed: true, retryAfterMs: 0, remaining: { minute: minuteRemaining, hour: hourRemaining } };
  }

  /** Reset all windows (for testing) */
  reset(): void {
    this.minuteWindows.clear();
    this.hourWindows.clear();
  }

  private getOrCreateWindow(map: Map<string, SlidingWindow>, key: string): SlidingWindow {
    let window = map.get(key);
    if (!window) {
      window = { timestamps: [] };
      map.set(key, window);
    }
    return window;
  }

  private pruneWindow(window: SlidingWindow, now: number, windowMs: number): void {
    const cutoff = now - windowMs;
    // Remove timestamps older than the window
    while (window.timestamps.length > 0 && window.timestamps[0] <= cutoff) {
      window.timestamps.shift();
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: RateLimitService | null = null;

export function getRateLimitService(): RateLimitService {
  if (!instance) {
    instance = new RateLimitService();
  }
  return instance;
}

/** Reset singleton (for testing) */
export function resetRateLimitService(): void {
  instance = null;
}
