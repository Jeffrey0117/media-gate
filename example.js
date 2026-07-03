// 最小範例：node example.js
const createMediaGate = require('./index');

const gate = createMediaGate({ secret: 'demo-secret-換成你的私有值', ttlMs: 2 * 60 * 60 * 1000 });

// 1) 使用者有權觀看 record "vid1" → 發 token（塞進媒體網址 ?t=）
const token = gate.signToken('vid1', 'user-42');
console.log('token:', token.slice(0, 40) + '...');

// 2) 服務媒體檔時驗證
console.log('verify ok:', gate.verifyToken(token));           // { resourceId:'vid1', subjectId:'user-42', exp }
console.log('verify tampered:', gate.verifyToken('abc.def')); // null

// 3) 路徑穿越防護
console.log('safe:', gate.safeJoin('/data/media', 'videos/x.mp4')); // → /data/media/videos/x.mp4
console.log('traversal blocked:', gate.safeJoin('/data/media', '../../etc/passwd')); // → null

// 4) HLS：把 token 補到子清單/分段
const m3u8 = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n720p/index.m3u8\n';
console.log('rewritten m3u8:\n' + gate.rewriteM3U8(m3u8, token).split('\n').slice(0, 3).join('\n'));
