import { exec } from "child_process";
import { promisify } from "util";
import http from "http";
import net from "net";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import androidtvPkg from "androidtv-remote";

const { AndroidRemote, RemoteKeyCode, RemoteDirection } = androidtvPkg;
const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CERTS_FILE = path.join(__dirname, "..", "tv_certs.json");

// Certificate persistence
function loadCerts() {
  try {
    if (fs.existsSync(CERTS_FILE)) {
      return JSON.parse(fs.readFileSync(CERTS_FILE, "utf-8"));
    }
  } catch (e) {
    console.error("Error loading TV certs:", e);
  }
  return {};
}

function saveCert(ip, cert) {
  try {
    const certs = loadCerts();
    certs[ip] = cert;
    fs.writeFileSync(CERTS_FILE, JSON.stringify(certs, null, 2), "utf-8");
    console.log(`[Google TV]: Saved certificate for ${ip} to tv_certs.json`);
  } catch (err) {
    console.error("Failed to save TV cert:", err);
  }
}

// Global active Google TV connection
let activeGoogleTv = null;
let activeGoogleTvIp = null;

export function getActiveGoogleTv() {
  return activeGoogleTv;
}

export const GOOGLE_TV_KEYS = {
  up: 19, // KEYCODE_DPAD_UP
  down: 20, // KEYCODE_DPAD_DOWN
  left: 21, // KEYCODE_DPAD_LEFT
  right: 22, // KEYCODE_DPAD_RIGHT
  ok: 23, // KEYCODE_DPAD_CENTER
  select: 23,
  enter: 66, // KEYCODE_ENTER
  home: 3, // KEYCODE_HOME
  back: 4, // KEYCODE_BACK
  menu: 82, // KEYCODE_MENU
  volume_up: 24, // KEYCODE_VOLUME_UP
  volume_down: 25, // KEYCODE_VOLUME_DOWN
  mute: 164, // KEYCODE_VOLUME_MUTE
  power: 26, // KEYCODE_POWER
  play_pause: 85, // KEYCODE_MEDIA_PLAY_PAUSE
  next: 87, // KEYCODE_MEDIA_NEXT
  prev: 88, // KEYCODE_MEDIA_PREVIOUS
  channel_up: 166,
  channel_down: 167,
  "0": 7,
  "1": 8,
  "2": 9,
  "3": 10,
  "4": 11,
  "5": 12,
  "6": 13,
  "7": 14,
  "8": 15,
  "9": 16,
};

export function startGoogleTvPairing(ip, onNeedsCode, onReady, onError) {
  try {
    if (activeGoogleTv) {
      try {
        activeGoogleTv.stop();
      } catch {
        // ignore
      }
      activeGoogleTv = null;
    }

    const savedCerts = loadCerts();
    const existingCert = savedCerts[ip];
    const hasCert = existingCert && existingCert.key && existingCert.cert;

    console.log(`[Google TV]: Initializing connection to ${ip} (Saved Cert: ${hasCert ? "YES" : "NO"})...`);

    const remote = new AndroidRemote(ip, {
      pairing_port: 6467,
      remote_port: 6466, // Correct Android TV remote service port!
      service_name: "WiFi Smart Remote",
      cert: hasCert ? existingCert : undefined,
    });

    activeGoogleTv = remote;
    activeGoogleTvIp = ip;

    remote.on("secret", () => {
      console.log(`[Google TV]: TV ${ip} requires PIN Code on screen!`);
      // Save the generated cert right away so pairing secret can be matched
      try {
        const cert = remote.getCertificate();
        if (cert && cert.key && cert.cert) {
          saveCert(ip, cert);
        }
      } catch {
        // ignore
      }
      if (onNeedsCode) onNeedsCode();
    });

    remote.on("ready", () => {
      console.log(`[Google TV]: Connected and Ready to send keys for TV ${ip}!`);
      try {
        const cert = remote.getCertificate();
        if (cert && cert.key && cert.cert) {
          saveCert(ip, cert);
        }
      } catch (e) {
        console.error("Cert save error:", e);
      }
      if (onReady) onReady();
    });

    remote.on("error", (err) => {
      console.error(`[Google TV Error for ${ip}]:`, err?.message || err);
      if (onError) onError(err);
    });

    remote.on("unpaired", () => {
      console.log(`[Google TV]: Unpaired signal from TV ${ip}`);
    });

    remote.start().catch((err) => {
      console.error(`[Google TV Start Failed for ${ip}]:`, err?.message || err);
      if (onError) onError(err);
    });

    return remote;
  } catch (err) {
    if (onError) onError(err);
    return null;
  }
}

