// Minimal VST3 host that opens a plugin's editor and saves it as PNG (macOS).
// Input (stdin): JSON array of {"path","out"}  ·  Output (stdout): one JSON line per job.
#import <AppKit/AppKit.h>
#include <dlfcn.h>
#include <string>

#include "public.sdk/source/vst/hosting/module.h"
#include "public.sdk/source/vst/hosting/plugprovider.h"
#include "public.sdk/source/vst/hosting/hostclasses.h"
#include "public.sdk/source/vst/utility/stringconvert.h"
#include "pluginterfaces/gui/iplugview.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"

using namespace Steinberg;
using namespace Steinberg::Vst;

// Lets plugins resize their editor window.
class PlugFrame : public IPlugFrame {
public:
    NSWindow* window = nil;
    tresult PLUGIN_API resizeView(IPlugView* view, ViewRect* r) override {
        if (!r || !window) return kInvalidArgument;
        [window setContentSize:NSMakeSize(r->getWidth(), r->getHeight())];
        view->onSize(r);
        return kResultOk;
    }
    tresult PLUGIN_API queryInterface(const TUID iid, void** obj) override {
        if (FUnknownPrivate::iidEqual(iid, IPlugFrame::iid) || FUnknownPrivate::iidEqual(iid, FUnknown::iid)) {
            *obj = this; return kResultOk;
        }
        *obj = nullptr; return kNoInterface;
    }
    uint32 PLUGIN_API addRef() override { return 1; }
    uint32 PLUGIN_API release() override { return 1; }
};

// Some controllers expect a component handler before opening their editor.
class ComponentHandler : public IComponentHandler {
public:
    tresult PLUGIN_API beginEdit(ParamID) override { return kResultOk; }
    tresult PLUGIN_API performEdit(ParamID, ParamValue) override { return kResultOk; }
    tresult PLUGIN_API endEdit(ParamID) override { return kResultOk; }
    tresult PLUGIN_API restartComponent(int32) override { return kResultOk; }
    tresult PLUGIN_API queryInterface(const TUID iid, void** obj) override {
        if (FUnknownPrivate::iidEqual(iid, IComponentHandler::iid) || FUnknownPrivate::iidEqual(iid, FUnknown::iid)) {
            *obj = this; return kResultOk;
        }
        *obj = nullptr; return kNoInterface;
    }
    uint32 PLUGIN_API addRef() override { return 1; }
    uint32 PLUGIN_API release() override { return 1; }
};

typedef CGImageRef (*CaptureFn)(CGRect, uint32_t, uint32_t, uint32_t);

static void report(NSString* out, BOOL ok, NSString* error) {
    NSMutableDictionary* d = [@{ @"out": out, @"ok": @(ok) } mutableCopy];
    if (error) d[@"error"] = error;
    NSData* data = [NSJSONSerialization dataWithJSONObject:d options:0 error:nil];
    fwrite(data.bytes, 1, data.length, stdout);
    fputs("\n", stdout);
    fflush(stdout);
}

static void pump(double seconds) {
    [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:seconds]];
}

static BOOL savePNG(CGImageRef img, NSString* path) {
    NSBitmapImageRep* rep = [[NSBitmapImageRep alloc] initWithCGImage:img];
    NSData* png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    return [png writeToFile:path atomically:YES];
}

static void snapshot(NSString* path, NSString* out) {
    std::string error;
    auto module = VST3::Hosting::Module::create(path.UTF8String, error);
    if (!module) return report(out, NO, [NSString stringWithUTF8String:error.c_str()]);

    auto factory = module->getFactory();
    VST3::Hosting::ClassInfo info;
    bool found = false;
    for (auto& ci : factory.classInfos()) {
        if (ci.category() == kVstAudioEffectClass) { info = ci; found = true; break; }
    }
    if (!found) return report(out, NO, @"no audio class");

    auto provider = owned(new PlugProvider(factory, info, true));
    if (!provider->initialize()) return report(out, NO, @"initialize failed");
    IPtr<IEditController> controller = provider->getControllerPtr();
    if (!controller) return report(out, NO, @"no controller");

    ComponentHandler handler;
    controller->setComponentHandler(&handler);

    IPtr<IPlugView> view = owned(controller->createView(ViewType::kEditor));
    if (!view) return report(out, NO, @"no editor");
    if (view->isPlatformTypeSupported(kPlatformTypeNSView) != kResultTrue) return report(out, NO, @"no NSView editor");

    ViewRect rect;
    if (view->getSize(&rect) != kResultOk || rect.getWidth() < 50 || rect.getHeight() < 50) rect = ViewRect(0, 0, 800, 500);

    NSWindow* win = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, rect.getWidth(), rect.getHeight())
                                                styleMask:NSWindowStyleMaskBorderless
                                                  backing:NSBackingStoreBuffered
                                                    defer:NO];
    win.releasedWhenClosed = NO;
    win.alphaValue = 0.01;
    win.ignoresMouseEvents = YES;
    win.level = -1000;
    [win setFrameOrigin:NSMakePoint(0, 0)];
    [win orderFrontRegardless];

    PlugFrame frame;
    frame.window = win;
    view->setFrame(&frame);
    if (view->attached((__bridge void*)win.contentView, kPlatformTypeNSView) != kResultOk) {
        [win close];
        return report(out, NO, @"attach failed");
    }
    pump(2.0); // let GL/Metal editors draw

    win.alphaValue = 1.0;
    pump(0.15);
    BOOL ok = NO;
    CaptureFn capture = (CaptureFn)dlsym(RTLD_DEFAULT, "CGWindowListCreateImage");
    if (capture) {
        CGImageRef img = capture(CGRectNull, 1 << 3, (uint32_t)win.windowNumber, (1 << 0) | (1 << 3));
        if (img) { ok = savePNG(img, out); CGImageRelease(img); }
    }
    view->removed();
    view->setFrame(nullptr);
    view = nullptr;
    [win orderOut:nil];
    [win close];
    controller->setComponentHandler(nullptr);
    report(out, ok, ok ? nil : @"capture failed");
}

int main() {
    @autoreleasepool {
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];

        static HostApplication host;
        PluginContextFactory::instance().setPluginContext(&host);

        NSData* input = [[NSFileHandle fileHandleWithStandardInput] readDataToEndOfFile];
        NSArray* jobs = [NSJSONSerialization JSONObjectWithData:input options:0 error:nil];
        for (NSDictionary* job in jobs) {
            @autoreleasepool { snapshot(job[@"path"], job[@"out"]); }
        }
    }
    _exit(0); // skip plugin static destructors, which often misbehave in hosts
}
