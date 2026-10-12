// Minimal VST3 host for Windows: opens a plugin's editor in a nearly invisible window and saves it as PNG.
// Input (stdin): JSON array of {"path","out"}  ·  Output (stdout): one JSON line per job (same as the macOS host).
#include <windows.h>
#include <wincodec.h>
#include <cstdio>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "public.sdk/source/vst/hosting/module.h"
#include "public.sdk/source/vst/hosting/plugprovider.h"
#include "public.sdk/source/vst/hosting/hostclasses.h"
#include "pluginterfaces/gui/iplugview.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"

using namespace Steinberg;
using namespace Steinberg::Vst;

// ---------- tiny JSON helpers (input is our own, simple format) ----------
struct Job { std::string path, out; };

static std::string unescape(const std::string& s) {
    std::string r;
    for (size_t i = 0; i < s.size(); i++) {
        if (s[i] == '\\' && i + 1 < s.size()) {
            char c = s[++i];
            if (c == 'n') r += '\n'; else if (c == 't') r += '\t'; else r += c;
        } else r += s[i];
    }
    return r;
}

static std::string field(const std::string& obj, const std::string& key) {
    auto k = obj.find("\"" + key + "\"");
    if (k == std::string::npos) return "";
    auto q1 = obj.find('"', obj.find(':', k) + 1);
    size_t q2 = q1 + 1;
    while (q2 < obj.size() && !(obj[q2] == '"' && obj[q2 - 1] != '\\')) q2++;
    return unescape(obj.substr(q1 + 1, q2 - q1 - 1));
}

static std::vector<Job> parseJobs(const std::string& in) {
    std::vector<Job> jobs;
    size_t pos = 0;
    while ((pos = in.find('{', pos)) != std::string::npos) {
        auto end = in.find('}', pos);
        if (end == std::string::npos) break;
        std::string obj = in.substr(pos, end - pos + 1);
        jobs.push_back({field(obj, "path"), field(obj, "out")});
        pos = end + 1;
    }
    return jobs;
}

static std::string jsonEscape(const std::string& s) {
    std::string r;
    for (char c : s) { if (c == '"' || c == '\\') r += '\\'; r += c; }
    return r;
}

static void report(const std::string& out, bool ok, const std::string& error = "") {
    std::cout << "{\"out\":\"" << jsonEscape(out) << "\",\"ok\":" << (ok ? "true" : "false");
    if (!error.empty()) std::cout << ",\"error\":\"" << jsonEscape(error) << "\"";
    std::cout << "}" << std::endl;
}

static std::wstring widen(const std::string& s) {
    int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
    std::wstring w(n ? n - 1 : 0, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, w.data(), n);
    return w;
}

// ---------- host interfaces ----------
class PlugFrame : public IPlugFrame {
public:
    HWND hwnd = nullptr;
    tresult PLUGIN_API resizeView(IPlugView* view, ViewRect* r) override {
        if (!r || !hwnd) return kInvalidArgument;
        SetWindowPos(hwnd, nullptr, 0, 0, r->getWidth(), r->getHeight(), SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
        view->onSize(r);
        return kResultOk;
    }
    tresult PLUGIN_API queryInterface(const TUID iid, void** obj) override {
        if (FUnknownPrivate::iidEqual(iid, IPlugFrame::iid) || FUnknownPrivate::iidEqual(iid, FUnknown::iid)) { *obj = this; return kResultOk; }
        *obj = nullptr; return kNoInterface;
    }
    uint32 PLUGIN_API addRef() override { return 1; }
    uint32 PLUGIN_API release() override { return 1; }
};

class ComponentHandler : public IComponentHandler {
public:
    tresult PLUGIN_API beginEdit(ParamID) override { return kResultOk; }
    tresult PLUGIN_API performEdit(ParamID, ParamValue) override { return kResultOk; }
    tresult PLUGIN_API endEdit(ParamID) override { return kResultOk; }
    tresult PLUGIN_API restartComponent(int32) override { return kResultOk; }
    tresult PLUGIN_API queryInterface(const TUID iid, void** obj) override {
        if (FUnknownPrivate::iidEqual(iid, IComponentHandler::iid) || FUnknownPrivate::iidEqual(iid, FUnknown::iid)) { *obj = this; return kResultOk; }
        *obj = nullptr; return kNoInterface;
    }
    uint32 PLUGIN_API addRef() override { return 1; }
    uint32 PLUGIN_API release() override { return 1; }
};

// ---------- window + capture ----------
static void pump(DWORD ms) {
    DWORD end = GetTickCount() + ms;
    MSG msg;
    while (GetTickCount() < end) {
        while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) { TranslateMessage(&msg); DispatchMessageW(&msg); }
        Sleep(10);
    }
}

