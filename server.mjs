import http from "http";
import os from "os";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "url";
import { WebSocketServer } from "ws";
import next from "next";
import QRCode from "qrcode";
import {
  connectAdb,
  getAdbDevices,
  sendAdbKey,
  sendAdbText,
  launchAdbApp,
  sendRokuCommand,
  scanLocalSmartTVs,
  startGoogleTvPairing,
  sendGoogleTvCode,
  sendGoogleTvKey,
  sendGoogleTvApp,
} from "./backend/tvController.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dev = process.env.NODE_ENV === "development";
const PORT = parseInt(process.env.PORT || "3000", 10);

// Detect Local LAN IPv4
function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "127.0.0.1";
}

const LOCAL_IP = getLocalIp();
const APP_URL = `http://${LOCAL_IP}:${PORT}`;

// Start persistent Python controller for sub-millisecond PC input synthesis
const pythonProc = spawn("python3", [path.join(__dirname, "backend", "controller.py")], {
  stdio: ["pipe", "pipe", "inherit"],
});

pythonProc.stdout.on("data", (data) => {
  const msg = data.toString().trim();
  if (msg) console.log(`[Python Controller]: ${msg}`);
});

pythonProc.on("exit", (code) => {
  console.log(`[Python Controller] exited with code ${code}`);
});

function sendToPython(payload) {
  if (pythonProc && pythonProc.stdin && pythonProc.stdin.writable) {
    pythonProc.stdin.write(JSON.stringify(payload) + "\n");
  }
}

// Prepare Next.js
const app = next({ dev, dir: __dirname });
const handle = app.getRequestHandler();

async function start() {
  await app.prepare();

  // Pre-generate QR code for instant pairing
  let qrDataUrl = "";
  try {
    qrDataUrl = await QRCode.toDataURL(APP_URL, {
      margin: 2,
      width: 280,
      color: {
        dark: "#00f5d4",
        light: "#090d16",
      },
    });
  } catch (err) {
    console.error("QR Code generation error:", err);
  }

  const server = http.createServer(async (req, res) => {
    const parsedUrl = parse(req.url, true);
    const { pathname } = parsedUrl;

    // CORS & JSON Helper
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    // Custom API: /api/info
    if (pathname === "/api/info") {
      const adbDevices = await getAdbDevices();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          localIp: LOCAL_IP,
          port: PORT,
          appUrl: APP_URL,
          qrCode: qrDataUrl,
          adbDevices,
          hostname: os.hostname(),
          platform: os.platform(),
        })
      );
      return;
    }

    // Custom API: /api/scan-tv
    if (pathname === "/api/scan-tv") {
      try {
        const subnetParts = LOCAL_IP.split(".").slice(0, 3).join(".");
        const detected = await scanLocalSmartTVs(subnetParts);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, devices: detected }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
      return;
    }

    // Default to Next.js handler
    handle(req, res, parsedUrl);
  });

  // Attach WebSocket Server for ultra-fast, zero-lag phone remote controls
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url);
    if (pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
  });

  wss.on("connection", (ws) => {
    // Send initial status
    ws.send(JSON.stringify({ type: "connected", localIp: LOCAL_IP, port: PORT }));

    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", ts: msg.ts }));
          return;
        }

        // PC Remote Commands
        if (msg.type === "mouse_move") {
          sendToPython({ action: "mouse_move", dx: msg.dx, dy: msg.dy });
        } else if (msg.type === "mouse_click") {
          sendToPython({ action: "mouse_click", button: msg.button || 1 });
        } else if (msg.type === "mouse_down") {
          sendToPython({ action: "mouse_down", button: msg.button || 1 });
        } else if (msg.type === "mouse_up") {
          sendToPython({ action: "mouse_up", button: msg.button || 1 });
        } else if (msg.type === "mouse_scroll") {
          sendToPython({ action: "mouse_scroll", dy: msg.dy });
        } else if (msg.type === "key") {
          sendToPython({ action: "key", key: msg.key });
        } else if (msg.type === "shortcut") {
          sendToPython({ action: "shortcut", keys: msg.keys });
        } else if (msg.type === "type") {
          sendToPython({ action: "type", text: msg.text });
        } else if (msg.type === "volume") {
          sendToPython({ action: "volume", vol_action: msg.vol_action });
        } else if (msg.type === "media") {
          sendToPython({ action: "media", media_action: msg.media_action });
        } else if (msg.type === "open") {
          sendToPython({ action: "open", url: msg.url });
        } else if (msg.type === "power") {
          sendToPython({ action: "power", power_action: msg.power_action });
        }

        // Smart TV Commands
        else if (msg.type === "tv_connect") {
          if (msg.tvType === "googletv") {
            startGoogleTvPairing(
              msg.ip,
              () => {
                ws.send(JSON.stringify({ type: "tv_needs_code", ip: msg.ip }));
              },
              () => {
                ws.send(JSON.stringify({ type: "tv_status", success: true, message: "Connected & Paired!", ip: msg.ip }));
              },
              (err) => {
                ws.send(JSON.stringify({ type: "tv_status", success: false, message: err?.message || "Pairing failed", ip: msg.ip }));
              }
            );
          } else {
            const res = await connectAdb(msg.ip);
            ws.send(JSON.stringify({ type: "tv_status", ...res, ip: msg.ip }));
          }
        } else if (msg.type === "tv_code") {
          try {
            await sendGoogleTvCode(msg.code);
            ws.send(JSON.stringify({ type: "tv_status", success: true, message: "Code Accepted & Paired!", ip: msg.ip }));
          } catch (e) {
            ws.send(JSON.stringify({ type: "tv_status", success: false, message: e.message, ip: msg.ip }));
          }
        } else if (msg.type === "tv_key") {
          if (msg.tvType === "googletv") {
            await sendGoogleTvKey(msg.key);
          } else if (msg.tvType === "roku") {
            await sendRokuCommand(msg.ip, "key", msg.key);
          } else {
            await sendAdbKey(msg.ip, msg.key);
          }
        } else if (msg.type === "tv_text") {
          await sendAdbText(msg.ip, msg.text);
        } else if (msg.type === "tv_launch") {
          if (msg.tvType === "googletv") {
            await sendGoogleTvApp(msg.app);
          } else if (msg.tvType === "roku") {
            await sendRokuCommand(msg.ip, "launch", msg.app);
          } else {
            await launchAdbApp(msg.ip, msg.app);
          }
        }
      } catch (err) {
        console.error("WS message handling error:", err.message);
      }
    });
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Smart WiFi Remote Server Running!`);
    console.log(`📱 Open on Phone:  ${APP_URL}`);
    console.log(`💻 Local Machine:  http://localhost:${PORT}`);
    console.log(`📡 WiFi IP:        ${LOCAL_IP}`);
    console.log(`======================================================\n`);
  });
}

start().catch((err) => {
  console.error("Server startup error:", err);
  process.exit(1);
});
