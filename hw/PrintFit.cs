// 1.0.10-local.2 (Ari OK 11:44 AM ET Nov 1): fit a driver-printed receipt to the printer's PRINTABLE width.
// PdfPrint draws the PDF as wide as the paper (AIR POS way: page width = PDF width, 5% shifted left). On a Star TSP143
// (futurePRNT) the paper is 80 mm but only ~72 mm is printable, so the right edge (amounts, transaction no., time) was cut off.
// Pure math, no Windows calls, so it is unit tested on the build box (tests/hwfit).
using System;

namespace AirRegisterHw
{
    public static class PrintFit
    {
        // w, h: drawing size in device pixels; leftFactor: share of w drawn left of x = 0 (0.05); printableW: printable width in
        // device pixels (0 / unknown = leave as is). Returns the size to draw: same aspect ratio, never larger than asked (scale <= 1).
        public static int[] Fit(int w, int h, double leftFactor, int printableW)
        {
            if (w <= 0 || h <= 0 || printableW <= 0) return new[] { w, h };
            double right = w * (1.0 - leftFactor);           // right edge of the drawing, from the printable origin
            if (right <= printableW) return new[] { w, h };   // fits already: unchanged (never scaled up)
            double s = printableW / right;
            return new[] { Math.Max(1, (int)Math.Floor(w * s)), Math.Max(1, (int)Math.Floor(h * s)) };
        }
        public static double Scale(int w, double leftFactor, int printableW) { var r = Fit(w, 1000000, leftFactor, printableW); return r[1] / 1000000.0; }
    }
}
