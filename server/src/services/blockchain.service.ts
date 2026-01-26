import { ethers } from 'ethers';
import crypto from 'crypto';

/**
 * Blockchain Service for recording handovers on Sepolia testnet
 */

let provider: ethers.JsonRpcProvider | null = null;
let wallet: ethers.Wallet | null = null;
let contract: ethers.Contract | null = null;
let isBlockchainInitialized = false; // Flag to track successful initialization
let currentRpcUrl: string = ''; // Track which RPC URL is currently in use

// Multiple Sepolia RPC endpoints for fallback (ordered by reliability)
const SEPOLIA_RPC_URLS = [
    // Primary reliable providers
    'https://rpc.ankr.com/eth_sepolia',
    'https://ethereum-sepolia.blockpi.network/v1/rpc/public',
    'https://1rpc.io/sepolia',
    'https://sepolia.drpc.org',
    // Secondary public endpoints
    'https://ethereum-sepolia-rpc.publicnode.com',
    'https://sepolia.gateway.tenderly.co',
    'https://rpc2.sepolia.org',
    'https://rpc.sepolia.org',
    'https://eth-sepolia.public.blastapi.io',
    // Additional fallbacks
    'https://endpoints.omniatech.io/v1/eth/sepolia/public',
    'https://ethereum-sepolia.rpc.subquery.network/public',
];

// Contract ABI (only the functions we need)
const CONTRACT_ABI = [
    "function recordHandover(string _matchId, string _lostItemId, string _foundItemId, bytes32 _lostPersonIdHash, bytes32 _foundPersonIdHash, bytes32 _itemDetailsHash) external",
    "function getHandover(string _matchId) external view returns (tuple(string matchId, string lostItemId, string foundItemId, bytes32 lostPersonIdHash, bytes32 foundPersonIdHash, bytes32 itemDetailsHash, uint256 timestamp, bool exists))",
    "function verifyHandover(string _matchId) external view returns (bool)",
    "function totalHandovers() external view returns (uint256)"
];

/**
 * Check if an error is network-related and requires RPC reconnection
 */
function isNetworkError(error: any): boolean {
    const networkErrorKeywords = [
        'network',
        'timeout',
        'ECONNREFUSED',
        'ENOTFOUND',
        'ETIMEDOUT',
        'socket',
        'connection',
        'could not detect network',
        'missing response',
        'bad response',
        'rate limit',
        '429',
        '502',
        '503',
        '504'
    ];
    const errorMsg = error.message?.toLowerCase() || '';
    return networkErrorKeywords.some(keyword => errorMsg.includes(keyword.toLowerCase()));
}

/**
 * Initialize blockchain connection with retry logic
 */
async function initializeBlockchain(forceReconnect = false) {
    // If already successfully initialized and not forcing reconnect, skip
    if (isBlockchainInitialized && contract && !forceReconnect) {
        return;
    }

    const privateKey = process.env.ADMIN_PRIVATE_KEY;
    const contractAddress = process.env.CONTRACT_ADDRESS;

    if (!privateKey) {
        throw new Error('ADMIN_PRIVATE_KEY not set in .env');
    }

    if (!contractAddress) {
        throw new Error('CONTRACT_ADDRESS not set in .env - deploy contract first');
    }

    // Try each RPC URL until one works
    let lastError: Error | null = null;

    for (const rpcUrl of SEPOLIA_RPC_URLS) {
        try {
            console.log(`Trying RPC: ${rpcUrl.substring(0, 40)}...`);

            provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
                staticNetwork: true, // Skip network detection
            });

            // Set a shorter timeout
            provider.pollingInterval = 12000;

            wallet = new ethers.Wallet(privateKey, provider);
            contract = new ethers.Contract(contractAddress, CONTRACT_ABI, wallet);

            // Test the connection with a simple call
            await provider.getBlockNumber();

            // Mark as successfully initialized
            isBlockchainInitialized = true;
            currentRpcUrl = rpcUrl;

            console.log('✓ Blockchain service initialized successfully');
            console.log('   Admin wallet:', wallet.address);
            console.log('   Contract:', contractAddress);
            console.log('   RPC:', rpcUrl);

            return; // Success - no need to try other URLs!

        } catch (error: any) {
            console.warn(`RPC ${rpcUrl.substring(0, 30)}... failed:`, error.message);
            lastError = error;
            // Try next RPC
            provider = null;
            wallet = null;
            contract = null;
            isBlockchainInitialized = false;
        }
    }

    // If we get here, all RPCs failed
    console.error('All RPC endpoints failed');
    throw new Error(`Blockchain initialization failed: ${lastError?.message || 'All RPC endpoints failed'}`);
}

/**
 * Hash sensitive data for blockchain storage (SHA-256)
 */
function hashData(data: string): string {
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    return '0x' + hash;
}

/**
 * Record handover on blockchain with retry logic
 */
