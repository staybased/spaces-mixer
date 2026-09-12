// Regression smoke checks for SEC-01/02, not a complete security audit. Fake OBS and synthetic files only.
import { strict as assert } from "node:assert";
// Run: bun scripts/audit-repro.ts
import { runSetup, NAMES, FILTERS } from '../src/setup';
import { writeAtomic } from '../src/obs-config';
import { mkdtempSync, writeFileSync, chmodSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const calls: {type:string,data:any}[] = [];
const fake = {
  async call(type:string,data:any = {}) {
    calls.push({type,data});
    if(type === 'GetSceneCollectionList') return {currentSceneCollectionName:NAMES.collection};
    if(type === 'GetSceneList') return {scenes:[{sceneName:NAMES.scene}]};
    if(type === 'GetInputList') return {inputs:[{inputName:NAMES.music,inputKind:'coreaudio_input_capture'},{inputName:NAMES.mic,inputKind:'coreaudio_input_capture'}]};
    if(type === 'GetSceneItemList') return {sceneItems:[{sourceName:NAMES.music,sceneItemId:1,sceneItemEnabled:true},{sourceName:NAMES.mic,sceneItemId:2,sceneItemEnabled:true}]};
    if(type === 'GetInputPropertiesListPropertyItems') return {propertyItems:[{itemName:'Different mic',itemValue:'existing-mic',itemEnabled:true}]};
    if(type === 'GetSourceFilterList') return {filters:(data.sourceName === NAMES.music ? FILTERS.music : FILTERS.mic).map(f=>({filterName:f.name,filterKind:f.kind,filterEnabled:true}))};
    return {};
  }
};
let setupError = '';
try {
  await runSetup(fake as any,{browserBundleId:'org.mozilla.firefox',browserRunning:true,tapDevicePresent:true,micDeviceUid:'missing-explicit-mic'},()=>{});
} catch (error) {
  setupError = (error as Error).message;
}
const micMonitoring = calls.filter(c=>c.type==='SetInputAudioMonitorType' && c.data.inputName===NAMES.mic);
assert.match(setupError, /selected microphone is not connected/);
assert(micMonitoring.length > 0 && micMonitoring.every(c=>c.data.monitorType==='OBS_MONITORING_TYPE_NONE'));
assert(calls.some(c=>c.type==='SetInputMute' && c.data.inputName===NAMES.mic && c.data.inputMuted===true));
console.log(JSON.stringify({case:'missing explicit mic',passed:true,error:setupError,micMonitoring},null,2));
const directory = mkdtempSync(join(tmpdir(),'spaces-mixer-audit-'));
const path = join(directory,'fake-config.json');
writeFileSync(path,'{"fake":true}',{mode:0o600}); chmodSync(path,0o600);
const mask = process.umask(0o022);
try {
  writeAtomic(path,'{"fake":false}');
  const after = (statSync(path).mode & 0o777).toString(8);
  const backup = (statSync(path+'.spaces-mixer.bak').mode & 0o777).toString(8);
  assert.equal(after, '600');
  assert.equal(backup, '600');
  console.log(JSON.stringify({case:'private file atomic replacement under umask 022',passed:true,before:'600',after,backup}));
} finally {
  process.umask(mask);
  rmSync(directory, { recursive: true }); // only the synthetic directory created above
}
