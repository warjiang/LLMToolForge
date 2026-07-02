import { findTextMatches, getTextStats } from "@/lib/textEditorTool";

export function runTextEditorToolTests() {
  const text = "alpha\nBeta alpha\nALPHA";

  const matches = findTextMatches(text, "alpha");
  console.assert(matches.length === 3, "search should find case-insensitive matches");
  console.assert(matches[0]?.index === 0, "first match should start at index 0");
  console.assert(matches[1]?.line === 2, "second match should report a 1-based line number");

  const emptyMatches = findTextMatches(text, "   ");
  console.assert(emptyMatches.length === 0, "blank search should return no matches");

  const stats = getTextStats(text);
  console.assert(stats.characters === text.length, "stats should count characters");
  console.assert(stats.lines === 3, "stats should count lines");
}
