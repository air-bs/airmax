// Unit test for hw/PrintFit.cs (the helper's fit-to-printable-width math). Run: dotnet run --project tests/hwfit
using System; using AirRegisterHw;
static class T {
  static int pass, fail;
  static void Rec(string k, bool ok, string note) { if (ok) pass++; else fail++; Console.WriteLine((ok ? "PASS " : "FAIL ") + k + " — " + note); }
  static int Px(double mm, int dpi) => (int)(mm / 25.4 * dpi);
  static int Main() {
    // 80 mm receipt PDF on a Star TSP143 (203 dpi): paper 80 mm, printable 72 mm
    int w = Px(80, 203), h = Px(400, 203), pw = Px(72, 203);
    var f = PrintFit.Fit(w, h, 0.05, pw);
    Rec("80 mm PDF on a 72 mm printable area: right edge inside the printable width", f[0] * 0.95 <= pw, $"{w}x{h} -> {f[0]}x{f[1]}, right {f[0] * 0.95:0} <= {pw}");
    Rec("...uses the full printable width (not shrunk more than needed)", f[0] * 0.95 > pw - 2, $"{f[0] * 0.95:0} vs {pw}");
    Rec("...keeps the aspect ratio", Math.Abs((double)f[0] / f[1] - (double)w / h) < 0.01, $"{(double)w / h:0.0000} vs {(double)f[0] / f[1]:0.0000}");
    Rec("...scale is below 1", f[0] < w && f[1] < h, $"scale {(double)f[0] / w:0.000}");
    var g = PrintFit.Fit(Px(58, 203), h, 0.05, pw);
    Rec("58 mm PDF on a 72 mm printable area: unchanged (never scaled up)", g[0] == Px(58, 203) && g[1] == h, $"{g[0]}x{g[1]}");
    var u = PrintFit.Fit(w, h, 0.05, 0);
    Rec("printable width unknown (0): unchanged", u[0] == w && u[1] == h, $"{u[0]}x{u[1]}");
    var e = PrintFit.Fit(Px(80, 600), Px(400, 600), 0.05, Px(72, 600));
    Rec("600 dpi office driver: same fit", e[0] * 0.95 <= Px(72, 600), $"{e[0]}");
    var exact = PrintFit.Fit(100, 200, 0.0, 100);
    Rec("exactly as wide as the printable area: unchanged", exact[0] == 100 && exact[1] == 200, $"{exact[0]}x{exact[1]}");
    Console.WriteLine($"hwfit: {pass}/{pass + fail} passed"); return fail == 0 ? 0 : 1;
  }
}
