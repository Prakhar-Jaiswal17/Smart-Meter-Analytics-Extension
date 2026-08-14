const fs = require('fs');
const path = '/Users/prakharjaiswal/Coding/Programming/antiGravity/SmartMeterExtension/src/background/service-worker.js';
let content = fs.readFileSync(path, 'utf8');

// Replace array assumption in consumerInfoRes
content = content.replace(
  `if (consumerInfoRes.status === 'fulfilled' && consumerInfoRes.value?.data?.[0]) {\n    meterInfo = Normalizers.normalizeConsumerInfo(consumerInfoRes.value.data[0]);\n  }`,
  `if (consumerInfoRes.status === 'fulfilled' && consumerInfoRes.value?.data) {\n    const data = Array.isArray(consumerInfoRes.value.data) ? consumerInfoRes.value.data[0] : consumerInfoRes.value.data;\n    if (data) meterInfo = Normalizers.normalizeConsumerInfo(data);\n  }`
);

// Replace array assumption in meterDetailRes
content = content.replace(
  `if (meterDetailRes.status === 'fulfilled' && meterDetailRes.value?.data?.[0]) {\n    meterDetail = Normalizers.normalizeMeterDetail(meterDetailRes.value.data[0]);\n  }`,
  `if (meterDetailRes.status === 'fulfilled' && meterDetailRes.value?.data) {\n    const data = Array.isArray(meterDetailRes.value.data) ? meterDetailRes.value.data[0] : meterDetailRes.value.data;\n    if (data) meterDetail = Normalizers.normalizeMeterDetail(data);\n  }`
);

fs.writeFileSync(path, content, 'utf8');
console.log('service-worker.js patched');
