const { createJupiterApiClient } = require("@jup-ag/api");
const {
  Connection,
  Transaction,
  VersionedTransaction,
  Keypair,
} = require("@solana/web3.js");

//You dont need this part of the code const { wallet, connection } = require("./config"); its define below, you can remove it
const { wallet, connection } = require("./config");
const bs58 = require("bs58");
const { Wallet } = require("@project-serum/anchor");

//My wallet keypair and connection is coming from config like the below,
// i just use it to receive a public key and pass it to swapObj
// Wallet from @project-serum/anchor is always use to sign the transaction

// const wallet = Keypair.fromSecretKey(
// Uint8Array.from(bs58.default.decode(process.env.PHANTOM_PRIVATE_KEY)));

//search a public node to replace "https://neat-hidden-sanctuary.solana-mainnet.discover.quiknode.pro/2af5315d336f9ae920028bbb90a73b724dc1bbed/"
// solana mainet will fail

// const connection = new Connection(
//   "https://neat-hidden-sanctuary.solana-mainnet.discover.quiknode.pro/2af5315d336f9ae920028bbb90a73b724dc1bbed/"
// );
const jupiterQuoteApi = createJupiterApiClient();

// Mints for SOL and USDC
const SOL_MINT = "So11111111111111111111111111111111111111112";
const Token_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_TO_USD = 246; // Replace this with the live price of SOL in USD maybe from coingecko
const DOLLAR_LAMPORTS = Math.floor((5 / SOL_TO_USD) * 1e9); //Replace with 5 * 1e6 from usdc to sol and interchange the mint address

async function getQuote() {
  const params = {
    inputMint: SOL_MINT,
    outputMint: Token_MINT,
    slippageBps: 30,
    amount: DOLLAR_LAMPORTS,
    //   platformFeeBps: 20,
  };

  // get quote
  const quote = await jupiterQuoteApi.quoteGet(params);

  if (!quote) {
    throw new Error("unable to quote");
  }

  return quote;
}

// Step 3: Get the user's public key
const userPublicKey = wallet.publicKey.toBase58();
console.log(userPublicKey);
if (!userPublicKey) {
  throw new Error("Invalid userPublicKey.");
}

async function getSwapObj() {
  try {
    // Step 1: Get the best quote
    const quote = await getQuote();
    if (!quote) return;

    // Get serialized transaction
    const swapObj = await jupiterQuoteApi.swapPost({
      swapRequest: {
        quoteResponse: quote,
        userPublicKey: userPublicKey,
        dynamicComputeUnitLimit: true,
        dynamicSlippage: {
          // This will set an optimized slippage to ensure high success rate
          maxBps: 300, // Make sure to set a reasonable cap here to prevent MEV
        },
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: 1000000,
            priorityLevel: "veryHigh", // If you want to land transaction fast, set this to use `veryHigh`. You will pay on average higher priority fee.
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
getSwapObj();

async function flowQuote() {
  const quote = await getQuote();
  console.dir("from Flow Quote", quote, { depth: null });
}

// flowQuote()

async function flowQuoteAndSwap() {
  const wallet = new Wallet(
    Keypair.fromSecretKey(
      bs58.default.decode(process.env.PHANTOM_PRIVATE_KEY || "")
    )
  );
  console.log("Wallet:", wallet.publicKey.toBase58());

  const quote = await getQuote();
  console.dir(" get quote", quote, { depth: null });
  const swapObj = await getSwapObj(wallet, quote);
  console.dir("swap object", swapObj, { depth: null });

  // Serialize the transaction
  const swapTransactionBuf = Buffer.from(swapObj.swapTransaction, "base64");
  var transaction = VersionedTransaction.deserialize(swapTransactionBuf);

  // Sign the transaction
  transaction.sign([wallet.payer]);
  const signature = getSignature(transaction);

  // We first simulate whether the transaction would be successful
  const { value: simulatedTransactionResponse } =
    await connection.simulateTransaction(transaction, {
      replaceRecentBlockhash: true,
      commitment: "processed",
    });
  const { err, logs } = simulatedTransactionResponse;

  if (err) {
    // Simulation error, we can check the logs for more details
    // If you are getting an invalid account error, make sure that you have the input mint account to actually swap from.
    console.error("Simulation Error:");
    console.error({ err, logs });
    return;
  }

  const serializedTransaction = Buffer.from(transaction.serialize());
  const blockhash = transaction.message.recentBlockhash;

  const transactionResponse = await transactionSenderAndConfirmationWaiter({
    connection,
    serializedTransaction,
    blockhashWithExpiryBlockHeight: {
      blockhash,
      lastValidBlockHeight: swapObj.lastValidBlockHeight,
    },
  });

  // If we are not getting a response back, the transaction has not confirmed.
  if (!transactionResponse) {
    console.error("Transaction not confirmed");
    return;
  }

  if (transactionResponse.meta?.err) {
    console.error(transactionResponse.meta?.err);
  }

  console.log(`https://solscan.io/tx/${signature}`);
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
  //I am used bs58 from "bs58" if you are using bs58 from anchor You just need to pass it as bs58.encode
  return bs58.default.encode(signature); 
}

flowQuoteAndSwap();
