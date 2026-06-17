/*
 * ONNX inference Web Worker.
 *
 * Runs the FER+ emotion model off the main thread so webcam capture and React
 * rendering stay smooth. The main thread sends preprocessed 64x64 grayscale
 * Float32 data; the worker runs the ONNX session and posts back a softmax
 * probability vector over the 5 emotions we surface.
 *
 * FER+ raw outputs are 8 logits in this order:
 *   [neutral, happiness, surprise, sadness, anger, disgust, fear, contempt]
 * We collapse them to {Happy, Sad, Angry, Fear, Neutral}; "surprise",
 * "disgust" and "contempt" are folded into the nearest of our five buckets.
 */
import * as ort from 'onnxruntime-web'

// ORT 1.26 WASM configuration.
// wasmPaths must be an absolute, origin-qualified URL so that ORT's
// internal dynamic import() of the WASM glue is NOT rewritten by Vite.
// A bare "/ort/" gets transformed to "/ort/?import" by Vite and fails.
const ORT_BASE =
  (typeof self !== 'undefined' && self.location && self.location.origin
    ? self.location.origin
    : '') + '/ort/'

// ORT 1.26 uses env.wasm.wasmPaths
ort.env.wasm.wasmPaths = ORT_BASE
ort.env.wasm.numThreads = 1  // single-threaded: avoids SharedArrayBuffer requirement

const MODEL_URL = '/models/emotion-ferplus-8.onnx'
const CACHE_NAME = 'mindease-model-cache-v2'  // bumped to clear any stale cached model


// FER+ class index -> our 5-bucket label.
const FERPLUS_TO_BUCKET = [
  'Neutral', // 0 neutral
  'Happy', // 1 happiness
  'Happy', // 2 surprise  -> positive arousal
  'Sad', // 3 sadness
  'Angry', // 4 anger
  'Angry', // 5 disgust   -> nearest negative/high-tension
  'Fear', // 6 fear
  'Sad', // 7 contempt  -> nearest low-mood
]

const BUCKETS = ['Happy', 'Sad', 'Angry', 'Fear', 'Neutral']

let session = null
let inputName = null
let loading = null

async function fetchModelWithCache() {
  try {
    const cache = await caches.open(CACHE_NAME)
    const cachedResponse = await cache.match(MODEL_URL)
    if (cachedResponse) {
      console.log('[worker] Model loaded from CacheStorage')
      return await cachedResponse.arrayBuffer()
    }
    console.log('[worker] Model not in CacheStorage, fetching...')
    const response = await fetch(MODEL_URL)
    if (!response.ok) {
      throw new Error(`Failed to fetch model: ${response.statusText}`)
    }
    // Clone response before caching
    await cache.put(MODEL_URL, response.clone())
    console.log('[worker] Model cached in CacheStorage')
    return await response.arrayBuffer()
  } catch (err) {
    console.warn('[worker] CacheStorage error, falling back to direct fetch:', err)
    const response = await fetch(MODEL_URL)
    return await response.arrayBuffer()
  }
}

async function getSession() {
  if (session) return session
  if (!loading) {
    loading = (async () => {
      const modelBuffer = await fetchModelWithCache()
      const s = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      })
      session = s
      inputName = s.inputNames[0]
      return s
    })()
  }
  return loading
}

function softmax(arr) {
  const max = Math.max(...arr)
  const exps = arr.map((v) => Math.exp(v - max))
  const sum = exps.reduce((a, b) => a + b, 0)
  return exps.map((v) => v / sum)
}

// Collapse the 8 FER+ probabilities into our 5 buckets, then renormalize.
function toBuckets(probs8) {
  const out = { Happy: 0, Sad: 0, Angry: 0, Fear: 0, Neutral: 0 }
  probs8.forEach((p, i) => {
    out[FERPLUS_TO_BUCKET[i]] += p
  })
  const total = BUCKETS.reduce((a, k) => a + out[k], 0) || 1
  BUCKETS.forEach((k) => {
    out[k] = out[k] / total
  })
  return out
}

self.onmessage = async (e) => {
  const { type, data, frameId } = e.data

  if (type === 'init') {
    try {
      await getSession()
      self.postMessage({ type: 'ready' })
    } catch (err) {
      self.postMessage({ type: 'error', error: String(err) })
    }
    return
  }

  if (type === 'infer') {
    try {
      const sess = await getSession()
      // FER+ expects shape [1,1,64,64], raw grayscale values (0-255).
      const tensor = new ort.Tensor('float32', data, [1, 1, 64, 64])
      const results = await sess.run({ [inputName]: tensor })
      const logits = Array.from(results[sess.outputNames[0]].data)
      const probs = softmax(logits)
      const buckets = toBuckets(probs)
      self.postMessage({ type: 'result', frameId, emotions: buckets })
    } catch (err) {
      self.postMessage({ type: 'error', frameId, error: String(err) })
    }
  }
}
