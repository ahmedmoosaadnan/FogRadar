// Node 24+ supports stripping erasable TypeScript types natively.
import assert from 'node:assert/strict';
import {proximityColor} from '../src/utils/proximity.ts';
assert.equal(proximityColor(40,5,5),'red');
assert.equal(proximityColor(150,5,5),'yellow');
assert.equal(proximityColor(350,5,5),'green');
assert.equal(proximityColor(70,15,15),'uncertain');
assert.equal(proximityColor(45,40,10),'uncertain');
assert.equal(proximityColor(1100,5,5),'uncertain');
console.log('PASS: 6 proximity display / GPS-uncertainty checks');
