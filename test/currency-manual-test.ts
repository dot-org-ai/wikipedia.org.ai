/**
 * Manual test for currency template parsing
 * Run with: npx tsx test/currency-manual-test.ts
 */

import wtf from '../src/lib/wtf-lite/index'

interface TestCase {
  name: string
  input: string
  expected: string
  type?: 'text' | 'infobox'
  infoboxKey?: string
}

const tests: TestCase[] = [
  // Basic currency templates with ISO codes
  { name: 'USD with number', input: 'Price {{USD|1000}}.', expected: 'US$1,000' },
  { name: 'GBP with number', input: 'Cost {{GBP|500}}.', expected: 'GB£500' },
  { name: 'EUR with number', input: 'Worth {{EUR|2500000}}.', expected: '€2,500,000' },
  { name: 'JPY with number', input: 'Price {{JPY|100000}}.', expected: '¥100,000' },

  // Named currency templates
  { name: 'US dollar template', input: 'Budget {{US dollar|1000000}}.', expected: 'US$1,000,000' },
  { name: 'US$ template', input: 'Budget {{US$|50 million}}.', expected: 'US$50 million' },

  // Currency with text amounts
  { name: 'USD with text amount', input: 'Revenue {{USD|1.5 billion}}.', expected: 'US$1.5 billion' },

  // In infobox
  {
    name: 'Currency in infobox',
    input: '{{Infobox company|revenue={{US$|100 million}}}}',
    expected: 'US$100 million',
    type: 'infobox',
    infoboxKey: 'revenue'
  },
  {
    name: 'GBP in infobox',
    input: '{{Infobox company|budget={{GBP|500}}}}',
    expected: 'GB£500',
    type: 'infobox',
    infoboxKey: 'budget'
  },
]

let passed = 0
let failed = 0

console.log('Currency Template Tests\n' + '='.repeat(50))

for (const test of tests) {
  const doc = wtf(test.input)
  let result: string

  if (test.type === 'infobox' && test.infoboxKey) {
    const infobox = doc.infoboxes()[0]
    result = infobox?.get(test.infoboxKey)?.text() || ''
  } else {
    result = doc.text()
  }

  const success = result.includes(test.expected)

  if (success) {
    console.log(`PASS: ${test.name}`)
    passed++
  } else {
    console.log(`FAIL: ${test.name}`)
    console.log(`  Input:    ${test.input}`)
    console.log(`  Expected: ${test.expected}`)
    console.log(`  Got:      ${result}`)
    failed++
  }
}

console.log('\n' + '='.repeat(50))
console.log(`Results: ${passed} passed, ${failed} failed`)

process.exit(failed > 0 ? 1 : 0)
