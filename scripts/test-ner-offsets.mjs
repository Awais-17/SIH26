// Verify: NER token -> aggregated entity -> recover input-relative offset
// by searching each node's text. This mirrors the vision.js implementation.
import { pipeline, env } from "@huggingface/transformers";

env.allowLocalModels = true;
env.localModelPath = process.cwd().replace(/\\/g, "/") + "/src/models/";
env.allowRemoteModels = false;

const extractor = await pipeline(
  "token-classification",
  "ner",
  { dtype: "q8", local_files_only: true }
);

function labelToGroup(label) {
  // e.g. B-PER -> PER ; I-PER -> PER ; LOC -> LOC
  const m = label.match(/^[BI]-?/) ;
  return label.replace(/^[BI]-/, "").split("_")[0];
}

async function detectEntities(texts) {
  const spans = [];
  for (let nodeIndex = 0; nodeIndex < texts.length; nodeIndex++) {
    const text = texts[nodeIndex];
    if (!text || text.length < 2) continue;
    let tokens;
    try {
      tokens = await extractor(text, { aggregation_strategy: "none" });
    } catch {
      continue;
    }
    const ents = tokens.filter((t) => t.entity !== "O");

    // group consecutive NON-BEGIN (I- or same-group tokens) into entities
    let groups = [];
    for (let i = 0; i < ents.length; i++) {
      const t = ents[i];
      const g = labelToGroup(t.entity);
      const begins = t.entity.startsWith("B-") || !t.entity.includes("-");
      if (groups.length === 0 || begins || groups[groups.length - 1].group !== g) {
        groups.push({ group: g, token: t.word.startsWith("##") ? t.word.slice(2) : t.word, score: t.score });
      } else {
        groups[groups.length - 1].token +=
          t.word.startsWith("##") ? t.word.slice(2) : " " + t.word;
        groups[groups.length - 1].score = Math.min(groups[groups.length - 1].score, t.score);
      }
    }
    // locate each phrase in the text (word-boundary search)
    const seen = new Map();
    for (const grp of groups) {
      const phrase = grp.token.replace(/\s+/g, " ").trim();
      if (phrase.length < 3) continue;
      const lower = text.toLowerCase();
      // search all occurrences
      const positions = [];
      let from = 0;
      while (true) {
        const p = lower.indexOf(phrase.toLowerCase(), from);
        if (p === -1) break;
        // word boundary check
        const before = p > 0 ? lower[p - 1] : " ";
        const after = p + phrase.length < text.length ? lower[p + phrase.length] : " ";
        if (/\s[\.,;:!?)'\"\u2019\u201d\]\-\u2014(]/.test(before) === false && /[a-z0-9]/.test(before)) {
          from = p + 1;
          continue;
        }
        positions.push(p);
        from = p + phrase.length;
      }
      const k = seen.get(phrase.toLowerCase()) || 0;
      seen.set(phrase.toLowerCase(), k + 1);
      const start = positions[k];
      if (start === undefined) continue;
      spans.push({
        nodeIndex,
        text: phrase,
        start,
        end: start + phrase.length,
        entity: grp.group,
        confidence: grp.score,
      });
    }
  }
  return spans;
}

const texts = [
  "Name: Ananya Rao",
  "She lives in Bengaluru and works at ISRO.",
  "Contact 9876543210 or ananya@example.com",
];
const spans = await detectEntities(texts);
for (const s of spans) {
  const node = texts[s.nodeIndex];
  console.log(
    `node ${s.nodeIndex} [${s.start}-${s.end}] ${s.entity} conf=${s.confidence.toFixed(2)} -> "${node.slice(s.start, s.end)}"`
  );
}
