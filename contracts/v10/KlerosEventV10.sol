// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {KlerosUpgradeGateV10, IKlerosV10UpgradeAuthority} from "./KlerosUpgradeGateV10.sol";

/// @notice Kleros Court v1 arbitrator (KlerosLiquid, ERC-792) on Ethereum mainnet
/// (0x988b3A538b618C7A603e1c11Ab82Cd16dbE28069): the fee and the appeal views this contract reads.
/// Extra data = abi.encode(uint256 subcourtID, uint256 minJurors). Periods: 0 evidence, 1 commit,
/// 2 vote, 3 appeal, 4 execution. Anyone can move a case on with `passPeriod(disputeID)` and, in
/// the execution period, deliver the ruling with `executeRuling(disputeID)`.
interface IKlerosLiquid {
    function arbitrationCost(bytes calldata extraData) external view returns (uint256 cost);
    function appealCost(uint256 disputeID, bytes calldata extraData) external view returns (uint256 cost);
    function appealPeriod(uint256 disputeID) external view returns (uint256 start, uint256 end);
    function currentRuling(uint256 disputeID) external view returns (uint256 ruling);
}

/// @notice Kleros's general-purpose Dispute Resolver (ArbitrableProxy) on Ethereum mainnet
/// (0x4b89e798b10478a839ea0abcf86c4b94a3c782a4). It is the arbitrable party in KlerosLiquid: it
/// opens the case, takes the evidence and the appeal crowdfunding, and records the final ruling.
/// Besides what this contract calls, people use it directly from their own wallets:
///  - `submitEvidence(uint256 localDisputeID, string evidenceURI)`: ERC-1497 evidence, refused once ruled;
///  - `fundAppeal(uint256 localDisputeID, uint256 ruling) payable`: appeal crowdfunding, surplus refunded;
///  - `withdrawFeesAndRewardsForAllRounds(uint256 localDisputeID, address contributor, uint256[] rulings)`:
///    appeal refunds and rewards, paid to the contributor once the case is ruled.
interface IArbitrableProxy {
    function arbitrator() external view returns (IKlerosLiquid);
    function createDispute(bytes calldata arbitratorExtraData, string calldata metaevidenceURI, uint256 numberOfRulingOptions)
        external
        payable
        returns (uint256 arbitratorDisputeID);
    function externalIDtoLocalID(uint256 arbitratorDisputeID) external view returns (uint256 localDisputeID);
    function disputes(uint256 localDisputeID)
        external
        view
        returns (bytes memory arbitratorExtraData, bool isRuled, uint256 ruling, uint256 disputeIDOnArbitratorSide);
    function getMultipliers()
        external
        view
        returns (uint256 winnerStakeMultiplier, uint256 loserStakeMultiplier, uint256 loserAppealPeriodMultiplier, uint256 denominator);
}

