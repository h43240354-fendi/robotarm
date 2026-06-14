const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const path    = require("path");
const mongoose = require("mongoose");
const axios = require("axios");
const session = require("express-session");
require("dotenv").config();

const app = express();
const otpStore = new Map();
const activeUsers = new Map();

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 8 
  }
}));

app.use(express.static(path.join(__dirname, "public")));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

function requireLogin(req, res, next) {
  if (!req.session?.userId) {
    return res.redirect("/");
  }

  const userId = req.session.userId;
  const active = activeUsers.get(userId);
  if (!active || active.sessionId !== req.session.id) {
    req.session.destroy(() => {});
    return res.redirect("/?reason=session_expired");
  }

  active.lastActivity = Date.now();
  next();
}

mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 5000
})
.then(() => console.log('Berhasil terhubung ke MongoDB Atlas.'))
.catch(err => console.error('Gagal konek ke MongoDB:', err.message));

const userSchema = new mongoose.Schema({
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true },
  empId:    { type: String },
  sector:   { type: String }
}, { timestamps: true });

const User = mongoose.model("User", userSchema);

setInterval(() => {
  const now = Date.now();
  for (const [userId, data] of activeUsers.entries()) {
    if (now - data.lastActivity > IDLE_TIMEOUT_MS) {
      console.log(`[IDLE] Auto-logout userId: ${userId} karena idle > 15 menit`);
      activeUsers.delete(userId);
    }
  }
}, 60 * 1000); 

app.get("/",         (req, res) => res.sendFile(path.join(__dirname, "public", "pages", "login.html")));
app.get("/register", (req, res) => res.sendFile(path.join(__dirname, "public", "pages", "register.html")));
app.get("/reset",    (req, res) => res.sendFile(path.join(__dirname, "public", "pages", "reset.html")));

app.get("/home",      requireLogin, (req, res) => res.sendFile(path.join(__dirname, "public", "pages", "home.html")));
app.get("/kalibrasi", requireLogin, (req, res) => res.sendFile(path.join(__dirname, "public", "pages", "kalibrasi.html")));
app.get("/profile",   requireLogin, (req, res) => res.sendFile(path.join(__dirname, "public", "pages", "profile.html")));

async function sendOTP(email, otp) {
  await axios.post(
    "https://api.brevo.com/v3/smtp/email",
    {
      sender: {
        name: process.env.BREVO_SENDER_NAME,
        email: process.env.BREVO_SENDER_EMAIL
      },
      to: [{ email }],
      subject: "Kode OTP ARM Robot",
      htmlContent: `<h2>Verifikasi Email</h2><h1>${otp}</h1>`
    },
    {
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json"
      }
    }
  );
}

app.post("/api/send-otp", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).send("Email wajib diisi");

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(email, { otp, expires: Date.now() + 5 * 60 * 1000 });
    await sendOTP(email, otp);
    res.json({ success: true, message: "OTP berhasil dikirim" });

  } catch (err) {
    console.error("ERROR OTP:", err.response?.data || err.message);
    res.status(500).send("Gagal mengirim OTP");
  }
});

app.post("/api/register", async (req, res) => {
  try {
    const { email, password, otp } = req.body;
    if (!email || !password) return res.status(400).send("Semua field wajib diisi!");

    const savedOtp = otpStore.get(email);
    if (!savedOtp)                     return res.status(400).send("OTP tidak ditemukan");
    if (savedOtp.expires < Date.now()) return res.status(400).send("OTP kadaluarsa");
    if (savedOtp.otp !== otp)          return res.status(400).send("OTP salah");
    otpStore.delete(email);

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).send("Email sudah terdaftar!");

    const randomId = "RX-990-" + Math.floor(100 + Math.random() * 900);
    await new User({ email, password, empId: randomId }).save();

    console.log(`[AUTH] User baru: ${email} | ID: ${randomId}`);
    res.status(200).send("OK");
  } catch (error) {
    console.error("[AUTH] Gagal register:", error);
    res.status(500).send("Terjadi kesalahan pada server.");
  }
});

