import { minify } from 'terser';
import { readFile, writeFile, mkdir, copyFile, readdir } from 'fs/promises';
import { join } from 'path';
import CleanCSS from 'clean-css';
import {execFileSync} from 'node:child_process';

const distDir = 'dist/moci';

async function buildJS() {
	console.log('Minifying JavaScript...');

	const files = [
		'moci/js/core.js',
		'moci/js/modules/dashboard.js',
		'moci/js/modules/wan.js',
		'moci/js/modules/published-ports.js',
		'moci/js/modules/devices.js',
		'moci/js/modules/wifi.js',
		'moci/js/modules/qos.js',
		'moci/js/modules/tls.js',
		'moci/js/modules/networks.js',
		'moci/js/modules/app-integrations.js',
		'moci/js/modules/network.js',
		'moci/js/modules/upnp.js',
		'moci/js/modules/system.js',
		'moci/js/modules/addons.js',
		'moci/js/modules/advanced.js',
		'moci/js/modules/profiles.js',
		'moci/js/modules/wifi-schedules.js',
		'moci/js/modules/wifi-profiles.js',
		'moci/js/modules/vpn-policies.js',
		'moci/js/modules/ethernet-profiles.js',
		'moci/js/modules/features.js',
		'moci/js/modules/bandwidth.js',
		'moci/js/modules/multiwan.js',
		'moci/js/modules/adblock.js',
		'moci/js/modules/tailscale.js',
		'moci/js/modules/terminal.js',
		'moci/js/modules/statistics.js',
		'moci/js/modules/nas.js'
	];

	await mkdir(join(distDir, 'js/modules'), { recursive: true });

	for (const file of files) {
		const code = await readFile(file, 'utf8');
		const result = await minify(code, {
			module: true,
			compress: {
				dead_code: true,
				drop_console: false,
				drop_debugger: true,
				pure_funcs: ['console.log']
			},
			mangle: {
				toplevel: true
			}
		});

		const outPath = file.replace('moci/', distDir + '/');
		await writeFile(outPath, result.code);
		console.log(`  ${file} -> ${outPath} (${((1 - result.code.length / code.length) * 100).toFixed(1)}% smaller)`);
	}
}

async function buildCSS() {
	console.log('Minifying CSS...');

	const css = await readFile('moci/app.css', 'utf8');
	const result = new CleanCSS({
		level: 2
	}).minify(css);

	await writeFile(join(distDir, 'app.css'), result.styles);
	console.log(
		`  moci/app.css -> ${distDir}/app.css (${((1 - result.styles.length / css.length) * 100).toFixed(1)}% smaller)`
	);
}

async function copyAssets() {
	console.log('Copying assets...');
	const html = await readFile('moci/index.html', 'utf8');
	await writeFile(join(distDir, 'index.html'), html);

	await copyFile('moci/manifest.json', join(distDir, 'manifest.json'));

	// OUI vendor registry is a large pre-generated data module; copy it as-is
	// (skip terser) and let the Devices page lazy-load it.
	await mkdir(join(distDir, 'js/modules'), { recursive: true });
	await copyFile('moci/js/modules/oui-data.js', join(distDir, 'js/modules/oui-data.js'));

	await mkdir(join(distDir, 'icons'), { recursive: true });
	const icons = await readdir('moci/icons');
	for (const icon of icons) {
		await copyFile(join('moci/icons', icon), join(distDir, 'icons', icon));
	}

	await mkdir(join(distDir, 'fonts'), { recursive: true });
	const fonts = await readdir('moci/fonts');
	for (const font of fonts) {
		await copyFile(join('moci/fonts', font), join(distDir, 'fonts', font));
	}
}

async function build() {
	execFileSync(process.execPath,['tests/text-encoding.test.mjs'],{stdio:'inherit'});
	console.log('Building production bundle...\n');
	await buildJS();
	await buildCSS();
	await copyAssets();
	console.log('\nBuild complete! Output in dist/');
}

build().catch(error => { console.error(error); process.exitCode = 1; });

