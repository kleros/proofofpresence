// A conservative gate for solc storageLayout JSON, not an implementation/governance audit.
// Official format and packing rules:
// https://docs.soliditylang.org/en/latest/internals/layout_in_storage.html#json-output
// Type identifiers/AST IDs are compiler bookkeeping; compare the referenced graph instead.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const STORAGE_LAYOUT_LIMITS = Object.freeze({
  types: 2048,
  entries: 10000,
  depth: 64,
  comparisons: 50000,
  diagnostics: 32,
  text: 4096,
  inputBytes: 2 * 1024 * 1024,
});
const SLOT_BYTES = 32n;
const SLOT_COUNT = 1n << 256n;
const CAPACITY = SLOT_COUNT * SLOT_BYTES;
const own = (value, key) => Object.hasOwn(value, key);
const roundSlot = (value) => ((value + 31n) / 32n) * 32n;
const LIMITATIONS = Object.freeze([
  "Checks compiler-declared persistent storage only; hidden assembly slots, ERC1967 slots, transient storage and ERC7201 namespace roots are not discovered or validated.",
  "Unrooted type descriptors, when supplied, are compared conservatively; their equality does not prove namespace IDs, root derivation or root collision safety.",
  "For namespaced libraries, separately expose the known namespace struct in a compile-only helper, compare that layout, and independently pin/review its actual namespace root and source. An empty proxy layout does not establish namespace compatibility.",
  "Enum member ordering/meaning is absent from storageLayout. Opaque user-defined value types and stored function pointers are unsupported and require separate review.",
  "A compatible layout does not prove honest implementation logic, initialization, access control, governance or the safety of a malicious approved upgrade.",
]);

export class StorageLayoutError extends Error {
  constructor(diagnostics) {
    super(
      diagnostics.map((item) => `${item.path}: ${item.message}`).join("; "),
    );
    this.name = "StorageLayoutError";
    this.code = "STORAGE_LAYOUT_INCOMPATIBLE";
    this.diagnostics = diagnostics;
  }
}

function fail(code, at, message) {
  throw new StorageLayoutError([{ code, path: at, message }]);
}
function object(value, at) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail("MALFORMED_LAYOUT", at, "Expected a plain JSON object.");
  if (
    Object.values(Object.getOwnPropertyDescriptors(value)).some(
      (descriptor) => !own(descriptor, "value"),
    )
  )
    fail(
      "MALFORMED_LAYOUT",
      at,
      "Layout objects must contain data fields, not accessors.",
    );
}
function keys(value, allowed, at) {
  object(value, at);
  for (const key of Object.keys(value)) {
    if (/namespace|erc.?7201/i.test(key))
      fail(
        "UNSUPPORTED_NAMESPACE",
        `${at}.${key}`,
        "Namespace metadata needs an explicit independently reviewed root/schema validator.",
      );
    if (!allowed.includes(key))
      fail(
        "UNKNOWN_FIELD",
        `${at}.${key}`,
        "Unknown layout field; review the compiler format before accepting it.",
      );
  }
}
function text(value, at) {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > STORAGE_LAYOUT_LIMITS.text ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    fail(
      "MALFORMED_LAYOUT",
      at,
      "Expected bounded nonempty text without control characters.",
    );
  return value;
}
function decimal(value, at, maximum) {
  if (
    typeof value !== "string" ||
    value.length > 80 ||
    !/^(0|[1-9][0-9]*)$/.test(value)
  )
    fail(
      "MALFORMED_LAYOUT",
      at,
      "Expected a canonical nonnegative decimal string.",
    );
  const number = BigInt(value);
  if (number > maximum)
    fail("OUT_OF_RANGE", at, "Storage integer exceeds the EVM address space.");
  return number;
}
function primitiveSize(label) {
  if (label === "bool") return 1n;
  if (
    label === "address" ||
    label === "address payable" ||
    /^contract [A-Za-z_$][A-Za-z0-9_$.]*$/.test(label)
  )
    return 20n;
  if (/^enum [A-Za-z_$][A-Za-z0-9_$.]*$/.test(label)) return 1n;
  const integer = /^(u?int)([0-9]+)$/.exec(label);
  if (integer) {
    const bits = Number(integer[2]);
    if (
      String(bits) === integer[2] &&
      bits >= 8 &&
      bits <= 256 &&
      bits % 8 === 0
    )
      return BigInt(bits / 8);
  }
  const bytes = /^bytes([0-9]+)$/.exec(label);
  if (bytes) {
    const width = Number(bytes[1]);
    if (String(width) === bytes[1] && width >= 1 && width <= 32)
      return BigInt(width);
  }
  return null;
}

