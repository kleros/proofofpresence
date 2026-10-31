import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEventTimeZone, eventTimeToUtc, eventTimeFromUtc, formatEventTime, eventTimeZones } from '../public/event-timezone.js';

test('UTC, Bangkok, Kolkata and fractional Kathmandu event wall clocks convert to exact UTC instants', () => {
  for (const [zone, expected] of [['UTC', '2030-11-04T18:00:00.000Z'], ['Asia/Bangkok', '2030-11-04T11:00:00.000Z'],
    ['Asia/Kolkata', '2030-11-04T12:30:00.000Z'], ['Asia/Kathmandu', '2030-11-04T12:15:00.000Z']]) {
    assert.equal(eventTimeToUtc('2030-11-04T18:00', zone), expected);
    assert.equal(eventTimeFromUtc(expected, zone), '2030-11-04T18:00');
    assert.equal(formatEventTime(expected, zone), '2030-11-04 18:00 ' + zone);
  }
});

test('the selected timezone changes the instant rather than merely the label', () => {
  const wall = '2030-11-04T18:00';
  assert.notEqual(eventTimeToUtc(wall, 'UTC'), eventTimeToUtc(wall, 'Asia/Bangkok'));
  assert.equal(Date.parse(eventTimeToUtc(wall, 'UTC')) - Date.parse(eventTimeToUtc(wall, 'Asia/Bangkok')), 7 * 3600000);
});

test('two elapsed hours across spring DST render as three clock hours and midnight/month/year rollovers stay exact', () => {
  const start = eventTimeToUtc('2030-03-10T01:30', 'America/New_York');
  assert.equal(start, '2030-03-10T06:30:00.000Z');
  assert.equal(eventTimeFromUtc(Date.parse(start) + 2 * 3600000, 'America/New_York'), '2030-03-10T04:30');
  for (const [wall, end] of [['2030-12-31T23:30', '2031-01-01T01:30'], ['2032-02-28T23:30', '2032-02-29T01:30']])
    assert.equal(eventTimeFromUtc(Date.parse(eventTimeToUtc(wall, 'Asia/Bangkok')) + 2 * 3600000, 'Asia/Bangkok'), end);
});

test('DST gaps are rejected rather than normalized to a later time', () => {
  assert.throws(() => eventTimeToUtc('2030-03-10T02:30', 'America/New_York'), error => error.code === 'EVENT_TIME_GAP');
  assert.throws(() => eventTimeToUtc('2030-10-06T02:15', 'Australia/Lord_Howe'), error => error.code === 'EVENT_TIME_GAP');
});

test('ambiguous repeated hours require an explicit unambiguous choice', () => {
  assert.throws(() => eventTimeToUtc('2030-11-03T01:30', 'America/New_York'), error => error.code === 'EVENT_TIME_AMBIGUOUS' && /UTC/.test(error.message));
  assert.throws(() => eventTimeToUtc('2030-04-07T01:45', 'Australia/Lord_Howe'), error => error.code === 'EVENT_TIME_AMBIGUOUS');
  assert.equal(eventTimeToUtc('2030-11-03T01:30', 'UTC'), '2030-11-03T01:30:00.000Z');
});

test('invalid zones, offsets, dates and partial inputs are never silently accepted', () => {
  for (const zone of ['', 'Not/AZone', '+07:00', 'UTC+7', '<script>', null])
    assert.throws(() => eventTimeToUtc('2030-11-04T18:00', zone), error => error.code === 'EVENT_TIMEZONE_INVALID');
  for (const wall of ['', '2030-02-30T18:00', '2030-13-01T18:00', '2030-00-01T18:00', '2030-11-04T24:00',
    '2030-11-04T18:60', '0000-11-04T18:00', '2030-11-04', '2030-11-04T18:00Z', '2030-11-04T18:00:00'])
    assert.throws(() => eventTimeToUtc(wall, 'UTC'), error => error.code === 'EVENT_TIME_INVALID');
  assert.throws(() => eventTimeFromUtc('invalid', 'UTC'));
});

test('timezone choices include UTC/browser/common zones and preserve valid chosen IANA labels', () => {
  assert.equal(validateEventTimeZone(' Asia/Kathmandu '), 'Asia/Kathmandu');
  const zones = eventTimeZones('Asia/Bangkok');
  for (const zone of ['UTC', 'Asia/Bangkok', 'Asia/Kolkata', 'Asia/Kathmandu', 'America/New_York']) assert(zones.includes(zone));
  assert.equal(new Set(zones).size, zones.length);
});
