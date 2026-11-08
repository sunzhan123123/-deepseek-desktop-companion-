/** Edge discovery for the optional server CLI --open switch; never starts it here. */
import {existsSync,readFileSync} from 'node:fs';
import {resolve,join,isAbsolute} from 'node:path';

const fullyAbsolute=value=>process.platform==='win32'?/^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/iu.test(value):isAbsolute(value);

export function companionEdgeCandidates({packageRoot,environment=process.env,settings={}}){
 if(settings.edgeExe!=null&&typeof settings.edgeExe!=='string')throw Error('edgeExe in companion-settings.local.json must be a path string');
 const override=settings.edgeExe?.trim();
 if(override){
  if(isAbsolute(override)&&!fullyAbsolute(override))throw Error('Use a full absolute edgeExe path or a package-relative path');
  if(/^[a-z]:[^\\/]/iu.test(override))throw Error('Drive-relative edgeExe paths are not supported');
  return [resolve(packageRoot,override)];
 }
 return [...new Set(['LOCALAPPDATA','ProgramW6432','ProgramFiles','ProgramFiles(x86)'].map(key=>environment[key]).filter(value=>typeof value==='string'&&value.trim()&&fullyAbsolute(value)).map(base=>join(base,'Microsoft','Edge','Application','msedge.exe')))];
}

export function findCompanionEdge(packageRoot,{environment=process.env,exists=existsSync}={}){
 const settingsPath=join(packageRoot,'companion-settings.local.json');
 let settings={};
 if(exists(settingsPath)){
  try{settings=JSON.parse(readFileSync(settingsPath,'utf8').replace(/^\uFEFF/u,''));}catch{throw Error('Cannot read companion-settings.local.json');}
  if(!settings||typeof settings!=='object'||Array.isArray(settings))throw Error('companion-settings.local.json must be a JSON object');
 }
 const edge=companionEdgeCandidates({packageRoot,environment,settings}).find(candidate=>exists(candidate));
 if(!edge)throw Error('Microsoft Edge was not found. Set edgeExe in companion-settings.local.json or install Edge manually.');
 return edge;
}