function validate(layout, side) {
  keys(layout, ["storage", "types"], side);
  if (!Array.isArray(layout.storage))
    fail(
      "MALFORMED_LAYOUT",
      `${side}.storage`,
      "Expected the solc storage array.",
    );
  // solc emits null types for a contract without any persistent state.
  const sourceTypes =
    layout.types === null && layout.storage.length === 0 ? {} : layout.types;
  object(sourceTypes, `${side}.types`);
  const typeIds = Object.keys(sourceTypes);
  if (typeIds.length > STORAGE_LAYOUT_LIMITS.types)
    fail("TOO_COMPLEX", `${side}.types`, "Type-count bound exceeded.");
  const nodes = new Map();
  let entryCount = 0;
  function entries(values, at) {
    if (!Array.isArray(values))
      fail("MALFORMED_LAYOUT", at, "Expected a storage/member array.");
    if (
      Object.getPrototypeOf(values) !== Array.prototype ||
      Object.values(Object.getOwnPropertyDescriptors(values)).some(
        (descriptor) => !own(descriptor, "value"),
      )
    )
      fail(
        "MALFORMED_LAYOUT",
        at,
        "Expected ordinary JSON array data without accessors.",
      );
    entryCount += values.length;
    if (entryCount > STORAGE_LAYOUT_LIMITS.entries)
      fail("TOO_COMPLEX", at, "Storage/member-count bound exceeded.");
    if (Object.keys(values).length !== values.length)
      fail(
        "MALFORMED_LAYOUT",
        at,
        "Storage/member arrays must be dense JSON arrays without extra fields.",
      );
    return values.map((value, index) => {
      const where = `${at}[${index}]`;
      keys(
        value,
        ["astId", "contract", "label", "offset", "slot", "type"],
        where,
      );
      const label = text(value.label, `${where}.label`);
      const type = text(value.type, `${where}.type`);
      const slot = decimal(value.slot, `${where}.slot`, SLOT_COUNT - 1n);
      if (
        !Number.isInteger(value.offset) ||
        value.offset < 0 ||
        value.offset > 31
      )
        fail(
          "MALFORMED_LAYOUT",
          `${where}.offset`,
          "Expected an integer byte offset from0 through31.",
        );
      if (
        own(value, "astId") &&
        (!Number.isSafeInteger(value.astId) || value.astId < 0)
      )
        fail("MALFORMED_LAYOUT", `${where}.astId`, "Malformed AST metadata.");
      if (own(value, "contract")) text(value.contract, `${where}.contract`);
      return {
        label,
        type,
        slot,
        offset: value.offset,
        start: slot * 32n + BigInt(value.offset),
        path: where,
      };
    });
  }
  for (const id of typeIds) {
    text(id, `${side}.types identifier`);
    const raw = sourceTypes[id],
      at = `${side}.types[${JSON.stringify(id)}]`;
    keys(
      raw,
      ["encoding", "label", "numberOfBytes", "key", "value", "base", "members"],
      at,
    );
    const label = text(raw.label, `${at}.label`);
    const bytes = decimal(raw.numberOfBytes, `${at}.numberOfBytes`, CAPACITY);
    if (!bytes)
      fail(
        "MALFORMED_TYPE",
        at,
        "A storage type must occupy a positive number of bytes.",
      );
    const node = {
      id,
      label,
      bytes,
      encoding: raw.encoding,
      path: at,
      refs: [],
      inlineRefs: [],
    };
    const has = (field) => own(raw, field);
    if (raw.encoding === "mapping") {
      if (
        !has("key") ||
        !has("value") ||
        has("base") ||
        has("members") ||
        bytes !== 32n ||
        !label.startsWith("mapping(")
      )
        fail("MALFORMED_TYPE", at, "Malformed mapping descriptor.");
      node.kind = "mapping";
      node.key = text(raw.key, `${at}.key`);
      node.value = text(raw.value, `${at}.value`);
      node.refs = [node.key, node.value];
    } else if (raw.encoding === "dynamic_array") {
      if (
        !has("base") ||
        has("key") ||
        has("value") ||
        has("members") ||
        bytes !== 32n ||
        !label.endsWith("[]")
      )
        fail("MALFORMED_TYPE", at, "Malformed dynamic-array descriptor.");
      node.kind = "dynamic_array";
      node.base = text(raw.base, `${at}.base`);
      node.refs = [node.base];
    } else if (raw.encoding === "bytes") {
      if (
        has("base") ||
        has("key") ||
        has("value") ||
        has("members") ||
        bytes !== 32n ||
        !["bytes", "string"].includes(label)
      )
        fail("MALFORMED_TYPE", at, "Malformed bytes/string descriptor.");
      node.kind = "bytes";
    } else if (raw.encoding === "inplace") {
      if (has("key") || has("value") || (has("base") && has("members")))
        fail("MALFORMED_TYPE", at, "Conflicting in-place type fields.");
      if (has("members")) {
        if (!label.startsWith("struct ") || bytes % 32n)
          fail(
            "MALFORMED_TYPE",
            at,
            "Struct size must reserve complete storage slots.",
          );
        node.kind = "struct";
        node.members = entries(raw.members, `${at}.members`);
        if (
          !node.members.length ||
          new Set(node.members.map((member) => member.label)).size !==
            node.members.length
        )
          fail(
            "MALFORMED_TYPE",
            at,
            "Struct members must be nonempty and uniquely named.",
          );
        node.refs = node.members.map((member) => member.type);
        node.inlineRefs = node.refs;
      } else if (has("base")) {
        const length = /\[([0-9]+)\]$/.exec(label);
        if (!length || bytes % 32n)
          fail(
            "MALFORMED_TYPE",
            at,
            "Fixed array length and whole-slot size are required.",
          );
        node.kind = "fixed_array";
        node.length = decimal(length[1], `${at}.arrayLength`, SLOT_COUNT - 1n);
        if (!node.length)
          fail(
            "MALFORMED_TYPE",
            at,
            "Zero-length fixed arrays are unsupported.",
          );
        node.base = text(raw.base, `${at}.base`);
        node.refs = [node.base];
        node.inlineRefs = node.refs;
      } else {
        const width = primitiveSize(label);
        if (!width)
          fail(
            "UNSUPPORTED_TYPE",
            at,
            "Unknown or opaque in-place type; underlying representation cannot be established from this descriptor.",
          );
        if (bytes !== width)
          fail(
            "MALFORMED_TYPE",
            at,
            "Primitive width does not match its canonical type label.",
          );
        node.kind = "scalar";
      }
    } else
      fail("UNSUPPORTED_TYPE", `${at}.encoding`, "Unknown storage encoding.");
    nodes.set(id, node);
  }
  const storage = entries(layout.storage, `${side}.storage`);
  function get(id, at) {
    if (!nodes.has(id))
      fail("MISSING_TYPE", at, "Referenced type is absent from types.");
    return nodes.get(id);
  }
  for (const node of nodes.values()) {
    for (const ref of node.refs) get(ref, node.path);
    if (node.kind === "mapping") {
      const key = get(node.key, node.path);
      if (!["scalar", "bytes"].includes(key.kind))
        fail(
          "MALFORMED_TYPE",
          node.path,
          "Mapping keys must be elementary value or bytes/string types.",
        );
      if (
        node.label !==
        `mapping(${key.label} => ${get(node.value, node.path).label})`
      )
        fail(
          "MALFORMED_TYPE",
          node.path,
          "Mapping label and referenced key/value types disagree.",
        );
    }
    if (
      node.kind === "dynamic_array" &&
      node.label !== `${get(node.base, node.path).label}[]`
    ) {
      fail(
        "MALFORMED_TYPE",
        node.path,
        "Dynamic-array label and referenced base type disagree.",
      );
    }
    if (node.kind === "fixed_array") {
      const base = get(node.base, node.path);
      if (node.label !== `${base.label}[${node.length}]`)
        fail(
          "MALFORMED_TYPE",
          node.path,
          "Fixed-array label and referenced base/length disagree.",
        );
      const needed =
        base.kind === "scalar"
          ? ((node.length + 32n / base.bytes - 1n) / (32n / base.bytes)) * 32n
          : node.length * base.bytes;
      if (needed > CAPACITY || needed !== node.bytes)
        fail(
          "MALFORMED_TYPE",
          node.path,
          "Fixed-array size does not match packed base elements and length.",
        );
    }
  }
  // Inline value recursion is impossible storage. A mapping/dynamic array is a
  // complete one-slot barrier here; its referenced children are still validated.
  const done = new Set(),
    active = new Set();
  function inline(id, depth) {
    if (depth > STORAGE_LAYOUT_LIMITS.depth)
      fail("TOO_COMPLEX", `${side}.types`, "Inline type-depth bound exceeded.");
    if (active.has(id))
      fail(
        "RECURSIVE_VALUE_TYPE",
        get(id, side).path,
        "Recursive in-place value types are invalid.",
      );
    if (done.has(id)) return;
    active.add(id);
    for (const ref of get(id, side).inlineRefs) inline(ref, depth + 1);
    active.delete(id);
    done.add(id);
  }
  for (const id of nodes.keys()) inline(id, 0);
  function sequence(values, at, struct = false) {
    let cursor = struct || !values.length ? 0n : values[0].slot * 32n;
    for (const value of values) {
      const type = get(value.type, value.path);
      const expected =
        type.kind !== "scalar" || (cursor % 32n) + type.bytes > 32n
          ? roundSlot(cursor)
          : cursor;
      if (value.start !== expected)
        fail(
          "INVALID_POSITION",
          value.path,
          "Slot/offset violates compiler packing order or overlaps preceding storage.",
        );
      cursor = value.start + type.bytes;
      if (cursor > CAPACITY)
        fail(
          "OUT_OF_RANGE",
          value.path,
          "Storage extent wraps the EVM slot address space.",
        );
    }
    return cursor;
  }
  for (const node of nodes.values())
    if (node.kind === "struct") {
      const end = sequence(node.members, node.path, true);
      if (roundSlot(end) !== node.bytes)
        fail(
          "MALFORMED_TYPE",
          node.path,
          "Struct extent does not match its rounded member layout.",
        );
    }
  const end = sequence(storage, `${side}.storage`);
  const rooted = new Set();
  const queue = storage.map((value) => value.type);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (rooted.has(id)) continue;
    rooted.add(id);
    queue.push(
      ...get(id, `${side}.storage`).refs.filter((ref) => !rooted.has(ref)),
    );
    if (queue.length > STORAGE_LAYOUT_LIMITS.entries * 2)
      fail("TOO_COMPLEX", side, "Type-reference traversal bound exceeded.");
  }
  return { storage, nodes, end, rooted };
}

