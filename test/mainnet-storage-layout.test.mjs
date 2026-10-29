import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import solc from "solc-hardened";
import {
  compareStorageLayouts,
  assertStorageLayoutCompatible,
  StorageLayoutError,
  STORAGE_LAYOUT_LIMITS,
} from "../scripts/mainnet/storage-layout.mjs";

const copy = (value) => structuredClone(value);
function compile(content, name = "C") {
  const input = {
    language: "Solidity",
    sources: {
      "Fixture.sol": { content: "pragma solidity 0.8.38;\n" + content },
    },
    settings: { outputSelection: { "*": { "*": ["storageLayout"] } } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  assert.deepEqual(
    (output.errors ?? []).filter((x) => x.severity === "error"),
    [],
  );
  return output.contracts["Fixture.sol"][name].storageLayout;
}
const simple = (body) => compile(`contract C { ${body} }`);
const success = (old, next) => {
  const result = compareStorageLayouts(old, next);
  assert.equal(result.compatible, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(assertStorageLayoutCompatible(old, next), result);
  return result;
};
const refuses = (old, next, code) => {
  const result = compareStorageLayouts(old, next);
  assert.equal(result.compatible, false);
  if (code)
    assert.ok(
      result.diagnostics.some((x) => x.code === code),
      JSON.stringify(result.diagnostics),
    );
  assert.throws(
    () => assertStorageLayoutCompatible(old, next),
    (error) =>
      error instanceof StorageLayoutError &&
      error.code === "STORAGE_LAYOUT_INCOMPATIBLE" &&
      error.diagnostics.length > 0,
  );
  return result;
};
const recursive = `
contract C {
  enum Phase { Open, Closed }
  struct Node { uint128 a; uint128 b; mapping(address => Node) children; bytes note; }
  mapping(address => Node) nodes;
  Node[] history;
  bytes32[2] hashes;
  uint8[40] packed;
  Phase phase;
  address owner;
  uint128 reserve;
  APPEND
}`;

test("real solc graph comparison ignores AST/type IDs and permits packed tail plus aggregate appends", () => {
  const old = compile(recursive.replace("APPEND", ""));
  const next = compile(
    "contract Unrelated { uint256 noise; }\n" +
      recursive.replace(
        "APPEND",
        "uint128 extraReserve; mapping(uint256 => bytes32) reports;",
      ),
  );
  assert.notEqual(
    old.storage[0].type,
    next.storage[0].type,
    "AST-derived type IDs really changed",
  );
  const result = success(old, next);
  assert.equal(result.appendedVariables, 2);
  assert.equal(next.storage[old.storage.length].slot, old.storage.at(-1).slot);
  assert.equal(next.storage[old.storage.length].offset, 16);
});

test("empty compiler layouts and custom base slots remain valid without claiming namespace safety", () => {
  success(simple(""), simple("uint256 counter;"));
  const old = compile("contract C layout at 42 { uint128 a; }");
  const next = compile("contract C layout at 42 { uint128 a; bool appended; }");
  const result = success(old, next);
  assert.equal(result.namespaceValidation, "not-performed");
  assert.ok(result.limitations.some((x) => x.includes("ERC7201")));
  assert.ok(
    result.limitations.some((x) => x.includes("malicious approved upgrade")),
  );
});

test("field removal, rename, reorder, insertion and slot/packing shifts fail closed", () => {
  const old = simple("uint128 a; uint128 b; uint256 c;");
  for (const body of [
    "uint128 a; uint128 b;",
    "uint128 renamed; uint128 b; uint256 c;",
    "uint128 b; uint128 a; uint256 c;",
    "uint128 a; uint64 inserted; uint128 b; uint256 c;",
    "uint256 a; uint128 b; uint256 c;",
  ])
    refuses(old, simple(body));
  const moved = copy(old);
  moved.storage.forEach((entry) => {
    entry.slot = String(BigInt(entry.slot) + 1n);
  });
  refuses(old, moved, "VARIABLE_MOVED");
  const gap = simple("uint128 a; mapping(address => uint256) values;");
  const filling = copy(gap);
  filling.storage.push({
    label: "lateButInOldPadding",
    slot: "0",
    offset: 16,
    type: gap.storage[0].type,
  });
  refuses(gap, filling, "INVALID_POSITION");
});

test("same-size signedness, mapping-key nominal types, bytes/string and array-base retypes are rejected", () => {
  for (const [before, after] of [
    ["uint128 x;", "int128 x;"],
    ["mapping(address => uint256) x;", "mapping(uint160 => uint256) x;"],
    ["bytes x;", "string x;"],
    ["uint128[] x;", "int128[] x;"],
    ["address x;", "address payable x;"],
    ["enum P {A,B} P x;", "enum Q {A,B} Q x;"],
  ])
    refuses(simple(before), simple(after), "TYPE_CHANGED");
  refuses(
    compile("contract Token {} contract C { Token x; }"),
    simple("address x;"),
    "TYPE_CHANGED",
  );
});

test("struct members preserve names, order, recursive types and layout even when size is unchanged", () => {
  const make = (members) =>
    simple(`struct S { ${members} } mapping(address => S) x;`);
  const old = make("uint128 a; uint128 b;");
  refuses(old, make("uint128 renamed; uint128 b;"), "STRUCT_CHANGED");
  refuses(old, make("uint128 b; uint128 a;"), "STRUCT_CHANGED");
  refuses(old, make("int128 a; uint128 b;"), "TYPE_CHANGED");
  const small = make("uint64 a;");
  const appended = make("uint64 a; bool added;");
  const struct = Object.values(small.types).find((x) => x.members);
  assert.equal(
    struct.numberOfBytes,
    Object.values(appended.types).find((x) => x.members).numberOfBytes,
  );
  refuses(small, appended, "STRUCT_CHANGED");
});

test("fixed-array length and upgrade gaps cannot change even when the byte extent matches", () => {
  const old = simple("uint128[1] x;");
  const next = simple("uint128[2] x;");
  assert.equal(
    old.types[old.storage[0].type].numberOfBytes,
    next.types[next.storage[0].type].numberOfBytes,
  );
  refuses(old, next, "TYPE_CHANGED");
  refuses(
    simple("uint256[50] __gap;"),
    simple("uint256[49] __gap; uint256 added;"),
    "TYPE_CHANGED",
  );
});

test("valid mapping and dynamic-array recursion is bounded and compared structurally", () => {
  for (const children of [
    "mapping(address => Node) children;",
    "Node[] children;",
  ]) {
    const source = `contract C { struct Node { uint256 value; ${children} } Node root; }`;
    const old = compile(source);
    success(old, compile("contract Noise {} " + source));
    refuses(
      old,
      compile(source.replace("uint256 value", "int256 value")),
      "TYPE_CHANGED",
    );
  }
});

test("unrooted supplied type descriptors are preserved, but unknown namespace/root metadata is rejected", () => {
  const old = simple("uint256 counter;");
  old.types.orphan = {
    encoding: "inplace",
    label: "struct Namespace.State",
    numberOfBytes: "32",
    members: [{ label: "initialized", slot: "0", offset: 0, type: "flag" }],
  };
  old.types.flag = { encoding: "inplace", label: "bool", numberOfBytes: "1" };
  const next = copy(old);
  next.types.renumbered = next.types.orphan;
  delete next.types.orphan;
  assert.equal(success(old, next).unrootedDescriptorsChecked, 2);
  next.types.renumbered.members[0].label = "reinterpreted";
  refuses(old, next, "STRUCT_CHANGED");
  for (const field of ["namespaces", "storageNamespaces", "erc7201Roots"])
    refuses(old, { ...copy(old), [field]: {} }, "UNSUPPORTED_NAMESPACE");
});

test("malformed references, encodings, widths, offsets, decimal slots and unknown fields fail closed", () => {
  const old = simple("uint256 a;");
  for (const mutate of [
    (x) => {
      x.storage[0].type = "missing";
    },
    (x) => {
      x.types.t_uint256.encoding = "unknown";
    },
    (x) => {
      x.types.t_uint256.numberOfBytes = "31";
    },
    (x) => {
      x.storage[0].offset = 1;
    },
    (x) => {
      x.storage[0].slot = "-1";
    },
    (x) => {
      x.storage[0].slot = "00";
    },
    (x) => {
      x.storage[0].slot = "0x0";
    },
    (x) => {
      x.storage[0].slot = String(1n << 256n);
    },
    (x) => {
      x.storage[0].futureUnknown = true;
    },
    (x) => {
      x.storage = new Array(1);
    },
    (x) => {
      x.types.t_uint256.label = "uint0256";
    },
  ]) {
    const wrong = copy(old);
    mutate(wrong);
    refuses(old, wrong);
  }
  let getterUsed = false;
  const accessor = { storage: [] };
  Object.defineProperty(accessor, "types", {
    enumerable: true,
    get() {
      getterUsed = true;
      return {};
    },
  });
  refuses(old, accessor, "MALFORMED_LAYOUT");
  assert.equal(getterUsed, false);
  const arrayAccessor = copy(old);
  Object.defineProperty(arrayAccessor.storage, "0", {
    enumerable: true,
    get() {
      getterUsed = true;
      return old.storage[0];
    },
  });
  refuses(old, arrayAccessor, "MALFORMED_LAYOUT");
  assert.equal(getterUsed, false);
});

test("mapping/array descriptors cannot lie about their referenced canonical types or extents", () => {
  for (const body of [
    "mapping(address => uint256) x;",
    "uint128[] x;",
    "uint128[3] x;",
  ]) {
    const old = simple(body),
      wrong = copy(old),
      node = wrong.types[wrong.storage[0].type];
    node.label = node.label
      .replace("uint128", "uint256")
      .replace("address", "uint160");
    refuses(old, wrong, "MALFORMED_TYPE");
  }
  const old = simple("uint128[3] x;"),
    wrong = copy(old);
  wrong.types[wrong.storage[0].type].numberOfBytes = "32";
  refuses(old, wrong, "MALFORMED_TYPE");
});

test("by-value struct/array cycles and unsupported opaque representations are rejected", () => {
  const cyclic = {
    storage: [{ label: "root", slot: "0", offset: 0, type: "s" }],
    types: {
      s: {
        encoding: "inplace",
        label: "struct C.S",
        numberOfBytes: "32",
        members: [{ label: "self", slot: "0", offset: 0, type: "s" }],
      },
    },
  };
  refuses(cyclic, cyclic, "RECURSIVE_VALUE_TYPE");
  const array = {
    storage: [{ label: "root", slot: "0", offset: 0, type: "a" }],
    types: {
      a: {
        encoding: "inplace",
        label: "uint256[1]",
        numberOfBytes: "32",
        base: "a",
      },
    },
  };
  refuses(array, array);
  const udvt = compile("type Money is uint128; contract C { Money amount; }");
  refuses(udvt, udvt, "UNSUPPORTED_TYPE");
  const functionPointer = simple(
    "function(uint256) external returns(uint256) fn;",
  );
  refuses(functionPointer, functionPointer, "UNSUPPORTED_TYPE");
});

test("deep recursive graphs and large inputs have deterministic traversal bounds", () => {
  const graph = {
    storage: [{ label: "root", slot: "0", offset: 0, type: "m0" }],
    types: {
      u: { encoding: "inplace", label: "uint256", numberOfBytes: "32" },
    },
  };
  let child = "u";
  for (let i = 79; i >= 0; i--) {
    const id = `m${i}`;
    graph.types[id] = {
      encoding: "mapping",
      label: `mapping(uint256 => ${graph.types[child].label})`,
      numberOfBytes: "32",
      key: "u",
      value: child,
    };
    child = id;
  }
  refuses(graph, copy(graph), "TOO_COMPLEX");
  const many = {
    storage: Array(STORAGE_LAYOUT_LIMITS.entries + 1).fill({}),
    types: {},
  };
  refuses(many, many, "TOO_COMPLEX");
});

const v9InputPath = fileURLToPath(
  new URL("../build/contracts-v9/standard-input.json", import.meta.url),
);
test(
  "actual v9 Event and Factory accept real compiler-generated derived tail appends",
  { skip: !fs.existsSync(v9InputPath) },
  () => {
    const input = JSON.parse(fs.readFileSync(v9InputPath, "utf8"));
    const filename = "contracts/v9/StorageLayoutAppendFixture.sol";
    input.sources[filename] = {
      content: `pragma solidity 0.8.38;
    import {KlerosEventV9} from "./KlerosEventV9.sol";
    import {KlerosEventFactoryV9} from "./KlerosEventFactoryV9.sol";
    contract EventAppendFixture is KlerosEventV9 { uint256 addedCounter; }
    contract FactoryAppendFixture is KlerosEventFactoryV9 { uint256 addedCounter; }
  `,
    };
    input.settings.outputSelection = { "*": { "*": ["storageLayout"] } };
    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    assert.deepEqual(
      (output.errors ?? []).filter((x) => x.severity === "error"),
      [],
    );
    for (const [original, appended] of [
      ["KlerosEventV9", "EventAppendFixture"],
      ["KlerosEventFactoryV9", "FactoryAppendFixture"],
    ]) {
      const before =
        output.contracts[`contracts/v9/${original}.sol`][original]
          .storageLayout;
      const after = output.contracts[filename][appended].storageLayout;
      assert.equal(success(before, after).appendedVariables, 1);
    }
  },
);
