// Finds and photographs Ableton Live's windows (needs the Screen Recording permission).
//   livecapture access                 → {"granted": bool}  (asks macOS for permission if missing)
//   livecapture windows                → [{"id","title","x","y","w","h"}] of on-screen Live windows
//   livecapture capture <id> <out>     → PNG of one window
//   livecapture diffbox <a> <b>        → box of the new device in Live's device view (changed region)
//   livecapture crop <img> x y w h <out>
//   livecapture click <x> <y>          → clicks at screen coordinates (points)
import AppKit
import CoreGraphics
import Vision

typealias CaptureFn = @convention(c) (CGRect, UInt32, UInt32, UInt32) -> Unmanaged<CGImage>?
let captureImage: CaptureFn? = {
    guard let h = dlopen(nil, RTLD_NOW), let s = dlsym(h, "CGWindowListCreateImage") else { return nil }
    return unsafeBitCast(s, to: CaptureFn.self)
}()

func printJSON(_ obj: Any) {
    let data = try! JSONSerialization.data(withJSONObject: obj)
    FileHandle.standardOutput.write(data + "\n".data(using: .utf8)!)
}

func savePNG(_ img: CGImage, _ path: String) -> Bool {
    let rep = NSBitmapImageRep(cgImage: img)
    guard let data = rep.representation(using: .png, properties: [:]) else { return false }
    return (try? data.write(to: URL(fileURLWithPath: path))) != nil
}

func loadImage(_ path: String) -> CGImage? {
    guard let img = NSImage(contentsOfFile: path) else { return nil }
    return img.cgImage(forProposedRect: nil, context: nil, hints: nil)
}

func liveWindows() -> [[String: Any]] {
    let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { return [] }
    return list.compactMap { w in
        guard (w[kCGWindowOwnerName as String] as? String) == "Live",
              (w[kCGWindowLayer as String] as? Int) == 0,
              let b = w[kCGWindowBounds as String] as? [String: CGFloat],
              let id = w[kCGWindowNumber as String] as? Int else { return nil }
        return ["id": id, "title": (w[kCGWindowName as String] as? String) ?? "",
                "x": b["X"] ?? 0, "y": b["Y"] ?? 0, "w": b["Width"] ?? 0, "h": b["Height"] ?? 0]
    }
}

// RGBA pixels of an image at its native size.
func pixels(_ img: CGImage) -> [UInt8] {
    var buf = [UInt8](repeating: 0, count: img.width * img.height * 4)
    let ctx = CGContext(data: &buf, width: img.width, height: img.height, bitsPerComponent: 8, bytesPerRow: img.width * 4,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: img.width, height: img.height))
    return buf
}

