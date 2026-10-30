import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENTS } from '../../domain/activity.js';
import { KIND_TONES } from '../../routes/view/activity-page.js';

test('every event kind has a pill tone the pill partial knows, or none (the grey pill)', () => {
  const known = new Set(['green', 'amber', 'red', 'sky']);
  for (const [kind, tone] of Object.entries(KIND_TONES)) {
    assert.ok(Object.hasOwn(EVENTS, kind), `${kind} is an event kind`);
    assert.ok(known.has(tone), `${kind}: ${tone}`);
  }
  const grey = Object.keys(EVENTS).filter((kind) => !Object.hasOwn(KIND_TONES, kind));
  assert.deepEqual(grey.sort(), ['demoSeeded', 'housekeeping', 'serverStopped', 'signedOut']);
});
