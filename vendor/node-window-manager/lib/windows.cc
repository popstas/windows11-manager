#include <cmath>
#include <cstdint>
#include <iostream>
#include <napi.h>
#include <shtypes.h>
#include <string>
#include <windows.h>
#include <shobjidl.h>
#include <gdiplus.h>
#pragma comment(lib, "gdiplus.lib")
#include <map>

typedef int (__stdcall* lp_GetScaleFactorForMonitor) (HMONITOR, DEVICE_SCALE_FACTOR*);

struct Process {
    int pid;
    std::string path;
};

template <typename T>
T getValueFromCallbackData (const Napi::CallbackInfo& info, unsigned handleIndex) {
    return reinterpret_cast<T> (info[handleIndex].As<Napi::Number> ().Int64Value ());
}

std::wstring get_wstring (const std::string str) {
    return std::wstring (str.begin (), str.end ());
}

std::string toUtf8 (const std::wstring& str) {
    std::string ret;
    int len = WideCharToMultiByte (CP_UTF8, 0, str.c_str (), str.length (), NULL, 0, NULL, NULL);
    if (len > 0) {
        ret.resize (len);
        WideCharToMultiByte (CP_UTF8, 0, str.c_str (), str.length (), &ret[0], len, NULL, NULL);
    }
    return ret;
}

Process getWindowProcess (HWND handle) {
    DWORD pid{ 0 };
    GetWindowThreadProcessId (handle, &pid);

    HANDLE pHandle{ OpenProcess (PROCESS_QUERY_LIMITED_INFORMATION, false, pid) };

    DWORD dwSize{ MAX_PATH };
    wchar_t exeName[MAX_PATH]{};

    QueryFullProcessImageNameW (pHandle, 0, exeName, &dwSize);
    
    CloseHandle(pHandle);

    auto wspath (exeName);
    auto path = toUtf8 (wspath);

    return { static_cast<int> (pid), path };
}

HWND find_top_window (DWORD pid) {
    std::pair<HWND, DWORD> params = { 0, pid };

    BOOL bResult = EnumWindows (
    [] (HWND hwnd, LPARAM lParam) -> BOOL {
        auto pParams = (std::pair<HWND, DWORD>*)(lParam);

        DWORD processId;
        if (GetWindowThreadProcessId (hwnd, &processId) && processId == pParams->second) {
            SetLastError (-1);
            pParams->first = hwnd;
            return FALSE;
        }

        return TRUE;
    },
    (LPARAM)&params);

    if (!bResult && GetLastError () == -1 && params.first) {
        return params.first;
    }

    return 0;
}

Napi::Number getProcessMainWindow (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };

    unsigned long process_id = info[0].ToNumber ().Uint32Value ();

    auto handle = find_top_window (process_id);

    return Napi::Number::New (env, reinterpret_cast<int64_t> (handle));
}

Napi::Number createProcess (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };

    auto path = info[0].ToString ().Utf8Value ();

    std::string cmd = "";

    if (info[1].IsString ()) {
        cmd = info[1].ToString ().Utf8Value ();
    }

    STARTUPINFOA sInfo = { sizeof (sInfo) };
    PROCESS_INFORMATION processInfo;
    CreateProcessA (path.c_str (), &cmd[0], NULL, NULL, FALSE,
                    CREATE_NEW_PROCESS_GROUP | CREATE_NEW_CONSOLE, NULL, NULL, &sInfo, &processInfo);

    return Napi::Number::New (env, processInfo.dwProcessId);
}

Napi::Number getActiveWindow (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };

    auto handle = GetForegroundWindow ();

    return Napi::Number::New (env, reinterpret_cast<int64_t> (handle));
}

std::vector<int64_t> _windows;

BOOL CALLBACK EnumWindowsProc (HWND hwnd, LPARAM lparam) {
    _windows.push_back (reinterpret_cast<int64_t> (hwnd));
    return TRUE;
}

Napi::Array getWindows (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };

    _windows.clear ();
    EnumWindows (&EnumWindowsProc, NULL);

    auto arr = Napi::Array::New (env);
    auto i = 0;
    for (auto _win : _windows) {
        arr.Set (i++, Napi::Number::New (env, _win));
    }

    return arr;
}

