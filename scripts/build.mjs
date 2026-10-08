import {build} from 'esbuild-wasm';
import {mkdir,writeFile,readFile,copyFile} from 'node:fs/promises';
await mkdir('dist/client/assets',{recursive:true});await mkdir('dist/server',{recursive:true});
await build({entryPoints:['app/client.tsx'],bundle:true,splitting:true,format:'esm',platform:'browser',target:'es2022',outdir:'dist/client/assets',entryNames:'main',chunkNames:'chunk-[hash]',minify:true,define:{'process.env.NODE_ENV':'"production"'},jsx:'automatic',logLevel:'info'});
await build({entryPoints:['server/worker.ts'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'dist/server/index.js',minify:true,logLevel:'info'});
await build({entryPoints:['server/pdf-worker.mjs'],bundle:true,format:'cjs',platform:'node',target:'node22',outfile:'dist/server/pdf-reader.cjs',minify:true,logLevel:'info'});
await build({entryPoints:['server/db-client.mjs'],bundle:true,format:'esm',platform:'node',target:'node22',outfile:'dist/server/db-client.mjs',minify:true,banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"},logLevel:'info'});
await build({entryPoints:['server/model-client.mjs'],bundle:true,format:'esm',platform:'node',target:'node22',outfile:'dist/server/model-client.mjs',minify:true,banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"},logLevel:'info'});
await copyFile('public/favicon.svg','dist/client/favicon.svg');
await writeFile('dist/client/index.html','<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#101418"><title>Job Hunt</title><meta name="description" content="Your job search, on your own machine."><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/assets/main.css"></head><body><div id="root"></div><script type="module" src="/assets/main.js"></script></body></html>');
console.log('Job Hunt built into dist/.');