export async function sendGoogleTvCode(code) {
  if (!activeGoogleTv) {
    throw new Error("No active Google TV pairing session");
  }
  console.log(`[Google TV]: Submitting PIN code '${code}' to TV...`);
  const res = await activeGoogleTv.sendCode(code);
  // Also save the certificate once code is sent
  try {
    const cert = activeGoogleTv.getCertificate();
    if (cert && cert.key && cert.cert && activeGoogleTvIp) {
      saveCert(activeGoogleTvIp, cert);
    }
  } catch (e) {
    console.error("Cert save error after code:", e);
  }
  return res;
}

export function sendGoogleTvKey(key) {
  if (!activeGoogleTv) {
    throw new Error("Google TV is not connected. Tap 'Pair / Connect' first!");
  }
  const code = GOOGLE_TV_KEYS[key.toLowerCase()];
  if (code !== undefined) {
    console.log(`[Google TV]: Pressing Key '${key}' (Keycode: ${code})`);
    return activeGoogleTv.sendKey(code, RemoteDirection.SHORT);
  }
  throw new Error(`Unknown Google TV key: ${key}`);
}

export function sendGoogleTvApp(urlOrName) {
  if (!activeGoogleTv) {
    throw new Error("Google TV is not connected");
  }
  let link = urlOrName;
  if (urlOrName === "youtube") link = "https://www.youtube.com";
  else if (urlOrName === "netflix") link = "https://www.netflix.com";
  else if (urlOrName === "prime") link = "https://www.primevideo.com";
  else if (urlOrName === "spotify") link = "https://open.spotify.com";

  console.log(`[Google TV]: Launching App '${urlOrName}' (${link})`);
  return activeGoogleTv.sendAppLink(link);
}

// =======================================================================
// ADB & ROKU PROTOCOLS
// =======================================================================
const ADB_KEYCODES = {
  up: 19,
  down: 20,
  left: 21,
  right: 22,
  ok: 23,
  select: 23,
  home: 3,
  back: 4,
  menu: 82,
  volume_up: 24,
  volume_down: 25,
  mute: 164,
  power: 26,
  play_pause: 85,
  next: 87,
  prev: 88,
  rewind: 89,
  fast_forward: 90,
  channel_up: 166,
  channel_down: 167,
  "0": 7,
  "1": 8,
  "2": 9,
  "3": 10,
  "4": 11,
  "5": 12,
  "6": 13,
  "7": 14,
  "8": 15,
  "9": 16,
};

const ROKU_KEYS = {
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  ok: "Select",
  select: "Select",
  home: "Home",
  back: "Back",
  volume_up: "VolumeUp",
  volume_down: "VolumeDown",
  mute: "VolumeMute",
  power: "PowerOff",
  play_pause: "Play",
  next: "Fwd",
  prev: "Rev",
};

const ROKU_APPS = {
  youtube: "837",
  netflix: "12",
  prime: "13",
  spotify: "22297",
};