std::vector<int64_t> _monitors;

BOOL CALLBACK EnumMonitorsProc (HMONITOR hMonitor, HDC hdcMonitor, LPRECT lprcMonitor, LPARAM dwData) {
    _monitors.push_back (reinterpret_cast<int64_t> (hMonitor));
    return TRUE;
}

Napi::Array getMonitors (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };

    _monitors.clear ();
    if (EnumDisplayMonitors (NULL, NULL, &EnumMonitorsProc, NULL)) {
        auto arr = Napi::Array::New (env);
        auto i = 0;

        for (auto _mon : _monitors) {

            arr.Set (i++, Napi::Number::New (env, _mon));
        }

        return arr;
    }

    return Napi::Array::New (env);
}

Napi::Number getMonitorFromWindow (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };

    auto handle = getValueFromCallbackData<HWND> (info, 0);

    return Napi::Number::New (env, reinterpret_cast<int64_t> (MonitorFromWindow (handle, 0)));
}

Napi::Object initWindow (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };

    auto handle{ getValueFromCallbackData<HWND> (info, 0) };
    auto process = getWindowProcess (handle);

    Napi::Object obj{ Napi::Object::New (env) };

    obj.Set ("processId", process.pid);
    obj.Set ("path", process.path);

    return obj;
}

Napi::Object getWindowBounds (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };

    auto handle{ getValueFromCallbackData<HWND> (info, 0) };

    RECT rect{};
    GetWindowRect (handle, &rect);

    Napi::Object bounds{ Napi::Object::New (env) };

    bounds.Set ("x", rect.left);
    bounds.Set ("y", rect.top);
    bounds.Set ("width", rect.right - rect.left);
    bounds.Set ("height", rect.bottom - rect.top);

    return bounds;
}

Napi::String getWindowTitle (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };

    auto handle{ getValueFromCallbackData<HWND> (info, 0) };

    int bufsize = GetWindowTextLengthW (handle) + 1;
    std::wstring ws (bufsize, L'\0');
    int len = GetWindowTextW (handle, &ws[0], bufsize);
    ws.resize (len > 0 ? len : 0);
    std::string title = toUtf8 (ws);

    return Napi::String::New (env, title);
}

Napi::Number getWindowOpacity (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };

    auto handle{ getValueFromCallbackData<HWND> (info, 0) };

    BYTE opacity{};
    GetLayeredWindowAttributes (handle, NULL, &opacity, NULL);

    return Napi::Number::New (env, static_cast<double> (opacity) / 255.);
}

Napi::Number getWindowOwner (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };

    auto handle{ getValueFromCallbackData<HWND> (info, 0) };

    return Napi::Number::New (env, GetWindowLongPtrA (handle, GWLP_HWNDPARENT));
}

Napi::Number getMonitorScaleFactor (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };

    HMODULE hShcore{ LoadLibraryA ("SHcore.dll") };
    lp_GetScaleFactorForMonitor f{ (
    lp_GetScaleFactorForMonitor)GetProcAddress (hShcore, "GetScaleFactorForMonitor") };

    DEVICE_SCALE_FACTOR sf{};
    f (getValueFromCallbackData<HMONITOR> (info, 0), &sf);

    return Napi::Number::New (env, static_cast<double> (sf) / 100.);
}

Napi::Boolean toggleWindowTransparency (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };

    auto handle{ getValueFromCallbackData<HWND> (info, 0) };
    bool toggle{ info[1].As<Napi::Boolean> () };
    LONG_PTR style{ GetWindowLongPtrA (handle, GWL_EXSTYLE) };

    SetWindowLongPtrA (handle, GWL_EXSTYLE, ((toggle) ? (style | WS_EX_LAYERED) : (style & (~WS_EX_LAYERED))));

    return Napi::Boolean::New (env, true);
}

Napi::Boolean setWindowOpacity (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };

    auto handle{ getValueFromCallbackData<HWND> (info, 0) };
    double opacity{ info[1].As<Napi::Number> ().DoubleValue () };

    SetLayeredWindowAttributes (handle, NULL, opacity * 255., LWA_ALPHA);

    return Napi::Boolean::New (env, true);
}

