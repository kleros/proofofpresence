// Offline prepublish checks only. Browser modules are parsed, never evaluated.
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const VENDOR_BUNDLE = "vendor/walletconnect/2.26.0/walletconnect.bundle.js";
const PARSE_MODULES = `import fs from "node:fs";
import vm from "node:vm";
const inputs = JSON.parse(fs.readFileSync(0, "utf8"));
const result = [];
for (const { file, source } of inputs) {
  try {
    const module = new vm.SourceTextModule(source, { identifier: file });
    result.push({ file, imports: module.dependencySpecifiers });
  } catch (error) {
    console.error("Invalid frontend JavaScript in " + file + ": " + error.message);
    process.exit(1);
  }
}
process.stdout.write(JSON.stringify(result));`;

async function publicFiles(directory, prefix = "") {
  const result = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, item.name);
    if (item.isDirectory()) result.push(...await publicFiles(path.join(directory, item.name), relative));
    else if (item.isFile()) result.push(relative);
    else throw Error(`Production frontend requires regular files: ${relative}`);
  }
  return result.sort();
}

// Literal deferred imports are checked as well as the static declarations
// parsed by V8. Skip comments and quoted/template text rather than treating
// documentation strings as dependencies. Computed runtime URLs are not executed.
function deferredImports(source) {
  const tokens = /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\bimport\s*\(\s*(["'])([^"'\\\r\n]+)\1/g;
  return [...source.matchAll(tokens)].filter(match => match[2]).map(match => match[2]);
}

function attributes(tag) {
  const result = new Map();
  for (const match of tag.matchAll(/([^\s=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))
    result.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]);
  return result;
}

export async function verifyV10Frontend({ root }) {
  const directory = path.join(root, "public"), names = await publicFiles(directory), available = new Set(names);
  const sources = await Promise.all(names.filter(file => /\.[cm]?js$/.test(file) &&
    (!file.startsWith("vendor/") || file === VENDOR_BUNDLE)).map(async file => ({
      file, source: await fs.readFile(path.join(directory, file), "utf8"),
    })));
  let parsed;
  try {
    parsed = JSON.parse(execFileSync(process.execPath,
      ["--no-warnings", "--experimental-vm-modules", "--input-type=module", "-e", PARSE_MODULES],
      { input: JSON.stringify(sources), encoding: "utf8", maxBuffer: 1_000_000, timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }));
  } catch (error) {
    throw Error(`Production frontend syntax check failed: ${String(error.stderr ?? error.message).trim()}`);
  }
  const resolve = (file, reference, module = false) => {
    if (!reference || reference.startsWith("#") || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(reference)) return;
    if (module && !reference.startsWith(".") && !reference.startsWith("/"))
      throw Error(`Unresolved browser module in ${file}: ${reference}`);
    let relative;
    try { relative = decodeURIComponent(reference.split(/[?#]/, 1)[0]); }
    catch { throw Error(`Invalid local asset reference in ${file}: ${reference}`); }
    if (relative.includes("\\")) throw Error(`Invalid local asset reference in ${file}: ${reference}`);
    const absolute = relative.startsWith("/") ? path.resolve(directory, "." + relative) : path.resolve(directory, path.dirname(file), relative);
    const local = path.relative(directory, absolute);
    if (local === ".." || local.startsWith(".." + path.sep) || path.isAbsolute(local) || !available.has(local.split(path.sep).join("/")))
      throw Error(`Missing local ${module ? "module" : "asset"} in ${file}: ${reference}`);
  };
  let moduleReferences = 0, assetReferences = 0;
  for (let index = 0; index < sources.length; index++) {
    const { file, source } = sources[index];
    if (file.startsWith("vendor/")) continue;
    for (const reference of [...parsed[index].imports, ...deferredImports(source)]) {
      resolve(file, reference, true); moduleReferences++;
    }
  }
  const cssReferences = async (file, text) => {
    for (const match of text.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)|@import\s+["']([^"']+)["']/gi)) {
      resolve(file, match[1] ?? match[2] ?? match[3] ?? match[4]); assetReferences++;
    }
  };
  for (const file of names.filter(file => /\.(?:html|css)$/.test(file))) {
    const source = await fs.readFile(path.join(directory, file), "utf8");
    if (file.endsWith(".css")) { await cssReferences(file, source); continue; }
    const html = source.replace(/<!--[\s\S]*?-->/g, "");
    for (const match of html.matchAll(/<(script|link|img|source|image|video|audio|track|input|embed|object)\b[^>]*>/gi)) {
      const tag = match[1].toLowerCase(), attrs = attributes(match[0]);
      const keys = tag === "link" ? ["href"] : tag === "image" ? ["href", "xlink:href"] : tag === "object" ? ["data"] : ["src", "poster"];
      for (const key of keys) if (attrs.has(key)) { resolve(file, attrs.get(key)); assetReferences++; }
      const srcset = attrs.get("srcset");
      if (srcset && !srcset.trim().startsWith("data:")) for (const candidate of srcset.split(",")) {
        resolve(file, candidate.trim().split(/\s+/)[0]); assetReferences++;
      }
    }
  }
  return { publicAssets: names.length, syntaxFiles: sources.length, moduleReferences, assetReferences };
}
