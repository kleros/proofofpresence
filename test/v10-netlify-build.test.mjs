// Offline Git-source build regression. No dependencies, compiled contracts, chain or hosting API.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { V10_FRONTEND_HEADERS } from "../scripts/prepare-v10-frontend.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url)), execute = promisify(execFile);
const sourceFiles = ["scripts/build-v10-netlify.mjs", "scripts/prepare-v10-frontend.mjs", "scripts/build-hosted-frontend.mjs", "package.json", "netlify.toml"];
const sha = value => createHash("sha256").update(value).digest("hex");
const pins = async () => Object.fromEntries(await Promise.all([...sourceFiles, "test/v10-netlify-build.test.mjs"].map(async file => [file, sha(await fs.readFile(path.join(ROOT, file)))])));
const exists = async file => { try { await fs.access(file); return true; } catch { return false; } };
async function files(directory, prefix = "") {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name), absolute = path.join(directory, entry.name);
    assert(!entry.isSymbolicLink(), "The clean fixture contains regular source files only");
    if (entry.isDirectory()) result.push(...await files(absolute, relative));
    else { assert(entry.isFile()); result.push(relative); }
  }
  return result.sort();
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kleros-v10-netlify-build-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cleanSource = source => !path.relative(ROOT, source).split(path.sep).some(part =>
    ["node_modules", ".git", ".runtime", "dist", "build"].includes(part) || part.startsWith(".env"));
  for (const directory of ["public", "netlify/functions"]) await fs.cp(path.join(ROOT, directory), path.join(root, directory), { recursive: true, filter: cleanSource });
  for (const file of sourceFiles) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.copyFile(path.join(ROOT, file), path.join(root, file));
  }
  const networkLog = path.join(root, "network-attempts.log"), guard = path.join(root, "offline-guard.mjs");
  await fs.writeFile(networkLog, "");
  await fs.writeFile(guard, `import fs from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
const require=createRequire(import.meta.url);
const deny=name=>(...args)=>{fs.appendFileSync(process.env.KLEROS_TEST_NETWORK_LOG,name+'\\n');throw Error('Offline build attempted '+name);};
for(const [module,methods] of [['node:http',['request','get']],['node:https',['request','get']],['node:net',['connect','createConnection']],['node:tls',['connect']],['node:dns',['lookup','resolve','resolve4','resolve6','reverse']]])
 for(const method of methods)require(module)[method]=deny(module+'.'+method);
require('node:net').Socket.prototype.connect=deny('Socket.connect');
globalThis.fetch=deny('fetch');globalThis.WebSocket=class{constructor(){deny('WebSocket')();}};
syncBuiltinESMExports();
`);
  const userConfig = path.join(root, "npm-user-empty.rc"), globalConfig = path.join(root, "npm-global-empty.rc");
  await fs.writeFile(userConfig, ""); await fs.writeFile(globalConfig, "");
  const env = { PATH: process.env.PATH, CI: "true", NETLIFY: "true", NODE_OPTIONS: `--import=${pathToFileURL(guard).href}`,
    KLEROS_TEST_NETWORK_LOG: networkLog, npm_config_userconfig: userConfig, npm_config_globalconfig: globalConfig,
    npm_config_cache: path.join(root, "npm-cache"), npm_config_update_notifier: "false", npm_config_audit: "false", npm_config_fund: "false" };
  const run = (command, args) => execute(command, args, { cwd: root, env, timeout: 20000, maxBuffer: 1000000 });
  const offline = async () => assert.equal(await fs.readFile(networkLog, "utf8"), "", "No network access may be attempted, even if caught");
  for (const absent of ["node_modules", ".runtime", "build", "references", ".git", "scripts/compile-contracts.mjs"])
    assert.equal(await exists(path.join(root, absent)), false, `Clean source fixture excludes ${absent}`);
  return { root, run, offline };
}
async function assertAssets(root) {
  const source = path.join(root, "public"), output = path.join(root, "dist/netlify-app"), names = await files(source);
  assert.deepEqual(await files(output), [...new Set([...names, "_headers"])].sort());
  for (const file of names.filter(file => file !== "_headers")) assert.deepEqual(await fs.readFile(path.join(output, file)), await fs.readFile(path.join(source, file)), `Exact public asset: ${file}`);
  assert.deepEqual(await fs.readFile(path.join(root, "netlify/functions/workbench.mjs")), await fs.readFile(path.join(ROOT, "netlify/functions/workbench.mjs")));
  return names.length;
}

