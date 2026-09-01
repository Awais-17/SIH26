import { readFileSync } from "fs";

globalThis.window = globalThis;
globalThis.CSS = { escape: (s) => s.replace(/[^a-zA-Z0-9_-]/g, "\\$&") };
globalThis.document = {};
globalThis.chrome = {
  runtime: { onMessage: { addListener: () => {} } },
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    },
  },
};

const mapperCode = readFileSync("src/content/field-mapper.js", "utf8");
new Function(mapperCode)();

const autoCode = readFileSync("src/content/autofill.js", "utf8");
new Function(autoCode)();
const A = globalThis.AegisAutofill;
if (!A) throw new Error("AegisAutofill not exposed");

let ok = 0, bad = 0;
function eq(desc, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) ok++;
  else { bad++; console.log(`FAIL ${desc}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}

// dob normalization
eq("dob ISO passthrough", A.normalizeValue("dob", "1998-05-14"), "1998-05-14");
eq("dob DMY slash", A.normalizeValue("dob", "14/05/1998"), "1998-05-14");
eq("dob DMY dash", A.normalizeValue("dob", "14-05-1998"), "1998-05-14");
eq("dob DMY dot", A.normalizeValue("dob", "14.05.1998"), "1998-05-14");
eq("dob year-first unchanged", A.normalizeValue("dob", "1998-05-14 "), "1998-05-14");
// gender canonicalization
eq("gender m", A.normalizeValue("gender", "m"), "male");
eq("gender MALE", A.normalizeValue("gender", "MALE"), "male");
eq("gender female", A.normalizeValue("gender", "Female"), "female");
eq("gender other", A.normalizeValue("gender", "Other"), "other");
eq("gender non-binary", A.normalizeValue("gender", "non-binary"), "other");
// phone/basic
eq("phone trims", A.normalizeValue("phone", "  9876543210  "), "9876543210");

// fillElement: select matching
const makeSelect = () => {
  const el = {
    tagName: "SELECT",
    options: [
      { value: "ap", textContent: "Andhra Pradesh" },
      { value: "ka", textContent: "Karnataka" },
      { value: "tn", textContent: "Tamil Nadu" },
    ],
    value: "",
    dataset: {},
    dispatchEvent: () => {},
  };
  return el;
};
const s1 = makeSelect();
eq("select exact", (A.fillElement(s1, "ka") && s1.value), "ka");
const s2 = makeSelect();
eq("select by label prefix", (A.fillElement(s2, "Andhra") && s2.value), "ap");
const s3 = makeSelect();
eq("select no match returns false", A.fillElement(s3, "Maharashtra"), false);
eq("select no match keeps empty", s3.value, "");
eq("select no match no filled flag", s3.dataset.aegisFilled, undefined);

// fillElement: maxLength guard
const input = { tagName: "INPUT", type: "text", value: "", dataset: {}, maxLength: 5,
  dispatchEvent: () => {}, focus: () => {} };
A.fillElement(input, "123456789");
eq("maxlength truncation", input.value, "12345");

console.log(`\n${ok} passed, ${bad} failed (${ok + bad} total)`);
process.exit(bad === 0 ? 0 : 1);