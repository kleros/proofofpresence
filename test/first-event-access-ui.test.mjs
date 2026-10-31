import test from "node:test";
import assert from "node:assert/strict";
import { Interface } from "ethers";
import { EVENT } from "../public/first-event/event.js";
import { assertFirstEventAccess, assertFirstEventManageDraft } from "../public/first-event-manage.js";
const owner = "0x" + "1".repeat(40), admin = "0x" + "2".repeat(40), staff = "0x" + "3".repeat(40), pending = "0x" + "4".repeat(40), payer = "0x" + "5".repeat(40), zero = "0x" + "0".repeat(40);
const context = wallet => ({ eventId: EVENT.id, chainId: 1, contract: EVENT.contract, wallet, mode: EVENT.mode, abiVersion: EVENT.abiVersion, instanceId: "synthetic-access-ui" });
const dto = (wallet, role) => ({ kind: "event-access", eventId: EVENT.id, chainId: 1, contract: EVENT.contract, instanceId: "synthetic-access-ui", wallet, owner, pendingOwner: pending, role, revision: 2,
  admins: [admin], staff: [staff], checkins: [{ wallet: payer, actorWallet: staff, recordedAt: "2026-11-04T13:00:00.000Z" }] });

test("private access display accepts exact roles and pending-owner precedence without financial capabilities", () => {
  for (const [wallet, role] of [[owner, "owner"], [pending, "pending-owner"], [admin, "admin"], [staff, "staff"]]) assert.equal(assertFirstEventAccess(dto(wallet, role), context(wallet)).role, role);
  const absent = dto(payer, "participant"); absent.admins = []; absent.staff = []; absent.checkins = [];
  assert.equal(assertFirstEventAccess(absent, context(payer)).role, "participant");
  const nonePending = dto(owner, "owner"); nonePending.pendingOwner = zero; assertFirstEventAccess(nonePending, context(owner));
  const precedence = dto(pending, "admin"); precedence.admins.push(pending);
  assert.throws(() => assertFirstEventAccess(precedence, context(pending)));
});

test("private permissions reject changed event/wallet/server, forged roles and incomplete check-in lists", () => {
  for (const alter of [d => d.eventId = "wrong-event", d => d.contract = payer, d => d.chainId = 10200, d => d.instanceId = "wrong-instance", d => d.wallet = staff,
    d => d.owner = zero, d => d.pendingOwner = null, d => d.revision = -1, d => d.role = "owner", d => d.admins.push(admin),
    d => d.checkins.push(d.checkins[0]), d => d.checkins[0].recordedAt = "invalid", d => d.checkins[0].actorWallet = zero]) {
    const invalid = dto(admin, "admin"); alter(invalid); assert.throws(() => assertFirstEventAccess(invalid, context(admin)));
  }
  const disclosure = dto(payer, "participant"); assert.throws(() => assertFirstEventAccess(disclosure, context(payer)));
});

const iface = new Interface(["function transferOwnership(address)", "function acceptOwnership()"]), origin = "https://manage.example.invalid";
const draftFor = (action, params, wallet = owner) => {
  const args = action === "transferOwnership" ? [params.to] : [];
  return { ...context(wallet), id: "synthetic-ownership-draft", action, params, method: action, args, valueWei: "0", scopeKind: "event-call", contractVersion: EVENT.abiVersion,
    snapshot: "sealed-original-snapshot", expiresAt: Date.now() + 60000, origin, transaction: { to: EVENT.contract, from: wallet, chainId: 1, data: iface.encodeFunctionData(action, args), value: "0" } };
};
test("ownership review binds exact recipient, zero ETH, method and original wallet context", () => {
  for (const [action, params, wallet] of [["transferOwnership", { to: pending }, owner], ["acceptOwnership", {}, pending]]) {
    const original = draftFor(action, params, wallet); assertFirstEventManageDraft(original, context(wallet), action, params, origin);
    for (const alter of [d => d.transaction.to = payer, d => d.transaction.from = payer, d => d.transaction.data += "00", d => d.transaction.value = "1", d => d.valueWei = "1", d => d.instanceId = "other", d => d.expiresAt = 1, d => d.args.push(payer)]) {
      const invalid = structuredClone(original); alter(invalid); assert.throws(() => assertFirstEventManageDraft(invalid, context(wallet), action, params, origin));
    }
  }
  const transfer = draftFor("transferOwnership", { to: pending }); transfer.params.to = payer;
  assert.throws(() => assertFirstEventManageDraft(transfer, context(owner), "transferOwnership", { to: pending }, origin));
  const zeroRecipient = draftFor("transferOwnership", { to: zero });
  assert.throws(() => assertFirstEventManageDraft(zeroRecipient, context(owner), "transferOwnership", { to: zero }, origin));
});
