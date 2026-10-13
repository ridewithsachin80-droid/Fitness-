import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Browser uploads can leave old hashed bundles in dist. Match the app's HTML,
// never directory order, and preserve the linked stylesheets' cascade order.
export function readBuiltCss(dist) {
  const hint = 'Run the client build first: cd client && npm run build';
  const index = path.join(dist, 'index.html');
  if (!fs.existsSync(index)) throw new Error(`Missing built index.html. ${hint}`);
  const dom = new JSDOM(fs.readFileSync(index, 'utf8'));
  try {
    const files = [...dom.window.document.querySelectorAll('link[rel~="stylesheet"][href]')]
      .map(link => new URL(link.getAttribute('href'), 'http://build.local/'))
      // External font stylesheets are not local build output.
      .filter(url => url.origin === 'http://build.local' && url.pathname.endsWith('.css'))
      .map(url => path.join(dist, decodeURIComponent(url.pathname)));
    if (!files.length) throw new Error(`No local stylesheet linked in built index.html. ${hint}`);
    return files.map(file => {
      if (!fs.existsSync(file)) throw new Error(`Missing linked stylesheet ${file}. ${hint}`);
      return fs.readFileSync(file, 'utf8');
    }).join('\n');
  } finally {
    dom.window.close();
  }
}
