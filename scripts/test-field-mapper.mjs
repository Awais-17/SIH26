// Validate field-mapper classification on representative Indian form fields.
import { readFileSync } from "fs";

// Provide minimal browser globals so the plain script can load in Node.
globalThis.window = globalThis;
globalThis.CSS = { escape: (s) => s.replace(/[^a-zA-Z0-9_-]/g, "\\$&") };
globalThis.document = {};

const code = readFileSync("src/content/field-mapper.js", "utf8");
new Function(code)();
const mapper = globalThis.AegisFieldMapper;
if (!mapper) throw new Error("AegisFieldMapper not exposed");

let pass = 0, fail = 0;
function check(desc, el, expectKey) {
  const r = mapper.classifyField(el);
  const key = r.key;
  const ok = key === expectKey;
  if (ok) pass++; else {
    fail++;
    console.log(`FAIL "${desc}" -> ${key} (expected ${expectKey}) | reason: ${r.reason}`);
  }
}

const mk = (attrs) => Object.assign({ labels: [], getAttribute: (k) => attrs[k], autocomplete: "" }, attrs);

check("full name label", mk({ placeholder: "Full Name", name: "name" }), "fullName");
check("family name", mk({ name: "lname", placeholder: "Surname" }), "lastName");
check("email autocomplete", mk({ autocomplete: "email", name: "cust_email" }), "email");
check("mobile", mk({ placeholder: "Mobile Number", name: "contact" }), "phone");
check("phone autocomplete", mk({ autocomplete: "tel", id: "ph" }), "phone");
check("date of birth", mk({ placeholder: "DD/MM/YYYY", id: "dob" }), "dob");
check("bday autocomplete", mk({ autocomplete: "bday", name: "birth" }), "dob");
check("pincode", mk({ placeholder: "PIN code", name: "pin_code" }), "pincode");
check("postal code autocomplete", mk({ autocomplete: "postal-code", id: "pc" }), "pincode");
check("city", mk({ placeholder: "City", name: "city" }), "city");
check("state", mk({ name: "state", placeholder: "Select State" }), "state");
check("college", mk({ placeholder: "College Name", id: "institute" }), "college");
check("roll number", mk({ placeholder: "Roll Number", name: "roll_no" }), "rollNumber");
check("course", mk({ name: "course", placeholder: "B.Tech" }), "course");
check("branch", mk({ name: "branch", placeholder: "CS" }), "branch");
check("guardian name", mk({ placeholder: "Father's Name", name: "guardian" }), "guardianName");
check("occupation", mk({ placeholder: "Occupation", name: "job" }), "occupation");
check("income", mk({ placeholder: "Family Income", name: "income" }), "annualIncome");

// Never-store (compliance) cases
check("aadhaar", mk({ placeholder: "Aadhaar Number", id: "aadhaar" }), "never_store");
check("aadhar alt", mk({ name: "uidai", placeholder: "UID" }), "never_store");
check("pan", mk({ placeholder: "PAN Number", name: "pan" }), "never_store");
check("passport", mk({ placeholder: "Passport No", name: "passport" }), "never_store");
check("driving licence", mk({ name: "licence", labels: [{ textContent: "Driving Licence Number" }] }), "never_store");
check("voter id", mk({ name: "voter", labels: [{ textContent: "Voter ID" }] }), "never_store");
check("account number", mk({ name: "account_no", labels: [{ textContent: "Account Number" }] }), "never_store");
check("cvv", mk({ placeholder: "CVV", name: "cvv" }), "never_store");

// Regression: an ID-typed placeholder hint on a NAME field must not turn the
// field into never_store. "Name as per Aadhaar / PAN" is the standard wording
// on Indian forms (and was the exact bug found on the demo loan page).
check("full name ignores 'as per PAN' placeholder", mk({ autocomplete: "name", placeholder: "As per Aadhaar / PAN", name: "fullName" }), "fullName");
check("full name ignores 'as per PAN' placeholder without autocomplete", mk({ placeholder: "Full Name (as per PAN)", name: "fullName" }), "fullName");
check("applicant name with aadhaar-mentioned placeholder", mk({ placeholder: "As per Aadhaar", labels: [{ textContent: "Applicant Name" }] }), "fullName");

// Unmappable
check("describe project", mk({ placeholder: "About Yourself", name: "bio" }), null);
check("essay", mk({ id: "essay", placeholder: "Why do you want this?" }), null);

console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
process.exit(fail === 0 ? 0 : 1);