app.post("/api/reset-password", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) return res.status(400).send("Semua field wajib diisi");

    const savedOtp = otpStore.get(email);
    if (!savedOtp)                     return res.status(400).send("OTP tidak ditemukan");
    if (savedOtp.expires < Date.now()) return res.status(400).send("OTP kadaluarsa");
    if (savedOtp.otp !== otp)          return res.status(400).send("OTP salah");

    const user = await User.findOne({ email });
    if (!user) return res.status(404).send("Email tidak terdaftar");

    user.password = newPassword;
    await user.save();
    otpStore.delete(email);

    console.log(`[RESET PASSWORD] ${email}`);
    res.status(200).send("Password berhasil diperbarui");
  } catch (error) {
    console.error("[RESET PASSWORD] Error:", error);
    res.status(500).send("Terjadi kesalahan pada server");
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user)                    return res.status(400).send("Email tidak terdaftar!");
    if (user.password !== password) return res.status(400).send("Password salah!");

    const userId = user._id.toString();

    if (activeUsers.has(userId)) {
      const existing = activeUsers.get(userId);
      const idleFor  = Date.now() - existing.lastActivity;

      if (idleFor < IDLE_TIMEOUT_MS) {
        const sisaMenit = Math.ceil((IDLE_TIMEOUT_MS - idleFor) / 60000);
        return res.status(409).json({
          code   : "ALREADY_LOGGED_IN",
          message: `Akun ini sedang digunakan. Sesi akan berakhir dalam ${sisaMenit} menit jika tidak ada aktivitas.`
        });
      }

      console.log(`[LOGIN] Session lama idle, digantikan: ${email}`);
      activeUsers.delete(userId);
    }

    user.lastLogin = new Date();
    await user.save();

    req.session.regenerate((err) => {
      if (err) return res.status(500).send("Gagal membuat session");

      req.session.userId = userId;
      req.session.email  = user.email;
      activeUsers.set(userId, {
        sessionId   : req.session.id,
        lastActivity: Date.now()
      });

      console.log(`[LOGIN] Berhasil: ${email} | Session: ${req.session.id}`);

      const isAjax = req.headers['content-type']?.includes('application/json');
      if (isAjax) {
        return res.json({ success: true, message: "Login berhasil", email: user.email });
      }
      res.redirect("/home");
    });

  } catch (error) {
    console.error("Gagal login:", error);
    res.status(500).send("Terjadi kesalahan pada server.");
  }
});

app.post("/api/logout", (req, res) => {
  const userId = req.session?.userId;
  if (userId) activeUsers.delete(userId);

  req.session.destroy(err => {
    if (err) {
      console.error("[LOGOUT] Gagal:", err);
      return res.status(500).send("Gagal logout");
    }
    res.clearCookie("connect.sid");
    res.json({ success: true, message: "Logout berhasil" });
  });
});

app.get("/api/auth/status", (req, res) => {
  if (!req.session?.userId) {
    return res.json({ loggedIn: false });
  }

  const userId = req.session.userId;
  const active = activeUsers.get(userId);

  if (!active || active.sessionId !== req.session.id) {
    return res.json({ loggedIn: false, reason: "session_expired" });
  }

  const idleFor    = Date.now() - active.lastActivity;
  const sisaMs     = IDLE_TIMEOUT_MS - idleFor;

  res.json({
    loggedIn   : true,
    email      : req.session.email,
    idleTimeMs : idleFor,
    remainingMs: Math.max(0, sisaMs)
  });
});

app.post("/api/heartbeat", (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ loggedIn: false });
  }

  const userId = req.session.userId;
  const active = activeUsers.get(userId);

  if (!active || active.sessionId !== req.session.id) {
    return res.status(401).json({ loggedIn: false, reason: "session_expired" });
  }

  active.lastActivity = Date.now();
  res.json({ loggedIn: true, remainingMs: IDLE_TIMEOUT_MS });
});

app.get("/api/operator/me", requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).json({ message: "User tidak ditemukan" });

    res.json({
      email    : user.email,
      empId    : user.empId,
      sector   : user.sector,
      lastLogin: user.updatedAt
    });
  } catch (error) { 
    res.status(500).json({ message: "Gagal mengambil data server" });
  }
});

app.delete("/api/operator/:email", requireLogin, async (req, res) => {
  try {
    const { email } = req.params;
    const deleted = await User.findOneAndDelete({ email });

    if (!deleted)
      return res.status(404).json({ success: false, message: "Operator tidak ditemukan" });

    console.log(`Akun ${email} telah dihapus.`);
    res.json({ success: true, message: "Akun berhasil dihapus dari database" });
  } catch (error) {
    console.error("Gagal menghapus akun:", error);
    res.status(500).json({ success: false, message: "Gagal menghapus data di server" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server berjalan pada port ${PORT}`);
});