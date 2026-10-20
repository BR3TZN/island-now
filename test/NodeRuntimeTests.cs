using System;
using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Threading;

internal static class NodeRuntimeTests {
    private static int checks;
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); checks++; }
    private static void Reject(Action action, string message) {
        try { action(); } catch (InvalidDataException) { checks++; return; }
        throw new Exception(message);
    }
    private static string Hash(string file) {
        using (SHA256 hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(File.ReadAllBytes(file))).Replace("-", "").ToLowerInvariant();
    }
    private static void Entry(ZipArchive archive, string name, byte[] bytes) {
        using (Stream stream = archive.CreateEntry(name).Open()) stream.Write(bytes, 0, bytes.Length);
    }
    private static int Main(string[] args) {
        string root = Path.Combine(Path.GetTempPath(), "island node tests " + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try {
            string real = args[0], old = args[1], pinned = args[2];
            string missing = Path.Combine(root, "missing.exe");
            Version oldVersion = NodeRuntime.ReadVersion(old);
            Check(oldVersion == new Version(20, 99, 0), "Alte Node-Version nicht erkannt: " + old + "; Datei vorhanden: " + File.Exists(old) + "; erkannt: " + (oldVersion == null ? "null" : oldVersion.ToString()));
            Check(NodeRuntime.FindCompatible(new string[] { missing, old, real }) == Path.GetFullPath(real), "Kompatibles Node nach alter Version nicht gefunden.");
            Check(NodeRuntime.FindCompatible(new string[] { old, missing }) == null, "Zu alte Node-Version akzeptiert.");
            Check(NodeRuntime.ArchitectureFor(0x8664) == "x64" && NodeRuntime.ArchitectureFor(0xaa64) == "arm64", "Falsche Architektur.");
            try { NodeRuntime.ArchitectureFor(0x014c); throw new Exception("32-Bit-Windows akzeptiert."); } catch (PlatformNotSupportedException) { checks++; }
            string runtime = Path.Combine(root, "runtime"); Directory.CreateDirectory(runtime);
            string portable = Path.Combine(runtime, "node.exe");
            File.Copy(old, portable);
            Check(NodeRuntime.FindAvailable(root, new string[0]) == null, "Alte private Laufzeit akzeptiert.");
            File.Copy(pinned, portable, true);
            Check(NodeRuntime.FindAvailable(root, new string[0]) == portable, "Private Laufzeit nicht wiederverwendet.");
            Check(NodeRuntime.FindAvailable(root, new string[] { real }) == Path.GetFullPath(real), "Vorhandenes kompatibles Node nicht bevorzugt.");
            string previous = Hash(portable);
            string scratch = Path.Combine(root, "scratch"); Directory.CreateDirectory(scratch);
            string archivePath = Path.Combine(scratch, "node.zip"); File.WriteAllText(archivePath, "broken download");
            NodePackage official = NodeRuntime.PackageFor("x64");
            Reject(() => NodeRuntime.InstallArchive(archivePath, scratch, runtime, official, CancellationToken.None), "Falsche ZIP-Pruefsumme akzeptiert.");
            Check(Hash(portable) == previous, "Fehlerhafter Download hat die Laufzeit ersetzt.");
            File.Delete(archivePath);
            using (ZipArchive zip = ZipFile.Open(archivePath, ZipArchiveMode.Create)) {
                Entry(zip, official.Folder + "/node.exe", File.ReadAllBytes(pinned));
                Entry(zip, official.Folder + "/LICENSE", new byte[] { 65 });
            }
            NodePackage badBinary = new NodePackage("x64", Hash(archivePath), new string('0', 64));
            Reject(() => NodeRuntime.InstallArchive(archivePath, scratch, runtime, badBinary, CancellationToken.None), "Falsche EXE-Pruefsumme akzeptiert.");
            Check(Hash(portable) == previous, "Falsche EXE hat die vorhandene Laufzeit ersetzt.");
            string cancelledRoot = Path.Combine(root, "cancelled");
            using (CancellationTokenSource cancellation = new CancellationTokenSource()) {
                cancellation.Cancel();
                try { NodeRuntime.DownloadAndInstallAsync(cancelledRoot, official, null, cancellation.Token).GetAwaiter().GetResult(); throw new Exception("Abbruch ignoriert."); }
                catch (OperationCanceledException) { checks++; }
            }
            Check(!Directory.Exists(cancelledRoot), "Abgebrochener Start hat Dateien angelegt.");
            if (args.Length > 3) {
                string downloadRoot = args[3];
                NodePackage package = NodeRuntime.NativePackage();
                using (CancellationTokenSource timeout = new CancellationTokenSource(300000)) {
                    string executable = NodeRuntime.DownloadAndInstallAsync(downloadRoot, package, null, timeout.Token).GetAwaiter().GetResult();
                    Check(NodeRuntime.ReadVersion(executable) == new Version(NodePackage.Version), "Offizielle Laufzeit nicht startbar.");
                    NodeRuntime.VerifyHash(executable, package.BinaryHash);
                    Check(File.Exists(Path.Combine(downloadRoot, "runtime", "LICENSE")), "Node-Lizenz fehlt.");
                    Check(NodeRuntime.FindAvailable(downloadRoot, new string[0]) == executable, "Erneuter Start ohne System-Node fehlgeschlagen.");
                    Check(Directory.GetDirectories(Path.Combine(downloadRoot, "runtime"), ".setup-*").Length == 0, "Downloadreste vorhanden.");
                }
                Console.WriteLine("Offizieller Node-Download, SHA-256, Installation und Wiederverwendung geprueft.");
            }
            Console.WriteLine(checks + " Node-Erststart-Pruefungen bestanden."); return 0;
        } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        finally { try { Directory.Delete(root, true); } catch { } }
    }
}
