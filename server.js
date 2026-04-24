
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const https = require("https");
const bcrypt = require("bcryptjs");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 60000,
  pingInterval: 25000,
});

/* ================= CRASH HANDLING ================= */
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err.message);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

/* ================= MONGODB ================= */
const mongoURI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/cloudchat";

const connectDB = async () => {
  try {
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log("✅ MongoDB Connected");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    setTimeout(connectDB, 5000);
  }
};
connectDB();

mongoose.connection.on("disconnected", () => {
  console.warn("⚠️ MongoDB disconnected. Reconnecting...");
  setTimeout(connectDB, 5000);
});

/* ================= MODELS ================= */

// User
const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
});
const User = mongoose.model("User", UserSchema);

// Message
const MessageSchema = new mongoose.Schema({
  sender: String,
  receiver: String,
  text: String,
  time: String,
});
const Message = mongoose.model("Message", MessageSchema);

/* ================= MIDDLEWARE ================= */
app.use(express.json());
app.use(express.static("public"));

/* ================= HEALTH ================= */
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

/* ================= AUTH ROUTES ================= */

// REGISTER
app.post("/api/auth/register", async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ msg: "All fields required" });
  }

  try {
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ msg: "User already exists" });

    const hash = await bcrypt.hash(password, 10);

    user = new User({ name, email, password: hash });
    await user.save();

    res.status(201).json({ msg: "Registered successfully" });

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: "Server error" });
  }
});

// LOGIN
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ msg: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: "Invalid credentials" });

    res.json({
      msg: "Login success",
      user: { name: user.name, email: user.email },
    });

  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

// GET USERS
app.get("/api/users", async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.json(users);
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

/* ================= SOCKET ================= */

const connectedUsers = new Map();

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);
  connectedUsers.set(socket.id, { connectedAt: Date.now() });

  // Load chat history
  socket.on("load messages", async (users) => {
    if (!users || !users.me || !users.friend) return;

    try {
      const msgs = await Message.find({
        $or: [
          { sender: users.me, receiver: users.friend },
          { sender: users.friend, receiver: users.me },
        ],
      })
        .sort({ _id: -1 })
        .limit(100)
        .lean();

      socket.emit("chat history", msgs.reverse());
    } catch (err) {
      console.error("History load error:", err.message);
      socket.emit("chat history", []);
    }
  });

  // New message
  socket.on("chat message", async (msg) => {
    if (!msg || !msg.text || !msg.sender) return;

    try {
      const newMsg = new Message(msg);
      await newMsg.save();
    } catch (err) {
      console.error("DB save error:", err.message);
    }

    io.emit("chat message", msg);
  });

  socket.on("disconnect", () => {
    connectedUsers.delete(socket.id);
    console.log(`User disconnected: ${socket.id}`);
  });
});

/* ================= KEEP ALIVE ================= */
const RENDER_URL = process.env.RENDER_URL || "";

if (RENDER_URL) {
  setInterval(() => {
    https
      .get(`${RENDER_URL}/health`, (res) => {
        console.log(`Keep-alive ping ✅ ${res.statusCode}`);
      })
      .on("error", (err) => {
        console.error("Keep-alive error:", err.message);
      });
  }, 14 * 60 * 1000);
}

/* ================= SERVER ================= */
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
