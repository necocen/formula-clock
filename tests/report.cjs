'use strict';
const fs = require('node:fs'),
  path = require('node:path');
module.exports = (name, report) => {
  const folder = path.resolve(__dirname, '../test-results/node');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, name), JSON.stringify(report, null, 2) + '\n');
};
