import { describe, it, expect } from 'vitest'
import { runPythonCode } from '../src/services/dockerRunner.js'

describe('dockerRunner', () => {
  // First run may need to build the Docker image, so allow extra time.
  const TEST_TIMEOUT_MS = 120000
  it('returns sum of input numbers', async () => {
    const result = await runPythonCode('OUTPUT = sum(INPUT)', { INPUT: [1, 2, 3] })
    expect(result.success).toBe(true)
    expect(result.output).toBe(6)
  }, TEST_TIMEOUT_MS)

  it('returns error for invalid code', async () => {
    const result = await runPythonCode('raise ValueError("bad")', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('bad')
  }, TEST_TIMEOUT_MS)
})
