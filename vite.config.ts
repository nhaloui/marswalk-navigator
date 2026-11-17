import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { copyFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type UserConfig } from 'vite'
import {prepareDust,dustCsv} from './scripts/prepare-dust-assets.mjs'

// https://vite.dev/config/
export default defineConfig(async()=>{
 await prepareDust()
 return {
  plugins: [react(), tailwindcss(), {
    name:'dust-csv-sync',
    configureServer(server){
      let pending=Promise.resolve()
      const sync=(file:string)=>{
        if(resolve(file)!==resolve(dustCsv))return
        pending=pending.then(()=>prepareDust()).then(()=>{server.ws.send({type:'full-reload'})}).catch((error:Error)=>{
          server.config.logger.error(`CSV Dust : ${error.message}`)
          server.ws.send({type:'error',err:{message:error.message,stack:error.stack??''}})
        })
      }
      server.watcher.add(dustCsv)
      server.watcher.on('change',sync).on('add',sync)
      server.httpServer?.once('close',()=>{server.watcher.off('change',sync).off('add',sync)})
    },
  }, {
    name: 'browser-assets-only',
    // Explicit allowlist: never publish scientific CSVs, TIFFs or unused exports.
    writeBundle(options) {
      const target = resolve(options.dir ?? 'dist', 'data/mars')
      mkdirSync(target, { recursive: true })
      for (const name of ['crater_ctx_10km.webp', 'crater_hillshade.png',
        'crater_elevation.f32', 'crater_elevation_color.png', 'crater_dust_scored.png',
        'crater_tes_dust.png']) {
        copyFileSync(fileURLToPath(new URL(`./public/data/mars/${name}`, import.meta.url)), resolve(target, name))
      }
    },
  }],
  build: { copyPublicDir: false },
  server: { proxy: { '/api': 'http://127.0.0.1:8000' },watch:{ignored:['**/.venv-dem/**','**/__pycache__/**']} },
  preview: { proxy: { '/api': 'http://127.0.0.1:8000' } },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
 } satisfies UserConfig
})
