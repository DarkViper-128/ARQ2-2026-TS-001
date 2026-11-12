// Run with: npm test -w @flashtix/catalog  (needs `npm run build -w @flashtix/catalog` first)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const { validateNewEvent } = createRequire(import.meta.url)('../dist/admin/validate-event.js');

const valid = () => ({
  name: 'World Tour 2027',
  artist: 'The Headliners',
  venue: { name: 'Movistar Arena', city: 'Bogota' },
  startsAt: '2027-03-20T23:00:00Z',
  saleStartsAt: '2027-02-01T15:00:00Z',
  priceCategories: [{ category: 'VIP', price: { amount: 45000000, currency: 'COP' } }],
  seats: [
    { seatId: 'A-12-07', category: 'VIP' },
    { seatId: 'A-12-08', category: 'VIP' },
  ],
});

const rejects = (mutate, pattern) => {
  const body = valid();
  mutate(body);
  assert.throws(() => validateNewEvent(body), (error) => error.code === 'VALIDATION_ERROR' && pattern.test(error.message));
};

test('a valid body is split into section, row and number', () => {
  const event = validateNewEvent(valid());
  assert.deepEqual(event.seats[0], { seatId: 'A-12-07', section: 'A', row: '12', number: '07', category: 'VIP' });
  assert.equal(event.priceCategories[0].amount, 45000000);
  assert.equal(event.venue.city, 'Bogota');
});

test('the sale must open before the concert', () => {
  rejects((b) => { b.saleStartsAt = '2027-04-01T00:00:00Z'; }, /saleStartsAt must be before startsAt/);
});

test('seats are checked one by one', () => {
  rejects((b) => { b.seats.push({ seatId: 'A-12-07', category: 'VIP' }); }, /repeated/);
  rejects((b) => { b.seats[0].seatId = 'A12-07'; }, /look like A-12-07/);
  rejects((b) => { b.seats[0].category = 'GOLD'; }, /no price/);
  rejects((b) => { b.seats = []; }, /at least one seat/);
});

test('prices are positive integers in minor units with a currency code', () => {
  rejects((b) => { b.priceCategories[0].price.amount = 450.5; }, /positive integer/);
  rejects((b) => { b.priceCategories[0].price.amount = 0; }, /positive integer/);
  rejects((b) => { b.priceCategories[0].price.currency = 'cop'; }, /3-letter/);
  rejects((b) => { b.priceCategories.push({ category: 'VIP', price: { amount: 1, currency: 'COP' } }); }, /repeated category/);
});

test('required text fields and venue', () => {
  rejects((b) => { b.name = '  '; }, /name is required/);
  rejects((b) => { delete b.venue; }, /venue is required/);
  assert.throws(() => validateNewEvent(null), (error) => error.code === 'VALIDATION_ERROR');
});
