# Event access

Manage Event uses the existing event contract and two-step ownership transfer.
Adding admins and check-in staff does not upgrade the contract or move deposits.
These controls apply to the current Truth Pays event; previous-event recovery
keeps its original contract and permissions.

| Role | Permissions |
| --- | --- |
| Contract owner | Add/remove admins and staff, record check-ins, review registration and final attendance, propose an ownership transfer. |
| Admin | Add/remove check-in staff and record check-ins. |
| Check-in staff | Record door attendance for verified event participants during event hours. |
| Pending owner | Review and accept the ownership transfer. |
| Participant | Existing deposit, recovery and challenge actions. |

Connecting a wallet only selects the account. Use **Load event permissions** to
sign in when managing private access. Grants are scoped to the event, contract
and current on-chain owner. Previous-owner grants do not authorize a new owner's
team. Only the owner can add or remove admins; admins cannot transfer ownership
or submit the contract's final attendance list.

Door check-ins are recorded off-chain with the staff wallet and time. They appear
separately from the owner's final attendance selection. The owner explicitly
reviews and signs the final on-chain attendance list after the event, using the
existing contract and challenge rules.

Ownership transfer has two wallet transactions: the owner proposes the exact
recipient, then that recipient connects and accepts in Manage Event. The owner
retains authority until acceptance. Existing transaction validation, wallet
checks and original transaction journals also protect transfer and acceptance.
Event ownership is separate from ownership of the project's upgrade controller.
