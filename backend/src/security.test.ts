import {test} from 'node:test';import {strict as assert} from 'node:assert';
import {issueToken,verifyToken} from './security.js';
test('signed anonymous trip token',()=>{const secret='a'.repeat(40);const {token,vehicleId}=issueToken(secret);assert.equal(verifyToken(secret,token)?.sub,vehicleId);assert.equal(verifyToken('b'.repeat(40),token),null);assert.equal(verifyToken(secret,`${token}x`),null);});
