// @ts-nocheck - Internal implementation
import wtf from './index'

// Test 1: Basic article parsing
console.log('=== Test 1: Basic article parsing ===')
const wikitext = `
'''Albert Einstein''' ({{IPA-de|ˈalbɛʁt ˈʔaɪnʃtaɪn}}; 14 March 1879 – 18 April 1955) was a [[Germany|German]]-born [[Theoretical physics|theoretical physicist]], widely held to be one of the greatest and most influential scientists of all time.

{{Infobox scientist
| name = Albert Einstein
| image = Einstein 1921 by F Schmutzer - restoration.jpg
| birth_date = 14 March 1879
| birth_place = [[Ulm]], [[Kingdom of Württemberg]], [[German Empire]]
| death_date = 18 April 1955
| death_place = [[Princeton, New Jersey]], U.S.
| citizenship = Various
| alma_mater = [[ETH Zurich]]
| known_for = [[General relativity]]<br>[[Special relativity]]<br>[[Photoelectric effect]]
| awards = [[Nobel Prize in Physics]] (1921)
}}

== Early life ==
Einstein was born in the [[German Empire]], but moved to [[Switzerland]] in 1895.

== Career ==
He developed the [[theory of relativity]].

=== Special relativity ===
Special relativity was published in 1905.

== See also ==
* [[Physics]]
* [[Nobel Prize]]

[[Category:1879 births]]
[[Category:1955 deaths]]
[[Category:German physicists]]
`

const doc = wtf(wikitext)

console.log('Title:', doc.title())
console.log('Categories:', doc.categories())
console.log('Section count:', doc.sections().length)
console.log('Infobox count:', doc.infoboxes().length)
console.log('Link count:', doc.links().length)
console.log('Text length:', doc.text().length)

if (doc.infoboxes()[0]) {
  console.log('Infobox type:', doc.infoboxes()[0].type())
  console.log('Infobox name:', doc.infoboxes()[0].get('name').text())
}

// Test 2: Redirect detection
console.log('\n=== Test 2: Redirect detection ===')
const redirectWiki = '#REDIRECT [[Albert Einstein]]'
const redirectDoc = wtf(redirectWiki)
console.log('Is redirect:', redirectDoc.isRedirect())
console.log('Redirects to:', redirectDoc.redirectTo()?.page?.())

// Test 3: External links
console.log('\n=== Test 3: External links ===')
const externalLinkWiki = 'Visit [https://example.com Example Site] for more info.'
const externalDoc = wtf(externalLinkWiki)
const extLinks = externalDoc.links().filter(l => l.type() === 'external')
console.log('External links:', extLinks.length)
if (extLinks[0]) {
  console.log('Site:', extLinks[0].json())
}

// Test 4: Nested sections
console.log('\n=== Test 4: Nested sections ===')
const nestedWiki = `
== Level 2 ==
Content at level 2.
=== Level 3 ===
Content at level 3.
==== Level 4 ====
Content at level 4.
== Another Level 2 ==
More content.
`
const nestedDoc = wtf(nestedWiki)
nestedDoc.sections().forEach(sec => {
  console.log(`${'  '.repeat(sec.depth())}[${sec.depth()}] "${sec.title()}"`)
})

// Test 5: Lists
console.log('\n=== Test 5: Lists ===')
const listWiki = `
Here are some items:
* First item
* Second item
* Third item

And numbered:
# One
# Two
# Three
`
const listDoc = wtf(listWiki)
const lists = listDoc.paragraphs().flatMap(p => p.lists())
console.log('List count:', lists.length)
lists.forEach((list, i) => {
  console.log(`List ${i + 1}:`)
  list.lines().forEach(line => console.log('  -', line.text()))
})

// Test 6: Multiple infoboxes
console.log('\n=== Test 6: Multiple infoboxes ===')
const multiInfoWiki = `
{{Infobox person
| name = John Doe
| occupation = Writer
}}

{{Infobox book
| title = My Book
| author = John Doe
}}
`
const multiInfoDoc = wtf(multiInfoWiki)
console.log('Infobox count:', multiInfoDoc.infoboxes().length)
multiInfoDoc.infoboxes().forEach((info, i) => {
  console.log(`Infobox ${i + 1}: type="${info.type()}"`)
})

console.log('\n=== All tests completed! ===')
