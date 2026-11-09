using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal sealed class DesktopWindow : Form {
    private static bool loaderConfigured;
    private readonly Uri origin;
    private readonly string sdkFolder, webData;
    private readonly Func<bool> closeToTray;
    private readonly Action exitApplication;
    private readonly Action<string> log;
    private readonly Label loading;
    private WebView2 view;
    private FormWindowState restoreState = FormWindowState.Normal;
    private bool shuttingDown, loaded, showingFallback;
    private string targetFragment = "";

    internal DesktopWindow(string address, string root, string data, Icon icon, Func<bool> closeAction, Action exit, Action<string> writeLog) {
        origin = new Uri(address); sdkFolder = Path.Combine(root, "windows", "webview2"); webData = Path.Combine(data, "webview2");
        closeToTray = closeAction; exitApplication = exit; log = writeLog;
        Text = "Island Now"; Icon = icon; StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(1240, 830); MinimumSize = new Size(640, 500);
        BackColor = Color.FromArgb(14, 14, 17); ForeColor = Color.FromArgb(235, 234, 241);
        loading = new Label { Text = "Island Now wird geladen …", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter, Font = new Font("Segoe UI", 13) };
        Controls.Add(loading); Shown += Initialize;
    }

    internal void Open(string fragment, bool reload = false) {
        if (fragment != null) targetFragment = fragment;
        if (WindowState == FormWindowState.Minimized) WindowState = restoreState;
        if (!Visible) Show();
        if (loaded && fragment != null) view.CoreWebView2.Navigate(Address(targetFragment));
        else if (loaded && reload) view.CoreWebView2.Reload();
        Activate();
    }

    private string Address(string fragment) { return origin.GetLeftPart(UriPartial.Authority) + "/?desktop=1" + fragment; }
    internal void Reload() { if (loaded && !shuttingDown) view.CoreWebView2.Reload(); }

    private async void Initialize(object sender, EventArgs args) {
        try {
            if (!loaderConfigured) {
                CoreWebView2Environment.SetLoaderDllFolderPath(Path.Combine(sdkFolder, ProcessArchitecture()));
                loaderConfigured = true;
            }
            var environment = await CoreWebView2Environment.CreateAsync(null, webData);
            if (shuttingDown || IsDisposed) return;
            view = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = BackColor, Visible = false };
            Controls.Add(view);
            await view.EnsureCoreWebView2Async(environment);
            if (shuttingDown || IsDisposed) return;
            var core = view.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsWebMessageEnabled = false;
            core.NewWindowRequested += delegate(object _, CoreWebView2NewWindowRequestedEventArgs e) {
                e.Handled = true;
                if (e.IsUserInitiated) OpenLink(e.Uri);
            };
            core.NavigationStarting += delegate(object _, CoreWebView2NavigationStartingEventArgs e) {
                Uri target;
                if (Uri.TryCreate(e.Uri, UriKind.Absolute, out target) && IsLocal(target)) return;
                e.Cancel = true;
                if (e.IsUserInitiated) OpenLink(e.Uri);
            };
            core.NavigationCompleted += delegate(object _, CoreWebView2NavigationCompletedEventArgs e) {
                if (shuttingDown || IsDisposed) return;
                if (e.IsSuccess) { loaded = true; view.Visible = true; view.BringToFront(); loading.Visible = false; log("Desktop-Fenster geladen."); }
                else if (!loaded && e.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled) ShowFallback("Die lokale Oberfläche konnte nicht geladen werden.", false);
            };
            core.Navigate(Address(targetFragment));
        } catch (Exception error) {
            if (shuttingDown || IsDisposed) return;
            log("WebView2: " + error.Message);
            ShowFallback(error is WebView2RuntimeNotFoundException ? "Microsoft Edge WebView2 Runtime fehlt." : "Das Fenster konnte nicht geladen werden.", true);
        }
    }

    private bool IsLocal(Uri target) {
        return target.Scheme == origin.Scheme && target.Host == origin.Host && target.Port == origin.Port && target.UserInfo.Length == 0;
    }
    private void OpenLink(string address) {
        Uri target;
        if (Uri.TryCreate(address, UriKind.Absolute, out target) && target.UserInfo.Length == 0 && (target.Scheme == Uri.UriSchemeHttps || IsLocal(target))) IslandNow.OpenBrowser(target.AbsoluteUri);
    }

    private void ShowFallback(string reason, bool showRuntimeLink) {
        if (showingFallback) return;
        showingFallback = true;
        loading.Visible = false;
        if (view != null) view.Visible = false;
        var card = new FlowLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(36), FlowDirection = FlowDirection.TopDown, WrapContents = false, BackColor = BackColor };
        card.Controls.Add(new Label { Text = "Island Now", AutoSize = true, Font = new Font("Segoe UI", 22, FontStyle.Bold), Margin = new Padding(0, 0, 0, 14) });
        card.Controls.Add(new Label { Text = reason + "\nDu kannst Island Now weiterhin im Browser verwenden.", AutoSize = true, Font = new Font("Segoe UI", 11), Margin = new Padding(0, 0, 0, 16) });
        var browser = new Button { Text = "Im Browser öffnen", AutoSize = true, Padding = new Padding(8, 4, 8, 4) };
        browser.Click += delegate { IslandNow.OpenBrowser(origin.AbsoluteUri + targetFragment); }; card.Controls.Add(browser);
        if (showRuntimeLink) {
            var runtime = new Button { Text = "WebView2 Runtime herunterladen", AutoSize = true, Padding = new Padding(8, 4, 8, 4) };
            runtime.Click += delegate { IslandNow.OpenBrowser("https://developer.microsoft.com/microsoft-edge/webview2/"); }; card.Controls.Add(runtime);
        }
        Controls.Add(card); card.BringToFront();
    }

    protected override void OnResize(EventArgs e) {
        base.OnResize(e);
        if (shuttingDown || IsDisposed) return;
        if (WindowState == FormWindowState.Minimized && Visible) Hide();
        else if (WindowState != FormWindowState.Minimized) restoreState = WindowState;
    }

    protected override void OnFormClosing(FormClosingEventArgs e) {
        if (!shuttingDown && (e.CloseReason == CloseReason.UserClosing || e.CloseReason == CloseReason.TaskManagerClosing)) {
            e.Cancel = true;
            if (e.CloseReason == CloseReason.UserClosing && closeToTray()) Hide();
            else BeginInvoke(exitApplication);
        }
        base.OnFormClosing(e);
    }

    internal void Shutdown() { if (!IsDisposed) { shuttingDown = true; Close(); Dispose(); } }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool IsWow64Process2(IntPtr process, out ushort processMachine, out ushort nativeMachine);
    private static string ProcessArchitecture() {
        if (IntPtr.Size == 4) return "x86";
        try {
            ushort processMachine, nativeMachine;
            using (var process = Process.GetCurrentProcess()) {
                if (IsWow64Process2(process.Handle, out processMachine, out nativeMachine)) return (processMachine == 0 ? nativeMachine : processMachine) == 0xaa64 ? "arm64" : "x64";
            }
        } catch (EntryPointNotFoundException) { }
        return "x64";
    }

    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
    protected override void OnHandleCreated(EventArgs e) {
        base.OnHandleCreated(e);
        try { int dark = 1; DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int)); } catch { }
    }
}
