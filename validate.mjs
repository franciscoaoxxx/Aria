// Comprueba que una entrada de player_configs.json descifra DE VERDAD: carga el
// base.js entero en jsdom, le inyecta la misma receta que usa la app, y sobre un
// signatureCipher real verifica que la firma cambia y tiene forma válida, y que
// el n se transforma. Si se llega al CDN, reporta el status (206 = oro).
//
//   node validate.mjs                -> valida el player actual (deriva la receta)
//   node validate.mjs <hash>         -> valida la entrada <hash> de player_configs.json
//
// exit 0 = la receta descifra y da forma válida ; 1 = no.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TEST_VIDEO = process.env.VALIDATION_VIDEO_ID || "dQw4w9WgXcQ";
const B64URL = /^[A-Za-z0-9_-]+=*$/;

async function text(url, opts = {}) {
  const r = await fetch(url, { headers: { "User-Agent": UA, ...(opts.headers || {}) }, ...opts });
  return { ok: r.ok, status: r.status, body: await r.text() };
}

async function currentHash() {
  const { body } = await text("https://www.youtube.com/iframe_api");
  const m = body.match(/\\?\/s\\?\/player\\?\/([a-f0-9]{8})\\?\//) || body.match(/\/s\/player\/([a-f0-9]{8})\//);
  if (!m) throw new Error("no se pudo sacar el hash del player");
  return m[1];
}

async function baseJsFor(hash) {
  const { ok, status, body } = await text(
    `https://www.youtube.com/s/player/${hash}/player_ias.vflset/en_US/base.js`,
  );
  if (!ok) throw new Error(`base.js HTTP ${status}`);
  return body;
}

function recipeFromBaseJs(baseJs) {
  const nested = baseJs.match(
    /[a-z0-9_$]\s*&&\s*\(\s*([a-z0-9_$]+)\s*=\s*([A-Za-z0-9_$]{2,8})\(\s*(\d+)\s*,\s*(\d+)\s*,\s*[A-Za-z0-9_$]{2,8}\(\s*\d+\s*,\s*\d+\s*,\s*\1\s*\)\s*\)/i,
  );
  const simple = baseJs.match(
    /[a-z0-9_$]\s*&&\s*\(\s*[a-z0-9_$]+\s*=\s*([A-Za-z0-9_$]{2,8})\(\s*(\d+)\s*,\s*(\d+)\s*,\s*decodeURIComponent/i,
  );
  const sig = nested
    ? `${nested[2]}(${nested[3]},${nested[4]},INPUT)`
    : simple
      ? `${simple[1]}(${simple[2]},${simple[3]},INPUT)`
      : null;
  const nc =
    baseJs.match(/new\s+g\.([A-Za-z0-9_$]{1,8})\([^)]*\)\s*\)\s*\.get\(\s*["']n["']\s*\)/) ||
    baseJs.match(/\(\s*new\s+g\.([A-Za-z0-9_$]{1,8})\([^)]*!0\)\)\.get\(["']n["']\)/);
  const sts = baseJs.match(/signatureTimestamp["':\s]+(\d{4,7})/);
  if (!sig || !nc || !sts) throw new Error("no se pudo derivar la receta del base.js");
  return { sig, nClass: nc[1], sts: Number(sts[1]) };
}

function recipeFromTable(hash) {
  const j = JSON.parse(readFileSync("player_configs.json", "utf8"));
  const e = j.players?.[hash] || Object.values(j.players || {}).find((v) => (v.aliases || []).includes(hash));
  if (!e) throw new Error(`hash ${hash} no está en player_configs.json`);
  return { sig: e.sig, nClass: e.nClass, sts: e.sts };
}

/** Un signatureCipher real de un formato audio/mp4 (WEB_REMIX guest → TVHTML5 de reserva). */
async function fetchSignatureCipher(sts) {
  const clients = [
    { clientName: "WEB_REMIX", clientVersion: "1.20241111.01.00", key: "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30",
      base: "https://music.youtube.com/youtubei/v1/player" },
    { clientName: "TVHTML5", clientVersion: "7.20241201.18.00", key: "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
      base: "https://www.youtube.com/youtubei/v1/player" },
  ];
  for (const c of clients) {
    const r = await fetch(`${c.base}?key=${c.key}&prettyPrint=false`, {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/json", "X-YouTube-Client-Name": "1", "X-YouTube-Client-Version": c.clientVersion },
      body: JSON.stringify({
        context: { client: { clientName: c.clientName, clientVersion: c.clientVersion, hl: "en", gl: "US" } },
        videoId: TEST_VIDEO,
        playbackContext: { contentPlaybackContext: { signatureTimestamp: sts } },
        contentCheckOk: true, racyCheckOk: true,
      }),
    });
    const j = await r.json().catch(() => ({}));
    const fmts = [...(j.streamingData?.adaptiveFormats || []), ...(j.streamingData?.formats || [])];
    const f = fmts.find((x) => (x.mimeType || "").startsWith("audio/mp4") && x.signatureCipher);
    if (f) return f.signatureCipher;
  }
  throw new Error("ningún cliente devolvió signatureCipher (¿todo SABR?) — prueba otro VALIDATION_VIDEO_ID");
}

function injectAndRun(baseJs, recipe, s, n) {
  const sigBody = recipe.sig.replace("INPUT", "s");
  const nBody =
    `(function(n){try{var u=new g.${recipe.nClass}('https://x.googlevideo.com/videoplayback?n='+n,true);` +
    `var t=u.get('n');return (t&&t!==n)?t:n;}catch(e){return n;}})(n)`;
  const exports =
    `;window.__sig=function(s){try{return ${sigBody};}catch(e){return null;}};` +
    `window.__n=function(n){try{return ${nBody};}catch(e){return n;}};`;
  const marker = "})(_yt_player);";
  const modified = baseJs.includes(marker)
    ? baseJs.replace(marker, `${exports} ${marker}`)
    : `${baseJs}\n${exports}`;

  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    runScripts: "dangerously",
    url: "https://www.youtube.com/",
    pretendToBeVisual: true,
  });
  dom.window.eval(modified);
  return {
    decoded: dom.window.__sig(s),
    newN: dom.window.__n(n),
  };
}

async function main() {
  const arg = process.argv[2];
  const hash = arg && /^[a-f0-9]{8}$/.test(arg) ? arg : await currentHash();
  const baseJs = await baseJsFor(hash);
  const recipe = arg ? recipeFromTable(arg) : recipeFromBaseJs(baseJs);
  console.error(`player ${hash} · sig=${recipe.sig} nClass=${recipe.nClass} sts=${recipe.sts}`);

  const cipher = await fetchSignatureCipher(recipe.sts);
  const p = Object.fromEntries(cipher.split("&").map((kv) => {
    const i = kv.indexOf("=");
    return [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))];
  }));
  const nParam = new URL(p.url).searchParams.get("n") || "";

  const { decoded, newN } = injectAndRun(baseJs, recipe, p.s, nParam);

  const problems = [];
  if (typeof decoded !== "string" || decoded === p.s || decoded.length < 60 || !B64URL.test(decoded)) {
    problems.push(`firma mal: '${String(decoded).slice(0, 40)}' (in ${p.s.length}b -> out ${String(decoded).length}b)`);
  }
  if (nParam && (typeof newN !== "string" || newN === nParam || !newN)) {
    problems.push(`n no cambió: '${nParam}' -> '${newN}'`);
  }

  // Best-effort: si se llega al CDN, reporta el status (206 = oro; 403 puede ser
  // falta de PO Token, no receta mala).
  let cdn = "n/d";
  try {
    const sep = p.url.includes("?") ? "&" : "?";
    let finalUrl = `${p.url}${sep}${p.sp || "signature"}=${encodeURIComponent(decoded)}`;
    if (nParam && newN && newN !== nParam) finalUrl = finalUrl.replace(/([?&]n=)[^&]*/, `$1${encodeURIComponent(newN)}`);
    const r = await fetch(finalUrl, { method: "GET", headers: { "User-Agent": UA, Range: "bytes=0-1" } });
    cdn = String(r.status);
  } catch (e) {
    cdn = `error: ${e.message}`;
  }

  const ok = problems.length === 0;
  console.log(JSON.stringify({ ok, hash, recipe, cdnStatus: cdn, problems }, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, reason: e.message }, null, 2));
  process.exit(1);
});
