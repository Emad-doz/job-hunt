import {build} from 'esbuild-wasm';
import {mkdir} from 'node:fs/promises';
await mkdir('work',{recursive:true});
await build({entryPoints:['tests/check-daily.tsx'],bundle:true,platform:'node',format:'esm',target:'node22',outfile:'work/check-daily.mjs',loader:{'.css':'empty'},jsx:'automatic',external:['react','react-dom/server','lucide-react'],banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"},logLevel:'silent'});
await import('../work/check-daily.mjs');
await build({entryPoints:['tests/check-decisions.tsx'],bundle:true,platform:'node',format:'esm',target:'node22',outfile:'work/check-decisions.mjs',loader:{'.css':'empty'},jsx:'automatic',external:['react','react-dom/server','lucide-react'],banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"},logLevel:'silent'});
await import('../work/check-decisions.mjs');

await build({entryPoints:['tests/check-job-dates.tsx'],bundle:true,platform:'node',format:'esm',target:'node22',outfile:'work/check-job-dates.mjs',loader:{'.css':'empty'},jsx:'automatic',external:['react','react-dom/server','lucide-react'],banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"},logLevel:'silent'});
await import('../work/check-job-dates.mjs');
await build({entryPoints:['tests/check-unified-jobs.tsx'],bundle:true,platform:'node',format:'esm',target:'node22',outfile:'work/check-unified-jobs.mjs',loader:{'.css':'empty'},jsx:'automatic',external:['react','react-dom/server','lucide-react'],banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"},logLevel:'silent'});
await import('../work/check-unified-jobs.mjs');
await build({entryPoints:['tests/check-analyst-ai-ui.tsx'],bundle:true,platform:'node',format:'esm',target:'node22',outfile:'work/check-analyst-ai-ui.mjs',loader:{'.css':'empty'},jsx:'automatic',external:['react','react-dom/server','lucide-react'],banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"},logLevel:'silent'});
await import('../work/check-analyst-ai-ui.mjs');
