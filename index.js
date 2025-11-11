const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const admin = require("firebase-admin");
const app = express();
const cors = require("cors");
require("dotenv").config();
const port = process.env.PORT || 3000;

const serviceAccount = require("./fintrack_firebasesdk.json");
const { default: axios } = require("axios");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

let cachedQuote = null;
app.use(cors());
app.use(express.json());

const verifyFirebaseToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid authorization header" });
    }

    const idToken = authHeader.split(" ")[1];
    try {
      const user = await admin.auth().verifyIdToken(idToken);
      req.user = user;
    } catch (error) {
      return res.status(401).json({ error: error.message });
    }
    next();
  } catch (error) {
    console.error("Error verifying Firebase token:", error);
    res.status(403).json({ error: "Unauthorized or invalid token" });
  }
};

const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@bananacluster.d9hnwzy.mongodb.net/?appName=BananaCluster`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("fintrack_db");
    const costsCollection = db.collection("costs");

    app.post("/add-transaction", verifyFirebaseToken, async (req, res) => {
      try {
        const { type, category, amount, description, date } = req.body;
        const email = req.user.email;
        const name = req.user.name;

        if (!type || !["income", "expense"].includes(type)) {
          return res.status(400).send({ error: "Invalid type" });
        }
        if (!category) {
          return res.status(400).send({ error: "Category is required" });
        }
        if (!amount || Number(amount) < 1) {
          return res.status(400).send({ error: "Amount must be at least 1" });
        }
        if (!date) {
          return res.status(400).send({ error: "Date is required" });
        }

        const data = {
          type,
          category,
          amount: Number(amount),
          description: description || "",
          date: new Date(date),
          createdAt: new Date(),
          email,
          name: name || "",
        };

        const result = await costsCollection.insertOne(data);

        res.send({
          success: true,
          insertedId: result.insertedId,
          message: "Transaction added successfully!",
        });
      } catch (error) {
        res.status(500).send({ error: "Internal server error" });
      }
    });

    app.patch("/transaction/:id", verifyFirebaseToken, async (req, res) => {
      try {
        const { type, category, amount, description, date } = req.body;
        const email = req.user.email;
        const name = req.user.name;

        if (!type || !["income", "expense"].includes(type)) {
          return res.status(400).send({ error: "Invalid type" });
        }
        if (!category) {
          return res.status(400).send({ error: "Category is required" });
        }
        if (!amount || Number(amount) < 1) {
          return res.status(400).send({ error: "Amount must be at least 1" });
        }
        if (!date) {
          return res.status(400).send({ error: "Date is required" });
        }
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const data = {
          type,
          category,
          amount: Number(amount),
          description: description || "",
          date: new Date(date),
          email,
          name: name || "",
        };
        const result = await costsCollection.updateOne(query, { $set: data });

        res.send({
          success: true,
          insertedId: result.insertedId,
          message: "Transaction updated successfully!",
        });
      } catch (error) {
        res.status(500).send({ error: "Internal server error" });
      }
    });

    app.get("/balance", verifyFirebaseToken, async (req, res) => {
      const email = req.user.email;
      const txns = await costsCollection.find({ email }).toArray();
      let incomeTotal = 0;
      let expenseTotal = 0;

      txns
        .filter((txn) => txn.type === "income")
        .forEach((x) => {
          incomeTotal += x.amount;
        });
      txns
        .filter((txn) => txn.type === "expense")
        .forEach((x) => {
          expenseTotal += x.amount;
        });

      res.send({
        balance: incomeTotal - expenseTotal,
        income: incomeTotal,
        expense: expenseTotal,
      });
    });

    app.get("/my-transactions", verifyFirebaseToken, async (req, res) => {
      const email = req.user.email;
      const userTransactions = await costsCollection
        .find({ email })
        .sort({ createdAt: -1 })
        .toArray();
      res.send(userTransactions);
    });

    app.get("/transaction/:id", verifyFirebaseToken, async (req, res) => {
      const email = req.user.email;
      const id = req.params.id;
      const transaction = await costsCollection.findOne({
        email,
        _id: new ObjectId(id),
      });
      const categoryTotalArr = await costsCollection
        .find({
          email,
          category: transaction.category,
        })
        .toArray();
      let category_total = 0;
      categoryTotalArr
        .map((x) => x.amount)
        .forEach((y) => {
          category_total += y;
        });

      res.send({ ...transaction, category_total });
    });

    app.delete("/transaction/:id", verifyFirebaseToken, async (req, res) => {
      const email = req.user.email;
      const id = req.params.id;
      const transaction = await costsCollection.deleteOne({
        email,
        _id: new ObjectId(id),
      });
      if (transaction.deletedCount > 0) {
        return res.status(200).send({
          success: true,
          message: "Transaction deleted successfully.",
        });
      } else {
        return res.status(404).send({
          success: false,
          message: "Transaction not found",
        });
      }
    });
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/quote", async (req, res) => {
  try {
    const response = await axios.get("https://zenquotes.io/api/random");
    const quoteData = response.data[0];
    cachedQuote = {
      quote: quoteData.q,
      author: quoteData.a,
    };
    res.json(cachedQuote);
  } catch (error) {
    if (cachedQuote) {
      return res.json({ ...cachedQuote, cached: true });
    }

    res
      .status(500)
      .json({ error: "Failed to fetch quote and no cache available" });
  }
});

app.listen(port, () => {
  console.log(`Fin Track listening on port ${port}`);
});
