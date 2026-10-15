const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {execFileSync}=require('node:child_process')
const {buildSync}=require('esbuild')
const root=fs.mkdtempSync(path.join(os.tmpdir(),'spinity-art-'))
const out=(name)=>path.join(root,name)

// Tools are located the way the app locates them (ytdlp.ts). Pinning one
// hard-coded install path here made these tests pass on machines where that
// path happened to exist and fail everywhere else — including after the
// Windows reinstall that broke artwork for real users.
buildSync({entryPoints:[path.join(__dirname,'../src/main/ytdlp.ts')],bundle:true,platform:'node',format:'cjs',outfile:out('tools.cjs')})
const {resolveFfmpeg,resolveFfprobe}=require(out('tools.cjs'))
const ffmpeg=resolveFfmpeg()
const ffprobe=resolveFfprobe()
assert.ok(ffmpeg,'ffmpeg is needed to build the fixtures')
assert.ok(ffprobe,'ffprobe is needed to build the fixtures')
process.env.SPINITY_FFMPEG=ffmpeg
process.env.SPINITY_FFPROBE=ffprobe

buildSync({entryPoints:[path.join(__dirname,'../src/main/artwork.ts')],bundle:true,platform:'node',format:'cjs',outfile:out('art.cjs')})
const {createArtworkLoader}=require(out('art.cjs'))
const cacheDir=out('cache')
const localArtwork=createArtworkLoader(cacheDir)
function ff(args){execFileSync(ffmpeg,['-nostdin','-v','error','-y',...args],{timeout:20000,windowsHide:true})}
const cover=path.join(root,'picture.png')
ff(['-f','lavfi','-i','color=c=red:s=64x64','-frames:v','1',cover])
const embedded=path.join(root,'embedded.mp3')
ff(['-f','lavfi','-i','sine=frequency=440:duration=2','-i',cover,'-map','0:a','-map','1:v','-c:a','libmp3lame','-c:v','copy','-id3v2_version','3','-disposition:v','attached_pic',embedded])
const plain=path.join(root,'plain.wav')
ff(['-f','lavfi','-i','sine=frequency=880:duration=2',plain])
const sideDir=path.join(root,'side');fs.mkdirSync(sideDir)
const side=path.join(sideDir,'track.wav');fs.copyFileSync(plain,side)
fs.copyFileSync(cover,path.join(sideDir,'Folder.PNG'))
const before=fs.readFileSync(embedded)
test('MP3 attached-picture metadata can be read without extracting it',()=>{
 const probe=JSON.parse(execFileSync(ffprobe,['-v','error','-show_streams','-of','json',embedded],{windowsHide:true,timeout:10000,maxBuffer:65536}).toString())
 assert.ok(probe.streams?.some(s=>s.disposition?.attached_pic===1))
})
test('extracts embedded artwork and leaves source audio untouched',async()=>{
  const art=await localArtwork(embedded)
  assert.equal(art.embedded,true)
  assert.ok(art.image?.length>0);assert.equal(art.image.subarray(0,2).toString('hex'),'ffd8')
  assert.deepEqual(fs.readFileSync(embedded),before)
})
test('never borrows folder art for a track without embedded art',async()=>{
 const art=await localArtwork(side)
 assert.equal(art.image,null)
 // Confirmed "no picture": only this verdict may open the door to a borrowed cover.
 assert.equal(art.embedded,false)
})
test('no artwork returns null; missing audio is unknown, not "no art"',async()=>{
 const none=await localArtwork(plain)
 assert.equal(none.image,null);assert.equal(none.embedded,false)
 const absent=await localArtwork(path.join(root,'absent.mp3'))
 assert.equal(absent.image,null);assert.equal(absent.embedded,null)
})
test('deduplicates concurrent extraction and uses cache',async()=>{
  const results=await Promise.all([localArtwork(embedded),localArtwork(embedded)])
  assert.deepEqual(results[0].image,results[1].image)
  assert.equal(results[0].embedded,results[1].embedded)
})
test('positive and negative disk cache survive restart without launching tools',async()=>{
  await localArtwork(embedded);await localArtwork(plain)
  const program=`const cp=require('node:child_process');cp.execFile=()=>{throw new Error('Unexpected subprocess')};const assert=require('node:assert/strict');const {createArtworkLoader}=require(${JSON.stringify(out('art.cjs'))});const load=createArtworkLoader(${JSON.stringify(cacheDir)});(async()=>{const yes=await load(${JSON.stringify(embedded)});assert.ok(yes.image?.length);assert.equal(yes.embedded,true);const no=await load(${JSON.stringify(plain)});assert.equal(no.image,null);assert.equal(no.embedded,false)})().catch(e=>{console.error(e);process.exit(1)})`
  execFileSync(process.execPath,['-e',program],{timeout:10000})
})
test('file changes invalidate previously cached no-art result',async()=>{
  const changed=path.join(root,'changed.mp3');fs.copyFileSync(plain,changed)
  assert.equal((await localArtwork(changed)).embedded,false)
  fs.copyFileSync(embedded,changed)
  const art=await localArtwork(changed)
  assert.ok(art.image?.length);assert.equal(art.embedded,true)
})
test('a probe that cannot run is reported as unknown and never cached',()=>{
  // SPINITY_FFPROBE wins over discovery: pointing it at node.exe makes every
  // probe fail, which is what a machine without ffprobe looks like.
  const fresh=out('cache-noprobe')
  const program=`process.env.SPINITY_FFPROBE=process.execPath;const assert=require('node:assert/strict');const fs=require('node:fs');const {createArtworkLoader}=require(${JSON.stringify(out('art.cjs'))});const load=createArtworkLoader(${JSON.stringify(fresh)});load(${JSON.stringify(embedded)}).then(art=>{assert.equal(art.image,null);assert.equal(art.embedded,null,'tools missing must not mean "this file has no cover"');assert.ok(!fs.existsSync(${JSON.stringify(fresh)})||fs.readdirSync(${JSON.stringify(fresh)}).length===0,'nothing may be cached without a verdict');console.log('ok')}).catch(e=>{console.error(e);process.exit(1)})`
  const stdout=execFileSync(process.execPath,['-e',program],{timeout:20000,encoding:'utf8'})
  assert.match(stdout,/ok/)
})
process.on('exit',()=>fs.rmSync(root,{recursive:true,force:true}))
