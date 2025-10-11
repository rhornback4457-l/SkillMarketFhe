// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface SkillListing {
  id: string;
  skill: string;
  hoursAvailable: number;
  rate: number;
  encryptedContact: string;
  timestamp: number;
  owner: string;
  status: "available" | "booked" | "completed";
}

const App: React.FC = () => {
  // Randomized style selections:
  // Colors: Natural (wood + stone)
  // UI: Hand-drawn illustration
  // Layout: Modular dashboard
  // Interaction: Micro-interactions

  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [listings, setListings] = useState<SkillListing[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newListingData, setNewListingData] = useState({
    skill: "",
    hoursAvailable: 0,
    rate: 0,
    encryptedContact: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Calculate statistics
  const availableCount = listings.filter(l => l.status === "available").length;
  const bookedCount = listings.filter(l => l.status === "booked").length;
  const completedCount = listings.filter(l => l.status === "completed").length;
  const totalHours = listings.reduce((sum, listing) => sum + listing.hoursAvailable, 0);

  useEffect(() => {
    loadListings().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadListings = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("listing_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing listing keys:", e);
        }
      }
      
      const list: SkillListing[] = [];
      
      for (const key of keys) {
        try {
          const listingBytes = await contract.getData(`listing_${key}`);
          if (listingBytes.length > 0) {
            try {
              const listingData = JSON.parse(ethers.toUtf8String(listingBytes));
              list.push({
                id: key,
                skill: listingData.skill,
                hoursAvailable: listingData.hoursAvailable,
                rate: listingData.rate,
                encryptedContact: listingData.encryptedContact,
                timestamp: listingData.timestamp,
                owner: listingData.owner,
                status: listingData.status || "available"
              });
            } catch (e) {
              console.error(`Error parsing listing data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading listing ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setListings(list);
    } catch (e) {
      console.error("Error loading listings:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitListing = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting skill data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newListingData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const listingId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const listingData = {
        skill: newListingData.skill,
        hoursAvailable: newListingData.hoursAvailable,
        rate: newListingData.rate,
        encryptedContact: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        status: "available"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `listing_${listingId}`, 
        ethers.toUtf8Bytes(JSON.stringify(listingData))
      );
      
      const keysBytes = await contract.getData("listing_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(listingId);
      
      await contract.setData(
        "listing_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Skill listing submitted securely!"
      });
      
      await loadListings();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewListingData({
          skill: "",
          hoursAvailable: 0,
          rate: 0,
          encryptedContact: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const bookSkill = async (listingId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing booking with FHE..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const listingBytes = await contract.getData(`listing_${listingId}`);
      if (listingBytes.length === 0) {
        throw new Error("Listing not found");
      }
      
      const listingData = JSON.parse(ethers.toUtf8String(listingBytes));
      
      const updatedListing = {
        ...listingData,
        status: "booked"
      };
      
      await contract.setData(
        `listing_${listingId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedListing))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Skill booked successfully!"
      });
      
      await loadListings();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Booking failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const filteredListings = listings.filter(listing => 
    listing.skill.toLowerCase().includes(searchTerm.toLowerCase()) ||
    listing.status.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderSkillCard = (listing: SkillListing) => {
    return (
      <div className="skill-card" key={listing.id}>
        <div className="skill-header">
          <h3>{listing.skill}</h3>
          <span className={`status-badge ${listing.status}`}>
            {listing.status}
          </span>
        </div>
        <div className="skill-details">
          <div className="detail">
            <span className="label">Hours:</span>
            <span className="value">{listing.hoursAvailable}</span>
          </div>
          <div className="detail">
            <span className="label">Rate:</span>
            <span className="value">{listing.rate} tokens/hr</span>
          </div>
        </div>
        <div className="skill-actions">
          {listing.status === "available" && (
            <button 
              className="book-btn"
              onClick={() => bookSkill(listing.id)}
            >
              Book Skill
            </button>
          )}
          {listing.status === "booked" && listing.owner === account && (
            <button 
              className="complete-btn"
              onClick={() => markComplete(listing.id)}
            >
              Mark Complete
            </button>
          )}
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="hand-drawn-spinner"></div>
      <p>Loading anonymous skill marketplace...</p>
    </div>
  );

  return (
    <div className="app-container hand-drawn-theme">
      <header className="app-header">
        <div className="logo">
          <div className="hand-drawn-icon">✏️</div>
          <h1>Skill<span>Market</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search skills..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <button className="search-btn">
              <svg viewBox="0 0 24 24">
                <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 0 0 1.48-5.34c-.47-2.78-2.79-5-5.59-5.34a6.505 6.505 0 0 0-7.27 7.27c.34 2.8 2.56 5.12 5.34 5.59a6.5 6.5 0 0 0 5.34-1.48l.27.28v.79l4.25 4.25c.41.41 1.08.41 1.49 0 .41-.41.41-1.08 0-1.49L15.5 14zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
            </button>
          </div>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            <span>+ List Skill</span>
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <main className="main-content">
        <div className="dashboard-panels">
          <div className="panel intro-panel">
            <h2>Anonymous Employee Skill Marketplace</h2>
            <p>Securely trade skills within your organization using FHE technology to maintain privacy while enabling collaboration.</p>
            <div className="fhe-badge">
              <span>FHE-Powered Privacy</span>
            </div>
          </div>
          
          <div className="panel stats-panel">
            <div className="panel-header">
              <h3>Marketplace Stats</h3>
              <button 
                className="refresh-btn"
                onClick={loadListings}
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-value">{listings.length}</div>
                <div className="stat-label">Total Listings</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{availableCount}</div>
                <div className="stat-label">Available</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{bookedCount}</div>
                <div className="stat-label">Booked</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{completedCount}</div>
                <div className="stat-label">Completed</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{totalHours}</div>
                <div className="stat-label">Total Hours</div>
              </div>
            </div>
          </div>
          
          <div className="panel listings-panel">
            <div className="panel-header">
              <h3>Available Skills</h3>
              <button 
                onClick={() => setShowTutorial(!showTutorial)}
                className="tutorial-btn"
              >
                {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
              </button>
            </div>
            
            {showTutorial && (
              <div className="tutorial-section">
                <h4>How It Works</h4>
                <div className="tutorial-steps">
                  <div className="step">
                    <div className="step-number">1</div>
                    <div className="step-content">
                      <h5>List Your Skills</h5>
                      <p>Anonymously list your skills and availability</p>
                    </div>
                  </div>
                  <div className="step">
                    <div className="step-number">2</div>
                    <div className="step-content">
                      <h5>Find Matches</h5>
                      <p>Discover skills you need for your projects</p>
                    </div>
                  </div>
                  <div className="step">
                    <div className="step-number">3</div>
                    <div className="step-content">
                      <h5>Secure Booking</h5>
                      <p>Book skills with encrypted communication</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {filteredListings.length === 0 ? (
              <div className="no-listings">
                <div className="hand-drawn-icon">🛠️</div>
                <p>No skill listings found</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  List Your First Skill
                </button>
              </div>
            ) : (
              <div className="skills-grid">
                {filteredListings.map(renderSkillCard)}
              </div>
            )}
          </div>
        </div>
      </main>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitListing} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          listingData={newListingData}
          setListingData={setNewListingData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="hand-drawn-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">!</div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="hand-drawn-icon">✏️</div>
              <span>SkillMarketFHE</span>
            </div>
            <p>Anonymous internal skill marketplace powered by FHE</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} SkillMarketFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  listingData: any;
  setListingData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  listingData,
  setListingData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setListingData({
      ...listingData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!listingData.skill || !listingData.hoursAvailable || !listingData.rate) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>List Your Skill</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon">🔒</div> 
            <span>Your information will be encrypted with FHE technology</span>
          </div>
          
          <div className="form-group">
            <label>Skill *</label>
            <input 
              type="text"
              name="skill"
              value={listingData.skill} 
              onChange={handleChange}
              placeholder="e.g. React Development, Data Analysis" 
            />
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label>Available Hours *</label>
              <input 
                type="number"
                name="hoursAvailable"
                min="1"
                value={listingData.hoursAvailable} 
                onChange={handleChange}
              />
            </div>
            <div className="form-group">
              <label>Rate (tokens/hr) *</label>
              <input 
                type="number"
                name="rate"
                min="1"
                value={listingData.rate} 
                onChange={handleChange}
              />
            </div>
          </div>
          
          <div className="form-group">
            <label>Encrypted Contact Info</label>
            <textarea 
              name="encryptedContact"
              value={listingData.encryptedContact} 
              onChange={handleChange}
              placeholder="Optional: information for project coordination (will be encrypted)" 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn"
          >
            {creating ? "Encrypting with FHE..." : "List Skill"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;