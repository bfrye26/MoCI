import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
const roots=['moci','integrations/docker-manager/moci-app-docker/files'];
for(const root of roots){
  for(const entry of readdirSync(root,{recursive:true,withFileTypes:true})){
    if(!entry.isFile() || !/\.(js|css|html|json)$/.test(entry.name))continue;
    const path=join(entry.parentPath || entry.path,entry.name);
    const text=readFileSync(path,'utf8');
    assert(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(text),
      `Invalid control or replacement character in ${path}`);
  }
}
const html=readFileSync('moci/index.html','utf8');
for(const symbol of ['\u2193','\u2191','\u25c6','\u25cf']){
  assert(html.includes(symbol),`Dashboard symbol U+${symbol.codePointAt(0).toString(16)} was lost`);
}
console.log('UI text encoding passed: UTF-8 symbols retained and control characters absent.');
