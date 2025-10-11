// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SkillMarketFhe is SepoliaConfig {
    enum SkillType { DEVELOPMENT, DESIGN, MARKETING, ANALYTICS }

    struct EncryptedSkill {
        uint256 id;
        address employee;
        euint32 encryptedSkillType;
        euint32 encryptedAvailableHours;
        euint32 encryptedRate;
        uint256 timestamp;
    }

    struct DecryptedSkill {
        SkillType skillType;
        uint32 availableHours;
        uint32 rate;
        bool isRevealed;
    }

    struct EncryptedProject {
        euint32 encryptedRequiredSkill;
        euint32 encryptedBudget;
    }

    uint256 public skillCount;
    mapping(uint256 => EncryptedSkill) public encryptedSkills;
    mapping(uint256 => DecryptedSkill) public decryptedSkills;
    mapping(uint256 => EncryptedProject) public projects;
    
    mapping(SkillType => euint32) private encryptedSkillCounts;
    mapping(uint256 => euint32) private encryptedProjectMatches;
    
    mapping(uint256 => uint256) private requestToSkillId;
    
    event SkillSubmitted(uint256 indexed id, address employee, uint256 timestamp);
    event ProjectCreated(uint256 indexed projectId);
    event DecryptionRequested(uint256 indexed id);
    event SkillDecrypted(uint256 indexed id);
    event MatchFound(uint256 skillId, uint256 projectId);
    
    modifier onlyHR() {
        _;
    }

    function submitEncryptedSkill(
        euint32 encryptedSkillType,
        euint32 encryptedAvailableHours,
        euint32 encryptedRate
    ) public {
        skillCount += 1;
        uint256 newId = skillCount;
        
        encryptedSkills[newId] = EncryptedSkill({
            id: newId,
            employee: msg.sender,
            encryptedSkillType: encryptedSkillType,
            encryptedAvailableHours: encryptedAvailableHours,
            encryptedRate: encryptedRate,
            timestamp: block.timestamp
        });
        
        decryptedSkills[newId] = DecryptedSkill({
            skillType: SkillType.DEVELOPMENT,
            availableHours: 0,
            rate: 0,
            isRevealed: false
        });
        
        emit SkillSubmitted(newId, msg.sender, block.timestamp);
    }

    function createProject(
        uint256 projectId,
        euint32 encryptedRequiredSkill,
        euint32 encryptedBudget
    ) public onlyHR {
        projects[projectId] = EncryptedProject({
            encryptedRequiredSkill: encryptedRequiredSkill,
            encryptedBudget: encryptedBudget
        });
        
        emit ProjectCreated(projectId);
    }

    function requestSkillDecryption(uint256 skillId) public onlyHR {
        EncryptedSkill storage skill = encryptedSkills[skillId];
        require(!decryptedSkills[skillId].isRevealed, "Already decrypted");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(skill.encryptedSkillType);
        ciphertexts[1] = FHE.toBytes32(skill.encryptedAvailableHours);
        ciphertexts[2] = FHE.toBytes32(skill.encryptedRate);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptSkill.selector);
        requestToSkillId[reqId] = skillId;
        
        emit DecryptionRequested(skillId);
    }

    function decryptSkill(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 skillId = requestToSkillId[requestId];
        require(skillId != 0, "Invalid request");
        
        EncryptedSkill storage eSkill = encryptedSkills[skillId];
        DecryptedSkill storage dSkill = decryptedSkills[skillId];
        require(!dSkill.isRevealed, "Already decrypted");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (uint32 skillType, uint32 availableHours, uint32 rate) = 
            abi.decode(cleartexts, (uint32, uint32, uint32));
        
        dSkill.skillType = SkillType(skillType);
        dSkill.availableHours = availableHours;
        dSkill.rate = rate;
        dSkill.isRevealed = true;
        
        if (FHE.isInitialized(encryptedSkillCounts[dSkill.skillType]) == false) {
            encryptedSkillCounts[dSkill.skillType] = FHE.asEuint32(0);
        }
        encryptedSkillCounts[dSkill.skillType] = FHE.add(
            encryptedSkillCounts[dSkill.skillType],
            FHE.asEuint32(1)
        );
        
        emit SkillDecrypted(skillId);
    }

    function findMatches(uint256 skillId, uint256 projectId) public onlyHR {
        EncryptedSkill storage skill = encryptedSkills[skillId];
        EncryptedProject storage project = projects[projectId];
        
        if (!FHE.isInitialized(encryptedProjectMatches[projectId])) {
            encryptedProjectMatches[projectId] = FHE.asEuint32(0);
        }
        
        encryptedProjectMatches[projectId] = FHE.add(
            encryptedProjectMatches[projectId],
            FHE.asEuint32(1)
        );
        
        emit MatchFound(skillId, projectId);
    }

    function getDecryptedSkill(uint256 skillId) public view returns (
        SkillType skillType,
        uint32 availableHours,
        uint32 rate,
        bool isRevealed
    ) {
        DecryptedSkill storage s = decryptedSkills[skillId];
        return (s.skillType, s.availableHours, s.rate, s.isRevealed);
    }

    function getProjectCount() public view returns (uint256) {
        return projects.length;
    }
}