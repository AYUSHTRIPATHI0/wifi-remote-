import sys
import json
import ctypes
import subprocess
import time
import os

try:
    x11 = ctypes.cdll.LoadLibrary("libX11.so.6")
    xtst = ctypes.cdll.LoadLibrary("libXtst.so.6")
    disp = x11.XOpenDisplay(None)
except Exception as e:
    disp = None
    sys.stderr.write(f"Warning: Could not open X11 display: {e}\n")

# Common key mapping to X11 keysym string
KEY_MAP = {
    "enter": b"Return",
    "return": b"Return",
    "backspace": b"BackSpace",
    "escape": b"Escape",
    "esc": b"Escape",
    "tab": b"Tab",
    "space": b"space",
    "up": b"Up",
    "down": b"Down",
    "left": b"Left",
    "right": b"Right",
    "f5": b"F5",
    "f11": b"F11",
    "pageup": b"Page_Up",
    "pagedown": b"Page_Down",
    "home": b"Home",
    "end": b"End",
    "super": b"Super_L",
    "win": b"Super_L",
    "alt": b"Alt_L",
    "ctrl": b"Control_L",
    "shift": b"Shift_L",
    "volup": b"XF86AudioRaiseVolume",
    "voldown": b"XF86AudioLowerVolume",
    "mute": b"XF86AudioMute",
    "play": b"XF86AudioPlay",
    "next": b"XF86AudioNext",
    "prev": b"XF86AudioPrev",
}

def send_key(keysym_bytes, press=True, release=True):
    if not disp:
        return
    keysym = x11.XStringToKeysym(keysym_bytes)
    if keysym == 0:
        return
    keycode = x11.XKeysymToKeycode(disp, keysym)
    if keycode == 0:
        return
    if press:
        xtst.XTestFakeKeyEvent(disp, keycode, True, 0)
    if release:
        xtst.XTestFakeKeyEvent(disp, keycode, False, 0)
    x11.XFlush(disp)

def send_shortcut(keys):
    if not disp or not keys:
        return
    keycodes = []
    for k in keys:
        k_bytes = KEY_MAP.get(k.lower(), k.encode("utf-8"))
        keysym = x11.XStringToKeysym(k_bytes)
        kc = x11.XKeysymToKeycode(disp, keysym)
        if kc != 0:
            keycodes.append(kc)
    
    # Press all
    for kc in keycodes:
        xtst.XTestFakeKeyEvent(disp, kc, True, 0)
    x11.XFlush(disp)
    time.sleep(0.02)
    # Release in reverse
    for kc in reversed(keycodes):
        xtst.XTestFakeKeyEvent(disp, kc, False, 0)
    x11.XFlush(disp)

def type_string(text):
    if not disp or not text:
        return
    for ch in text:
        if ch == "\n":
            send_key(b"Return")
            continue
        if ch == " ":
            send_key(b"space")
            continue
        
        # Check if uppercase or requires shift
        ord_val = ord(ch)
        if 32 <= ord_val <= 126:
            keysym = x11.XStringToKeysym(ch.encode("utf-8"))
            if keysym != 0:
                kc = x11.XKeysymToKeycode(disp, keysym)
                if kc != 0:
                    # Check if shift needed
                    needs_shift = ch.isupper() or ch in '~!@#$%^&*()_+{}|:"<>?'
                    if needs_shift:
                        shift_kc = x11.XKeysymToKeycode(disp, x11.XStringToKeysym(b"Shift_L"))
                        xtst.XTestFakeKeyEvent(disp, shift_kc, True, 0)
                    xtst.XTestFakeKeyEvent(disp, kc, True, 0)
                    xtst.XTestFakeKeyEvent(disp, kc, False, 0)
                    if needs_shift:
                        xtst.XTestFakeKeyEvent(disp, shift_kc, False, 0)
                    x11.XFlush(disp)
                    time.sleep(0.005)

def handle_volume(action):
    if action == "up":
        subprocess.run(["pactl", "set-sink-volume", "@DEFAULT_SINK@", "+5%"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    elif action == "down":
        subprocess.run(["pactl", "set-sink-volume", "@DEFAULT_SINK@", "-5%"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    elif action == "mute":
        subprocess.run(["pactl", "set-sink-mute", "@DEFAULT_SINK@", "toggle"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def handle_power(action):
    if action == "lock":
        subprocess.run(["loginctl", "lock-session"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    elif action == "sleep":
        subprocess.run(["systemctl", "suspend"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def main():
    sys.stdout.write("READY\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
            action = cmd.get("action")

            if action == "mouse_move":
                dx = int(round(cmd.get("dx", 0)))
                dy = int(round(cmd.get("dy", 0)))
                if disp and (dx != 0 or dy != 0):
                    xtst.XTestFakeRelativeMotionEvent(disp, dx, dy, 0)
                    x11.XFlush(disp)

            elif action == "mouse_click":
                btn = int(cmd.get("button", 1)) # 1=left, 2=middle, 3=right
                if disp:
                    xtst.XTestFakeButtonEvent(disp, btn, True, 0)
                    xtst.XTestFakeButtonEvent(disp, btn, False, 0)
                    x11.XFlush(disp)

            elif action == "mouse_down":
                btn = int(cmd.get("button", 1))
                if disp:
                    xtst.XTestFakeButtonEvent(disp, btn, True, 0)
                    x11.XFlush(disp)

            elif action == "mouse_up":
                btn = int(cmd.get("button", 1))
                if disp:
                    xtst.XTestFakeButtonEvent(disp, btn, False, 0)
                    x11.XFlush(disp)

            elif action == "mouse_scroll":
                dy = int(cmd.get("dy", 0))
                if disp and dy != 0:
                    btn = 4 if dy > 0 else 5 # 4=scroll up, 5=scroll down
                    count = min(abs(dy), 10)
                    for _ in range(count):
                        xtst.XTestFakeButtonEvent(disp, btn, True, 0)
                        xtst.XTestFakeButtonEvent(disp, btn, False, 0)
                    x11.XFlush(disp)

            elif action == "key":
                k = cmd.get("key", "")
                k_bytes = KEY_MAP.get(k.lower(), k.encode("utf-8"))
                send_key(k_bytes)

            elif action == "shortcut":
                keys = cmd.get("keys", [])
                send_shortcut(keys)

            elif action == "type":
                text = cmd.get("text", "")
                type_string(text)

            elif action == "volume":
                handle_volume(cmd.get("vol_action", ""))

            elif action == "media":
                m = cmd.get("media_action", "")
                if m == "play_pause":
                    send_key(b"XF86AudioPlay")
                elif m == "next":
                    send_key(b"XF86AudioNext")
                elif m == "prev":
                    send_key(b"XF86AudioPrev")

            elif action == "open":
                url = cmd.get("url", "")
                if url:
                    subprocess.Popen(["xdg-open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            elif action == "power":
                handle_power(cmd.get("power_action", ""))

        except Exception as err:
            sys.stderr.write(f"Error handling cmd: {err}\n")

if __name__ == "__main__":
    main()
