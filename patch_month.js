const fs = require('fs');
const path = '/Users/prakharjaiswal/Coding/Programming/antiGravity/SmartMeterExtension/src/background/service-worker.js';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  `const month = payload?.month || (now.getMonth() + 1);`,
  `const month = payload?.month || String(now.getMonth() + 1).padStart(2, '0');`
);

fs.writeFileSync(path, content, 'utf8');
console.log('month patched');
