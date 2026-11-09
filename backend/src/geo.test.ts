import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {metersBetween,bearingDegrees,headingDelta,isAhead} from './geo.js';
test('geospatial radius and directional filtering',()=>{
 const a={latitude:31.5,longitude:74.3,heading:0};
 const near={latitude:31.503,longitude:74.3,heading:2};
 assert.ok(metersBetween(a,near)>300 && metersBetween(a,near)<350);
 assert.ok(bearingDegrees(a,near)<5);
 assert.equal(isAhead(a,near),true);
 assert.equal(isAhead(a,{...near,heading:180}),false);
 assert.equal(isAhead(a,{latitude:31.497,longitude:74.3,heading:0}),false);
 assert.equal(headingDelta(359,1),2);
});
