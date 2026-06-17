import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

// Workaround for Rollup/Vite dynamic import issue with @mediapipe/face_mesh.
// The package is UMD and does not export `FaceMesh` in a way Rollup can statically analyze.
function mediapipeFixPlugin() {
  return {
    name: 'mediapipe-fix',
    load(id) {
      if (id.replace(/\\/g, '/').endsWith('@mediapipe/face_mesh/face_mesh.js')) {
        let code = fs.readFileSync(id, 'utf-8')
        if (!code.includes('export { FaceMesh };')) {
          code += `
const FaceMesh = (typeof globalThis !== 'undefined' && globalThis.FaceMesh) || 
                 (typeof window !== 'undefined' && window.FaceMesh) || 
                 (typeof self !== 'undefined' && self.FaceMesh);
export { FaceMesh };
export default FaceMesh;
`
        }
        return { code }
      }
      return null
    }
  }
}

// COOP/COEP headers are required for SharedArrayBuffer, which onnxruntime-web
// uses for multi-threaded WASM inference (keeps inference off the main thread
// and lets us hit higher FPS). Applied to dev server and preview.
const crossOriginIsolation = {
  name: 'cross-origin-isolation',
  configureServer(server) {
    server.middlewares.use((_req, res, next) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
      next()
    })
  },
  configurePreviewServer(server) {
    server.middlewares.use((_req, res, next) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
      next()
    })
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), crossOriginIsolation, mediapipeFixPlugin()],
  // Only exclude WASM-based packages that cannot be pre-bundled by Vite.
  // TF.js packages MUST be pre-bundled (CJS→ESM conversion) or the browser
  // throws "module is not defined". Only onnxruntime-web and @mediapipe/face_mesh
  // use raw WASM loaders that break under Vite's optimizer.
  optimizeDeps: {
    exclude: ['onnxruntime-web', '@mediapipe/face_mesh'],
    include: [
      '@tensorflow/tfjs-core',
      '@tensorflow/tfjs-backend-webgl',
      '@tensorflow/tfjs-backend-cpu',
      '@tensorflow-models/face-landmarks-detection',
    ],
  },
  worker: {
    format: 'es',
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      // The @mediapipe/face_mesh package re-exports `FaceMesh` in a way Rollup
      // can't statically resolve. We use the tfjs runtime (not the mediapipe
      // one), so this import is never reached — silence only that warning.
      onwarn(warning, warn) {
        if (
          warning.code === 'IMPORT_IS_UNDEFINED' &&
          /face_mesh/.test(warning.message || '')
        ) {
          return
        }
        warn(warning)
      },
    },
  },
})