Napi::Boolean setWindowBounds (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };

    Napi::Object bounds{ info[1].As<Napi::Object> () };
    auto handle{ getValueFromCallbackData<HWND> (info, 0) };

    BOOL b{ MoveWindow (handle, bounds.Get ("x").ToNumber (), bounds.Get ("y").ToNumber (),
                        bounds.Get ("width").ToNumber (), bounds.Get ("height").ToNumber (), true) };

    return Napi::Boolean::New (env, b);
}

Napi::Boolean setWindowOwner (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };

    auto handle{ getValueFromCallbackData<HWND> (info, 0) };
    auto newOwner{ static_cast<LONG_PTR> (info[1].As<Napi::Number> ().Int64Value ()) };

    SetWindowLongPtrA (handle, GWLP_HWNDPARENT, newOwner);

    return Napi::Boolean::New (env, true);
}

Napi::Boolean showWindow (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };

    auto handle{ getValueFromCallbackData<HWND> (info, 0) };
    std::string type{ info[1].As<Napi::String> () };

    DWORD flag{ 0 };

    if (type == "show")
        flag = SW_SHOW;
    else if (type == "hide")
        flag = SW_HIDE;
    else if (type == "minimize")
        flag = SW_MINIMIZE;
    else if (type == "restore")
        flag = SW_RESTORE;
    else if (type == "maximize")
        flag = SW_MAXIMIZE;

    return Napi::Boolean::New (env, ShowWindow (handle, flag));
}

Napi::Boolean bringWindowToTop (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };
    auto handle{ getValueFromCallbackData<HWND> (info, 0) };
    BOOL b{ SetForegroundWindow (handle) };

    HWND hCurWnd = ::GetForegroundWindow ();
    DWORD dwMyID = ::GetCurrentThreadId ();
    DWORD dwCurID = ::GetWindowThreadProcessId (hCurWnd, NULL);
    ::AttachThreadInput (dwCurID, dwMyID, TRUE);
    ::SetWindowPos (handle, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE);
    ::SetWindowPos (handle, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE);
    ::SetForegroundWindow (handle);
    ::AttachThreadInput (dwCurID, dwMyID, FALSE);
    ::SetFocus (handle);
    ::SetActiveWindow (handle);

    return Napi::Boolean::New (env, b);
}

Napi::Boolean redrawWindow (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };

    auto handle{ getValueFromCallbackData<HWND> (info, 0) };
    BOOL b{ SetWindowPos (handle, 0, 0, 0, 0, 0,
                          SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER |
                          SWP_NOOWNERZORDER | SWP_NOACTIVATE | SWP_DRAWFRAME | SWP_NOCOPYBITS) };

    return Napi::Boolean::New (env, b);
}

Napi::Boolean isWindow (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };

    auto handle{ getValueFromCallbackData<HWND> (info, 0) };

    return Napi::Boolean::New (env, IsWindow (handle));
}

Napi::Boolean isWindowVisible (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };

    auto handle{ getValueFromCallbackData<HWND> (info, 0) };

    return Napi::Boolean::New (env, IsWindowVisible (handle));
}

Napi::Object getMonitorInfo (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };

    auto handle{ getValueFromCallbackData<HMONITOR> (info, 0) };

    MONITORINFO mInfo;
    mInfo.cbSize = sizeof (MONITORINFO);
    GetMonitorInfoA (handle, &mInfo);

    Napi::Object bounds{ Napi::Object::New (env) };

    bounds.Set ("x", mInfo.rcMonitor.left);
    bounds.Set ("y", mInfo.rcMonitor.top);
    bounds.Set ("width", mInfo.rcMonitor.right - mInfo.rcMonitor.left);
    bounds.Set ("height", mInfo.rcMonitor.bottom - mInfo.rcMonitor.top);

    Napi::Object workArea{ Napi::Object::New (env) };

    workArea.Set ("x", mInfo.rcWork.left);
    workArea.Set ("y", mInfo.rcWork.top);
    workArea.Set ("width", mInfo.rcWork.right - mInfo.rcWork.left);
    workArea.Set ("height", mInfo.rcWork.bottom - mInfo.rcWork.top);

    Napi::Object obj{ Napi::Object::New (env) };

    obj.Set ("bounds", bounds);
    obj.Set ("workArea", workArea);
    obj.Set ("isPrimary", (mInfo.dwFlags & MONITORINFOF_PRIMARY) != 0);

    return obj;
}