export async function recordHandoverOnBlockchain(data: {
    matchId: string;
    lostItemId: string;
    foundItemId: string;
    lostPersonId: string;
    foundPersonId: string;
    itemDetails: any;
}): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const MAX_RETRIES = 3;
    let attempt = 0;
    let needsReconnect = false;

    while (attempt < MAX_RETRIES) {
        try {
            // Only force reconnect if a network error occurred previously
            if (needsReconnect) {
                console.log(`Retry attempt ${attempt + 1}/${MAX_RETRIES} - reconnecting to different RPC...`);
                provider = null;
                wallet = null;
                contract = null;
                isBlockchainInitialized = false;
            }

            await initializeBlockchain(needsReconnect);

            if (!contract) {
                throw new Error('Contract not initialized');
            }

            // Hash sensitive data for privacy
            const lostPersonHash = hashData(data.lostPersonId);
            const foundPersonHash = hashData(data.foundPersonId);
            const itemDetailsHash = hashData(JSON.stringify(data.itemDetails));

            console.log(`Recording handover ${data.matchId} on blockchain...`);

            // Send transaction with gas limit
            const tx = await contract.recordHandover(
                data.matchId,
                data.lostItemId,
                data.foundItemId,
                lostPersonHash,
                foundPersonHash,
                itemDetailsHash,
                {
                    gasLimit: 500000  // Set explicit gas limit
                }
            );

            console.log(`Transaction sent: ${tx.hash}`);

            // Wait for confirmation (1 block)
            const receipt = await tx.wait(1);

            console.log(`✓ Handover recorded successfully! Block: ${receipt.blockNumber}, Gas used: ${receipt.gasUsed.toString()}`);
            console.log(`✓ Transaction complete - blockchain is ready for next operation`);

            return {
                success: true,
                txHash: tx.hash
            };

        } catch (error: any) {
            attempt++;

            // Check if this is a network error that warrants reconnection
            const shouldReconnect = isNetworkError(error);

            // Only log retry attempts, not success messages
            if (shouldReconnect) {
                console.warn(`Network error (attempt ${attempt}/${MAX_RETRIES}):`, error.message);
                needsReconnect = true; // Mark that we need to try a different RPC
            } else {
                console.error(`Blockchain error (attempt ${attempt}/${MAX_RETRIES}):`, error.message);
                needsReconnect = false; // No need to reconnect for non-network errors
            }

            // If it's the last attempt or a non-retryable error, return failure
            if (attempt >= MAX_RETRIES ||
                error.message.includes('Handover already recorded') ||
                error.message.includes('insufficient funds')) {

                // Provide user-friendly error messages
                let errorMsg = error.message;
                if (error.message.includes('Handover already recorded')) {
                    errorMsg = 'This handover has already been recorded on blockchain';
                } else if (error.message.includes('insufficient funds')) {
                    errorMsg = 'Insufficient ETH balance for gas fees';
                }

                return {
                    success: false,
                    error: errorMsg
                };
            }

            // Wait before retrying (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }
    }

    return {
        success: false,
        error: 'Failed after maximum retries'
    };
}

/**
 * Verify handover exists on blockchain
 */
export async function verifyHandoverOnBlockchain(
    matchId: string
): Promise<boolean> {
    try {
        await initializeBlockchain();

        if (!contract) {
            return false;
        }

        return await contract.verifyHandover(matchId);
    } catch (error) {
        console.error('Blockchain verification failed:', error);
        return false;
    }
}

/**
 * Get handover details from blockchain
 */
export async function getHandoverFromBlockchain(matchId: string) {
    try {
        await initializeBlockchain();

        if (!contract) {
            return null;
        }

        const record = await contract.getHandover(matchId);

        return {
            matchId: record.matchId,
            lostItemId: record.lostItemId,
            foundItemId: record.foundItemId,
            lostPersonIdHash: record.lostPersonIdHash,
            foundPersonIdHash: record.foundPersonIdHash,
            itemDetailsHash: record.itemDetailsHash,
            timestamp: Number(record.timestamp),
            exists: record.exists
        };
    } catch (error) {
        console.error('Failed to get handover from blockchain:', error);
        return null;
    }
}

/**
 * Get total handovers count
 */
export async function getTotalHandovers(): Promise<number> {
    try {
        await initializeBlockchain();

        if (!contract) {
            return 0;
        }

        const total = await contract.totalHandovers();
        return Number(total);
    } catch (error) {
        console.error('Failed to get total handovers:', error);
        return 0;
    }
}

/**
 * Check admin wallet balance
 */
export async function getAdminBalance(): Promise<string> {
    try {
        await initializeBlockchain();

        if (!wallet || !provider) {
            return '0';
        }

        const balance = await provider.getBalance(wallet.address);
        return ethers.formatEther(balance);
    } catch (error) {
        console.error('Failed to get admin balance:', error);
        return '0';
    }
}
