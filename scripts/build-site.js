const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'site-files.json'),'utf8'));
const output=path.resolve(root,'dist');
const verify=process.argv.includes('--verify-original');

function within(base,relative){
  const resolved=path.resolve(base,relative);
  if(!resolved.startsWith(base+path.sep))throw new Error('Asset path escapes its directory: '+relative);
  return resolved;
}

// Validate every source before replacing the generated publish directory.
const assets=manifest.files.map(file=>{
  const source=within(root,file.source || file.path);
  const bytes=fs.readFileSync(source);
  if(verify && crypto.createHash('sha1').update(bytes).digest('hex')!==file.sha1)
    throw new Error('Restored asset differs from selected deploy: '+file.path);
  return {destination:within(output,file.path),bytes};
});
if(path.dirname(output)!==root || path.basename(output)!=='dist')throw new Error('Invalid build directory');
if(fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink())throw new Error('Build directory must not be a symlink');
fs.rmSync(output,{recursive:true,force:true});
for(const asset of assets){
  fs.mkdirSync(path.dirname(asset.destination),{recursive:true});
  fs.writeFileSync(asset.destination,asset.bytes);
}
console.log('Built '+assets.length+' website assets'+(verify?' matching deploy '+manifest.sourceDeploy: '')+'.');
