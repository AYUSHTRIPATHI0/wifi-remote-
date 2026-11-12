"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Laptop,
  Tv,
  QrCode,
  Volume2,
  Volume1,
  VolumeX,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Maximize2,
  Power,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Home,
  ArrowLeft,
  Menu,
  RotateCcw,
  Search,
  Copy,
  Check,
  Keyboard,
  Sliders,
  Send,
  Vibrate,
  Radio,
} from "lucide-react";

type RemoteMode = "pc" | "tv" | "settings";
type TvProtocol = "googletv" | "adb" | "roku";

interface ServerInfo {
  localIp: string;
  port: number;
  appUrl: string;
  qrCode: string;
  adbDevices: Array<{ id: string; status: string }>;
  hostname: string;
}

export default function SmartRemote() {
  const [mode, setMode] = useState<RemoteMode>("pc");
  const [connected, setConnected] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [haptics, setHaptics] = useState(true);
  const [sensitivity, setSensitivity] = useState(1.4);
  const [invertScroll, setInvertScroll] = useState(false);

  // PC Remote State
  const [dragLock, setDragLock] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [isPlaying, setIsPlaying] = useState(true);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [showPresentation, setShowPresentation] = useState(false);

  // TV Remote State
  const [tvProtocol, setTvProtocol] = useState<TvProtocol>("googletv");
  const [tvIp, setTvIp] = useState("");
  const [tvConnected, setTvConnected] = useState(false);
  const [tvStatusMsg, setTvStatusMsg] = useState("");
  const [tvSearchText, setTvSearchText] = useState("");
  const [scanningTv, setScanningTv] = useState(false);
  const [scannedDevices, setScannedDevices] = useState<Array<{ ip: string; type: string; protocol?: string; port: number }>>([]);
  const [showNumpad, setShowNumpad] = useState(false);
  const [tvCodeNeeded, setTvCodeNeeded] = useState(false);
  const [tvPairingCode, setTvPairingCode] = useState("");

  const [copied, setCopied] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Touch tracking refs
  const touchStartRef = useRef<{ x: number; y: number; time: number; touches: number }>({
    x: 0,
    y: 0,
    time: 0,
    touches: 0,
  });
  const lastTouchRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const hasMovedRef = useRef<boolean>(false);

  // Vibrate helper
  const vibrate = useCallback(
    (duration: number = 20) => {
      if (haptics && typeof window !== "undefined" && window.navigator && window.navigator.vibrate) {
        try {
          window.navigator.vibrate(duration);
        } catch {
          // ignore
        }
      }
    },
    [haptics]
  );

  // WebSocket Connection
  useEffect(() => {
    // Fetch Server info first
    fetch("/api/info")
      .then((res) => res.json())
      .then((data: ServerInfo) => {
        setServerInfo(data);
        if (data.adbDevices && data.adbDevices.length > 0) {
          const first = data.adbDevices[0].id.replace(":5555", "");
          setTvIp(first);
          setTvConnected(true);
        }
      })
      .catch((e) => console.error("Info fetch failed:", e));

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    let ws: WebSocket;
    let reconnectTimer: NodeJS.Timeout;

    function connectWs() {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        // Start ping for latency measurement
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
          }
        }, 3000);
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === "pong" && data.ts) {
            setLatency(Date.now() - data.ts);
          } else if (data.type === "tv_needs_code") {
            setTvCodeNeeded(true);
            setTvStatusMsg("Please enter the 6-character code shown on your TV screen!");
            vibrate(50);
          } else if (data.type === "tv_status") {
            setTvConnected(data.success);
            setTvStatusMsg(data.message || (data.success ? "Connected" : "Failed"));
            if (data.success) {
              setTvCodeNeeded(false);
              setTvPairingCode("");
            }
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        setConnected(false);
        setLatency(null);
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        reconnectTimer = setTimeout(connectWs, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connectWs();

    return () => {
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const send = useCallback(
    (msg: Record<string, unknown>) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(msg));
      }
    },
    []
  );

  // PC Controller handlers
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    const touches = e.touches.length;
    const t0 = e.touches[0];
    touchStartRef.current = {
      x: t0.clientX,
      y: t0.clientY,
      time: Date.now(),
      touches,
    };
    lastTouchRef.current = { x: t0.clientX, y: t0.clientY };
    hasMovedRef.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      const t = e.touches[0];
      const dx = (t.clientX - lastTouchRef.current.x) * sensitivity;
      const dy = (t.clientY - lastTouchRef.current.y) * sensitivity;

      if (Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4) {
        hasMovedRef.current = true;
        send({ type: "mouse_move", dx, dy });
      }
      lastTouchRef.current = { x: t.clientX, y: t.clientY };
    } else if (e.touches.length === 2) {
      // 2 finger scroll
      const t0 = e.touches[0];
      const dy = (t0.clientY - lastTouchRef.current.y) * (invertScroll ? -1 : 1);
      if (Math.abs(dy) > 4) {
        hasMovedRef.current = true;
        const scrollStep = dy > 0 ? 1 : -1;
        send({ type: "mouse_scroll", dy: scrollStep });
        lastTouchRef.current = { x: t0.clientX, y: t0.clientY };
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    const elapsed = Date.now() - touchStartRef.current.time;
    const initialTouches = touchStartRef.current.touches;

    if (!hasMovedRef.current && elapsed < 260) {
      // Tap detected!
      if (initialTouches === 1) {
        vibrate(25);
        send({ type: "mouse_click", button: 1 });
      } else if (initialTouches === 2) {
        vibrate(35);
        send({ type: "mouse_click", button: 3 });
      }
    }
  };

  // Click buttons
  const clickMouse = (button: number) => {
    vibrate(25);
    send({ type: "mouse_click", button });
  };

  const toggleDragLock = () => {
    vibrate(30);
    const nextState = !dragLock;
    setDragLock(nextState);
    if (nextState) {
      send({ type: "mouse_down", button: 1 });
    } else {
      send({ type: "mouse_up", button: 1 });
    }
  };

  const sendKey = (key: string) => {
    vibrate(18);
    send({ type: "key", key });
  };

  const sendShortcut = (keys: string[]) => {
    vibrate(22);
    send({ type: "shortcut", keys });
  };

  const sendVolume = (vol_action: "up" | "down" | "mute") => {
    vibrate(20);
    send({ type: "volume", vol_action });
  };

  const sendMedia = (media_action: "play_pause" | "next" | "prev") => {
    vibrate(22);
    if (media_action === "play_pause") setIsPlaying(!isPlaying);
    send({ type: "media", media_action });
  };

  const sendTextToPc = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    vibrate(30);
    send({ type: "type", text: textInput });
    setTextInput("");
  };

  // TV Handlers
  const connectTv = (overrideIp?: string, overrideProtocol?: TvProtocol) => {
    const target = overrideIp || tvIp.trim();
    const proto = overrideProtocol || tvProtocol;
    if (!target) return;
    vibrate(25);
    setTvStatusMsg("Connecting & Requesting Pairing...");
    send({ type: "tv_connect", ip: target, tvType: proto });
  };

  const confirmTvCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tvPairingCode.trim()) return;
    vibrate(30);
    setTvStatusMsg("Verifying Code with TV...");
    send({ type: "tv_code", code: tvPairingCode.trim(), ip: tvIp });
  };

  const sendTvKey = (key: string) => {
    vibrate(22);
    send({ type: "tv_key", tvType: tvProtocol, ip: tvIp, key });
  };

  const sendTvApp = (app: string) => {
    vibrate(35);
    send({ type: "tv_launch", tvType: tvProtocol, ip: tvIp, app });
  };

  const sendTvSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tvSearchText.trim()) return;
    vibrate(25);
    send({ type: "tv_text", ip: tvIp, text: tvSearchText });
    setTvSearchText("");
  };

  const scanTvDevices = async () => {
    setScanningTv(true);
    vibrate(25);
    try {
      const res = await fetch("/api/scan-tv");
      const data = await res.json();
      if (data.devices) {
        setScannedDevices(data.devices);
      }
    } catch (e) {
      console.error("Scan error:", e);
    } finally {
      setScanningTv(false);
    }
  };

  const copyUrl = () => {
    if (serverInfo?.appUrl) {
      navigator.clipboard.writeText(serverInfo.appUrl);
      setCopied(true);
      vibrate(20);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex flex-col min-h-screen max-w-md mx-auto bg-[#090d16] select-none text-slate-100">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-40 px-4 py-3 bg-[#0d1322]/90 backdrop-blur-md border-b border-slate-800/80 flex items-center justify-between shadow-lg">
        <div className="flex items-center space-x-2.5">
          <div className="relative">
            <div
              className={`w-3 h-3 rounded-full ${
                connected ? "bg-emerald-400 shadow-[0_0_10px_#34d399]" : "bg-rose-500 shadow-[0_0_10px_#f43f5e]"
              }`}
            />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-bold tracking-wider text-slate-100 flex items-center gap-1.5">
                SMART REMOTE
                <span className="text-[10px] uppercase px-1.5 py-0.5 rounded font-mono bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                  WiFi
                </span>
              </h1>
            </div>
            <p className="text-[10px] text-slate-400 font-mono flex items-center gap-1.5">
              {connected ? (
                <>
                  <span className="text-emerald-400">Online</span>
                  {latency !== null && ` • ${latency}ms`}
                </>
              ) : (
                <span className="text-rose-400">Connecting...</span>
              )}
              <span className="text-slate-500">•</span>
              <span className="text-slate-400">by Ayush Tripathi</span>
            </p>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center space-x-1.5">
          <button
            onClick={() => {
              vibrate(20);
              setHaptics(!haptics);
            }}
            title="Toggle Haptic Feedback"
            className={`p-2 rounded-xl transition border ${
              haptics
                ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/30"
                : "bg-slate-800/50 text-slate-500 border-slate-700/50"
            }`}
          >
            <Vibrate className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              vibrate(20);
              setMode(mode === "settings" ? "pc" : "settings");
            }}
            title="QR Code & Settings"
            className={`p-2 rounded-xl transition border ${
              mode === "settings"
                ? "bg-purple-500/20 text-purple-300 border-purple-500/40"
                : "bg-slate-800/50 text-slate-400 border-slate-700/50 hover:text-slate-200"
            }`}
          >
            <QrCode className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Mode Switcher Nav */}
      <nav className="p-2.5 bg-[#0b101d] border-b border-slate-800/60">
        <div className="grid grid-cols-2 gap-2 bg-slate-900/90 p-1 rounded-2xl border border-slate-800/80">
          <button
            onClick={() => {
              vibrate(15);
              setMode("pc");
            }}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-xs transition-all ${
              mode === "pc"
                ? "bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg shadow-cyan-600/20 font-bold"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Laptop className="w-4 h-4" />
            PC / Laptop
          </button>
          <button
            onClick={() => {
              vibrate(15);
              setMode("tv");
            }}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-xs transition-all ${
              mode === "tv"
                ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-600/20 font-bold"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Tv className="w-4 h-4" />
            Smart TV
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 p-3.5 space-y-3.5 overflow-y-auto pb-10">
        {/* =================================================================================== */}
        {/* TAB 1: PC / LAPTOP REMOTE */}
        {/* =================================================================================== */}
        {mode === "pc" && (
          <div className="space-y-3.5">
            {/* Trackpad Card */}
            <div className="glass-panel rounded-3xl p-3 border border-slate-700/50 space-y-2">
              <div className="flex items-center justify-between px-1 text-[11px] text-slate-400">
                <span className="font-semibold text-cyan-400 uppercase tracking-wider flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                  Touchpad
                </span>
                <span className="text-[10px] text-slate-500">1-Finger: Move/Tap | 2-Finger: Scroll/Right-Click</span>
              </div>

              {/* Physical Touch Area */}
              <div
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                className={`trackpad-surface w-full h-64 rounded-2xl relative flex flex-col items-center justify-center cursor-crosshair border select-none transition-all ${
                  dragLock ? "border-amber-500/80 shadow-[0_0_15px_rgba(245,158,11,0.25)]" : "border-slate-700/50"
                }`}
              >
                {dragLock && (
                  <div className="absolute top-3 left-3 bg-amber-500/20 text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-500/40">
                    DRAG LOCK ON
                  </div>
                )}
                <div className="text-center pointer-events-none opacity-30 flex flex-col items-center gap-1">
                  <div className="w-10 h-10 rounded-full border border-slate-500/40 flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-cyan-400" />
                  </div>
                  <span className="text-xs font-mono tracking-wider">SWIPE & TAP</span>
                </div>
              </div>

              {/* Touchpad Buttons (Left, Middle, Drag, Right) */}
              <div className="grid grid-cols-4 gap-2 pt-1">
                <button
                  onClick={() => clickMouse(1)}
                  className="remote-btn col-span-2 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-cyan-600 text-slate-100 font-bold text-xs border border-slate-700/70"
                >
                  LEFT CLICK
                </button>
                <button
                  onClick={toggleDragLock}
                  className={`remote-btn py-3.5 rounded-xl text-xs font-semibold border transition ${
                    dragLock
                      ? "bg-amber-500 text-slate-950 border-amber-400 font-bold"
                      : "bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-700/70"
                  }`}
                >
                  DRAG
                </button>
                <button
                  onClick={() => clickMouse(3)}
                  className="remote-btn py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-purple-600 text-slate-100 font-bold text-xs border border-slate-700/70"
                >
                  RIGHT
                </button>
              </div>
            </div>

            {/* Media Remote Bar */}
            <div className="glass-panel rounded-3xl p-3 border border-slate-700/50 space-y-2.5">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1">
                Media & Volume
              </div>
              <div className="grid grid-cols-6 gap-2">
                <button
                  onClick={() => sendVolume("down")}
                  className="remote-btn p-3 rounded-2xl bg-slate-800/90 text-slate-200 hover:bg-slate-700 flex items-center justify-center border border-slate-700"
                  title="Volume Down"
                >
                  <Volume1 className="w-5 h-5 text-cyan-400" />
                </button>
                <button
                  onClick={() => sendVolume("mute")}
                  className="remote-btn p-3 rounded-2xl bg-slate-800/90 text-slate-200 hover:bg-slate-700 flex items-center justify-center border border-slate-700"
                  title="Mute Toggle"
                >
                  <VolumeX className="w-5 h-5 text-rose-400" />
                </button>
                <button
                  onClick={() => sendVolume("up")}
                  className="remote-btn p-3 rounded-2xl bg-slate-800/90 text-slate-200 hover:bg-slate-700 flex items-center justify-center border border-slate-700"
                  title="Volume Up"
                >
                  <Volume2 className="w-5 h-5 text-cyan-400" />
                </button>
                <button
                  onClick={() => {
                    sendKey("Left");
                  }}
                  className="remote-btn p-3 rounded-2xl bg-slate-800/90 text-slate-200 hover:bg-slate-700 flex items-center justify-center border border-slate-700"
                  title="Seek -10s"
                >
                  <SkipBack className="w-5 h-5 text-slate-300" />
                </button>
                <button
                  onClick={() => sendMedia("play_pause")}
                  className="remote-btn p-3 rounded-2xl bg-cyan-600 hover:bg-cyan-500 text-white flex items-center justify-center border border-cyan-400 shadow-lg shadow-cyan-600/30"
                  title="Play / Pause"
                >
                  {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                </button>
                <button
                  onClick={() => {
                    sendKey("Right");
                  }}
                  className="remote-btn p-3 rounded-2xl bg-slate-800/90 text-slate-200 hover:bg-slate-700 flex items-center justify-center border border-slate-700"
                  title="Seek +10s"
                >
                  <SkipForward className="w-5 h-5 text-slate-300" />
                </button>
              </div>

              {/* Quick Fullscreen & Esc */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={() => sendKey("f")}
                  className="remote-btn py-2.5 rounded-xl bg-slate-800/80 text-xs font-semibold text-slate-300 hover:text-white flex items-center justify-center gap-1.5 border border-slate-700/60"
                >
                  <Maximize2 className="w-3.5 h-3.5 text-cyan-400" />
                  Fullscreen (F)
                </button>
                <button
                  onClick={() => sendKey("Escape")}
                  className="remote-btn py-2.5 rounded-xl bg-slate-800/80 text-xs font-semibold text-slate-300 hover:text-white flex items-center justify-center gap-1.5 border border-slate-700/60"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
                  Escape (ESC)
                </button>
              </div>
            </div>

            {/* Quick Keyboard Typing Drawer */}
            <div className="glass-panel rounded-3xl p-3 border border-slate-700/50 space-y-2.5">
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Keyboard className="w-3.5 h-3.5 text-purple-400" />
                  Text & Quick Keys
                </span>
                <button
                  onClick={() => setShowKeyboard(!showKeyboard)}
                  className="text-[10px] text-cyan-400 font-medium hover:underline"
                >
                  {showKeyboard ? "Hide Shortcuts" : "Show Shortcuts"}
                </button>
              </div>

              {/* Text Input to PC */}
              <form onSubmit={sendTextToPc} className="flex gap-2">
                <input
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="Type anything on phone to send to PC..."
                  className="flex-1 bg-slate-900/90 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
                <button
                  type="submit"
                  className="remote-btn px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold flex items-center gap-1 border border-cyan-400"
                >
                  <Send className="w-3.5 h-3.5" />
                  Send
                </button>
              </form>

              {/* Quick Keys Rows */}
              {showKeyboard && (
                <div className="space-y-2 pt-1 border-t border-slate-800">
                  <div className="grid grid-cols-4 gap-2">
                    <button
                      onClick={() => sendKey("BackSpace")}
                      className="remote-btn py-2 rounded-xl bg-slate-800 text-xs font-medium text-slate-300 border border-slate-700"
                    >
                      ⌫ Backspace
                    </button>
                    <button
                      onClick={() => sendKey("Tab")}
                      className="remote-btn py-2 rounded-xl bg-slate-800 text-xs font-medium text-slate-300 border border-slate-700"
                    >
                      Tab
                    </button>
                    <button
                      onClick={() => sendKey("Super_L")}
                      className="remote-btn py-2 rounded-xl bg-slate-800 text-xs font-medium text-cyan-400 border border-slate-700"
                    >
                      ⊞ Windows
                    </button>
                    <button
                      onClick={() => sendKey("Return")}
                      className="remote-btn py-2 rounded-xl bg-cyan-700 hover:bg-cyan-600 text-xs font-bold text-white border border-cyan-500"
                    >
                      ↵ Enter
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => sendShortcut(["Control_L", "c"])}
                      className="remote-btn py-2 rounded-xl bg-slate-800 text-xs font-medium text-slate-300 border border-slate-700"
                    >
                      Ctrl + C (Copy)
                    </button>
                    <button
                      onClick={() => sendShortcut(["Control_L", "v"])}
                      className="remote-btn py-2 rounded-xl bg-slate-800 text-xs font-medium text-slate-300 border border-slate-700"
                    >
                      Ctrl + V (Paste)
                    </button>
                    <button
                      onClick={() => sendShortcut(["Alt_L", "Tab"])}
                      className="remote-btn py-2 rounded-xl bg-slate-800 text-xs font-medium text-purple-300 border border-slate-700"
                    >
                      Alt + Tab (Switch)
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Presentation Clicker & App Launcher */}
            <div className="glass-panel rounded-3xl p-3 border border-slate-700/50 space-y-2.5">
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-emerald-400" />
                  Presentation & Launchers
                </span>
                <button
                  onClick={() => setShowPresentation(!showPresentation)}
                  className="text-[10px] text-emerald-400 font-medium hover:underline"
                >
                  {showPresentation ? "Hide PPT Clicker" : "PPT Clicker Mode"}
                </button>
              </div>

              {showPresentation && (
                <div className="grid grid-cols-2 gap-2.5 p-2 bg-slate-900/70 rounded-2xl border border-slate-800">
                  <button
                    onClick={() => sendKey("Page_Up")}
                    className="remote-btn py-6 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm flex flex-col items-center justify-center gap-1 border border-slate-700"
                  >
                    <ChevronLeft className="w-6 h-6 text-emerald-400" />
                    PREVIOUS SLIDE
                  </button>
                  <button
                    onClick={() => sendKey("Page_Down")}
                    className="remote-btn py-6 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex flex-col items-center justify-center gap-1 border border-emerald-400 shadow-lg shadow-emerald-600/30"
                  >
                    <ChevronRight className="w-6 h-6 text-white" />
                    NEXT SLIDE
                  </button>
                  <button
                    onClick={() => sendKey("F5")}
                    className="remote-btn py-2 rounded-xl bg-slate-800 text-xs font-medium text-slate-300 border border-slate-700"
                  >
                    Start Slideshow (F5)
                  </button>
                  <button
                    onClick={() => sendKey("b")}
                    className="remote-btn py-2 rounded-xl bg-slate-800 text-xs font-medium text-slate-300 border border-slate-700"
                  >
                    Black Screen (B)
                  </button>
                </div>
              )}

              {/* App Launchers */}
              <div className="grid grid-cols-4 gap-2 pt-1">
                <button
                  onClick={() => {
                    vibrate(25);
                    send({ type: "open", url: "https://www.youtube.com" });
                  }}
                  className="remote-btn py-2 rounded-xl bg-red-600/20 text-red-400 border border-red-500/30 text-[11px] font-semibold"
                >
                  YouTube
                </button>
                <button
                  onClick={() => {
                    vibrate(25);
                    send({ type: "open", url: "https://www.netflix.com" });
                  }}
                  className="remote-btn py-2 rounded-xl bg-red-800/20 text-red-300 border border-red-700/30 text-[11px] font-semibold"
                >
                  Netflix
                </button>
                <button
                  onClick={() => {
                    vibrate(25);
                    send({ type: "open", url: "https://www.google.com" });
                  }}
                  className="remote-btn py-2 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30 text-[11px] font-semibold"
                >
                  Browser
                </button>
                <button
                  onClick={() => {
                    vibrate(30);
                    send({ type: "power", power_action: "lock" });
                  }}
                  className="remote-btn py-2 rounded-xl bg-slate-800 text-rose-400 border border-slate-700 text-[11px] font-semibold flex items-center justify-center gap-1"
                >
                  <Power className="w-3 h-3" />
                  Lock PC
                </button>
              </div>
            </div>
          </div>
        )}

        {/* =================================================================================== */}
        {/* TAB 2: SMART TV REMOTE */}
        {/* =================================================================================== */}
        {mode === "tv" && (
          <div className="space-y-3.5">
            {/* TV Connection Bar */}
            <div className="glass-panel rounded-3xl p-3 border border-slate-700/50 space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-purple-400 uppercase tracking-wider">TV Setup</span>
                  <div className="flex bg-slate-900 rounded-lg p-0.5 border border-slate-800">
                    <button
                      onClick={() => setTvProtocol("googletv")}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        tvProtocol === "googletv" ? "bg-purple-600 text-white" : "text-slate-400"
                      }`}
                    >
                      PIN Code Pairing
                    </button>
                    <button
                      onClick={() => setTvProtocol("adb")}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        tvProtocol === "adb" ? "bg-purple-600 text-white" : "text-slate-400"
                      }`}
                    >
                      ADB WiFi
                    </button>
                    <button
                      onClick={() => setTvProtocol("roku")}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        tvProtocol === "roku" ? "bg-purple-600 text-white" : "text-slate-400"
                      }`}
                    >
                      Roku
                    </button>
                  </div>
                </div>
                <button
                  onClick={scanTvDevices}
                  disabled={scanningTv}
                  className="text-[10px] text-cyan-400 hover:underline flex items-center gap-1"
                >
                  <Radio className="w-3 h-3" />
                  {scanningTv ? "Scanning..." : "Auto-Detect TV"}
                </button>
              </div>

              {/* IP Input & Connect Button */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tvIp}
                  onChange={(e) => setTvIp(e.target.value)}
                  placeholder="Enter Smart TV IP (e.g. 192.168.1.50)"
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 font-mono focus:outline-none focus:border-purple-500"
                />
                <button
                  onClick={() => connectTv()}
                  className={`remote-btn px-4 py-2 rounded-xl text-xs font-bold border ${
                    tvConnected
                      ? "bg-emerald-600/20 text-emerald-300 border-emerald-500/40"
                      : "bg-purple-600 hover:bg-purple-500 text-white border-purple-400"
                  }`}
                >
                  {tvConnected ? "Connected" : "Pair / Connect"}
                </button>
              </div>

              {/* TV Screen PIN Code Prompt Card */}
              {tvCodeNeeded && (
                <div className="p-3 bg-purple-950/70 border-2 border-purple-500/80 rounded-2xl space-y-2 shadow-lg shadow-purple-600/20 animate-pulse">
                  <div className="flex items-center gap-2 text-purple-300 font-bold text-xs">
                    <span className="w-2.5 h-2.5 rounded-full bg-purple-400 animate-ping" />
                    📺 TV Screen par Code Check Karein!
                  </div>
                  <p className="text-[11px] text-slate-300">
                    Aapke TV par 6-character code (PIN) show ho raha hoga. Wo code yahan enter karke confirm karein:
                  </p>
                  <form onSubmit={confirmTvCode} className="flex gap-2">
                    <input
                      type="text"
                      value={tvPairingCode}
                      onChange={(e) => setTvPairingCode(e.target.value.toUpperCase())}
                      placeholder="e.g. 4A8B9C"
                      maxLength={8}
                      className="flex-1 bg-slate-900 border border-purple-400 rounded-xl px-3 py-2 text-sm font-mono tracking-widest text-center text-white uppercase focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="remote-btn px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold text-xs rounded-xl border border-purple-300 shadow-md"
                    >
                      Confirm PIN
                    </button>
                  </form>
                </div>
              )}

              {tvStatusMsg && (
                <p className="text-[10px] text-slate-400 px-1 truncate font-mono">Status: {tvStatusMsg}</p>
              )}

              {/* Detected Devices List */}
              {scannedDevices.length > 0 && (
                <div className="p-2 bg-slate-900/90 rounded-xl border border-slate-800 space-y-1">
                  <span className="text-[10px] text-slate-400 font-medium">Discovered TVs on WiFi:</span>
                  {scannedDevices.map((d, i) => (
                    <div
                      key={i}
                      onClick={() => {
                        setTvIp(d.ip);
                        const proto = (d.protocol as TvProtocol) || "googletv";
                        setTvProtocol(proto);
                        connectTv(d.ip, proto);
                      }}
                      className="flex items-center justify-between p-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700 cursor-pointer text-xs"
                    >
                      <span className="font-mono text-cyan-300">{d.ip}</span>
                      <span className="text-[10px] text-purple-300 font-semibold">{d.type}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Smart TV Remote Body */}
            <div className="glass-panel rounded-3xl p-4 border border-slate-700/50 space-y-4">
              {/* Top Remote Row: Power, Mute, Menu */}
              <div className="flex items-center justify-between px-2">
                <button
                  onClick={() => sendTvKey("power")}
                  className="remote-btn w-12 h-12 rounded-2xl bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white flex items-center justify-center border border-rose-500/30"
                  title="Power"
                >
                  <Power className="w-5 h-5" />
                </button>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowNumpad(!showNumpad)}
                    className="remote-btn px-3 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-700"
                  >
                    123
                  </button>
                  <button
                    onClick={() => sendTvKey("menu")}
                    className="remote-btn w-12 h-12 rounded-2xl bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center border border-slate-700"
                    title="Menu"
                  >
                    <Menu className="w-5 h-5" />
                  </button>
                </div>

                <button
                  onClick={() => sendTvKey("mute")}
                  className="remote-btn w-12 h-12 rounded-2xl bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center border border-slate-700"
                  title="Mute"
                >
                  <VolumeX className="w-5 h-5" />
                </button>
              </div>

              {/* Number Pad Drawer */}
              {showNumpad && (
                <div className="grid grid-cols-3 gap-2 p-3 bg-slate-900/80 rounded-2xl border border-slate-800">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "backspace"].map((num, i) =>
                    num ? (
                      <button
                        key={i}
                        onClick={() => sendTvKey(num)}
                        className="remote-btn py-2.5 rounded-xl bg-slate-800 text-slate-200 font-bold text-sm border border-slate-700"
                      >
                        {num === "backspace" ? "⌫" : num}
                      </button>
                    ) : (
                      <div key={i} />
                    )
                  )}
                </div>
              )}

              {/* Circular D-Pad Controller */}
              <div className="flex justify-center py-2">
                <div className="relative w-64 h-64 rounded-full bg-gradient-to-b from-slate-800 to-slate-900 border-2 border-slate-700/80 p-2 shadow-2xl flex items-center justify-center">
                  {/* UP */}
                  <button
                    onClick={() => sendTvKey("up")}
                    className="remote-btn absolute top-2 left-1/2 -translate-x-1/2 w-20 h-16 rounded-t-full bg-slate-800/80 hover:bg-purple-600/40 active:bg-purple-600 text-slate-300 flex items-center justify-center pt-2 border-t border-slate-600"
                    title="Up"
                  >
                    <ChevronUp className="w-7 h-7" />
                  </button>

                  {/* DOWN */}
                  <button
                    onClick={() => sendTvKey("down")}
                    className="remote-btn absolute bottom-2 left-1/2 -translate-x-1/2 w-20 h-16 rounded-b-full bg-slate-800/80 hover:bg-purple-600/40 active:bg-purple-600 text-slate-300 flex items-center justify-center pb-2 border-b border-slate-600"
                    title="Down"
                  >
                    <ChevronDown className="w-7 h-7" />
                  </button>

                  {/* LEFT */}
                  <button
                    onClick={() => sendTvKey("left")}
                    className="remote-btn absolute left-2 top-1/2 -translate-y-1/2 w-16 h-20 rounded-l-full bg-slate-800/80 hover:bg-purple-600/40 active:bg-purple-600 text-slate-300 flex items-center justify-center pl-2 border-l border-slate-600"
                    title="Left"
                  >
                    <ChevronLeft className="w-7 h-7" />
                  </button>

                  {/* RIGHT */}
                  <button
                    onClick={() => sendTvKey("right")}
                    className="remote-btn absolute right-2 top-1/2 -translate-y-1/2 w-16 h-20 rounded-r-full bg-slate-800/80 hover:bg-purple-600/40 active:bg-purple-600 text-slate-300 flex items-center justify-center pr-2 border-r border-slate-600"
                    title="Right"
                  >
                    <ChevronRight className="w-7 h-7" />
                  </button>

                  {/* CENTER OK BUTTON */}
                  <button
                    onClick={() => sendTvKey("ok")}
                    className="remote-btn w-20 h-20 rounded-full bg-gradient-to-tr from-purple-600 to-indigo-500 hover:from-purple-500 hover:to-indigo-400 active:scale-95 text-white font-bold text-base flex items-center justify-center shadow-lg shadow-purple-600/40 border border-purple-300/40 z-10"
                    title="Select / OK"
                  >
                    OK
                  </button>
                </div>
              </div>

              {/* Navigation Cluster: Back, Home, Exit */}
              <div className="grid grid-cols-3 gap-3 px-2">
                <button
                  onClick={() => sendTvKey("back")}
                  className="remote-btn py-3 rounded-2xl bg-slate-800/90 text-slate-200 hover:bg-slate-700 flex flex-col items-center justify-center gap-1 border border-slate-700"
                >
                  <ArrowLeft className="w-5 h-5 text-purple-400" />
                  <span className="text-[10px] font-semibold">BACK</span>
                </button>
                <button
                  onClick={() => sendTvKey("home")}
                  className="remote-btn py-3 rounded-2xl bg-slate-800/90 text-slate-200 hover:bg-slate-700 flex flex-col items-center justify-center gap-1 border border-slate-700"
                >
                  <Home className="w-5 h-5 text-cyan-400" />
                  <span className="text-[10px] font-semibold">HOME</span>
                </button>
                <button
                  onClick={() => sendTvKey("play_pause")}
                  className="remote-btn py-3 rounded-2xl bg-slate-800/90 text-slate-200 hover:bg-slate-700 flex flex-col items-center justify-center gap-1 border border-slate-700"
                >
                  <Play className="w-5 h-5 text-emerald-400" />
                  <span className="text-[10px] font-semibold">PLAY/PAUSE</span>
                </button>
              </div>

              {/* Volume Rockers & Channels */}
              <div className="grid grid-cols-2 gap-3 px-2">
                {/* Volume Rocker */}
                <div className="flex flex-col bg-slate-800/80 rounded-2xl border border-slate-700 overflow-hidden">
                  <button
                    onClick={() => sendTvKey("volume_up")}
                    className="remote-btn py-3 flex items-center justify-center hover:bg-slate-700 text-slate-200 border-b border-slate-700/60"
                  >
                    <ChevronUp className="w-5 h-5 text-cyan-400" />
                  </button>
                  <div className="py-1 text-center text-[10px] font-bold text-slate-400 tracking-wider">VOL</div>
                  <button
                    onClick={() => sendTvKey("volume_down")}
                    className="remote-btn py-3 flex items-center justify-center hover:bg-slate-700 text-slate-200 border-t border-slate-700/60"
                  >
                    <ChevronDown className="w-5 h-5 text-cyan-400" />
                  </button>
                </div>

                {/* Channel Rocker */}
                <div className="flex flex-col bg-slate-800/80 rounded-2xl border border-slate-700 overflow-hidden">
                  <button
                    onClick={() => sendTvKey("channel_up")}
                    className="remote-btn py-3 flex items-center justify-center hover:bg-slate-700 text-slate-200 border-b border-slate-700/60"
                  >
                    <ChevronUp className="w-5 h-5 text-purple-400" />
                  </button>
                  <div className="py-1 text-center text-[10px] font-bold text-slate-400 tracking-wider">CH</div>
                  <button
                    onClick={() => sendTvKey("channel_down")}
                    className="remote-btn py-3 flex items-center justify-center hover:bg-slate-700 text-slate-200 border-t border-slate-700/60"
                  >
                    <ChevronDown className="w-5 h-5 text-purple-400" />
                  </button>
                </div>
              </div>

              {/* Quick Streaming Apps Row */}
              <div className="space-y-1.5 pt-1">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-1">
                  Direct App Launch
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <button
                    onClick={() => sendTvApp("youtube")}
                    className="remote-btn py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-[11px] shadow-lg shadow-red-600/20"
                  >
                    YouTube
                  </button>
                  <button
                    onClick={() => sendTvApp("netflix")}
                    className="remote-btn py-2.5 rounded-xl bg-slate-900 hover:bg-black text-red-500 font-bold text-[11px] border border-red-900/60"
                  >
                    Netflix
                  </button>
                  <button
                    onClick={() => sendTvApp("prime")}
                    className="remote-btn py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-[11px] shadow-lg shadow-blue-600/20"
                  >
                    Prime
                  </button>
                  <button
                    onClick={() => sendTvApp("spotify")}
                    className="remote-btn py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] shadow-lg shadow-emerald-600/20"
                  >
                    Spotify
                  </button>
                </div>
              </div>

              {/* TV Text Search Injection */}
              <form onSubmit={sendTvSearch} className="flex gap-2 pt-1">
                <input
                  type="text"
                  value={tvSearchText}
                  onChange={(e) => setTvSearchText(e.target.value)}
                  placeholder="Type text to search on TV..."
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500"
                />
                <button
                  type="submit"
                  className="remote-btn px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold border border-purple-400"
                >
                  <Search className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </div>
        )}

        {/* =================================================================================== */}
        {/* TAB 3: SETTINGS & QR PAIRING */}
        {/* =================================================================================== */}
        {mode === "settings" && (
          <div className="space-y-3.5">
            {/* QR Code Card */}
            <div className="glass-panel rounded-3xl p-5 border border-slate-700/50 flex flex-col items-center text-center space-y-4">
              <div className="space-y-1">
                <h3 className="font-bold text-base text-slate-100">Scan to Open on Phone</h3>
                <p className="text-xs text-slate-400 max-w-xs">
                  Scan this QR code with any smartphone camera connected to the same WiFi.
                </p>
              </div>

              {/* QR Code Container */}
              {serverInfo?.qrCode ? (
                <div className="p-3 bg-[#090d16] rounded-2xl border-2 border-cyan-500/40 shadow-[0_0_30px_rgba(6,182,212,0.2)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={serverInfo.qrCode} alt="Remote QR Code" className="w-56 h-56 rounded-lg" />
                </div>
              ) : (
                <div className="w-56 h-56 rounded-2xl bg-slate-900 flex items-center justify-center text-xs text-slate-500 border border-slate-800">
                  Loading QR Code...
                </div>
              )}

              {/* Direct Link & Copy */}
              <div className="w-full space-y-2">
                <div className="flex items-center gap-2 p-2 bg-slate-900 rounded-xl border border-slate-800">
                  <span className="flex-1 font-mono text-xs text-cyan-300 truncate text-left px-2">
                    {serverInfo?.appUrl || "Loading..."}
                  </span>
                  <button
                    onClick={copyUrl}
                    className="remote-btn px-3 py-1.5 rounded-lg bg-cyan-600 text-white text-xs font-semibold flex items-center gap-1"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="text-[10px] text-slate-500">
                  Open this link in Chrome or Safari on your phone. Tap &ldquo;Add to Home Screen&rdquo; to use as a native app!
                </p>
              </div>
            </div>

            {/* Remote Sensitivity & Settings */}
            <div className="glass-panel rounded-3xl p-4 border border-slate-700/50 space-y-4">
              <h4 className="font-semibold text-xs text-slate-300 uppercase tracking-wider">
                Touchpad & Control Preferences
              </h4>

              {/* Sensitivity Slider */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Touchpad Sensitivity</span>
                  <span className="font-mono text-cyan-400">{sensitivity.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.6"
                  max="3.0"
                  step="0.2"
                  value={sensitivity}
                  onChange={(e) => setSensitivity(parseFloat(e.target.value))}
                  className="w-full accent-cyan-500 cursor-pointer"
                />
              </div>

              {/* Invert Scroll */}
              <div className="flex items-center justify-between pt-1">
                <div>
                  <div className="text-xs font-medium text-slate-200">Invert 2-Finger Scroll</div>
                  <div className="text-[10px] text-slate-400">Natural vs traditional scroll direction</div>
                </div>
                <button
                  onClick={() => setInvertScroll(!invertScroll)}
                  className={`w-11 h-6 rounded-full transition-colors relative ${
                    invertScroll ? "bg-cyan-500" : "bg-slate-700"
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
                      invertScroll ? "left-6" : "left-1"
                    }`}
                  />
                </button>
              </div>

              {/* Haptic Vibration */}
              <div className="flex items-center justify-between pt-1">
                <div>
                  <div className="text-xs font-medium text-slate-200">Haptic Feedback</div>
                  <div className="text-[10px] text-slate-400">Vibration on button tap & clicks</div>
                </div>
                <button
                  onClick={() => setHaptics(!haptics)}
                  className={`w-11 h-6 rounded-full transition-colors relative ${
                    haptics ? "bg-cyan-500" : "bg-slate-700"
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
                      haptics ? "left-6" : "left-1"
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Firewall & Troubleshooting */}
            <div className="glass-panel rounded-3xl p-4 border border-amber-500/30 bg-amber-500/5 space-y-2.5">
              <h4 className="font-semibold text-xs text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                Firewall / Connection Notice
              </h4>
              <p className="text-xs text-slate-300 leading-relaxed">
                Agar phone par page load nahi ho raha hai (Linux UFW firewall port 3000 block kar raha ho):
              </p>
              <div className="p-2 rounded-xl bg-slate-900 border border-slate-800 font-mono text-[11px] text-cyan-300 select-all">
                sudo ufw allow 3000/tcp
              </div>
              <p className="text-[10px] text-slate-400">
                Apne computer terminal me upar di hui command run karein aur password enter karein.
              </p>
            </div>

            {/* Developer & Creator Profile */}
            <div className="glass-panel rounded-3xl p-4 border border-cyan-500/30 bg-gradient-to-br from-cyan-950/20 to-purple-950/20 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-cyan-500 to-purple-600 flex items-center justify-center font-bold text-white text-xs shadow-md">
                    AT
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                      Ayush Tripathi
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-mono">Creator</span>
                    </h4>
                    <p className="text-[10px] text-cyan-400 font-mono">Founder, Sitekraft.dev</p>
                  </div>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-mono">v1.2.0</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Engineered by <strong>Ayush Tripathi</strong>. High-performance, zero-hardware smart remote for modern connected homes.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <a
                  href="https://github.com/AYUSHTRIPATHI0"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-1.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium text-center border border-slate-700 transition"
                >
                  GitHub: @AYUSHTRIPATHI0
                </a>
                <a
                  href="https://sitekraft.dev"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-1.5 px-3 rounded-xl bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 text-[11px] font-medium text-center border border-cyan-500/40 transition"
                >
                  Sitekraft.dev
                </a>
              </div>
            </div>

            {/* Setup Guides */}
            <div className="glass-panel rounded-3xl p-4 border border-slate-700/50 space-y-3">
              <h4 className="font-semibold text-xs text-slate-300 uppercase tracking-wider">
                How to Connect to Smart TV (Android TV / Firestick)
              </h4>
              <ol className="text-xs text-slate-400 space-y-2 list-decimal list-inside leading-relaxed">
                <li>
                  On your TV, open <strong className="text-slate-200">Settings → Device Preferences → About</strong>.
                </li>
                <li>
                  Click <strong className="text-slate-200">Build Number 7 times</strong> to unlock Developer Options.
                </li>
                <li>
                  Go to <strong className="text-slate-200">Developer Options</strong> and enable{" "}
                  <strong className="text-slate-200">Network Debugging</strong> (or USB Debugging).
                </li>
                <li>
                  Note down your TV&apos;s IP address from WiFi Settings (e.g. 192.168.1.15).
                </li>
                <li>
                  Enter it in the <strong className="text-purple-400">Smart TV tab</strong> and tap{" "}
                  <strong className="text-purple-400">Connect</strong>!
                </li>
              </ol>
            </div>
          </div>
        )}
      </main>

      {/* Bottom Sticky Mode Navigation Bar for ergonomic mobile thumb usage */}
      <footer className="sticky bottom-0 z-40 bg-[#090d16]/95 backdrop-blur-lg border-t border-slate-800/80 px-6 py-2.5 flex items-center justify-around shadow-2xl">
        <button
          onClick={() => {
            vibrate(15);
            setMode("pc");
          }}
          className={`flex flex-col items-center gap-1 transition ${
            mode === "pc" ? "text-cyan-400 scale-105 font-bold" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Laptop className="w-5 h-5" />
          <span className="text-[10px]">PC Remote</span>
        </button>

        <button
          onClick={() => {
            vibrate(15);
            setMode("tv");
          }}
          className={`flex flex-col items-center gap-1 transition ${
            mode === "tv" ? "text-purple-400 scale-105 font-bold" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Tv className="w-5 h-5" />
          <span className="text-[10px]">Smart TV</span>
        </button>

        <button
          onClick={() => {
            vibrate(15);
            setMode("settings");
          }}
          className={`flex flex-col items-center gap-1 transition ${
            mode === "settings" ? "text-emerald-400 scale-105 font-bold" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <QrCode className="w-5 h-5" />
          <span className="text-[10px]">QR & Pair</span>
        </button>
      </footer>
    </div>
  );
}
