/**
 * Shared constants used across multiple senders.
 * Import from here instead of redefining in each file.
 */

const DEFAULT_WORKING_HOURS = {
  1: { on: true,  from: '09:00', to: '18:00' }, // Monday
  2: { on: true,  from: '09:00', to: '18:00' }, // Tuesday
  3: { on: true,  from: '09:00', to: '18:00' }, // Wednesday
  4: { on: true,  from: '09:00', to: '18:00' }, // Thursday
  5: { on: true,  from: '09:00', to: '18:00' }, // Friday
  6: { on: false, from: '09:00', to: '18:00' }, // Saturday
  7: { on: false, from: '09:00', to: '18:00' }, // Sunday
};

module.exports = { DEFAULT_WORKING_HOURS };