// Finds the new device: the biggest connected changed region near the bottom of Live's window
// (the device view). Scattered changes elsewhere (meters, browser list, status bar) are ignored.
func diffBox(_ a: CGImage, _ b: CGImage) -> CGRect? {
    guard a.width == b.width, a.height == b.height else { return nil }
    let pa = pixels(a), pb = pixels(b)
    let w = a.width, h = a.height
    let cell = 8
    let gw = w / cell, gh = h / cell
    let statusBar = h * 18 / 1000 + 2 // Live's status line at the very bottom
    // Top edge of the device view: the lowest full-width dark separator line above the status bar.
    var detailTop = h / 2
    for y in stride(from: h - h * 4 / 100, to: h / 2, by: -1) {
        var dark = 0
        for x in stride(from: 0, to: w, by: 4) {
            let i = (y * w + x) * 4
            if Int(pb[i]) + Int(pb[i + 1]) + Int(pb[i + 2]) < 3 * 64 { dark += 1 }
        }
        if dark * 4 > w * 85 / 100 { detailTop = y; break }
    }
    // In the device view, a newly added device changes almost every pixel in its columns,
    // while neighbours only change a little (title bar highlight, meters). Find the widest run of such columns.
    let bottom = h - statusBar
    guard bottom - detailTop > 40 else { return nil }
    var colFrac = [Double](repeating: 0, count: w)
    for x in 0..<w {
        var changed = 0, total = 0
        for y in stride(from: detailTop, to: bottom, by: 2) {
            let i = (y * w + x) * 4
            let d = abs(Int(pa[i]) - Int(pb[i])) + abs(Int(pa[i + 1]) - Int(pb[i + 1])) + abs(Int(pa[i + 2]) - Int(pb[i + 2]))
            if d > 20 { changed += 1 }
            total += 1
        }
        colFrac[x] = Double(changed) / Double(max(1, total))
    }
    var bestRun = (start: 0, end: -1)
    var runStart = -1, gap = 0
    for x in 0...w {
        let hit = x < w && colFrac[x] > 0.25
        if hit {
            if runStart < 0 { runStart = x }
            gap = 0
        } else if runStart >= 0 {
            gap += 1
            // Devices have plain gaps inside (between knobs); allow short ones.
            if gap > 24 || x == w {
                let end = x - gap
                if end - runStart > bestRun.end - bestRun.start { bestRun = (runStart, end) }
                runStart = -1; gap = 0
            }
        }
    }
    guard bestRun.end - bestRun.start > 60 else { return nil }
    // Grow to the device's quieter edges.
    while bestRun.start > 0 && colFrac[bestRun.start - 1] > 0.05 { bestRun.start -= 1 }
    while bestRun.end < w - 1 && colFrac[bestRun.end + 1] > 0.05 { bestRun.end += 1 }
    // Vertical extent: rows in that column run that changed.
    var minY = bottom, maxY = detailTop
    for y in detailTop..<bottom {
        var changed = 0
        for x in stride(from: bestRun.start, through: bestRun.end, by: 3) {
            let i = (y * w + x) * 4
            let d = abs(Int(pa[i]) - Int(pb[i])) + abs(Int(pa[i + 1]) - Int(pb[i + 1])) + abs(Int(pa[i + 2]) - Int(pb[i + 2]))
            if d > 20 { changed += 1 }
        }
        if changed * 3 * 10 > (bestRun.end - bestRun.start) { minY = min(minY, y); maxY = max(maxY, y) }
    }
    guard maxY - minY > 40 else { return nil }
    let pad = 4
    let x0 = max(0, bestRun.start - pad), x1 = min(w - 1, bestRun.end + pad)
    let y0 = max(detailTop, minY - pad), y1 = min(h - 1, maxY + pad)
    return CGRect(x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1)
}

func click(_ x: CGFloat, _ y: CGFloat, count: Int = 1) {
    let p = CGPoint(x: x, y: y)
    let src = CGEventSource(stateID: .hidSystemState)
    CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(80000)
    for n in 1...count {
        let down = CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)
        down?.setIntegerValueField(.mouseEventClickState, value: Int64(n))
        down?.post(tap: .cghidEventTap)
        usleep(30000)
        let up = CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)
        up?.setIntegerValueField(.mouseEventClickState, value: Int64(n))
        up?.post(tap: .cghidEventTap)
        usleep(60000)
    }
}

// Text recognition (Vision) over part of an image; returns lines with their boxes in image pixels (top-left origin).
func recognize(_ img: CGImage, region: CGRect) -> [[String: Any]] {
    guard let crop = img.cropping(to: region) else { return [] }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = false
    try? VNImageRequestHandler(cgImage: crop, options: [:]).perform([req])
    return (req.results ?? []).compactMap { o in
        guard let t = o.topCandidates(1).first?.string else { return nil }
        let b = o.boundingBox
        return ["text": t,
                "x": region.minX + b.minX * region.width, "y": region.minY + (1 - b.maxY) * region.height,
                "w": b.width * region.width, "h": b.height * region.height]
    }
}

