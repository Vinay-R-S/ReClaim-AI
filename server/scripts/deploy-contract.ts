import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

// Load environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Contract bytecode and ABI will be provided after compilation
// For now, this shows the deployment structure

async function main() {
    console.log('🚀 Deploying ReclaimHandover contract to Sepolia...\n');

    const rpcUrl = process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org';
    const privateKey = process.env.ADMIN_PRIVATE_KEY;

    if (!privateKey) {
        throw new Error('ADMIN_PRIVATE_KEY not found in .env file');
    }

    // Connect to Sepolia
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log('Deploying from wallet:', wallet.address);

    // Check balance
    const balance = await provider.getBalance(wallet.address);
    console.log('💰 Wallet balance:', ethers.formatEther(balance), 'ETH');

    if (balance === 0n) {
        throw new Error('Wallet has no ETH! Please add Sepolia testnet ETH first.');
    }

    // Contract compilation needed - you'll compile this using Remix IDE
    // After compilation, you'll get the bytecode

    console.log('\nMANUAL STEP REQUIRED:');
    console.log('1. Go to https://remix.ethereum.org');
    console.log('2. Create new file: ReclaimHandover.sol');
    console.log('3. Copy contract code from server/src/contracts/ReclaimHandover.sol');
    console.log('4. Compile with Solidity  0.8.20+');
    console.log('5. Deploy to "Injected Web3" (MetaMask - Sepolia network)');
    console.log('6. Copy the deployed contract address');
    console.log('7. Add to .env: CONTRACT_ADDRESS=your_deployed_address\n');
}

main()
    .then(() => {
        console.log('Deployment guide printed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Error:', error.message);
        process.exit(1);
    });
