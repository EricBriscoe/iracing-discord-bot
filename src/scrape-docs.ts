import { promises as fs } from 'fs';
import * as path from 'path';
import { iRacingClient } from './iracing-client';
import { config } from 'dotenv';

// Load environment variables from .env
config();

const BASE_DOC = '/data/doc';
const OUTPUT_ROOT = path.resolve('docs');

type QueueItem = {
  path: string; // e.g., /data/doc, /data/doc/car, /data/doc/car/assets
};

function ensureLeadingSlash(p: string): string {
  return p.startsWith('/') ? p : '/' + p;
}

function toLocalFile(docPath: string, ext: 'html' | 'json' | 'txt' = 'html'): string {
  // Map /data/doc -> docs/index.html
  // Map /data/doc/service -> docs/service/index.html
  // Map /data/doc/service/method -> docs/service/method/index.html
  const clean = ensureLeadingSlash(docPath).replace(/^\/+/, '/');
  const withoutPrefix = clean.replace(/^\/data\/doc\/?/, '');
  const parts = withoutPrefix.length ? withoutPrefix.split('/') : [];
  const dir = path.join(OUTPUT_ROOT, ...parts);
  return path.join(dir, `index.${ext}`);
}

function normalizeDocPath(href: string, currentDocPath?: string): string | null {
  try {
    // Accept absolute URLs, absolute paths, and relative paths
    let url: URL;
    if (/^https?:\/\//i.test(href)) {
      url = new URL(href);
    } else if (href.startsWith('/')) {
      url = new URL('https://members-ng.iracing.com' + href);
    } else if (currentDocPath) {
      // Build a base using the current doc path to resolve relatives
      const base = new URL('https://members-ng.iracing.com' + ensureLeadingSlash(currentDocPath) + '/');
      url = new URL(href, base);
    } else {
      return null;
    }

    if (!url.pathname.startsWith(BASE_DOC)) return null;
    // Drop trailing slash; strip query/hash
    return url.pathname.replace(/\/$/, '');
  } catch {
    return null;
  }
}

function posixify(p: string): string {
  return p.split(path.sep).join('/');
}

function relativeHref(fromLocalFile: string, toLocalFile: string): string {
  // Return POSIX-style relative path from one local HTML file to another
  const fromDir = path.dirname(fromLocalFile);
  const rel = path.relative(fromDir, toLocalFile) || 'index.html';
  return posixify(rel);
}

function extractDocLinks(html: string, currentDocPath: string): string[] {
  // Very simple href extractor; we only care about /data/doc links
  const results = new Set<string>();
  const hrefRegex = /href=\"([^\"]+)\"/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRegex.exec(html))) {
    const href = m[1] ?? '';
    const docPath = normalizeDocPath(href, currentDocPath);
    if (docPath) results.add(docPath);
  }
  return Array.from(results);
}

function rewriteLinks(html: string, currentDocPath: string, knownTargets: Set<string>): string {
  const currentLocal = toLocalFile(currentDocPath, 'html');

  return html.replace(/href=\"([^\"]+)\"/gi, (full, href) => {
    const target = normalizeDocPath(href, currentDocPath);
    if (!target) return full; // leave as-is for non-doc links
    if (!knownTargets.has(target)) return full; // skip rewriting if we won't save it
    const targetLocal = toLocalFile(target, 'html');
    const rel = relativeHref(currentLocal, targetLocal);
    return `href=\"${rel}\"`;
  });
}

async function ensureDirFor(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function saveFile(filePath: string, content: string): Promise<void> {
  await ensureDirFor(filePath);
  await fs.writeFile(filePath, content, 'utf8');
}

function collectLinksRecursively(obj: any, out: Set<string>) {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'link' && typeof v === 'string') {
      out.add(v);
    } else if (typeof v === 'object') {
      collectLinksRecursively(v, out);
    }
  }
}

