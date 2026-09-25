// One-time local setup: asks for your Groq key and writes it to .env.local (git-ignored).
// Usage: npm run setup      (set ENV_FILE=path to write somewhere else)
import fs from "node:fs";
import readline from "node:readline";

const file = process.env.ENV_FILE ?? ".env.local";
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let muted = false;
const write = rl._writeToOutput.bind(rl);
rl._writeToOutput = (s) => write(muted ? (s.includes("\n") ? s : "*") : s); // hide the key while typing

const ask = (q, hide = false) => new Promise((res) => {
  process.stdout.write(q); muted = hide;
  rl.once("close", () => res("")); // input ended (piped/Ctrl-D): treat as empty answer
  rl.question("", (a) => { muted = false; if (hide) process.stdout.write("\n"); res(a.trim()); });
});

const key = await ask("Paste your Groq API key (gsk_…): ", true);
if (!/^gsk_[A-Za-z0-9]{20,}$/.test(key)) { console.error("That doesn't look like a Groq key (should start with gsk_)."); process.exit(1); }
const model = (await ask("Model [openai/gpt-oss-120b]: ")) || "openai/gpt-oss-120b";
rl.close();

const own = /^(GROQ_API_KEY|GROQ_MODEL|LLM_API_KEY|LLM_MODEL)=/;
const keep = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l && !own.test(l)) : [];
fs.writeFileSync(file, [...keep, `GROQ_API_KEY=${key}`, `GROQ_MODEL=${model}`, ""].join("\n"), { mode: 0o600 });
console.log(`\nSaved ${file}. Start Pixr with:  npm run dev   →  http://localhost:3000`);