// ---------- Live's Edit menu via the Accessibility API (much faster than AppleScript) ----------
func axChildren(_ e: AXUIElement) -> [AXUIElement] {
    var v: CFTypeRef?
    AXUIElementCopyAttributeValue(e, kAXChildrenAttribute as CFString, &v)
    return (v as? [AXUIElement]) ?? []
}
func axTitle(_ e: AXUIElement) -> String {
    var v: CFTypeRef?
    AXUIElementCopyAttributeValue(e, kAXTitleAttribute as CFString, &v)
    return (v as? String) ?? ""
}
// First item of Live's 4th menu bar item (Bearbeiten/Edit): the Undo entry.
func undoItem() -> AXUIElement? {
    guard let live = NSWorkspace.shared.runningApplications.first(where: { $0.localizedName == "Live" }) else { return nil }
    let app = AXUIElementCreateApplication(live.processIdentifier)
    var bar: CFTypeRef?
    AXUIElementCopyAttributeValue(app, kAXMenuBarAttribute as CFString, &bar)
    guard let menuBar = bar else { return nil }
    let items = axChildren(menuBar as! AXUIElement)
    guard items.count > 3, let menu = axChildren(items[3]).first, let first = axChildren(menu).first else { return nil }
    return first
}
func isNothing(_ t: String) -> Bool { t.contains("Nichts") || t.contains("Nothing") }
func isInsert(_ t: String) -> Bool {
    let d = t.decomposedStringWithCanonicalMapping
    return (d.contains("einf") || d.contains("Insert")) && !(d.contains("ndern") || d.contains("nderung") || d.contains("Change"))
}
// Undo the load. Live refreshes the Undo entry's text only ~1 s after each step, so:
// quick mode (stock devices: exactly one "insert" entry) presses once when the top entry is an insertion;
// otherwise undo step by step, waiting for the refreshed text, until we are back at `before`.
func undoLoad(before: String, quick: Bool) -> [String: Any] {
    var steps: [String] = []
    guard var first = undoItem() else { return ["result": "skipped: no menu", "steps": steps] }
    var top = axTitle(first)
    // The entry for our load may not be shown yet (Live refreshes it ~1 s later): wait until it differs from `before`.
    let w0 = Date()
    while (top == before || isNothing(top)) && Date().timeIntervalSince(w0) < 2.0 {
        usleep(50000)
        if let i = undoItem() { first = i; top = axTitle(i) }
    }
    if isNothing(top) { return ["result": "skipped: \(top)", "steps": steps] }
    if quick && isInsert(top) {
        AXUIElementPerformAction(first, kAXPressAction as CFString)
        return ["result": "removed", "steps": [top]]
    }
    var inserts = 0
    var t = top
    // Some Max devices write dozens of parameter changes right after loading.
    for _ in 0..<40 {
        guard let item = undoItem() else { break }
        AXUIElementPerformAction(item, kAXPressAction as CFString)
        steps.append(t)
        if isInsert(t) { inserts += 1 }
        // Wait for the refreshed entry (up to 1.5 s; identical consecutive names just time out).
        let t0 = Date()
        var next = t
        while Date().timeIntervalSince(t0) < 1.5 {
            usleep(40000)
            if let i = undoItem() { next = axTitle(i) }
            if next != t { break }
        }
        t = next
        if inserts > 0 && (t == before || isNothing(t)) { return ["result": "removed", "steps": steps] }
        if isNothing(t) { return ["result": inserts > 0 ? "removed" : "skipped: nothing left", "steps": steps] }
    }
    return ["result": inserts > 0 ? "removed" : "skipped: too many steps", "steps": steps]
}

let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "access":
    var granted = CGPreflightScreenCaptureAccess()
    if !granted { granted = CGRequestScreenCaptureAccess() }
    printJSON(["granted": granted])
case "windows":
    printJSON(liveWindows())
case "capture" where args.count == 4:
    guard let id = UInt32(args[2]), let cap = captureImage,
          let img = cap(.null, 1 << 3, id, (1 << 0) | (1 << 3))?.takeRetainedValue() else { printJSON(["ok": false]); exit(1) }
    printJSON(["ok": savePNG(img, args[3]), "w": img.width, "h": img.height])
case "diffbox" where args.count == 4:
    // Box in image pixels plus image width, so the caller can convert to screen points.
    guard let a = loadImage(args[2]), let b = loadImage(args[3]), let r = diffBox(a, b) else { printJSON(["ok": false]); exit(1) }
    printJSON(["ok": true, "x": r.minX, "y": r.minY, "w": r.width, "h": r.height, "imgW": b.width])