function toDocPathFromApiLink(link: string): string | null {
  // Convert /data/<service>/<method> (or full URL) to /data/doc/<service>/<method>
  try {
    let url: URL;
    if (/^https?:\/\//i.test(link)) {
      url = new URL(link);
    } else {
      url = new URL('https://members-ng.iracing.com' + ensureLeadingSlash(link));
    }
    if (!url.pathname.startsWith('/data/')) return null;
    const rest = url.pathname.replace(/^\/data\//, '');
    return '/data/doc/' + rest.replace(/\/$/, '');
  } catch {
    return null;
  }
}

async function scrapeDocs(): Promise<void> {
  const client = new iRacingClient();
  const axios = await client.getHttpClient();

  // First get the JSON index from /data/doc
  const indexRes = await axios.get(BASE_DOC);
  const indexData = indexRes.data;

  // Build a set of doc paths to fetch
  const discovered = new Set<string>();
  discovered.add(BASE_DOC);

  // Add /data/doc/<service> for each top-level key
  if (indexData && typeof indexData === 'object') {
    for (const service of Object.keys(indexData)) {
      discovered.add(`${BASE_DOC}/${service}`);
    }
  }

  // Find all API links in index JSON and convert to doc paths
  const apiLinks = new Set<string>();
  collectLinksRecursively(indexData, apiLinks);
  for (const link of apiLinks) {
    const docPath = toDocPathFromApiLink(link);
    if (docPath) discovered.add(docPath);
  }

  // Optionally, attempt to crawl doc HTML pages to find any additional doc links
  const queue: QueueItem[] = Array.from(discovered).map(p => ({ path: p }));
  const visited = new Set<string>();

  // First pass: crawl and collect pages
  while (queue.length) {
    const { path: docPath } = queue.shift()!;
    if (visited.has(docPath)) continue;
    visited.add(docPath);

    // Fetch page as text so we can handle JSON or HTML dynamically
    const res = await axios.get(docPath, { responseType: 'text' });
    const contentType = (res.headers && (res.headers['content-type'] as string | undefined)) || undefined;
    const bodyText = typeof res.data === 'string' ? res.data : String(res.data);

    // Discover new links
    const links = extractDocLinks(bodyText, docPath);
    for (const link of links) {
      if (!discovered.has(link)) {
        discovered.add(link);
        queue.push({ path: link });
      }
    }

    // If JSON, also scan for API links inside and convert to doc paths
    const looksJson = (contentType && /json/i.test(contentType)) || /^[\s\n]*[\[{]/.test(bodyText);
    if (looksJson) {
      try {
        const json = JSON.parse(bodyText);
        const innerLinks = new Set<string>();
        collectLinksRecursively(json, innerLinks);
        for (const l of innerLinks) {
          const dp = toDocPathFromApiLink(l);
          if (dp && !discovered.has(dp)) {
            discovered.add(dp);
            queue.push({ path: dp });
          }
        }
      } catch {
        // ignore JSON parse errors
      }
    }
  }

  // Second pass: fetch and save with link rewriting limited to discovered set
  for (const docPath of discovered) {
    const res = await axios.get(docPath, { responseType: 'text' });
    const contentType = (res.headers && (res.headers['content-type'] as string | undefined)) || undefined;
    let bodyText = typeof res.data === 'string' ? res.data : String(res.data);

    const ext: 'html' | 'json' | 'txt' = contentType
      ? (/html/i.test(contentType) ? 'html' : /json/i.test(contentType) ? 'json' : 'txt')
      : (/^[\s\n]*[\[{]/.test(bodyText) ? 'json' : 'txt');

    if (ext === 'html') {
      bodyText = rewriteLinks(bodyText, docPath, discovered);
    } else if (ext === 'json') {
      // pretty print JSON for readability
      try {
        const obj = typeof res.data === 'string' ? JSON.parse(bodyText) : res.data;
        bodyText = JSON.stringify(obj, null, 2);
      } catch {
        // leave as-is if parsing fails
      }
    }

    const outFile = toLocalFile(docPath, ext);
    await saveFile(outFile, bodyText);
    console.log(`Saved ${docPath} -> ${outFile}`);
  }

  console.log(`Done. Saved ${discovered.size} pages under ${OUTPUT_ROOT}`);
}

if (require.main === module) {
  scrapeDocs().catch(err => {
    console.error('Scrape failed:', err);
    process.exit(1);
  });
}
