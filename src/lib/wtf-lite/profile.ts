/**
 * Test full wtf-lite with optimizations
 */
import { Document } from './classes'

async function main() {
  const response = await fetch('https://en.wikipedia.org/w/api.php?action=query&titles=Tokyo&prop=revisions&rvprop=content&rvslots=main&format=json&formatversion=2')
  const data = await response.json() as { query: { pages: [{ revisions: [{ slots: { main: { content: string } } }] }] } }
  const wikitext = data.query.pages[0].revisions[0].slots.main.content

  console.log(`Wikitext: ${wikitext.length} chars`)

  // Warm up
  new Document(wikitext.slice(0, 1000), { title: 'Test' })

  const start = performance.now()
  const doc = new Document(wikitext, { title: 'Tokyo' })
  const time = performance.now() - start

  console.log(`Full parse: ${time.toFixed(2)}ms`)
  console.log(`Sections: ${doc.sections().length}`)
  console.log(`Infoboxes: ${doc.infoboxes().length}`)
  console.log(`Sentences: ${doc.sentences().length}`)
}

main().catch(console.error)
