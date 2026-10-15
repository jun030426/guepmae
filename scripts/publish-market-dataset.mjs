import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { validateReceipt } from './build-market-dataset.mjs';

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
if (url !== 'https://oormfipegcfbhvctikfl.supabase.co') throw new Error('This publisher only supports the guepmae project');
const client = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const mode = process.argv[2];
const cache = path.resolve('scripts/data/market/cache.zip');
const bucket = client.storage.from('pipeline-data');
if (mode === 'download') {
  const { data, error } = await bucket.download('market-v1/cache.zip');
  if (error) { console.error('Complete market cache unavailable; bootstrap with fetch-market-trades.py first.'); process.exitCode=1; }
  else { await fs.mkdir(path.dirname(cache), { recursive:true }); await fs.writeFile(cache,Buffer.from(await data.arrayBuffer())); console.log('Private market cache downloaded.'); }
} else if (mode === 'publish' || mode === 'check') {
  const root = path.resolve('scripts/output/market');
  const manifest = JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
  validateReceipt(manifest.source, manifest.source.sha256);
  const tables = ['complex_trades','complex_prices','price_trends','market_snapshots'];
  const inputs = {};
  for (const name of tables) {
    const bytes = await fs.readFile(path.join(root,name+'.json'));
    if (createHash('sha256').update(bytes).digest('hex') !== manifest.tables[name]?.sha256) throw new Error('Dataset checksum mismatch');
    inputs[name] = JSON.parse(bytes);
    if (!inputs[name].length || inputs[name].length !== manifest.tables[name].rows) throw new Error('Dataset row count mismatch');
  }
  console.log('Dataset checksums and counts validated.');
  if (mode === 'publish') {
    const resume = process.argv[3];
    if (resume && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(resume)) throw new Error('Invalid resume run ID');
    const run = resume || randomUUID();
    const archive = await fs.readFile(cache);
    // Preserve the exact source used by this run before publishing its data.
    // The stable checkpoint is changed only after the DB transaction succeeds.
    const archivePath = `market-v1/runs/${run}.zip`;
    if (!resume) ok(await bucket.upload(archivePath, archive, { contentType:'application/octet-stream' }));
    try {
      if (!resume) for (const name of tables) {
        for (let start=0;start<inputs[name].length;start+=250) {
          const batch=inputs[name].slice(start,start+250).map((payload,index)=>({run_id:run,kind:name,row_no:start+index,payload}));
          ok(await client.from('market_import_rows').insert(batch));
        }
        console.log(`Staged ${name}: ${inputs[name].length}`);
      }
      ok(await client.rpc('publish_market_dataset', { p_run:run,p_manifest:manifest }));
      for (const name of tables) {
        const {count,error}=await client.from(name).select('*',{count:'exact',head:true});
        if(error || count!==inputs[name].length) throw new Error(`Published count mismatch: ${name}`);
      }
      ok(await bucket.upload('market-v1/cache.zip',archive,{contentType:'application/octet-stream',upsert:true}));
      ok(await bucket.upload('market-v1/manifest.json',JSON.stringify(manifest),{contentType:'application/json',upsert:true}));
      console.log('Atomic market publication verified.');
    } catch (error) {
      // Report the actual publishing error. A second timeout during cleanup
      // must not obscure it. This run can be retried without uploading again.
      console.error(`Market publication failed; isolated staging run: ${run}`);
      throw error;
    }
    ok(await bucket.remove([archivePath]));
  }
} else { throw new Error('Use download, check, or publish'); }