static bool savePNG(HBITMAP bmp, int w, int h, const std::wstring& path) {
    IWICImagingFactory* factory = nullptr;
    if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory)))) return false;
    IWICBitmap* wicBmp = nullptr;
    IWICStream* stream = nullptr;
    IWICBitmapEncoder* encoder = nullptr;
    IWICBitmapFrameEncode* frame = nullptr;
    bool ok = SUCCEEDED(factory->CreateBitmapFromHBITMAP(bmp, nullptr, WICBitmapIgnoreAlpha, &wicBmp))
        && SUCCEEDED(factory->CreateStream(&stream))
        && SUCCEEDED(stream->InitializeFromFilename(path.c_str(), GENERIC_WRITE))
        && SUCCEEDED(factory->CreateEncoder(GUID_ContainerFormatPng, nullptr, &encoder))
        && SUCCEEDED(encoder->Initialize(stream, WICBitmapEncoderNoCache))
        && SUCCEEDED(encoder->CreateNewFrame(&frame, nullptr))
        && SUCCEEDED(frame->Initialize(nullptr))
        && SUCCEEDED(frame->SetSize(w, h))
        && SUCCEEDED(frame->WriteSource(wicBmp, nullptr))
        && SUCCEEDED(frame->Commit())
        && SUCCEEDED(encoder->Commit());
    if (frame) frame->Release();
    if (encoder) encoder->Release();
    if (stream) stream->Release();
    if (wicBmp) wicBmp->Release();
    factory->Release();
    return ok;
}

// PrintWindow with PW_RENDERFULLCONTENT also captures GPU-drawn editors (Direct2D/OpenGL).
static bool captureWindow(HWND hwnd, int w, int h, const std::wstring& path) {
    HDC screen = GetDC(nullptr);
    HDC mem = CreateCompatibleDC(screen);
    HBITMAP bmp = CreateCompatibleBitmap(screen, w, h);
    HGDIOBJ old = SelectObject(mem, bmp);
    BOOL printed = PrintWindow(hwnd, mem, 0x00000002 /* PW_RENDERFULLCONTENT */);
    if (!printed) BitBlt(mem, 0, 0, w, h, screen, 0, 0, SRCCOPY);
    SelectObject(mem, old);
    bool ok = savePNG(bmp, w, h, path);
    DeleteObject(bmp);
    DeleteDC(mem);
    ReleaseDC(nullptr, screen);
    return ok;
}

static LRESULT CALLBACK wndProc(HWND h, UINT m, WPARAM w, LPARAM l) { return DefWindowProcW(h, m, w, l); }

static void snapshot(const Job& job) {
    std::string error;
    auto module = VST3::Hosting::Module::create(job.path, error);
    if (!module) return report(job.out, false, error.empty() ? "load failed" : error);

    auto factory = module->getFactory();
    VST3::Hosting::ClassInfo info;
    bool found = false;
    for (auto& ci : factory.classInfos()) {
        if (ci.category() == kVstAudioEffectClass) { info = ci; found = true; break; }
    }
    if (!found) return report(job.out, false, "no audio class");

    auto provider = owned(new PlugProvider(factory, info, true));
    if (!provider->initialize()) return report(job.out, false, "initialize failed");
    IPtr<IEditController> controller = provider->getControllerPtr();
    if (!controller) return report(job.out, false, "no controller");

    ComponentHandler handler;
    controller->setComponentHandler(&handler);

    IPtr<IPlugView> view = owned(controller->createView(ViewType::kEditor));
    if (!view) return report(job.out, false, "no editor");
    if (view->isPlatformTypeSupported(kPlatformTypeHWND) != kResultTrue) return report(job.out, false, "no HWND editor");

    ViewRect rect;
    if (view->getSize(&rect) != kResultOk || rect.getWidth() < 50 || rect.getHeight() < 50) rect = ViewRect(0, 0, 800, 500);

    // Layered, almost transparent tool window: composited (so it renders) but invisible to the user.
    HWND hwnd = CreateWindowExW(WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, L"VST3SnapWindow", L"vst3-snapshot",
                                WS_POPUP, 0, 0, rect.getWidth(), rect.getHeight(), nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
    SetLayeredWindowAttributes(hwnd, 0, 1, LWA_ALPHA);
    ShowWindow(hwnd, SW_SHOWNOACTIVATE);

    PlugFrame frame;
    frame.hwnd = hwnd;
    view->setFrame(&frame);
    if (view->attached(hwnd, kPlatformTypeHWND) != kResultOk) {
        DestroyWindow(hwnd);
        return report(job.out, false, "attach failed");
    }
    pump(2000); // let the editor draw

    RECT rc;
    GetClientRect(hwnd, &rc);
    bool ok = captureWindow(hwnd, rc.right - rc.left, rc.bottom - rc.top, widen(job.out));

    view->removed();
    view->setFrame(nullptr);
    view = nullptr;
    DestroyWindow(hwnd);
    pump(50);
    controller->setComponentHandler(nullptr);
    report(job.out, ok, ok ? "" : "capture failed");
}

int main() {
    SetProcessDPIAware();
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

    WNDCLASSW wc = {};
    wc.lpfnWndProc = wndProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = L"VST3SnapWindow";
    wc.hbrBackground = (HBRUSH)GetStockObject(BLACK_BRUSH);
    RegisterClassW(&wc);

    static HostApplication host;
    PluginContextFactory::instance().setPluginContext(&host);

    std::stringstream ss;
    ss << std::cin.rdbuf();
    for (const auto& job : parseJobs(ss.str())) snapshot(job);

    std::cout.flush();
    _exit(0); // skip plugin static destructors, which often misbehave in hosts
}