/** Preserve all old fields and recursive type shapes; allow only top-level tail appends. */
export function compareStorageLayouts(previous, candidate) {
  const diagnostics = [];
  const add = (code, path, message) => {
    if (diagnostics.length < STORAGE_LAYOUT_LIMITS.diagnostics)
      diagnostics.push({ code, path, message });
  };
  let old, next;
  for (const [side, input] of [
    ["previous", previous],
    ["candidate", candidate],
  ]) {
    try {
      const parsed = validate(input, side);
      if (side === "previous") old = parsed;
      else next = parsed;
    } catch (error) {
      if (!(error instanceof StorageLayoutError)) throw error;
      diagnostics.push(...error.diagnostics);
    }
  }
  const result = () => ({
    compatible: diagnostics.length === 0,
    diagnostics,
    previousVariables: old?.storage.length ?? null,
    candidateVariables: next?.storage.length ?? null,
    appendedVariables:
      old && next
        ? Math.max(0, next.storage.length - old.storage.length)
        : null,
    previousEndByte: old ? String(old.end) : null,
    unrootedDescriptorsChecked: old ? old.nodes.size - old.rooted.size : null,
    namespaceValidation: "not-performed",
    scope: "compiler-declared-persistent-storage-only",
    limitations: [...LIMITATIONS],
  });
  if (!old || !next) return result();
  const seen = new Map();
  let comparisons = 0;
  function equivalent(oldId, nextId, at, depth = 0) {
    if (
      ++comparisons > STORAGE_LAYOUT_LIMITS.comparisons ||
      depth > STORAGE_LAYOUT_LIMITS.depth
    ) {
      add("TOO_COMPLEX", at, "Recursive type-comparison bound exceeded.");
      return;
    }
    const prior = seen.get(oldId);
    if (prior?.has(nextId)) return;
    if (!prior) seen.set(oldId, new Set([nextId]));
    else prior.add(nextId);
    const a = old.nodes.get(oldId),
      b = next.nodes.get(nextId);
    if (
      a.kind !== b.kind ||
      a.encoding !== b.encoding ||
      a.label !== b.label ||
      a.bytes !== b.bytes ||
      a.length !== b.length
    ) {
      add(
        "TYPE_CHANGED",
        at,
        "Canonical type, encoding, byte width or fixed-array length changed.",
      );
      return;
    }
    if (a.kind === "mapping") {
      equivalent(a.key, b.key, `${at}.key`, depth + 1);
      equivalent(a.value, b.value, `${at}.value`, depth + 1);
    } else if (["fixed_array", "dynamic_array"].includes(a.kind))
      equivalent(a.base, b.base, `${at}.base`, depth + 1);
    else if (a.kind === "struct") {
      if (a.members.length !== b.members.length)
        add(
          "STRUCT_CHANGED",
          at,
          "Existing structs must preserve every member; in-struct appends are not accepted.",
        );
      for (let i = 0; i < Math.min(a.members.length, b.members.length); i++) {
        const x = a.members[i],
          y = b.members[i],
          where = `${at}.members[${i}]`;
        if (x.label !== y.label || x.slot !== y.slot || x.offset !== y.offset)
          add(
            "STRUCT_CHANGED",
            where,
            "Struct member name, order, slot or offset changed.",
          );
        equivalent(x.type, y.type, where, depth + 1);
      }
    }
  }
  if (next.storage.length < old.storage.length)
    add(
      "VARIABLE_REMOVED",
      "candidate.storage",
      "An existing variable was removed.",
    );
  for (let i = 0; i < Math.min(old.storage.length, next.storage.length); i++) {
    const a = old.storage[i],
      b = next.storage[i],
      at = `candidate.storage[${i}]`;
    if (a.label !== b.label)
      add(
        "VARIABLE_RENAMED_OR_REORDERED",
        at,
        "Existing variable name and declaration order must remain unchanged.",
      );
    if (a.slot !== b.slot || a.offset !== b.offset)
      add(
        "VARIABLE_MOVED",
        at,
        "Existing slot and byte offset must remain unchanged.",
      );
    equivalent(a.type, b.type, `${at}.type`);
  }
  for (const value of next.storage.slice(old.storage.length))
    if (value.start < old.end)
      add(
        "NOT_TAIL_APPEND",
        value.path,
        "A new variable occupies the old layout extent or internal padding.",
      );
  // A supplied unrooted descriptor could represent manually managed storage.
  // Compare it conservatively, without inventing or validating a namespace root.
  for (const [id, node] of old.nodes)
    if (!old.rooted.has(id)) {
      const matches = [...next.nodes.values()].filter(
        (other) => other.kind === node.kind && other.label === node.label,
      );
      if (matches.length !== 1)
        add(
          "UNROOTED_TYPE_UNPROVEN",
          node.path,
          "Unrooted type needs one unambiguous unchanged canonical descriptor.",
        );
      else equivalent(id, matches[0].id, `${node.path} (unrooted)`);
    }
  return result();
}

export function assertStorageLayoutCompatible(previous, candidate) {
  const result = compareStorageLayouts(previous, candidate);
  if (!result.compatible) throw new StorageLayoutError(result.diagnostics);
  return result;
}

// Read-only CLI: each input must be a direct solc storageLayout object.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 4)
      throw new Error(
        "Usage: node scripts/mainnet/storage-layout.mjs previous-layout.json candidate-layout.json",
      );
    const layouts = process.argv.slice(2).map((filename) => {
      if (fs.statSync(filename).size > STORAGE_LAYOUT_LIMITS.inputBytes)
        throw new Error("Layout JSON input exceeds the bounded file size.");
      return JSON.parse(fs.readFileSync(filename, "utf8"));
    });
    const result = compareStorageLayouts(...layouts);
    console.log(JSON.stringify(result, null, 2));
    if (!result.compatible) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ compatible: false, error: error.message }));
    process.exitCode = 1;
  }
}
