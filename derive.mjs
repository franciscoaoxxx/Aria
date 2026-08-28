// Propone una entrada de player_configs.json para el player que YouTube sirve
// AHORA. Todo sale por regex del base.js -los constantes de la firma están
// literalmente en el sitio de llamada-, así que no hace falta ejecutar nada.
//
//   node derive.mjs                 -> imprime la entrada y sale 0 si es nueva
//   node derive.mjs --json entry.json   -> además la escribe a entry.json
//
// Salida (stdout): JSON { ok, hash, alias, entry, known, reason }
// exit 0 = entrada nueva y bien formada ; 1 = ya conocida, o no se pudo derivar.

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const CONFIG_FILE = "player_configs.json";

const SIG_RE = /^[A-Za-z0-9_$]{1,8}\(\d+,\d+,INPUT\)$/;
const NCLASS_RE = /^[A-Za-z0-9_$]{1,8}$/;
const HASH_RE = /^[a-f0-9]{8}$/;

async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
  return r.text();
}

async function currentPlayerHash() {
  const iframe = await get("https://www.youtube.com/iframe_api");
  const m =
    iframe.match(/\\?\/s\\?\/player\\?\/([a-f0-9]{8})\\?\//) ||
    iframe.match(/\/s\/player\/([a-f0-9]{8})\//);
  if (!m) throw new Error("no se pudo sacar el hash del player de iframe_api");
  return m[1];
}

function md5Alias(baseJs) {
  return createHash("md5")
    .update(Buffer.from(baseJs).subarray(0, 10000))
    .digest("hex")
    .slice(0, 8);
}

/**
 * sig: el sitio de llamada real es
 *   `X&&(X=NAME(c1,c2,PRE(d1,d2,X)))`   -p.ej. p&&(p=vQ(28,4062,ki(26,249,p)))-
 * La receta es `NAME(c1,c2,INPUT)`: el `PRE(...)` interno resulta innecesario
 * pasándole la firma cruda (así lo derivó zemer y así funciona en la app).
 * Si un player futuro no tiene ese `PRE` anidado, se cae a la forma simple.
 */
function deriveSig(baseJs) {
  const nested = baseJs.match(
    /[a-z0-9_$]\s*&&\s*\(\s*([a-z0-9_$]+)\s*=\s*([A-Za-z0-9_$]{2,8})\(\s*(\d+)\s*,\s*(\d+)\s*,\s*[A-Za-z0-9_$]{2,8}\(\s*\d+\s*,\s*\d+\s*,\s*\1\s*\)\s*\)/i,
  );
  if (nested) return `${nested[2]}(${nested[3]},${nested[4]},INPUT)`;

  const simple = baseJs.match(
    /[a-z0-9_$]\s*&&\s*\(\s*[a-z0-9_$]+\s*=\s*([A-Za-z0-9_$]{2,8})\(\s*(\d+)\s*,\s*(\d+)\s*,\s*decodeURIComponent/i,
  );
  if (simple) return `${simple[1]}(${simple[2]},${simple[3]},INPUT)`;
  return null;
}

/** nClass: el player hace `(new g.NAME(url,!0)).get("n")`. */
function deriveNClass(baseJs) {
  const m =
    baseJs.match(/new\s+g\.([A-Za-z0-9_$]{1,8})\([^)]*\)\s*\)\s*\.get\(\s*["']n["']\s*\)/) ||
    baseJs.match(/\(\s*new\s+g\.([A-Za-z0-9_$]{1,8})\([^)]*!0\)\)\.get\(["']n["']\)/);
  return m ? m[1] : null;
}

function deriveSts(baseJs) {
  const m = baseJs.match(/signatureTimestamp["':\s]+(\d{4,7})/);
  return m ? Number(m[1]) : null;
}

function loadKnown() {
  try {
    const j = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
    const keys = new Set();
    for (const [h, e] of Object.entries(j.players ?? {})) {
      keys.add(h);
      for (const a of e.aliases ?? []) keys.add(a);
    }
    return keys;
  } catch {
    return new Set();
  }
}

async function main() {
  const outArg = process.argv.indexOf("--json");
  const outFile = outArg > 0 ? process.argv[outArg + 1] : null;

  let result;
  try {
    const hash = await currentPlayerHash();
    const baseJs = await get(
      `https://www.youtube.com/s/player/${hash}/player_ias.vflset/en_US/base.js`,
    );
    const alias = md5Alias(baseJs);
    const sig = deriveSig(baseJs);
    const nClass = deriveNClass(baseJs);
    const sts = deriveSts(baseJs);

    const problems = [];
    if (!sig || !SIG_RE.test(sig)) problems.push(`sig='${sig}'`);
    if (!nClass || !NCLASS_RE.test(nClass)) problems.push(`nClass='${nClass}'`);
    if (!Number.isInteger(sts) || sts <= 0) problems.push(`sts='${sts}'`);
    if (!HASH_RE.test(hash)) problems.push(`hash='${hash}'`);

    const known = loadKnown();
    const entry = problems.length
      ? null
      : { [hash]: { sig, nClass, sts, aliases: [alias] } };

    result = {
      ok: !problems.length && !known.has(hash),
      hash,
      alias,
      entry,
      known: known.has(hash),
      reason: problems.length
        ? `no se pudo derivar: ${problems.join(", ")}`
        : known.has(hash)
          ? "el player actual ya está en la tabla"
          : null,
    };
  } catch (e) {
    result = { ok: false, reason: e.message };
  }

  console.log(JSON.stringify(result, null, 2));
  if (result.ok && outFile) writeFileSync(outFile, JSON.stringify(result.entry, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main();