test("configured production npm build works from clean source without Git metadata, compilers or dependencies and preserves exact V10 assets/CSP", async t => {
  const sourcePins = await pins(), f = await fixture(t), pkg = JSON.parse(await fs.readFile(path.join(f.root, "package.json"), "utf8"));
  const config = await fs.readFile(path.join(f.root, "netlify.toml"), "utf8");
  assert.equal(pkg.scripts["build:netlify:production"], "node scripts/build-v10-netlify.mjs");
  const build = /^\[build\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(config)?.[1]; assert(build);
  assert.match(build, /^\s*command\s*=\s*"npm run build:netlify:production"\s*$/m);
  assert.match(build, /^\s*publish\s*=\s*"dist\/netlify-app"\s*$/m);
  assert.match(build, /^\s*functions\s*=\s*"netlify\/functions"\s*$/m);
  const output = path.join(f.root, "dist/netlify-app"); await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, "stale-prior-build.txt"), "must be removed");
  const result = await f.run("npm", ["run", "build:netlify:production"]);
  assert.match(result.stdout, /Built production V10 frontend: dist\/netlify-app; gateway: netlify\/functions/);
  const assetCount = await assertAssets(f.root);
  assert.equal(await fs.readFile(path.join(output, "_headers"), "utf8"), V10_FRONTEND_HEADERS);
  assert.equal(await exists(path.join(f.root, "node_modules")), false);
  assert.equal(await exists(path.join(f.root, ".runtime")), false);
  await f.offline(); assert.deepEqual(await pins(), sourcePins);
  t.diagnostic(JSON.stringify({ kind: "offline-v10-netlify-git-build", command: "npm run build:netlify:production", publicAssetsCompared: assetCount,
    exactProductionHeaders: true, gatewayUnchanged: true, networkAttempts: 0, contractCompilation: false, gitMetadataRequired: false,
    publish: "dist/netlify-app", functions: "netlify/functions", sourcePins,
    limits: ["Local source-copy/build validation only; no dependency installation, Netlify deploy or financial execution."] }));
});

test("missing required production inputs and unsupported CLI arguments fail before replacing prior output", async t => {
  const f = await fixture(t), output = path.join(f.root, "dist/netlify-app"); await fs.mkdir(output, { recursive: true });
  const sentinel = path.join(output, "retained.txt"); await fs.writeFile(sentinel, "existing build");
  for (const file of ["public/index.html", "public/first-event/index.html", "public/vendor/walletconnect/2.26.0/walletconnect.bundle.js", "netlify/functions/workbench.mjs"]) {
    const source = path.join(f.root, file), held = source + ".held"; await fs.rename(source, held);
    try { await assert.rejects(f.run(process.execPath, ["scripts/build-v10-netlify.mjs"])); }
    finally { await fs.rename(held, source); }
    assert.equal(await fs.readFile(sentinel, "utf8"), "existing build");
  }
  await assert.rejects(f.run(process.execPath, ["scripts/build-v10-netlify.mjs", "HEAD"]));
  assert.equal(await fs.readFile(sentinel, "utf8"), "existing build");
  const result = await f.run(process.execPath, ["--input-type=module", "-e", "const {buildV10Netlify}=await import('./scripts/build-v10-netlify.mjs');console.log(JSON.stringify(await buildV10Netlify()));"]);
  assert.deepEqual(JSON.parse(result.stdout), { publish: "dist/netlify-app", functions: "netlify/functions" });
  await f.offline();
});

test("generic hosted builder retains its self-only policy and historical demo build commands", async t => {
  const f = await fixture(t), pkg = JSON.parse(await fs.readFile(path.join(f.root, "package.json"), "utf8"));
  assert.equal(pkg.scripts.build, "npm run compile:all && node scripts/build.mjs");
  assert.equal(pkg.scripts["build:hosted"], "npm run build && node scripts/build-hosted-frontend.mjs");
  await f.run(process.execPath, ["scripts/build-hosted-frontend.mjs"]); await assertAssets(f.root);
  const headers = await fs.readFile(path.join(f.root, "dist/netlify-app/_headers"), "utf8");
  const policy = headers.split("Content-Security-Policy: ")[1].trim();
  const directives = new Map(policy.split(";").map(value => value.trim().split(/\s+/)).filter(row => row[0]).map(([name, ...values]) => [name, values]));
  assert.deepEqual(directives.get("script-src"), ["'self'"]);
  assert.deepEqual(directives.get("connect-src"), ["'self'"]);
  assert.deepEqual(directives.get("img-src"), ["'self'", "data:"]);
  assert.equal(directives.has("frame-src"), false); assert(!headers.includes("walletconnect.org") && !headers.includes("web3modal.org"));
  await f.offline();
});
