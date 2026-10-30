// Graphite.exe — запускает редактор в собственном окне, без консоли.
// Пути берутся из Graphite.ini рядом с exe: 1-я строка — pythonw.exe, 2-я — папка редактора.
using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

static class Launcher
{
    [STAThread]
    static void Main()
    {
        string exeDir = AppDomain.CurrentDomain.BaseDirectory;
        string ini = Path.Combine(exeDir, "Graphite.ini");
        try
        {
            string[] lines = File.ReadAllLines(ini, Encoding.UTF8);
            string pythonw = lines[0].Trim();
            string root = lines[1].Trim();
            string script = Path.Combine(root, "app", "desktop.py");
            if (!File.Exists(pythonw)) throw new Exception("Не найден Python: " + pythonw);
            if (!File.Exists(script)) throw new Exception("Не найден редактор: " + script);
            var psi = new ProcessStartInfo(pythonw, "\"" + script + "\"");
            psi.UseShellExecute = false;
            psi.WorkingDirectory = root;
            Process.Start(psi);
        }
        catch (Exception e)
        {
            MessageBox.Show("Не удалось запустить Graphite.\n\n" + e.Message + "\n\nПересобери запускалку: tools\\build_desktop.ps1",
                "Graphite", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
