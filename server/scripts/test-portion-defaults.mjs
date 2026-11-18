import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
const output = await build({
  stdin: { contents: "import {smartGrams} from './components/food/portions.jsx'; globalThis.smartGrams=smartGrams;", resolveDir: fileURLToPath(new URL('../../client/src/', import.meta.url)), loader: 'jsx' },
  bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.js': 'jsx' },
  define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
});
const context = createContext({}); runInContext(output.outputFiles[0].text, context);
for (const [name, grams] of [['egg white',30],['chicken curry',200],['scrambled egg',100],['Chicken Breast',150],['egg',55],['unlisted food',null]]) {
  assert.equal(context.smartGrams(name), grams); console.log(`  ✓ ${name}: ${grams ?? 'no assumed portion'}`);
}
console.log('Portion defaults: 6 passed');