export async function connectAdb(ip) {
  try {
    const target = ip.includes(":") ? ip : `${ip}:5555`;
    const { stdout, stderr } = await execAsync(`adb connect ${target}`, { timeout: 6000 });
    return { success: stdout.includes("connected") || stdout.includes("already"), message: stdout.trim() || stderr.trim() };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

export async function getAdbDevices() {
  try {
    const { stdout } = await execAsync("adb devices", { timeout: 4000 });
    const lines = stdout.trim().split("\n").slice(1);
    const devices = lines
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => {
        const parts = l.split(/\s+/);
        return { id: parts[0], status: parts[1] };
      });
    return devices;
  } catch {
    return [];
  }
}

export async function sendAdbKey(ip, key) {
  const code = ADB_KEYCODES[key.toLowerCase()];
  if (!code) {
    throw new Error(`Unknown ADB key: ${key}`);
  }
  const target = ip ? `-s ${ip.includes(":") ? ip : ip + ":5555"}` : "";
  await execAsync(`adb ${target} shell input keyevent ${code}`, { timeout: 3000 });
  return { success: true };
}

export async function sendAdbText(ip, text) {
  const target = ip ? `-s ${ip.includes(":") ? ip : ip + ":5555"}` : "";
  const sanitized = text.replace(/[^a-zA-Z0-9_\-\s]/g, "");
  await execAsync(`adb ${target} shell input text "${sanitized}"`, { timeout: 3000 });
  return { success: true };
}

export async function launchAdbApp(ip, app) {
  const target = ip ? `-s ${ip.includes(":") ? ip : ip + ":5555"}` : "";
  let pkg = "";
  if (app === "youtube") pkg = "com.google.android.youtube.tv";
  else if (app === "netflix") pkg = "com.netflix.ninja";
  else if (app === "prime") pkg = "com.amazon.amazonvideo.livingroom";
  else if (app === "hotstar") pkg = "in.startv.hotstar";
  else if (app === "spotify") pkg = "com.spotify.tv.android";

  if (pkg) {
    await execAsync(`adb ${target} shell monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`, { timeout: 5000 });
    return { success: true };
  }
  throw new Error(`Unknown app: ${app}`);
}

export function sendRokuCommand(ip, action, param) {
  return new Promise((resolve, reject) => {
    let path = "";
    if (action === "key") {
      const rokuKey = ROKU_KEYS[param.toLowerCase()] || param;
      path = `/keypress/${rokuKey}`;
    } else if (action === "launch") {
      const appId = ROKU_APPS[param.toLowerCase()] || param;
      path = `/launch/${appId}`;
    } else {
      return reject(new Error("Unknown Roku action"));
    }

    const req = http.request(
      {
        host: ip,
        port: 8060,
        path: path,
        method: "POST",
        timeout: 3000,
      },
      (res) => {
        resolve({ success: res.statusCode === 200 });
      }
    );
    req.on("error", (e) => reject(e));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Roku connection timeout"));
    });
    req.end();
  });
}

function checkPort(ip, port, timeout = 600) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      resolve(false);
    });
    socket.connect(port, ip);
  });
}

export async function scanLocalSmartTVs(baseSubnet) {
  const detected = [];
  const promises = [];

  for (let i = 1; i <= 254; i++) {
    const ip = `${baseSubnet}.${i}`;
    promises.push(
      (async () => {
        const isGoogleTv = await checkPort(ip, 6467, 500);
        if (isGoogleTv) {
          detected.push({ ip, type: "Android / Google TV (PIN Code Pairing)", protocol: "googletv", port: 6467 });
          return;
        }

        const isRoku = await checkPort(ip, 8060, 500);
        if (isRoku) {
          detected.push({ ip, type: "Roku TV", protocol: "roku", port: 8060 });
          return;
        }

        const isAdb = await checkPort(ip, 5555, 500);
        if (isAdb) {
          detected.push({ ip, type: "Android TV (ADB Mode)", protocol: "adb", port: 5555 });
          return;
        }
      })()
    );
  }

  await Promise.all(promises);
  return detected;
}