// --- Taskbar button of a window: progress and flashing ---
//
// Works on windows of other processes too: ITaskbarList3 and FlashWindowEx
// accept any top-level hwnd (checked on WezTerm windows, 2026-11-15). This is
// how windows11-manager draws on the button what the terminal cannot draw
// itself. Window icon calls (WM_SETICON) belong here as well: same kind, by hwnd.

static ITaskbarList3* taskbarList = nullptr;
static HWND taskbarListTray = nullptr;

// One instance per process: CoCreateInstance and HrInit cost more than the
// calls themselves, and the service calls them every few seconds.
// The instance is bound to the explorer it was created with: after explorer
// restarts (new Shell_TrayWnd) it is recreated, otherwise calls would go to
// the taskbar that no longer exists.
static ITaskbarList3* getTaskbarList () {
    HWND tray{ FindWindowW (L"Shell_TrayWnd", NULL) };
    if (taskbarList && tray == taskbarListTray) return taskbarList;
    if (taskbarList) {
        taskbarList->Release ();
        taskbarList = nullptr;
    }
    // RPC_E_CHANGED_MODE: COM is already initialized on this thread in another
    // model. The object can still be created, so this is not an error.
    HRESULT init{ CoInitializeEx (NULL, COINIT_APARTMENTTHREADED) };
    if (FAILED (init) && init != RPC_E_CHANGED_MODE) return nullptr;
    ITaskbarList3* list{ nullptr };
    if (FAILED (CoCreateInstance (CLSID_TaskbarList, NULL, CLSCTX_INPROC_SERVER, IID_PPV_ARGS (&list)))) {
        return nullptr;
    }
    if (FAILED (list->HrInit ())) {
        list->Release ();
        return nullptr;
    }
    taskbarList = list;
    taskbarListTray = tray;
    return taskbarList;
}

// getTaskbarWindow(): hwnd of the taskbar (Shell_TrayWnd), 0 when there is
// none. A new value means explorer restarted and dropped what was drawn on
// the buttons (overlay icons, progress): the caller draws it again. One
// FindWindow, no enumeration — cheap enough for a polling timer.
Napi::Number getTaskbarWindow (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };
    HWND tray{ FindWindowW (L"Shell_TrayWnd", NULL) };
    return Napi::Number::New (env, static_cast<double> (reinterpret_cast<int64_t> (tray)));
}

// setTaskbarProgress(hwnd, state, value): state is a TBPFLAG (0 none,
// 1 indeterminate, 2 normal, 4 error, 8 paused), value is 0..100. The value is
// set only for states that draw a bar.
Napi::Boolean setTaskbarProgress (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };

    auto handle{ getValueFromCallbackData<HWND> (info, 0) };
    int state{ info[1].As<Napi::Number> ().Int32Value () };
    int value{ info.Length () > 2 ? info[2].As<Napi::Number> ().Int32Value () : 0 };
    if (value < 0) value = 0;
    if (value > 100) value = 100;

    ITaskbarList3* list{ getTaskbarList () };
    if (!list || !IsWindow (handle)) return Napi::Boolean::New (env, false);

    HRESULT hr{ list->SetProgressState (handle, static_cast<TBPFLAG> (state)) };
    if (SUCCEEDED (hr) && (state == TBPF_NORMAL || state == TBPF_PAUSED || state == TBPF_ERROR)) {
        hr = list->SetProgressValue (handle, static_cast<ULONGLONG> (value), 100);
    }
    return Napi::Boolean::New (env, SUCCEEDED (hr));
}

