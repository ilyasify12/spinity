const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const http=require('node:http'),net=require('node:net')
const {buildSync}=require('esbuild')
const root=fs.mkdtempSync(path.join(os.tmpdir(),'spinity-phone-'))
const out=(name)=>path.join(root,name)

// phoneServer.ts imports `app` from electron. The tests run the bundle under
// plain node, so electron is aliased to a stub with the two fields the module
// reads. The server itself is spawned with process.execPath (node here, the
// electron binary in the app) — that substitution is exactly what the stub
// must not disturb.
fs.writeFileSync(out('electron-stub.cjs'),
  `module.exports={app:{isPackaged:false,getAppPath:()=>${JSON.stringify(path.join(__dirname,'..'))}}}`
)
buildSync({
  entryPoints:[path.join(__dirname,'../src/main/phoneServer.ts')],
  bundle:true,platform:'node',format:'cjs',outfile:out('phone.cjs'),
  alias:{electron:out('electron-stub.cjs')}
})
process.env.SPINITY_PHONE_PORT='8903'
const phone=require(out('phone.cjs'))
const BASE='http://127.0.0.1:8903'

function get(url){return new Promise((resolve,reject)=>{
  const req=http.get(url,(res)=>{let body='';res.on('data',(c)=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body}))})
  req.setTimeout(8000,()=>req.destroy(new Error('http timeout')))
  req.on('error',reject)
})}

/** Windows keeps a port briefly after the holder dies: wait until connect is refused. */
async function waitPortFree(port,ms=6000){
  const start=Date.now()
  for(;;){
    const free=await new Promise((resolve)=>{
      const s=net.createConnection({port,host:'127.0.0.1'})
      s.on('connect',()=>{s.destroy();resolve(false)})
      s.on('error',()=>resolve(true))
    })
    if(free)return
    if(Date.now()-start>ms)throw new Error('port '+port+' never freed')
    await new Promise((r)=>setTimeout(r,150))
  }
}

test('status before starting: stopped, honest URLs, no error',()=>{
  const st=phone.phoneStatus()
  assert.equal(st.running,false)
  assert.equal(st.port,8903)
  assert.equal(st.localUrl,'http://localhost:8903/player')
  assert.ok(st.url===null||/^http:\/\/\d+\.\d+\.\d+\.\d+:8903\/player$/.test(st.url),'LAN url is either absent or a real LAN address')
  assert.equal(st.error,null)
  assert.deepEqual(st.log,[])
})

test('starts the real server, serves the player and the library, then stops',{timeout:40000},async()=>{
  const started=await phone.startPhoneServer()
  assert.equal(started.error,null)
  assert.equal(started.running,true,'server must be reported running')
  try {
    const page=await get(BASE+'/player')
    assert.equal(page.status,200)
    const lib=await get(BASE+'/api/library')
    assert.equal(lib.status,200)
    const data=JSON.parse(lib.body)
    assert.ok(Array.isArray(data.tracks),'library payload has a tracks array')
  } finally {
    const stopped=phone.stopPhoneServer()
    assert.equal(stopped.running,false)
  }
})

test('restarts on the same port once the old child is gone',{timeout:40000},async()=>{
  await waitPortFree(8903)
  const again=await phone.startPhoneServer()
  assert.equal(again.running,true)
  assert.equal(again.error,null)
  phone.stopPhoneServer()
  await waitPortFree(8903)
})

test('a busy port is reported as an error instead of a fake success',{timeout:40000},async()=>{
  const blocker=http.createServer(()=>{})
  await new Promise((resolve,reject)=>{
    blocker.once('error',reject)
    blocker.listen(8903,'0.0.0.0',resolve)
  })
  try {
    const st=await phone.startPhoneServer()
    assert.equal(st.running,false)
    assert.ok(st.error,'start on a busy port must surface the failure')
  } finally {
    phone.stopPhoneServer()
    await new Promise((r)=>blocker.close(r))
  }
})

test('stopping when nothing runs is a no-op',()=>{
  const st=phone.stopPhoneServer()
  assert.equal(st.running,false)
})

test('QR is a PNG data URL for the phone address (or empty with no LAN)',async()=>{
  const qr=await phone.phoneQr()
  if (phone.phoneStatus().url) assert.match(qr,/^data:image\/png;base64,/)
  else assert.equal(qr,'')
})

process.on('exit',()=>{
  try{phone.stopPhoneServer()}catch{}
  fs.rmSync(root,{recursive:true,force:true})
})
