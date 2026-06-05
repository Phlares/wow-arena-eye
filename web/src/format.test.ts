import { fmtNum, fmtRatingDelta, fmtDuration, fmtClock } from './format.js';

it('abbreviates large numbers', () => {
  expect(fmtNum(4_200_000)).toBe('4.2M');
  expect(fmtNum(26_100)).toBe('26.1k');
  expect(fmtNum(null)).toBe('—');
});
it('formats a signed rating delta', () => {
  expect(fmtRatingDelta(16)).toBe('+16');
  expect(fmtRatingDelta(-12)).toBe('−12');
  expect(fmtRatingDelta(null)).toBe('');
});
it('formats a duration mm:ss', () => {
  expect(fmtDuration(161)).toBe('2:41');
  expect(fmtDuration(null)).toBe('—');
});
it('formats a clock from epoch ms', () => {
  expect(fmtClock(null)).toBe('—');
  expect(typeof fmtClock(1_000_000)).toBe('string');
});
