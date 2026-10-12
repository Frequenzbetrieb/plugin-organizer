// Renders Audio Unit editors into PNG files.
// Input (stdin): JSON array of {"type","subtype","manufacturer","out"}.
// Output (stdout): one JSON line per job: {"out", "ok", "error"?}.
import AppKit
import AVFoundation
import AudioToolbox
import CoreAudioKit

struct Job: Decodable { let type: String; let subtype: String; let manufacturer: String; let out: String }

func fourCC(_ s: String) -> OSType {
    var r: OSType = 0
    for c in s.utf8.prefix(4) { r = (r << 8) | OSType(c) }
    return r
}

func report(_ out: String, _ ok: Bool, _ error: String? = nil) {
    var d: [String: Any] = ["out": out, "ok": ok]
    if let e = error { d["error"] = e }
    let data = try! JSONSerialization.data(withJSONObject: d)
    FileHandle.standardOutput.write(data + "\n".data(using: .utf8)!)
}

// CGWindowListCreateImage is unavailable in newer SDKs, but still exported; capturing our own window needs no permission.
typealias CaptureFn = @convention(c) (CGRect, UInt32, UInt32, UInt32) -> Unmanaged<CGImage>?
let capture: CaptureFn? = {
    guard let h = dlopen(nil, RTLD_NOW), let s = dlsym(h, "CGWindowListCreateImage") else { return nil }
    return unsafeBitCast(s, to: CaptureFn.self)
}()

func runLoop(_ seconds: Double) {
    RunLoop.current.run(until: Date().addingTimeInterval(seconds))
}

func savePNG(_ image: CGImage, _ path: String) -> Bool {
    let rep = NSBitmapImageRep(cgImage: image)
    guard let data = rep.representation(using: .png, properties: [:]) else { return false }
    return (try? data.write(to: URL(fileURLWithPath: path))) != nil
}

func snapshot(_ job: Job) {
    let desc = AudioComponentDescription(
        componentType: fourCC(job.type), componentSubType: fourCC(job.subtype),
        componentManufacturer: fourCC(job.manufacturer), componentFlags: 0, componentFlagsMask: 0)

    var unit: AVAudioUnit?
    var done = false
    AVAudioUnit.instantiate(with: desc, options: []) { u, err in unit = u; done = true }
    let t0 = Date()
    while !done && Date().timeIntervalSince(t0) < 15 { runLoop(0.05) }
    guard let au = unit?.auAudioUnit else { return report(job.out, false, "instantiate failed") }

    var vc: NSViewController?
    done = false
    au.requestViewController { v in vc = v; done = true }
    let t1 = Date()
    while !done && Date().timeIntervalSince(t1) < 15 { runLoop(0.05) }
    guard let view = vc?.view else { return report(job.out, false, "no editor") }

    var size = view.frame.size
    if size.width < 50 || size.height < 50 { size = view.fittingSize }
    if size.width < 50 || size.height < 50 { size = vc?.preferredContentSize ?? size }
    if size.width < 50 || size.height < 50 { size = NSSize(width: 800, height: 500) }

    let win = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
    win.contentViewController = vc
    win.setContentSize(size)
    win.isReleasedWhenClosed = false
    // Keep it effectively invisible to the user but composited by the window server.
    win.alphaValue = 0.01
    win.ignoresMouseEvents = true
    win.level = .init(rawValue: -1000)
    win.setFrameOrigin(NSPoint(x: 0, y: 0))
    win.orderFrontRegardless()
    runLoop(2.0) // let the editor draw (GL/Metal UIs need a few frames)

    var ok = false
    win.alphaValue = 1.0
    runLoop(0.15)
    if let cap = capture, let img = cap(.null, 1 << 3 /* optionIncludingWindow */, UInt32(win.windowNumber), 1 << 0 | 1 << 3 /* ignoreFraming | bestResolution */)?.takeRetainedValue() {
        ok = savePNG(img, job.out)
    }
    if !ok, let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
        view.cacheDisplay(in: view.bounds, to: rep)
        if let img = rep.cgImage { ok = savePNG(img, job.out) }
    }
    win.orderOut(nil)
    win.contentViewController = nil
    win.close()
    report(job.out, ok, ok ? nil : "capture failed")
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let input = FileHandle.standardInput.readDataToEndOfFile()
let jobs = (try? JSONDecoder().decode([Job].self, from: input)) ?? []
for job in jobs { autoreleasepool { snapshot(job) } }
exit(0)
