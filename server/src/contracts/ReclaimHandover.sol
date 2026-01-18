// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ReclaimHandover
 * @dev Smart contract for recording lost & found item handovers immutably on Sepolia testnet
 */
contract ReclaimHandover {
    struct HandoverRecord {
        string matchId;
        string lostItemId;
        string foundItemId;
        bytes32 lostPersonIdHash;    // Hash of user ID (privacy)
        bytes32 foundPersonIdHash;   // Hash of user ID (privacy)
        bytes32 itemDetailsHash;     // Hash of item details
        uint256 timestamp;
        bool exists;
    }
    
    mapping(string => HandoverRecord) public handovers;
    address public admin;
    uint256 public totalHandovers;
    
    event HandoverRecorded(
        string indexed matchId,
        string lostItemId,
        string foundItemId,
        uint256 timestamp
    );
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can call this");
        _;
    }
    
    constructor() {
        admin = msg.sender;
    }
    
    /**
     * @dev Record a new handover (admin only)
     */
    function recordHandover(
        string memory _matchId,
        string memory _lostItemId,
        string memory _foundItemId,
        bytes32 _lostPersonIdHash,
        bytes32 _foundPersonIdHash,
        bytes32 _itemDetailsHash
    ) external onlyAdmin {
        require(!handovers[_matchId].exists, "Handover already recorded");
        
        handovers[_matchId] = HandoverRecord({
            matchId: _matchId,
            lostItemId: _lostItemId,
            foundItemId: _foundItemId,
            lostPersonIdHash: _lostPersonIdHash,
            foundPersonIdHash: _foundPersonIdHash,
            itemDetailsHash: _itemDetailsHash,
            timestamp: block.timestamp,
            exists: true
        });
        
        totalHandovers++;
        
        emit HandoverRecorded(_matchId, _lostItemId, _foundItemId, block.timestamp);
    }
    
    /**
     * @dev Get handover details by matchId
     */
    function getHandover(string memory _matchId) 
        external 
        view 
        returns (HandoverRecord memory) 
    {
        require(handovers[_matchId].exists, "Handover not found");
        return handovers[_matchId];
    }
    
    /**
     * @dev Check if a handover exists
     */
    function verifyHandover(string memory _matchId) 
        external 
        view 
        returns (bool) 
    {
        return handovers[_matchId].exists;
    }
    
    /**
     * @dev Transfer admin rights (only current admin)
     */
    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Invalid address");
        admin = newAdmin;
    }
}
