/**
 * Restart detection for the poller. Spotify only reports the current position, so a track that
 * starts over (repeat-one loop, "previous" button) shows up as the same URI with a smaller
 * progress. It counts as a new play when that position could only have been reached by starting
 * from 0 since the last poll; a seek back to somewhere in the middle stays the same play.
 */

/** Backward position jitter between polls that is not a seek. */
const JITTER_MS = 2_000;
/** Allowance for API latency on top of the time since the last poll. */
const SLACK_MS = 5_000;
/** A play has to have run this long (at most half the track) before starting over counts as a new play. */
const MIN_PLAYED_MS = 30_000;
/** Lower bound for the window, so polls that land close together never get stricter than 10 s. */
const MIN_WINDOW_MS = 10_000;

/** Same track, now at `progressMs`, last seen at `prevProgressMs` `msSinceLastPoll` ago: did it start over? */
export function startedOver(
  prevProgressMs: number,
  progressMs: number,
  msSinceLastPoll: number,
  trackDurationMs: number
): boolean {
  if (progressMs + JITTER_MS >= prevProgressMs) return false; // still moving forward
  // Judge by how far the previous run got, not by its last poll (up to one interval earlier).
  const reached = reachedBeforeRestartMs(prevProgressMs, progressMs, msSinceLastPoll);
  if (reached < Math.min(MIN_PLAYED_MS, trackDurationMs / 2)) return false;
  return progressMs <= Math.max(msSinceLastPoll, MIN_WINDOW_MS) + SLACK_MS;
}

/**
 * Position the previous run reached before it started over: the time since the last poll, minus
 * what the new run has already played, went to the previous run.
 */
export function reachedBeforeRestartMs(prevProgressMs: number, progressMs: number, msSinceLastPoll: number): number {
  return prevProgressMs + Math.max(0, msSinceLastPoll - progressMs);
}
