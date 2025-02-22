const { createJupiterApiClient } = require("@jup-ag/api");
const {
  Connection,
  Transaction,
  VersionedTransaction,
  Keypair,
  PublicKey,
} = require("@solana/web3.js");
const { wallet, connection } = require("./config");
const bs58 = require("bs58");
const { Wallet } = require("@project-serum/anchor");
const { default: axios } = require("axios");
const { getMint } = require("@solana/spl-token");

// SOL and Token Mint Addresses
const SOL_MINT = "So11111111111111111111111111111111111111112"; // Native SOL

async function getTokenDecimals(tokenAddress) {
  try {
    const mintInfo = await getMint(connection, new PublicKey(tokenAddress));
    return mintInfo.decimals;
  } catch (error) {
    console.error(`Error fetching decimals for ${tokenAddress}`, error);
    return 6;
  }
}

async function fetchSolPrice() {
  try {
    const response = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"
    );
    return response.data.solana.usd;
  } catch (error) {
    console.error("Error fetching SOL price:", error);
    return null;
  }
}



const jupiterQuoteApi = createJupiterApiClient();

// Step 3: Get the user's public key
const userPublicKey = wallet.publicKey.toBase58();
console.log("User Wallet:", userPublicKey);
if (!userPublicKey) {
  throw new Error("Invalid userPublicKey.");
}

async function getQuote(inputMint, outputMint, amount) {
  const params = {
    inputMint,
    outputMint,
    slippageBps: 30, // 0.3% slippage
    amount,
  };

  // Get quote from Jupiter API
  const quote = await jupiterQuoteApi.quoteGet(params);
  if (!quote) throw new Error("Unable to fetch quote");

  return quote;
}


async function getSwapObj(inputMint, outputMint, amount) {
  try {
    // Get best quote
    const quote = await getQuote(inputMint, outputMint, amount);
    if (!quote) return;

    // Get serialized transaction
    const swapObj = await jupiterQuoteApi.swapPost({
      swapRequest: {
        quoteResponse: quote,
        userPublicKey,
        dynamicComputeUnitLimit: true,
        dynamicSlippage: { maxBps: 300 },
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: 1_000_000,
            priorityLevel: "veryHigh",
          },
        },
      },
    });

    return swapObj;
  } catch (error) {
    console.error("Error during swap:", error.message);
    throw error;
  }
}


async function executeSwap(inputMint, outputMint, amount) {
  try {
    const wallet = new Wallet(
      Keypair.fromSecretKey(
        bs58.default.decode(process.env.PHANTOM_PRIVATE_KEY || "")
      )
    );
    console.log("Wallet Address:", wallet.publicKey.toBase58());

    const swapObj = await getSwapObj(inputMint, outputMint, amount);
    if (!swapObj) return;

    console.log("Executing swap:", swapObj);

    // Deserialize the transaction
    const swapTransactionBuf = Buffer.from(swapObj.swapTransaction, "base64");
    var transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    // Sign the transaction
    transaction.sign([wallet.payer]);
    const signature = getSignature(transaction);

    // Simulate the transaction before execution
    const { value: simulatedTransactionResponse } =
      await connection.simulateTransaction(transaction, {
        replaceRecentBlockhash: true,
        commitment: "processed",
      });

    if (simulatedTransactionResponse.err) {
      console.error("Simulation Error:", simulatedTransactionResponse);
      return;
    }

    const serializedTransaction = Buffer.from(transaction.serialize());
    const blockhash = transaction.message.recentBlockhash;

    // Send the transaction
    const transactionResponse = await connection.sendRawTransaction(
      serializedTransaction,
      { preflightCommitment: "confirmed" }
    );

    console.log(`Transaction submitted: https://solscan.io/tx/${signature}`);
  } catch (error) {
    console.error("Swap execution failed:", error.message);
  }
}


function getSignature(transaction) {
  const signature =
    "signature" in transaction
      ? transaction.signature
      : transaction.signatures[0];

  if (!signature) {
    throw new Error(
      "Missing transaction signature, the transaction was not signed by the fee payer"
    );
  }

  return bs58.default.encode(signature);
}


async function swapSOLOrToken(tokenAddress, direction, amountUSD) {
  const SOL_TO_USD = await fetchSolPrice();
  let inputMint, outputMint, amount;

  if (direction === "buy") {
    inputMint = SOL_MINT;
    outputMint = tokenAddress;
    amount = Math.floor((amountUSD / SOL_TO_USD) * 1e9); // Convert USD to SOL lamports
  } else if (direction === "sell") {
    const tokenDecimals = await getTokenDecimals(tokenAddress);
    inputMint = tokenAddress;
    outputMint = SOL_MINT;
    amount = Math.floor(amountUSD * 10 ** tokenDecimals); // Convert USD to token smallest unit (USDC has 6 decimals)
  } else {
    throw new Error(
      "Invalid swap direction. Use 'SOL_TO_TOKEN' or 'TOKEN_TO_SOL'."
    );
  }

  console.log(
    `Swapping ${amountUSD} USD worth of ${
      direction === "SOL_TO_TOKEN" ? "SOL → Token" : "Token → SOL"
    }`
  );

  await executeSwap(inputMint, outputMint, amount);
}

// Example Usage: Swap 10 USD worth of SOL to Token
// swapSOLOrToken("HA68gHtg25yUXiJDZiBn3jawRjb7UH53VpndCDU7Grok", "buy", 1)
module.exports = { swapSOLOrToken };


// test your bot example in your code after importing it 
/**
 * Execute the swap transaction.
 * @param {string} inputMint - Mint address of the token to swap from.
 * @param {string} outputMint - Mint address of the token to swap to.
 * @param {number} amount - Amount to swap.
 * 
 * 
 * const { swapSOLOrToken } = require("./jup");
 * await swapSOLOrToken(token.baseToken.address, "buy", SOL_BUDGET_AMOUNT); execute buy swap
 * await swapSOLOrToken(token.baseToken.address, "sell", sellAmount); for sell order
 */
