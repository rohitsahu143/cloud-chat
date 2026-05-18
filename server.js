
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static("public"));

/* ── MONGODB CONNECTION ── */
// Replace this URI with your MongoDB Atlas connection string
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/cloudchat";

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("❌ MongoDB Error:", err));

/* ── SCHEMAS ── */
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, trim: true },
  password: String,
  createdAt: { type: Date, default: Date.now }
});

const MessageSchema = new mongoose.Schema({
  sender:   String,
  receiver: String,
  text:     String,
  time:     String,
  createdAt: { type: Date, default: Date.now }
});

const User    = mongoose.model("User", UserSchema);
const Message = mongoose.model("Message", MessageSchema);

/* ── AUTH ROUTES ── */

// Register
app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password)
      return res.json({ success: false, error: "Username and password required" });

    if (username.length < 3)
      return res.json({ success: false, error: "Username must be at least 3 characters" });

    if (password.length < 3)
      return res.json({ success: false, error: "Password must be at least 3 characters" });

    const exists = await User.findOne({ username });
    if (exists)
      return res.json({ success: false, error: "Username already taken" });

    const hashed = await bcrypt.hash(password, 10);
    await User.create({ username, password: hashed });

    // Notify all connected clients about the new user
    io.emit("user list updated");

    res.json({ success: true });
  } catch (err) {
    console.error("Register error:", err);
    res.json({ success: false, error: "Server error" });
  }
});

// Login
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password)
      return res.json({ success: false, error: "Fill in all fields" });

    const user = await User.findOne({ username });
    if (!user)
      return res.json({ success: false, error: "User not found" });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.json({ success: false, error: "Wrong password" });

    res.json({ success: true, username: user.username });
  } catch (err) {
    console.error("Login error:", err);
    res.json({ success: false, error: "Server error" });
  }
});

// Get all users (for sidebar)
app.get("/users", async (req, res) => {
  try {
    const users = await User.find({}, "username").sort({ createdAt: 1 });
    res.json({ users: users.map(u => u.username) });
  } catch (err) {
    res.json({ users: [] });
  }
});

/* ── SOCKET.IO ── */

// Track online users: username -> socket id
const onlineUsers = {};

io.on("connection", (socket) => {
  console.log("🔌 User connected:", socket.id);

  // Register logged-in user
  socket.on("register user", (username) => {
    onlineUsers[username] = socket.id;
    socket.username = username;
    console.log(`👤 ${username} is online`);
  });

  // Load chat history between two users
  socket.on("load messages", async ({ me, friend }) => {
    try {
      const msgs = await Message.find({
        $or: [
          { sender: me,     receiver: friend },
          { sender: friend, receiver: me     }
        ]
      }).sort({ createdAt: 1 });

      socket.emit("chat history", msgs);
    } catch (err) {
      console.error("Load messages error:", err);
    }
  });

  // Send a new message
  socket.on("chat message", async (msg) => {
    try {
      const saved = await Message.create(msg);

      // Send to sender
      socket.emit("chat message", saved);

      // Send to receiver if online
      const receiverSocket = onlineUsers[msg.receiver];
      if (receiverSocket && receiverSocket !== socket.id) {
        io.to(receiverSocket).emit("chat message", saved);
      }
    } catch (err) {
      console.error("Message save error:", err);
    }
  });

  // Delete selected messages
  socket.on("delete messages", async ({ ids, me, friend }) => {
    try {
      await Message.deleteMany({
        _id: { $in: ids },
        $or: [
          { sender: me,     receiver: friend },
          { sender: friend, receiver: me     }
        ]
      });

      // Notify both users
      socket.emit("messages deleted");
      const friendSocket = onlineUsers[friend];
      if (friendSocket) io.to(friendSocket).emit("messages deleted");
    } catch (err) {
      console.error("Delete error:", err);
    }
  });

  // Clear entire conversation
  socket.on("clear chat", async ({ me, friend }) => {
    try {
      await Message.deleteMany({
        $or: [
          { sender: me,     receiver: friend },
          { sender: friend, receiver: me     }
        ]
      });

      socket.emit("chat cleared");
      const friendSocket = onlineUsers[friend];
      if (friendSocket) io.to(friendSocket).emit("chat cleared");
    } catch (err) {
      console.error("Clear chat error:", err);
    }
  });

  // Cleanup on disconnect
  socket.on("disconnect", () => {
    if (socket.username) {
      delete onlineUsers[socket.username];
      console.log(`👋 ${socket.username} disconnected`);
    }
  });
});

/* ── START SERVER ── */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
