import { AppError } from '@flashtix/shared';

export interface CreateHoldBody {
  eventId?: unknown;
  seatIds?: unknown;
}

export interface CreateHoldCommand {
  eventId: string;
  seatIds: string[];
}

/** Max seats per hold, from spec.md section 7. */
export const MAX_SEATS_PER_HOLD = 6;

const SEAT_ID = /^[A-Z]+-\d{2}-\d{2}$/;

/** Validates the request body and returns a trusted command. */
export function parseCreateHold(body: CreateHoldBody): CreateHoldCommand {
  const eventId = typeof body.eventId === 'string' ? body.eventId.trim() : '';
  if (!eventId) throw new AppError('VALIDATION_ERROR', 'eventId is required');

  if (!Array.isArray(body.seatIds) || body.seatIds.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'seatIds must be a non-empty array');
  }
  if (body.seatIds.length > MAX_SEATS_PER_HOLD) {
    throw new AppError(
      'TOO_MANY_SEATS',
      `A hold can cover at most ${MAX_SEATS_PER_HOLD} seats, got ${body.seatIds.length}`,
    );
  }

  const seatIds = body.seatIds.map((seat) => {
    if (typeof seat !== 'string' || !SEAT_ID.test(seat)) {
      throw new AppError('VALIDATION_ERROR', `Invalid seat id: ${String(seat)}`);
    }
    return seat;
  });

  if (new Set(seatIds).size !== seatIds.length) {
    throw new AppError('VALIDATION_ERROR', 'seatIds contains duplicates');
  }

  return { eventId, seatIds };
}
