import 'fake-indexeddb/auto';
import fs from 'fs';
import path from 'path';
// db.ts checks typeof window — provide one backed by fake-indexeddb
(globalThis as any).window = globalThis;
import { cklToChecklist } from '../ckl';
import { IDB } from '@/app/db';

it('idb round trip with window', async () => {
  const checklist = cklToChecklist(fs.readFileSync(path.join(__dirname, 'fixtures/U_Microsoft_Skype_for_Business_2016_V1R1_STIG.ckl'), 'utf8'));
  await IDB.importChecklist(checklist);
  let exported: any = 'PENDING';
  try {
    exported = await IDB.exportChecklist(checklist.id);
    console.log('exported:', exported === undefined ? 'UNDEFINED' : exported === null ? 'NULL' : `OK stigs=${exported.stigs.length} rules0=${exported.stigs[0]?.rules?.length} title=${exported.title}`);
  } catch (e: any) {
    console.log('EXPORT THREW:', e.message);
  }
  const links = await IDB.checklistStigs.getAll();
  console.log('links:', JSON.stringify(links));
  const rules = await IDB.rules.getAll();
  console.log('rules stored:', rules.length, 'missing uuid:', rules.filter((r: any) => !r.uuid).length);
});
