#!/usr/bin/env node
// MoCI local dev preview: serves the UI over trusted http://localhost and proxies
// the router's /ubus backend so features can be exercised against a real device
// without importing its self-signed certificate into the browser trust store.
//
//   node scripts/dev-preview.mjs [--router 192.168.50.1] [--port 8099] [--dist]
//
// Serves moci/ source by default (fast iteration); --dist serves the built bundle.
import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const router = arg('--router', process.env.MOCI_ROUTER || '192.168.50.1');
const port = Number(arg('--port', process.env.MOCI_PORT || '8099'));
const useDist = args.includes('--dist');
const webRoot = join(root, useDist ? 'dist/moci' : 'moci');

const MIME = {
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
	'.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
	'.ttf': 'font/ttf', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

function proxyUbus(req, res) {
	const chunks = [];
	req.on('data', c => chunks.push(c));
	req.on('end', () => {
		const body = Buffer.concat(chunks);
		const upstream = httpsRequest({
			host: router, port: 443, path: '/ubus', method: 'POST',
			rejectUnauthorized: false,
			headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
		}, up => {
			res.writeHead(up.statusCode || 502, { 'Content-Type': 'application/json' });
			up.pipe(res);
		});
		upstream.on('error', err => {
			res.writeHead(502, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: { message: 'Router unreachable: ' + err.message } }));
		});
		upstream.write(body);
		upstream.end();
	});
}

const addonRoot = join(root, 'integrations/docker-manager/moci-app-docker/files');
async function serveStatic(req, res) {
	let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
	if (path === '/') { res.writeHead(302, { Location: '/moci/index.html' }); return res.end(); }
	let file, base;
	if (path.startsWith('/moci/js/addons/docker/')) {
		base = addonRoot;
		file = normalize(join(addonRoot, path.slice('/moci/js/addons/docker/'.length)));
	} else {
		base = webRoot;
		const rel = path.startsWith('/moci/') ? path.slice('/moci/'.length) : path.replace(/^\//, '');
		file = normalize(join(webRoot, rel));
	}
	if (!file.startsWith(base)) { res.writeHead(403); return res.end('Forbidden'); }
	try {
		const s = await stat(file);
		if (!s.isFile()) throw new Error('not a file');
		const data = await readFile(file);
		res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
		res.end(data);
	} catch {
		res.writeHead(404, { 'Content-Type': 'text/plain' });
		res.end('Not found: ' + path);
	}
}

createServer((req, res) => {
	if (req.url.startsWith('/ubus')) return proxyUbus(req, res);
	return serveStatic(req, res);
}).listen(port, '127.0.0.1', () => {
	console.log(`MoCI dev preview: http://localhost:${port}  (backend -> https://${router})`);
	console.log(`Serving ${useDist ? 'dist/moci' : 'moci'} — log in with the router's root credentials.`);
});
