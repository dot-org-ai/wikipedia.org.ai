// Test the regex directly
const text = "Revenue US$1.5 billion.";

// This is the pattern from splitSentences
const splits = text.split(/(\S[^\n.!?]*[.!?]"?)(?=\s|$)/g);
console.log("Splits from regex:", splits.map(s => JSON.stringify(s)));

// Try a simpler test
const test1 = "Revenue US$1.5 billion.";
const pattern = /(\S[^\n.!?]*[.!?]"?)(?=\s|$)/g;
let m: RegExpExecArray | null;
while ((m = pattern.exec(test1)) !== null) {
  console.log("Match at", m.index, ":", JSON.stringify(m[0]), "next char:", JSON.stringify(test1[m.index + m[0].length]));
}
