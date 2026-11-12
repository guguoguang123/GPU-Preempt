const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const content = read('extension/content.js');
const end = content.indexOf('// ==/UserScript==') + '// ==/UserScript=='.length;
fs.writeFileSync(path.join(__dirname, 'autodl_gpu_watch.user.js'), content.slice(0, end) + '\n' + read('extension/engine.js') + '\n' + content.slice(end));
console.log('Userscript synchronized with extension sources.');