// flashWindow(hwnd, on): on lights the button orange and keeps it lit until
// the window is activated; off takes the light down. One flash cycle without
// FLASHW_TIMER*: after the cycle Windows leaves the button highlighted, steady,
// not blinking (checked on Windows 11, nb, 2026-11-16 — Stas asked for a steady
// light instead of blinking).
//
// A bare FLASHW_STOP does NOT clear that leftover highlight: it only stops a
// flash in progress, and after the cycle there is none (nb, 2026-11-16 — the
// button stayed orange for minutes). So off first starts a timer flash and
// stops it at once: stopping a running flash restores the button. Back to back,
// no pause needed (checked the same day).
Napi::Boolean flashWindow (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };

    auto handle{ getValueFromCallbackData<HWND> (info, 0) };
    bool on{ info[1].As<Napi::Boolean> ().Value () };
    if (!IsWindow (handle)) return Napi::Boolean::New (env, false);

    FLASHWINFO fi{};
    fi.cbSize = sizeof (FLASHWINFO);
    fi.hwnd = handle;
    fi.dwTimeout = 0;
    // Returns the previous flash state, not success: the call has no error.
    if (on) {
        fi.dwFlags = FLASHW_TRAY;
        fi.uCount = 1;
        FlashWindowEx (&fi);
    } else {
        fi.dwFlags = FLASHW_TRAY | FLASHW_TIMER;
        fi.uCount = 0;
        FlashWindowEx (&fi);
        fi.dwFlags = FLASHW_STOP;
        FlashWindowEx (&fi);
    }
    return Napi::Boolean::New (env, true);
}

// --- Window icon (WM_SETICON) ---
//
// An HICON belongs to the process that loaded it: the window shows it only
// while this process is alive, so the handles are cached here for the life of
// the process and never destroyed (a handful of files). The cache key includes
// the file write time, so picking a new file under the same path takes effect.

struct IconPair {
    HICON bigIcon;
    HICON smallIcon;
};

static std::map<std::wstring, IconPair> iconCache;

static std::wstring fromUtf8 (const std::string& str) {
    if (str.empty ()) return std::wstring ();
    int len{ MultiByteToWideChar (CP_UTF8, 0, str.c_str (), (int)str.size (), NULL, 0) };
    std::wstring out (len, L'\0');
    MultiByteToWideChar (CP_UTF8, 0, str.c_str (), (int)str.size (), &out[0], len);
    return out;
}

static bool endsWithIco (const std::wstring& path) {
    if (path.size () < 4) return false;
    std::wstring tail{ path.substr (path.size () - 4) };
    for (auto& c : tail) c = towlower (c);
    return tail == L".ico";
}

// .ico: LoadImage picks the closest size from the file. Anything else (.png,
// .bmp, .jpg): GDI+ decodes it and makes one icon used for both sizes.
static IconPair loadIcon (const std::wstring& path) {
    IconPair pair{ nullptr, nullptr };
    if (endsWithIco (path)) {
        pair.bigIcon = (HICON)LoadImageW (NULL, path.c_str (), IMAGE_ICON, 48, 48, LR_LOADFROMFILE);
        pair.smallIcon = (HICON)LoadImageW (NULL, path.c_str (), IMAGE_ICON, 32, 32, LR_LOADFROMFILE);
        return pair;
    }
    static ULONG_PTR gdiplusToken{ 0 };
    if (!gdiplusToken) {
        Gdiplus::GdiplusStartupInput input;
        if (Gdiplus::GdiplusStartup (&gdiplusToken, &input, NULL) != Gdiplus::Ok) return pair;
    }
    Gdiplus::Bitmap* bitmap{ Gdiplus::Bitmap::FromFile (path.c_str ()) };
    if (bitmap && bitmap->GetLastStatus () == Gdiplus::Ok) {
        HICON icon{ nullptr };
        if (bitmap->GetHICON (&icon) == Gdiplus::Ok) {
            pair.bigIcon = icon;
            pair.smallIcon = icon;
        }
    }
    delete bitmap;
    return pair;
}

static void sendIcon (HWND handle, WPARAM which, HICON icon) {
    DWORD_PTR result{ 0 };
    // A hung window must not stall the caller: give up after half a second.
    SendMessageTimeoutW (handle, WM_SETICON, which, (LPARAM)icon, SMTO_ABORTIFHUNG, 500, &result);
}

