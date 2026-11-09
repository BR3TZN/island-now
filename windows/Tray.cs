using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
[assembly: System.Reflection.AssemblyTitle("Island Now")]
[assembly: System.Reflection.AssemblyVersion("1.4.1.0")]

internal static class IslandNow {
    [STAThread] private static void Main(string[] args) {
        AppDomain.CurrentDomain.AssemblyResolve += delegate(object sender, ResolveEventArgs e) {
            string name = new AssemblyName(e.Name).Name;
            if (name != "Microsoft.Web.WebView2.Core" && name != "Microsoft.Web.WebView2.WinForms") return null;
            string path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "windows", "webview2", name + ".dll");
            return File.Exists(path) ? Assembly.LoadFrom(path) : null;
        };
        Run(args);
    }
    [MethodImpl(MethodImplOptions.NoInlining)] private static void Run(string[] args) {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        int port = 17653; string value = Environment.GetEnvironmentVariable("ISLAND_PORT");
        if (!String.IsNullOrEmpty(value) && (!Int32.TryParse(value, out port) || port < 1024 || port > 65535)) {
            MessageBox.Show("ISLAND_PORT muss zwischen 1024 und 65535 liegen.", "Island Now"); return;
        }
        bool created;
        using (Mutex single = new Mutex(true, "Local\\IslandNowTray-" + port, out created)) {
            string url = "http://127.0.0.1:" + port;
            string wakeName = "Local\\IslandNowWindow-" + port;
            if (!created) {
                try { using (var wake = EventWaitHandle.OpenExisting(wakeName)) wake.Set(); }
                catch (WaitHandleCannotBeOpenedException) { OpenBrowser(url); }
                return;
            }
            try {
                using (var wake = new EventWaitHandle(false, EventResetMode.AutoReset, wakeName)) {
                    string root = AppDomain.CurrentDomain.BaseDirectory;
                    if (!File.Exists(Path.Combine(root, "server.mjs"))) throw new FileNotFoundException("ZIP vollständig entpacken. server.mjs fehlt.");
                    string executable = NodeRuntime.EnsureAvailable(root); if (executable == null) return;
                    using (var app = new TrayContext(url, Array.IndexOf(args, "--quiet") >= 0, executable, wake)) Application.Run(app);
                }
            }
            catch (Exception error) { MessageBox.Show(error.Message, "Island Now", MessageBoxButtons.OK, MessageBoxIcon.Error); }
            finally { single.ReleaseMutex(); }
        }
    }
    internal static void OpenBrowser(string url) {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch { MessageBox.Show("Oberflaeche im Browser oeffnen:\n" + url, "Island Now"); }
    }
}
internal sealed class TrayContext : ApplicationContext {
    private readonly string root = AppDomain.CurrentDomain.BaseDirectory;
    private readonly string url, dataDir, logPath, nodeExecutable;
    private readonly EventWaitHandle wakeWindow;
    private readonly object logLock = new object();
    private readonly NotifyIcon tray;
    private readonly ToolStripMenuItem status;
    private readonly System.Windows.Forms.Timer timer;
    private Process node;
    private DesktopWindow desktop;
    private DateTime started;
    private bool ready, opening = true, disposed;
    private string openFragment;
    private volatile bool closeToTray;
    private volatile string pendingUpdate;
    internal TrayContext(string origin, bool quiet, string executable, EventWaitHandle wake) {
        url = origin; opening = !quiet; nodeExecutable = executable; wakeWindow = wake;
        string overrideData = Environment.GetEnvironmentVariable("ISLAND_DATA_DIR");
        dataDir = String.IsNullOrEmpty(overrideData) ? Path.Combine(root, ".data") : Path.GetFullPath(Path.Combine(root, overrideData));
        Directory.CreateDirectory(dataDir); logPath = Path.Combine(dataDir, "tray.log");
        if (File.Exists(logPath) && new FileInfo(logPath).Length > 524288) File.WriteAllText(logPath, "");
        ContextMenuStrip menu = new ContextMenuStrip();
        status = new ToolStripMenuItem("Island Now startet ..."); status.Enabled = false; menu.Items.Add(status);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Fenster öffnen", null, delegate { OpenFromTray(); });
        menu.Items.Add("Im Browser öffnen", null, delegate { IslandNow.OpenBrowser(url); });
        menu.Items.Add("Nach Updates suchen", null, delegate { OpenFromTray("#updates"); });
        menu.Items.Add("Neu starten", null, delegate { StopNode(); StartNode(); });
        menu.Items.Add("Protokoll oeffnen", null, delegate { try { Process.Start("notepad.exe", Quote(logPath)); } catch { } });
        menu.Items.Add(new ToolStripSeparator()); menu.Items.Add("Beenden", null, delegate { ExitThread(); });
        tray = new NotifyIcon(); tray.Icon = MakeIcon(); tray.Text = "Island Now - startet"; tray.ContextMenuStrip = menu; tray.Visible = true;
        tray.DoubleClick += delegate { OpenFromTray(); };
        timer = new System.Windows.Forms.Timer(); timer.Interval = 750; timer.Tick += Tick;
        StartNode(); timer.Start();
    }
    private static string Quote(string value) { return "\"" + value.Replace("\"", "") + "\""; }
    private void Log(string line) {
        if (String.IsNullOrEmpty(line)) return;
        try { lock (logLock) File.AppendAllText(logPath, DateTime.Now.ToString("s") + " " + line + Environment.NewLine); } catch { }
    }
    private bool Probe() {
        try {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url + "/api/state");
            request.Proxy = null; request.Timeout = 400; request.ReadWriteTimeout = 400;
            using (WebResponse response = request.GetResponse()) using (StreamReader reader = new StreamReader(response.GetResponseStream()))
                return reader.ReadToEnd().IndexOf("\"app\":\"Island Now\"", StringComparison.Ordinal) >= 0;
        } catch { return false; }
    }
    private void StartNode() {
        ready = false; started = DateTime.Now;
        try {
            if (Probe()) throw new InvalidOperationException("Island Now laeuft bereits auf diesem Port. Den bisherigen CMD-Start zuerst beenden.");
            node = new Process();
            node.StartInfo = new ProcessStartInfo(nodeExecutable, Quote(Path.Combine(root, "server.mjs")) + " --tray") {
                UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden, WorkingDirectory = root,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
            };
            node.StartInfo.EnvironmentVariables.Remove("NODE_OPTIONS"); node.StartInfo.EnvironmentVariables.Remove("NODE_PATH");
            node.OutputDataReceived += delegate(object sender, DataReceivedEventArgs args) {
                if (args.Data != null && args.Data.StartsWith("ISLAND_UPDATE_READY:")) {
                    string token = args.Data.Substring("ISLAND_UPDATE_READY:".Length);
                    if (System.Text.RegularExpressions.Regex.IsMatch(token, "^[a-f0-9]{32}$")) pendingUpdate = token;
                } else if (args.Data == "ISLAND_CLOSE_ACTION:tray" || args.Data == "ISLAND_CLOSE_ACTION:exit") {
                    closeToTray = args.Data.EndsWith(":tray", StringComparison.Ordinal);
                } else Log(args.Data);
            };
            node.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs args) { Log(args.Data); };
            node.Start(); node.BeginOutputReadLine(); node.BeginErrorReadLine(); status.Text = "Island Now startet ...";
        } catch (Exception error) {
            StopNode(); status.Text = "Start fehlgeschlagen"; tray.Text = "Island Now - gestoppt"; Log(error.Message);
            MessageBox.Show(error.Message, "Island Now", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
    private void Tick(object sender, EventArgs args) {
        if (pendingUpdate != null) { string token = pendingUpdate; pendingUpdate = null; StartInstaller(token); return; }
        if (wakeWindow.WaitOne(0)) OpenInterface();
        if (node == null) return;
        if (node.HasExited) {
            node.Dispose(); node = null; ready = false; status.Text = "Server gestoppt"; tray.Text = "Island Now - gestoppt";
            tray.ShowBalloonTip(5000, "Island Now wurde gestoppt", "Rechtsklick: Neu starten oder Protokoll oeffnen.", ToolTipIcon.Warning); return;
        }
        if (!ready && Probe()) {
            ready = true; status.Text = "Server laeuft"; tray.Text = "Island Now - laeuft im Hintergrund";
            if (opening) {
                string fragment = openFragment;
                opening = false; openFragment = null;
                OpenInterface(fragment, true);
            } else if (desktop != null) desktop.Reload();
        } else if (!ready && (DateTime.Now - started).TotalSeconds > 20) {
            StopNode(); status.Text = "Start fehlgeschlagen"; tray.Text = "Island Now - gestoppt";
            tray.ShowBalloonTip(6000, "Island Now konnte nicht starten", "Rechtsklick und Protokoll oeffnen.", ToolTipIcon.Error);
        }
    }
    private void OpenFromTray(string fragment = null) {
        // Let the tray menu release activation before bringing the requested window forward.
        var ui = SynchronizationContext.Current as WindowsFormsSynchronizationContext;
        if (ui != null) ui.Post(delegate { OpenInterface(fragment); }, null);
        else OpenInterface(fragment);
    }
    private void OpenInterface(string fragment = null, bool reload = false) {
        if (disposed) return;
        if (!ready) { opening = true; if (fragment != null) openFragment = fragment; return; }
        try { ShowDesktop(fragment, reload); }
        catch (Exception error) { Log(error.Message); IslandNow.OpenBrowser(url + "/" + fragment); }
    }
    [MethodImpl(MethodImplOptions.NoInlining)] private void ShowDesktop(string fragment, bool reload) {
        if (desktop == null || desktop.IsDisposed)
            desktop = new DesktopWindow(url, root, dataDir, tray.Icon, () => closeToTray, ExitThread, Log);
        desktop.Open(fragment, reload);
    }
    private void StartInstaller(string token) {
        try {
            string stage = Path.Combine(root, ".updates", "pending", token);
            string script = Path.Combine(stage, "Install-Update.ps1"), plan = Path.Combine(stage, "plan.json");
            if (!File.Exists(script) || !File.Exists(plan)) throw new FileNotFoundException("Der Update-Plan fehlt.");
            string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
            Process.Start(new ProcessStartInfo(powershell, "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " + Quote(script) + " -PlanPath " + Quote(plan) + " -TrayPid " + Process.GetCurrentProcess().Id) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = root });
            ExitThread();
        } catch (Exception error) { Log(error.Message); MessageBox.Show("Update konnte nicht gestartet werden.\n" + error.Message, "Island Now"); }
    }
    private void StopNode() {
        Process owned = node; node = null; if (owned == null) return;
        try {
            if (!owned.HasExited) {
                try { owned.StandardInput.WriteLine("shutdown"); owned.StandardInput.Flush(); } catch { }
                if (!owned.WaitForExit(2500)) { owned.Kill(); owned.WaitForExit(1000); }
            }
        } catch { } finally { owned.Dispose(); }
    }
    protected override void ExitThreadCore() { Cleanup(); base.ExitThreadCore(); }
    protected override void Dispose(bool disposing) { if (disposing) Cleanup(); base.Dispose(disposing); }
    private void Cleanup() {
        if (disposed) return; disposed = true; timer.Stop(); timer.Dispose();
        if (desktop != null) desktop.Shutdown();
        StopNode(); tray.Visible = false;
        Icon icon = tray.Icon; ContextMenuStrip menu = tray.ContextMenuStrip; tray.Dispose(); icon.Dispose(); menu.Dispose();
    }
    [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr handle);
    private static Icon MakeIcon() {
        using (Bitmap bitmap = new Bitmap(32, 32)) {
            using (Graphics graphics = Graphics.FromImage(bitmap)) using (Brush dark = new SolidBrush(Color.FromArgb(15, 24, 18))) using (Brush mint = new SolidBrush(Color.FromArgb(185, 239, 202))) {
                graphics.Clear(Color.Transparent); graphics.FillRectangle(dark, 1, 1, 30, 30);
                graphics.FillRectangle(mint, 8, 7, 6, 19); graphics.FillRectangle(mint, 19, 7, 6, 14);
            }
            IntPtr handle = bitmap.GetHicon();
            try { using (Icon source = Icon.FromHandle(handle)) return (Icon)source.Clone(); } finally { DestroyIcon(handle); }
        }
    }
}
