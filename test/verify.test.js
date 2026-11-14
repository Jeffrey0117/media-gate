const test = require('node:test');
const assert = require('node:assert');
const createMediaGate = require('../index');

const gate = createMediaGate({ secret: 'test-secret' });

test('a signed token verifies and returns its fields as strings', () => {
  const p = gate.verifyToken(gate.signToken('rec1', 42));
  assert.strictEqual(p.resourceId, 'rec1');
  assert.strictEqual(p.subjectId, '42');
  assert.ok(Number.isFinite(p.exp) && p.exp > Date.now());
});

test('a tampered or missing token is rejected', () => {
  const token = gate.signToken('rec1', 'u1');
  assert.strictEqual(gate.verifyToken(token.slice(0, -2) + 'xx'), null);
  assert.strictEqual(gate.verifyToken(''), null);
  assert.strictEqual(gate.verifyToken(undefined), null);
});

test('an expired token is rejected', () => {
  const short = createMediaGate({ secret: 'test-secret', ttlMs: -1 });
  assert.strictEqual(short.verifyToken(short.signToken('rec1', 'u1')), null);
});

// 回歸：id 含分隔字元時，欄位會錯位，到期時間變成 NaN，而 Date.now() > NaN 是 false → 永不過期
test('a token whose id contains the separator is rejected instead of being misread', () => {
  assert.strictEqual(gate.verifyToken(gate.signToken('a~b', 'u1')), null);
  assert.strictEqual(gate.verifyToken(gate.signToken('rec1', 'u~1')), null);
});

// 回歸：對象 id 尾巴帶一個很大的數字，會被讀成到期時間，等於自己延長效期
test('a subject id cannot smuggle in its own expiry', () => {
  const short = createMediaGate({ secret: 'test-secret', ttlMs: -1 });
  assert.strictEqual(short.verifyToken(short.signToken('rec1', 'u1~99999999999999')), null);
});

test('safeJoin refuses paths that leave the base directory', () => {
  assert.strictEqual(gate.safeJoin('/srv/media', '../secrets.db'), null);
  assert.ok(gate.safeJoin('/srv/media', 'videos/a.mp4'));
});
