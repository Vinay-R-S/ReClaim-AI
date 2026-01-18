# Blockchain Contract Deployment Guide

## 🎯 Quick Summary

You need to deploy the smart contract to Sepolia testnet using Remix IDE (browser-based). This will take **about 5 minutes**.

---

## ✅ Pre-Deployment Checklist

- [x] MetaMask installed in Brave browser
- [x] Connected to **Sepolia Test Network** in MetaMask
- [x] Have **1.52 Sepolia ETH** (you confirmed this)
- [x] Private key added to `.env` file

---

## 📝 Step-by-Step Deployment

### Step 1: Open Remix IDE

1. Go to: **https://remix.ethereum.org**
2. Wait for it to load (takes ~10 seconds)

---

### Step 2: Create Contract File

1. In the left sidebar, click **📁 File Explorer** icon (top icon)
2. Right-click on **contracts** folder
3. Select **"New File"**
4. Name it: `ReclaimHandover.sol`

---

### Step 3: Copy Contract Code

1. Open this file on your computer:

   ```
   c:\Users\vinay\OneDrive\Desktop\Semester 6\GDG Hackathon\ReClaim-AI\server\src\contracts\ReclaimHandover.sol
   ```

2. **Copy ALL the code** (Ctrl+A, then Ctrl+C)

3. **Paste it** into the Remix editor (the `ReclaimHandover.sol` file you just created)

---

### Step 4: Compile the Contract

1. Click the **📋 Solidity Compiler** icon in left sidebar (2nd icon)

2. Settings:
   - **Compiler version**: Select `0.8.20` or newer (e.g., `0.8.27`)
   - **EVM Version**: Keep as default (usually `shanghai` or `paris`)
   - **Auto compile**: ✅ (check this box)

3. Click the big blue button: **"Compile ReclaimHandover.sol"**

4. ✅ You should see a **green checkmark** next to the contract name

---

### Step 5: Deploy to Sepolia

1. Click the **🚀 Deploy & Run Transactions** icon (3rd icon in left sidebar)

2. **IMPORTANT Settings:**
   - **Environment**: Select **"Injected Provider - MetaMask"**
     - MetaMask will pop up → Click **"Connect"**
     - Ensure it shows **"Sepolia"** network
   - **Account**: Should show your MetaMask address (0x27bcB...)
   - **Contract**: Should show **"ReclaimHandover"**

3. Click the orange button: **"Deploy"**

4. **MetaMask will pop up:**
   - Shows gas fee (should be ~0.001-0.003 ETH)
   - Click **"Confirm"**

5. ⏳ Wait ~15 seconds for deployment

6. ✅ You'll see:
   - Green checkmark in console
   - **Deployed Contracts** section shows `RECLAIMHANDOVER AT 0x...`

---

### Step 6: Copy Contract Address

1. In **Deployed Contracts**, find your contract

2. Click the **📋 copy icon** next to the contract address
   - It looks like: `0xAbC123...` (42 characters)

3. **Paste it into your `.env` file:**

   ```bash
   CONTRACT_ADDRESS=0xYourContractAddressHere
   ```

4. **Save the `.env` file** (Ctrl+S)

---

## ✅ Verification

After deployment, verify it worked:

1. Go to: https://sepolia.etherscan.io/

2. Paste your contract address in the search bar

3. You should see:
   - ✅ Contract created
   - ✅ Transaction hash
   - ✅ Block number

---

## 🚀 Post-Deployment

Once `CONTRACT_ADDRESS` is in your `.env`:

1. **Restart your backend server:**

   ```bash
   cd server
   npm run dev
   ```

2. The blockchain service will auto-initialize

3. Next handover will be recorded on blockchain! 🎉

---

## 🆘 Troubleshooting

### Problem: MetaMask not showing Sepolia

**Solution:**

1. Open MetaMask
2. Click network dropdown (top left)
3. Click "Show/hide test networks"
4. Enable "Show test networks"
5. Select "Sepolia test network"

### Problem: Insufficient funds

**Solution:**

- Your balance shows 1.52 ETH, which is plenty
- If it's low, get more from: https://sepoliafaucet.com/

### Problem: Deployment Failed

**Solution:**

1. Check MetaMask is on Sepolia (not Ethereum Mainnet!)
2. Make sure you have ETH balance
3. Try again with higher gas limit (click "Advanced" in MetaMask)

### Problem: Can't find deployed contract

**Solution:**

- Look in the Remix console (bottom)
- Find the transaction with "contract creation"
- Copy the address from there

---

## 📊 Expected Costs

- **Deployment**: ~0.001-0.003 SepoliaETH (FREE testnet)
- **Each handover recording**: ~0.0001-0.0003 SepoliaETH

Your **1.52 ETH** can handle:

- ~500-1500 handover recordings
- Plenty for testing and demo!

---

## ⏭️ What's Next?

After deployment:

1. Update `.env` with `CONTRACT_ADDRESS`
2. Restart backend server
3. Test the credits system (signup + handover)
4. Check Etherscan for blockchain transactions

**Total time**: ~5 minutes 🚀
