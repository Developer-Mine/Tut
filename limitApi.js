require("dotenv").config();
const express = require("express");
const axios = require("axios");
const rateLimit = require("express-rate-limit");
const cors = require("cors");

const { Wallet } = require("@project-serum/anchor");
const { bs58 } = require("@coral-xyz/anchor/dist/cjs/utils/bytes");
const {
  Connection,
  Keypair,
  VersionedTransaction,
} = require("@solana/web3.js");

const app = express();
const PORT = process.env.PORT || 8080;

const connection = new Connection(process.env.RPC_ENDPOINT);

// The wallet code being here is strictly for testing purpose // enter your solana wallet private key
const wallet = new Wallet(
  Keypair.fromSecretKey(bs58.decode(process.env.PhantoWallet || ""))
);

// Rate limiting: Allow 5 requests per minute per IP
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5, // We Limit each IP to 5 requests to avoid throtling jup server
  message: { error: "Too many requests, please try again later." },
});

app.use(express.json());
app.use(cors());
app.use(limiter);

// POST API to create order
app.post("/create-order", async (req, res) => {
  try {
    const {
      inputMint,
      outputMint,
      maker,
      payer,
      params,
      computeUnitPrice = "auto",
      referral,
      inputTokenProgram = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      outputTokenProgram = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      wrapAndUnwrapSol = true,
    } = req.body;

    if (
      !inputMint ||
      !outputMint ||
      !maker ||
      !payer ||
      !params?.makingAmount ||
      !params?.takingAmount
    ) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const orderPayload = {
      inputMint,
      outputMint,
      maker,
      payer,
      params,
      computeUnitPrice,
      referral,
      inputTokenProgram,
      outputTokenProgram,
      wrapAndUnwrapSol,
    };

    console.log("Sending Create Order:", orderPayload);

    // Simulate order creation
    const createOrderResponse = await axios.post(
      "https://api.jup.ag/limit/v2/createOrder",
      orderPayload
    );

    // Create order
    const { tx, order } = await createOrderResponse.data;

    console.log("tx Simulated:", tx);
    console.log("Order Simulated:", order);

    // sign and send transaction to the network below

    // const transactionBase64 = createOrderResponse.tx;
    const transaction = VersionedTransaction.deserialize(
      Buffer.from(tx, "base64")
    );

    console.log("Transaction", transaction);

    transaction.sign([wallet.payer]);

    const transactionBinary = transaction.serialize();
    console.log("TransactionBinary", transactionBinary);

    const signature = await connection.sendRawTransaction(transactionBinary, {
      maxRetries: 2,
      skipPreflight: true,
    });
    console.log("Signature", signature);

    const confirmation = await connection.confirmTransaction(
      { signature },
      "finalized"
    );
    console.log("confirmation", confirmation);

    if (confirmation.value.err) {
      throw new Error(
        `Transaction failed: ${JSON.stringify(
          confirmation.value.err
        )}\n\nhttps://solscan.io/tx/${signature}/`
      );
    } else
      console.log(
        `Transaction successful: https://solscan.io/tx/${signature}/`
      );

    //   End of signing...

    return res.status(200).json({ signature });
  } catch (error) {
    console.error(
      "Error Creating Order:",
      error.response?.data || error.message
    );
    return res
      .status(500)
      .json({ error: error.response?.data || error.message });
  }
});

// GET API to view open orders
app.get("/open-orders", async (req, res) => {
  try {
    const { wallet } = req.query;

    if (!wallet) {
      return res.status(400).json({ error: "Wallet address is required." });
    }

    const response = await axios.get(
      `https://api.jup.ag/limit/v2/openOrders?wallet=${wallet}`
    );

    const openOrders = response.data; // Extract the array

    if (!Array.isArray(openOrders) || openOrders.length === 0) {
      console.log("No open orders found.");
    } else {
      // Log all publicKeys in the array
      openOrders.forEach((order) => {
        console.log("Order PublicKey:", order.publicKey);
      });
    }

    return res.status(200).json(openOrders);
  } catch (error) {
    console.error(
      "Error Fetching Open Orders:",
      error.response?.data || error.message
    );
    return res
      .status(500)
      .json({ error: error.response?.data || error.message });
  }
});

// POST API to cancel orders
app.post("/cancel-orders", async (req, res) => {
  try {
    const { maker, orders, computeUnitPrice = "auto" } = req.body;

    if (!maker || !Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({
        error:
          "Missing required fields: maker and at least one order public key.",
      });
    }

    const cancelPayload = {
      maker,
      computeUnitPrice,
      orders,
    };

    console.log("Sending Cancel Order Request:", cancelPayload);

    const response = await axios.post(
      "https://api.jup.ag/limit/v2/cancelOrders",
      cancelPayload
    );

    const tx = response.data.txs[0];
    console.log("Orders Cancelled:", tx);

    // sign and send transaction to the network below

    const transaction = VersionedTransaction.deserialize(
      Buffer.from(tx, "base64")
    );

    console.log("Transaction", transaction);

    transaction.sign([wallet.payer]);

    const transactionBinary = transaction.serialize();
    console.log("TransactionBinary", transactionBinary);

    const signature = await connection.sendRawTransaction(transactionBinary, {
      maxRetries: 2,
      skipPreflight: true,
    });
    console.log("Signature", signature);

    const confirmation = await connection.confirmTransaction(
      { signature },
      "finalized"
    );
    console.log("confirmation", confirmation);

    if (confirmation.value.err) {
      throw new Error(
        `Transaction failed: ${JSON.stringify(
          confirmation.value.err
        )}\n\nhttps://solscan.io/tx/${signature}/`
      );
    } else
      console.log(
        `Transaction successful: https://solscan.io/tx/${signature}/`
      );

    return res.status(200).json({ signature });
  } catch (error) {
    console.error(
      "Error Cancelling Orders:",
      error.response?.data || error.message
    );
    return res
      .status(500)
      .json({ error: error.response?.data || error.message });
  }
});

// GET API to fetch order history
app.get("/order-history", async (req, res) => {
  try {
    const { wallet, page = 1 } = req.query;

    if (!wallet) {
      return res.status(400).json({ error: "Wallet address is required." });
    }

    const response = await axios.get(
      `https://api.jup.ag/limit/v2/orderHistory`,
      {
        params: { wallet, page },
      }
    );

    console.log("Order History Response:", response.data);

    return res.status(200).json(response.data);
  } catch (error) {
    console.error(
      "Error Fetching Order History:",
      error.response?.data || error.message
    );
    return res
      .status(500)
      .json({ error: error.response?.data || error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
