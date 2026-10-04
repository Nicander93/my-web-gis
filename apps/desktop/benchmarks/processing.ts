import type { ProcessingResult } from '@desktop-webgis/gis-core'
import { runProcessingWorker } from '../src/services/processing-worker'
import { complexCases, verifyComplexResult, type ComplexCase } from '../../../packages/spatial-analysis/examples/complex-fixtures.mjs'

const runButton = document.querySelector<HTMLButtonElement>('#run')!
const cancelButton = document.querySelector<HTMLButtonElement>('#cancel-test')!
const limitButton = document.querySelector<HTMLButtonElement>('#limit-test')!
const select = document.querySelector<HTMLSelectElement>('#size')!
const status = document.querySelector<HTMLElement>('#status')!
const output = document.querySelector<HTMLElement>('#result')!

function heartbeat() {
  let last = performance.now(), maximum = 0, count = 0
  const timer = setInterval(() => { const now = performance.now(); maximum = Math.max(maximum, now - last); last = now; count++ }, 10)
  return () => { clearInterval(timer); return { ticks: count, maxTimerGapMs: Math.round(Math.max(maximum, performance.now() - last) * 1000) / 1000 } }
}

async function runCase(testCase: ComplexCase) {
  const stop = heartbeat()
  const start = performance.now()
  const pending = runProcessingWorker<ProcessingResult>(testCase, new AbortController().signal)
  const dispatchMs = performance.now() - start
  try {
    const result = await pending
    const elapsedMs = performance.now() - start
    const pulse = stop()
    verifyComplexResult(testCase, result.features)
    return { id: testCase.id, inputCount: testCase.features.length, outputCount: result.features.length, dispatchMs, elapsedMs, ...pulse }
  } finally { stop() }
}

async function run(mode: 'normal' | 'cancel' | 'limit') {
  runButton.disabled = cancelButton.disabled = limitButton.disabled = select.disabled = true
  status.textContent = '运行中…'
  output.textContent = '等待真实 Worker 返回'
  try {
    const size = Number(select.value)
    const cases = complexCases(size)
    const rows = []
    if (mode === 'limit') {
      const testCase = complexCases(10000)[0]
      const stop = heartbeat()
      const start = performance.now()
      try {
        await runProcessingWorker<ProcessingResult>({ ...testCase, options: { ...testCase.options, maxResults: 100000 } }, new AbortController().signal)
        throw new Error('应超过结果上限，但收到成功结果。')
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('超过 100000')) throw error
        rows.push({ id: 'bounded-overlap-join', inputCount: 10000, maxResults: 100000, state: 'rejected-without-results', error: error.message, elapsedMs: performance.now() - start, ...stop() })
      } finally { stop() }
    } else if (mode === 'cancel') {
      const abort = new AbortController()
      const start = performance.now()
      const pending = runProcessingWorker<ProcessingResult>(cases[0], abort.signal)
      let abortAt = 0
      const timer = setTimeout(() => { abortAt = performance.now(); abort.abort() }, 50)
      try { await pending; throw new Error('任务在取消前已完成；该规模没有验证取消路径。') }
      catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'AbortError') throw error
        rows.push({ id: 'cancel-after-dispatch', inputCount: size, requestedDelayMs: 50, actualAbortDelayMs: abortAt - start, rejectionAfterAbortMs: performance.now() - abortAt, state: 'AbortError', note: 'Worker may still be starting; this does not prove cancellation after algorithm entry.' })
      } finally { clearTimeout(timer) }
      rows.push(await runCase(complexCases(10)[0]))
    } else {
      const idle = heartbeat()
      await new Promise(resolve => setTimeout(resolve, 100))
      rows.push({ id: 'idle-timer-baseline', ...idle() })
      for (const testCase of cases) rows.push(await runCase(testCase))
    }
    output.textContent = JSON.stringify({ userAgent: navigator.userAgent, visibility: document.visibilityState, samples: 1, dataset: 'Deterministic synthetic data; no map rendering or Store commits', rows }, null, 2)
    status.textContent = '验证通过'
  } catch (error) {
    status.textContent = '验证失败'
    output.textContent = error instanceof Error ? error.message : String(error)
  } finally { runButton.disabled = cancelButton.disabled = limitButton.disabled = select.disabled = false }
}

runButton.addEventListener('click', () => void run('normal'))
cancelButton.addEventListener('click', () => void run('cancel'))
limitButton.addEventListener('click', () => void run('limit'))
