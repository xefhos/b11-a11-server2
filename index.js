const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://foodify-25c2d.web.app' // or your actual frontend domain
  ],
  credentials: true,
}));

app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.v5wedkm.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 }); // ✅ NEW: Ensures connection is alive
    console.log("✅ Pinged MongoDB successfully");

    const db = client.db("Foodify");
    const topFoodsCollection = db.collection("Top-foods");
    const allFoodsCollection = db.collection("all-Foods");
    const addedCollection = db.collection("added");
    const ordersCollection = db.collection("Orders");

    app.get('/top-foods', async (req, res) => {
      try {
        const result = await topFoodsCollection.find().sort({ purchaseCount: -1 }).limit(6).toArray();
        res.json(result);
      } catch (err) {
        console.error("❌ Failed to fetch top foods:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.get("/api/all-foods", async (req, res) => {
      try {
        const [adminFoods, userFoods] = await Promise.all([
          allFoodsCollection.find().toArray(),
          addedCollection.find().toArray()
        ]);
        console.log("📦 Admin:", adminFoods.length, " | User:", userFoods.length);
    
        const mergedFoods = [...adminFoods, ...userFoods];
        res.json(mergedFoods);
      } catch (error) {
        console.error("❌ Error fetching combined foods", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.get("/api/all-foods/:id", async (req, res) => {
      const id = req.params.id;
      try {
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid ID format" });
        }
        const food = await allFoodsCollection.findOne({ _id: new ObjectId(id) });
        if (!food) {
          return res.status(404).json({ message: "Food not found" });
        }
        res.json(food);
      } catch (err) {
        console.error("❌ Error fetching food by ID:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // ✅ NEW: GET food by ID from 'added' collection (for UpdateFood)
    app.get("/api/foods/:id", async (req, res) => {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid food ID" });
      }

      try {
        const food = await addedCollection.findOne({ _id: new ObjectId(id) });

        if (!food) {
          return res.status(404).json({ message: "Food not found" });
        }

        res.json(food);
      } catch (err) {
        console.error("❌ Error fetching food:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.get("/api/my-foods", async (req, res) => {
      const email = req.query.email;
      if (!email) {
        return res.status(400).json({ message: "Missing user email" });
      }
      try {
        const userFoods = await addedCollection.find({ "addedBy.email": email }).toArray();
        res.json(userFoods);
      } catch (err) {
        console.error("❌ Error fetching user's foods:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.post("/api/foods", async (req, res) => {
      try {
        const food = req.body;
        console.log("📦 Received food data:", food);

        if (!food || !food.name || !food.addedBy?.email) {
          return res.status(400).json({ message: "Missing required food data" });
        }

        food.createdAt = new Date();

        const result = await addedCollection.insertOne(food);
        console.log("✅ Inserted food result:", result);

        res.status(201).json({ insertedId: result.insertedId });
      } catch (err) {
        console.error("❌ Error adding food:", err);
        res.status(500).json({ message: "Failed to add food item" });
      }
    });

    app.post('/api/purchase', async (req, res) => {
      try {
        const order = req.body;
        const result = await ordersCollection.insertOne(order);
        res.json(result);
      } catch (err) {
        console.error("❌ Failed to save purchase:", err);
        res.status(500).json({ message: "Purchase failed" });
      }
    });

    // GET My Orders
    app.get("/api/my-orders", async (req, res) => {
      const email = req.query.email;
      if (!email) {
        return res.status(400).json({ message: "Missing buyer email" });
      }
      try {
        const orders = await ordersCollection.find({ buyerEmail: email }).toArray();
        res.json(orders);
      } catch (err) {
        console.error("❌ Error fetching orders:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // ❌ 2. DELETE an Order
    app.delete("/api/my-orders/:id", async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid order ID" });
      }
      try {
        const result = await ordersCollection.deleteOne({ _id: new ObjectId(id) });
        res.json(result);
      } catch (err) {
        console.error("❌ Error deleting order:", err);
        res.status(500).json({ message: "Delete failed" });
      }
    });

    // ✅ PUT: Update food item (only by the owner)
    app.put("/api/update-food/:id", async (req, res) => {
      const id = req.params.id;
      const { email } = req.query;
      const updatedData = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid food ID" });
      }

      try {
        const existing = await addedCollection.findOne({ _id: new ObjectId(id) });

        if (!existing) {
          return res.status(404).json({ message: "Food not found" });
        }

        if (existing.addedBy?.email !== email) {
          return res.status(403).json({ message: "Not authorized to update this food" });
        }

        const result = await addedCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedData }
        );

        res.json({
          message: "✅ Food updated successfully",
          modifiedCount: result.modifiedCount
        });
      } catch (err) {
        console.error("❌ Error updating food:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
  }
}

run().catch(console.error);

// ✅ NEW: Extra safety for crashes
process.on("unhandledRejection", (err) => {
  console.error("💥 Unhandled Rejection:", err);
});

app.get('/', (req, res) => {
  res.send('🍽️ Foodify server is ready');
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