case "crop" where args.count == 8:
    guard let img = loadImage(args[2]), let x = Double(args[3]), let y = Double(args[4]), let w = Double(args[5]), let h = Double(args[6]),
          let c = img.cropping(to: CGRect(x: x, y: y, width: w, height: h)) else { printJSON(["ok": false]); exit(1) }
    printJSON(["ok": savePNG(c, args[7])])
case "menu" where args.count == 4:
    // menu <barIndex> <itemIndex> (1-based, like AppleScript): presses that menu item in Live.
    guard let bi = Int(args[2]), let ii = Int(args[3]),
          let live = NSWorkspace.shared.runningApplications.first(where: { $0.localizedName == "Live" }) else { printJSON(["ok": false]); exit(1) }
    let appEl = AXUIElementCreateApplication(live.processIdentifier)
    var bar: CFTypeRef?
    AXUIElementCopyAttributeValue(appEl, kAXMenuBarAttribute as CFString, &bar)
    let items = bar.map { axChildren($0 as! AXUIElement) } ?? []
    guard items.count >= bi, let menu = axChildren(items[bi - 1]).first else { printJSON(["ok": false]); exit(1) }
    let entries = axChildren(menu)
    guard entries.count >= ii else { printJSON(["ok": false]); exit(1) }
    let r = AXUIElementPerformAction(entries[ii - 1], kAXPressAction as CFString)
    printJSON(["ok": r == .success, "title": axTitle(entries[ii - 1])])
case "highlight" where args.count == 5:
    // highlight <img> <x0> <x1>: vertical centre of the selected (light-blue) row in Live's browser list.
    guard let img = loadImage(args[2]), let x0 = Int(args[3]), let x1 = Int(args[4]) else { exit(2) }
    let px = pixels(img)
    let w = img.width
    var runStart = -1
    var found: (Int, Int)? = nil
    for y in 0..<img.height {
        var hits = 0, total = 0
        for x in stride(from: max(0, x0), to: min(w, x1), by: 3) {
            let i = (y * w + x) * 4
            let r = Int(px[i]), g = Int(px[i + 1]), b = Int(px[i + 2])
            if r > 110 && r < 200 && g > 180 && b > 205 { hits += 1 }
            total += 1
        }
        let on = total > 0 && hits * 2 > total
        if on && runStart < 0 { runStart = y }
        if !on && runStart >= 0 {
            if y - runStart >= 8 { found = (runStart, y); break }
            runStart = -1
        }
    }
    if let f = found { printJSON(["ok": true, "y": (f.0 + f.1) / 2]) } else { printJSON(["ok": false]) }
case "watchfront":
    // Prints the name of the frontmost app whenever it changes (one line each); runs until killed.
    func emit() {
        let name = NSWorkspace.shared.frontmostApplication?.localizedName ?? ""
        FileHandle.standardOutput.write((name + "\n").data(using: .utf8)!)
    }
    emit()
    NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { _ in emit() }
    RunLoop.main.run()
case "undolabel":
    printJSON(["label": undoItem().map(axTitle) ?? ""])
case "undo" where args.count >= 3:
    printJSON(undoLoad(before: args[2], quick: args.count > 3 && args[3] == "quick"))
case "click" where args.count >= 4:
    guard let x = Double(args[2]), let y = Double(args[3]) else { exit(2) }
    click(CGFloat(x), CGFloat(y), count: args.count > 4 ? Int(args[4]) ?? 1 : 1)
    printJSON(["ok": true])
case "ocr" where args.count == 4:
    // ocr <img> <fractionOfWidth>: reads text in the left part of the image (Live's browser).
    guard let img = loadImage(args[2]), let f = Double(args[3]) else { exit(2) }
    printJSON(recognize(img, region: CGRect(x: 0, y: 0, width: Double(img.width) * f, height: Double(img.height))))
default:
    FileHandle.standardError.write("usage: livecapture access|windows|capture <id> <out>|diffbox <a> <b>|crop <img> x y w h <out>|click <x> <y>\n".data(using: .utf8)!)
    exit(2)
}
