import esbuild from "esbuild";
import process from "process";
import builtins from 'builtin-modules';
import copyStaticFiles from 'esbuild-copy-static-files';

const banner =
`/*
THIS IS A GENERATED/BUNDLED FILE BY ESBUILD
if you want to view the source, please visit the github repository of this plugin
*/
`;

const prod = (process.argv[2] === 'production');

esbuild.build({
	banner: {
		js: banner,
	},
	entryPoints: ['src/main.ts'],
	bundle: true,
	external: [
		'obsidian',
		'electron',
		'@codemirror/autocomplete',
		'@codemirror/collab',
		'@codemirror/commands',
		'@codemirror/language',
		'@codemirror/lint',
		'@codemirror/search',
		'@codemirror/state',
		'@codemirror/view',
		'@lezer/common',
		'@lezer/highlight',
		'@lezer/lr',
		...builtins],
	format: 'cjs',
	watch: !prod,
	target: 'es2018',
	logLevel: "info",
	sourcemap: prod ? false : 'inline',
	treeShaking: true,
	minify: prod,
	outfile: prod ? './dist/main.js' : './test-vault/.obsidian/plugins/meld-encrypt/main.js',
	plugins:[
		copyStaticFiles({
			src: './src/styles.css',
			dest: prod ? './dist/styles.css' : './test-vault/.obsidian/plugins/meld-encrypt/styles.css',
		}),
		copyStaticFiles({
			src: './manifest.json',
			dest: prod ? './dist/manifest.json' : './test-vault/.obsidian/plugins/meld-encrypt/manifest.json',
		}),
	]
}).catch(() => process.exit(1));