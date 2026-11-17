import {spawn} from 'node:child_process'
import {existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
const root=fileURLToPath(new URL('..',import.meta.url))
const executable=fileURLToPath(new URL(process.platform==='win32'?'../.venv-dem/Scripts/python.exe':'../.venv-dem/bin/python',import.meta.url))
const python=existsSync(executable)?executable:process.platform==='win32'?'python':'python3'
let backend,closing=false
process.on('exit',()=>backend?.kill())
try{
 const response=await fetch('http://127.0.0.1:8000/api/health',{signal:AbortSignal.timeout(500)})
 if(!response.ok)throw Error('not ready')
 console.log('EVAPlanner : service local deja disponible.')
}catch{
 backend=spawn(python,['-m','uvicorn','backend.app:app','--host','127.0.0.1','--port','8000'],{cwd:root,stdio:'inherit',windowsHide:true})
 backend.on('error',error=>console.error('Service Python indisponible :',error.message,'Installer requirements-planner.txt.'))
 backend.on('exit',code=>{if(code&&!closing)console.error('EVAPlanner arrete. Installer les dependances : python -m pip install -r requirements-planner.txt')})
}
const server=await createServer({root})
await server.listen();server.printUrls()
const close=async()=>{if(closing)return;closing=true;await server.close();backend?.kill();process.exit(0)}
process.on('SIGINT',close);process.on('SIGTERM',close)
