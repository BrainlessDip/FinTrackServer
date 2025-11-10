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
    const usersCollection = db.collection("users");
    const costsCollection = db.collection("costs");

    app.post("/check", async (req, res) => {
      const { email } = req.body;
      const isAlready = await usersCollection.findOne({ email });
      if (isAlready) {
        res.status(200).send({ message: "User already exists" });
      } else {
        await usersCollection.insertOne({
          balance: 0,
          income: 0,
          expense: 0,
          email,
        });
        res.status(201).send({ message: "User added successfully" });
      }
    });

    app.post("/add-transaction", verifyFirebaseToken, async (req, res) => {
      try {
        const { type, category, amount, description, date, name } = req.body;
        const email = req.user.email;

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
          email,
          name: name || "",
        };

        const result = await costsCollection.insertOne(data);
        await usersCollection.updateOne(
          { email },
          {
            $inc: {
              [type]: Number(amount),
              balance: type === "income" ? Number(amount) : -Number(amount),
            },
          }
        );

        res.send({
          success: true,
          insertedId: result.insertedId,
          message: "Transaction added successfully!",
        });
      } catch (error) {
        console.log(error);

        res.status(500).send({ error: "Internal server error" });
      }
    });

    app.get("/balance", verifyFirebaseToken, async (req, res) => {
      const email = req.user.email;
      const user = await usersCollection.findOne({ email });
      res.send(user);
    });

    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
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
  console.log(`Example app listening on port ${port}`);
});
