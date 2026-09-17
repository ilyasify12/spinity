const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildSync } = require('esbuild')
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinity-player-test-'))
buildSync({entryPoints:[path.join(__dirname,'../src/renderer/src/player/engine.ts')],bundle:true,platform:'node',format:'cjs',outfile:path.join(out,'engine.cjs')})
class AudioMock extends EventTarget {
  constructor(){super();global.audio=this;this.duration=120;this.currentTime=0;this.readyState=1;this.paused=true;this.seekable={length:1,start:()=>0,end:()=>8}}
  play(){this.paused=false;return Promise.resolve()}
  pause(){this.paused=true}
  removeAttribute(){}
}
global.Audio=AudioMock
const {usePlayer}=require(path.join(out,'engine.cjs'))
const track={id:'test',source:'local',title:'Test',artist:'Fixture',durationSec:120,filePath:'test.wav',downloadedAt:0,thumbnail:'',webUrl:''}
test('seek requests the chosen timestamp, not the buffered/seekable end',()=>{
  const p=usePlayer.getState();p.playQueue([track]);p.seek(70)
  assert.equal(audio.currentTime,70)
  assert.equal(usePlayer.getState().currentTime,70)
  p.seek(15);assert.equal(audio.currentTime,15)
})
test('seek clamps only to track duration and ignores invalid input',()=>{
  const p=usePlayer.getState();p.playQueue([track]);p.seek(999)
  assert.equal(audio.currentTime,120)
  p.seek(NaN);assert.equal(audio.currentTime,120)
})
test('unknown media duration falls back to metadata',()=>{
  usePlayer.getState().playQueue([track]);audio.duration=Infinity
  audio.dispatchEvent(new Event('durationchange'))
  assert.equal(usePlayer.getState().duration,120)
})
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}))
