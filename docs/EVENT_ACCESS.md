# Event access

Manage Event uses the existing event contract and two-step ownership transfer.
Adding admins and check-in staff does not upgrade the contract or move deposits.
These controls apply to the current Truth Pays event; previous-event recovery
keeps its original contract and permissions.

| Role | Permissions |
| --- | --- |
| Contract owner | Add/remove admins and staff, record check-ins, review registration and final attendance, propose an ownership transfer. |
| Event admin (server role) | Add/remove check-in staff and record check-ins. |
| Check-in staff | Record door attendance for verified event participants during event hours. |
| Pending owner | Review and accept the ownership transfer. |
| Participant | Existing deposit, recovery and challenge actions. |

Connecting a wallet selects the account. The site remembers the selected wallet
provider on this browser. Home and Manage Event can restore an existing connection
without opening account selection again. Restoration reads the current account and
network from the wallet; a saved preference is never permission to manage an event.

Manage Event loads permissions automatically when a matching signed-in session is
still valid. Otherwise **Sign in to manage** requests one sign-in signature. Account,
network or disconnect changes clear displayed permissions and pending reviews.
A session that expires or belongs to another wallet or server cannot be reused.
Grants are scoped to the event, contract and current on-chain owner. Previous-owner grants do not authorize a new owner's
team. Admin and staff grants are stored on the server, not in the browser, and do
not require a contract transaction. Both reads and writes require a verified wallet
session and fresh contract-owner checks. Only the owner can add or remove admins;
admins cannot transfer ownership or submit the contract's final attendance list.

Door check-ins are recorded off-chain with the staff wallet and time. They appear
separately from the owner's final attendance selection. The owner explicitly
reviews and signs the final on-chain attendance list after the event, using the
existing contract and challenge rules.

Ownership transfer has two wallet transactions: the owner proposes the exact
recipient, then that recipient connects and accepts in Manage Event. The owner
retains authority until acceptance. Existing transaction validation, wallet
checks and original transaction journals also protect transfer and acceptance.
Event ownership is separate from ownership of the project's upgrade controller.

## Deposits and confirmed places

A deposit records a wallet's commitment as withdrawable pending credit. The owner
confirms a place by approving and registering that wallet through the existing
**Approve & register** contract transaction. Adding attendee details on Luma lets
the organizer match the person with that commitment; this application does not
synchronize Luma registrations automatically.

The current contract checks its 150-wallet capacity at registration, not deposit.
A historical deposit receipt can remain after a withdrawal or refund, so it cannot
establish an active seat hold. The public page distinguishes a received commitment
from a wallet registered on the contract. Guaranteed automatic reservations would
require a separate capacity and current-credit workflow; these UI changes do not
change the deployed contract or silently admit attendees.
