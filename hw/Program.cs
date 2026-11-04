// Air Register hardware helper (Windows, .NET Framework 4.8, x86).
// Replaces the AIR POS "Pfa.Retail.Terminal.Console" hardware service so the
// register needs no AIR POS install. Logic mirrors that service 1:1:
//   * device id  : %ProgramData%\AirPos\device_id.txt, else MD5(cpu-bios-disk-mac)
//   * old id     : MD5(cpu-bios-disk-osVersion), fallback MD5(ProductId)
//   * printer    : given name, else POS-80, *POS-80*, keywords, default, first
//   * receipts   : server PDF rendered with PDFium onto the Windows printer
//   * drawer     : raw ESC p 0 128 128 (27,112,0,128,128) through the spooler
// Air Register additions: printer details (driver, port, offline) for the Settings picker, raw jobs that are
// watched until the printer takes them (offline / paper out / stuck -> job cancelled + plain error), COM-port list
// (Epson TM Virtual Port shows up as a COM port), PDF -> 1-bit picture for driverless ESC/POS and Star raster.
// Protocol: one JSON object per line on stdin, one JSON reply per line on stdout.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Printing;
using System.IO;
using System.Linq;
using System.Management;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace AirRegisterHw
{
    static class Program
    {
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

        static int Main(string[] args)
        {
            Console.InputEncoding = new UTF8Encoding(false);
            Console.OutputEncoding = new UTF8Encoding(false);
            if (args.Length > 0 && args[0] != "--serve")
            {
                // one-shot: AirRegisterHw.exe <cmd> [jsonArgs]
                var req = args.Length > 1 ? Json.Deserialize<Dictionary<string, object>>(args[1]) : new Dictionary<string, object>();
                req["cmd"] = args[0];
                Console.WriteLine(Json.Serialize(Handle(req)));
                return 0;
            }
            string line;
            while ((line = Console.In.ReadLine()) != null)
            {
                if (line.Trim().Length == 0) continue;
                object id = null;
                Dictionary<string, object> reply;
                try
                {
                    var req = Json.Deserialize<Dictionary<string, object>>(line);
                    req.TryGetValue("id", out id);
                    reply = Handle(req);
                }
                catch (Exception ex) { reply = Err(ex); }
                reply["id"] = id;
                Console.Out.WriteLine(Json.Serialize(reply));
                Console.Out.Flush();
            }
            return 0;
        }

        static Dictionary<string, object> Ok(object value) => new Dictionary<string, object> { { "ok", true }, { "value", value } };
        static Dictionary<string, object> Err(Exception ex)
        {
            while (ex is System.Reflection.TargetInvocationException && ex.InnerException != null) ex = ex.InnerException;
            return new Dictionary<string, object> { { "ok", false }, { "error", ex.Message } };
        }
        static string S(Dictionary<string, object> d, string k) => d.TryGetValue(k, out var v) && v != null ? v.ToString() : null;

        static Dictionary<string, object> Handle(Dictionary<string, object> req)
        {
            try
            {
                switch (S(req, "cmd"))
                {
                    case "ping": return Ok("pong");
                    case "deviceInfo":
                        return Ok(new Dictionary<string, object> {
                            { "deviceName", Environment.MachineName },
                            { "deviceId", Device.GetDeviceId() },
                            { "oldDeviceId", Device.GetOldDeviceId() } });
                    case "printers":
                        {
                            var list = Printers.Installed();
                            string def = null;
                            try { def = new PrinterSettings().PrinterName; } catch { }
                            string resolved = null;
                            try { resolved = Printers.Resolve(S(req, "printer")); } catch { }
                            object details = null;
                            try { details = Printers.Details(); } catch (Exception ex) { details = "unavailable: " + ex.Message; }
                            if (details is List<Dictionary<string, object>> dl) foreach (var d in dl) { var n = d["name"] as string; var dr = d["driver"] as string; var po = d["port"] as string; d["receipt"] = Printers.IsReceipt(n, dr, po); d["virtual"] = Printers.IsVirtual(n, dr, po); d["isDefault"] = string.Equals(n, def, StringComparison.OrdinalIgnoreCase); try { d["xpsDriver"] = Raw.IsXpsDriver(n); } catch { } }
                            return Ok(new Dictionary<string, object> { { "printers", list }, { "default", def }, { "resolved", resolved }, { "reason", Printers.LastReason }, { "details", details }, { "helper", "1.2.1" }, { "clr", Environment.Version.ToString() }, { "os", Environment.OSVersion.VersionString }, { "is64", Environment.Is64BitOperatingSystem } });
                        }
                    case "resolve": return Ok(Printers.Resolve(S(req, "printer")));
                    case "raw":
                        {
                            var name = Printers.Resolve(S(req, "printer"), S(req, "strict") == "1");
                            int wait = int.TryParse(S(req, "waitMs"), out var wm) ? wm : 0;
                            var state = Raw.Send(name, Convert.FromBase64String(S(req, "base64")), S(req, "doc") ?? "Air Register", wait);
                            return Ok(new Dictionary<string, object> { { "printer", name }, { "state", state }, { "reason", Printers.LastReason }, { "datatype", Raw.LastDatatype } });
                        }
                    case "drawer":
                        {
                            var name = Printers.Resolve(S(req, "printer"), S(req, "strict") == "1");
                            var kind = (S(req, "kind") ?? "escpos").ToLowerInvariant();
                            byte[] bytes = S(req, "base64") != null ? Convert.FromBase64String(S(req, "base64"))
                                         : kind == "star" ? new byte[] { 0x07 }
                                         : kind == "both" ? new byte[] { 27, 112, 0, 128, 128, 0x07 }
                                         : new byte[] { 27, 112, 0, 128, 128 };
                            int wait = int.TryParse(S(req, "waitMs"), out var wm) ? wm : 0;
                            Raw.Send(name, bytes, "Air Register drawer", wait);
                            return Ok(name);
                        }
                    case "drawerDriver":
                        {
                            // Star futurePRNT: open the drawer through the Windows driver (the queue may refuse RAW jobs).
                            var name = Printers.Resolve(S(req, "printer"), S(req, "strict") == "1");
                            return Ok(new Dictionary<string, object> { { "printer", name }, { "state", DriverDrawer.Open(name, S(req, "ch") ?? "A") }, { "reason", Printers.LastReason } });
                        }
                    case "printPdf":
                        {
                            var data = Convert.FromBase64String(S(req, "base64"));
                            var name = Printers.Resolve(S(req, "printer"), S(req, "strict") == "1");
                            using (var doc = new Pdf(data)) PdfPrint.Print(doc, name);
                            return Ok(new Dictionary<string, object> { { "printer", name }, { "state", "driver" }, { "reason", Printers.LastReason } });
                        }
                    case "renderPng":
                        {
                            var data = Convert.FromBase64String(S(req, "base64"));
                            int dpi = int.TryParse(S(req, "dpi"), out var d) ? d : 203;
                            using (var doc = new Pdf(data)) PdfPrint.RenderPng(doc, S(req, "out"), dpi);
                            return Ok(S(req, "out"));
                        }
                    case "renderMono":
                        {
                            // PDF -> 1-bit bitmap exactly <dots> wide (printer head width), rows packed MSB-first, 1 = black.
                            // Node turns it into Epson GS v 0 or Star raster bytes for direct (driverless) printing.
                            var data = Convert.FromBase64String(S(req, "base64"));
                            int dots = int.TryParse(S(req, "dots"), out var dd) ? dd : 576;
                            int thr = int.TryParse(S(req, "threshold"), out var tt) ? tt : 160;
                            using (var doc = new Pdf(data)) return Ok(PdfPrint.RenderMono(doc, dots, thr));
                        }
                    case "ports": return Ok(Ports.List());
                    case "serial":
                        {
                            // raw bytes to a serial (COM) receipt printer, e.g. Epson TM-T88 with RS-232 interface
                            var port = S(req, "port") ?? "COM1";
                            int baud = int.TryParse(S(req, "baud"), out var b) ? b : 9600;
                            var bytes = Convert.FromBase64String(S(req, "base64"));
                            var hs = (S(req, "handshake") ?? "rtscts").ToLowerInvariant();
                            using (var sp = new System.IO.Ports.SerialPort(port, baud, System.IO.Ports.Parity.None, 8, System.IO.Ports.StopBits.One))
                            {
                                sp.Handshake = hs == "none" ? System.IO.Ports.Handshake.None : hs == "xonxoff" ? System.IO.Ports.Handshake.XOnXOff : System.IO.Ports.Handshake.RequestToSend;
                                sp.WriteTimeout = 15000; sp.Open();
                                for (int i = 0; i < bytes.Length; i += 1024) sp.Write(bytes, i, Math.Min(1024, bytes.Length - i));
                                var until = DateTime.UtcNow.AddSeconds(15);
                                while (sp.BytesToWrite > 0 && DateTime.UtcNow < until) System.Threading.Thread.Sleep(20);
                            }
                            return Ok(port);
                        }
                    default: throw new InvalidOperationException("unknown command");
                }
            }
            catch (Exception ex) { return Err(ex); }
        }
    }

    static class Printers
    {
        // 1.2.0 auto-pick: works with whatever printer is plugged in. Re-read on every call, so a new USB printer or a
        // removed / renamed saved printer is noticed at the next print.
        static readonly System.Text.RegularExpressions.Regex Virtual = new System.Text.RegularExpressions.Regex(
            @"pdf|xps|fax|onenote|send to|document writer|microsoft print|snagit|anydesk|webex|cutepdf|foxit|evernote|image writer|print to file|nitro|bullzip|dropbox|teamviewer", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        static readonly System.Text.RegularExpressions.Regex VirtualPort = new System.Text.RegularExpressions.Regex(
            @"^(portprompt:|file:|nul:?|xpsport:|shrfax:|pdf|onenote|microsoft\.office|wsd-.*fax)", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        internal static readonly System.Text.RegularExpressions.Regex Receipt = new System.Text.RegularExpressions.Regex(
            @"pos[- _]?(58|80)|(^|[^a-z])pos([^a-z]|$)|receipt|thermal|小票|票据|热敏|tm-?[tmhlpu]\d|tsp ?\d|(^|[^a-z])star([^a-z]|$)|futureprnt|m804|xprinter|xp-?\d{2}|rongta|gprinter|bixolon|srp-|80 ?mm|58 ?mm|generic / text only|citizen ct|sewoo|zjiang|munbyn|hoin|epson tm", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        public static List<string> Installed() => PrinterSettings.InstalledPrinters.Cast<string>().ToList();
        public static List<Dictionary<string, object>> Details() => Raw.EnumDetails();
        public static string LastReason = "";
        static string DefaultName() { try { var d = new PrinterSettings().PrinterName; return string.IsNullOrEmpty(d) || d.IndexOf("not set", StringComparison.OrdinalIgnoreCase) >= 0 ? null : d; } catch { return null; } }
        static string Str(Dictionary<string, object> d, string k) => d != null && d.TryGetValue(k, out var v) && v != null ? v.ToString() : "";
        public static bool IsVirtual(string name, string driver, string port) => Virtual.IsMatch(name + " | " + driver) || VirtualPort.IsMatch(port ?? "");
        public static bool IsReceipt(string name, string driver, string port) => Receipt.IsMatch(name + " | " + driver) || (port ?? "").StartsWith("ESDPRT", StringComparison.OrdinalIgnoreCase) || (port ?? "").StartsWith("TMUSB", StringComparison.OrdinalIgnoreCase);
        static bool IsOffline(Dictionary<string, object> d) { if (d == null) return false; if (d.TryGetValue("workOffline", out var w) && w is bool b && b) return true; var pr = Str(d, "problem"); return pr.Contains("offline"); }

        // want = the printer saved in Settings ("" = automatic). A saved printer that is gone is replaced by the auto pick
        // (LastReason says so); it never throws while any real printer exists.
        public static string Resolve(string want, bool strict = false)
        {
            var all = Installed();
            if (all.Count == 0) throw new InvalidOperationException("No printer is installed on this PC. Plug in the receipt printer (and install its driver, or let Windows add it), then try again.");
            List<Dictionary<string, object>> det = null; try { det = Details(); } catch { }
            Func<string, Dictionary<string, object>> D = n => det?.FirstOrDefault(x => string.Equals(Str(x, "name"), n, StringComparison.OrdinalIgnoreCase));
            string missing = null;
            if (!string.IsNullOrWhiteSpace(want))
            {
                var exact = all.FirstOrDefault(x => string.Equals(x, want, StringComparison.OrdinalIgnoreCase));
                if (exact != null) { LastReason = "saved in Settings"; return exact; }
                missing = want;
            }
            var real = all.Where(n => { var d = D(n); return !IsVirtual(n, Str(d, "driver"), Str(d, "port")); }).ToList();
            if (real.Count == 0) throw new InvalidOperationException("Only virtual printers were found (" + string.Join(", ", all) + "). Plug in the receipt printer and make sure Windows shows it in Printers & scanners.");
            var def = DefaultName();
            Func<string, bool> online = n => !IsOffline(D(n));
            Func<string, bool> receipt = n => { var d = D(n); return IsReceipt(n, Str(d, "driver"), Str(d, "port")); };
            string pick; string why;
            pick = real.FirstOrDefault(n => receipt(n) && online(n) && string.Equals(n, def, StringComparison.OrdinalIgnoreCase)); why = "receipt printer (Windows default)";
            if (pick == null) { pick = real.FirstOrDefault(n => receipt(n) && online(n)); why = "receipt printer found"; }
            if (pick == null) { pick = real.FirstOrDefault(n => string.Equals(n, def, StringComparison.OrdinalIgnoreCase) && online(n)); why = "Windows default printer (no receipt printer found)"; }
            if (pick == null) { pick = real.FirstOrDefault(receipt); why = "receipt printer (Windows reports it offline)"; }
            if (pick == null) { pick = real.FirstOrDefault(online); why = "first working printer (no receipt printer found)"; }
            if (pick == null) { pick = real.First(); why = "only printer found (Windows reports it offline)"; }
            LastReason = (missing != null ? "saved printer '" + missing + "' is not on this PC; using " : "automatic: ") + why;
            return pick;
        }
    }

    static class Raw
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct JOB_INFO_1
        {
            public uint JobId; public IntPtr pPrinterName, pMachineName, pUserName, pDocument, pDatatype, pStatus;
            public uint Status, Priority, Position, TotalPages, PagesPrinted;
            public ushort wYear, wMonth, wDayOfWeek, wDay, wHour, wMinute, wSecond, wMilliseconds;
        }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        internal struct PRINTER_INFO_2
        {
            public IntPtr pServerName, pPrinterName, pShareName, pPortName, pDriverName, pComment, pLocation, pDevMode, pSepFile, pPrintProcessor, pDatatype, pParameters, pSecurityDescriptor;
            public uint Attributes, Priority, DefaultPriority, StartTime, UntilTime, Status, cJobs, AveragePPM;
        }
        [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "OpenPrinterW")] static extern bool OpenPrinter(string name, out IntPtr h, IntPtr def);
        [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
        [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "StartDocPrinterW")] static extern int StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
        [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
        [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
        [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
        [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, byte[] buf, int count, out int written);
        [DllImport("winspool.drv", SetLastError = true, EntryPoint = "GetJobW")] static extern bool GetJob(IntPtr h, uint jobId, int level, IntPtr buf, int cb, out int needed);
        [DllImport("winspool.drv", SetLastError = true, EntryPoint = "SetJobW")] static extern bool SetJob(IntPtr h, uint jobId, int level, IntPtr buf, int command);
        [DllImport("winspool.drv", SetLastError = true, EntryPoint = "GetPrinterW")] static extern bool GetPrinter(IntPtr h, int level, IntPtr buf, int cb, out int needed);
        [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "EnumPrintersW")] static extern bool EnumPrinters(int flags, string name, int level, IntPtr buf, int cb, out int needed, out int returned);

        // JOB_STATUS_* / PRINTER_STATUS_* / PRINTER_ATTRIBUTE_*
        const uint J_PAUSED = 0x1, J_ERROR = 0x2, J_DELETING = 0x4, J_PRINTING = 0x10, J_OFFLINE = 0x20, J_PAPEROUT = 0x40, J_PRINTED = 0x80, J_DELETED = 0x100, J_BLOCKED = 0x200, J_USER = 0x400, J_COMPLETE = 0x1000;
        const uint P_PAUSED = 0x1, P_ERROR = 0x2, P_PAPER_JAM = 0x8, P_PAPER_OUT = 0x10, P_OFFLINE = 0x80, P_NOT_AVAILABLE = 0x1000, P_DOOR_OPEN = 0x400000;
        const uint A_WORK_OFFLINE = 0x400;
        const int JOB_CONTROL_DELETE = 5;
        public static string LastDatatype = "RAW";
        [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "GetPrinterDriverW")] static extern bool GetPrinterDriver(IntPtr h, string env, int level, IntPtr buf, int cb, out int needed);
        // DRIVER_INFO_8.dwPrinterDriverAttributes & PRINTER_DRIVER_XPS (0x2) = v4 / XPS driver
        public static bool IsXpsDriver(string printer)
        {
            if (!OpenPrinter(printer, out var h, IntPtr.Zero)) return false;
            try
            {
                GetPrinterDriver(h, null, 8, IntPtr.Zero, 0, out int need); if (need <= 0) return false;
                var buf = Marshal.AllocHGlobal(need);
                try
                {
                    if (!GetPrinterDriver(h, null, 8, buf, need, out need)) return false;
                    // DRIVER_INFO_8: cVersion(4) + 15 pointers + FILETIME(8) + DWORDLONG(8) + 7 pointers(mfg..) then dwPrinterDriverAttributes
                    int ptr = IntPtr.Size, off = 4; off = (off + ptr - 1) / ptr * ptr; off += 9 * ptr; // pName..pDefaultDataType
                    off += ptr; // pszzPreviousNames
                    off = (off + 7) / 8 * 8; off += 8 + 8; // ftDriverDate, dwlDriverVersion
                    off += 4 * ptr; // pszMfgName, pszOEMUrl, pszHardwareID, pszProvider
                    off += ptr; // pszPrintProcessor
                    off += ptr; // pszVendorSetup
                    off += ptr; // pszzColorProfiles
                    off += ptr; // pszInfPath
                    int attrs = Marshal.ReadInt32(buf, off);
                    return (attrs & 0x2) != 0;
                }
                finally { Marshal.FreeHGlobal(buf); }
            }
            finally { ClosePrinter(h); }
        }

        static string Problem(uint st)
        {
            if ((st & P_PAPER_OUT) != 0 || (st & J_PAPEROUT) != 0) return "it is out of paper";
            if ((st & P_DOOR_OPEN) != 0) return "its cover is open";
            if ((st & P_PAPER_JAM) != 0) return "the paper is jammed";
            if ((st & P_OFFLINE) != 0 || (st & P_NOT_AVAILABLE) != 0) return "it is offline (turned off, unplugged, or the USB cable is loose)";
            if ((st & P_ERROR) != 0) return "it reports an error";
            return null;
        }
        static string JobProblem(uint st)
        {
            if ((st & J_PAPEROUT) != 0) return "it is out of paper";
            if ((st & J_OFFLINE) != 0) return "it is offline (turned off, unplugged, or the USB cable is loose)";
            if ((st & J_BLOCKED) != 0) return "another document is stuck in its print queue";
            if ((st & J_USER) != 0) return "it needs attention (cover open, paper or error light)";
            if ((st & J_ERROR) != 0) return "it reports an error (turned off, unplugged, out of paper or cover open)";
            if ((st & J_PAUSED) != 0) return "the document is paused";
            return null;
        }

        internal static PRINTER_INFO_2? Info(IntPtr h)
        {
            GetPrinter(h, 2, IntPtr.Zero, 0, out int need);
            if (need <= 0) return null;
            var buf = Marshal.AllocHGlobal(need);
            try { if (!GetPrinter(h, 2, buf, need, out need)) return null; return Marshal.PtrToStructure<PRINTER_INFO_2>(buf); }
            finally { Marshal.FreeHGlobal(buf); }
        }

        // print processor + default datatype of the queue (read while the GetPrinter buffer is still alive)
        static string QueueDetail(IntPtr h)
        {
            GetPrinter(h, 2, IntPtr.Zero, 0, out int need);
            if (need <= 0) return "printer ?, processor ?, queue datatype ?";
            var buf = Marshal.AllocHGlobal(need);
            try
            {
                if (!GetPrinter(h, 2, buf, need, out need)) return "printer ?, processor ?, queue datatype ?";
                var pi = Marshal.PtrToStructure<PRINTER_INFO_2>(buf);
                return "printer 0x" + pi.Status.ToString("x") + ", processor " + Marshal.PtrToStringUni(pi.pPrintProcessor) + ", queue datatype " + Marshal.PtrToStringUni(pi.pDatatype);
            }
            finally { Marshal.FreeHGlobal(buf); }
        }

        internal static List<Dictionary<string, object>> EnumDetails()
        {
            const int LOCAL = 2, CONNECTIONS = 4;
            var list = new List<Dictionary<string, object>>();
            EnumPrinters(LOCAL | CONNECTIONS, null, 2, IntPtr.Zero, 0, out int need, out int n);
            if (need <= 0) return list;
            var buf = Marshal.AllocHGlobal(need);
            try
            {
                if (!EnumPrinters(LOCAL | CONNECTIONS, null, 2, buf, need, out need, out n)) throw new Win32Exception(Marshal.GetLastWin32Error());
                int size = Marshal.SizeOf<PRINTER_INFO_2>();
                for (int i = 0; i < n; i++)
                {
                    var pi = Marshal.PtrToStructure<PRINTER_INFO_2>(IntPtr.Add(buf, i * size));
                    list.Add(new Dictionary<string, object> {
                        { "name", Marshal.PtrToStringUni(pi.pPrinterName) }, { "driver", Marshal.PtrToStringUni(pi.pDriverName) },
                        { "port", Marshal.PtrToStringUni(pi.pPortName) }, { "status", (long)pi.Status }, { "jobs", (long)pi.cJobs },
                        { "workOffline", (pi.Attributes & A_WORK_OFFLINE) != 0 }, { "paused", (pi.Status & P_PAUSED) != 0 },
                        { "problem", Problem(pi.Status) },
                        { "printProcessor", Marshal.PtrToStringUni(pi.pPrintProcessor) }, { "datatype", Marshal.PtrToStringUni(pi.pDatatype) } });
                }
            }
            finally { Marshal.FreeHGlobal(buf); }
            return list;
        }

        static uint LastPagesPrinted;
        static uint? JobStatus(IntPtr h, uint id)
        {
            GetJob(h, id, 1, IntPtr.Zero, 0, out int need);
            if (need <= 0) return null; // job is gone: the printer took it
            var buf = Marshal.AllocHGlobal(need);
            try { if (!GetJob(h, id, 1, buf, need, out need)) return null; var ji = Marshal.PtrToStructure<JOB_INFO_1>(buf); LastPagesPrinted = ji.PagesPrinted; return ji.Status; }
            finally { Marshal.FreeHGlobal(buf); }
        }

        // waitMs > 0: watch the job until the printer has taken it. A job that errors or is still waiting after
        // waitMs (printer off / unplugged / out of paper) is cancelled, so a receipt or a drawer kick never comes
        // out minutes later by surprise, and a plain error is thrown. Returns "printed", "sent" or "spooled".
        public static string Send(string printer, byte[] bytes, string doc, int waitMs = 0)
        {
            if (!OpenPrinter(printer, out var h, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot open printer '" + printer + "'");
            try
            {
                var info = Info(h);
                if (info.HasValue)
                {
                    if ((info.Value.Attributes & A_WORK_OFFLINE) != 0) throw new InvalidOperationException("Printer '" + printer + "' is set to \"Use Printer Offline\" in Windows. Open Printers & scanners, open its queue and untick Use Printer Offline.");
                    if ((info.Value.Status & P_PAUSED) != 0) throw new InvalidOperationException("Printer '" + printer + "' is paused in Windows. Open its print queue and choose Resume printing.");
                }
                // v4 / XPS-class drivers drop or mangle plain RAW jobs: send those as XPS_PASS (pass-through). If a driver refuses
                // the datatype (ERROR_INVALID_DATATYPE 1804) the other one is tried.
                bool xps = false; try { xps = IsXpsDriver(printer); } catch { }
                var types = xps ? new[] { "XPS_PASS", "RAW" } : new[] { "RAW", "XPS_PASS" };
                int job = 0, err = 0;
                foreach (var dt in types)
                {
                    job = StartDocPrinter(h, 1, new DOCINFO { pDocName = doc, pDataType = dt });
                    if (job != 0) { LastDatatype = dt; break; }
                    err = Marshal.GetLastWin32Error(); if (err != 1804) break;
                }
                if (job == 0) throw new Win32Exception(err, "Printer '" + printer + "' refused the job (Windows error " + err + ": " + new Win32Exception(err).Message + ")" + (err == 5 ? ". Windows denied access: run Air Register as the same user that installed the printer, or ask the PC admin to allow printing to it" : ""));
                try
                {
                    StartPagePrinter(h);
                    if (!WritePrinter(h, bytes, bytes.Length, out var n) || n != bytes.Length) throw new Win32Exception(Marshal.GetLastWin32Error(), "Printer '" + printer + "' did not take the data");
                    EndPagePrinter(h);
                }
                finally { EndDocPrinter(h); }
                if (waitMs <= 0) return "spooled";
                var start = DateTime.UtcNow; var hardEnd = start.AddMilliseconds(Math.Max(waitMs, 25000));
                string problem = null; int bad = 0; uint last = 0; bool everPrinting = false; LastPagesPrinted = 0;
                while (true)
                {
                    uint? st;
                    try { st = JobStatus(h, (uint)job); } catch { return "sent"; }
                    if (st == null || (st.Value & (J_PRINTED | J_COMPLETE | J_DELETED | J_DELETING)) != 0) return "printed";
                    last = st.Value;
                    var jp = JobProblem(st.Value);
                    if (jp != null) { if (++bad >= 3) { problem = jp; break; } } else bad = 0; // ignore a short USB retry blip
                    var now = DateTime.UtcNow;
                    bool printing = (st.Value & J_PRINTING) != 0; if (printing) everPrinting = true;
                    if (now - start > TimeSpan.FromMilliseconds(waitMs) && (!printing || now > hardEnd))
                    {
                        var pi = Info(h);
                        problem = (pi.HasValue ? Problem(pi.Value.Status) : null) ?? (printing ? "it stopped part way" : "it did not answer (turned off, unplugged, out of paper, or another document is stuck in its queue)");
                        break;
                    }
                    System.Threading.Thread.Sleep(250);
                }
                // 1.2.1: say when the job had started printing (part of it may be on the paper) and add the spooler detail for the log
                bool partly = everPrinting || LastPagesPrinted > 0; string qd; try { qd = QueueDetail(h); } catch { qd = "queue ?"; }
                string detail = " [diag: job 0x" + last.ToString("x") + ", " + qd + ", datatype " + LastDatatype + ", pages printed " + LastPagesPrinted + ", bytes " + bytes.Length + ", was printing " + (everPrinting ? "yes" : "no") + "]";
                try { SetJob(h, (uint)job, 0, IntPtr.Zero, JOB_CONTROL_DELETE); } catch { }
                throw new InvalidOperationException("Printer '" + printer + "' is not printing: " + problem + ". The job was cancelled" + (partly ? " (it had started, so part of it may have printed)" : "") + "." + detail);
            }
            finally { ClosePrinter(h); }
        }
    }

    // Star futurePRNT "Control" device font: printing one character through the driver drives the drawer
    // (A..E = drawer 1 for 50..250 ms, d = drawer 2 for 200 ms; Star TSP100 futurePRNT Software Manual 3.4).
    // GDI+ cannot use printer device fonts, so the character is drawn with GDI on the printer DC. If the driver has no
    // "Control" font the page is cancelled (nothing printed) and an error is returned, so a stray letter never prints.
    static class DriverDrawer
    {
        [DllImport("gdi32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateFontW(int h, int w, int esc, int orient, int weight, uint italic, uint underline, uint strike, uint charset, uint outPrec, uint clipPrec, uint quality, uint pitch, string face);
        [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
        [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
        [DllImport("gdi32.dll", CharSet = CharSet.Unicode)] static extern bool TextOutW(IntPtr hdc, int x, int y, string s, int n);
        [DllImport("gdi32.dll", CharSet = CharSet.Unicode)] static extern int GetTextFaceW(IntPtr hdc, int n, System.Text.StringBuilder sb);
        [DllImport("gdi32.dll")] static extern int GetDeviceCaps(IntPtr hdc, int idx);
        public static string Open(string printerName, string ch)
        {
            if (string.IsNullOrEmpty(ch) || ch.Length != 1 || "ABCDEd".IndexOf(ch, StringComparison.Ordinal) < 0) throw new ArgumentException("drawer character must be A, B, C, D, E or d");
            string error = null;
            using (var pd = new PrintDocument())
            {
                pd.PrinterSettings.PrinterName = printerName;
                if (!pd.PrinterSettings.IsValid) throw new InvalidOperationException("Printer '" + printerName + "' is not available.");
                pd.DocumentName = "Air Register drawer";
                pd.PrintController = new StandardPrintController();
                pd.DefaultPageSettings = new PageSettings(pd.PrinterSettings) { Margins = new Margins(0, 0, 0, 0), PaperSize = new PaperSize(string.Empty, 283, 20), Landscape = false };
                pd.PrintPage += (s, e) =>
                {
                    var hdc = e.Graphics.GetHdc();
                    try
                    {
                        int dpiY = GetDeviceCaps(hdc, 90); // LOGPIXELSY
                        var font = CreateFontW(-(int)Math.Round(8.5 * dpiY / 72.0), 0, 0, 0, 400, 0, 0, 0, 1 /*DEFAULT_CHARSET*/, 5 /*OUT_DEVICE_PRECIS*/, 0, 0, 0, "Control");
                        var old = SelectObject(hdc, font);
                        try
                        {
                            var sb = new System.Text.StringBuilder(64); GetTextFaceW(hdc, sb.Capacity, sb);
                            if (!string.Equals(sb.ToString(), "Control", StringComparison.OrdinalIgnoreCase)) { error = "the printer driver has no Star \"Control\" font (got \"" + sb + "\"); is this a Star futurePRNT queue?"; e.Cancel = true; }
                            else TextOutW(hdc, 0, 0, ch, 1);
                        }
                        finally { SelectObject(hdc, old); DeleteObject(font); }
                    }
                    finally { e.Graphics.ReleaseHdc(hdc); }
                    e.HasMorePages = false;
                };
                pd.Print();
            }
            if (error != null) throw new InvalidOperationException("Printer '" + printerName + "': " + error);
            return "driver-drawer";
        }
    }

    static class Ports
    {
        // COM ports from HKLM\HARDWARE\DEVICEMAP\SERIALCOMM. The Epson TM Virtual Port Driver adds one per TM printer
        // (device \Device\TMVPORTn / "ESDPRT"), which is how Epson's own software talks to a USB TM-T20II.
        public static List<Dictionary<string, object>> List()
        {
            var list = new List<Dictionary<string, object>>();
            using (var k = Registry.LocalMachine.OpenSubKey(@"HARDWARE\DEVICEMAP\SERIALCOMM"))
                if (k != null)
                    foreach (var v in k.GetValueNames())
                    {
                        var port = k.GetValue(v)?.ToString(); if (string.IsNullOrEmpty(port)) continue;
                        bool epson = v.IndexOf("TMV", StringComparison.OrdinalIgnoreCase) >= 0 || v.IndexOf("ESDPRT", StringComparison.OrdinalIgnoreCase) >= 0 || v.IndexOf("Epson", StringComparison.OrdinalIgnoreCase) >= 0;
                        list.Add(new Dictionary<string, object> { { "port", port }, { "device", v }, { "epsonVirtual", epson } });
                    }
            foreach (var p in System.IO.Ports.SerialPort.GetPortNames())
                if (!list.Any(x => string.Equals((string)x["port"], p, StringComparison.OrdinalIgnoreCase)))
                    list.Add(new Dictionary<string, object> { { "port", p }, { "device", "" }, { "epsonVirtual", false } });
            return list.OrderBy(x => (string)x["port"]).ToList();
        }
    }

    // Minimal PDFium wrapper (same native library PdfiumViewer uses inside AIR POS).
    sealed class Pdf : IDisposable
    {
        [DllImport("pdfium.dll")] static extern void FPDF_InitLibrary();
        [DllImport("pdfium.dll")] static extern IntPtr FPDF_LoadMemDocument(IntPtr data, int size, string password);
        [DllImport("pdfium.dll")] static extern void FPDF_CloseDocument(IntPtr doc);
        [DllImport("pdfium.dll")] static extern int FPDF_GetPageCount(IntPtr doc);
        [DllImport("pdfium.dll")] static extern int FPDF_GetPageSizeByIndex(IntPtr doc, int index, out double w, out double h);
        [DllImport("pdfium.dll")] static extern IntPtr FPDF_LoadPage(IntPtr doc, int index);
        [DllImport("pdfium.dll")] static extern void FPDF_ClosePage(IntPtr page);
        [DllImport("pdfium.dll")] static extern void FPDF_RenderPage(IntPtr hdc, IntPtr page, int x, int y, int w, int h, int rotate, int flags);
        [DllImport("pdfium.dll")] static extern uint FPDF_GetLastError();
        [DllImport("gdi32.dll")] static extern bool SetViewportOrgEx(IntPtr hdc, int x, int y, out Point old);
        const int FPDF_ANNOT = 0x01, FPDF_PRINTING = 0x800;
        static bool inited;

        GCHandle pin; IntPtr doc;
        public readonly List<SizeF> PageSizes = new List<SizeF>();
        public int PageCount => PageSizes.Count;

        public Pdf(byte[] data)
        {
            if (!inited) { FPDF_InitLibrary(); inited = true; }
            pin = GCHandle.Alloc(data, GCHandleType.Pinned);
            doc = FPDF_LoadMemDocument(pin.AddrOfPinnedObject(), data.Length, null);
            if (doc == IntPtr.Zero) { pin.Free(); throw new InvalidOperationException("The receipt PDF could not be read (PDFium error " + FPDF_GetLastError() + ")."); }
            int n = FPDF_GetPageCount(doc);
            for (int i = 0; i < n; i++) { FPDF_GetPageSizeByIndex(doc, i, out var w, out var h); PageSizes.Add(new SizeF((float)w, (float)h)); }
        }

        // Same as PdfiumViewer PdfDocument.Render(page, Graphics, dpiX, dpiY, bounds, ForPrinting|Annotations)
        public void Render(int index, Graphics g, Rectangle bounds, bool forPrinting)
        {
            var page = FPDF_LoadPage(doc, index);
            if (page == IntPtr.Zero) throw new InvalidOperationException("PDF page could not be loaded.");
            var dc = g.GetHdc();
            try
            {
                SetViewportOrgEx(dc, bounds.X, bounds.Y, out var old);
                FPDF_RenderPage(dc, page, 0, 0, bounds.Width, bounds.Height, 0, FPDF_ANNOT | (forPrinting ? FPDF_PRINTING : 0));
                SetViewportOrgEx(dc, old.X, old.Y, out old);
            }
            finally { g.ReleaseHdc(dc); FPDF_ClosePage(page); }
        }

        public void Dispose()
        {
            if (doc != IntPtr.Zero) { FPDF_CloseDocument(doc); doc = IntPtr.Zero; }
            if (pin.IsAllocated) pin.Free();
        }
    }

    static class PdfPrint
    {
        // Mirrors AIR POS HardwareHelper.CreateCustomPdfPrintDocument (leftRemainFactor 0.05, heightScale 1.0).
        public static void Print(Pdf pdf, string printerName, double leftRemainFactor = 0.05, double heightScaleFactor = 1.0)
        {
            if (pdf.PageCount == 0) throw new InvalidOperationException("The receipt PDF has no pages.");
            Func<double, double> toHundredths = side => side * 100.0 / 72.0;
            double width = toHundredths(pdf.PageSizes.Max(x => x.Width));
            double height = toHundredths(pdf.PageSizes.Sum(x => x.Height));
            using (var pd = new PrintDocument())
            {
                pd.PrinterSettings.PrinterName = printerName;
                if (!pd.PrinterSettings.IsValid) throw new InvalidOperationException("Printer '" + printerName + "' is not available.");
                pd.DocumentName = "Air Register receipt";
                pd.PrintController = new StandardPrintController(); // no "Printing..." popup
                pd.DefaultPageSettings = new PageSettings(pd.PrinterSettings)
                {
                    Margins = new Margins(0, 0, 0, 0),
                    PaperSize = new PaperSize(string.Empty, (int)width, (int)(height * heightScaleFactor)),
                    Landscape = false
                };
                pd.PrintPage += (s, e) =>
                {
                    int y = 0;
                    float dpiX = e.Graphics.DpiX, dpiY = e.Graphics.DpiY;
                    int printableW = 0; try { printableW = Adjust(dpiX, e.PageSettings.PrintableArea.Width); } catch { }
                    for (int i = 0; i < pdf.PageCount; i++)
                    {
                        int w = Adjust(dpiX, e.PageBounds.Width);
                        int h = Adjust(dpiY, e.PageBounds.Height * 1.0 / pdf.PageCount);
                        var fit = PrintFit.Fit(w, h, leftRemainFactor, printableW); // 1.0.10-local.2: never wider than the printable area
                        w = fit[0]; h = fit[1];
                        double left = w * leftRemainFactor;
                        pdf.Render(i, e.Graphics, new Rectangle((int)(0.0 - left), y, w, h), true);
                        y += h;
                    }
                    e.HasMorePages = false;
                };
                pd.Print();
            }
        }
        static int Adjust(double dpi, double value) => (int)(value / 100.0 * dpi);

        public static Dictionary<string, object> RenderMono(Pdf pdf, int dots, int threshold)
        {
            if (pdf.PageCount == 0) throw new InvalidOperationException("The receipt PDF has no pages.");
            dots = Math.Max(64, Math.Min(dots, 1024)) / 8 * 8;
            double pw = pdf.PageSizes.Max(x => x.Width);
            double scale = dots / pw;
            int h = 0; var ph = new List<int>();
            for (int i = 0; i < pdf.PageCount; i++) { int y = (int)Math.Ceiling(pdf.PageSizes[i].Height * scale); ph.Add(y); h += y; }
            h = Math.Max(1, Math.Min(h, 30000));
            int stride = dots / 8; var packed = new byte[stride * h];
            using (var bmp = new Bitmap(dots, h, PixelFormat.Format24bppRgb))
            {
                using (var g = Graphics.FromImage(bmp))
                {
                    g.Clear(Color.White);
                    int y = 0;
                    for (int i = 0; i < pdf.PageCount && y < h; i++) { pdf.Render(i, g, new Rectangle(0, y, (int)Math.Round(pdf.PageSizes[i].Width * scale), ph[i]), true); y += ph[i]; }
                }
                var bd = bmp.LockBits(new Rectangle(0, 0, dots, h), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
                try
                {
                    var row = new byte[bd.Stride];
                    for (int y = 0; y < h; y++)
                    {
                        Marshal.Copy(IntPtr.Add(bd.Scan0, y * bd.Stride), row, 0, bd.Stride);
                        for (int x = 0; x < dots; x++)
                        {
                            int lum = (row[x * 3] * 114 + row[x * 3 + 1] * 587 + row[x * 3 + 2] * 299) / 1000;
                            if (lum < threshold) packed[y * stride + (x >> 3)] |= (byte)(0x80 >> (x & 7));
                        }
                    }
                }
                finally { bmp.UnlockBits(bd); }
            }
            // trim blank rows at the bottom (keeps paper use down), keep at least one row
            int last = h - 1;
            while (last > 0) { bool blank = true; for (int k = 0; k < stride; k++) if (packed[last * stride + k] != 0) { blank = false; break; } if (!blank) break; last--; }
            int outH = last + 1; var outB = new byte[stride * outH]; Array.Copy(packed, outB, outB.Length);
            return new Dictionary<string, object> { { "width", dots }, { "height", outH }, { "data", Convert.ToBase64String(outB) } };
        }

        // Test aid: render the same stack of pages into a PNG at the given dpi.
        public static void RenderPng(Pdf pdf, string path, int dpi)
        {
            int w = (int)(pdf.PageSizes.Max(x => x.Width) / 72.0 * dpi);
            int h = (int)(pdf.PageSizes.Sum(x => x.Height) / 72.0 * dpi);
            using (var bmp = new Bitmap(Math.Max(w, 1), Math.Max(h, 1)))
            {
                bmp.SetResolution(dpi, dpi);
                using (var g = Graphics.FromImage(bmp))
                {
                    g.Clear(Color.White);
                    int y = 0;
                    for (int i = 0; i < pdf.PageCount; i++)
                    {
                        int ph = (int)(pdf.PageSizes[i].Height / 72.0 * dpi);
                        pdf.Render(i, g, new Rectangle(0, y, (int)(pdf.PageSizes[i].Width / 72.0 * dpi), ph), false);
                        y += ph;
                    }
                }
                bmp.Save(path, ImageFormat.Png);
            }
        }
    }

    static class Device
    {
        static readonly string Dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "AirPos");
        static readonly string FilePath = Path.Combine(Dir, "device_id.txt");
        static readonly string LogPath = Path.Combine(Dir, "device_id.log");

        public static string GetDeviceId()
        {
            string id;
            try { id = ReadFile(); }
            catch (Exception ex) { Log("Read device id failed: " + ex.Message); return Generate(); }
            if (string.IsNullOrEmpty(id)) { id = Generate(); WriteFile(id); }
            return id;
        }

        static string Generate()
        {
            try { return Md5($"{Wmi("ProcessorId", "Win32_Processor")}-{Wmi("SerialNumber", "Win32_BIOS")}-{Wmi("SerialNumber", "Win32_PhysicalMedia")}-{Mac()}"); }
            catch (Exception ex) { Log("Fetch hardware device id failed: " + ex.Message); return Md5(Guid.NewGuid().ToString()); }
        }

        public static string GetOldDeviceId()
        {
            try
            {
                var s = Md5($"{Wmi("ProcessorId", "Win32_Processor")}-{Wmi("SerialNumber", "Win32_BIOS")}-{Wmi("SerialNumber", "Win32_PhysicalMedia")}-{Wmi("Version", "Win32_OperatingSystem")}");
                if (string.IsNullOrEmpty(s)) throw new NotSupportedException();
                return s;
            }
            catch
            {
                string input = string.Empty;
                using (var k = Registry.LocalMachine.OpenSubKey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion"))
                    if (k != null) input = k.GetValue("ProductId")?.ToString() ?? "UNKNOWN";
                return Md5(input);
            }
        }

        static string ReadFile()
        {
            if (!File.Exists(FilePath)) return string.Empty;
            var t = File.ReadAllText(FilePath).Trim();
            return t.Length == 32 && t.All(c => Uri.IsHexDigit(c)) ? t : string.Empty;
        }

        static void WriteFile(string id)
        {
            try
            {
                EnsureDir();
                var tmp = FilePath + ".tmp";
                File.WriteAllText(tmp, id);
                if (File.Exists(FilePath)) File.Delete(FilePath);
                File.Move(tmp, FilePath);
            }
            catch (Exception ex) { Log("Write device id failed: " + ex.Message); }
        }

        static void EnsureDir()
        {
            if (Directory.Exists(Dir)) return;
            Directory.CreateDirectory(Dir);
            try
            {
                var sec = new DirectorySecurity();
                sec.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.WorldSid, null), FileSystemRights.FullControl,
                    InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
                new DirectoryInfo(Dir).SetAccessControl(sec);
            }
            catch { }
        }

        static void Log(string m)
        {
            try { Console.Error.WriteLine("Device id: " + m); EnsureDir(); File.AppendAllText(LogPath, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {m}{Environment.NewLine}"); } catch { }
        }

        static string Wmi(string prop, string cls)
        {
            using (var s = new ManagementObjectSearcher($"select {prop} from {cls}"))
            using (var e = s.Get().GetEnumerator())
                return e.MoveNext() ? e.Current[prop]?.ToString() : string.Empty;
        }

        static string Mac()
        {
            string t = string.Empty;
            using (var s = new ManagementObjectSearcher("select MACAddress from Win32_NetworkAdapter where PhysicalAdapter=True and MACAddress is not null"))
                foreach (var item in s.Get()) { t = item["MACAddress"]?.ToString(); if (!string.IsNullOrEmpty(t)) break; }
            return t?.Replace(":", "").Replace("-", "") ?? string.Empty;
        }

        static string Md5(string input)
        {
            using (var md = MD5.Create())
                return string.Concat(md.ComputeHash(Encoding.UTF8.GetBytes(input)).Select(b => b.ToString("X2")));
        }
    }
}