// setWindowIcon(hwnd, path): path "" removes the icons set from outside, and
// the window falls back to its class icon. Returns false when the window is
// gone or the file cannot be loaded.
Napi::Boolean setWindowIcon (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };

    auto handle{ getValueFromCallbackData<HWND> (info, 0) };
    std::wstring path{ fromUtf8 (info[1].As<Napi::String> ().Utf8Value ()) };
    if (!IsWindow (handle)) return Napi::Boolean::New (env, false);

    if (path.empty ()) {
        sendIcon (handle, ICON_BIG, NULL);
        sendIcon (handle, ICON_SMALL, NULL);
        return Napi::Boolean::New (env, true);
    }

    WIN32_FILE_ATTRIBUTE_DATA attrs;
    if (!GetFileAttributesExW (path.c_str (), GetFileExInfoStandard, &attrs)) {
        return Napi::Boolean::New (env, false);
    }
    std::wstring key{ path + L"|" + std::to_wstring (attrs.ftLastWriteTime.dwHighDateTime) + L":" +
                      std::to_wstring (attrs.ftLastWriteTime.dwLowDateTime) };
    auto hit{ iconCache.find (key) };
    IconPair pair;
    if (hit != iconCache.end ()) {
        pair = hit->second;
    } else {
        pair = loadIcon (path);
        if (!pair.bigIcon && !pair.smallIcon) return Napi::Boolean::New (env, false);
        iconCache[key] = pair;
    }
    sendIcon (handle, ICON_BIG, pair.bigIcon ? pair.bigIcon : pair.smallIcon);
    sendIcon (handle, ICON_SMALL, pair.smallIcon ? pair.smallIcon : pair.bigIcon);
    return Napi::Boolean::New (env, true);
}

// --- Overlay icon on the taskbar button (ITaskbarList3::SetOverlayIcon) ---
//
// A small badge in the bottom right corner of the button, over the window's
// own icon. Shown only on the taskbar button (not in the title bar, not in
// Alt+Tab) and only when Windows shows badges on taskbar buttons. Explorer
// drops it when it restarts — the caller sets it again (getTaskbarWindow).
// The badge wants the small icon size (SM_CXSMICON, 16 px at 100%), so it is
// loaded separately from the 48/32 pair of setWindowIcon and cached the same
// way: for the life of the process, keyed by path and write time.

static std::map<std::wstring, HICON> overlayCache;

static HICON loadSmallIcon (const std::wstring& path) {
    int cx{ GetSystemMetrics (SM_CXSMICON) };
    int cy{ GetSystemMetrics (SM_CYSMICON) };
    if (endsWithIco (path)) {
        return (HICON)LoadImageW (NULL, path.c_str (), IMAGE_ICON, cx, cy, LR_LOADFROMFILE);
    }
    // Not an .ico: decode with GDI+ as setWindowIcon does; the taskbar scales.
    IconPair pair{ loadIcon (path) };
    return pair.smallIcon ? pair.smallIcon : pair.bigIcon;
}

// setOverlayIcon(hwnd, path, description): path "" removes the badge.
// Returns false when the window is gone, the file cannot be loaded or the
// taskbar refused the call.
Napi::Boolean setOverlayIcon (const Napi::CallbackInfo& info) {
    Napi::Env env{ info.Env () };

    auto handle{ getValueFromCallbackData<HWND> (info, 0) };
    std::wstring path{ fromUtf8 (info[1].As<Napi::String> ().Utf8Value ()) };
    std::wstring description{ info.Length () > 2 && info[2].IsString ()
                                  ? fromUtf8 (info[2].As<Napi::String> ().Utf8Value ())
                                  : std::wstring () };
    if (!IsWindow (handle)) return Napi::Boolean::New (env, false);
    ITaskbarList3* list{ getTaskbarList () };
    if (!list) return Napi::Boolean::New (env, false);

    if (path.empty ()) {
        return Napi::Boolean::New (env, SUCCEEDED (list->SetOverlayIcon (handle, NULL, NULL)));
    }

    WIN32_FILE_ATTRIBUTE_DATA attrs;
    if (!GetFileAttributesExW (path.c_str (), GetFileExInfoStandard, &attrs)) {
        return Napi::Boolean::New (env, false);
    }
    std::wstring key{ path + L"|" + std::to_wstring (attrs.ftLastWriteTime.dwHighDateTime) + L":" +
                      std::to_wstring (attrs.ftLastWriteTime.dwLowDateTime) };
    auto hit{ overlayCache.find (key) };
    HICON icon{ nullptr };
    if (hit != overlayCache.end ()) {
        icon = hit->second;
    } else {
        icon = loadSmallIcon (path);
        if (!icon) return Napi::Boolean::New (env, false);
        overlayCache[key] = icon;
    }
    HRESULT hr{ list->SetOverlayIcon (handle, icon, description.empty () ? NULL : description.c_str ()) };
    return Napi::Boolean::New (env, SUCCEEDED (hr));
}

