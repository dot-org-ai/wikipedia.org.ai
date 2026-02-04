#!/usr/bin/env npx tsx
/**
 * Bundle all wtf_wikipedia static data into a single JSON file for CDN
 *
 * Usage: npx tsx scripts/bundle-wtf-data.ts
 *
 * This extracts data from node_modules/wtf_wikipedia/src/_data/ and creates
 * a consolidated JSON file at data/wtf-data.json
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

// Get the project root
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = join(__dirname, '..')

// Import all data from wtf_wikipedia
import disambigTemplates from '../node_modules/wtf_wikipedia/src/_data/disambig_templates.js'
import disambigTitles from '../node_modules/wtf_wikipedia/src/_data/disambig_titles.js'
import categories from '../node_modules/wtf_wikipedia/src/_data/categories.js'
import infoboxes from '../node_modules/wtf_wikipedia/src/_data/infoboxes.js'
import redirects from '../node_modules/wtf_wikipedia/src/_data/redirects.js'
import flags from '../node_modules/wtf_wikipedia/src/_data/flags.js'
import interwiki from '../node_modules/wtf_wikipedia/src/_data/interwiki.js'
import languages from '../node_modules/wtf_wikipedia/src/_data/languages.js'
import references from '../node_modules/wtf_wikipedia/src/_data/references.js'
import images from '../node_modules/wtf_wikipedia/src/_data/images.js'
import stubs from '../node_modules/wtf_wikipedia/src/_data/stubs.js'
import latLngs from '../node_modules/wtf_wikipedia/src/_data/lat-lngs.js'

// Build the consolidated data structure
// This extends the WtfData interface from src/lib/wtf-lite/types.ts
interface WtfDataBundle {
  // Core parsing data (used by wtf-lite)
  categories: string[]
  infoboxes: string[]
  redirects: string[]
  flags: [string, string, string][]

  // Extended data
  disambigTemplates: string[]
  disambigTitles: string[]
  images: string[]
  stubs: string[]
  references: string[]
  latLngs: [string, string][]

  // Maps (key-value data)
  interwiki: Record<string, string>
  languages: Record<string, string>

  // Metadata
  version: string
  generatedAt: string
  source: string
}

const wtfData: WtfDataBundle = {
  // Arrays
  categories: categories as string[],
  infoboxes: infoboxes as string[],
  redirects: redirects as string[],
  flags: flags as [string, string, string][],
  disambigTemplates: disambigTemplates as string[],
  disambigTitles: disambigTitles as string[],
  images: images as string[],
  stubs: stubs as string[],
  references: references as string[],
  latLngs: latLngs as [string, string][],

  // Objects
  interwiki: interwiki as Record<string, string>,
  languages: languages as Record<string, string>,

  // Metadata
  version: '1.0.0',
  generatedAt: new Date().toISOString(),
  source: 'wtf_wikipedia',
}

// Create output directory if needed
const outputDir = join(projectRoot, 'data')
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true })
}

// Write the JSON file
const outputPath = join(outputDir, 'wtf-data.json')
const jsonContent = JSON.stringify(wtfData, null, 2)
writeFileSync(outputPath, jsonContent)

// Calculate sizes
const prettySize = jsonContent.length
const minifiedContent = JSON.stringify(wtfData)
const minifiedSize = minifiedContent.length

// Also write a minified version for production
const minifiedPath = join(outputDir, 'wtf-data.min.json')
writeFileSync(minifiedPath, minifiedContent)

console.log('WTF Data Bundle Generated')
console.log('=========================')
console.log(`Output: ${outputPath}`)
console.log(`Minified: ${minifiedPath}`)
console.log()
console.log('Data counts:')
console.log(`  - categories: ${wtfData.categories.length} entries`)
console.log(`  - infoboxes: ${wtfData.infoboxes.length} entries`)
console.log(`  - redirects: ${wtfData.redirects.length} entries`)
console.log(`  - flags: ${wtfData.flags.length} entries`)
console.log(`  - disambigTemplates: ${wtfData.disambigTemplates.length} entries`)
console.log(`  - disambigTitles: ${wtfData.disambigTitles.length} entries`)
console.log(`  - images: ${wtfData.images.length} entries`)
console.log(`  - stubs: ${wtfData.stubs.length} entries`)
console.log(`  - references: ${wtfData.references.length} entries`)
console.log(`  - latLngs: ${wtfData.latLngs.length} entries`)
console.log(`  - interwiki: ${Object.keys(wtfData.interwiki).length} entries`)
console.log(`  - languages: ${Object.keys(wtfData.languages).length} entries`)
console.log()
console.log(`Size (pretty): ${(prettySize / 1024).toFixed(1)} KB`)
console.log(`Size (minified): ${(minifiedSize / 1024).toFixed(1)} KB`)
console.log()
console.log('CDN URL: https://cdn.workers.do/wtf-data.json')
