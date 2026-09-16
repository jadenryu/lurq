/**
 * When to look at an endpoint again.
 *
 * The cadence is the product: an answer is only as good as its age, and an
 * alert about a changed contract is only as fast as the next probe. But probing
 * is also a request to someone else's server, so the schedule spends attention
 * where it earns information:
 *
 *   - a healthy endpoint is read daily, and six-hourly for a while after it
 *     changed, because releases come in bursts
 *   - a dead one backs off exponentially to a week, so a registry full of
 *     abandoned demos costs almost nothing, yet a revived one is noticed
 *   - an endpoint lurq never attempts is not asked again for a month: either its
 *     host is one our own policy refuses, or its URL is still a template with an
 *     unfilled placeholder, which no amount of probing will resolve
 *
 * Jitter is derived from the endpoint id rather than random, so the schedule is
 * reproducible in tests and thousands of endpoints first seen in the same sync do
 * not all come due in the same minute.
 */
import { DEAD_STATUSES, type EndpointStatus } from './types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const CADENCE = {
  healthy: DAY,
  afterChange: 6 * HOUR,
  deadBase: 6 * HOUR,
  deadMax: 7 * DAY,
  timeoutBase: 12 * HOUR,
  timeoutMax: 3 * DAY,
  protocolError: 3 * DAY,
  blocked: 30 * DAY,
  /** Changed recently = within this window of the last change. */
  changeWindow: 3 * DAY,
} as const;

export interface ScheduleInput {
  endpointId: number;
  status: EndpointStatus;
  /** Consecutive failures INCLUDING this probe's outcome. */
  consecutiveFailures: number;
  lastChangedAt: Date | null;
  now?: Date;
}

/** ±10%, stable per endpoint. */
function jitter(id: number, ms: number): number {
  const unit = ((Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) >>> 0) % 2001) / 1000 - 1; // [-1, 1]
  return Math.round(ms * (1 + unit * 0.1));
}

export function isFailure(status: EndpointStatus): boolean {
  return DEAD_STATUSES.has(status) || status === 'timeout';
}

export function nextProbeAt(input: ScheduleInput): Date {
  const now = input.now ?? new Date();
  const failures = Math.max(0, input.consecutiveFailures);
  let delay: number;
  switch (input.status) {
    case 'open':
    case 'auth_required': {
      const recent = input.lastChangedAt && now.getTime() - input.lastChangedAt.getTime() < CADENCE.changeWindow;
      delay = recent ? CADENCE.afterChange : CADENCE.healthy;
      break;
    }
    case 'timeout':
      delay = Math.min(CADENCE.timeoutBase * 2 ** Math.max(0, failures - 1), CADENCE.timeoutMax);
      break;
    case 'protocol_error':
      delay = CADENCE.protocolError;
      break;
    case 'blocked':
    case 'templated':
      delay = CADENCE.blocked;
      break;
    default:
      delay = Math.min(CADENCE.deadBase * 2 ** Math.max(0, failures - 1), CADENCE.deadMax);
  }
  return new Date(now.getTime() + jitter(input.endpointId, delay));
}
