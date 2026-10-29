// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev ERC-792 arbitrable side, as KlerosLiquid calls it.
interface IArbitrableV1 {
    function rule(uint256 disputeID, uint256 ruling) external;
}

/// @dev ERC-792 arbitrator side, as the Dispute Resolver calls it.
interface IArbitratorV1 {
    function createDispute(uint256 choices, bytes calldata extraData) external payable returns (uint256 disputeID);
    function arbitrationCost(bytes calldata extraData) external view returns (uint256 cost);
    function appeal(uint256 disputeID, bytes calldata extraData) external payable;
    function appealCost(uint256 disputeID, bytes calldata extraData) external view returns (uint256 cost);
    function appealPeriod(uint256 disputeID) external view returns (uint256 start, uint256 end);
    function currentRuling(uint256 disputeID) external view returns (uint256 ruling);
}

/// @dev Test stand-in for KlerosLiquid (Kleros Court v1) on Ethereum mainnet, with the same ABI for
/// everything the contract, the console and the guest page use: `arbitrationCost` = fee per juror x
/// jurors from the extra data (abi.encode(subcourtID, minJurors), 3 jurors by default); a case keeps
/// all the ETH sent with it; `appealCost` = fee per juror x (2n + 1) for a round of n jurors, or the
/// huge NON_PAYABLE_AMOUNT once the General Court cannot grow further (`jurorsForCourtJump`);
/// `appeal` only from the arbitrable (the Dispute Resolver) during the appeal period, with a bigger
/// jury next round; `appealPeriod` is (0, 0) outside the appeal period; `passPeriod` moves the
/// appeal period on to execution once it is over; `executeRuling` (execution period only, once)
/// calls `rule(disputeID, currentRuling)` on the arbitrable. Jurors are not simulated: the test
/// hook `startAppealPeriod` records their vote and opens the appeal period, and `giveFinalRuling`
/// runs a case straight to its ruling.
/// @notice CHIADO TEST ONLY. Rulings and fee configuration are controlled by one disclosed operator.
/// No independent jury adjudication is represented by this fixture.
contract ControlledKlerosLiquidV9 is IArbitratorV1 {
    error TestnetOnly();
    error InvalidController();
    error NotController();
    address public immutable controller;

    constructor(address controller_) {
        if (block.chainid != 10200) revert TestnetOnly();
        if (controller_ == address(0)) revert InvalidController();
        controller = controller_;
    }
    modifier onlyController() {
        if (msg.sender != controller) revert NotController();
        _;
    }

    enum Period {
        evidence,
        commit,
        vote,
        appeal,
        execution
    }

    /// @dev Field order and types match KlerosLiquid's public `disputes(uint256)` getter.
    struct Dispute {
        uint96 subcourtID;
        address arbitrated;
        uint256 numberOfChoices;
        Period period;
        uint256 lastPeriodChange;
        uint256 drawsInRound;
        uint256 commitsInRound;
        bool ruled;
    }

    struct Votes {
        uint256 ruling; // the jurors' vote in the latest round (0 = tied or refused)
        uint256 jurors; // jurors in the latest round
        uint256 rounds;
        uint256 appealDuration;
    }

    uint256 public constant NON_PAYABLE_AMOUNT = (2 ** 256 - 2) / 2;
    uint256 public constant MIN_JURORS = 3;
    /// @dev Arbitrator-side IDs differ from the Dispute Resolver's local IDs, like on mainnet.
    uint256 public constant ID_OFFSET = 1000;
    /// @dev General Court timesPerPeriod (seconds): evidence 78 h, commit 162 h, vote 162 h, appeal 108 h.
    uint256[4] internal _times = [uint256(78 hours), 162 hours, 162 hours, 108 hours];

    uint256 public feeForJuror = 0.0054 ether; // 3 jurors = 0.0162 ETH, the General Court fee on 27 Oct 2026
    uint256 public jurorsForCourtJump = 511;
    uint256 public disputeCount;
    mapping(uint256 => Dispute) public disputes;
    mapping(uint256 => Votes) internal _votes;

    event DisputeCreation(uint256 indexed _disputeID, address indexed _arbitrable);
    event AppealPossible(uint256 indexed _disputeID, address indexed _arbitrable);
    event AppealDecision(uint256 indexed _disputeID, address indexed _arbitrable);
    event NewPeriod(uint256 indexed _disputeID, Period _period);

    // ---------------------------------------------------------------- test hooks

    function setFeeForJuror(uint256 fee) external onlyController {
        feeForJuror = fee;
    }

    /// @dev A round of this many jurors or more cannot be appealed in the General Court (NON_PAYABLE_AMOUNT).
    function setJurorsForCourtJump(uint256 n) external onlyController {
        jurorsForCourtJump = n;
    }

    /// @dev The jurors voted `ruling` (0 = tie or refusal); the appeal period runs `duration` seconds from now.
    function startAppealPeriod(uint256 id, uint256 ruling, uint256 duration) public onlyController {
        Dispute storage d = _existing(id);
        require(d.period < Period.appeal, "Not in a voting round.");
        require(ruling <= d.numberOfChoices, "Invalid ruling.");
        _votes[id].ruling = ruling;
        _votes[id].appealDuration = duration;
        _newPeriod(id, Period.appeal);
        emit AppealPossible(id, d.arbitrated);
    }

    /// @dev Shortcut: the jurors vote `ruling`, nobody appeals, and the ruling is delivered.
    function giveFinalRuling(uint256 id, uint256 ruling) external onlyController {
        startAppealPeriod(id, ruling, 0);
        passPeriod(id);
        executeRuling(id);
    }

    // ---------------------------------------------------------------- KlerosLiquid ABI

    function arbitrationCost(bytes calldata extraData) public view returns (uint256) {
        (, uint256 minJurors) = _decode(extraData);
        return feeForJuror * minJurors;
    }

    function createDispute(uint256 choices, bytes calldata extraData) external payable returns (uint256 id) {
        require(msg.value >= arbitrationCost(extraData), "Value is less than required arbitration fee.");
        (uint96 court, uint256 minJurors) = _decode(extraData);
        id = ID_OFFSET + disputeCount++;
        disputes[id] = Dispute(court, msg.sender, choices, Period.evidence, block.timestamp, minJurors, 0, false);
        _votes[id] = Votes(0, minJurors, 1, _times[3]);
        emit DisputeCreation(id, msg.sender);
    }

    function appealCost(uint256 id, bytes calldata) public view returns (uint256) {
        uint256 jurors = _votes[id].jurors;
        if (jurors >= jurorsForCourtJump) return NON_PAYABLE_AMOUNT; // the General Court has no parent
        return feeForJuror * (jurors * 2 + 1);
    }

    function appeal(uint256 id, bytes calldata extraData) external payable {
        Dispute storage d = _existing(id);
        require(msg.value >= appealCost(id, extraData), "Value is less than required appeal fee.");
        require(d.period == Period.appeal, "Incorrect period.");
        require(msg.sender == d.arbitrated, "Can only be called by the arbitrable contract.");
        Votes storage v = _votes[id];
        v.jurors = v.jurors * 2 + 1;
        v.rounds += 1;
        v.ruling = 0;
        d.drawsInRound = 0;
        d.commitsInRound = 0;
        emit AppealDecision(id, d.arbitrated);
        _newPeriod(id, Period.evidence);
    }

    function appealPeriod(uint256 id) external view returns (uint256 start, uint256 end) {
        Dispute storage d = disputes[id];
        if (d.period != Period.appeal) return (0, 0);
        return (d.lastPeriodChange, d.lastPeriodChange + _votes[id].appealDuration);
    }

    function currentRuling(uint256 id) public view returns (uint256) {
        return _votes[id].ruling;
    }

    /// @dev 0 Waiting, 1 Appealable, 2 Solved (like KlerosLiquid's DisputeStatus).
    function disputeStatus(uint256 id) external view returns (uint8) {
        Period p = disputes[id].period;
        if (p < Period.appeal) return 0;
        return p == Period.appeal ? 1 : 2;
    }

    /// @dev Only the appeal → execution step is modelled (earlier periods need jurors: use startAppealPeriod).
    function passPeriod(uint256 id) public {
        Dispute storage d = _existing(id);
        require(d.period == Period.appeal, "The jurors have not voted yet (test: startAppealPeriod).");
        require(block.timestamp - d.lastPeriodChange >= _votes[id].appealDuration, "The appeal period has not passed yet.");
        _newPeriod(id, Period.execution);
    }

    function executeRuling(uint256 id) public {
        Dispute storage d = _existing(id);
        require(d.period == Period.execution, "Incorrect period.");
        require(!d.ruled, "Ruling already executed.");
        d.ruled = true;
        IArbitrableV1(d.arbitrated).rule(id, currentRuling(id));
    }

    function getSubcourt(uint96) external view returns (uint256[] memory children, uint256[4] memory timesPerPeriod) {
        return (children, _times);
    }

    /// @dev Not in KlerosLiquid's ABI: the number of rounds so far, for tests.
    function rounds(uint256 id) external view returns (uint256) {
        return _votes[id].rounds;
    }

    // ---------------------------------------------------------------- internal

    function _existing(uint256 id) internal view returns (Dispute storage d) {
        d = disputes[id];
        require(d.arbitrated != address(0), "No such dispute.");
    }

    function _newPeriod(uint256 id, Period p) internal {
        disputes[id].period = p;
        disputes[id].lastPeriodChange = block.timestamp;
        emit NewPeriod(id, p);
    }

    /// @dev Like KlerosLiquid.extraDataToSubcourtIDAndMinJurors, with a single court (the General Court).
    function _decode(bytes calldata extraData) internal pure returns (uint96 court, uint256 minJurors) {
        // only court 0 exists here; KlerosLiquid also falls back to court 0 for an unknown court
        if (extraData.length >= 64) (, minJurors) = abi.decode(extraData, (uint256, uint256));
        if (minJurors == 0) minJurors = MIN_JURORS;
        court = 0;
    }
}

