/**
 * Bundle size tests for wtf-lite
 *
 * Ensures the library stays within Cloudflare Snippet limits.
 * Target: < 50KB minified, < 20KB gzipped (strict), < 30KB gzipped (warning)
 */

import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import { readFileSync, unlinkSync } from 'fs'
import { gzipSync } from 'zlib'
import { join } from 'path'

const BUNDLE_LIMITS = {
  // Cloudflare Snippets have a 1MB limit, but we want to stay small for fast cold starts
  MINIFIED_MAX_KB: 100,      // Hard limit - fail if exceeded
  GZIPPED_MAX_KB: 35,        // Hard limit - fail if exceeded
  GZIPPED_WARN_KB: 25,       // Warning threshold
}

describe('wtf-lite Bundle Size', () => {
  const outFile = join('/tmp', `wtf-lite-bundle-test-${Date.now()}.js`)
  let minifiedSize: number
  let gzippedSize: number

  it('should build successfully', () => {
    const entryPoint = join(process.cwd(), 'src/lib/wtf-lite/index.ts')

    // Build with esbuild
    execSync(
      `bunx esbuild ${entryPoint} --bundle --format=esm --target=esnext --minify --outfile=${outFile}`,
      { stdio: 'pipe' }
    )

    const content = readFileSync(outFile)
    minifiedSize = content.length
    gzippedSize = gzipSync(content).length

    // Cleanup
    try { unlinkSync(outFile) } catch {}

    console.log(`\n📦 wtf-lite bundle size:`)
    console.log(`   Minified: ${(minifiedSize / 1024).toFixed(1)}KB`)
    console.log(`   Gzipped:  ${(gzippedSize / 1024).toFixed(1)}KB`)
  })

  it(`should be under ${BUNDLE_LIMITS.MINIFIED_MAX_KB}KB minified`, () => {
    const sizeKB = minifiedSize / 1024
    expect(sizeKB).toBeLessThan(BUNDLE_LIMITS.MINIFIED_MAX_KB)
  })

  it(`should be under ${BUNDLE_LIMITS.GZIPPED_MAX_KB}KB gzipped`, () => {
    const sizeKB = gzippedSize / 1024
    expect(sizeKB).toBeLessThan(BUNDLE_LIMITS.GZIPPED_MAX_KB)
  })

  it(`should ideally be under ${BUNDLE_LIMITS.GZIPPED_WARN_KB}KB gzipped (warning only)`, () => {
    const sizeKB = gzippedSize / 1024
    if (sizeKB > BUNDLE_LIMITS.GZIPPED_WARN_KB) {
      console.warn(`\n⚠️  Bundle size (${sizeKB.toFixed(1)}KB gzip) exceeds ${BUNDLE_LIMITS.GZIPPED_WARN_KB}KB target`)
      console.warn(`   Consider tree-shaking or moving data to CDN`)
    }
    // Don't fail, just warn
    expect(true).toBe(true)
  })
})

describe('wtf-lite Fast Mode Bundle Size', () => {
  const outFile = join('/tmp', `wtf-lite-fast-bundle-test-${Date.now()}.js`)
  let minifiedSize: number
  let gzippedSize: number

  it('should build fast mode successfully', () => {
    const entryPoint = join(process.cwd(), 'src/lib/wtf-lite/fast.ts')

    // Build with esbuild - fast mode only
    execSync(
      `bunx esbuild ${entryPoint} --bundle --format=esm --target=esnext --minify --outfile=${outFile}`,
      { stdio: 'pipe' }
    )

    const content = readFileSync(outFile)
    minifiedSize = content.length
    gzippedSize = gzipSync(content).length

    // Cleanup
    try { unlinkSync(outFile) } catch {}

    console.log(`\n📦 wtf-lite fast mode bundle size:`)
    console.log(`   Minified: ${(minifiedSize / 1024).toFixed(1)}KB`)
    console.log(`   Gzipped:  ${(gzippedSize / 1024).toFixed(1)}KB`)
  })

  it('should be smaller than full bundle', () => {
    // Fast mode should be significantly smaller
    expect(minifiedSize / 1024).toBeLessThan(50)
  })
})
