import { AppError } from '@flashtix/shared';

export interface NewEvent {
  name: string;
  artist: string;
  venue: { name: string; city: string };
  startsAt: Date;
  saleStartsAt: Date;
  priceCategories: { category: string; amount: number; currency: string }[];
  seats: { seatId: string; section: string; row: string; number: string; category: string }[];
}

export const MAX_SEATS_PER_EVENT = 20000;

/** `A-12-07`: section, row and number (spec.md section 2). */
const SEAT_ID = /^([A-Z0-9]{1,8})-(\d{2,3})-(\d{2,3})$/;

function bad(detail: string): never {
  throw new AppError('VALIDATION_ERROR', detail);
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > max) {
    bad(`${field} is required (1 to ${max} characters)`);
  }
  return (value as string).trim();
}

function date(value: unknown, field: string): Date {
  const parsed = typeof value === 'string' ? new Date(value) : undefined;
  if (!parsed || Number.isNaN(parsed.getTime())) bad(`${field} must be an ISO-8601 date`);
  return parsed as Date;
}

/**
 * Validates the body of `POST /admin/events` (spec.md section 4) and returns it in the
 * shape the database wants. Everything the organizer sends is checked here, so a bad body
 * is a 400 and never a half-written event.
 */
export function validateNewEvent(body: unknown): NewEvent {
  if (typeof body !== 'object' || body === null) bad('The request body must be a JSON object');
  const input = body as Record<string, unknown>;

  const venue = input.venue as Record<string, unknown> | undefined;
  if (typeof venue !== 'object' || venue === null) bad('venue is required: { "name": "...", "city": "..." }');

  const startsAt = date(input.startsAt, 'startsAt');
  const saleStartsAt = date(input.saleStartsAt, 'saleStartsAt');
  if (saleStartsAt.getTime() >= startsAt.getTime()) bad('saleStartsAt must be before startsAt');

  if (!Array.isArray(input.priceCategories) || input.priceCategories.length === 0) {
    bad('priceCategories must have at least one category');
  }
  const priceCategories = (input.priceCategories as Record<string, unknown>[]).map((item, index) => {
    const price = item?.price as Record<string, unknown> | undefined;
    const category = text(item?.category, `priceCategories[${index}].category`, 40);
    const amount = price?.amount;
    const currency = price?.currency;
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
      bad(`priceCategories[${index}].price.amount must be a positive integer in minor units`);
    }
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
      bad(`priceCategories[${index}].price.currency must be a 3-letter code`);
    }
    return { category, amount: amount as number, currency: currency as string };
  });
  const categories = new Set(priceCategories.map((item) => item.category));
  if (categories.size !== priceCategories.length) bad('priceCategories has a repeated category');

  if (!Array.isArray(input.seats) || input.seats.length === 0) bad('seats must have at least one seat');
  if (input.seats.length > MAX_SEATS_PER_EVENT) bad(`seats cannot have more than ${MAX_SEATS_PER_EVENT} seats`);
  const seen = new Set<string>();
  const seats = (input.seats as Record<string, unknown>[]).map((item, index) => {
    const seatId = typeof item?.seatId === 'string' ? item.seatId : '';
    const match = SEAT_ID.exec(seatId);
    if (!match) bad(`seats[${index}].seatId must look like A-12-07`);
    if (seen.has(seatId)) bad(`seat ${seatId} is repeated`);
    seen.add(seatId);
    const category = typeof item.category === 'string' ? item.category : '';
    if (!categories.has(category)) bad(`seats[${index}].category "${category}" has no price in priceCategories`);
    return { seatId, section: match![1]!, row: match![2]!, number: match![3]!, category };
  });

  return {
    name: text(input.name, 'name', 160),
    artist: text(input.artist, 'artist', 120),
    venue: { name: text(venue!.name, 'venue.name', 120), city: text(venue!.city, 'venue.city', 80) },
    startsAt,
    saleStartsAt,
    priceCategories,
    seats,
  };
}
