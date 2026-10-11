// Builds single-file versions of the Edge Functions that import ../_shared/engine.ts,
// for people who paste code into the Supabase dashboard editor instead of using the CLI.
//   node scripts/bundle-functions.mjs        ->  supabase/single-file/<function>.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const engine = readFileSync('supabase/functions/_shared/engine.ts', 'utf8').replace(/^export /gm, '');
const importRe = /import \{[^}]*\} from "\.\.\/_shared\/engine\.ts";\n/;
mkdirSync('supabase/single-file', { recursive: true });

for (const name of ['scheduled-scan', 'track-signal']) {
  const src = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8');
  if (!importRe.test(src)) throw new Error(`${name}: engine import not found`);
  const marker = src.match(importRe)[0];
  const at = src.indexOf(marker);
  const out =
    src.slice(0, at) +
    '\n// ===== INLINED COPY of supabase/functions/_shared/engine.ts (single-file build) =====\n' +
    engine +
    '\n// ===== end of inlined engine =====\n\n' +
    src.slice(at + marker.length);
  writeFileSync(`supabase/single-file/${name}.ts`, out);
  console.log(`built supabase/single-file/${name}.ts`);
}