/// @notice The ERC-20 call `returnToken` makes, to give back tokens sent here by mistake.
interface IERC20Transfer {
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title KlerosEventV10
/// @notice One native-ETH event with curated admission and Kleros V1 attendance challenges.
/// Pending deposits are credited to their sender, reserved in every phase, and individually
/// withdrawable to a chosen address. Only each wallet's own credit can collateralize admission.
/// Deposits close at eventStart. The bounded lifetime admission list never repeats an address.
/// The organizer still controls admission and initial attendance inclusions; omitted admitted
/// participants can challenge. The organizer identity is snapshotted at challenge opening for
/// immutable case evidence, while administrative ownership remains transferable.
/// Attendees are paid while disputed shares remain reserved. Subsequent losses top up all final
/// attendees equally (up to rounding dust); ruling 0 excludes the challenger and splits remaining
/// challenge collateral between both parties, preserving the v7 economics.
/// Failed payments become wallet-owned `owed`, claimable to another recipient. Pending credits,
/// open shares and challenge collateral cannot be withdrawn as organizer spare ETH.
/// This new UUPS family does not upgrade or alter historical v8 or v9 deployments.
/// Immediate project-controller upgrades affect code until controller ownership is renounced.
/// Organizer ownership never grants upgrade authority.
contract KlerosEventV10 is KlerosUpgradeGateV10 {
    // ------------------------------------------------------------------ errors
    error NotOwner();
    error InvalidFactory();
    error NotPendingOwner();
    error NotOpen();
    error NotListed();
    error NotSettled();
    error ZeroAddress();
    error InvalidArbitrator();
    error BadTimes();
    error TooLate();
    error TooEarly();
    error Reentrancy();
    error AlreadyRegistered(address staker);
    error NotAStaker(address account);
    error CannotReject(address account);
    error DuplicateAttendee(address account);
    error NoAttendees();
    error ShareMismatch(uint256 expected, uint256 actual);
    error InsufficientBalance(uint256 required, uint256 available);
    error NothingToClaim();
    error TransferFailed(address to, uint256 amount);
    error AlreadyAttending(address account);
    error AlreadyChallenged(address account);
    error NoChallenge(address account);
    error WrongChallengeState(address account);
    error WrongDeposit(uint256 required, uint256 sent);
    error ArbitrationCostTooHigh(uint256 cost, uint256 available);
    error NotRuled(address account);
    error ChallengesPending(uint256 count);
    error OnlyNumberedRulings();
    error InDispute(address staker);
    error NotAppealable(address staker);
    error ZeroDeposit();
    error NotEnoughGas();
    error BadMetaEvidenceTemplate();
    error BadEventMetadata();
    error InsufficientPendingDeposit(address payer, uint256 required, uint256 available);
    error CapacityExceeded(uint256 maximum);
    error InvalidPendingWithdrawal();
    error ResolvedChallenge(address staker);

    // ------------------------------------------------------------------ events
    event Deposited(address indexed from, uint256 amount);
    event PendingWithdrawn(address indexed payer, address indexed to, uint256 amount);
    event StakerRegistered(address indexed staker);
    event Rejected(address indexed wallet, uint256 refunded);
    event AttendancePosted(uint256 attendees, uint256 challengeEndsAt);
    event AttendeeAdded(address indexed attendee);
    event Challenged(address indexed staker, uint256 deposit, uint256 matchEndsAt);
    event ChallengeMatched(address indexed staker, address indexed matcher, uint256 arbitratorDisputeID, uint256 localDisputeID);
    event ChallengeResolved(address indexed staker, bool attended, uint256 ruling);
    /// @notice A share of the pool or a deposit refund reached `to` (challenge money is not logged here).
    event Payout(address indexed to, uint256 amount);
    /// @notice A payment (share, refund or challenge money) could not be delivered: it waits in `owed`.
    event PayoutFailed(address indexed to, uint256 amount);
    event Claimed(address indexed account, address indexed to, uint256 amount);
    event Finalized(uint256 stakers, uint256 attendees, uint256 pool, uint256 share);
    event ShareHeldBack(address indexed staker, uint256 amount);
    event HeldShareSplit(address indexed staker, uint256 attendees, uint256 openCases, uint256 each);
    event Cancelled(uint256 stakers, uint256 refundedEach);
    event EmergencyWithdrawn(address indexed staker, uint256 amount);
    event Refunded(address indexed to, uint256 amount);
    event Swept(address indexed to, uint256 amount);
    event TokenReturned(address indexed token, address indexed to, uint256 amount);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ------------------------------------------------------------------ state
    enum Phase {
        Open, // deposits and curation
        Listed, // attendance posted: challenge window, then waiting for disputes
        Finalized, // pool paid out
        Cancelled // event called off, deposits refunded
    }

    enum Status {
        None,
        Staker,
        Paid,
        Rejected
    }

    enum ChallengeState {
        None,
        Waiting, // challenger paid, waiting for someone to match
        Disputed, // matched: a Kleros case is open
        Resolved
    }

    struct Challenge {
        ChallengeState state;
        address matcher;
        uint64 matchEndsAt;
        uint256 deposit; // ETH paid by each side
        uint256 arbitratorDisputeID; // Kleros's case number (KlerosLiquid)
        uint256 localDisputeID; // the case's number inside the Dispute Resolver: evidence and appeals use it
        uint256 arbitrationPaid; // ETH spent on the Kleros fee
        // ETH set aside because the case was still open at payout (0 if none): one share, plus one
        // part of every case lost since. Always > 0 while set aside (a share is at least `depositAmount`).
        uint256 heldShare;
    }

    /// @notice Kleros settings, passed to the constructor as one struct.
    struct Arbitration {
        IArbitrableProxy disputeResolver;
        bytes extraData; // abi.encode(uint256 subcourtID, uint256 minJurors), e.g. General Court (0), 3 jurors
        // The case description (ERC-1497 metaevidence) as text pieces with a value between each two:
        // pieces[0] + value(slots[0]) + pieces[1] + ... + pieces[n]. Slot 1 is the challenged wallet
        // and slot 2 this contract, each as a checksummed 0x address; slot 3 is the challenged wallet
        // in lower case (Kleros Court matches evidence senders against `aliases` in lower case).
        // Slot 4 is the case organizer checksummed, slot 5 lowercase. Slots 1, 2 and 4 are mandatory.
        string[] metaEvidenceTemplate;
        bytes metaEvidenceSlots;
        string policyURI; // the attendance policy jurors apply (the metaevidence's fileURI), e.g. /ipfs/Qm...
    }

    /// @notice Explicit implementation version for factory/application dispatch.
    uint256 public constant VERSION = 10;
    bytes32 public constant UPGRADE_FAMILY = keccak256("kleros.event.v10.uups");
    /// @notice Lifetime unique admitted-wallet bound; pending depositors never enter settlement loops.
    uint256 public constant MAX_STAKERS = 150;
    uint256 public constant MAX_META_SLOTS = 32;
    uint256 public constant MAX_META_BYTES = 12_288;
    uint256 public constant MAX_EVENT_NAME_BYTES = 256;
    uint256 public constant MAX_POLICY_URI_BYTES = 512;
    uint256 public constant MAX_EXTRA_DATA_BYTES = 128;
    /// @notice Ruling options for a Kleros attendance case (0 = refused to arbitrate).
    uint256 public constant RULING_ATTENDED = 1;
    uint256 public constant RULING_ABSENT = 2;
    uint256 public constant RULING_OPTIONS = 2;
    /// @notice Values written into the case description template (`metaEvidenceSlots`).
    uint8 public constant SLOT_STAKER = 1;
    uint8 public constant SLOT_CONTRACT = 2;
    uint8 public constant SLOT_STAKER_LOWER = 3;
    uint8 public constant SLOT_ORGANIZER = 4;
    uint8 public constant SLOT_ORGANIZER_LOWER = 5;
    uint256 public constant CHALLENGE_PERIOD = 1 days;
    uint256 public constant MATCH_PERIOD = 1 days;
    /// @notice Minimum time between the event start and the deadline, so a late list is still possible.
    uint256 public constant MIN_SETTLEMENT_WINDOW = 7 days;
    /// @notice Per-recipient batch gas allowance. A recipient that refuses or consumes this gas
    /// receives a reserved owed credit instead. The lifetime admission bound limits every batch;
    /// settle expired unmatched challenges individually before payout if their combined refund
    /// and payout work would exceed the transaction gas limit. claim forwards caller-supplied gas.
    uint256 public constant PAYOUT_GAS = 40_000;

    /// @notice The deposit per guest, in wei (0.01 ETH = 10000000000000000).
    uint256 public depositAmount;
    /// @notice `postAttendance` is only possible from this time (unix seconds): no accidental early payout.
    uint256 public eventStart;
    /// @notice Deadline to post the attendance list. After it, if still open, stakers can withdraw their own deposit.
    uint256 public claimDeadline;
    /// @notice Kleros's Dispute Resolver (ArbitrableProxy): opens cases, takes evidence and appeals, records rulings.
    IArbitrableProxy public disputeResolver;
    /// @notice Kleros Court (KlerosLiquid), read from the Dispute Resolver at deployment.
    IKlerosLiquid public arbitrator;
    bytes public arbitratorExtraData;
    /// @notice Holds the case description template (`abi.encode(pieces, slots)`) as its code, after a
    /// STOP byte so it can never run: reading code back costs a few thousand gas, where storage would
    /// cost one read per 32 bytes on every match. See `metaEvidenceTemplate()`.
    address public metaEvidenceStore;
    string public policyURI;
    string public eventName;

    address public owner;
    address public pendingOwner;
    Phase public phase;

    mapping(address => Status) public status;
    address[] private _stakers;
    uint256 public stakerCount; // active stakers
    mapping(address => bool) private _everAdmitted;
    /// @notice Unadmitted/excess ETH belongs to its payer and is always reserved and withdrawable.
    mapping(address => uint256) public pendingDeposits;
    uint256 public pendingTotal;

    mapping(address => bool) public attended;
    address[] private _attendees;
    uint256 public attendeeCount;
    uint256 public challengeEndsAt;

    mapping(address => Challenge) public challenges;
    /// @notice Organizer authorized when the challenge opened. Later ownership changes cannot rewrite a case.
    mapping(address => address) public caseOrganizer;
    address[] private _challengers;
    uint256 public pendingChallenges; // waiting for a match, or in a Kleros case
    /// @notice ETH held for challenges: the challenger's deposit while waiting for a match, then what
    /// is left of both deposits after the Kleros fee until the case is settled.
    uint256 public challengeEscrow;
    /// @notice The per-attendee payout, set by `releasePayouts`. A part of every Kleros case lost
    /// after payout is paid on top (see `_settleHeldShare`).
    uint256 public payoutShare;
    /// @notice ETH set aside for challengers still in a Kleros case: the sum of their `heldShare`.
    uint256 public heldBack;

    /// @notice Payments (shares, refunds, challenge money) that could not be delivered, waiting for `claim`.
    mapping(address => uint256) public owed;
    uint256 public owedTotal;

    address public originatingFactory;
    uint256 private _locked;

    // ------------------------------------------------------------------ setup
    function initialize(
        uint256 depositAmount_,
        string memory eventName_,
        address owner_,
        uint256 eventStart_,
        uint256 claimDeadline_,
        Arbitration calldata arbitration_,
        address originatingFactory_
    ) external initializer {
        _locked = 2;
        require(msg.sender == originatingFactory_ && originatingFactory_.code.length > 0, InvalidFactory());
        _initializeUpgradeAuthority(IKlerosV10UpgradeAuthority(originatingFactory_).upgradeAuthority());
        originatingFactory = originatingFactory_;
        phase = Phase.Open;
        require(depositAmount_ > 0, ZeroDeposit());
        require(bytes(eventName_).length > 0 && bytes(eventName_).length <= MAX_EVENT_NAME_BYTES, BadEventMetadata());
        require(bytes(arbitration_.policyURI).length > 0 && bytes(arbitration_.policyURI).length <= MAX_POLICY_URI_BYTES, BadEventMetadata());
        require(arbitration_.extraData.length <= MAX_EXTRA_DATA_BYTES, BadEventMetadata());
        require(owner_ != address(0), ZeroAddress());
        require(address(arbitration_.disputeResolver) != address(0), ZeroAddress());
        require(eventStart_ > block.timestamp, BadTimes());
        require(claimDeadline_ >= eventStart_ + MIN_SETTLEMENT_WINDOW, BadTimes());
        // reverts if the address is not a Dispute Resolver
        IKlerosLiquid court = arbitration_.disputeResolver.arbitrator();
        require(address(court) != address(0), ZeroAddress());
        require(address(court).code.length > 0, InvalidArbitrator());
        depositAmount = depositAmount_;
        eventName = eventName_;
        owner = owner_;
        eventStart = eventStart_;
        claimDeadline = claimDeadline_;
        disputeResolver = arbitration_.disputeResolver;
        arbitrator = court;
        arbitratorExtraData = arbitration_.extraData;
        string[] memory pieces = arbitration_.metaEvidenceTemplate;
        bytes memory slots = arbitration_.metaEvidenceSlots;
        require(slots.length <= MAX_META_SLOTS && pieces.length == slots.length + 1, BadMetaEvidenceTemplate());
        bool namesStaker;
        bool namesContract;
        bool namesOrganizer;
        for (uint256 i; i < slots.length; ++i) {
            uint8 slot = uint8(slots[i]);
            require(slot >= SLOT_STAKER && slot <= SLOT_ORGANIZER_LOWER, BadMetaEvidenceTemplate());
            if (slot == SLOT_STAKER) namesStaker = true;
            if (slot == SLOT_CONTRACT) namesContract = true;
            if (slot == SLOT_ORGANIZER) namesOrganizer = true;
        }
        require(namesStaker && namesContract && namesOrganizer, BadMetaEvidenceTemplate());
        bytes memory templateData = abi.encode(pieces, slots);
        require(templateData.length <= MAX_META_BYTES, BadMetaEvidenceTemplate());
        metaEvidenceStore = _storeData(templateData);
        policyURI = arbitration_.policyURI;
        emit OwnershipTransferred(address(0), owner_);
        _locked = 1;
    }

    function storageSchema() public pure virtual override returns (bytes32) { return EVENT_SCHEMA; }
    function _upgradeFamily() internal pure override returns (bytes32) { return UPGRADE_FAMILY; }
    function _upgradeIdle() internal view override returns (bool) { return _locked == 1; }

    modifier onlyOwner() {
        require(msg.sender == owner, NotOwner());
        _;
    }

    modifier whenOpen() {
        require(phase == Phase.Open, NotOpen());
        _;
    }

    modifier whenListed() {
        require(phase == Phase.Listed, NotListed());
        _;
    }

    /// @dev Admission, posting and cancellation end at this deadline; registered stakers then exit themselves.
    modifier beforeDeadline() {
        require(block.timestamp <= claimDeadline, TooLate());
        _;
    }

    modifier nonReentrant() {
        require(_locked == 1, Reentrancy());
        _locked = 2;
        _;
        _locked = 1;
    }

    // ------------------------------------------------------------------ deposits

    /// @notice A plain transfer credits its sender. Accepted only while Open and before eventStart.
    receive() external payable nonReentrant {
        _deposit();
    }

    /// @notice Credit ETH to your own pending balance, while Open and before eventStart.
    function deposit() external payable nonReentrant {
        _deposit();
    }

    // ------------------------------------------------------------------ views

    /// @notice ETH that must stay in the contract: the staked pool until paid out (then the shares
    /// set aside for open Kleros cases), unclaimed payments, challenge money and pending payer credits.
    function reserved() public view returns (uint256) {
        bool poolHeld = phase == Phase.Open || phase == Phase.Listed;
        return (poolHeld ? depositAmount * stakerCount : heldBack) + owedTotal + challengeEscrow + pendingTotal;
    }

    /// @notice ETH nobody is owed: forced transfers and settlement rounding dust.
    /// Deposits and overpayments are pending payer credits, never spare.
    function spare() public view returns (uint256) {
        uint256 bal = address(this).balance;
        uint256 r = reserved();
        return bal > r ? bal - r : 0;
    }

    /// @notice Unique lifetime admitted wallets, at most MAX_STAKERS. Readmissions never append duplicates.
    function stakers() external view returns (address[] memory) {
        return _stakers;
    }

    /// @notice Everyone on the attendance list so far (posted, added, or confirmed by a challenge).
    function attendees() external view returns (address[] memory) {
        return _attendees;
    }

    /// @notice Every staker who opened a challenge.
    function challengers() external view returns (address[] memory) {
        return _challengers;
    }

    /// @notice Preview the payout per attendee for a given attendee count.
    function previewShare(uint256 attendeeCount_) external view returns (uint256) {
        if (attendeeCount_ == 0) return 0;
        return (depositAmount * stakerCount) / attendeeCount_;
    }

    /// @notice The case description template, as passed at deployment (see `Arbitration`).
    function metaEvidenceTemplate() public view returns (string[] memory pieces, bytes memory slots) {
        address store = metaEvidenceStore;
        uint256 size = store.code.length - 1; // after the STOP byte
        bytes memory data = new bytes(size);
        assembly ("memory-safe") {
            extcodecopy(store, add(data, 32), 1, size)
        }
        return abi.decode(data, (string[], bytes));
    }

    /// @notice The case description (ERC-1497 metaevidence) of a Kleros case on `staker`'s
    /// challenge: the template with the wallet and this contract filled in. `uri` is the IPFS path
    /// of exactly `text` ("/ipfs/Qm...", CIDv0), as `ipfs add` computes it with its default settings
    /// (and so Kleros's IPFS upload service): `matchChallenge` sends it to Kleros, and anyone can
    /// publish `text` to IPFS to make the case readable. Organizer identity follows owner before a
    /// challenge opens, then remains fixed to caseOrganizer[staker] for that case.
    function caseMetaEvidence(address staker) public view returns (string memory text, string memory uri) {
        (string[] memory pieces, bytes memory slots) = metaEvidenceTemplate();
        bytes memory wallet = _checksummed(staker);
        bytes memory self = _checksummed(address(this));
        bytes memory lower = _lowerHex(staker);
        address organizer = caseOrganizer[staker];
        if (organizer == address(0)) organizer = owner;
        bytes memory organizerChecksum = _checksummed(organizer);
        bytes memory organizerLower = _lowerHex(organizer);
        bytes memory out = bytes(pieces[0]);
        for (uint256 i; i < slots.length; ++i) {
            uint8 slot = uint8(slots[i]);
            bytes memory value = slot == SLOT_STAKER ? wallet
                : slot == SLOT_CONTRACT ? self
                : slot == SLOT_STAKER_LOWER ? lower
                : slot == SLOT_ORGANIZER ? organizerChecksum
                : organizerLower;
            out = bytes.concat(out, value, bytes(pieces[i + 1]));
        }
        return (string(out), string.concat("/ipfs/", _ipfsPath(out)));
    }

    /// @notice ETH needed to open a challenge right now: the Kleros arbitration cost. Matching an
    /// open challenge takes that challenge's own deposit (`challenges(staker).deposit`).
    function challengeDeposit() public view returns (uint256) {
        return arbitrator.arbitrationCost(arbitratorExtraData);
    }

    /// @notice Where the Kleros case on `staker`'s challenge stands, for an appeal. Funders pay the
    /// Dispute Resolver directly, from their own wallet:
    /// `disputeResolver.fundAppeal(challenges(staker).localDisputeID, side)`. The amounts follow the
    /// Dispute Resolver's own rule: the side the jurors voted for pays the appeal cost plus the
    /// winner stake (1x today) until `end`; any other side (both, after a tie or a refusal) pays the
    /// cost plus the loser stake (2x today) and only until `loserEnd`. Funding must happen strictly
    /// before the deadline. What each side has raised so far is in the Dispute Resolver's
    /// `Contribution` and `RulingFunded` events.
    /// @return ruling The jurors' current vote (0 tied or refused, 1 attended, 2 absent).
    /// @return start Start of the appeal period (0 if the case is not in its appeal period).
    /// @return end End of the appeal period.
    /// @return loserEnd Until when a side the jurors did not vote for can still be funded.
    /// @return costAttended Total needed to fund the "attended" side this round.
    /// @return costAbsent Total needed to fund the "did not attend" side this round.
    function appealStatus(address staker)
        external
        view
        returns (uint256 ruling, uint256 start, uint256 end, uint256 loserEnd, uint256 costAttended, uint256 costAbsent)
    {
        Challenge storage c = challenges[staker];
        require(c.state == ChallengeState.Disputed, NotAppealable(staker));
        uint256 id = c.arbitratorDisputeID;
        ruling = arbitrator.currentRuling(id);
        (start, end) = arbitrator.appealPeriod(id);
        if (end == 0) return (ruling, 0, 0, 0, 0, 0);
        (uint256 winnerMul, uint256 loserMul, uint256 loserPeriodMul, uint256 denominator) = disputeResolver.getMultipliers();
        loserEnd = start + ((end - start) * loserPeriodMul) / denominator;
        uint256 cost = arbitrator.appealCost(id, arbitratorExtraData);
        uint256 winner = _withStake(cost, winnerMul, denominator);
        uint256 loser = _withStake(cost, loserMul, denominator);
        costAttended = ruling == RULING_ATTENDED ? winner : loser;
        costAbsent = ruling == RULING_ABSENT ? winner : loser;
    }

    // ------------------------------------------------------------------ curation (organiser)

    /// @notice Admit curated wallets using each wallet's own pending collateral, exactly once per admission.
    /// Readmissions reuse their lifetime entry; the unique lifetime set is bounded by MAX_STAKERS.
    function registerStakers(address[] calldata wallets) external nonReentrant onlyOwner whenOpen beforeDeadline {
        for (uint256 i; i < wallets.length; ++i) {
            address s = wallets[i];
            require(s != address(0) && s != address(this), ZeroAddress());
            Status st = status[s];
            require(st == Status.None || st == Status.Rejected, AlreadyRegistered(s));
            uint256 credit = pendingDeposits[s];
            require(credit >= depositAmount, InsufficientPendingDeposit(s, depositAmount, credit));
            if (!_everAdmitted[s]) {
                require(_stakers.length < MAX_STAKERS, CapacityExceeded(MAX_STAKERS));
                _everAdmitted[s] = true;
                _stakers.push(s);
            }
            pendingDeposits[s] = credit - depositAmount;
            pendingTotal -= depositAmount;
            status[s] = Status.Staker;
            emit StakerRegistered(s);
        }
        stakerCount += wallets.length;
    }

    /// @notice Refund an active staker's principal while Open, or one deposit from a payer's pending credit.
    /// The refund belongs to that wallet. Its excess credit remains independently withdrawable.
    function rejectAndRefund(address[] calldata wallets) external nonReentrant onlyOwner {
        for (uint256 i; i < wallets.length; ++i) {
            address w = wallets[i];
            require(w != address(0) && w != address(this), ZeroAddress());
            Status st = status[w];
            if (st == Status.Staker && phase == Phase.Open) {
                stakerCount -= 1;
            } else {
                require(st == Status.None || st == Status.Rejected, CannotReject(w));
                uint256 credit = pendingDeposits[w];
                require(credit >= depositAmount, InsufficientPendingDeposit(w, depositAmount, credit));
                pendingDeposits[w] = credit - depositAmount;
                pendingTotal -= depositAmount;
            }
            status[w] = Status.Rejected;
            emit Rejected(w, depositAmount);
            _payOrOwe(w, depositAmount);
        }
    }

    /// @notice Recover any amount of your own pending/unadmitted credit in every phase, to a chosen recipient.
    function withdrawPending(address to, uint256 amount) external nonReentrant {
        require(amount > 0, InvalidPendingWithdrawal());
        uint256 credit = pendingDeposits[msg.sender];
        require(amount <= credit, InsufficientPendingDeposit(msg.sender, amount, credit));
        pendingDeposits[msg.sender] = credit - amount;
        pendingTotal -= amount;
        emit PendingWithdrawn(msg.sender, to, amount);
        _sendOrRevert(to, amount);
    }

    /// @notice Return spare ETH only: never pending credit, the staked pool, held shares, challenge
    /// money or unclaimed payments. Payers recover their own credit with withdrawPending.
    function refund(address to, uint256 amount) external nonReentrant onlyOwner {
        require(amount <= spare(), InsufficientBalance(reserved() + amount, address(this).balance));
        emit Refunded(to, amount);
        _sendOrRevert(to, amount);
    }

    /// @notice Send back ERC-20 tokens (USDC, for example) that someone sent to this address by
    /// mistake. Deposits are ETH only, so this contract holds no tokens of its own, and this call
    /// sends no ETH: it can never touch the pool or anything in `reserved()`. Allowed in every phase.
    function returnToken(address token, address to, uint256 amount) external nonReentrant onlyOwner {
        require(to != address(0) && to != address(this), ZeroAddress());
        emit TokenReturned(token, to, amount);
        // USDC answers true; some tokens (USDT) answer nothing, which counts as done if `token` is a
        // contract (a call to an address without code would "succeed" without moving anything)
        (bool ok, bytes memory answer) = token.call(abi.encodeCall(IERC20Transfer.transfer, (to, amount)));
        require(ok && token.code.length > 0 && (answer.length == 0 || abi.decode(answer, (bool))), TransferFailed(to, amount));
    }

    // ------------------------------------------------------------------ attendance

    /// @notice Publish the registered stakers who checked in. Opens the 1-day challenge window.
    /// From then on deposits are refused.
    /// @param list Registered stakers who checked in at the venue (no duplicates).
    /// @param expectedShare The per-attendee amount (wei) the organiser saw and confirmed in the console.
    function postAttendance(address[] calldata list, uint256 expectedShare)
        external
        nonReentrant
        onlyOwner
        whenOpen
        beforeDeadline
    {
        require(block.timestamp >= eventStart, TooEarly());
        require(list.length > 0, NoAttendees());
        uint256 bal = address(this).balance;
        uint256 r = reserved();
        require(bal >= r, InsufficientBalance(r, bal));
        uint256 share = (depositAmount * stakerCount) / list.length;
        require(share == expectedShare, ShareMismatch(expectedShare, share));

        for (uint256 i; i < list.length; ++i) {
            _addAttendee(list[i]);
        }
        phase = Phase.Listed;
        challengeEndsAt = block.timestamp + CHALLENGE_PERIOD;
        emit AttendancePosted(list.length, challengeEndsAt);
    }

    /// @notice The organiser adds stakers they left off the list by mistake (during the challenge window).
    /// If such a staker already challenged and nobody matched yet, their challenge deposit goes back to them.
    function addAttendees(address[] calldata list) external nonReentrant onlyOwner whenListed {
        require(block.timestamp <= challengeEndsAt, TooLate());
        for (uint256 i; i < list.length; ++i) {
            address a = list[i];
            Challenge storage c = challenges[a];
            // once in a Kleros case the jurors decide; the organiser can say so in the case (policy: rule Yes)
            require(c.state != ChallengeState.Disputed, InDispute(a));
            require(c.state != ChallengeState.Resolved, ResolvedChallenge(a));
            _addAttendee(a);
            if (c.state == ChallengeState.Waiting) {
                c.state = ChallengeState.Resolved;
                pendingChallenges -= 1;
                challengeEscrow -= c.deposit;
                emit ChallengeResolved(a, true, RULING_ATTENDED);
                _send(a, c.deposit);
            }
        }
    }

    // ------------------------------------------------------------------ challenges (Kleros)

    /// @notice A registered staker left off the list says they attended. Pay `challengeDeposit()` in ETH
    /// (any extra is sent back).
    function challenge() external payable nonReentrant whenListed {
        require(block.timestamp <= challengeEndsAt, TooLate());
        require(status[msg.sender] == Status.Staker, NotAStaker(msg.sender));
        require(!attended[msg.sender], AlreadyAttending(msg.sender));
        Challenge storage c = challenges[msg.sender];
        require(c.state == ChallengeState.None, AlreadyChallenged(msg.sender));
        uint256 cost = challengeDeposit();
        require(msg.value >= cost, WrongDeposit(cost, msg.value));

        caseOrganizer[msg.sender] = owner;
        c.state = ChallengeState.Waiting;
        c.deposit = cost;
        c.matchEndsAt = uint64(block.timestamp + MATCH_PERIOD);
        _challengers.push(msg.sender);
        pendingChallenges += 1;
        challengeEscrow += cost;
        emit Challenged(msg.sender, cost, c.matchEndsAt);
        if (msg.value > cost) _send(msg.sender, msg.value - cost);
    }

    /// @notice Disagree with a challenge: match its deposit within 1 day. This opens a Kleros case
    /// through the Dispute Resolver (any extra ETH is sent back).
    function matchChallenge(address staker) external payable nonReentrant whenListed {
        Challenge storage c = challenges[staker];
        require(c.state != ChallengeState.None, NoChallenge(staker));
        require(c.state == ChallengeState.Waiting, WrongChallengeState(staker));
        require(block.timestamp <= c.matchEndsAt, TooLate());
        require(msg.value >= c.deposit, WrongDeposit(c.deposit, msg.value));

        // the fee is paid from the two deposits; the rest goes to whoever wins
        uint256 cost = challengeDeposit();
        require(cost <= 2 * c.deposit, ArbitrationCostTooHigh(cost, 2 * c.deposit));
        c.state = ChallengeState.Disputed;
        c.matcher = msg.sender;
        c.arbitrationPaid = cost;
        challengeEscrow = challengeEscrow + c.deposit - cost;
        // KlerosLiquid keeps everything sent with a case, so send exactly the fee
        (, string memory metaEvidenceURI) = caseMetaEvidence(staker);
        uint256 id = disputeResolver.createDispute{value: cost}(arbitratorExtraData, metaEvidenceURI, RULING_OPTIONS);
        uint256 localID = disputeResolver.externalIDtoLocalID(id);
        c.arbitratorDisputeID = id;
        c.localDisputeID = localID;
        emit ChallengeMatched(staker, msg.sender, id, localID);
        if (msg.value > c.deposit) _send(msg.sender, msg.value - c.deposit);
    }

    /// @notice Settle a challenge once it can be: unmatched after its match window (counts as
    /// attended), or ruled by Kleros. Only the final ruling counts: the one the Dispute Resolver
    /// records after the last appeal period. A refusal to arbitrate (0) keeps the guest off the
    /// list, like "did not attend", and splits what is left of the challenge deposits in half.
    /// Anyone can call it.
    function resolveChallenge(address staker) external nonReentrant {
        Challenge storage c = challenges[staker];
        require(c.state != ChallengeState.None, NoChallenge(staker));
        if (c.state == ChallengeState.Waiting) {
            require(block.timestamp > c.matchEndsAt, TooEarly());
            _acceptUnmatched(staker, c);
        } else {
            require(c.state == ChallengeState.Disputed, WrongChallengeState(staker));
            (, bool isRuled, uint256 ruling,) = disputeResolver.disputes(c.localDisputeID);
            require(isRuled, NotRuled(staker));
            require(ruling <= RULING_ABSENT, OnlyNumberedRulings());
            c.state = ChallengeState.Resolved;
            pendingChallenges -= 1;
            uint256 remaining = 2 * c.deposit - c.arbitrationPaid;
            challengeEscrow -= remaining;

            bool won = ruling == RULING_ATTENDED;
            if (won && !attended[staker] && phase == Phase.Listed) _addAttendee(staker);
            emit ChallengeResolved(staker, won, ruling);
            if (c.heldShare > 0) _settleHeldShare(staker, c, won);

            if (won) {
                _send(staker, remaining);
            } else if (ruling == RULING_ABSENT) {
                _send(c.matcher, remaining);
            } else {
                // refused to arbitrate: both sides get half back
                _send(staker, remaining / 2);
                _send(c.matcher, remaining - remaining / 2);
            }
        }
    }

    // ------------------------------------------------------------------ settlement

    /// @notice Split the staked pool equally between the attendees. Anyone can call it once the
    /// challenge window is over and no challenge is waiting for a match. Challenges whose match
    /// window ran out without a match are accepted here automatically; each challenge still in a
    /// Kleros case gets one share set aside until it is settled.
    function releasePayouts() external nonReentrant whenListed {
        require(block.timestamp > challengeEndsAt, TooEarly());
        uint256 len = _challengers.length;
        for (uint256 i; i < len; ++i) {
            address s = _challengers[i];
            Challenge storage c = challenges[s];
            if (c.state == ChallengeState.Waiting && block.timestamp > c.matchEndsAt) _acceptUnmatched(s, c);
        }
        // challenges still in a Kleros case get one share set aside each; nothing may wait for a match
        uint256 open;
        for (uint256 i; i < len; ++i) {
            if (challenges[_challengers[i]].state == ChallengeState.Disputed) ++open;
        }
        require(pendingChallenges == open, ChallengesPending(pendingChallenges - open));

        // attendees and open cases are different registered stakers, so share >= depositAmount > 0
        uint256 pool = depositAmount * stakerCount;
        uint256 n = attendeeCount;
        uint256 share = pool / (n + open);
        payoutShare = share;
        heldBack = share * open;
        phase = Phase.Finalized;
        for (uint256 i; i < len; ++i) {
            address s = _challengers[i];
            Challenge storage c = challenges[s];
            if (c.state == ChallengeState.Disputed) {
                c.heldShare = share;
                emit ShareHeldBack(s, share);
            }
        }
        for (uint256 i; i < _attendees.length; ++i) {
            address a = _attendees[i];
            status[a] = Status.Paid;
            _payOrOwe(a, share);
        }
        emit Finalized(stakerCount, n, pool, share);
    }

    /// @notice Event cancelled: refund every registered staker their deposit.
    function cancel() external nonReentrant onlyOwner whenOpen beforeDeadline {
        uint256 bal = address(this).balance;
        uint256 r = reserved();
        require(bal >= r, InsufficientBalance(r, bal));

        uint256 count = stakerCount;
        phase = Phase.Cancelled;
        uint256 len = _stakers.length;
        for (uint256 i; i < len; ++i) {
            address s = _stakers[i];
            if (status[s] != Status.Staker) continue; // skip rejected / withdrawn
            status[s] = Status.Paid;
            _payOrOwe(s, depositAmount);
        }
        emit Cancelled(count, depositAmount);
    }

    /// @notice Collect a payment that could not be delivered (a share, a refund or challenge
    /// money), to any address you choose. All the gas you send is forwarded.
    function claim(address to) external nonReentrant {
        uint256 amount = owed[msg.sender];
        require(amount > 0, NothingToClaim());
        owed[msg.sender] = 0;
        owedTotal -= amount;
        emit Claimed(msg.sender, to, amount);
        _sendOrRevert(to, amount);
    }

    /// @notice Safety net if the organiser never posts the list: after `claimDeadline`, a registered
    /// staker can take their own deposit back, to any address they choose.
    function emergencyWithdraw(address to) external nonReentrant whenOpen {
        require(block.timestamp > claimDeadline, TooEarly());
        require(status[msg.sender] == Status.Staker, NotAStaker(msg.sender));
        status[msg.sender] = Status.Paid;
        stakerCount -= 1;
        emit EmergencyWithdrawn(msg.sender, depositAmount);
        _sendOrRevert(to, depositAmount);
    }

    /// @notice After settlement, recover rounding dust and stray transfers. Everything in
    /// `reserved()` (unclaimed payments, set-aside shares, challenge money) stays.
    function sweep(address to) external nonReentrant onlyOwner {
        require(phase == Phase.Finalized || phase == Phase.Cancelled, NotSettled());
        uint256 amount = spare();
        emit Swept(to, amount);
        _sendOrRevert(to, amount);
    }

    // ------------------------------------------------------------------ admin

    /// @notice Step 1 of 2: propose a new owner. Nothing changes until they call `acceptOwnership`.
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), ZeroAddress());
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Step 2 of 2: the proposed owner accepts.
    function acceptOwnership() external {
        require(msg.sender == pendingOwner, NotPendingOwner());
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // ------------------------------------------------------------------ internal

    /// @dev Every accepted wei is attributed to its sender, reserved and independently recoverable.
    function _deposit() private {
        require(phase == Phase.Open, NotOpen());
        require(block.timestamp < eventStart, TooLate());
        require(msg.value > 0, ZeroDeposit());
        pendingDeposits[msg.sender] += msg.value;
        pendingTotal += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function _addAttendee(address a) private {
        require(!attended[a], DuplicateAttendee(a));
        require(status[a] == Status.Staker, NotAStaker(a));
        attended[a] = true;
        _attendees.push(a);
        attendeeCount += 1;
        emit AttendeeAdded(a);
    }

    /// @dev A case still open at payout is settled. If Kleros ruled the challenger attended, they get
    /// the case's whole set-aside amount. Otherwise that amount is split into equal parts, one per
    /// attendee and one per case still open: each attendee is paid one part and each open case's
    /// set-aside amount grows by one part. At every step each attendee has received, and each open
    /// case holds, the same total, so a later winner gets exactly what every attendee got, whatever
    /// order the cases settle in (up to rounding dust, which stays as spare).
    function _settleHeldShare(address staker, Challenge storage c, bool won) private {
        uint256 amount = c.heldShare;
        c.heldShare = 0;
        heldBack -= amount;
        if (won) {
            attended[staker] = true;
            _attendees.push(staker);
            attendeeCount += 1;
            status[staker] = Status.Paid;
            emit AttendeeAdded(staker);
            _payOrOwe(staker, amount);
            return;
        }
        uint256 n = _attendees.length;
        // after payout no challenge can wait for a match, so every pending challenge is an open case
        // with a share set aside (this one is already resolved and no longer counted)
        uint256 open = pendingChallenges;
        uint256 each = amount / (n + open); // n >= 1: the posted list is never empty
        emit HeldShareSplit(staker, n, open, each);
        if (open > 0) {
            uint256 grown;
            uint256 len = _challengers.length;
            for (uint256 i; i < len; ++i) {
                Challenge storage o = challenges[_challengers[i]];
                if (o.heldShare > 0) {
                    o.heldShare += each;
                    ++grown;
                }
            }
            heldBack += each * grown; // stays the sum of the open cases' heldShare
        }
        for (uint256 i; i < n; ++i) _payOrOwe(_attendees[i], each);
    }

    /// @dev Nobody matched in time: the challenger counts as attended and gets their deposit back.
    function _acceptUnmatched(address staker, Challenge storage c) private {
        c.state = ChallengeState.Resolved;
        pendingChallenges -= 1;
        challengeEscrow -= c.deposit;
        if (!attended[staker]) _addAttendee(staker);
        emit ChallengeResolved(staker, true, RULING_ATTENDED);
        _send(staker, c.deposit);
    }

    /// @dev The address as "0x" + 40 lower-case hex digits.
    function _lowerHex(address a) private pure returns (bytes memory out) {
        out = new bytes(42);
        out[0] = "0";
        out[1] = "x";
        uint256 v = uint160(a);
        for (uint256 i = 41; i > 1; --i) {
            uint256 d = v & 15;
            out[i] = bytes1(uint8(d < 10 ? 48 + d : 87 + d)); // 0-9, a-f
            v >>= 4;
        }
    }

    /// @dev The address as "0x" + 40 hex digits with the EIP-55 checksum (mixed case), as Etherscan shows it.
    function _checksummed(address a) private pure returns (bytes memory out) {
        out = _lowerHex(a);
        uint256 hash;
        assembly ("memory-safe") {
            hash := keccak256(add(out, 34), 40) // of the 40 lower-case digits
        }
        // a letter is upper case when the matching hex digit of the hash is 8 or more (its top bit is set)
        for (uint256 i; i < 40; ++i) {
            if (uint8(out[i + 2]) > 57 && (hash >> (255 - 4 * i)) & 1 == 1) out[i + 2] = bytes1(uint8(out[i + 2]) - 32);
        }
    }

    /// @dev Stores the bounded ABI-encoded template after a STOP byte, preventing executable data.
    /// Creation code PUSH2 size, DUP1, PUSH1 10, RETURNDATASIZE, CODECOPY, RETURNDATASIZE, RETURN.
    /// MAX_META_BYTES and MAX_META_SLOTS bound both construction and case rendering work. The
    /// rendered file remains below one UnixFS block (256 KiB), as _ipfsPath requires.
    function _storeData(bytes memory data) private returns (address store) {
        require(data.length < 24_576, BadMetaEvidenceTemplate()); // the size limit of contract code (EIP-170)
        bytes memory init = bytes.concat(hex"61", bytes2(uint16(data.length + 1)), hex"80600a3d393df300", data);
        assembly ("memory-safe") {
            store := create(0, add(init, 32), mload(init))
        }
        require(store != address(0), BadMetaEvidenceTemplate());
    }

    /// @dev The CIDv0 ("Qm...") `ipfs add` gives `data` with its default settings, for data that fits
    /// in one block: a dag-pb node holding a UnixFS file (type 2, the data, its size), hashed with
    /// sha256, as base58 of the multihash 0x12 0x20 <digest>.
    function _ipfsPath(bytes memory data) private pure returns (string memory) {
        bytes memory size = _varint(data.length);
        bytes memory file = bytes.concat(hex"080212", size, data, hex"18", size);
        bytes32 digest = sha256(bytes.concat(hex"0a", _varint(file.length), file));
        // base58 of the 34-byte multihash, as three limbs: 0x1220 and the top 16 bits of the digest,
        // then two 120-bit parts. It always has 46 digits (58^45 < 0x1220 << 256 < 0x1221 << 256 < 58^46).
        bytes memory alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
        uint256 d = uint256(digest);
        uint256 hi = (0x1220 << 16) | (d >> 240);
        uint256 mid = (d >> 120) & ((1 << 120) - 1);
        uint256 lo = d & ((1 << 120) - 1);
        bytes memory out = new bytes(46);
        for (uint256 i = 46; i > 0; --i) {
            uint256 r = hi % 58;
            hi /= 58;
            uint256 t = (r << 120) | mid;
            mid = t / 58;
            t = ((t % 58) << 120) | lo;
            lo = t / 58;
            out[i - 1] = alphabet[t % 58];
        }
        return string(out);
    }

    /// @dev Protobuf varint: 7 bits per byte, lowest first, high bit set on all but the last.
    function _varint(uint256 n) private pure returns (bytes memory out) {
        uint256 len = 1;
        for (uint256 m = n >> 7; m > 0; m >>= 7) ++len;
        out = new bytes(len);
        for (uint256 i; i < len - 1; ++i) {
            out[i] = bytes1(uint8(n & 0x7f) | 0x80);
            n >>= 7;
        }
        out[len - 1] = bytes1(uint8(n));
    }

    /// @dev `cost + cost * multiplier / denominator`, saturating like the Dispute Resolver's
    /// CappedMath (Kleros quotes a huge "non-payable" appeal cost when a case cannot be appealed further).
    function _withStake(uint256 cost, uint256 multiplier, uint256 denominator) private pure returns (uint256) {
        unchecked {
            uint256 product = cost * multiplier;
            if (cost != 0 && product / cost != multiplier) product = type(uint256).max;
            uint256 total = cost + product / denominator;
            return total < cost ? type(uint256).max : total;
        }
    }

    /// @dev Used in batches and for challenge money: one failing recipient must never block anyone
    /// else. The recipient gets at most PAYOUT_GAS and no return data is copied, so it cannot blow
    /// up the gas of the batch. A failed payment is kept in `owed` for `claim`.
    function _send(address to, uint256 amount) private returns (bool ok) {
        if (amount == 0) return true;
        assembly ("memory-safe") {
            ok := call(PAYOUT_GAS, to, amount, 0, 0, 0, 0)
        }
        if (!ok) {
            // A failure only counts if the recipient had its full PAYOUT_GAS. The EVM passes on at most
            // 63/64 of the gas left, so a caller who sent too little gas would leave less than
            // PAYOUT_GAS / 63 here: revert instead, so nobody can push payments into `owed` on purpose
            // (and gas estimation always finds a limit that gives every recipient its full allowance).
            require(gasleft() >= PAYOUT_GAS / 63, NotEnoughGas());
            owed[to] += amount;
            owedTotal += amount;
            emit PayoutFailed(to, amount);
        }
    }

    /// @dev A share of the pool or a deposit refund, logged with `Payout` when delivered.
    function _payOrOwe(address to, uint256 amount) private {
        if (amount == 0) return;
        if (_send(to, amount)) emit Payout(to, amount);
    }

    /// @dev Used where the caller picks the address and can retry (refund, claim, sweep, emergency
    /// withdrawal): all the gas is forwarded and a failure reverts.
    function _sendOrRevert(address to, uint256 amount) private {
        // sending to this contract would only turn the money into "spare"
        require(to != address(0) && to != address(this), ZeroAddress());
        if (amount == 0) return;
        bool ok;
        assembly ("memory-safe") {
            ok := call(gas(), to, amount, 0, 0, 0, 0)
        }
        require(ok, TransferFailed(to, amount));
    }
}