Napi::Object Init (Napi::Env env, Napi::Object exports) {
    exports.Set (Napi::String::New (env, "setWindowIcon"), Napi::Function::New (env, setWindowIcon));
    exports.Set (Napi::String::New (env, "setOverlayIcon"), Napi::Function::New (env, setOverlayIcon));
    exports.Set (Napi::String::New (env, "getTaskbarWindow"), Napi::Function::New (env, getTaskbarWindow));
    exports.Set (Napi::String::New (env, "setTaskbarProgress"), Napi::Function::New (env, setTaskbarProgress));
    exports.Set (Napi::String::New (env, "flashWindow"), Napi::Function::New (env, flashWindow));
    exports.Set (Napi::String::New (env, "getActiveWindow"), Napi::Function::New (env, getActiveWindow));
    exports.Set (Napi::String::New (env, "getMonitorFromWindow"), Napi::Function::New (env, getMonitorFromWindow));
    exports.Set (Napi::String::New (env, "getMonitorScaleFactor"),
                 Napi::Function::New (env, getMonitorScaleFactor));
    exports.Set (Napi::String::New (env, "setWindowBounds"), Napi::Function::New (env, setWindowBounds));
    exports.Set (Napi::String::New (env, "showWindow"), Napi::Function::New (env, showWindow));
    exports.Set (Napi::String::New (env, "bringWindowToTop"), Napi::Function::New (env, bringWindowToTop));
    exports.Set (Napi::String::New (env, "redrawWindow"), Napi::Function::New (env, redrawWindow));
    exports.Set (Napi::String::New (env, "isWindow"), Napi::Function::New (env, isWindow));
    exports.Set (Napi::String::New (env, "isWindowVisible"), Napi::Function::New (env, isWindowVisible));
    exports.Set (Napi::String::New (env, "setWindowOpacity"), Napi::Function::New (env, setWindowOpacity));
    exports.Set (Napi::String::New (env, "toggleWindowTransparency"),
                 Napi::Function::New (env, toggleWindowTransparency));
    exports.Set (Napi::String::New (env, "setWindowOwner"), Napi::Function::New (env, setWindowOwner));
    exports.Set (Napi::String::New (env, "initWindow"), Napi::Function::New (env, initWindow));
    exports.Set (Napi::String::New (env, "getWindowBounds"), Napi::Function::New (env, getWindowBounds));
    exports.Set (Napi::String::New (env, "getWindowTitle"), Napi::Function::New (env, getWindowTitle));
    exports.Set (Napi::String::New (env, "getWindowOwner"), Napi::Function::New (env, getWindowOwner));
    exports.Set (Napi::String::New (env, "getWindowOpacity"), Napi::Function::New (env, getWindowOpacity));
    exports.Set (Napi::String::New (env, "getMonitorInfo"), Napi::Function::New (env, getMonitorInfo));
    exports.Set (Napi::String::New (env, "getWindows"), Napi::Function::New (env, getWindows));
    exports.Set (Napi::String::New (env, "getMonitors"), Napi::Function::New (env, getMonitors));
    exports.Set (Napi::String::New (env, "createProcess"), Napi::Function::New (env, createProcess));
    exports.Set (Napi::String::New (env, "getProcessMainWindow"), Napi::Function::New (env, getProcessMainWindow));

    return exports;
}

NODE_API_MODULE (addon, Init)
