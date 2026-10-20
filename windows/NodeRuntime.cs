using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

internal sealed class NodePackage {
    internal readonly string Architecture, ArchiveHash, BinaryHash;
    internal const string Version = "24.22.0";
    internal string Folder { get { return "node-v" + Version + "-win-" + Architecture; } }
    internal Uri Url { get { return new Uri("https://nodejs.org/dist/v" + Version + "/" + Folder + ".zip"); } }
    internal NodePackage(string architecture, string archiveHash, string binaryHash) { Architecture = architecture; ArchiveHash = archiveHash; BinaryHash = binaryHash; }
}

internal static class NodeRuntime {
    internal static readonly Version Minimum = new Version(22, 0, 0);
    // Pinned official release checksums: https://nodejs.org/en/blog/release/v24.22.0
    internal static NodePackage PackageFor(string architecture) {
        if (architecture == "x64") return new NodePackage("x64", "f9683a19877e12a9b167305c8db71040d812876359de21f0d2e97c3f321f80c3", "ba93f9a70bd86fce3ebbb39ec758501458453467aa92a34a0a3602d1e3fc2b9c");
        if (architecture == "arm64") return new NodePackage("arm64", "3a5c209a5bc59e65b3bc0fa13ed5e166a26bd3d55332847f498b76b037408d61", "df4b0e71e4e4d022bf8582fbe75f6061feb9c4a111a86f3fec6300d24b6fe5e0");
        throw new PlatformNotSupportedException("Die automatische Node-Einrichtung benoetigt Windows x64 oder ARM64.");
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool IsWow64Process2(IntPtr process, out ushort processMachine, out ushort nativeMachine);
    internal static string ArchitectureFor(ushort machine) {
        if (machine == 0x8664) return "x64";
        if (machine == 0xaa64) return "arm64";
        throw new PlatformNotSupportedException("Die automatische Node-Einrichtung benoetigt Windows x64 oder ARM64.");
    }
    internal static NodePackage NativePackage() {
        ushort processMachine, nativeMachine;
        using (Process process = Process.GetCurrentProcess()) {
            if (!IsWow64Process2(process.Handle, out processMachine, out nativeMachine)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        return PackageFor(ArchitectureFor(nativeMachine));
    }
    internal static Version ReadVersion(string executable) {
        try {
            if (!File.Exists(executable)) return null;
            using (Process process = new Process()) {
                ProcessStartInfo info = new ProcessStartInfo(executable, "-p process.versions.node") {
                    UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true
                };
                info.EnvironmentVariables.Remove("NODE_OPTIONS"); info.EnvironmentVariables.Remove("NODE_PATH");
                process.StartInfo = info; process.Start();
                Task<string> output = process.StandardOutput.ReadToEndAsync(), errors = process.StandardError.ReadToEndAsync();
                if (!process.WaitForExit(4000)) { try { process.Kill(); process.WaitForExit(1000); } catch { } return null; }
                Version version;
                string text = output.GetAwaiter().GetResult().Trim();
                if (process.ExitCode != 0 || text.Length > 32 || !System.Text.RegularExpressions.Regex.IsMatch(text, "^[0-9]+\\.[0-9]+\\.[0-9]+$") || !Version.TryParse(text, out version)) return null;
                errors.GetAwaiter().GetResult();
                return version;
            }
        } catch { return null; }
    }
    internal static string FindCompatible(IEnumerable<string> candidates) {
        HashSet<string> checkedPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string candidate in candidates) {
            if (String.IsNullOrWhiteSpace(candidate)) continue;
            string path; try { path = Path.GetFullPath(candidate); } catch { continue; }
            if (!checkedPaths.Add(path)) continue;
            Version version = ReadVersion(path);
            if (version != null && version >= Minimum) return path;
        }
        return null;
    }
    private static IEnumerable<string> SystemCandidates(string root) {
        string portable = Path.GetFullPath(Path.Combine(root, "runtime", "node.exe"));
        foreach (string folder in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator)) {
            if (String.IsNullOrWhiteSpace(folder)) continue;
            string path; try { path = Path.GetFullPath(Path.Combine(folder.Trim().Trim('"'), "node.exe")); } catch { continue; }
            if (!String.Equals(path, portable, StringComparison.OrdinalIgnoreCase)) yield return path;
        }
        foreach (string key in new string[] { "ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA" }) {
            string folder = Environment.GetEnvironmentVariable(key);
            if (!String.IsNullOrWhiteSpace(folder)) yield return Path.Combine(folder, "nodejs", "node.exe");
        }
    }
    internal static string FindAvailable(string root, IEnumerable<string> systemCandidates) {
        string installed = FindCompatible(systemCandidates);
        if (installed != null) return installed;
        string portable = Path.Combine(root, "runtime", "node.exe");
        Version version = ReadVersion(portable);
        return version != null && version >= new Version(NodePackage.Version) ? portable : null;
    }
    internal static string EnsureAvailable(string root) {
        string existing = FindAvailable(root, SystemCandidates(root));
        if (existing != null) return existing;
        using (NodeSetupForm setup = new NodeSetupForm(root, NativePackage())) {
            return setup.ShowDialog() == DialogResult.OK ? setup.Executable : null;
        }
    }
    internal static void VerifyHash(string file, string expected) {
        using (SHA256 hash = SHA256.Create()) using (FileStream input = File.OpenRead(file)) {
            string actual = BitConverter.ToString(hash.ComputeHash(input)).Replace("-", "").ToLowerInvariant();
            if (!String.Equals(actual, expected, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Die Node-Datei hat eine falsche Pruefsumme. Es wurde nichts installiert.");
        }
    }
    private static void ExtractFile(ZipArchive archive, string entryName, string output, long limit) {
        ZipArchiveEntry entry = archive.GetEntry(entryName);
        if (entry == null || entry.Length < 1 || entry.Length > limit) throw new InvalidDataException("Das Node-Paket ist unvollstaendig.");
        using (Stream input = entry.Open()) using (FileStream file = File.Create(output)) input.CopyTo(file);
        if (new FileInfo(output).Length != entry.Length) throw new InvalidDataException("Das Node-Paket ist beschaedigt.");
    }
    private static void MoveIntoPlace(string source, string destination) {
        if (File.Exists(destination)) File.Replace(source, destination, null); else File.Move(source, destination);
    }
    internal static string InstallArchive(string archivePath, string scratch, string runtime, NodePackage package, CancellationToken cancellation) {
        cancellation.ThrowIfCancellationRequested(); VerifyHash(archivePath, package.ArchiveHash);
        string executable = Path.Combine(scratch, "node.exe"), license = Path.Combine(scratch, "LICENSE");
        using (ZipArchive archive = ZipFile.OpenRead(archivePath)) {
            ExtractFile(archive, package.Folder + "/node.exe", executable, 160L * 1024 * 1024);
            ExtractFile(archive, package.Folder + "/LICENSE", license, 1024 * 1024);
        }
        VerifyHash(executable, package.BinaryHash);
        cancellation.ThrowIfCancellationRequested();
        Version actual = ReadVersion(executable);
        if (actual == null || actual != new Version(NodePackage.Version)) throw new InvalidDataException("Die heruntergeladene Node-Version konnte nicht gestartet werden.");
        cancellation.ThrowIfCancellationRequested();
        MoveIntoPlace(license, Path.Combine(runtime, "LICENSE"));
        string destination = Path.Combine(runtime, "node.exe"); MoveIntoPlace(executable, destination);
        return destination;
    }
    internal static async Task<string> DownloadAndInstallAsync(string root, NodePackage package, Action<int, string> report, CancellationToken cancellation) {
        cancellation.ThrowIfCancellationRequested();
        string runtime = Path.Combine(root, "runtime"); Directory.CreateDirectory(runtime);
        if ((File.GetAttributes(runtime) & FileAttributes.ReparsePoint) != 0) throw new IOException("Der runtime-Ordner darf keine Verknuepfung sein.");
        string scratch = Path.Combine(runtime, ".setup-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(scratch);
        try {
            string archive = Path.Combine(scratch, "node.zip");
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            using (NodeDownloadClient client = new NodeDownloadClient()) using (cancellation.Register(client.CancelAsync)) {
                bool tooLarge = false;
                client.DownloadProgressChanged += delegate(object sender, DownloadProgressChangedEventArgs args) {
                    if (args.TotalBytesToReceive > 64L * 1024 * 1024 || args.BytesReceived > 64L * 1024 * 1024) { tooLarge = true; client.CancelAsync(); return; }
                    if (report != null) report(Math.Max(0, Math.Min(95, args.ProgressPercentage * 95 / 100)), "Node.js wird heruntergeladen ...");
                };
                try { await client.DownloadFileTaskAsync(package.Url, archive); }
                catch { if (tooLarge) throw new InvalidDataException("Das Node-Paket ist unerwartet gross."); cancellation.ThrowIfCancellationRequested(); throw; }
            }
            cancellation.ThrowIfCancellationRequested();
            if (report != null) report(96, "Download wird geprueft und eingerichtet ...");
            return await Task.Run(() => InstallArchive(archive, scratch, runtime, package, cancellation));
        } finally { try { if (Directory.Exists(scratch)) Directory.Delete(scratch, true); } catch { } }
    }
    private sealed class NodeDownloadClient : WebClient {
        protected override WebRequest GetWebRequest(Uri address) {
            if (address.Scheme != "https" || address.Host != "nodejs.org") throw new InvalidOperationException("Unerwartete Node-Downloadadresse.");
            HttpWebRequest request = (HttpWebRequest)base.GetWebRequest(address);
            request.AllowAutoRedirect = false; request.Timeout = 30000; request.ReadWriteTimeout = 30000;
            request.UserAgent = "Island-Now-Setup";
            return request;
        }
    }
}

internal sealed class NodeSetupForm : Form {
    private readonly string root;
    private readonly NodePackage package;
    private readonly Label status;
    private readonly ProgressBar progress;
    private readonly Button cancel;
    private CancellationTokenSource cancellation;
    private bool finished, cancelRequested;
    internal string Executable { get; private set; }
    internal NodeSetupForm(string folder, NodePackage selected) {
        root = folder; package = selected;
        Text = "Island Now - Erste Einrichtung"; ClientSize = new Size(460, 235);
        FormBorderStyle = FormBorderStyle.FixedDialog; StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false; MinimizeBox = false; Font = new Font("Segoe UI", 9);
        BackColor = Color.FromArgb(23, 24, 28); ForeColor = Color.FromArgb(241, 241, 244);
        Label heading = new Label { Text = "Island Now wird vorbereitet", Location = new Point(24, 22), Size = new Size(410, 28), Font = new Font("Segoe UI", 13, FontStyle.Bold) };
        Label detail = new Label { Text = "Die benoetigte Node.js-Laufzeit wird einmalig eingerichtet.\nDanach startet Island Now automatisch. Keine Adminrechte noetig.", Location = new Point(24, 63), Size = new Size(410, 44) };
        progress = new ProgressBar { Location = new Point(24, 123), Size = new Size(412, 12), Maximum = 100 };
        status = new Label { Text = "Verbindung zu nodejs.org wird hergestellt ...", Location = new Point(24, 145), Size = new Size(412, 24) };
        cancel = new Button { Text = "Abbrechen", Location = new Point(331, 186), Size = new Size(105, 30), FlatStyle = FlatStyle.Flat };
        cancel.Click += delegate { CancelSetup(); };
        Controls.AddRange(new Control[] { heading, detail, progress, status, cancel });
        FormClosing += delegate(object sender, FormClosingEventArgs args) { if (!finished) { args.Cancel = true; CancelSetup(); } };
        Shown += StartSetup;
    }
    private void CancelSetup() {
        cancelRequested = true; cancel.Enabled = false; status.Text = "Einrichtung wird abgebrochen ...";
        if (cancellation != null) cancellation.Cancel();
    }
    private async void StartSetup(object sender, EventArgs args) {
        using (cancellation = new CancellationTokenSource(300000)) {
            try {
                Executable = await NodeRuntime.DownloadAndInstallAsync(root, package, delegate(int value, string text) {
                    if (!cancelRequested && !IsDisposed) { progress.Value = value; status.Text = text; }
                }, cancellation.Token);
                finished = true; DialogResult = DialogResult.OK; Close();
            } catch (Exception error) {
                if (!cancelRequested) MessageBox.Show(this, "Node.js konnte nicht eingerichtet werden. Internetverbindung und Schreibrechte im entpackten Ordner pruefen und Island Now erneut starten.\n\n" + (error is OperationCanceledException ? "Zeitlimit der Einrichtung erreicht." : error.Message), "Island Now", MessageBoxButtons.OK, MessageBoxIcon.Error);
                finished = true; DialogResult = DialogResult.Cancel; Close();
            }
        }
    }
}
