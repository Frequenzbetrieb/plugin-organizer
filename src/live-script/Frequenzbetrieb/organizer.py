# Receives load commands from the Plugin Organizer app (UDP on 127.0.0.1) and loads devices through
# Live's own browser API – no typing into the search field, no screen reading.
#
# Request (JSON):  {"id": 1, "cmd": "ping"}
#                  {"id": 2, "cmd": "load", "kind": "plugin|stock|file", "name": "...", "format": "VST3",
#                   "path": "/…/Preset.adg", "newTrack": "midi|audio|"}
# Reply (JSON):    {"id": 2, "ok": true} or {"id": 2, "ok": false, "error": "..."}
import json
import re
import socket

import Live
from _Framework.ControlSurface import ControlSurface

PORT = 47330
VERSION = 1
FORMAT_FOLDERS = {"AU": ("audio units", "au"), "VST": ("vst", "vst2"), "VST3": ("vst3",)}


def norm(s):
    # Same idea as the app: letters/digits only, I/l/1 alike, file extension ignored.
    s = re.sub(r"\.(adg|adv|amxd)$", "", s or "", flags=re.I).lower()
    return re.sub(r"[^a-z0-9]", "", s.replace("l", "i").replace("1", "i"))


class Organizer(ControlSurface):
    def __init__(self, c_instance):
        ControlSurface.__init__(self, c_instance)
        self._plugins = None  # norm(name) → [(item, folder names)]
        self._sock = None
        try:
            self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self._sock.bind(("127.0.0.1", PORT))
            self._sock.setblocking(False)
            self.log_message("Frequenzbetrieb: listening on %d" % PORT)
        except Exception as e:
            self.log_message("Frequenzbetrieb: socket failed: %s" % e)
            self._sock = None

    def disconnect(self):
        if self._sock:
            self._sock.close()
            self._sock = None
        ControlSurface.disconnect(self)

    # Live calls this about every 100 ms on its main thread – the safe place to touch the API.
    def update_display(self):
        ControlSurface.update_display(self)
        if not self._sock:
            return
        for _ in range(10):
            try:
                data, addr = self._sock.recvfrom(65536)
            except (BlockingIOError, socket.error):
                return
            reply = {"ok": False}
            try:
                req = json.loads(data.decode("utf-8"))
                reply["id"] = req.get("id")
                reply.update(self._handle(req))
            except Exception as e:
                reply["error"] = str(e)
            try:
                self._sock.sendto(json.dumps(reply).encode("utf-8"), addr)
            except Exception:
                pass

    def _handle(self, req):
        cmd = req.get("cmd")
        if cmd == "ping":
            return {"ok": True, "version": VERSION}
        if cmd == "reindex":
            self._plugins = None
            return {"ok": True}
        if cmd == "load":
            item = self._find(req)
            if item is None:
                return {"ok": False, "error": "notfound"}
            new_track = req.get("newTrack")
            song = self.song()
            if new_track == "midi":
                song.create_midi_track(-1)
            elif new_track == "audio":
                song.create_audio_track(-1)
            if new_track:
                song.view.selected_track = song.tracks[len(song.tracks) - 1]
            self.application().browser.load_item(item)
            return {"ok": True, "name": item.name}
        return {"ok": False, "error": "unknown command"}

    # ---------- finding the browser item ----------
    def _find(self, req):
        kind = req.get("kind")
        if kind == "plugin":
            return self._find_plugin(req.get("name"), req.get("format"))
        if kind == "stock":
            return self._find_stock(req.get("name"), req.get("type"))
        if kind == "file":
            return self._find_file(req.get("path") or "")
        return None

    def _find_plugin(self, name, fmt):
        key = norm(name)
        if self._plugins is None or key not in self._plugins:
            self._index_plugins()
        hits = self._plugins.get(key) or []
        if not hits:
            return None
        wanted = FORMAT_FOLDERS.get(fmt or "", ())
        for item, folders in hits:
            if any(f.lower() in wanted for f in folders):
                return item
        return hits[0][0]

    def _index_plugins(self):
        index = {}

        def walk(item, folders, depth):
            for child in item.children:
                if child.is_loadable and not child.is_folder:
                    index.setdefault(norm(child.name), []).append((child, folders))
                elif depth < 5:
                    walk(child, folders + [child.name], depth + 1)

        walk(self.application().browser.plugins, [], 0)
        self._plugins = index

    def _find_stock(self, name, type_):
        browser = self.application().browser
        roots = {"Instrument": [browser.instruments], "Effect": [browser.audio_effects], "MIDI FX": [browser.midi_effects]}.get(
            type_, [browser.instruments, browser.audio_effects, browser.midi_effects])
        key = norm(name)
        for root in roots:
            for child in root.children:
                if norm(child.name) == key and child.is_loadable:
                    return child
        return None

    # A preset/rack/Max file: follow its folder path inside the browser (Packs, User Library, Core Library).
    def _find_file(self, path):
        parts = [p for p in re.split(r"[\\/]", path) if p]
        if not parts:
            return None
        browser = self.application().browser
        # Live's own presets live in Core Library/Devices/<Type>/<Device>/… → the device categories.
        if "Core Library" in parts and "Devices" in parts:
            i = parts.index("Devices")
            root = {"Instruments": browser.instruments, "Audio Effects": browser.audio_effects,
                    "MIDI Effects": browser.midi_effects}.get(parts[i + 1] if i + 1 < len(parts) else "")
            if root is not None:
                found = self._follow(root, parts[i + 2:])
                if found is not None:
                    return found
        for root in (browser.packs, browser.user_library, browser.max_for_live, browser.drums, browser.sounds,
                     browser.instruments, browser.audio_effects, browser.midi_effects):
            for start in range(len(parts) - 1):
                child = self._child(root, parts[start])
                if child is not None:
                    found = self._follow(child, parts[start + 1:])
                    if found is not None:
                        return found
        return None

    def _child(self, item, name):
        key = norm(name)
        for c in item.children:
            if norm(c.name) == key:
                return c
        return None

    def _follow(self, item, rest):
        for name in rest:
            item = self._child(item, name)
            if item is None:
                return None
        return item if item.is_loadable else None
