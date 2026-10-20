using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
[assembly: System.Reflection.AssemblyTitle("Island Now")]
[assembly: System.Reflection.AssemblyVersion("1.2.0.0")]

internal static class IslandNow {
    [STAThread] private static void Main(string[] args) {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        int port = 17653; string value = Environment.GetEnvironmentVariable("ISLAND_PORT");
        if (!String.IsNullOrEmpty(value) && (!Int32.TryParse(value, out port) || port < 1024 || port > 65535)) {
            MessageBox.Show("ISLAND_PORT muss zwischen 1024 und 65535 liegen.", "Island Now"); return;
        }
        bool created;
        using (Mutex single = new Mutex(true, "Local\\IslandNowTray-" + port, out created)) {
            string url = "http://127.0.0.1:" + port;
            if (!created) { OpenBrowser(url); return; }
            try { using (TrayContext app = new TrayContext(url, Array.IndexOf(args, "--quiet") >= 0)) Application.Run(app); }
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
    private readonly string url, logPath;
    private readonly object logLock = new object();
    private readonly NotifyIcon tray;
    private readonly ToolStripMenuItem status;
    private readonly System.Windows.Forms.Timer timer;
    private Process node;
    private DateTime started;
    private bool ready, opening = true, disposed;
    private volatile string pendingUpdate;
    internal TrayContext(string origin, bool quiet) {
        url = origin; opening = !quiet;
        if (!File.Exists(Path.Combine(root, "server.mjs"))) throw new FileNotFoundException("ZIP vollstaendig entpacken. server.mjs fehlt.");
        Directory.CreateDirectory(Path.Combine(root, ".data")); logPath = Path.Combine(root, ".data", "tray.log");
        if (File.Exists(logPath) && new FileInfo(logPath).Length > 524288) File.WriteAllText(logPath, "");
        ContextMenuStrip menu = new ContextMenuStrip();
        status = new ToolStripMenuItem("Island Now startet ..."); status.Enabled = false; menu.Items.Add(status);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Oberflaeche oeffnen", null, delegate { IslandNow.OpenBrowser(url); });
        menu.Items.Add("Nach Updates suchen", null, delegate { IslandNow.OpenBrowser(url + "/#updates"); });
        menu.Items.Add("Neu starten", null, delegate { opening = false; StopNode(); StartNode(); });
        menu.Items.Add("Protokoll oeffnen", null, delegate { try { Process.Start("notepad.exe", Quote(logPath)); } catch { } });
        menu.Items.Add(new ToolStripSeparator()); menu.Items.Add("Beenden", null, delegate { ExitThread(); });
        tray = new NotifyIcon(); tray.Icon = MakeIcon(); tray.Text = "Island Now - startet"; tray.ContextMenuStrip = menu; tray.Visible = true;
        tray.DoubleClick += delegate { IslandNow.OpenBrowser(url); };
        timer = new System.Windows.Forms.Timer(); timer.Interval = 750; timer.Tick += Tick;
        StartNode(); timer.Start();
    }
    private static string Quote(string value) { return "\"" + value.Replace("\"", "") + "\""; }
    private void Log(string line) {
        if (String.IsNullOrEmpty(line)) return;
        try { lock (logLock) File.AppendAllText(logPath, DateTime.Now.ToString("s") + " " + line + Environment.NewLine); } catch { }
    }
    private string FindNode() {
        string portable = Path.Combine(root, "runtime", "node.exe"); if (File.Exists(portable)) return portable;
        foreach (string folder in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator)) {
            try { string path = Path.Combine(folder.Trim().Trim('"'), "node.exe"); if (File.Exists(path)) return path; } catch { }
        }
        foreach (string key in new string[] { "ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA" }) {
            string folder = Environment.GetEnvironmentVariable(key); if (String.IsNullOrEmpty(folder)) continue;
            string path = Path.Combine(folder, "nodejs", "node.exe"); if (File.Exists(path)) return path;
        }
        throw new FileNotFoundException("Node.js ab Version 22 installieren: https://nodejs.org/\nDanach Island Now erneut starten.");
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
            string executable = FindNode();
            using (Process check = new Process()) {
                check.StartInfo = new ProcessStartInfo(executable, "-p process.versions.node") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true };
                check.Start(); if (!check.WaitForExit(5000)) { check.Kill(); throw new InvalidOperationException("Node.js antwortet nicht."); }
                int major; string version = check.StandardOutput.ReadToEnd().Trim();
                if (!Int32.TryParse(version.Split('.')[0], out major) || major < 22) throw new InvalidOperationException("Node.js ab Version 22 erforderlich: https://nodejs.org/");
            }
            node = new Process();
            node.StartInfo = new ProcessStartInfo(executable, Quote(Path.Combine(root, "server.mjs")) + " --tray") {
                UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden, WorkingDirectory = root,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
            };
            node.OutputDataReceived += delegate(object sender, DataReceivedEventArgs args) {
                if (args.Data != null && args.Data.StartsWith("ISLAND_UPDATE_READY:")) {
                    string token = args.Data.Substring("ISLAND_UPDATE_READY:".Length);
                    if (System.Text.RegularExpressions.Regex.IsMatch(token, "^[a-f0-9]{32}$")) pendingUpdate = token;
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
        if (node == null) return;
        if (node.HasExited) {
            node.Dispose(); node = null; ready = false; status.Text = "Server gestoppt"; tray.Text = "Island Now - gestoppt";
            tray.ShowBalloonTip(5000, "Island Now wurde gestoppt", "Rechtsklick: Neu starten oder Protokoll oeffnen.", ToolTipIcon.Warning); return;
        }
        if (!ready && Probe()) {
            ready = true; status.Text = "Server laeuft"; tray.Text = "Island Now - laeuft im Hintergrund";
            if (opening) { opening = false; IslandNow.OpenBrowser(url); }
        } else if (!ready && (DateTime.Now - started).TotalSeconds > 20) {
            StopNode(); status.Text = "Start fehlgeschlagen"; tray.Text = "Island Now - gestoppt";
            tray.ShowBalloonTip(6000, "Island Now konnte nicht starten", "Rechtsklick und Protokoll oeffnen.", ToolTipIcon.Error);
        }
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
        if (disposed) return; disposed = true; timer.Stop(); timer.Dispose(); StopNode(); tray.Visible = false;
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
